import { describe, expect, it } from "vitest";

import { validateSectionPackV1 } from "./schema.js";

describe("validateSectionPackV1", () => {
  it("requires timeWindow", () => {
    const pack = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      packId: "p1",
      blueprintRef: { artifactId: "sha256:x", sha256: "x", path: "/tmp/blueprint.json", builtAt: new Date().toISOString() },
      sectionId: "s1",
      textWindow: { topic: "t" },
      cards: [],
      qa: [],
      constraints: { finalMissingGapsBlock: true, noNewClaims: true },
    };
    const issues = validateSectionPackV1(pack);
    expect(issues.some((s) => s.includes("timeWindow"))).toBe(true);
  });

  it("rejects unresolvable resolvedSpans", () => {
    const pack = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      packId: "p1",
      blueprintRef: { artifactId: "sha256:x", sha256: "x", path: "/tmp/blueprint.json", builtAt: new Date().toISOString() },
      sectionId: "s1",
      timeWindow: { start: "1900", end: "1901" },
      textWindow: { topic: "t" },
      cards: [
        {
          cardId: "c1",
          selectedEvidenceIds: [],
          selectorBundles: [],
          resolvedSpans: [{ rawStart: null, rawEnd: null, extractedExactRaw: null, method: "unresolvable" as const }],
        },
      ],
      qa: [],
      constraints: { finalMissingGapsBlock: true, noNewClaims: true },
    };
    const issues = validateSectionPackV1(pack);
    expect(issues.some((s) => s.includes("unresolvable"))).toBe(true);
  });

  it("requires evidenceRefs for qa items when qa is present", () => {
    const pack = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      packId: "p1",
      blueprintRef: { artifactId: "sha256:x", sha256: "x", path: "/tmp/blueprint.json", builtAt: new Date().toISOString() },
      sectionId: "s1",
      timeWindow: { start: "1900", end: "1901" },
      textWindow: { topic: "t" },
      cards: [],
      qa: [{ qaId: "q1", question: "Q", answer: "A", evidenceRefs: [] as unknown[] }],
      constraints: { finalMissingGapsBlock: true, noNewClaims: true },
    };
    const issues = validateSectionPackV1(pack);
    expect(issues.some((s) => s.includes("evidenceRefs"))).toBe(true);
  });
});

