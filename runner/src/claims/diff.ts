import type { ClaimSetItemV1, ClaimSetV1 } from "../artifacts/claims.js";

export type ClaimSetChangeV1 = {
  claimId: string;
  before: ClaimSetItemV1;
  after: ClaimSetItemV1;
};

export type ClaimSetDiffV1 = {
  version: 1;
  added: ClaimSetItemV1[];
  removed: ClaimSetItemV1[];
  changed: ClaimSetChangeV1[];
  addedClaims: number;
  removedClaims: number;
  changedClaims: number;
  ok: boolean;
};

function indexClaimSet(claimSet: ClaimSetV1): Map<string, ClaimSetItemV1> {
  const indexed = new Map<string, ClaimSetItemV1>();
  for (const item of claimSet.claims) {
    indexed.set(item.claimId, item);
  }
  return indexed;
}

export function diffClaimSets(params: {
  before: ClaimSetV1;
  after: ClaimSetV1;
}): ClaimSetDiffV1 {
  const beforeIndex = indexClaimSet(params.before);
  const afterIndex = indexClaimSet(params.after);

  const added: ClaimSetItemV1[] = [];
  const removed: ClaimSetItemV1[] = [];
  const changed: ClaimSetChangeV1[] = [];

  for (const item of params.after.claims) {
    const previous = beforeIndex.get(item.claimId);
    if (!previous) {
      added.push(item);
      continue;
    }
    if (previous.signature !== item.signature) {
      changed.push({ claimId: item.claimId, before: previous, after: item });
    }
  }

  for (const item of params.before.claims) {
    if (!afterIndex.has(item.claimId)) {
      removed.push(item);
    }
  }

  added.sort((left, right) => left.claimId.localeCompare(right.claimId));
  removed.sort((left, right) => left.claimId.localeCompare(right.claimId));
  changed.sort((left, right) => left.claimId.localeCompare(right.claimId));

  return {
    version: 1,
    added,
    removed,
    changed,
    addedClaims: added.length,
    removedClaims: removed.length,
    changedClaims: changed.length,
    ok: added.length === 0,
  };
}
