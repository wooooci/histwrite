import { describe, expect, it } from "vitest";

import { buildClaimMapV1, type ClaimMapItemV1 } from "../artifacts/claims.js";
import { buildMaterialV2, buildMaterialsV2Dataset } from "../artifacts/materials.js";
import type { EvidenceCardV2, EvidenceCardsV2Dataset } from "../cards/schema.js";
import { selectorContractVersion } from "../selector/contract.js";
import { runFactCheckGate } from "./factcheck.js";

function makeClaims(items: ClaimMapItemV1[]) {
  return buildClaimMapV1(items);
}

function makeCards(cards: EvidenceCardV2[]): EvidenceCardsV2Dataset {
  return {
    version: 2,
    createdAt: "2026-03-12T00:00:00.000Z",
    selectorContractVersion,
    cards,
  };
}

describe("runFactCheckGate", () => {
  it("marks claims without evidence refs as unsupported blockers", () => {
    const materials = buildMaterialsV2Dataset([
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
        rawText: "税制改革推进。",
      }),
    ]);

    const claims = makeClaims([
      {
        claimId: "c1",
        kind: "causal",
        text: "税制改革推进。",
        evidenceRefs: [],
        riskFlags: [],
      },
    ]);

    const report = runFactCheckGate({
      materials,
      cards: makeCards([]),
      claims,
      mode: "final",
    });

    expect(report.items[0]?.status).toBe("unsupported");
    expect(report.blockers).toBe(1);
    expect(report.items[0]?.minimalFix?.action).toBe("needs_more_evidence");
  });

  it("marks nonexistent evidence refs as unsupported blockers", () => {
    const materials = buildMaterialsV2Dataset([
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
        rawText: "税制改革推进。",
      }),
    ]);

    const claims = makeClaims([
      {
        claimId: "c1",
        kind: "causal",
        text: "税制改革推进。",
        evidenceRefs: [
          {
            cardId: "missing",
            evidenceId: "e0",
            raw: "missing:e0",
            valid: false,
          },
        ],
        riskFlags: ["invalid_evidence_ref"],
      },
    ]);

    const report = runFactCheckGate({
      materials,
      cards: makeCards([]),
      claims,
      mode: "final",
    });

    expect(report.items[0]?.status).toBe("unsupported");
    expect(report.items[0]?.evidenceAlignment).toBe("invalid");
    expect(report.blockers).toBe(1);
  });

  it("marks ambiguous selectors as contested and blocks in final mode", () => {
    const materials = buildMaterialsV2Dataset([
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
        rawText: "同样语句。别的句子。同样语句。",
      }),
    ]);

    const cards = makeCards([
      {
        cardId: "c1",
        materialId: "m1",
        fact: "材料中出现了重复表述",
        level: "direct",
        confidence: 0.9,
        selectorBundle: {
          quote: {
            type: "TextQuoteSelector",
            layer: "rawText",
            exact: "同样语句",
          },
        },
        resolvedSpan: {
          rawStart: 0,
          rawEnd: 4,
          extractedExactRaw: "同样语句",
          method: "quote_anchored",
        },
      },
    ]);

    const claims = makeClaims([
      {
        claimId: "claim_1",
        kind: "causal",
        text: "同样语句",
        evidenceRefs: [
          {
            cardId: "c1",
            evidenceId: "c1",
            raw: "c1:c1",
            valid: true,
          },
        ],
        riskFlags: [],
      },
    ]);

    const report = runFactCheckGate({
      materials,
      cards,
      claims,
      mode: "final",
    });

    expect(report.items[0]?.status).toBe("contested");
    expect(report.items[0]?.evidenceAlignment).toBe("ambiguous");
    expect(report.blockers).toBe(1);
    expect(report.items[0]?.minimalFix?.action).toBe("add_contested");
  });

  it("requires direct evidence for quote claims", () => {
    const materials = buildMaterialsV2Dataset([
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
        rawText: "税制改革推进。",
      }),
    ]);

    const cards = makeCards([
      {
        cardId: "c1",
        materialId: "m1",
        fact: "这是推断",
        level: "inference",
        confidence: 0.8,
        selectorBundle: {
          quote: {
            type: "TextQuoteSelector",
            layer: "rawText",
            exact: "税制改革",
          },
        },
        resolvedSpan: {
          rawStart: 0,
          rawEnd: 4,
          extractedExactRaw: "税制改革",
          method: "quote_anchored",
        },
      },
    ]);

    const claims = makeClaims([
      {
        claimId: "claim_1",
        kind: "quote",
        text: "税制改革",
        evidenceRefs: [
          {
            cardId: "c1",
            evidenceId: "c1",
            raw: "c1:c1",
            valid: true,
          },
        ],
        riskFlags: [],
      },
    ]);

    const report = runFactCheckGate({
      materials,
      cards,
      claims,
      mode: "final",
    });

    expect(report.items[0]?.status).toBe("unsupported");
    expect(report.blockers).toBe(1);
  });
});
