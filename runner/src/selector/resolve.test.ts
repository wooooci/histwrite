import { describe, expect, it } from "vitest";

import type { SelectorBundle } from "./contract.js";
import { resolveSelector } from "./resolve.js";

describe("resolveSelector (verifyOrReanchor)", () => {
  it("returns position_verified when a correct position hint matches the quote", () => {
    const rawText = "a\r\nb";
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "a\nb" },
      positionHint: { type: "TextPositionHint", layer: "normText", start: 0, end: 3, unit: "utf16_code_unit" },
    };

    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("position_verified");
    expect(r.rawStart).toBe(0);
    expect(r.rawEnd).toBe(rawText.length);
    expect(r.extractedExactRaw).toBe(rawText);
  });

  it("falls back to quote anchoring when position hint is off-by-one", () => {
    const rawText = "a\r\nb";
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "a\nb" },
      positionHint: { type: "TextPositionHint", layer: "normText", start: 0, end: 2, unit: "utf16_code_unit" }, // "a\n"
    };

    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(r.rawStart).toBe(0);
    expect(r.rawEnd).toBe(rawText.length);
    expect(r.extractedExactRaw).toBe(rawText);
  });

  it("returns quote_anchored_ambiguous when quote matches multiple times without disambiguation", () => {
    const rawText = "xx abc yy abc zz";
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "abc" },
    };

    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored_ambiguous");
    expect(r.candidates?.length).toBe(2);
    expect(r.rawStart).toBe(null);
    expect(r.extractedExactRaw).toBe(null);
  });

  it("returns unresolvable when quote does not exist in the target layer", () => {
    const rawText = "hello";
    const selector: SelectorBundle = {
      quote: { type: "TextQuoteSelector", layer: "normText", exact: "world" },
    };

    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("unresolvable");
    expect(r.rawStart).toBe(null);
  });

  it("disambiguates with prefix/suffix when provided", () => {
    const rawText = "xx abc yy abc zz";
    const selector: SelectorBundle = {
      quote: {
        type: "TextQuoteSelector",
        layer: "normText",
        exact: "abc",
        prefix: "yy ",
        suffix: " zz",
      },
    };

    const r = resolveSelector({ rawText, selector });
    expect(r.method).toBe("quote_anchored");
    expect(r.extractedExactRaw).toBe("abc");
  });
});

