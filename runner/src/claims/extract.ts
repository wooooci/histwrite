import type { ClaimEvidenceRef } from "./contract.js";
import { parseClaimAnchors } from "./parse.js";
import type { SectionPackV1 } from "../packs/schema.js";
import { buildClaimMapV1, buildClaimSet, type ClaimMapEvidenceRefV1, type ClaimMapItemV1, type ClaimMapV1 } from "../artifacts/claims.js";

function allowedEvidenceRefs(pack: Pick<SectionPackV1, "cards"> | null | undefined): Set<string> | null {
  if (!pack) return null;
  const refs = new Set<string>();
  for (const card of pack.cards) {
    for (const evidenceId of card.selectedEvidenceIds) {
      refs.add(`${card.cardId}:${evidenceId}`);
    }
  }
  return refs;
}

function normalizeClaimText(text: string): string {
  return text.trim();
}

function extractTimeHint(text: string): string | undefined {
  const matched =
    text.match(/\d{4}年(?:\d{1,2}月(?:\d{1,2}日)?)?/u)?.[0] ??
    text.match(/\b\d{4}\b/u)?.[0] ??
    text.match(/(?:同年|次年|此前|此后|其后)/u)?.[0];
  return matched?.trim() || undefined;
}

function mapEvidenceRefs(refs: ClaimEvidenceRef[], allowedRefs: Set<string> | null): ClaimMapEvidenceRefV1[] {
  return refs.map((ref) => {
    const token = `${ref.cardId}:${ref.evidenceId}`;
    return {
      cardId: ref.cardId,
      evidenceId: ref.evidenceId,
      raw: ref.raw,
      valid: allowedRefs ? allowedRefs.has(token) : true,
    };
  });
}

function buildRiskFlags(evidenceRefs: ClaimMapEvidenceRefV1[]): string[] {
  const flags = new Set<string>();
  if (evidenceRefs.some((ref) => !ref.valid)) flags.add("invalid_evidence_ref");
  return [...flags];
}

export function extractClaimMap(params: {
  draft: string;
  pack?: Pick<SectionPackV1, "cards"> | null;
}): ClaimMapV1 {
  const anchors = parseClaimAnchors(params.draft);
  const allowedRefs = allowedEvidenceRefs(params.pack);

  const claims: ClaimMapItemV1[] = anchors.map((anchor) => {
    const evidenceRefs = mapEvidenceRefs(anchor.evidenceRefs, allowedRefs);
    const riskFlags = buildRiskFlags(evidenceRefs);
    const timeHint = extractTimeHint(anchor.spanText);
    return {
      claimId: anchor.claimId,
      kind: anchor.kind,
      text: normalizeClaimText(anchor.spanText),
      evidenceRefs,
      ...(timeHint ? { timeHint } : {}),
      riskFlags,
    };
  });

  return buildClaimMapV1(claims);
}

export { buildClaimSet };
