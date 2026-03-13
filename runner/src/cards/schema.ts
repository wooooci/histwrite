import type { SelectorBundle } from "../selector/contract.js";
import type { ResolvedSpan } from "../selector/resolve.js";

export type EvidenceLevel = "direct" | "inference";

export type EvidenceCardV2 = {
  cardId: string;
  materialId: string;
  fact: string;
  level: EvidenceLevel;
  confidence: number;
  selectorBundle: SelectorBundle;
  resolvedSpan: ResolvedSpan;
  notes?: string;
};

export type EvidenceCardsV2Dataset = {
  version: 2;
  createdAt: string;
  selectorContractVersion: number;
  cards: EvidenceCardV2[];
  gaps?: Array<{ materialId: string; reason: string; item: unknown }>;
};

