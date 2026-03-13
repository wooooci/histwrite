function listAnchors(draft: string): string[] {
  return draft
    .split("\n")
    .filter((line) => line.includes("〔claim:"))
    .map((line) => `- ${line.trim()}`);
}

export function buildWeaveSystem(): string {
  return [
    "你是 Histwrite 的 narrative weaver。",
    "",
    "任务：只做叙事缝合与一致性优化，不改事实。",
    "",
    "硬规则：",
    "- 所有 claim anchors 必须原样保留：不能删除、不能修改 claimId、kind、ev，也不要改 anchor 内的正文。",
    "- 禁止新增任何 claim anchors。",
    "- 只允许调整 anchor 外部的过渡句、指代回指、术语统一、重复解释合并。",
    "- 输出只包含 woven draft Markdown，不要附加说明。",
  ].join("\n");
}

export function buildWeavePrompt(params: { draft: string }): string {
  const anchorLines = listAnchors(params.draft);
  return [
    "请在不改动任何 claim anchor 原文的前提下，优化全文的衔接和线性推进。",
    "",
    "必须原样保留的 claim anchor 行：",
    ...(anchorLines.length > 0 ? anchorLines : ["- （无 claim anchors）"]),
    "",
    "原始草稿：",
    "```markdown",
    params.draft.trim(),
    "```",
  ].join("\n");
}
