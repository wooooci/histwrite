export function buildPolishPlaceholderToken(index: number): string {
  return `[[[HISTWRITE_CLAIM_BLOCK_${index}]]]`;
}

export function buildPolishInstruction(params: { placeholders: string[] }): string {
  const lines = [
    "这一步是 FINAL 阶段的 polish，只允许润色 claim anchor 外部的表达、衔接和节奏。",
    "硬规则：",
    "- 绝对不要新增任何 claim anchor。",
    "- 绝对不要改写、拆分、合并、删除 claim anchor。",
    "- 不要新增事实、年份、数字、引文、脚注、页码。",
    "- 下列占位符必须逐字原样保留，且各出现且只出现一次。",
  ];

  for (const placeholder of params.placeholders) {
    lines.push(`- ${placeholder}`);
  }

  lines.push("输出仍然只包含 Markdown 正文，不要解释。");
  return lines.join("\n");
}
