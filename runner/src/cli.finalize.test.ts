import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { selectorContractVersion } from "./selector/contract.js";

const execFileAsync = promisify(execFile);

async function writeFinalizeFixture(root: string) {
  const materialsIndexDir = path.join(root, "材料", "_index");
  const artifactsDir = path.join(root, ".histwrite", "artifacts");
  const draftDir = path.join(root, "正文");
  await fs.mkdir(materialsIndexDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(draftDir, { recursive: true });

  const materialsPath = path.join(materialsIndexDir, "materials.v2.json");
  const cardsPath = path.join(artifactsDir, "cards.v2.json");
  const packPath = path.join(artifactsDir, "section.s1.pack.v1.json");
  const draftPath = path.join(draftDir, "section.s1.md");

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
        packId: "pack_finalize_cli",
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

  await fs.writeFile(draftPath, "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕\n", "utf8");
  return { materialsPath, cardsPath, packPath, draftPath };
}

describe("histwrite runner cli finalize", () => {
  it("runs the finalize pipeline and exports a bundle", async () => {
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages?: Array<{ content?: string }> };
      const prompt = body.messages?.map((message) => String(message.content ?? "")).join("\n") ?? "";
      const placeholder = prompt.match(/\[\[\[HISTWRITE_CLAIM_BLOCK_\d+\]\]\]/)?.[0] ?? "";

      const content = placeholder
        ? ["润色后的导语。", placeholder, "润色后的结语。"].join("\n")
        : ["导语。", "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕", "结语。"].join("\n");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-finalize-"));
      const { materialsPath, cardsPath, packPath, draftPath } = await writeFinalizeFixture(root);
      const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          cliPath,
          "finalize",
          "--project",
          root,
          "--pack",
          packPath,
          "--draft",
          draftPath,
          "--materials",
          materialsPath,
          "--cards",
          cardsPath,
          "--apiBaseUrl",
          `http://127.0.0.1:${port}`,
          "--model",
          "finalize-model",
          "--endpoint",
          "chat",
          "--json",
        ],
        {
          env: {
            ...process.env,
            OPENAI_API_KEY: "test-key",
          },
        },
      );

      const parsed = JSON.parse(stdout.trim()) as {
        ok: boolean;
        status: "passed" | "failed";
        exportBundle: { outDir: string };
      };

      expect(parsed.ok).toBe(true);
      expect(parsed.status).toBe("passed");
      await expect(fs.access(path.join(parsed.exportBundle.outDir, "Final.md"))).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
