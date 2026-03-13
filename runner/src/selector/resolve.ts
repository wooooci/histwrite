import type { SelectorBundle, TextLayer, TextPositionHint, TextQuoteSelector } from "./contract.js";
import { assertHalfOpenRange } from "./contract.js";
import { buildTextMappingV1, mapNormRangeToRaw } from "./mapping.js";
import { normalizeV1 } from "./normalize.js";

export type ResolveMethod =
  | "position_verified"
  | "quote_anchored"
  | "quote_anchored_ambiguous"
  | "unresolvable";

export type ResolvedCandidate = {
  rawStart: number;
  rawEnd: number;
  extractedExactRaw: string;
  normStart?: number;
  normEnd?: number;
};

export type ResolvedSpan = {
  rawStart: number | null;
  rawEnd: number | null;
  extractedExactRaw: string | null;
  method: ResolveMethod;
  candidates?: ResolvedCandidate[];
  reason?: string;
};

function layerText(params: { rawText: string; normText: string }, layer: TextLayer): string | null {
  if (layer === "rawText") return params.rawText;
  if (layer === "normText") return params.normText;
  // indexText is defined for Phase B; resolver v1 doesn't accept it as a truth layer.
  return null;
}

function findAllOccurrences(text: string, needle: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(needle, from);
    if (i === -1) break;
    out.push({ start: i, end: i + needle.length });
    from = i + 1; // allow overlaps
  }
  return out;
}

function matchesContext(params: {
  text: string;
  start: number;
  end: number;
  prefix?: string;
  suffix?: string;
}): boolean {
  const { text, start, end } = params;
  const prefix = params.prefix && params.prefix.length ? params.prefix : undefined;
  const suffix = params.suffix && params.suffix.length ? params.suffix : undefined;

  if (prefix) {
    if (start - prefix.length < 0) return false;
    if (text.slice(start - prefix.length, start) !== prefix) return false;
  }
  if (suffix) {
    if (end + suffix.length > text.length) return false;
    if (text.slice(end, end + suffix.length) !== suffix) return false;
  }
  return true;
}

function verifyPositionHint(params: {
  rawText: string;
  normText: string;
  mapping: ReturnType<typeof buildTextMappingV1>;
  quote: TextQuoteSelector;
  positionHint: TextPositionHint;
}): { rawStart: number; rawEnd: number } | null {
  const { rawText, normText, mapping, quote, positionHint } = params;

  const hintLayerText = layerText({ rawText, normText }, positionHint.layer);
  if (!hintLayerText) return null;

  assertHalfOpenRange({ start: positionHint.start, end: positionHint.end, len: hintLayerText.length });

  const hinted = hintLayerText.slice(positionHint.start, positionHint.end);

  if (quote.layer === "normText" && positionHint.layer === "normText") {
    if (hinted !== quote.exact) return null;
    const rawRange = mapNormRangeToRaw(mapping, { start: positionHint.start, end: positionHint.end });
    return { rawStart: rawRange.start, rawEnd: rawRange.end };
  }

  if (quote.layer === "normText" && positionHint.layer === "rawText") {
    if (normalizeV1(hinted) !== quote.exact) return null;
    return { rawStart: positionHint.start, rawEnd: positionHint.end };
  }

  if (quote.layer === "rawText" && positionHint.layer === "rawText") {
    if (hinted !== quote.exact) return null;
    return { rawStart: positionHint.start, rawEnd: positionHint.end };
  }

  if (quote.layer === "rawText" && positionHint.layer === "normText") {
    if (hinted !== normalizeV1(quote.exact)) return null;
    const rawRange = mapNormRangeToRaw(mapping, { start: positionHint.start, end: positionHint.end });
    return { rawStart: rawRange.start, rawEnd: rawRange.end };
  }

  // indexText unsupported in resolver v1.
  return null;
}

export function resolveSelector(params: { rawText: string; selector: SelectorBundle }): ResolvedSpan {
  const rawText = params.rawText;
  const mapping = buildTextMappingV1(rawText);
  const normText = mapping.normText;

  const quote = params.selector.quote;

  if (quote.layer === "indexText") {
    return {
      rawStart: null,
      rawEnd: null,
      extractedExactRaw: null,
      method: "unresolvable",
      reason: "resolveSelector(v1) does not support indexText as a truth layer",
    };
  }

  // 1) Try verifying a position hint first.
  if (params.selector.positionHint) {
    const verified = verifyPositionHint({
      rawText,
      normText,
      mapping,
      quote,
      positionHint: params.selector.positionHint,
    });
    if (verified) {
      return {
        rawStart: verified.rawStart,
        rawEnd: verified.rawEnd,
        extractedExactRaw: rawText.slice(verified.rawStart, verified.rawEnd),
        method: "position_verified",
      };
    }
  }

  // 2) Fall back to quote anchoring (exact + optional prefix/suffix).
  const anchorText = layerText({ rawText, normText }, quote.layer);
  if (!anchorText) {
    return {
      rawStart: null,
      rawEnd: null,
      extractedExactRaw: null,
      method: "unresolvable",
      reason: `resolveSelector(v1) does not support quote.layer=${quote.layer}`,
    };
  }

  const spans = findAllOccurrences(anchorText, quote.exact).filter((s) =>
    matchesContext({
      text: anchorText,
      start: s.start,
      end: s.end,
      prefix: quote.prefix,
      suffix: quote.suffix,
    }),
  );

  if (spans.length === 0) {
    return {
      rawStart: null,
      rawEnd: null,
      extractedExactRaw: null,
      method: "unresolvable",
      reason: "no matches for quote selector",
    };
  }

  const candidates: ResolvedCandidate[] = spans.map(({ start, end }) => {
    if (quote.layer === "rawText") {
      return { rawStart: start, rawEnd: end, extractedExactRaw: rawText.slice(start, end) };
    }

    const rawRange = mapNormRangeToRaw(mapping, { start, end });
    return {
      rawStart: rawRange.start,
      rawEnd: rawRange.end,
      extractedExactRaw: rawText.slice(rawRange.start, rawRange.end),
      normStart: start,
      normEnd: end,
    };
  });

  if (candidates.length > 1) {
    return {
      rawStart: null,
      rawEnd: null,
      extractedExactRaw: null,
      method: "quote_anchored_ambiguous",
      candidates,
      reason: `multiple matches (${candidates.length}); provide prefix/suffix to disambiguate`,
    };
  }

  const chosen = candidates[0];
  return {
    rawStart: chosen?.rawStart ?? null,
    rawEnd: chosen?.rawEnd ?? null,
    extractedExactRaw: chosen?.extractedExactRaw ?? null,
    method: "quote_anchored",
  };
}
