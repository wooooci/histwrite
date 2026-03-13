import { describe, expect, it } from "vitest";

import type { ClaimMapItemV1 } from "../artifacts/claims.js";
import { buildClaimSet } from "../artifacts/claims.js";
import { diffClaimSets } from "./diff.js";

function makeClaim(params: {
  claimId: string;
  kind?: string;
  text: string;
  evidenceRef?: string;
}): ClaimMapItemV1 {
  const [cardId, evidenceId] = (params.evidenceRef ?? "c1:e0").split(":");
  return {
    claimId: params.claimId,
    kind: params.kind ?? "fact",
    text: params.text,
    evidenceRefs: [
      {
        cardId: cardId ?? "c1",
        evidenceId: evidenceId ?? "e0",
        raw: `${cardId ?? "c1"}:${evidenceId ?? "e0"}`,
        valid: true,
      },
    ],
    riskFlags: [],
  };
}

describe("diffClaimSets", () => {
  it("does not report added claims when the same claim ids are preserved", () => {
    const before = buildClaimSet([
      makeClaim({ claimId: "c1", text: "税制改革推动了财政调整。" }),
      makeClaim({ claimId: "c2", text: "1902年出现了新的财政安排。", evidenceRef: "c2:e0" }),
    ]);
    const after = buildClaimSet([
      makeClaim({ claimId: "c2", text: "1902年出现了新的财政安排。", evidenceRef: "c2:e0" }),
      makeClaim({ claimId: "c1", text: "税制改革推动了财政调整。" }),
    ]);

    const diff = diffClaimSets({ before, after });

    expect(diff.added).toEqual([]);
    expect(diff.addedClaims).toBe(0);
    expect(diff.ok).toBe(true);
  });

  it("reports newly added claim ids as blockers", () => {
    const before = buildClaimSet([makeClaim({ claimId: "c1", text: "税制改革推动了财政调整。" })]);
    const after = buildClaimSet([
      makeClaim({ claimId: "c1", text: "税制改革推动了财政调整。" }),
      makeClaim({ claimId: "c3", text: "新的税额在次年继续上升。", evidenceRef: "c3:e0" }),
    ]);

    const diff = diffClaimSets({ before, after });

    expect(diff.addedClaims).toBe(1);
    expect(diff.added).toEqual([
      {
        claimId: "c3",
        signature: buildClaimSet([makeClaim({ claimId: "c3", text: "新的税额在次年继续上升。", evidenceRef: "c3:e0" })]).claims[0]?.signature,
      },
    ]);
    expect(diff.ok).toBe(false);
  });

  it("tracks changed signatures separately without counting them as added claims", () => {
    const before = buildClaimSet([makeClaim({ claimId: "c1", text: "税制改革推动了财政调整。" })]);
    const after = buildClaimSet([makeClaim({ claimId: "c1", text: "税制改革可能推动了财政调整。" })]);

    const diff = diffClaimSets({ before, after });

    expect(diff.addedClaims).toBe(0);
    expect(diff.changedClaims).toBe(1);
    expect(diff.changed[0]).toMatchObject({ claimId: "c1" });
  });
});
