import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "../selector/contract.js";
import { ensureHistwriteProject } from "../project.js";
import { runWeaveCommand } from "./command.js";

async function writeFixture(root: string) {
  const layout = await ensureHistwriteProject(root);
  const materialsPath = path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = path.join(layout.artifactsDir, "cards.v2.json");
  const packPath = path.join(layout.artifactsDir, "section.s1.pack.v1.json");
  const draftPath = path.join(layout.draftDir, "section.s1.md");

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
        packId: "pack_weave_cmd",
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

  await fs.writeFile(
    draftPath,
    "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕\n",
    "utf8",
  );

  return { layout, materialsPath, cardsPath, packPath, draftPath };
}

describe("runWeaveCommand", () => {
  it("writes the woven draft and re-verifies it", async () => {
    const server = createServer((req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  "背景句。",
                  "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕",
                  "收束句。",
                ].join("\n"),
              },
            },
          ],
        }),
      );
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
      server.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-weave-command-"));
      const { layout, materialsPath, cardsPath, packPath, draftPath } = await writeFixture(root);
      const outPath = path.join(layout.draftDir, "section.s1.woven.md");

      const out = await runWeaveCommand({
        layout,
        packPath,
        draftPath,
        outPath,
        materialsPath,
        cardsPath,
        mode: "final",
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "weave-model",
          endpoint: "chat",
        },
      });

      expect(out.outPath).toBe(outPath);
      expect(out.claimDiff.addedClaims).toBe(0);
      expect(out.verify.status).toBe("passed");
      await expect(fs.readFile(outPath, "utf8")).resolves.toContain("背景句。");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
