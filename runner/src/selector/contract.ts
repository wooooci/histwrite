export const selectorContractVersion = 1 as const;

export type TextLayer = "rawText" | "normText" | "indexText";
export type OffsetUnit = "utf16_code_unit";

export type TextQuoteSelector = {
  type: "TextQuoteSelector";
  layer: TextLayer;
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type TextPositionHint = {
  type: "TextPositionHint";
  layer: TextLayer;
  start: number;
  end: number;
  unit: OffsetUnit;
};

export type SelectorBundle = {
  quote: TextQuoteSelector;
  positionHint?: TextPositionHint;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${field}: expected non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === "undefined") return undefined;
  if (typeof value === "string") return value;
  throw new Error("invalid optional string: expected string or undefined");
}

export function assertHalfOpenRange(params: { start: number; end: number; len?: number }): void {
  const { start, end, len } = params;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error("invalid range: start/end must be integers (utf16 code units)");
  }
  if (start < 0) throw new Error("invalid range: start must be >= 0");
  if (end < start) throw new Error("invalid range: end must be >= start (half-open [start,end))");
  if (typeof len === "number") {
    if (!Number.isInteger(len) || len < 0) throw new Error("invalid range: len must be a non-negative integer");
    if (end > len) throw new Error("invalid range: end must be <= len (half-open [start,end))");
  }
}

export function sliceByUtf16(text: string, params: { start: number; end: number }): string {
  assertHalfOpenRange({ start: params.start, end: params.end, len: text.length });
  return text.slice(params.start, params.end);
}

export function normalizeTextQuoteSelector(input: unknown): TextQuoteSelector {
  if (!isRecord(input)) throw new Error("invalid TextQuoteSelector: expected object");
  const type = (input.type ?? "TextQuoteSelector") as unknown;
  if (type !== "TextQuoteSelector") throw new Error("invalid TextQuoteSelector: type mismatch");

  const layer = (input.layer ?? "normText") as unknown;
  if (layer !== "rawText" && layer !== "normText" && layer !== "indexText") {
    throw new Error("invalid TextQuoteSelector.layer");
  }

  return {
    type: "TextQuoteSelector",
    layer,
    exact: asNonEmptyString(input.exact, "TextQuoteSelector.exact"),
    prefix: asOptionalString(input.prefix),
    suffix: asOptionalString(input.suffix),
  };
}

export function normalizeTextPositionHint(input: unknown): TextPositionHint {
  if (!isRecord(input)) throw new Error("invalid TextPositionHint: expected object");
  const type = (input.type ?? "TextPositionHint") as unknown;
  if (type !== "TextPositionHint") throw new Error("invalid TextPositionHint: type mismatch");

  const layer = input.layer as unknown;
  if (layer !== "rawText" && layer !== "normText" && layer !== "indexText") {
    throw new Error("invalid TextPositionHint.layer");
  }

  const unit = (input.unit ?? "utf16_code_unit") as unknown;
  if (unit !== "utf16_code_unit") throw new Error("invalid TextPositionHint.unit");

  const start = input.start as unknown;
  const end = input.end as unknown;
  if (typeof start !== "number" || typeof end !== "number") {
    throw new Error("invalid TextPositionHint.start/end: expected numbers");
  }
  assertHalfOpenRange({ start, end });

  return { type: "TextPositionHint", layer, unit, start, end };
}

export function normalizeSelectorBundle(input: unknown): SelectorBundle {
  if (!isRecord(input)) throw new Error("invalid SelectorBundle: expected object");
  if (!("quote" in input)) throw new Error("invalid SelectorBundle: missing quote selector");
  const quote = normalizeTextQuoteSelector(input.quote);

  const positionHint = typeof input.positionHint === "undefined" ? undefined : normalizeTextPositionHint(input.positionHint);
  return { quote, positionHint };
}

