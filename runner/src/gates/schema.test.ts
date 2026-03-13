import { describe, expect, it } from "vitest";

import { buildChronologyReportV1, buildFactCheckReportV1 } from "../artifacts/reports.js";
import { validateChronologyReportV1, validateFactCheckReportV1 } from "./schema.js";

describe("gate schemas", () => {
  it("builds a valid fact check report with per-claim issues and minimal fixes", () => {
    const report = buildFactCheckReportV1({
      createdAt: "2026-03-12T00:00:00.000Z",
      items: [
        {
          claimId: "c1",
          status: "unsupported",
          evidenceAlignment: "invalid",
          issues: [
            {
              severity: "blocker",
              reason: "missing evidence card",
              claimId: "c1",
            },
          ],
          minimalFix: {
            action: "needs_more_evidence",
            targetClaimId: "c1",
            instructions: "补充至少一条可解析的 evidence ref。",
          },
        },
        {
          claimId: "c2",
          status: "supported",
          evidenceAlignment: "aligned",
          issues: [],
        },
      ],
    });

    expect(validateFactCheckReportV1(report)).toEqual([]);
    expect(report.blockers).toBe(1);
    expect(report.warnings).toBe(0);
    expect(report.workOrders).toHaveLength(1);
    expect(report.items[0]?.minimalFix?.action).toBe("needs_more_evidence");
  });

  it("rejects invalid work order actions at runtime", () => {
    const report = {
      version: 1,
      createdAt: "2026-03-12T00:00:00.000Z",
      items: [],
      blockers: 0,
      warnings: 0,
      issues: [],
      workOrders: [
        {
          action: "invent_fact",
          targetClaimId: "c1",
          instructions: "这不应该通过",
        },
      ],
    };

    expect(validateFactCheckReportV1(report).some((issue) => issue.includes("workOrders[0].action invalid"))).toBe(true);
  });

  it("builds a valid chronology report with high-risk signals and work orders", () => {
    const report = buildChronologyReportV1({
      createdAt: "2026-03-12T00:00:00.000Z",
      timeWindow: { start: "1900", end: "1905" },
      items: [
        {
          claimId: "c1",
          status: "high_risk",
          timeHint: "1902年",
          matchedRuleIds: ["lexicon.tax-reform"],
          issues: [
            {
              severity: "warning",
              reason: "lexicon high risk",
              claimId: "c1",
              ruleId: "lexicon.tax-reform",
            },
          ],
          minimalFix: {
            action: "rewrite_span",
            targetClaimId: "c1",
            instructions: "改成更保守的表述，并说明术语风险。",
          },
        },
      ],
    });

    expect(validateChronologyReportV1(report)).toEqual([]);
    expect(report.warnings).toBe(1);
    expect(report.items[0]?.matchedRuleIds).toEqual(["lexicon.tax-reform"]);
    expect(report.workOrders[0]?.action).toBe("rewrite_span");
  });
});
