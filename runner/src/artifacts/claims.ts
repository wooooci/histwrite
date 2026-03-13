import { sha256Hex, stableJsonStringify } from "../cache.js";

export type ClaimMapEvidenceRefV1 = {
  cardId: string;
  evidenceId: string;
  raw: string;
  valid: boolean;
};

export type ClaimMapItemV1 = {
  claimId: string;
  kind: string;
  text: string;
  evidenceRefs: ClaimMapEvidenceRefV1[];
  timeHint?: string;
  riskFlags: string[];
};

export type ClaimSetItemV1 = {
  claimId: string;
  signature: string;
};

export type ClaimSetV1 = {
  version: 1;
  claims: ClaimSetItemV1[];
};

export type ClaimMapV1 = {
  version: 1;
  claims: ClaimMapItemV1[];
  claimSet: ClaimSetV1;
};

export type ClaimsArtifactV1 = ClaimMapV1 & {
  createdAt: string;
  draftPath: string;
  packPath?: string;
  packId?: string;
  sectionId?: string;
};

export function buildClaimSignature(item: ClaimMapItemV1): string {
  const payload = stableJsonStringify({
    claimId: item.claimId,
    kind: item.kind,
    text: item.text,
    evidenceRefs: item.evidenceRefs.map((ref) => ({
      cardId: ref.cardId,
      evidenceId: ref.evidenceId,
      raw: ref.raw,
    })),
    timeHint: item.timeHint ?? null,
  });
  return `sha256:${sha256Hex(payload)}`;
}

export function buildClaimSet(claims: ClaimMapItemV1[]): ClaimSetV1 {
  const items = claims
    .map((item) => ({
      claimId: item.claimId,
      signature: buildClaimSignature(item),
    }))
    .sort((left, right) => {
      const byId = left.claimId.localeCompare(right.claimId);
      if (byId !== 0) return byId;
      return left.signature.localeCompare(right.signature);
    });

  return {
    version: 1,
    claims: items,
  };
}

export function buildClaimMapV1(claims: ClaimMapItemV1[]): ClaimMapV1 {
  return {
    version: 1,
    claims,
    claimSet: buildClaimSet(claims),
  };
}

export function buildClaimsArtifactV1(params: {
  claims: ClaimMapItemV1[];
  draftPath: string;
  packPath?: string | null;
  packId?: string | null;
  sectionId?: string | null;
  createdAt?: string;
}): ClaimsArtifactV1 {
  const claimMap = buildClaimMapV1(params.claims);
  return {
    ...claimMap,
    createdAt: params.createdAt ?? new Date().toISOString(),
    draftPath: params.draftPath,
    ...(params.packPath ? { packPath: params.packPath } : {}),
    ...(params.packId ? { packId: params.packId } : {}),
    ...(params.sectionId ? { sectionId: params.sectionId } : {}),
  };
}
