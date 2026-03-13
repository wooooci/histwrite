import { describe, expect, it } from "vitest";

import {
  assertHalfOpenRange,
  normalizeSelectorBundle,
  normalizeTextQuoteSelector,
  sliceByUtf16,
} from "./contract.js";

describe("selector contract", () => {
  it("treats ranges as half-open [start,end) for utf16 slicing", () => {
    expect(sliceByUtf16("abcd", { start: 0, end: 0 })).toBe("");
    expect(sliceByUtf16("abcd", { start: 0, end: 1 })).toBe("a");
    expect(sliceByUtf16("abcd", { start: 1, end: 4 })).toBe("bcd");

    expect(() => assertHalfOpenRange({ start: 2, end: 1 })).toThrow(/half-open/i);
    expect(() => sliceByUtf16("abcd", { start: 0, end: 5 })).toThrow(/<= len/i);
  });

  it("defaults TextQuoteSelector.layer to normText", () => {
    const s = normalizeTextQuoteSelector({ exact: "hello" });
    expect(s.layer).toBe("normText");
  });

  it("requires selector bundles to carry a quote selector (cross-component truth)", () => {
    const b = normalizeSelectorBundle({ quote: { exact: "x" } });
    expect(b.quote.type).toBe("TextQuoteSelector");

    expect(() => normalizeSelectorBundle({ positionHint: { start: 0, end: 1, layer: "rawText" } })).toThrow(/missing quote/i);
  });
});

