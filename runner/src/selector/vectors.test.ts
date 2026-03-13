import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { SelectorBundle } from "./contract.js";
import { selectorContractVersion } from "./contract.js";
import { resolveSelector } from "./resolve.js";
import { normalizeV1 } from "./normalize.js";

type VectorFile = {
  version: number;
  selectorContractVersion: number;
  cases: Array<{
    id: string;
    rawTextB64: string;
    selector: SelectorBundle;
    expect: { method: "position_verified" | "quote_anchored" | "quote_anchored_ambiguous" | "unresolvable" };
  }>;
};

describe("selector contract vectors v1", () => {
  it("matches expected resolver behavior on stable vectors", async () => {
    const filePath = fileURLToPath(new URL("./vectors.v1.json", import.meta.url));
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as VectorFile;

    expect(parsed.version).toBe(1);
    // Gate: contract bumps must update vectors.
    expect(parsed.selectorContractVersion).toBe(selectorContractVersion);
    expect(parsed.cases.length).toBeGreaterThan(0);

    for (const v of parsed.cases) {
      const rawText = Buffer.from(v.rawTextB64, "base64").toString("utf8");
      const r = resolveSelector({ rawText, selector: v.selector });
      expect(r.method, v.id).toBe(v.expect.method);

      if (r.method === "position_verified" || r.method === "quote_anchored") {
        const exactRaw = r.extractedExactRaw ?? "";
        if (v.selector.quote.layer === "rawText") {
          expect(exactRaw, v.id).toBe(v.selector.quote.exact);
        } else {
          expect(normalizeV1(exactRaw), v.id).toBe(v.selector.quote.exact);
        }
      }

      if (r.method === "quote_anchored_ambiguous") {
        expect((r.candidates ?? []).length, v.id).toBeGreaterThan(1);
        for (const c of r.candidates ?? []) {
          if (v.selector.quote.layer === "rawText") {
            expect(c.extractedExactRaw, v.id).toBe(v.selector.quote.exact);
          } else {
            expect(normalizeV1(c.extractedExactRaw), v.id).toBe(v.selector.quote.exact);
          }
        }
      }
    }
  });
});
