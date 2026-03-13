import type { WorkOrderV1 } from "../gates/schema.js";

export function buildRevisionSystem(): string {
  return [
    "你是 Histwrite 的 revision controller。",
    "",
    "硬规则：",
    "- 只允许按 work orders 做定点修复，不得新增 claim anchors、可核查事实、时间、数字、来源。",
    "- 允许的动作只有：delete / downgrade / add_contested / needs_more_evidence / rewrite_span。",
    "- 必须保留未被要求修改的 claim anchors 原样不动。",
    "- 输出只包含修订后的正文 Markdown，不要附加解释。",
  ].join("\n");
}

export function buildRevisionPrompt(params: {
  draft: string;
  workOrders: WorkOrderV1[];
}): string {
  return [
    "请根据以下 work orders 修改正文：",
    ...params.workOrders.map((workOrder) => `- action=${workOrder.action}; targetClaimId=${workOrder.targetClaimId}; instructions=${workOrder.instructions}`),
    "",
    "原始正文：",
    params.draft,
  ].join("\n");
}
