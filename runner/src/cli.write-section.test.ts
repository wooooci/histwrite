import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { artifactRefFromValue } from "./artifacts/heads.js";

const execFileAsync = promisify(execFile);

function makePack() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    packId: "pack_cli",
    blueprintRef: artifactRefFromValue({ outPath: "/tmp/blueprint.json", value: { version: 2, sections: [] } }),
    sectionId: "s1",
    timeWindow: { start: "1900", end: "1905" },
    textWindow: { topic: "税制改革" },
    cards: [
      {
        cardId: "c1",
        selectedEvidenceIds: ["c1"],
        selectorBundles: [
          {
            quote: {
              type: "TextQuoteSelector",
              layer: "rawText",
              exact: "税制改革",
            },
          },
        ],
        resolvedSpans: [
          {
            rawStart: 0,
            rawEnd: 4,
            extractedExactRaw: "税制改革",
            method: "quote_anchored",
          },
        ],
      },
    ],
    qa: [],
    constraints: { finalMissingGapsBlock: true, noNewClaims: true },
  };
}

describe("histwrite runner cli write section", () => {
  it("writes a section draft from a pack file", async () => {
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
                content: "〔claim:c1|kind=causal|ev=c1:c1〕税制改革推动了地方财政调整。〔/claim〕",
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runner-write-section-"));
      const packPath = path.join(root, "pack.v1.json");
      await fs.writeFile(packPath, `${JSON.stringify(makePack(), null, 2)}\n`, "utf8");

      const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
      const outPath = path.join(root, "正文", "section.s1.md");

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          cliPath,
          "write",
          "section",
          "--project",
          root,
          "--pack",
          packPath,
          "--out",
          outPath,
          "--apiBaseUrl",
          `http://127.0.0.1:${port}`,
          "--apiKeyEnv",
          "OPENAI_API_KEY",
          "--model",
          "write-test-model",
        ],
        {
          env: { ...process.env, OPENAI_API_KEY: "test-key" },
        },
      );

      const parsed = JSON.parse(stdout.trim()) as { ok: boolean; outPath: string; claims: number };
      expect(parsed.ok).toBe(true);
      expect(parsed.claims).toBe(1);
      expect(parsed.outPath).toBe(outPath);
      await expect(fs.readFile(outPath, "utf8")).resolves.toContain("〔claim:c1|kind=causal|ev=c1:c1〕");
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

