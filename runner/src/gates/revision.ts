import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import { diffClaimSets, type ClaimSetDiffV1 } from "../claims/diff.js";
import { extractClaimMap } from "../claims/extract.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText } from "../openai-compat.js";
import { buildRevisionPrompt, buildRevisionSystem } from "../prompts/revision.js";
import type { WorkOrderV1 } from "./schema.js";

export type RevisionRunOutput = {
  revisedDraft: string;
  applied: number;
  diff: ClaimSetDiffV1;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
};

function normalizeDraft(text: string): string {
  return text.trim();
}

export async function applyRevisionWorkOrders(params: {
  layout: HistwriteProjectLayout;
  draft: string;
  workOrders: WorkOrderV1[];
  noCache?: boolean;
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<RevisionRunOutput> {
  const beforeDraft = normalizeDraft(params.draft);
  const beforeClaims = extractClaimMap({ draft: beforeDraft });

  if (params.workOrders.length === 0) {
    return {
      revisedDraft: beforeDraft,
      applied: 0,
      diff: diffClaimSets({ before: beforeClaims.claimSet, after: beforeClaims.claimSet }),
      cacheHit: false,
      endpoint: "responses",
      model: params.client.model,
    };
  }

  const system = buildRevisionSystem();
  const prompt = buildRevisionPrompt({ draft: beforeDraft, workOrders: params.workOrders });
  const apiBaseUrl = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const key = cacheKey({
    taskName: "revision",
    model: params.client.model,
    promptVersion: "revision_v1",
    inputs: {
      apiBaseUrl,
      endpoint: params.client.endpoint ?? "auto",
      draftSha256: sha256Hex(beforeDraft),
      workOrdersSha256: sha256Hex(stableJsonStringify(params.workOrders)),
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "revision"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; text?: unknown }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "responses";
  let revisedDraft = "";

  if (cached && typeof cached.text === "string") {
    cacheHit = true;
    revisedDraft = normalizeDraft(cached.text);
    endpoint = cached.endpoint === "chat" ? "chat" : "responses";
  } else {
    const generated = await openAiCompatGenerateText({
      client: {
        apiBaseUrl: params.client.apiBaseUrl,
        apiKey: params.client.apiKey,
        model: params.client.model,
        ...(typeof params.client.timeoutMs === "number" ? { timeoutMs: params.client.timeoutMs } : {}),
        ...(typeof params.client.temperature === "number" ? { temperature: params.client.temperature } : {}),
        ...(typeof params.client.maxTokens === "number" ? { maxTokens: params.client.maxTokens } : {}),
      },
      system,
      prompt,
      endpoint: params.client.endpoint ?? "auto",
    });
    revisedDraft = normalizeDraft(generated.text);
    endpoint = generated.endpoint;
    await cache.putJson(key, { version: 1, endpoint, text: revisedDraft });
  }

  const afterClaims = extractClaimMap({ draft: revisedDraft });
  const diff = diffClaimSets({ before: beforeClaims.claimSet, after: afterClaims.claimSet });
  if (diff.addedClaims > 0) {
    throw new Error(`revision introduced new claims: ${diff.added.map((item) => item.claimId).join(", ")}`);
  }

  return {
    revisedDraft,
    applied: params.workOrders.length,
    diff,
    cacheHit,
    endpoint,
    model: params.client.model,
  };
}
