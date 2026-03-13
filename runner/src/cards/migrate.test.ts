import { describe, expect, it } from "vitest";

import { buildMaterialV2, buildMaterialsV2Dataset } from "../artifacts/materials.js";
import { selectorContractVersion } from "../selector/contract.js";
import { coerceEvidenceCardsV2Dataset } from "./migrate.js";

function makeMaterials(rawText: string) {
  return buildMaterialsV2Dataset([
    buildMaterialV2({
      materialId: "m1",
      provenance: {
        kind: "archive",
        title: "材料一",
        sourcePath: "/tmp/m1.txt",
        sourceSha256: "m1",
        textPath: "/tmp/m1.txt",
        textSha256: "m1",
      },
      rawText,
    }),
  ]);
}

function makeLegacyDataset(quote: string) {
  return {
    version: 1,
    createdAt: "2026-03-12T00:00:00.000Z",
    cards: [
      {
        cardId: "c1",
        materialId: "m1",
        fact: `材料中出现了“${quote}”`,
        level: "direct",
        confidence: 0.91,
        quote,
      },
    ],
  };
}

describe("coerceEvidenceCardsV2Dataset", () => {
  it("upgrades legacy quote-only cards into selectorBundle + resolvedSpan", () => {
    const materials = makeMaterials("AAA\r\nBBB 这里有一段引文 CCC\nDDD");

    const dataset = coerceEvidenceCardsV2Dataset({
      input: makeLegacyDataset("这里有一段引文"),
      materials,
    });

    expect(dataset.version).toBe(2);
    expect(dataset.selectorContractVersion).toBe(selectorContractVersion);
    expect(dataset.cards[0]?.selectorBundle.quote.layer).toBe("normText");
    expect(dataset.cards[0]?.selectorBundle.quote.exact).toBe("这里有一段引文");
    expect(dataset.cards[0]?.resolvedSpan.method).toBe("position_verified");
    expect(dataset.cards[0]?.resolvedSpan.extractedExactRaw).toBe("这里有一段引文");
    expect(dataset.gaps).toBeUndefined();
  });

  it("keeps ambiguous legacy quotes and records migration gaps", () => {
    const materials = makeMaterials("X 同句 Y 同句 Z");

    const dataset = coerceEvidenceCardsV2Dataset({
      input: makeLegacyDataset("同句"),
      materials,
    });

    expect(dataset.cards[0]?.resolvedSpan.method).toBe("quote_anchored_ambiguous");
    expect(dataset.cards[0]?.resolvedSpan.candidates).toHaveLength(2);
    expect(dataset.gaps).toHaveLength(1);
    expect(dataset.gaps?.[0]?.reason).toContain("ambiguous");
  });

  it("keeps unresolvable legacy quotes and records migration gaps", () => {
    const materials = makeMaterials("完全不同");

    const dataset = coerceEvidenceCardsV2Dataset({
      input: makeLegacyDataset("不存在"),
      materials,
    });

    expect(dataset.cards[0]?.resolvedSpan.method).toBe("unresolvable");
    expect(dataset.cards[0]?.resolvedSpan.reason).toContain("no matches");
    expect(dataset.gaps).toHaveLength(1);
    expect(dataset.gaps?.[0]?.reason).toContain("unresolvable");
  });
});
