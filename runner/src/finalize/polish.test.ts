import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "../project.js";
import { runPolishStep } from "./polish.js";

describe("runPolishStep", () => {
  it("rewrites only anchor-external text and keeps claim anchors intact", async () => {
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: `更顺的引言。\n\n${placeholder}\n\n更顺的结语。` } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-polish-pass-"));
      const layout = await ensureHistwriteProject(root);
      const inPath = path.join(layout.draftDir, "section.s1.woven.md");
      const outPath = path.join(layout.exportDir, "section.s1.final.md");
      const source =
        "引言。\n\n〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕\n\n结语。\n";
      await fs.writeFile(inPath, source, "utf8");

      const result = await runPolishStep({
        layout,
        inPath,
        outPath,
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "polish-model",
          endpoint: "chat",
        },
      });

      const polished = await fs.readFile(outPath, "utf8");
      expect(result.diff.addedClaims).toBe(0);
      expect(polished).toContain("更顺的引言。");
      expect(polished).toContain("更顺的结语。");
      expect(polished).toContain("〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕");
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("rolls back and errors when polish introduces new claim anchors", async () => {
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `${placeholder}\n\n〔claim:c2|kind=causal|ev=c1:c1〕新增事实。〔/claim〕`,
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
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-polish-fail-"));
      const layout = await ensureHistwriteProject(root);
      const inPath = path.join(layout.draftDir, "section.s1.woven.md");
      const outPath = path.join(layout.exportDir, "section.s1.final.md");
      await fs.writeFile(inPath, "〔claim:c1|kind=causal|ev=c1:c1〕1902年地方财政调整已经开始。〔/claim〕\n", "utf8");

      await expect(
        runPolishStep({
          layout,
          inPath,
          outPath,
          client: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiKey: "test-key",
            model: "polish-model",
            endpoint: "chat",
          },
        }),
      ).rejects.toThrow(/introduced new claims/i);
      await expect(fs.access(outPath)).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
