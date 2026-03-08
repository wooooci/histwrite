import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "./project.js";
import { rewriteMarkdownFile } from "./rewrite.js";

describe("rewrite", () => {
  it("rewrites markdown and caches identical requests", async () => {
    let calls = 0;
    let seenAuth = "";
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls += 1;
      seenAuth = String(req.headers.authorization ?? "");
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as any;
      expect(body?.model).toBe("m");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "OUT" } }] }));
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-rewrite-"));
    const layout = await ensureHistwriteProject(projectDir);
    const inPath = path.join(projectDir, "input.md");
    await fs.writeFile(inPath, "# hi\n\ntext\n", "utf8");
    const outPath = path.join(layout.exportDir, "out.md");

    try {
      const res1 = await rewriteMarkdownFile({
        layout,
        inPath,
        outPath,
        client: {
          apiBaseUrl: `http://127.0.0.1:${upstreamPort}`,
          apiKey: "k",
          model: "m",
          endpoint: "chat",
          timeoutMs: 10_000,
          temperature: 0,
          maxTokens: 200,
        },
      });
      expect(res1.cacheHit).toBe(false);
      expect(res1.endpoint).toBe("chat");
      expect(seenAuth).toBe("Bearer k");
      expect((await fs.readFile(outPath, "utf8")).trim()).toBe("OUT");

      const res2 = await rewriteMarkdownFile({
        layout,
        inPath,
        outPath,
        client: {
          apiBaseUrl: `http://127.0.0.1:${upstreamPort}`,
          apiKey: "k",
          model: "m",
          endpoint: "chat",
          timeoutMs: 10_000,
          temperature: 0,
          maxTokens: 200,
        },
      });
      expect(res2.cacheHit).toBe(true);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

