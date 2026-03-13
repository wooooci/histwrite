import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import type { ClaimMapV1 } from "../artifacts/claims.js";
import type { FactCheckReportV1 } from "./schema.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText, parseJsonFromText } from "../openai-compat.js";
import { buildFactCheckJudgePrompt, buildFactCheckJudgeSystem, type FactCheckJudgePromptItem } from "../prompts/factcheck-judge.js";

export type FactCheckJudgeAction = "keep" | "downgrade" | "add_contested";
export type FactCheckJudgeBaseStatus = "inference_ok" | "contested";

export type FactCheckJudgeItemV1 = {
  claimId: string;
  baseStatus: FactCheckJudgeBaseStatus;
  needsCounterExplanation: boolean;
  toneOverclaim: boolean;
  recommendedAction: FactCheckJudgeAction;
  reason: string;
};

export type FactCheckJudgeReportV1 = {
  version: 1;
  createdAt: string;
  items: FactCheckJudgeItemV1[];
};

export type FactCheckJudgeRunOutput = FactCheckJudgeReportV1 & {
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
};

const allowedActions = new Set<FactCheckJudgeAction>(["keep", "downgrade", "add_contested"]);

function collectPendingClaims(params: {
  claims: ClaimMapV1;
  report: FactCheckReportV1;
}): FactCheckJudgePromptItem[] {
  const claimTexts = new Map(params.claims.claims.map((claim) => [claim.claimId, claim.text] as const));
  const pending: FactCheckJudgePromptItem[] = [];

  for (const item of params.report.items) {
    if (item.status !== "inference_ok" && item.status !== "contested") continue;
    const text = claimTexts.get(item.claimId);
    if (!text) {
      throw new Error(`factcheck judge requires claim text for ${item.claimId}`);
    }
    pending.push({
      claimId: item.claimId,
      baseStatus: item.status,
      text,
    });
  }

  return pending;
}

function parseJudgeItems(raw: unknown, pending: FactCheckJudgePromptItem[]): FactCheckJudgeItemV1[] {
  const items = Array.isArray((raw as { items?: unknown[] } | null | undefined)?.items)
    ? (((raw as { items: unknown[] }).items) as unknown[])
    : null;
  if (!items) throw new Error("factcheck judge returned invalid JSON: missing items[]");

  const pendingById = new Map(pending.map((item) => [item.claimId, item] as const));
  const seen = new Set<string>();
  const normalized: FactCheckJudgeItemV1[] = [];

  for (const entry of items) {
    if (!entry || typeof entry !== "object") throw new Error("factcheck judge returned invalid item");
    const claimId = typeof (entry as { claimId?: unknown }).claimId === "string" ? (entry as { claimId: string }).claimId.trim() : "";
    if (!claimId) throw new Error("factcheck judge returned item without claimId");
    if (seen.has(claimId)) throw new Error(`factcheck judge returned duplicate claimId: ${claimId}`);
    const pendingItem = pendingById.get(claimId);
    if (!pendingItem) throw new Error(`claimId ${claimId} is outside the pending factcheck judge set`);

    const baseStatus = typeof (entry as { baseStatus?: unknown }).baseStatus === "string" ? (entry as { baseStatus: string }).baseStatus.trim() : "";
    if (baseStatus !== pendingItem.baseStatus) {
      throw new Error(`factcheck judge baseStatus mismatch for ${claimId}: got ${baseStatus}, expected ${pendingItem.baseStatus}`);
    }

    const recommendedAction =
      typeof (entry as { recommendedAction?: unknown }).recommendedAction === "string"
        ? (entry as { recommendedAction: string }).recommendedAction.trim()
        : "";
    if (!allowedActions.has(recommendedAction as FactCheckJudgeAction)) {
      throw new Error(`factcheck judge returned invalid recommendedAction for ${claimId}: ${recommendedAction}`);
    }

    const reason = typeof (entry as { reason?: unknown }).reason === "string" ? (entry as { reason: string }).reason.trim() : "";
    if (!reason) throw new Error(`factcheck judge returned empty reason for ${claimId}`);

    normalized.push({
      claimId,
      baseStatus: pendingItem.baseStatus,
      needsCounterExplanation: Boolean((entry as { needsCounterExplanation?: unknown }).needsCounterExplanation),
      toneOverclaim: Boolean((entry as { toneOverclaim?: unknown }).toneOverclaim),
      recommendedAction: recommendedAction as FactCheckJudgeAction,
      reason,
    });
    seen.add(claimId);
  }

  for (const item of pending) {
    if (!seen.has(item.claimId)) {
      throw new Error(`factcheck judge omitted pending claimId: ${item.claimId}`);
    }
  }

  normalized.sort(
    (left, right) => pending.findIndex((item) => item.claimId === left.claimId) - pending.findIndex((item) => item.claimId === right.claimId),
  );
  return normalized;
}

export async function runFactCheckJudge(params: {
  layout: HistwriteProjectLayout;
  claims: ClaimMapV1;
  report: FactCheckReportV1;
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
}): Promise<FactCheckJudgeRunOutput> {
  const pending = collectPendingClaims({ claims: params.claims, report: params.report });
  if (pending.length === 0) {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      items: [],
      cacheHit: false,
      endpoint: "responses",
      model: params.client.model,
    };
  }

  const system = buildFactCheckJudgeSystem();
  const prompt = buildFactCheckJudgePrompt({ items: pending });
  const apiBaseUrl = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const key = cacheKey({
    taskName: "factcheck_judge",
    model: params.client.model,
    promptVersion: "factcheck_judge_v1",
    inputs: {
      apiBaseUrl,
      endpoint: params.client.endpoint ?? "auto",
      pendingSha256: sha256Hex(stableJsonStringify(pending)),
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "factcheck-judge"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; items?: unknown }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "responses";
  let items: FactCheckJudgeItemV1[];

  if (cached) {
    cacheHit = true;
    endpoint = cached.endpoint === "chat" ? "chat" : "responses";
    items = parseJudgeItems({ items: cached.items }, pending);
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
    endpoint = generated.endpoint;
    items = parseJudgeItems(parseJsonFromText(generated.text), pending);
    await cache.putJson(key, { version: 1, endpoint, items });
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    items,
    cacheHit,
    endpoint,
    model: params.client.model,
  };
}
