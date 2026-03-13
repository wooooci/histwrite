import fs from "node:fs/promises";
import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import type { MaterialV2, MaterialsV2Dataset } from "../artifacts/materials.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText, parseJsonFromText } from "../openai-compat.js";
import type { OpenAiCompatClient } from "../openai-compat.js";
import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";

import { buildInterpretPrompt, buildInterpretSystem, type InterpretPromptOutputV1 } from "../prompts/interpret.js";
import type { EvidenceCardV2, EvidenceCardsV2Dataset, EvidenceLevel } from "./schema.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${field}: expected string`);
  const s = value.trim();
  if (!s) throw new Error(`invalid ${field}: empty string`);
  return s;
}

function asLevel(value: unknown): EvidenceLevel {
  if (value === "direct" || value === "inference") return value;
  throw new Error("invalid level: expected direct|inference");
}

function asConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function coerceInterpretOutput(value: unknown): InterpretPromptOutputV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error("invalid interpret output: expected object");
  const version = obj.version;
  if (version !== 1) throw new Error("invalid interpret output: version must be 1");
  const itemsRaw = obj.items;
  if (!Array.isArray(itemsRaw)) throw new Error("invalid interpret output: items must be array");

  const items: InterpretPromptOutputV1["items"] = itemsRaw.map((it, idx) => {
    const rec = asRecord(it);
    if (!rec) throw new Error(`invalid items[${idx}]: expected object`);
    const quoteRec = asRecord(rec.quote);
    if (!quoteRec) throw new Error(`invalid items[${idx}].quote: expected object`);
    const exact = asString(quoteRec.exact, `items[${idx}].quote.exact`);
    const prefix = typeof quoteRec.prefix === "string" ? quoteRec.prefix : undefined;
    const suffix = typeof quoteRec.suffix === "string" ? quoteRec.suffix : undefined;
    return {
      fact: asString(rec.fact, `items[${idx}].fact`),
      level: asLevel(rec.level),
      confidence: asConfidence(rec.confidence),
      quote: { exact, prefix, suffix },
      notes: typeof rec.notes === "string" ? rec.notes : undefined,
    };
  });

  return { version: 1, items };
}

function cardIdFromParts(parts: { materialId: string; fact: string; exact: string; prefix?: string; suffix?: string }): string {
  const h = sha256Hex(stableJsonStringify(parts));
  return `ev_${h.slice(0, 16)}`;
}

async function interpretOneMaterial(params: {
  layout: HistwriteProjectLayout;
  material: MaterialV2;
  maxItems: number;
  noCache?: boolean;
  client: OpenAiCompatClient & { endpoint?: "auto" | "chat" | "responses" };
}): Promise<{ items: InterpretPromptOutputV1["items"]; cacheHit: boolean; endpoint: "chat" | "responses" }> {
  const system = buildInterpretSystem();
  const prompt = buildInterpretPrompt({
    materialTitle: params.material.provenance.title,
    normText: params.material.normText,
    maxItems: params.maxItems,
  });

  const promptVersion = "interpret_v1";
  const apiBaseUrlNormalized = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);

  const key = cacheKey({
    taskName: "interpret_materials",
    model: params.client.model,
    promptVersion,
    inputs: {
      apiBaseUrl: apiBaseUrlNormalized,
      endpoint: params.client.endpoint ?? "auto",
      materialId: params.material.materialId,
      rawSha256: sha256Hex(Buffer.from(params.material.rawText, "utf8")),
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
      maxItems: params.maxItems,
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "interpret"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; json?: unknown }>(key);

  if (cached && cached.json) {
    const out = coerceInterpretOutput(cached.json);
    return {
      items: out.items,
      cacheHit: true,
      endpoint: cached.endpoint === "chat" ? "chat" : "responses",
    };
  }

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

  const parsed = coerceInterpretOutput(parseJsonFromText(generated.text));
  await cache.putJson(key, { v: 1, at: Date.now(), endpoint: generated.endpoint, json: parsed });
  return { items: parsed.items, cacheHit: false, endpoint: generated.endpoint };
}

export type InterpretMaterialsResult = {
  outPath: string;
  cacheHits: number;
  endpoint: "chat" | "responses";
  model: string;
  cards: number;
  gaps: number;
};

export async function interpretMaterialsToEvidenceCards(params: {
  layout: HistwriteProjectLayout;
  materials: MaterialsV2Dataset;
  outPath?: string | null;
  materialId?: string | null;
  maxItemsPerMaterial?: number;
  noCache?: boolean;
  client: OpenAiCompatClient & { endpoint?: "auto" | "chat" | "responses" };
}): Promise<{ dataset: EvidenceCardsV2Dataset; result: InterpretMaterialsResult }> {
  if (params.materials.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `materials selectorContractVersion mismatch: got ${params.materials.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }

  const maxItems = Math.max(1, Math.min(24, params.maxItemsPerMaterial ?? 6));
  const chosen = params.materialId
    ? params.materials.materials.filter((m) => m.materialId === params.materialId)
    : params.materials.materials;

  if (params.materialId && chosen.length === 0) {
    throw new Error(`material not found: ${params.materialId}`);
  }

  const cards: EvidenceCardV2[] = [];
  const gaps: Array<{ materialId: string; reason: string; item: unknown }> = [];
  let cacheHits = 0;
  let endpoint: "chat" | "responses" = "responses";

  for (const material of chosen) {
    const out = await interpretOneMaterial({
      layout: params.layout,
      material,
      maxItems,
      noCache: params.noCache,
      client: params.client,
    });
    endpoint = out.endpoint;
    if (out.cacheHit) cacheHits += 1;

    for (const item of out.items) {
      const quote = normalizeTextQuoteSelector({
        type: "TextQuoteSelector",
        layer: "normText",
        exact: item.quote.exact,
        prefix: item.quote.prefix,
        suffix: item.quote.suffix,
      });
      const selectorBundle = normalizeSelectorBundle({ quote });
      const resolvedSpan = resolveSelector({ rawText: material.rawText, selector: selectorBundle });

      if (resolvedSpan.method === "unresolvable") {
        gaps.push({
          materialId: material.materialId,
          reason: resolvedSpan.reason ?? "unresolvable",
          item,
        });
        continue;
      }

      cards.push({
        cardId: cardIdFromParts({
          materialId: material.materialId,
          fact: item.fact,
          exact: item.quote.exact,
          prefix: item.quote.prefix,
          suffix: item.quote.suffix,
        }),
        materialId: material.materialId,
        fact: item.fact,
        level: item.level,
        confidence: item.confidence,
        selectorBundle,
        resolvedSpan,
        ...(item.notes ? { notes: item.notes } : {}),
      });
    }
  }

  const dataset: EvidenceCardsV2Dataset = {
    version: 2,
    createdAt: new Date().toISOString(),
    selectorContractVersion,
    cards,
    ...(gaps.length ? { gaps } : {}),
  };

  const outPath = path.resolve(params.outPath ?? path.join(params.layout.artifactsDir, "cards.v2.json"));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  return {
    dataset,
    result: {
      outPath,
      cacheHits,
      endpoint,
      model: params.client.model,
      cards: cards.length,
      gaps: gaps.length,
    },
  };
}
