import type { SelectorBundle } from "../selector/contract.js";

export type QaAnswerType = "direct" | "inference" | "gap";

export type QaEvidenceRefV1 = {
  cardId: string;
  materialId: string;
  selectorBundle: SelectorBundle;
};

export type MaterialQaItemV1 = {
  qaId: string;
  question: string;
  answer: string;
  answerType: QaAnswerType;
  evidenceRefs: QaEvidenceRefV1[];
  useInWriting?: string;
  riskFlags?: string[];
};

export type MaterialQADatasetV1 = {
  version: 1;
  createdAt: string;
  selectorContractVersion: number;
  items: MaterialQaItemV1[];
  gaps?: Array<{ cardId: string; materialId: string; reason: string; item: unknown }>;
};

