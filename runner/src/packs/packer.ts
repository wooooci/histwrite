import { sha256Hex, stableJsonStringify } from "../cache.js";
import type { EvidenceCardV2, EvidenceCardsV2Dataset } from "../cards/schema.js";
import type { MaterialQADatasetV1, MaterialQaItemV1 } from "../qa/schema.js";
import { selectorContractVersion } from "../selector/contract.js";

import { renderPackCardCandidateMarkdown } from "../prompts/pack.js";
import type { TextWindowV1, TimeWindowV1, SectionPackQaV1, SectionPackV1 } from "./schema.js";
import { validateSectionPackV1 } from "./schema.js";

export type SectionBlueprintInputV1 = {
  sectionId: string;
  title: string;
  timeWindow: TimeWindowV1;
  textWindow: TextWindowV1;
  keywords?: string[];
  mustIncludeCardIds?: string[];
  maxCards?: number;
  maxQa?: number;
};

export type BlueprintForSectionPacksV1 = {
  version: number;
  blueprintRef: SectionPackV1["blueprintRef"];
  sections: SectionBlueprintInputV1[];
  constraints?: Partial<SectionPackV1["constraints"]>;
};

export type PackRankCandidate = {
  cardId: string;
  baseScore: number;
  markdown: string;
};

export type PackRanker = (params: {
  section: SectionBlueprintInputV1;
  candidates: PackRankCandidate[];
}) => Promise<string[] | null | undefined> | string[] | null | undefined;

function normalizedKeywords(keywords?: string[]): string[] {
  return Array.isArray(keywords)
    ? keywords.map((keyword) => keyword.trim().toLowerCase()).filter((keyword) => keyword.length > 0)
    : [];
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lowered = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (lowered.includes(keyword)) hits += 1;
  }
  return hits;
}

function cardBaseScore(card: EvidenceCardV2, keywords: string[]): number {
  const factHits = countKeywordHits(card.fact, keywords);
  const quoteHits = countKeywordHits(card.selectorBundle.quote.exact, keywords);
  const keywordHits = factHits + quoteHits;
  const levelScore = card.level === "direct" ? 5 : 0;
  return keywordHits * 100 + levelScore + card.confidence;
}

function qaBaseScore(item: MaterialQaItemV1, keywords: string[]): number {
  const questionHits = countKeywordHits(item.question, keywords);
  const answerHits = countKeywordHits(item.answer, keywords);
  const answerTypeScore = item.answerType === "direct" ? 5 : item.answerType === "inference" ? 2 : 0;
  return (questionHits + answerHits) * 100 + answerTypeScore;
}

function stableCardOrder(cards: EvidenceCardV2[], keywords: string[]): EvidenceCardV2[] {
  return [...cards].sort((left, right) => {
    const byScore = cardBaseScore(right, keywords) - cardBaseScore(left, keywords);
    if (byScore !== 0) return byScore;
    return left.cardId.localeCompare(right.cardId, "en");
  });
}

