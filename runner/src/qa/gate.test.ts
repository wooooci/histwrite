import { describe, expect, it } from "vitest";

import { buildMaterialV2, buildMaterialsV2Dataset } from "../artifacts/materials.js";
import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";
import { runQaQualityGate } from "./gate.js";

function fixtures() {
  const materials = buildMaterialsV2Dataset([
    buildMaterialV2({
      materialId: "m1",
      provenance: {
        kind: "txt",
        title: "t1",
        sourcePath: "材料/a.txt",
        sourceSha256: "sha",
        textPath: "材料/_index/text/m1.txt",
        textSha256: "sha2",
      },
      rawText: "a\r\nb",
    }),
  ]);

  const selectorBundle = normalizeSelectorBundle({
    quote: normalizeTextQuoteSelector({ type: "TextQuoteSelector", layer: "normText", exact: "a\nb" }),
  });
  const resolvedSpan = resolveSelector({ rawText: materials.materials[0]!.rawText, selector: selectorBundle });

  const cards = {
    version: 2 as const,
    createdAt: new Date().toISOString(),
    selectorContractVersion,
    cards: [
      {
        cardId: "c1",
        materialId: "m1",
        fact: "材料中出现了 a\\nb 的文本片段。",
        level: "direct" as const,
        confidence: 0.9,
        selectorBundle,
        resolvedSpan,
      },
    ],
  };

  return { materials, cards, selectorBundle };
}

describe("runQaQualityGate", () => {
  it("passes when each QA binds at least one resolvable evidence selector", () => {
    const { materials, cards, selectorBundle } = fixtures();
    const qa = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      selectorContractVersion,
      items: [
        {
          qaId: "q1",
          question: "这条材料直接说明了什么？",
          answer: "它直接给出了一个可引用的文本片段。",
          answerType: "direct" as const,
          evidenceRefs: [{ cardId: "c1", materialId: "m1", selectorBundle }],
        },
      ],
    };

    const report = runQaQualityGate({ materials, cards, qa });
    expect(report.blockers).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.issues.length).toBe(0);
  });

  it("blocks when evidenceRefs is empty", () => {
    const { materials, cards, selectorBundle } = fixtures();
    const qa = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      selectorContractVersion,
      items: [
        {
          qaId: "q1",
          question: "Q",
          answer: "A",
          answerType: "direct" as const,
          evidenceRefs: [] as Array<{ cardId: string; materialId: string; selectorBundle: typeof selectorBundle }>,
        },
      ],
    };

    const report = runQaQualityGate({ materials, cards, qa });
    expect(report.blockers).toBe(1);
    expect(report.issues[0]?.severity).toBe("blocker");
  });
});

