import type { ArtifactRef } from "../artifacts/heads.js";
import type { QaEvidenceRefV1 } from "../qa/schema.js";
import type { SelectorBundle } from "../selector/contract.js";
import type { ResolvedSpan } from "../selector/resolve.js";

export type TimeWindowV1 = {
  start: string;
  end: string;
};

export type TextWindowV1 = {
  topic: string;
  allow?: string[];
  forbid?: string[];
  notes?: string;
};

export type SectionPackCardV1 = {
  cardId: string;
  selectedEvidenceIds: string[];
  selectorBundles: SelectorBundle[];
  resolvedSpans: ResolvedSpan[];
};

export type SectionPackQaV1 = {
  qaId: string;
  question: string;
  answer: string;
  evidenceRefs: QaEvidenceRefV1[];
};

export type SectionPackV1 = {
  version: 1;
  createdAt: string;
  packId: string;
  blueprintRef: ArtifactRef;
  sectionId: string;
  timeWindow: TimeWindowV1;
  textWindow: TextWindowV1;
  cards: SectionPackCardV1[];
  qa: SectionPackQaV1[];
  constraints: { finalMissingGapsBlock: boolean; noNewClaims: boolean };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateSectionPackV1(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["pack must be an object"];

  if (value.version !== 1) issues.push("pack.version must be 1");
  if (typeof value.packId !== "string" || !value.packId.trim()) issues.push("pack.packId missing/invalid");
  if (typeof value.sectionId !== "string" || !value.sectionId.trim()) issues.push("pack.sectionId missing/invalid");

  const timeWindow = value.timeWindow;
  if (!isRecord(timeWindow)) {
    issues.push("pack.timeWindow missing/invalid");
  } else {
    const start = timeWindow.start;
    const end = timeWindow.end;
    if (typeof start !== "string" || !start.trim()) issues.push("pack.timeWindow.start missing/invalid");
    if (typeof end !== "string" || !end.trim()) issues.push("pack.timeWindow.end missing/invalid");
  }

  const cards = value.cards;
  if (Array.isArray(cards)) {
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      if (!isRecord(card)) continue;
      const spans = card.resolvedSpans;
      if (!Array.isArray(spans)) continue;
      for (let j = 0; j < spans.length; j += 1) {
        const span = spans[j];
        if (!isRecord(span)) continue;
        if (span.method === "unresolvable") {
          issues.push(`cards[${i}].resolvedSpans[${j}].method must not be unresolvable`);
        }
      }
    }
  }

  const qa = value.qa;
  if (Array.isArray(qa)) {
    for (let i = 0; i < qa.length; i += 1) {
      const item = qa[i];
      if (!isRecord(item)) continue;
      const refs = item.evidenceRefs;
      if (Array.isArray(refs) && refs.length >= 1) continue;
      issues.push(`qa[${i}].evidenceRefs must have at least 1 entry`);
    }
  }

  return issues;
}

