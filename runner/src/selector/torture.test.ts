import { describe, expect, it } from "vitest";

import type { SelectorBundle } from "./contract.js";
import { resolveSelector } from "./resolve.js";
import { normalizeV1 } from "./normalize.js";

describe("selector unicode torture", () => {
  it("anchors non-BMP chars (surrogate pairs) safely", () => {
    const rawText = `pre😀post`;
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "😀" },
    };
    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(normalizeV1(r.extractedExactRaw ?? "")).toBe("😀");
  });

  it("anchors ZWJ sequences safely", () => {
    const rawText = `a👩‍💻b`;
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "👩‍💻" },
    };
    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(normalizeV1(r.extractedExactRaw ?? "")).toBe("👩‍💻");
  });

  it("does not alter combining sequences and can anchor them", () => {
    const rawText = `cafe\u0301`; // "café" in decomposed form
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "e\u0301" },
    };
    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(normalizeV1(r.extractedExactRaw ?? "")).toBe("e\u0301");
  });

  it("anchors spans that cross CRLF/NBSP normalization boundaries", () => {
    const rawText = `a\r\n😀\u00A0b`;
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: `\n😀 b` },
    };
    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(normalizeV1(r.extractedExactRaw ?? "")).toBe(`\n😀 b`);
  });

  it("treats bidi / zero-width characters as ordinary code units", () => {
    const rawText = `a\u200Fb\u200E\u200Bc`; // RLM + LRM + ZWSP
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: `b\u200E\u200B` },
    };
    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(normalizeV1(r.extractedExactRaw ?? "")).toBe(`b\u200E\u200B`);
  });
});

