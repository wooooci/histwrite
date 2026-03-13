export type GateIssueSeverity = "blocker" | "warning";
export type FactCheckStatus = "supported" | "inference_ok" | "contested" | "unsupported";
export type EvidenceAlignmentStatus = "aligned" | "missing" | "invalid" | "ambiguous";
export type ChronologyStatus = "ok" | "time_window_violation" | "anachronism" | "high_risk";
export type WorkOrderAction = "delete" | "downgrade" | "add_contested" | "needs_more_evidence" | "rewrite_span";

export type GateIssueV1 = {
  severity: GateIssueSeverity;
  reason: string;
  claimId?: string;
  detail?: string;
  ruleId?: string;
};

export type WorkOrderV1 = {
  action: WorkOrderAction;
  targetClaimId: string;
  instructions: string;
};

export type FactCheckItemV1 = {
  claimId: string;
  status: FactCheckStatus;
  evidenceAlignment: EvidenceAlignmentStatus;
  issues: GateIssueV1[];
  minimalFix?: WorkOrderV1;
};

export type FactCheckReportV1 = {
  version: 1;
  createdAt: string;
  items: FactCheckItemV1[];
  blockers: number;
  warnings: number;
  issues: GateIssueV1[];
  workOrders: WorkOrderV1[];
};

export type ChronologyItemV1 = {
  claimId: string;
  status: ChronologyStatus;
  timeHint?: string;
  matchedRuleIds: string[];
  issues: GateIssueV1[];
  minimalFix?: WorkOrderV1;
};

export type ChronologyReportV1 = {
  version: 1;
  createdAt: string;
  timeWindow: { start: string; end: string };
  items: ChronologyItemV1[];
  blockers: number;
  warnings: number;
  issues: GateIssueV1[];
  workOrders: WorkOrderV1[];
};

