import { describe, expect, it } from "vitest";

import { normalizeV1 } from "./normalize.js";
import { buildTextMappingV1, mapNormRangeToRaw, mapRawRangeToNorm } from "./mapping.js";

function expectNonDecreasing(name: string, xs: number[]): void {
  for (let i = 1; i < xs.length; i += 1) {
    expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
  }
  // Helpful for debugging failures.
  expect(xs[0]).toBeGreaterThanOrEqual(0);
  expect(xs[xs.length - 1]).toBeGreaterThanOrEqual(0);
  expect(name).toBeTruthy();
}

describe("mappingV1 (norm↔raw)", () => {
  it("builds the same normText as normalizeV1", () => {
    const raw = "\uFEFFa\r\nb\rc\u00A0d";
    const m = buildTextMappingV1(raw);
    expect(m.normText).toBe(normalizeV1(raw));
    expect(m.normText).toBe("a\nb\nc d");
  });

  it("produces monotonic boundary maps and consistent 0/len boundaries", () => {
    const raw = "x\r\ny\uFEFFz\u00A0w\r";
    const m = buildTextMappingV1(raw);

    expect(m.rawToNorm.length).toBe(raw.length + 1);
    expect(m.normToRaw.length).toBe(m.normText.length + 1);

    expect(m.rawToNorm[0]).toBe(0);
    expect(m.rawToNorm[raw.length]).toBe(m.normText.length);
    expect(m.normToRaw[0]).toBe(0);
    expect(m.normToRaw[m.normText.length]).toBe(raw.length);

    expectNonDecreasing("rawToNorm", m.rawToNorm);
    expectNonDecreasing("normToRaw", m.normToRaw);

    // Invariant: mapping norm boundary -> raw boundary -> norm boundary yields identity.
    for (let n = 0; n <= m.normText.length; n += 1) {
      expect(m.rawToNorm[m.normToRaw[n] ?? 0]).toBe(n);
    }
  });

  it("supports quote-level round-trip: norm span can be re-extracted from raw slice", () => {
    const raw = "\uFEFFa\r\nb\rc\u00A0d";
    const m = buildTextMappingV1(raw);
    const norm = m.normText;
    const wanted = norm.slice(2, 6); // "b\nc "

    const rawRange = mapNormRangeToRaw(m, { start: 2, end: 6 });
    const rawSlice = raw.slice(rawRange.start, rawRange.end);
    expect(normalizeV1(rawSlice)).toBe(wanted);

    const normRange2 = mapRawRangeToNorm(m, { start: rawRange.start, end: rawRange.end });
    expect(norm.slice(normRange2.start, normRange2.end)).toBe(wanted);
  });

  it("maps end boundary to rawLen even when trailing BOMs are removed", () => {
    const raw = "a\uFEFF\uFEFF";
    const m = buildTextMappingV1(raw);
    expect(m.normText).toBe("a");
    expect(m.normToRaw[m.normText.length]).toBe(raw.length);

    const rawRange = mapNormRangeToRaw(m, { start: 0, end: 1 });
    expect(normalizeV1(raw.slice(rawRange.start, rawRange.end))).toBe("a");
  });
});

