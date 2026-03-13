import type { MaterialsV2Dataset } from "../artifacts/materials.js";
import type { EvidenceCardsV2Dataset } from "../cards/schema.js";
import { normalizeSelectorBundle, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";

import type { MaterialQADatasetV1 } from "./schema.js";

export type QaQualityIssueSeverity = "blocker" | "warning";

export type QaQualityIssueV1 = {
  severity: QaQualityIssueSeverity;
  qaId: string;
  reason: string;
  evidenceRefIndex?: number;
  cardId?: string;
  materialId?: string;
};

export type QaQualityGateReportV1 = {
  version: 1;
  createdAt: string;
  selectorContractVersion: number;
  items: number;
  blockers: number;
  warnings: number;
  issues: QaQualityIssueV1[];
};

export function runQaQualityGate(params: {
  materials: MaterialsV2Dataset;
  cards: EvidenceCardsV2Dataset;
  qa: MaterialQADatasetV1;
}): QaQualityGateReportV1 {
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
  if (params.qa.selectorContractVersion !== selectorContractVersion) {
    throw new Error(`qa selectorContractVersion mismatch: got ${params.qa.selectorContractVersion}, expected ${selectorContractVersion}`);
  }

  const materialsById = new Map(params.materials.materials.map((m) => [m.materialId, m] as const));
  const cardsById = new Map(params.cards.cards.map((c) => [c.cardId, c] as const));

  const issues: QaQualityIssueV1[] = [];

  for (const item of params.qa.items) {
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0) {
      issues.push({
        severity: "blocker",
        qaId: item.qaId,
        reason: "qa item missing evidenceRefs (must bind at least one evidence selector)",
      });
      continue;
    }

    for (let i = 0; i < item.evidenceRefs.length; i += 1) {
      const ref = item.evidenceRefs[i]!;

      const card = cardsById.get(ref.cardId);
      if (!card) {
        issues.push({
          severity: "blocker",
          qaId: item.qaId,
          reason: `missing card: ${ref.cardId}`,
          evidenceRefIndex: i,
          cardId: ref.cardId,
          materialId: ref.materialId,
        });
        continue;
      }

      if (ref.materialId !== card.materialId) {
        issues.push({
          severity: "blocker",
          qaId: item.qaId,
          reason: `evidenceRef.materialId mismatch: ${ref.materialId} != ${card.materialId}`,
          evidenceRefIndex: i,
          cardId: ref.cardId,
          materialId: ref.materialId,
        });
        continue;
      }

      const material = materialsById.get(ref.materialId);
      if (!material) {
        issues.push({
          severity: "blocker",
          qaId: item.qaId,
          reason: `missing material: ${ref.materialId}`,
          evidenceRefIndex: i,
          cardId: ref.cardId,
          materialId: ref.materialId,
        });
        continue;
      }

      const selector = normalizeSelectorBundle(ref.selectorBundle);
      const resolved = resolveSelector({ rawText: material.rawText, selector });

      if (resolved.method === "unresolvable") {
        issues.push({
          severity: "blocker",
          qaId: item.qaId,
          reason: `unresolvable selector: ${resolved.reason ?? "unresolvable"}`,
          evidenceRefIndex: i,
          cardId: ref.cardId,
          materialId: ref.materialId,
        });
        continue;
      }

      if (resolved.method === "quote_anchored_ambiguous") {
        issues.push({
          severity: "warning",
          qaId: item.qaId,
          reason: resolved.reason ?? "ambiguous selector; provide prefix/suffix or manual confirmation",
          evidenceRefIndex: i,
          cardId: ref.cardId,
          materialId: ref.materialId,
        });
      }
    }
  }

  const blockers = issues.filter((i) => i.severity === "blocker").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    selectorContractVersion,
    items: params.qa.items.length,
    blockers,
    warnings,
    issues,
  };
}

