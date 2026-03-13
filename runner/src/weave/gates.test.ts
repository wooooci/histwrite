import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "../selector/contract.js";
import { runWeaveGates } from "./gates.js";

async function writeFixture(root: string, wovenDraft: string) {
  const materialsIndexDir = path.join(root, "材料", "_index");
  const artifactsDir = path.join(root, ".histwrite", "artifacts");
  const draftDir = path.join(root, "正文");
  await fs.mkdir(materialsIndexDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(draftDir, { recursive: true });

  const materialsPath = path.join(materialsIndexDir, "materials.v2.json");
  const cardsPath = path.join(artifactsDir, "cards.v2.json");
  const packPath = path.join(artifactsDir, "section.s1.pack.v1.json");
  const draftPath = path.join(draftDir, "section.s1.woven.md");

  await fs.writeFile(
    materialsPath,
    `${JSON.stringify(
      {
        version: 2,
        selectorContractVersion,
        materials: [
          {
            materialId: "m1",
            provenance: {
              kind: "archive",
              title: "材料一",
              sourcePath: "/tmp/m1.txt",
              sourceSha256: "m1",
              textPath: "/tmp/m1.txt",
              textSha256: "m1",
            },
            rawText: "1902年地方财政调整已经开始。",
            normText: "1902年地方财政调整已经开始。",
            indexText: "1902年地方财政调整已经开始。",
            selectorContractVersion,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    cardsPath,
    `${JSON.stringify(
      {
        version: 2,
        createdAt: "2026-03-12T00:00:00.000Z",
        selectorContractVersion,
        cards: [
          {
            cardId: "c1",
            materialId: "m1",
            fact: "材料记载地方财政调整已经开始。",
            level: "direct",
            confidence: 0.95,
            selectorBundle: {
              quote: {
                type: "TextQuoteSelector",
                layer: "rawText",
                exact: "地方财政调整",
              },
            },
            resolvedSpan: {
              rawStart: 5,
              rawEnd: 11,
              extractedExactRaw: "地方财政调整",
              method: "quote_anchored",
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(
    packPath,
    `${JSON.stringify(
      {
        version: 1,
        createdAt: "2026-03-12T00:00:00.000Z",
        packId: "pack_weave",
        blueprintRef: {
          artifactId: "sha256:blueprint",
          sha256: "blueprint",
          path: "/tmp/blueprint.json",
          builtAt: "2026-03-12T00:00:00.000Z",
        },
        sectionId: "s1",
        timeWindow: { start: "1900", end: "1905" },
        textWindow: { topic: "财政调整" },
        cards: [
          {
            cardId: "c1",
            selectedEvidenceIds: ["c1"],
            selectorBundles: [
              {
                quote: {
                  type: "TextQuoteSelector",
                  layer: "rawText",
                  exact: "地方财政调整",
                },
              },
            ],
            resolvedSpans: [
              {
                rawStart: 5,
                rawEnd: 11,
                extractedExactRaw: "地方财政调整",
                method: "quote_anchored",
              },
            ],
          },
        ],
        qa: [],
        constraints: { finalMissingGapsBlock: true, noNewClaims: true },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await fs.writeFile(draftPath, `${wovenDraft}\n`, "utf8");

  return { materialsPath, cardsPath, packPath, draftPath };
}

describe("runWeaveGates", () => {
  it("re-runs verify and writes reports after a valid weave", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-weave-gates-pass-"));
    const beforeDraft = "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕";
    const { materialsPath, cardsPath, packPath, draftPath } = await writeFixture(
      root,
      ["背景句。", beforeDraft, "收束句。"].join("\n"),
    );

    const out = await runWeaveGates({
      projectDir: root,
      beforeDraft,
      wovenDraftPath: draftPath,
      packPath,
      materialsPath,
      cardsPath,
      mode: "final",
    });

    expect(out.claimDiff.addedClaims).toBe(0);
    expect(out.verify.status).toBe("passed");
    await expect(fs.access(out.verify.factcheck.path)).resolves.toBeUndefined();
    await expect(fs.access(out.verify.chronology.path)).resolves.toBeUndefined();
  });

  it("blocks when woven output introduces new claims", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-weave-gates-added-"));
    const beforeDraft = "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕";
    const { materialsPath, cardsPath, packPath, draftPath } = await writeFixture(
      root,
      [beforeDraft, "〔claim:c2|kind=causal|ev=c1:c1〕新增主张。〔/claim〕"].join("\n"),
    );

    await expect(
      runWeaveGates({
        projectDir: root,
        beforeDraft,
        wovenDraftPath: draftPath,
        packPath,
        materialsPath,
        cardsPath,
        mode: "final",
      }),
    ).rejects.toThrow(/added claim anchors/i);
  });
});
