import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMaterialV2, buildMaterialsV2Dataset } from "../artifacts/materials.js";
import { ensureHistwriteProject } from "../project.js";
import { interpretMaterialsToEvidenceCards } from "./interpret.js";

describe("interpretMaterialsToEvidenceCards", () => {
  it("calls OpenAI-compatible API, resolves quote selectors, and uses cache", async () => {
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
                      fact: "材料中出现了 a\\nb 的文本片段。",
                      level: "direct",
                      confidence: 0.9,
                      quote: { exact: "a\nb" },
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-interpret-${randomUUID()}-`));
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

      const outPath = path.join(layout.artifactsDir, "cards.v2.json");

      const run1 = await interpretMaterialsToEvidenceCards({
        layout,
        materials,
        outPath,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(run1.result.cards).toBe(1);
      expect(run1.result.gaps).toBe(0);
      expect(run1.result.cacheHits).toBe(0);
      expect(run1.dataset.cards[0]?.resolvedSpan.method).toBe("quote_anchored");
      await expect(fs.access(outPath)).resolves.toBeUndefined();
      expect(calls).toBe(1);

      const run2 = await interpretMaterialsToEvidenceCards({
        layout,
        materials,
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

