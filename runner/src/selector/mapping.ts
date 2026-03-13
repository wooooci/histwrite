import { assertHalfOpenRange } from "./contract.js";

export type TextMappingV1 = {
  version: 1;
  rawText: string;
  normText: string;
  // Boundary offsets (utf16 code units).
  // - rawToNorm.length === rawText.length + 1
  // - rawToNorm[i] is the norm offset after normalizing rawText.slice(0, i)
  rawToNorm: number[];
  // Boundary offsets (utf16 code units).
  // - normToRaw.length === normText.length + 1
  // - normToRaw[i] is a raw offset that corresponds to norm boundary i
  normToRaw: number[];
};

export function buildTextMappingV1(rawText: string): TextMappingV1 {
  const rawLen = rawText.length;

  const rawToNorm = new Array<number>(rawLen + 1);
  rawToNorm[0] = 0;

  const normToRaw: number[] = [0];
  const out: string[] = [];

  let normIndex = 0;
  let i = 0;

  while (i < rawLen) {
    const ch = rawText[i];

    // Remove BOM (U+FEFF)
    if (ch === "\uFEFF") {
      i += 1;
      rawToNorm[i] = normIndex;
      continue;
    }

    // Normalize newlines: CRLF/CR -> LF
    if (ch === "\r") {
      if (i + 1 < rawLen && rawText[i + 1] === "\n") {
        out.push("\n");
        normIndex += 1;
        normToRaw.push(i + 2);

        // raw prefix ending at '\r' and ending at '\r\n' both normalize to the same boundary.
        rawToNorm[i + 1] = normIndex;
        rawToNorm[i + 2] = normIndex;
        i += 2;
        continue;
      }

      out.push("\n");
      normIndex += 1;
      normToRaw.push(i + 1);
      i += 1;
      rawToNorm[i] = normIndex;
      continue;
    }

    // Normalize NBSP to space
    if (ch === "\u00A0") {
      out.push(" ");
      normIndex += 1;
      normToRaw.push(i + 1);
      i += 1;
      rawToNorm[i] = normIndex;
      continue;
    }

    // Default: keep char as-is (including '\n' and all other unicode)
    out.push(ch);
    normIndex += 1;
    normToRaw.push(i + 1);
    i += 1;
    rawToNorm[i] = normIndex;
  }

  const normText = out.join("");

  // If the last raw code units were removed (BOM), ensure the final norm boundary maps to rawLen.
  normToRaw[normText.length] = rawLen;

  return { version: 1, rawText, normText, rawToNorm, normToRaw };
}

export function mapRawRangeToNorm(mapping: TextMappingV1, range: { start: number; end: number }): { start: number; end: number } {
  assertHalfOpenRange({ start: range.start, end: range.end, len: mapping.rawText.length });
  return { start: mapping.rawToNorm[range.start] ?? 0, end: mapping.rawToNorm[range.end] ?? 0 };
}

export function mapNormRangeToRaw(mapping: TextMappingV1, range: { start: number; end: number }): { start: number; end: number } {
  assertHalfOpenRange({ start: range.start, end: range.end, len: mapping.normText.length });
  return { start: mapping.normToRaw[range.start] ?? 0, end: mapping.normToRaw[range.end] ?? 0 };
}

