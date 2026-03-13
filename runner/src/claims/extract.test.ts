import { describe, expect, it } from "vitest";

import type { SectionPackV1 } from "../packs/schema.js";
import { buildClaimSet, extractClaimMap } from "./extract.js";

function makePack(): SectionPackV1 {
  return {
    version: 1,
    createdAt: "2026-03-12T00:00:00.000Z",
    packId: "pack_claims",
    blueprintRef: {
      artifactId: "sha256:blueprint",
      sha256: "blueprint",
      path: "/tmp/blueprint.json",
      builtAt: "2026-03-12T00:00:00.000Z",
    },
    sectionId: "sec_tax",
    timeWindow: { start: "1900", end: "1905" },
    textWindow: { topic: "税制改革" },
    cards: [
      {
        cardId: "c1",
        selectedEvidenceIds: ["c1"],
        selectorBundles: [],
        resolvedSpans: [
          {
            rawStart: 0,
            rawEnd: 4,
            extractedExactRaw: "税制改革",
            method: "quote_anchored",
          },
        ],
      },
      {
        cardId: "c2",
        selectedEvidenceIds: ["e0"],
        selectorBundles: [],
        resolvedSpans: [
          {
            rawStart: 5,
            rawEnd: 12,
            extractedExactRaw: "1902年财政安排",
            method: "quote_anchored",
          },
        ],
      },
    ],
    qa: [],
    constraints: { finalMissingGapsBlock: true, noNewClaims: true },
  };
}

describe("extractClaimMap", () => {
  it("returns deterministic claim maps for the same draft", () => {
    const pack = makePack();
    const draft = [
      "引言。",
      "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
      "〔claim:c2|kind=chronology|ev=c2:e0〕1902年出现了新的财政安排。〔/claim〕",
    ].join("\n");

    const first = extractClaimMap({ draft, pack });
    const second = extractClaimMap({ draft, pack });

    expect(second).toEqual(first);
    expect(first.claims).toHaveLength(2);
    expect(first.claims[1]?.timeHint).toBe("1902年");
  });

  it("marks invalid evidence refs on the extracted claim", () => {
    const pack = makePack();
    const draft = "〔claim:c1|kind=causal|ev=outside:e0〕越界引用。〔/claim〕";

    const out = extractClaimMap({ draft, pack });

    expect(out.claims).toHaveLength(1);
    expect(out.claims[0]?.riskFlags).toContain("invalid_evidence_ref");
    expect(out.claims[0]?.evidenceRefs).toEqual([
      {
        cardId: "outside",
        evidenceId: "e0",
        raw: "outside:e0",
        valid: false,
      },
    ]);
  });

  it("builds a claim set from the extracted claims", () => {
    const pack = makePack();
    const draft = [
      "〔claim:c2|kind=chronology|ev=c2:e0〕1902年出现了新的财政安排。〔/claim〕",
      "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
    ].join("\n");

    const out = extractClaimMap({ draft, pack });
    const claimSet = buildClaimSet(out.claims);

    expect(claimSet.version).toBe(1);
    expect(claimSet.claims.map((item) => item.claimId)).toEqual(["c1", "c2"]);
    expect(claimSet.claims.every((item) => item.signature.startsWith("sha256:"))).toBe(true);
  });
});
