import type { ChronologyItemV1, ChronologyReportV1, FactCheckItemV1, FactCheckReportV1, GateIssueV1, WorkOrderV1 } from "../gates/schema.js";

function aggregateIssues(items: Array<{ issues: GateIssueV1[] }>): GateIssueV1[] {
  return items.flatMap((item) => item.issues);
}

function aggregateWorkOrders(items: Array<{ minimalFix?: WorkOrderV1 }>): WorkOrderV1[] {
  return items.flatMap((item) => (item.minimalFix ? [item.minimalFix] : []));
}

export function buildFactCheckReportV1(params: {
  items: FactCheckItemV1[];
  createdAt?: string;
}): FactCheckReportV1 {
  const issues = aggregateIssues(params.items);
  return {
    version: 1,
    createdAt: params.createdAt ?? new Date().toISOString(),
    items: params.items,
    blockers: issues.filter((issue) => issue.severity === "blocker").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    issues,
    workOrders: aggregateWorkOrders(params.items),
  };
}

export function buildChronologyReportV1(params: {
  timeWindow: { start: string; end: string };
  items: ChronologyItemV1[];
  createdAt?: string;
}): ChronologyReportV1 {
  const issues = aggregateIssues(params.items);
  return {
    version: 1,
    createdAt: params.createdAt ?? new Date().toISOString(),
    timeWindow: params.timeWindow,
    items: params.items,
    blockers: issues.filter((issue) => issue.severity === "blocker").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    issues,
    workOrders: aggregateWorkOrders(params.items),
  };
}
