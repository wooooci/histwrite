import type { SectionPackV1 } from "../packs/schema.js";

function allowedEvidenceRefs(pack: SectionPackV1): string[] {
  const refs: string[] = [];
  for (const card of pack.cards) {
    for (const evidenceId of card.selectedEvidenceIds) {
      refs.push(`${card.cardId}:${evidenceId}`);
    }
  }
  return refs;
}

export function buildWriteSectionSystem(): string {
  return [
    "你是 Histwrite 的 section writer。",
    "",
    "硬规则：",
    "- 只允许使用给定 SectionPack 中的 evidence/qa 写作，不得新增可核查事实、数字、引文、时间、来源。",
    "- 任何可核查主张都必须包进 claim anchor。",
    "- claim anchor 语法固定为：〔claim:<id>|kind=<kind>|ev=<cardId>:<evidenceId>,...〕...〔/claim〕",
    "- ev 只能引用 SectionPack 提供的 evidence refs，禁止自造 cardId 或 evidenceId。",
    "- 证据不足时，写成推断、争议或缺口，不要把不确定内容写成确定事实。",
    "- 输出只包含正文 Markdown，不要附加解释、清单或自我说明。",
  ].join("\n");
}

export function buildWriteSectionPrompt(params: {
  pack: SectionPackV1;
  instruction?: string | null;
}): string {
  const refs = allowedEvidenceRefs(params.pack);
  const cardLines =
    params.pack.cards.length === 0
      ? ["- 无 evidence cards；若无法成段，请明确写出材料缺口。"]
      : params.pack.cards.map((card) => {
          const quotes = card.resolvedSpans
            .map((span, index) => `evidence=${card.selectedEvidenceIds[index] ?? card.cardId}; quote=${span.extractedExactRaw ?? ""}`)
            .join(" | ");
          return `- cardId=${card.cardId}; refs=${card.selectedEvidenceIds.map((evidenceId) => `${card.cardId}:${evidenceId}`).join(",")}; ${quotes}`;
        });

  const qaLines =
    params.pack.qa.length === 0
      ? ["- 无 QA"]
      : params.pack.qa.map((item) => `- ${item.qaId}: Q=${item.question} / A=${item.answer}`);

  return [
    `任务：写出 section ${params.pack.sectionId} 的正文草稿。`,
    `主题：${params.pack.textWindow.topic}`,
    `时间窗：${params.pack.timeWindow.start} -> ${params.pack.timeWindow.end}`,
    params.pack.textWindow.notes ? `说明：${params.pack.textWindow.notes}` : null,
    params.instruction?.trim() ? `额外要求：${params.instruction.trim()}` : null,
    "",
    "允许使用的 evidence refs：",
    refs.length > 0 ? refs.join(", ") : "（空）",
    "",
    "Evidence cards：",
    ...cardLines,
    "",
    "QA：",
    ...qaLines,
    "",
    "写作要求：",
    "- 如果 pack 中有 evidence cards，正文里至少写出一个 claim anchor。",
    "- 不要引用 pack 外的 evidence refs。",
    "- 如果没有足够证据，可以直接写缺口说明，此时允许不写 claim anchor。",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

