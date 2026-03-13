import fs from "node:fs/promises";
import path from "node:path";

import type { ClaimMapV1 } from "../artifacts/claims.js";
import { buildChronologyReportV1 } from "../artifacts/reports.js";
import type { ChronologyItemV1, ChronologyReportV1, GateIssueV1, WorkOrderV1 } from "./schema.js";

type ChronologyLexiconRisk = "hard_blocker" | "high_risk_needs_human_confirmation";

type ChronologyLexiconRuleV1 = {
  id: string;
  pattern: string;
  risk: ChronologyLexiconRisk;
  category?: string;
  note?: string;
  notBefore?: number;
  notAfter?: number;
};

type ChronologyLexiconV1 = {
  version: 1;
  rules: ChronologyLexiconRuleV1[];
};

function parseYear(value: string): number | null {
  const matched = value.match(/\d{4}/);
  if (!matched) return null;
  const year = Number.parseInt(matched[0], 10);
  return Number.isFinite(year) ? year : null;
}

function normalizeWindow(timeWindow: { start: string; end: string }): { startYear: number; endYear: number } {
  const startYear = parseYear(timeWindow.start);
  const endYear = parseYear(timeWindow.end);
  if (startYear == null || endYear == null) {
    throw new Error(`invalid chronology timeWindow: ${timeWindow.start} -> ${timeWindow.end}`);
  }
  return {
    startYear: Math.min(startYear, endYear),
    endYear: Math.max(startYear, endYear),
  };
}

function blocker(reason: string, claimId: string, detail?: string, ruleId?: string): GateIssueV1 {
  return { severity: "blocker", reason, claimId, ...(detail ? { detail } : {}), ...(ruleId ? { ruleId } : {}) };
}

function warning(reason: string, claimId: string, detail?: string, ruleId?: string): GateIssueV1 {
  return { severity: "warning", reason, claimId, ...(detail ? { detail } : {}), ...(ruleId ? { ruleId } : {}) };
}

function workOrder(action: WorkOrderV1["action"], targetClaimId: string, instructions: string): WorkOrderV1 {
  return { action, targetClaimId, instructions };
}

async function readLexicon(filePath: string): Promise<ChronologyLexiconV1> {
  const parsed = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as ChronologyLexiconV1;
  if (parsed?.version !== 1 || !Array.isArray(parsed.rules)) {
    throw new Error(`invalid chronology lexicon: ${filePath}`);
  }
  return parsed;
}

function matchRule(rule: ChronologyLexiconRuleV1, text: string): boolean {
  return Boolean(rule.pattern) && text.includes(rule.pattern);
}

function classifyRuleHit(params: {
  rule: ChronologyLexiconRuleV1;
  effectiveStart: number;
  effectiveEnd: number;
  mode: "draft" | "final";
  claimId: string;
}): {
  status: ChronologyItemV1["status"];
  issue: GateIssueV1;
} {
  const outsideLowerBound = typeof params.rule.notBefore === "number" && params.effectiveEnd < params.rule.notBefore;
  const outsideUpperBound = typeof params.rule.notAfter === "number" && params.effectiveStart > params.rule.notAfter;
  const detail = params.rule.note ?? `${params.rule.pattern} 命中 ${params.rule.id}`;

  if (outsideLowerBound || outsideUpperBound || params.rule.risk === "hard_blocker") {
    return {
      status: "anachronism",
      issue: blocker("anachronism lexicon hit", params.claimId, detail, params.rule.id),
    };
  }

  if (params.mode === "final") {
    return {
      status: "high_risk",
      issue: blocker("high risk chronology lexicon hit", params.claimId, detail, params.rule.id),
    };
  }

  return {
    status: "high_risk",
    issue: warning("high risk chronology lexicon hit", params.claimId, detail, params.rule.id),
  };
}

export async function runChronologyGate(params: {
  claims: ClaimMapV1;
  timeWindow: { start: string; end: string };
  lexiconPath: string;
  mode?: "draft" | "final";
}): Promise<ChronologyReportV1> {
  const mode = params.mode ?? "draft";
  const lexicon = await readLexicon(params.lexiconPath);
  const normalizedWindow = normalizeWindow(params.timeWindow);

  const items: ChronologyItemV1[] = params.claims.claims.map((claim) => {
    const issues: GateIssueV1[] = [];
    const matchedRuleIds: string[] = [];
    const claimYear = claim.timeHint ? parseYear(claim.timeHint) : null;
    const effectiveStart = claimYear ?? normalizedWindow.startYear;
    const effectiveEnd = claimYear ?? normalizedWindow.endYear;

    if (claimYear != null && (claimYear < normalizedWindow.startYear || claimYear > normalizedWindow.endYear)) {
      issues.push(
        blocker(
          "claim timeHint falls outside section timeWindow",
          claim.claimId,
          `${claim.timeHint} ∉ ${params.timeWindow.start} -> ${params.timeWindow.end}`,
        ),
      );
    }

    let status: ChronologyItemV1["status"] = issues.length > 0 ? "time_window_violation" : "ok";

    for (const rule of lexicon.rules) {
      if (!matchRule(rule, claim.text)) continue;
      matchedRuleIds.push(rule.id);
      const classified = classifyRuleHit({
        rule,
        effectiveStart,
        effectiveEnd,
        mode,
        claimId: claim.claimId,
      });
      issues.push(classified.issue);

      if (status !== "time_window_violation") {
        status = classified.status;
      }
    }

    const minimalFix =
      status === "time_window_violation"
        ? workOrder("rewrite_span", claim.claimId, "标注回溯/前史/后果视角，或把该叙述移出当前 section。")
        : status === "anachronism"
          ? workOrder("rewrite_span", claim.claimId, "替换时代错置术语，或补足明确的史学说明。")
          : status === "high_risk"
            ? workOrder("rewrite_span", claim.claimId, "补充时间限定、史料出处或更保守的术语。")
            : undefined;

    return {
      claimId: claim.claimId,
      status,
      ...(claim.timeHint ? { timeHint: claim.timeHint } : {}),
      matchedRuleIds,
      issues,
      ...(minimalFix ? { minimalFix } : {}),
    };
  });

  return buildChronologyReportV1({
    timeWindow: params.timeWindow,
    items,
  });
}
