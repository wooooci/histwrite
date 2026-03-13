import fs from "node:fs/promises";
import path from "node:path";

import type { MaterialV2, MaterialsV2Dataset } from "../artifacts/materials.js";
import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion, type SelectorBundle } from "../selector/contract.js";
import { normalizeV1 } from "../selector/normalize.js";
import { resolveSelector, type ResolvedCandidate, type ResolvedSpan } from "../selector/resolve.js";

import type { EvidenceCardV2, EvidenceCardsV2Dataset, EvidenceLevel } from "./schema.js";

type LegacyEvidenceCardInput = {
  cardId: string;
  materialId: string;
  fact: string;
  level?: EvidenceLevel;
  confidence?: number;
  quote: string;
  notes?: string;
};

type MigrationStatus = "ok" | "ambiguous" | "unresolvable";

type MigrationResult = {
  card: EvidenceCardV2;
  status: MigrationStatus;
  gap?: { materialId: string; reason: string; item: unknown };
};

const CONTEXT_WINDOW = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid ${field}: expected string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`invalid ${field}: empty string`);
  return trimmed;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "string") throw new Error(`invalid ${field}: expected string`);
  return value;
}

function asConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function asLevel(value: unknown): EvidenceLevel {
  return value === "inference" ? "inference" : "direct";
}

function findAllOccurrences(text: string, needle: string): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(needle, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    from = index + 1;
  }
  return matches;
}

function buildLegacySelectorBundle(params: { material?: MaterialV2 | null; quote: string }): SelectorBundle {
  const exact = normalizeV1(params.quote);
  const quote = normalizeTextQuoteSelector({
    type: "TextQuoteSelector",
    layer: "normText",
    exact,
  });

  const material = params.material;
  if (!material) {
    return normalizeSelectorBundle({ quote });
  }

  const matches = findAllOccurrences(material.normText, exact);
  if (matches.length !== 1) {
    return normalizeSelectorBundle({ quote });
  }

  const match = matches[0]!;
  const prefix = material.normText.slice(Math.max(0, match.start - CONTEXT_WINDOW), match.start);
  const suffix = material.normText.slice(match.end, Math.min(material.normText.length, match.end + CONTEXT_WINDOW));

  return normalizeSelectorBundle({
    quote: normalizeTextQuoteSelector({
      type: "TextQuoteSelector",
      layer: "normText",
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    }),
    positionHint: {
      type: "TextPositionHint",
      layer: "normText",
      start: match.start,
      end: match.end,
      unit: "utf16_code_unit",
    },
  });
}

function coerceResolvedCandidate(value: unknown, field: string): ResolvedCandidate {
  if (!isRecord(value)) throw new Error(`invalid ${field}: expected object`);

  const rawStart = value.rawStart;
  const rawEnd = value.rawEnd;
  const extractedExactRaw = value.extractedExactRaw;

  if (typeof rawStart !== "number" || !Number.isInteger(rawStart)) {
    throw new Error(`invalid ${field}.rawStart: expected integer`);
  }
  if (typeof rawEnd !== "number" || !Number.isInteger(rawEnd)) {
    throw new Error(`invalid ${field}.rawEnd: expected integer`);
  }
  if (typeof extractedExactRaw !== "string") {
    throw new Error(`invalid ${field}.extractedExactRaw: expected string`);
  }

  const out: ResolvedCandidate = { rawStart, rawEnd, extractedExactRaw };
  if (typeof value.normStart === "number") out.normStart = value.normStart;
  if (typeof value.normEnd === "number") out.normEnd = value.normEnd;
  return out;
}