const workOrderActions = new Set<WorkOrderAction>(["delete", "downgrade", "add_contested", "needs_more_evidence", "rewrite_span"]);
const gateSeverities = new Set<GateIssueSeverity>(["blocker", "warning"]);
const factStatuses = new Set<FactCheckStatus>(["supported", "inference_ok", "contested", "unsupported"]);
const evidenceAlignmentStatuses = new Set<EvidenceAlignmentStatus>(["aligned", "missing", "invalid", "ambiguous"]);
const chronologyStatuses = new Set<ChronologyStatus>(["ok", "time_window_violation", "anachronism", "high_risk"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function validateIssue(issue: unknown, path: string): string[] {
  const problems: string[] = [];
  if (!isRecord(issue)) return [`${path} must be an object`];
  if (!gateSeverities.has(issue.severity as GateIssueSeverity)) problems.push(`${path}.severity invalid`);
  if (typeof issue.reason !== "string" || !issue.reason.trim()) problems.push(`${path}.reason missing/invalid`);
  if (issue.claimId != null && (typeof issue.claimId !== "string" || !issue.claimId.trim())) problems.push(`${path}.claimId invalid`);
  if (issue.ruleId != null && (typeof issue.ruleId !== "string" || !issue.ruleId.trim())) problems.push(`${path}.ruleId invalid`);
  if (issue.detail != null && typeof issue.detail !== "string") problems.push(`${path}.detail invalid`);
  return problems;
}

function validateWorkOrder(workOrder: unknown, path: string): string[] {
  const problems: string[] = [];
  if (!isRecord(workOrder)) return [`${path} must be an object`];
  if (!workOrderActions.has(workOrder.action as WorkOrderAction)) problems.push(`${path}.action invalid`);
  if (typeof workOrder.targetClaimId !== "string" || !workOrder.targetClaimId.trim()) problems.push(`${path}.targetClaimId missing/invalid`);
  if (typeof workOrder.instructions !== "string" || !workOrder.instructions.trim()) problems.push(`${path}.instructions missing/invalid`);
  return problems;
}

function validateFactCheckItem(item: unknown, path: string): string[] {
  const problems: string[] = [];
  if (!isRecord(item)) return [`${path} must be an object`];
  if (typeof item.claimId !== "string" || !item.claimId.trim()) problems.push(`${path}.claimId missing/invalid`);
  if (!factStatuses.has(item.status as FactCheckStatus)) problems.push(`${path}.status invalid`);
  if (!evidenceAlignmentStatuses.has(item.evidenceAlignment as EvidenceAlignmentStatus)) problems.push(`${path}.evidenceAlignment invalid`);
  if (!Array.isArray(item.issues)) {
    problems.push(`${path}.issues missing/invalid`);
  } else {
    item.issues.forEach((issue, index) => problems.push(...validateIssue(issue, `${path}.issues[${index}]`)));
  }
  if (item.minimalFix != null) problems.push(...validateWorkOrder(item.minimalFix, `${path}.minimalFix`));
  return problems;
}

function validateChronologyItem(item: unknown, path: string): string[] {
  const problems: string[] = [];
  if (!isRecord(item)) return [`${path} must be an object`];
  if (typeof item.claimId !== "string" || !item.claimId.trim()) problems.push(`${path}.claimId missing/invalid`);
  if (!chronologyStatuses.has(item.status as ChronologyStatus)) problems.push(`${path}.status invalid`);
  if (item.timeHint != null && (typeof item.timeHint !== "string" || !item.timeHint.trim())) problems.push(`${path}.timeHint invalid`);
  if (!Array.isArray(item.matchedRuleIds)) {
    problems.push(`${path}.matchedRuleIds missing/invalid`);
  } else {
    item.matchedRuleIds.forEach((ruleId, index) => {
      if (typeof ruleId !== "string" || !ruleId.trim()) problems.push(`${path}.matchedRuleIds[${index}] invalid`);
    });
  }
  if (!Array.isArray(item.issues)) {
    problems.push(`${path}.issues missing/invalid`);
  } else {
    item.issues.forEach((issue, index) => problems.push(...validateIssue(issue, `${path}.issues[${index}]`)));
  }
  if (item.minimalFix != null) problems.push(...validateWorkOrder(item.minimalFix, `${path}.minimalFix`));
  return problems;
}

function validateBaseReport(value: unknown, path: string): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  if (value.version !== 1) problems.push(`${path}.version must be 1`);
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) problems.push(`${path}.createdAt missing/invalid`);
  if (typeof value.blockers !== "number" || value.blockers < 0) problems.push(`${path}.blockers invalid`);
  if (typeof value.warnings !== "number" || value.warnings < 0) problems.push(`${path}.warnings invalid`);
  if (!Array.isArray(value.issues)) {
    problems.push(`${path}.issues missing/invalid`);
  } else {
    value.issues.forEach((issue, index) => problems.push(...validateIssue(issue, `${path}.issues[${index}]`)));
  }
  if (!Array.isArray(value.workOrders)) {
    problems.push(`${path}.workOrders missing/invalid`);
  } else {
    value.workOrders.forEach((workOrder, index) => problems.push(...validateWorkOrder(workOrder, `${path}.workOrders[${index}]`)));
  }
  return problems;
}

export function validateFactCheckReportV1(value: unknown): string[] {
  const problems = validateBaseReport(value, "factCheckReport");
  if (!isRecord(value)) return problems;
  if (!Array.isArray(value.items)) {
    problems.push("factCheckReport.items missing/invalid");
  } else {
    value.items.forEach((item, index) => problems.push(...validateFactCheckItem(item, `factCheckReport.items[${index}]`)));
  }
  return problems;
}

export function validateChronologyReportV1(value: unknown): string[] {
  const problems = validateBaseReport(value, "chronologyReport");
  if (!isRecord(value)) return problems;

  if (!isRecord(value.timeWindow)) {
    problems.push("chronologyReport.timeWindow missing/invalid");
  } else {
    if (typeof value.timeWindow.start !== "string" || !value.timeWindow.start.trim()) problems.push("chronologyReport.timeWindow.start missing/invalid");
    if (typeof value.timeWindow.end !== "string" || !value.timeWindow.end.trim()) problems.push("chronologyReport.timeWindow.end missing/invalid");
  }

  if (!Array.isArray(value.items)) {
    problems.push("chronologyReport.items missing/invalid");
  } else {
    value.items.forEach((item, index) => problems.push(...validateChronologyItem(item, `chronologyReport.items[${index}]`)));
  }
  return problems;
}
