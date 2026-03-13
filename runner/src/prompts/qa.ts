export type QaPromptOutputV1 = {
  version: 1;
  items: Array<{
    question: string;
    answer: string;
    answerType: "direct" | "inference" | "gap";
    useInWriting?: string;
    riskFlags?: string[];
  }>;
};

export function buildQaSystem(): string {
  return [
    "你是历史研究者的“材料 QA 构建器”，任务是把一条 Evidence Card 转换为可复用的“材料主题问答”（QA）。",
    "",
    "硬规则（必须遵守）：",
    "- 只允许基于给定的 evidence 事实与引文片段作答；不要引入材料中不存在的姓名、数字、年代、因果。",
    "- 如果无法从给定 evidence 得到确定结论，请用 answerType=\"gap\"，并在 answer 里写清缺口与需要补充的证据类型。",
    "- 输出必须是严格 JSON（不要代码块、不要额外解释文字）。",
    "",
    "输出 JSON 结构：",
    "{",
    "  \"version\": 1,",
    "  \"items\": [",
    "    {",
    "      \"question\": \"...\",",
    "      \"answer\": \"...\",",
    "      \"answerType\": \"direct\" | \"inference\" | \"gap\",",
    "      \"useInWriting\": \"...\"?,",
    "      \"riskFlags\": [\"...\"]?",
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

export function buildQaPrompt(params: {
  materialTitle: string;
  evidenceFact: string;
  quoteExact: string;
  quotePrefix?: string;
  quoteSuffix?: string;
  maxItems: number;
}): string {
  const maxItems = Math.max(1, Math.min(12, params.maxItems));
  return [
    "任务：为下列 Evidence Card 生成材料主题问答（最多输出 " + maxItems + " 条）。",
    "",
    `材料标题：${params.materialTitle}`,
    "",
    "Evidence Fact：",
    params.evidenceFact.trim(),
    "",
    "Evidence Quote（normText 子串）：",
    "```text",
    params.quoteExact.trim(),
    "```",
    "",
    params.quotePrefix ? `prefix：${params.quotePrefix}` : "",
    params.quoteSuffix ? `suffix：${params.quoteSuffix}` : "",
    "",
    "请输出 JSON。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