function coerceResolvedSpan(value: unknown, field: string): ResolvedSpan {
  if (!isRecord(value)) throw new Error(`invalid ${field}: expected object`);
  const method = value.method;
  if (
    method !== "position_verified" &&
    method !== "quote_anchored" &&
    method !== "quote_anchored_ambiguous" &&
    method !== "unresolvable"
  ) {
    throw new Error(`invalid ${field}.method`);
  }

  const rawStart = value.rawStart;
  const rawEnd = value.rawEnd;
  const extractedExactRaw = value.extractedExactRaw;
  if (rawStart !== null && (typeof rawStart !== "number" || !Number.isInteger(rawStart))) {
    throw new Error(`invalid ${field}.rawStart`);
  }
  if (rawEnd !== null && (typeof rawEnd !== "number" || !Number.isInteger(rawEnd))) {
    throw new Error(`invalid ${field}.rawEnd`);
  }
  if (extractedExactRaw !== null && typeof extractedExactRaw !== "string") {
    throw new Error(`invalid ${field}.extractedExactRaw`);
  }

  return {
    rawStart: rawStart === null ? null : rawStart,
    rawEnd: rawEnd === null ? null : rawEnd,
    extractedExactRaw: extractedExactRaw === null ? null : extractedExactRaw,
    method,
    ...(Array.isArray(value.candidates)
      ? { candidates: value.candidates.map((candidate, index) => coerceResolvedCandidate(candidate, `${field}.candidates[${index}]`)) }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

function coerceV2Card(value: unknown, field: string): EvidenceCardV2 {
  if (!isRecord(value)) throw new Error(`invalid ${field}: expected object`);
  return {
    cardId: asString(value.cardId, `${field}.cardId`),
    materialId: asString(value.materialId, `${field}.materialId`),
    fact: asString(value.fact, `${field}.fact`),
    level: asLevel(value.level),
    confidence: asConfidence(value.confidence),
    selectorBundle: normalizeSelectorBundle(value.selectorBundle),
    resolvedSpan: coerceResolvedSpan(value.resolvedSpan, `${field}.resolvedSpan`),
    ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
  };
}

function isV2CardLike(value: unknown): boolean {
  return isRecord(value) && "selectorBundle" in value && "resolvedSpan" in value;
}

function coerceLegacyCardInput(value: unknown, field: string): LegacyEvidenceCardInput {
  if (!isRecord(value)) throw new Error(`invalid ${field}: expected object`);
  return {
    cardId: asString(value.cardId, `${field}.cardId`),
    materialId: asString(value.materialId, `${field}.materialId`),
    fact: asString(value.fact, `${field}.fact`),
    level: asLevel(value.level),
    confidence: asConfidence(value.confidence),
    quote: asString(value.quote, `${field}.quote`),
    ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
  };
}

function migrationGap(params: {
  status: Exclude<MigrationStatus, "ok">;
  materialId: string;
  resolvedSpan: ResolvedSpan;
  item: unknown;
}): { materialId: string; reason: string; item: unknown } {
  const prefix = params.status === "ambiguous" ? "legacy quote migration ambiguous" : "legacy quote migration unresolvable";
  return {
    materialId: params.materialId,
    reason: `${prefix}: ${params.resolvedSpan.reason ?? params.resolvedSpan.method}`,
    item: params.item,
  };
}

export function migrateLegacyEvidenceCard(params: {
  card: unknown;
  material?: MaterialV2 | null;
}): MigrationResult {
  const legacy = coerceLegacyCardInput(params.card, "legacyCard");
  const selectorBundle = buildLegacySelectorBundle({ material: params.material, quote: legacy.quote });
  const resolvedSpan = params.material
    ? resolveSelector({ rawText: params.material.rawText, selector: selectorBundle })
    : {
        rawStart: null,
        rawEnd: null,
        extractedExactRaw: null,
        method: "unresolvable" as const,
        reason: `missing material for legacy card migration: ${legacy.materialId}`,
      };

  const nextCard: EvidenceCardV2 = {
    cardId: legacy.cardId,
    materialId: legacy.materialId,
    fact: legacy.fact,
    level: legacy.level ?? "direct",
    confidence: legacy.confidence ?? 0.6,
    selectorBundle,
    resolvedSpan,
    ...(legacy.notes ? { notes: legacy.notes } : {}),
  };

  if (resolvedSpan.method === "quote_anchored_ambiguous") {
    return {
      card: nextCard,
      status: "ambiguous",
      gap: migrationGap({
        status: "ambiguous",
        materialId: legacy.materialId,
        resolvedSpan,
        item: params.card,
      }),
    };
  }

  if (resolvedSpan.method === "unresolvable") {
    return {
      card: nextCard,
      status: "unresolvable",
      gap: migrationGap({
        status: "unresolvable",
        materialId: legacy.materialId,
        resolvedSpan,
        item: params.card,
      }),
    };
  }

  return { card: nextCard, status: "ok" };
}

function cardsNeedMigration(input: unknown): boolean {
  if (!isRecord(input)) return false;
  if (!Array.isArray(input.cards)) return false;
  return input.cards.some((card) => !isV2CardLike(card));
}

export function coerceEvidenceCardsV2Dataset(params: {
  input: unknown;
  materials?: MaterialsV2Dataset | null;
}): EvidenceCardsV2Dataset {
  if (!isRecord(params.input)) throw new Error("invalid cards dataset: expected object");
  if (!Array.isArray(params.input.cards)) throw new Error("invalid cards dataset: cards must be array");

  const needsMigration = cardsNeedMigration(params.input);
  if (needsMigration && !params.materials) {
    throw new Error("legacy cards dataset requires materials.v2.json for migration");
  }

  const materialsById = new Map((params.materials?.materials ?? []).map((material) => [material.materialId, material] as const));
  const gaps = Array.isArray(params.input.gaps) ? [...params.input.gaps] : [];
  const cards = params.input.cards.map((card, index) => {
    if (isV2CardLike(card)) {
      return coerceV2Card(card, `cards[${index}]`);
    }

    const legacy = coerceLegacyCardInput(card, `cards[${index}]`);
    const migrated = migrateLegacyEvidenceCard({
      card: legacy,
      material: materialsById.get(legacy.materialId) ?? null,
    });
    if (migrated.gap) gaps.push(migrated.gap);
    return migrated.card;
  });

  const createdAt = typeof params.input.createdAt === "string" && params.input.createdAt.trim()
    ? params.input.createdAt
    : new Date().toISOString();

  const datasetSelectorContractVersion =
    needsMigration || typeof params.input.selectorContractVersion !== "number"
      ? selectorContractVersion
      : params.input.selectorContractVersion;

  return {
    version: 2,
    createdAt,
    selectorContractVersion: datasetSelectorContractVersion,
    cards,
    ...(gaps.length ? { gaps } : {}),
  };
}

export async function readEvidenceCardsDataset(params: {
  cardsPath: string;
  materials?: MaterialsV2Dataset | null;
  materialsPath?: string | null;
}): Promise<EvidenceCardsV2Dataset> {
  const cardsPath = path.resolve(params.cardsPath);
  const raw = JSON.parse(await fs.readFile(cardsPath, "utf8")) as unknown;

  if (!cardsNeedMigration(raw)) {
    return coerceEvidenceCardsV2Dataset({ input: raw });
  }

  let materials = params.materials ?? null;
  if (!materials && params.materialsPath) {
    const materialsPath = path.resolve(params.materialsPath);
    try {
      materials = JSON.parse(await fs.readFile(materialsPath, "utf8")) as MaterialsV2Dataset;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`legacy cards dataset requires materials.v2.json for migration: ${materialsPath}`);
      }
      throw error;
    }
  }

  return coerceEvidenceCardsV2Dataset({ input: raw, materials });
}
