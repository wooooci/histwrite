import path from "node:path";

import { cacheKey, createCasCache, sha256Hex } from "../cache.js";
import { diffClaimSets } from "../claims/diff.js";
import { extractClaimMap } from "../claims/extract.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText } from "../openai-compat.js";
import { buildWeavePrompt, buildWeaveSystem } from "../prompts/weave.js";
import type { WeaveNarrativeResultV1 } from "./schema.js";

type AnchorSnapshot = {
  claimId: string;
  kind: string;
  evidenceRefs: string[];
  spanText: string;
};

function normalizeDraft(text: string): string {
  return text.trim();
}

function snapshotAnchors(draft: string): AnchorSnapshot[] {
  return extractClaimMap({ draft }).claims.map((claim) => ({
    claimId: claim.claimId,
    kind: claim.kind,
    evidenceRefs: claim.evidenceRefs.map((ref) => ref.raw),
    spanText: claim.text,
  }));
}

function assertAnchorsPreserved(beforeDraft: string, afterDraft: string): ReturnType<typeof diffClaimSets> {
  const beforeMap = extractClaimMap({ draft: beforeDraft });
  const afterMap = extractClaimMap({ draft: afterDraft });
  const diff = diffClaimSets({ before: beforeMap.claimSet, after: afterMap.claimSet });

  if (diff.addedClaims > 0) {
    throw new Error(`woven draft introduced new claim anchors: ${diff.added.map((item) => item.claimId).join(", ")}`);
  }

  const beforeAnchors = snapshotAnchors(beforeDraft);
  const afterAnchors = snapshotAnchors(afterDraft);
  if (beforeAnchors.length !== afterAnchors.length) {
    throw new Error("woven draft tampered with existing claim anchors");
  }

  for (let i = 0; i < beforeAnchors.length; i += 1) {
    const before = beforeAnchors[i]!;
    const after = afterAnchors[i]!;
    const same =
      before.claimId === after.claimId &&
      before.kind === after.kind &&
      before.spanText === after.spanText &&
      before.evidenceRefs.join(",") === after.evidenceRefs.join(",");
    if (!same) {
      throw new Error("woven draft tampered with existing claim anchors");
    }
  }

  return diff;
}

export async function weaveNarrativeDraft(params: {
  draft: string;
  layout?: HistwriteProjectLayout | null;
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
}): Promise<WeaveNarrativeResultV1> {
  const draft = normalizeDraft(params.draft);
  const system = buildWeaveSystem();
  const prompt = buildWeavePrompt({ draft });
  const apiBaseUrl = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const cacheDir = path.join(params.layout?.cacheDir ?? path.resolve(".histwrite/cache"), "weave");
  const key = cacheKey({
    taskName: "weave_narrative",
    model: params.client.model,
    promptVersion: "weave_v1",
    inputs: {
      apiBaseUrl,
      endpoint: params.client.endpoint ?? "auto",
      draftSha256: sha256Hex(draft),
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
    },
  });

  const cache = await createCasCache(cacheDir);
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; text?: unknown }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "responses";
  let wovenDraft = "";

  if (cached && typeof cached.text === "string") {
    cacheHit = true;
    wovenDraft = normalizeDraft(cached.text);
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
    wovenDraft = normalizeDraft(generated.text);
    endpoint = generated.endpoint;
    await cache.putJson(key, { version: 1, endpoint, text: wovenDraft });
  }

  const anchorDiff = assertAnchorsPreserved(draft, wovenDraft);

  return {
    version: 1,
    wovenDraft,
    anchorDiff,
    cacheHit,
    endpoint,
    model: params.client.model,
  };
}
