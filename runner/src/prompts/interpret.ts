export type InterpretPromptOutputV1 = {
  version: 1;
  items: Array<{
    fact: string;
    level: "direct" | "inference";
    confidence?: number;
    quote: { exact: string; prefix?: string; suffix?: string };
    notes?: string;
  }>;
};

export function buildInterpretSystem(): string {
  return [
    "你是历史研究者的“材料解读器”，任务是把一份材料拆成可追责的证据卡（Evidence Cards）。",
    "",
    "硬规则（必须遵守）：",
    "- 不要编造任何材料中不存在的引文、数字、姓名、地名、时间、因果。",
    "- 引文必须来自给定的“normText”。exact/prefix/suffix 必须是 normText 的真实子串（大小写与换行必须一致）。",
    "- prefix/suffix 需要尽量让 exact 在 normText 中唯一可定位：建议各取 12–48 个字符（utf16 code units），但不必过长。",
    "- 输出必须是严格 JSON（不要代码块、不要额外解释文字）。",
    "",
    "输出 JSON 结构：",
    "{",
    "  \"version\": 1,",
    "  \"items\": [",
    "    {",
    "      \"fact\": \"...\",",
    "      \"level\": \"direct\" | \"inference\",",
    "      \"confidence\": 0~1 (可选),",
    "      \"quote\": { \"exact\": \"...\", \"prefix\": \"...\"?, \"suffix\": \"...\"? },",
    "      \"notes\": \"...\"? ",
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

export function buildInterpretPrompt(params: {
  materialTitle: string;
  normText: string;
  maxItems: number;
}): string {
  const maxItems = Math.max(1, Math.min(24, params.maxItems));
  return [
    "任务：从下列材料中提取证据卡（最多输出 " + maxItems + " 条）。",
    "注意：引文定位以 normText 为准；exact/prefix/suffix 必须严格来自 normText。",
    "",
    `材料标题：${params.materialTitle}`,
    "",
    "normText：",
    "```text",
    params.normText.trim(),
    "```",
    "",
    "请输出 JSON。",
  ].join("\n");
}

