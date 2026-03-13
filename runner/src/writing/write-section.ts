import fs from "node:fs/promises";
import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import { parseClaimAnchors } from "../claims/parse.js";
import type { SectionPackV1 } from "../packs/schema.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText } from "../openai-compat.js";

import { buildWriteSectionPrompt, buildWriteSectionSystem } from "../prompts/write.js";

function allowedEvidenceRefs(pack: SectionPackV1): Set<string> {
  const refs = new Set<string>();
  for (const card of pack.cards) {
    for (const evidenceId of card.selectedEvidenceIds) {
      refs.add(`${card.cardId}:${evidenceId}`);
    }
  }
  return refs;
}

export type WriteSectionDraftResult = {
  outPath: string;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
  claims: number;
  outputChars: number;
};

export async function writeSectionDraft(params: {
  layout: HistwriteProjectLayout;
  pack: SectionPackV1;
  outPath: string;
  instruction?: string | null;
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
}): Promise<WriteSectionDraftResult> {
  const outAbs = path.resolve(params.outPath);
  const system = buildWriteSectionSystem();
  const prompt = buildWriteSectionPrompt({ pack: params.pack, instruction: params.instruction ?? null });

  const promptVersion = "write_section_v1";
  const apiBaseUrlNormalized = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const key = cacheKey({
    taskName: "write_section",
    model: params.client.model,
    promptVersion,
    inputs: {
      apiBaseUrl: apiBaseUrlNormalized,
      endpoint: params.client.endpoint ?? "auto",
      packSha256: sha256Hex(stableJsonStringify(params.pack)),
      instructionSha256: params.instruction ? sha256Hex(params.instruction) : "",
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "write-section"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; text?: unknown }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "responses";
  let output = "";

  if (cached && typeof cached.text === "string") {
    cacheHit = true;
    output = cached.text;
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
    output = generated.text;
    endpoint = generated.endpoint;
  }

  const claims = parseClaimAnchors(output);
  if (params.pack.cards.length > 0 && claims.length === 0) {
    throw new Error("writer output must include at least one claim anchor when pack has evidence");
  }

  const allowedRefs = allowedEvidenceRefs(params.pack);
  for (const claim of claims) {
    for (const ref of claim.evidenceRefs) {
      const token = `${ref.cardId}:${ref.evidenceId}`;
      if (!allowedRefs.has(token)) {
        throw new Error(`writer referenced evidence outside the pack: ${token}`);
      }
    }
  }

  if (!cacheHit) {
    await cache.putJson(key, { v: 1, at: Date.now(), endpoint, text: output });
  }

  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, `${output.trim()}\n`, "utf8");

  return {
    outPath: outAbs,
    cacheHit,
    endpoint,
    model: params.client.model,
    claims: claims.length,
    outputChars: output.length,
  };
}