function stableQaOrder(items: MaterialQaItemV1[], keywords: string[]): MaterialQaItemV1[] {
  return [...items].sort((left, right) => {
    const byScore = qaBaseScore(right, keywords) - qaBaseScore(left, keywords);
    if (byScore !== 0) return byScore;
    return left.qaId.localeCompare(right.qaId, "en");
  });
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

function defaultConstraints(blueprint: BlueprintForSectionPacksV1): SectionPackV1["constraints"] {
  return {
    finalMissingGapsBlock: blueprint.constraints?.finalMissingGapsBlock ?? true,
    noNewClaims: blueprint.constraints?.noNewClaims ?? true,
  };
}

async function rankCards(params: {
  section: SectionBlueprintInputV1;
  candidates: EvidenceCardV2[];
  keywords: string[];
  ranker?: PackRanker;
}): Promise<EvidenceCardV2[]> {
  const ordered = stableCardOrder(params.candidates, params.keywords);
  if (!params.ranker || ordered.length <= 1) return ordered;

  const candidates = ordered.map((card) => ({
    cardId: card.cardId,
    baseScore: cardBaseScore(card, params.keywords),
    markdown: renderPackCardCandidateMarkdown({
      sectionTitle: params.section.title,
      timeWindow: params.section.timeWindow,
      textWindow: params.section.textWindow,
      card,
    }),
  }));

  const rankedIds = await params.ranker({ section: params.section, candidates });
  if (!rankedIds || rankedIds.length === 0) return ordered;

  const rankIndex = new Map<string, number>();
  for (let i = 0; i < rankedIds.length; i += 1) {
    const cardId = rankedIds[i]?.trim();
    if (!cardId || rankIndex.has(cardId)) continue;
    rankIndex.set(cardId, i);
  }

  return [...ordered].sort((left, right) => {
    const leftIdx = rankIndex.get(left.cardId);
    const rightIdx = rankIndex.get(right.cardId);
    const leftHas = typeof leftIdx === "number";
    const rightHas = typeof rightIdx === "number";
    if (leftHas && rightHas && leftIdx !== rightIdx) return leftIdx - rightIdx;
    if (leftHas !== rightHas) return leftHas ? -1 : 1;
    const byScore = cardBaseScore(right, params.keywords) - cardBaseScore(left, params.keywords);
    if (byScore !== 0) return byScore;
    return left.cardId.localeCompare(right.cardId, "en");
  });
}

export async function buildSectionPacks(params: {
  blueprint: BlueprintForSectionPacksV1;
  cards: EvidenceCardsV2Dataset;
  qa?: MaterialQADatasetV1 | null;
  defaultMaxCards?: number;
  defaultMaxQa?: number;
  ranker?: PackRanker;
}): Promise<SectionPackV1[]> {
  if (params.cards.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `cards selectorContractVersion mismatch: got ${params.cards.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }
  if (params.qa && params.qa.selectorContractVersion !== selectorContractVersion) {
    throw new Error(`qa selectorContractVersion mismatch: got ${params.qa.selectorContractVersion}, expected ${selectorContractVersion}`);
  }

  const defaultMaxCards = clampCount(params.defaultMaxCards, 6, 6);
  const defaultMaxQa = clampCount(params.defaultMaxQa, 12, 12);
  const cardsById = new Map(params.cards.cards.map((card) => [card.cardId, card] as const));
  const packs: SectionPackV1[] = [];

  for (const section of params.blueprint.sections) {
    const keywords = normalizedKeywords(section.keywords);
    const mustInclude = Array.isArray(section.mustIncludeCardIds)
      ? section.mustIncludeCardIds.map((cardId) => cardId.trim()).filter((cardId) => cardId.length > 0)
      : [];

    for (const cardId of mustInclude) {
      if (!cardsById.has(cardId)) {
        throw new Error(`section ${section.sectionId} references missing mustIncludeCardId: ${cardId}`);
      }
    }

    const keywordMatched = keywords.length
      ? params.cards.cards.filter((card) => countKeywordHits(`${card.fact}\n${card.selectorBundle.quote.exact}`, keywords) > 0)
      : [...params.cards.cards];

    const candidateMap = new Map<string, EvidenceCardV2>();
    for (const card of keywordMatched) candidateMap.set(card.cardId, card);
    for (const cardId of mustInclude) candidateMap.set(cardId, cardsById.get(cardId)!);
    if (candidateMap.size === 0) {
      for (const card of params.cards.cards) candidateMap.set(card.cardId, card);
    }

    const rankedCards = await rankCards({
      section,
      candidates: [...candidateMap.values()],
      keywords,
      ranker: params.ranker,
    });

    const heuristicCardBudget = clampCount(section.maxCards, defaultMaxCards, 6);
    const selectedIds = new Set<string>(mustInclude);
    let addedByHeuristic = 0;
    for (const card of rankedCards) {
      if (selectedIds.has(card.cardId)) continue;
      if (addedByHeuristic >= heuristicCardBudget) break;
      selectedIds.add(card.cardId);
      addedByHeuristic += 1;
    }

    const selectedCards = rankedCards
      .filter((card) => selectedIds.has(card.cardId))
      .map((card) => ({
        cardId: card.cardId,
        selectedEvidenceIds: [card.cardId],
        selectorBundles: [card.selectorBundle],
        resolvedSpans: [card.resolvedSpan],
      }));

    const selectedCardIds = new Set(selectedCards.map((card) => card.cardId));
    const qaCandidates = params.qa?.items.filter((item) => item.evidenceRefs.some((ref) => selectedCardIds.has(ref.cardId))) ?? [];
    const maxQa = clampCount(section.maxQa, defaultMaxQa, 12);
    const selectedQa: SectionPackQaV1[] = stableQaOrder(qaCandidates, keywords)
      .slice(0, maxQa)
      .map((item) => ({
        qaId: item.qaId,
        question: item.question,
        answer: item.answer,
        evidenceRefs: item.evidenceRefs.filter((ref) => selectedCardIds.has(ref.cardId)),
      }));

    const packId = `pack_${sha256Hex(stableJsonStringify({
      sectionId: section.sectionId,
      cards: selectedCards.map((card) => card.cardId),
      qa: selectedQa.map((item) => item.qaId),
    })).slice(0, 16)}`;

    const pack: SectionPackV1 = {
      version: 1,
      createdAt: new Date().toISOString(),
      packId,
      blueprintRef: params.blueprint.blueprintRef,
      sectionId: section.sectionId,
      timeWindow: section.timeWindow,
      textWindow: section.textWindow,
      cards: selectedCards,
      qa: selectedQa,
      constraints: defaultConstraints(params.blueprint),
    };

    const issues = validateSectionPackV1(pack);
    if (issues.length > 0) {
      throw new Error(`invalid section pack for ${section.sectionId}: ${issues.join("; ")}`);
    }
    packs.push(pack);
  }

  return packs;
}
