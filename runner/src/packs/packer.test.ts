import { describe, expect, it } from "vitest";

import type { ArtifactRef } from "../artifacts/heads.js";
import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";
import type { MaterialQADatasetV1 } from "../qa/schema.js";
import { buildSectionPacks } from "./packer.js";

function artifactRef(id: string): ArtifactRef {
  return {
    artifactId: `sha256:${id}`,
    sha256: id,
    path: `/tmp/${id}.json`,
    builtAt: new Date().toISOString(),
  };
}

function makeCard(params: {
  id: string;
  fact: string;
  quote: string;
  confidence: number;
  level?: "direct" | "inference";
}) {
  const rawText = `材料 ${params.id}：${params.quote}。`;
  const selectorBundle = normalizeSelectorBundle({
    quote: normalizeTextQuoteSelector({
      type: "TextQuoteSelector",
      layer: "rawText",
      exact: params.quote,
    }),
  });
  return {
    cardId: params.id,
    materialId: `m-${params.id}`,
    fact: params.fact,
    level: params.level ?? "direct",
    confidence: params.confidence,
    selectorBundle,
    resolvedSpan: resolveSelector({ rawText, selector: selectorBundle }),
  };
}

function makeQa(items: MaterialQADatasetV1["items"]): MaterialQADatasetV1 {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    selectorContractVersion,
    items,
  };
}

describe("buildSectionPacks", () => {
  it("selects topK cards with stable ordering after keyword filtering", async () => {
    const cards = {
      version: 2 as const,
      createdAt: new Date().toISOString(),
      selectorContractVersion,
      cards: [
        makeCard({ id: "c01", fact: "税制改革的背景。", quote: "税制改革", confidence: 0.51 }),
        makeCard({ id: "c02", fact: "地方治理。", quote: "地方治理", confidence: 0.95 }),
        makeCard({ id: "c03", fact: "边疆税制调整与税制改革并行。", quote: "边疆税制", confidence: 0.73 }),
        makeCard({ id: "c04", fact: "边疆军务。", quote: "边疆军务", confidence: 0.92 }),
        makeCard({ id: "c05", fact: "税制改革的执行层面。", quote: "执行层面", confidence: 0.72 }),
        makeCard({ id: "c06", fact: "士人议论。", quote: "士人议论", confidence: 0.91 }),
        makeCard({ id: "c07", fact: "边疆税制改革引发新的征收秩序。", quote: "边疆税制改革", confidence: 0.88 }),
        makeCard({ id: "c08", fact: "河工财政。", quote: "河工财政", confidence: 0.89 }),
        makeCard({ id: "c09", fact: "军政整顿。", quote: "军政整顿", confidence: 0.82 }),
        makeCard({ id: "c10", fact: "仓储制度。", quote: "仓储制度", confidence: 0.99 }),
      ],
    };

    const packs = await buildSectionPacks({
      blueprint: {
        version: 2,
        blueprintRef: artifactRef("blueprint"),
        sections: [
          {
            sectionId: "s1",
            title: "税制与边疆",
            timeWindow: { start: "1900", end: "1905" },
            textWindow: { topic: "税制与边疆的互动" },
            keywords: ["税制", "边疆"],
            maxCards: 3,
          },
        ],
      },
      cards,
    });

    expect(packs[0]?.cards.map((card) => card.cardId)).toEqual(["c07", "c03", "c04"]);
  });

  it("keeps selectorBundles and resolvedSpans on selected cards and pulls linked QA", async () => {
    const selected = makeCard({
      id: "c11",
      fact: "材料直接记载税制改革。",
      quote: "税制改革",
      confidence: 0.9,
    });
    const skipped = makeCard({
      id: "c12",
      fact: "与本节主题无关。",
      quote: "无关",
      confidence: 0.99,
    });

    const packs = await buildSectionPacks({
      blueprint: {
        version: 2,
        blueprintRef: artifactRef("blueprint"),
        sections: [
          {
            sectionId: "s1",
            title: "税制改革",
            timeWindow: { start: "1900", end: "1905" },
            textWindow: { topic: "税制改革" },
            keywords: ["税制"],
            maxCards: 1,
            maxQa: 2,
          },
        ],
      },
      cards: {
        version: 2,
        createdAt: new Date().toISOString(),
        selectorContractVersion,
        cards: [selected, skipped],
      },
      qa: makeQa([
        {
          qaId: "q1",
          question: "材料直接说明了什么？",
          answer: "它直接说明了税制改革。",
          answerType: "direct",
          evidenceRefs: [{ cardId: "c11", materialId: "m-c11", selectorBundle: selected.selectorBundle }],
        },
        {
          qaId: "q2",
          question: "无关问题",
          answer: "无关回答",
          answerType: "direct",
          evidenceRefs: [{ cardId: "c12", materialId: "m-c12", selectorBundle: skipped.selectorBundle }],
        },
      ]),
    });

    expect(packs[0]?.cards[0]?.selectorBundles[0]?.quote.exact).toBe("税制改革");
    expect(packs[0]?.cards[0]?.resolvedSpans[0]?.method).not.toBe("unresolvable");
    expect(packs[0]?.qa.map((item) => item.qaId)).toEqual(["q1"]);
  });

  it("forces mustIncludeCardIds into the final pack", async () => {
    const cards = {
      version: 2 as const,
      createdAt: new Date().toISOString(),
      selectorContractVersion,
      cards: [
        makeCard({ id: "c21", fact: "税制改革。", quote: "税制改革", confidence: 0.95 }),
        makeCard({ id: "c22", fact: "边疆行政。", quote: "边疆行政", confidence: 0.6 }),
        makeCard({ id: "c23", fact: "河工经费。", quote: "河工经费", confidence: 0.99 }),
      ],
    };

    const packs = await buildSectionPacks({
      blueprint: {
        version: 2,
        blueprintRef: artifactRef("blueprint"),
        sections: [
          {
            sectionId: "s1",
            title: "税制改革",
            timeWindow: { start: "1900", end: "1905" },
            textWindow: { topic: "税制改革" },
            keywords: ["税制"],
            maxCards: 1,
            mustIncludeCardIds: ["c22"],
          },
        ],
      },
      cards,
    });

    expect(packs[0]?.cards.map((card) => card.cardId)).toEqual(["c21", "c22"]);
  });
});
