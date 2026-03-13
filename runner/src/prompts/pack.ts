import type { TextWindowV1, TimeWindowV1 } from "../packs/schema.js";
import type { EvidenceCardV2 } from "../cards/schema.js";

export function renderPackCardCandidateMarkdown(params: {
  sectionTitle: string;
  timeWindow: TimeWindowV1;
  textWindow: TextWindowV1;
  card: EvidenceCardV2;
}): string {
  return [
    `# Section Candidate: ${params.sectionTitle}`,
    "",
    `TimeWindow: ${params.timeWindow.start} -> ${params.timeWindow.end}`,
    `Topic: ${params.textWindow.topic}`,
    "",
    `CardId: ${params.card.cardId}`,
    `Level: ${params.card.level}`,
    `Confidence: ${params.card.confidence}`,
    "",
    "Fact:",
    params.card.fact.trim(),
    "",
    "Quote:",
    params.card.selectorBundle.quote.exact.trim(),
  ].join("\n");
}

