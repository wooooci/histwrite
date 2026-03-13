import { describe, expect, it } from "vitest";

import type { SelectorBundle } from "./contract.js";
import { resolveSelector } from "./resolve.js";
import { buildTextMappingV1 } from "./mapping.js";
import { normalizeV1 } from "./normalize.js";

function xorshift32(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  };
}

function randInt(rng: () => number, maxExclusive: number): number {
  return rng() % maxExclusive;
}

function sample<T>(rng: () => number, xs: T[]): T {
  return xs[randInt(rng, xs.length)]!;
}

describe("selector deterministic fuzz", () => {
  it("round-trips random norm spans back to raw via resolver", () => {
    const rng = xorshift32(0xc0d3a411); // fixed seed

    const tokens = [
      "a",
      "b",
      "c",
      " ",
      "\n",
      "\r",
      "\r\n",
      "\uFEFF",
      "\u00A0",
      "中",
      "文",
      "①",
      "😀",
      "👩‍💻",
      "e\u0301",
      "✌️",
      "\u200E",
      "\u200B",
    ];

    const cases = 200;
    for (let t = 0; t < cases; t += 1) {
      const parts: string[] = [];
      const n = 80 + randInt(rng, 120);
      for (let i = 0; i < n; i += 1) parts.push(sample(rng, tokens));
      const rawText = parts.join("");

      const mapping = buildTextMappingV1(rawText);
      const normText = mapping.normText;
      if (normText.length === 0) continue;

      const start = randInt(rng, Math.max(1, normText.length));
      const maxLen = Math.min(24, normText.length - start);
      const spanLen = Math.max(1, 1 + randInt(rng, Math.max(1, maxLen)));
      const end = start + spanLen;
      const exact = normText.slice(start, end);

      const prefixLen = Math.min(start, 1 + randInt(rng, 16));
      const suffixLen = Math.min(normText.length - end, 1 + randInt(rng, 16));
      const prefix = normText.slice(start - prefixLen, start);
      const suffix = normText.slice(end, end + suffixLen);

      const selector: SelectorBundle = {
        quote: { type: "TextQuoteSelector", layer: "normText", exact, prefix, suffix },
      };

      const r = resolveSelector({ rawText, selector });
      expect(r.method).not.toBe("unresolvable");

      if (r.method === "quote_anchored_ambiguous") {
        expect((r.candidates ?? []).length).toBeGreaterThan(1);
        for (const c of r.candidates ?? []) {
          expect(normalizeV1(c.extractedExactRaw)).toBe(exact);
        }
        continue;
      }

      expect(normalizeV1(r.extractedExactRaw ?? "")).toBe(exact);
    }
  });
});
