import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "../selector/contract.js";
import { buildMaterialV2, buildMaterialsV2Dataset } from "./materials.js";

describe("MaterialsV2 schema + dataset", () => {
  it("computes normText via normalizeV1 and carries selectorContractVersion", () => {
    const m = buildMaterialV2({
      materialId: "m_test",
      provenance: {
        kind: "txt",
        title: "t",
        sourcePath: "材料/x.txt",
        sourceSha256: "sha",
        textPath: "材料/_index/text/m_test.txt",
        textSha256: "sha2",
      },
      rawText: "\uFEFFa\r\nb\u00A0c\r",
    });

    expect(m.selectorContractVersion).toBe(selectorContractVersion);
    expect(m.normText).toBe("a\nb c\n");
    expect(m.indexText).toBe(m.normText);
  });

  it("wraps dataset with version + selectorContractVersion", () => {
    const ds = buildMaterialsV2Dataset([
      buildMaterialV2({
        materialId: "m1",
        provenance: {
          kind: "txt",
          title: "t",
          sourcePath: "材料/x.txt",
          sourceSha256: "sha",
          textPath: "材料/_index/text/m1.txt",
          textSha256: "sha2",
        },
        rawText: "x",
      }),
    ]);

    expect(ds.version).toBe(2);
    expect(ds.selectorContractVersion).toBe(selectorContractVersion);
    expect(ds.materials.length).toBe(1);
    expect(ds.materials[0]?.materialId).toBe("m1");
  });
});
