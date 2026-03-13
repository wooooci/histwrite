import type { MaterialKind } from "../indexing.js";
import { selectorContractVersion } from "../selector/contract.js";
import { normalizeV1 } from "../selector/normalize.js";

export type MaterialProvenanceV2 = {
  kind: MaterialKind;
  title: string;
  sourcePath: string;
  sourceSha256: string;
  textPath: string | null;
  textSha256: string | null;
};

export type MaterialV2 = {
  materialId: string;
  provenance: MaterialProvenanceV2;
  rawText: string;
  normText: string;
  indexText: string;
  selectorContractVersion: number;
};

export type MaterialsV2Dataset = {
  version: 2;
  selectorContractVersion: number;
  materials: MaterialV2[];
};

export function buildMaterialV2(params: {
  materialId: string;
  provenance: MaterialProvenanceV2;
  rawText: string;
}): MaterialV2 {
  const normText = normalizeV1(params.rawText);
  const indexText = normText;
  return {
    materialId: params.materialId,
    provenance: params.provenance,
    rawText: params.rawText,
    normText,
    indexText,
    selectorContractVersion,
  };
}

export function buildMaterialsV2Dataset(materials: MaterialV2[]): MaterialsV2Dataset {
  return {
    version: 2,
    selectorContractVersion,
    materials,
  };
}

