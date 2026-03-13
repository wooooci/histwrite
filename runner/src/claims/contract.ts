export const claimAnchorOpenPrefix = "〔claim:";
export const claimAnchorCloseTag = "〔/claim〕";

export type ClaimEvidenceRef = {
  cardId: string;
  evidenceId: string;
  raw: string;
};

export type ClaimAnchor = {
  claimId: string;
  kind: string;
  evidenceRefs: ClaimEvidenceRef[];
  openTag: string;
  closeTag: string;
  openTagStart: number;
  openTagEnd: number;
  textStart: number;
  textEnd: number;
  closeTagStart: number;
  closeTagEnd: number;
  spanText: string;
};

export type ClaimAnchorParseErrorCode =
  | "invalid_open_tag"
  | "missing_kind"
  | "missing_evidence_refs"
  | "invalid_evidence_ref"
  | "nested_claim"
  | "unexpected_close"
  | "unclosed_claim";

