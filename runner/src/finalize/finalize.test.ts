import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "../selector/contract.js";
import { ensureHistwriteProject } from "../project.js";
import { runFinalizeCommand } from "./finalize.js";

async function writeFinalizeFixture(root: string, draftText: string) {
  const layout = await ensureHistwriteProject(root);
  const materialsPath = path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = path.join(layout.artifactsDir, "cards.v2.json");
  const packPath = path.join(layout.artifactsDir, "section.s1.pack.v1.json");
  const draftPath = path.join(layout.draftDir, "section.s1.md");

  const selectorBundle = {
    quote: {
      type: "TextQuoteSelector",
      layer: "rawText",
      exact: "地方财政调整",
    },
  };

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
            selectorBundle,
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
        packId: "pack_finalize",
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
            selectorBundles: [selectorBundle],
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

  await fs.writeFile(draftPath, `${draftText}\n`, "utf8");

  return { layout, materialsPath, cardsPath, packPath, draftPath };
}

describe("runFinalizeCommand", () => {
  it("runs weave → verify → polish → verify → finalcheck → export in order", async () => {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      calls += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages?: Array<{ content?: string }> };
      const prompt = body.messages?.map((message) => String(message.content ?? "")).join("\n") ?? "";
      const placeholder = prompt.match(/\[\[\[HISTWRITE_CLAIM_BLOCK_\d+\]\]\]/)?.[0] ?? "";

      const content =
        calls === 1
          ? ["导语。", "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕", "结语。"].join("\n")
          : ["润色后的导语。", placeholder, "润色后的结语。"].join("\n");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-finalize-pass-"));
      const { layout, materialsPath, cardsPath, packPath, draftPath } = await writeFinalizeFixture(
        root,
        "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕",
      );

      const result = await runFinalizeCommand({
        layout,
        packPath,
        draftPath,
        materialsPath,
        cardsPath,
        mode: "final",
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "finalize-model",
          endpoint: "chat",
        },
      });

      expect(result.ok).toBe(true);
      expect(result.steps.map((item) => item.step)).toEqual([
        "weave",
        "verify_after_weave",
        "polish",
        "verify_after_polish",
        "finalcheck",
        "export",
      ]);
      expect(result.verifyAfterPolish.status).toBe("passed");
      expect(result.finalcheck.blockers).toBe(0);
      expect(calls).toBe(2);
      await expect(fs.readFile(result.finalMarkdownPath, "utf8")).resolves.toContain("润色后的导语。");
      await expect(fs.access(path.join(result.exportBundle.outDir, "Final.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "reports", "factcheck.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "artifact-heads.json"))).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("stops immediately and returns next actions when verify after weave still has blockers", async () => {
    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      calls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "〔claim:c1|kind=causal|ev=c1:c1〕1910年地方财政调整已经开始。〔/claim〕",
              },
            },
          ],
        }),
      );
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-finalize-fail-"));
      const { layout, materialsPath, cardsPath, packPath, draftPath } = await writeFinalizeFixture(
        root,
        "〔claim:c1|kind=causal|ev=c1:c1〕1910年地方财政调整已经开始。〔/claim〕",
      );

      const result = await runFinalizeCommand({
        layout,
        packPath,
        draftPath,
        materialsPath,
        cardsPath,
        mode: "final",
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "finalize-model",
          endpoint: "chat",
        },
      });

      expect(result.ok).toBe(false);
      expect(result.failedStep).toBe("verify_after_weave");
      expect(result.nextActions).toContain("标注回溯/前史/后果视角，或把该叙述移出当前 section。");
      expect(result.steps.map((item) => item.step)).toEqual(["weave", "verify_after_weave"]);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
