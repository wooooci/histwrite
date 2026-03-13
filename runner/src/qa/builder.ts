import fs from "node:fs/promises";
import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import type { MaterialsV2Dataset } from "../artifacts/materials.js";
import type { EvidenceCardsV2Dataset } from "../cards/schema.js";
import type { HistwriteProjectLayout } from "../project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText, parseJsonFromText } from "../openai-compat.js";
import type { OpenAiCompatClient } from "../openai-compat.js";
import { normalizeSelectorBundle, selectorContractVersion } from "../selector/contract.js";

import { buildQaPrompt, buildQaSystem, type QaPromptOutputV1 } from "../prompts/qa.js";
import type { MaterialQADatasetV1, MaterialQaItemV1, QaAnswerType } from "./schema.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${field}: expected string`);
  const s = value.trim();
  if (!s) throw new Error(`invalid ${field}: empty string`);
  return s;
}

function asAnswerType(value: unknown): QaAnswerType {
  if (value === "direct" || value === "inference" || value === "gap") return value;
  throw new Error("invalid answerType: expected direct|inference|gap");
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) if (typeof v === "string" && v.trim()) out.push(v.trim());
  return out.length ? out : undefined;
}

function coerceQaOutput(value: unknown): QaPromptOutputV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error("invalid qa output: expected object");
  const version = obj.version;
  if (version !== 1) throw new Error("invalid qa output: version must be 1");
  const itemsRaw = obj.items;
  if (!Array.isArray(itemsRaw)) throw new Error("invalid qa output: items must be array");

  const items: QaPromptOutputV1["items"] = itemsRaw.map((it, idx) => {
    const rec = asRecord(it);
    if (!rec) throw new Error(`invalid items[${idx}]: expected object`);
    const answerType = asAnswerType(rec.answerType);
    return {
      question: asString(rec.question, `items[${idx}].question`),
      answer: asString(rec.answer, `items[${idx}].answer`),
      answerType,
      useInWriting: typeof rec.useInWriting === "string" && rec.useInWriting.trim() ? rec.useInWriting.trim() : undefined,
      riskFlags: asStringArray(rec.riskFlags),
    };
  });

  return { version: 1, items };
}

function qaIdFromParts(parts: { cardId: string; question: string }): string {
  const h = sha256Hex(stableJsonStringify(parts));
  return `qa_${h.slice(0, 16)}`;
}

async function buildQaForCard(params: {
  layout: HistwriteProjectLayout;
  materials: MaterialsV2Dataset;
  card: EvidenceCardsV2Dataset["cards"][number];
  maxItems: number;
  noCache?: boolean;
  client: OpenAiCompatClient & { endpoint?: "auto" | "chat" | "responses" };
}): Promise<{ items: QaPromptOutputV1["items"]; cacheHit: boolean; endpoint: "chat" | "responses" }> {
  const material = params.materials.materials.find((m) => m.materialId === params.card.materialId);
  if (!material) throw new Error(`qa build: material not found for card ${params.card.cardId}: ${params.card.materialId}`);

  const system = buildQaSystem();
  const prompt = buildQaPrompt({
    materialTitle: material.provenance.title,
    evidenceFact: params.card.fact,
    quoteExact: params.card.selectorBundle.quote.exact,
    quotePrefix: params.card.selectorBundle.quote.prefix,
    quoteSuffix: params.card.selectorBundle.quote.suffix,
    maxItems: params.maxItems,
  });

  const promptVersion = "qa_v1";
  const apiBaseUrlNormalized = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);

  const key = cacheKey({
    taskName: "build_material_qa",
    model: params.client.model,
    promptVersion,
    inputs: {
      apiBaseUrl: apiBaseUrlNormalized,
      endpoint: params.client.endpoint ?? "auto",
      cardId: params.card.cardId,
      materialId: params.card.materialId,
      selector: normalizeSelectorBundle(params.card.selectorBundle),
      systemSha256: sha256Hex(system),
      promptSha256: sha256Hex(prompt),
      maxItems: params.maxItems,
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "qa"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; json?: unknown }>(key);

  if (cached && cached.json) {
    const out = coerceQaOutput(cached.json);
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

  const parsed = coerceQaOutput(parseJsonFromText(generated.text));
  await cache.putJson(key, { v: 1, at: Date.now(), endpoint: generated.endpoint, json: parsed });
  return { items: parsed.items, cacheHit: false, endpoint: generated.endpoint };
}

export type BuildMaterialQaResult = {
  outPath: string;
  cacheHits: number;
  endpoint: "chat" | "responses";
  model: string;
  items: number;
  gaps: number;
};

export async function buildMaterialQaDataset(params: {
  layout: HistwriteProjectLayout;
  materials: MaterialsV2Dataset;
  cards: EvidenceCardsV2Dataset;
  outPath?: string | null;
  cardId?: string | null;
  maxItemsPerCard?: number;
  noCache?: boolean;
  client: OpenAiCompatClient & { endpoint?: "auto" | "chat" | "responses" };
}): Promise<{ dataset: MaterialQADatasetV1; result: BuildMaterialQaResult }> {
  if (params.materials.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `materials selectorContractVersion mismatch: got ${params.materials.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }
  if (params.cards.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `cards selectorContractVersion mismatch: got ${params.cards.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }

  const maxItems = Math.max(1, Math.min(12, params.maxItemsPerCard ?? 6));
  const chosen = params.cardId ? params.cards.cards.filter((c) => c.cardId === params.cardId) : params.cards.cards;
  if (params.cardId && chosen.length === 0) throw new Error(`card not found: ${params.cardId}`);

  const items: MaterialQaItemV1[] = [];
  const gaps: Array<{ cardId: string; materialId: string; reason: string; item: unknown }> = [];
  let cacheHits = 0;
  let endpoint: "chat" | "responses" = "responses";

  for (const card of chosen) {
    try {
      const out = await buildQaForCard({
        layout: params.layout,
        materials: params.materials,
        card,
        maxItems,
        noCache: params.noCache,
        client: params.client,
      });
      endpoint = out.endpoint;
      if (out.cacheHit) cacheHits += 1;

      for (const it of out.items) {
        items.push({
          qaId: qaIdFromParts({ cardId: card.cardId, question: it.question }),
          question: it.question,
          answer: it.answer,
          answerType: it.answerType,
          evidenceRefs: [
            {
              cardId: card.cardId,
              materialId: card.materialId,
              selectorBundle: normalizeSelectorBundle(card.selectorBundle),
            },
          ],
          ...(it.useInWriting ? { useInWriting: it.useInWriting } : {}),
          ...(it.riskFlags ? { riskFlags: it.riskFlags } : {}),
        });
      }
    } catch (err) {
      gaps.push({
        cardId: card.cardId,
        materialId: card.materialId,
        reason: String(err),
        item: { card },
      });
    }
  }

  const dataset: MaterialQADatasetV1 = {
    version: 1,
    createdAt: new Date().toISOString(),
    selectorContractVersion,
    items,
    ...(gaps.length ? { gaps } : {}),
  };

  const outPath = path.resolve(params.outPath ?? path.join(params.layout.artifactsDir, "qa.v1.json"));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  return {
    dataset,
    result: {
      outPath,
      cacheHits,
      endpoint,
      model: params.client.model,
      items: items.length,
      gaps: gaps.length,
    },
  };
}
