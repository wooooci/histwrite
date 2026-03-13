import type { ClaimMapV1 } from "../artifacts/claims.js";
import type { MaterialsV2Dataset } from "../artifacts/materials.js";
import { buildFactCheckReportV1 } from "../artifacts/reports.js";
import type { EvidenceCardsV2Dataset } from "../cards/schema.js";
import { normalizeSelectorBundle, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";
import type { FactCheckItemV1, FactCheckReportV1, GateIssueV1, WorkOrderV1 } from "./schema.js";

function blocker(reason: string, claimId: string, detail?: string): GateIssueV1 {
  return { severity: "blocker", reason, claimId, ...(detail ? { detail } : {}) };
}

function warning(reason: string, claimId: string, detail?: string): GateIssueV1 {
  return { severity: "warning", reason, claimId, ...(detail ? { detail } : {}) };
}

function workOrder(action: WorkOrderV1["action"], targetClaimId: string, instructions: string): WorkOrderV1 {
  return { action, targetClaimId, instructions };
}

export function runFactCheckGate(params: {
  materials: MaterialsV2Dataset;
  cards: EvidenceCardsV2Dataset;
  claims: ClaimMapV1;
  mode?: "draft" | "final";
}): FactCheckReportV1 {
  if (params.materials.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `materials selectorContractVersion mismatch: got ${params.materials.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }
  if (params.cards.selectorContractVersion !== selectorContractVersion) {
    throw new Error(
      `cards selectorContractVersion mismatch: got ${params.cards.selectorContractVersion}, expected ${selectorContractVersion}`,
    );
  }

  const mode = params.mode ?? "draft";
  const cardsById = new Map(params.cards.cards.map((card) => [card.cardId, card] as const));
  const materialsById = new Map(params.materials.materials.map((material) => [material.materialId, material] as const));

  const items: FactCheckItemV1[] = params.claims.claims.map((claim) => {
    if (!claim.evidenceRefs.length) {
      return {
        claimId: claim.claimId,
        status: "unsupported",
        evidenceAlignment: "missing",
        issues: [blocker("claim missing evidenceRefs", claim.claimId)],
        minimalFix: workOrder("needs_more_evidence", claim.claimId, "补充至少一条可解析的 evidence ref。"),
      };
    }

    const issues: GateIssueV1[] = [];
    let evidenceAlignment: FactCheckItemV1["evidenceAlignment"] = "aligned";
    let hasInferenceOnlyEvidence = true;
    let hasAnyDirectEvidence = false;

    for (const ref of claim.evidenceRefs) {
      if (!ref.valid) {
        issues.push(blocker("invalid evidence ref", claim.claimId, ref.raw));
        evidenceAlignment = "invalid";
        continue;
      }

      const card = cardsById.get(ref.cardId);
      if (!card) {
        issues.push(blocker("missing evidence card", claim.claimId, ref.raw));
        evidenceAlignment = "invalid";
        continue;
      }

      const material = materialsById.get(card.materialId);
      if (!material) {
        issues.push(blocker("missing material for evidence card", claim.claimId, ref.raw));
        evidenceAlignment = "invalid";
        continue;
      }

      if (card.level === "direct") {
        hasAnyDirectEvidence = true;
        hasInferenceOnlyEvidence = false;
      }

      const selector = normalizeSelectorBundle(card.selectorBundle);
      const resolved = resolveSelector({ rawText: material.rawText, selector });
      if (resolved.method === "unresolvable") {
        issues.push(blocker("unresolvable evidence selector", claim.claimId, resolved.reason ?? ref.raw));
        evidenceAlignment = "invalid";
        continue;
      }

      if (resolved.method === "quote_anchored_ambiguous") {
        issues.push(
          mode === "final"
            ? blocker("ambiguous evidence selector", claim.claimId, resolved.reason ?? ref.raw)
            : warning("ambiguous evidence selector", claim.claimId, resolved.reason ?? ref.raw),
        );
        evidenceAlignment = "ambiguous";
      }

      if (claim.kind === "quote" && (card.level !== "direct" || !resolved.extractedExactRaw)) {
        issues.push(
          blocker(
            "quote claim requires direct evidence with extractedExactRaw",
            claim.claimId,
            `${card.cardId}:${card.level}`,
          ),
        );
        evidenceAlignment = "invalid";
      }
    }

    const hasBlocker = issues.some((issue) => issue.severity === "blocker");
    const hasAmbiguous = issues.some((issue) => issue.reason === "ambiguous evidence selector");

    if (hasBlocker && evidenceAlignment === "ambiguous" && !issues.some((issue) => issue.reason !== "ambiguous evidence selector")) {
      return {
        claimId: claim.claimId,
        status: "contested",
        evidenceAlignment,
        issues,
        minimalFix: workOrder("add_contested", claim.claimId, "为歧义证据补充限定语或对立解释，并保留 claim anchor。"),
      };
    }

    if (hasBlocker) {
      return {
        claimId: claim.claimId,
        status: "unsupported",
        evidenceAlignment,
        issues,
        minimalFix: workOrder(
          claim.kind === "quote" ? "downgrade" : "needs_more_evidence",
          claim.claimId,
          claim.kind === "quote" ? "将直接引语降格为转述或补充直接证据。" : "补充可验证 evidence ref，或删去该主张。",
        ),
      };
    }

    if (hasAmbiguous) {
      return {
        claimId: claim.claimId,
        status: "contested",
        evidenceAlignment,
        issues,
        minimalFix: workOrder("add_contested", claim.claimId, "补充争议说明或加上更强 selector 上下文。"),
      };
    }

    return {
      claimId: claim.claimId,
      status: hasInferenceOnlyEvidence && !hasAnyDirectEvidence ? "inference_ok" : "supported",
      evidenceAlignment,
      issues,
    };
  });

  return buildFactCheckReportV1({ items });
}
