import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildClaimMapV1, type ClaimMapItemV1 } from "../artifacts/claims.js";
import { runChronologyGate } from "./chronology.js";

function makeClaims(items: ClaimMapItemV1[]) {
  return buildClaimMapV1(items);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const lexiconPath = path.join(repoRoot, "content", "chronology", "lexicon.v1.json");

describe("runChronologyGate", () => {
  it("blocks claims whose timeHint falls outside the section time window", async () => {
    const claims = makeClaims([
      {
        claimId: "c1",
        kind: "chronology",
        text: "1910年某项财政调整导致结构变化。",
        evidenceRefs: [],
        timeHint: "1910年",
        riskFlags: [],
      },
    ]);

    const report = await runChronologyGate({
      claims,
      timeWindow: { start: "1900", end: "1905" },
      lexiconPath,
      mode: "final",
    });

    expect(report.items[0]?.status).toBe("time_window_violation");
    expect(report.blockers).toBe(1);
    expect(report.items[0]?.minimalFix?.action).toBe("rewrite_span");
  });

  it("marks lexicon hits as high risk and includes matched rule ids", async () => {
    const claims = makeClaims([
      {
        claimId: "c2",
        kind: "concept",
        text: "这里直接使用了税制改革这个术语。",
        evidenceRefs: [],
        riskFlags: [],
      },
    ]);

    const report = await runChronologyGate({
      claims,
      timeWindow: { start: "1900", end: "1905" },
      lexiconPath,
      mode: "draft",
    });

    expect(report.items[0]?.status).toBe("high_risk");
    expect(report.items[0]?.matchedRuleIds).toContain("lexicon.tax-reform");
    expect(report.warnings).toBe(1);
    expect(report.blockers).toBe(0);
  });

  it("falls back to the section time window when a claim has no timeHint", async () => {
    const claims = makeClaims([
      {
        claimId: "c3",
        kind: "causal",
        text: "地方财政结构随之调整。",
        evidenceRefs: [],
        riskFlags: [],
      },
    ]);

    const report = await runChronologyGate({
      claims,
      timeWindow: { start: "1900", end: "1905" },
      lexiconPath,
      mode: "draft",
    });

    expect(report.items[0]?.status).toBe("ok");
    expect(report.items[0]?.timeHint).toBeUndefined();
    expect(report.timeWindow).toEqual({ start: "1900", end: "1905" });
    expect(report.blockers).toBe(0);
    expect(report.warnings).toBe(0);
  });
});
