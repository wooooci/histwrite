import { describe, expect, it } from "vitest";

import { normalizeV1 } from "./normalize.js";

describe("normalizeV1", () => {
  it("converts CRLF and CR to LF", () => {
    const input = ["a\r\nb", "c\rd", "e\nf", "\r", "\r\n", "g"].join("");
    const out = normalizeV1(input);
    expect(out).toBe("a\nbc\nd" + "e\nf" + "\n" + "\n" + "g");
  });

  it("removes BOM (U+FEFF)", () => {
    expect(normalizeV1("\uFEFFabc")).toBe("abc");
    expect(normalizeV1("a\uFEFFb\uFEFFc")).toBe("abc");
  });

  it("converts NBSP (U+00A0) to space", () => {
    expect(normalizeV1("a\u00A0b")).toBe("a b");
    expect(normalizeV1("\u00A0\u00A0")).toBe("  ");
  });

  it("does not perform unicode normalization (NFC/NFKC)", () => {
    // NFC would convert "e\u0301" to "\u00E9" in many cases.
    const decomposed = "e\u0301";
    expect(normalizeV1(decomposed)).toBe(decomposed);

    // NFKC would convert "①" (circled one) to "1".
    const compat = "①";
    expect(normalizeV1(compat)).toBe(compat);
  });

  it("does not touch other newline-like characters", () => {
    const input = `a\u2028b\u2029c\u0085d`;
    expect(normalizeV1(input)).toBe(input);
  });

  it("is idempotent", () => {
    const input = "\uFEFFa\r\nb\u00A0c\r";
    expect(normalizeV1(normalizeV1(input))).toBe(normalizeV1(input));
  });
});

