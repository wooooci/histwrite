import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMaterialV2, buildMaterialsV2Dataset } from "../artifacts/materials.js";
import { ensureHistwriteProject } from "../project.js";
import { normalizeSelectorBundle, normalizeTextQuoteSelector, selectorContractVersion } from "../selector/contract.js";
import { resolveSelector } from "../selector/resolve.js";
import { buildMaterialQaDataset } from "./builder.js";

describe("buildMaterialQaDataset", () => {
  it("calls OpenAI-compatible API, binds evidence selector, and uses cache", async () => {
    let calls = 0;
    const server = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
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
                content: JSON.stringify({
                  version: 1,
                  items: [
                    {
                      question: "这条材料直接说明了什么？",
                      answer: "它直接给出了一个可引用的文本片段。",
                      answerType: "direct",
                      useInWriting: "可用于举例或作为原文佐证。",
                      riskFlags: ["quote_scope"],
                    },
                  ],
                }),
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-qa-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

      const materials = buildMaterialsV2Dataset([
        buildMaterialV2({
          materialId: "m1",
          provenance: {
            kind: "txt",
            title: "t1",
            sourcePath: "材料/a.txt",
            sourceSha256: "sha",
            textPath: "材料/_index/text/m1.txt",
            textSha256: "sha2",
          },
          rawText: "a\r\nb",
        }),
      ]);

      const selectorBundle = normalizeSelectorBundle({
        quote: normalizeTextQuoteSelector({ type: "TextQuoteSelector", layer: "normText", exact: "a\nb" }),
      });
      const resolvedSpan = resolveSelector({ rawText: materials.materials[0]!.rawText, selector: selectorBundle });

      const cards = {
        version: 2 as const,
        createdAt: new Date().toISOString(),
        selectorContractVersion,
        cards: [
          {
            cardId: "c1",
            materialId: "m1",
            fact: "材料中出现了 a\\nb 的文本片段。",
            level: "direct" as const,
            confidence: 0.9,
            selectorBundle,
            resolvedSpan,
          },
        ],
      };

      const outPath = path.join(layout.artifactsDir, "qa.v1.json");

      const run1 = await buildMaterialQaDataset({
        layout,
        materials,
        cards,
        outPath,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(run1.result.items).toBe(1);
      expect(run1.result.gaps).toBe(0);
      expect(run1.result.cacheHits).toBe(0);
      expect(run1.dataset.items[0]?.evidenceRefs.length).toBe(1);
      expect(run1.dataset.items[0]?.evidenceRefs[0]?.selectorBundle.quote.exact).toBe("a\nb");
      await expect(fs.access(outPath)).resolves.toBeUndefined();
      expect(calls).toBe(1);

      const run2 = await buildMaterialQaDataset({
        layout,
        materials,
        cards,
        outPath,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(run2.result.cacheHits).toBe(1);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

