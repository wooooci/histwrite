import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runBestOfKJudge } from "./judge.js";
import { ensureHistwriteProject } from "./project.js";

describe("runBestOfKJudge", () => {
  it("calls an OpenAI-compatible judge API and appends episodes", async () => {
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
                content:
                  "{\"chosenId\":\"c2\",\"ranked\":[{\"id\":\"c2\",\"score\":0.8,\"pass\":true,\"reason\":\"更好\"},{\"id\":\"c1\",\"score\":0.4,\"pass\":false,\"reason\":\"较弱\"}]}",
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-judge-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));
      const candidatesDir = path.join(layout.projectDir, "正文", "_candidates", "s1", "run1");
      await fs.mkdir(candidatesDir, { recursive: true });
      await fs.writeFile(path.join(candidatesDir, "c1.md"), "候选一\n", "utf8");
      await fs.writeFile(path.join(candidatesDir, "c2.md"), "候选二\n", "utf8");

      const out1 = await runBestOfKJudge({
        layout,
        sectionId: "s1",
        sectionTitle: "第一节",
        candidatesDir,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(out1.result.chosenId).toBe("c2");
      expect(out1.result.selection.selectedIds).toEqual(["c2"]);
      expect(await fs.readFile(out1.judgePath, "utf8")).toContain("\"chosenId\": \"c2\"");
      expect(await fs.readFile(out1.judgePath, "utf8")).toContain("\"selectedIds\": [");
      expect(await fs.readFile(out1.episodesPath, "utf8")).toContain("\"chosenId\":\"c2\"");
      expect(await fs.readFile(out1.episodesPath, "utf8")).toContain("\"selection\"");
      expect(calls).toBe(1);

      const out2 = await runBestOfKJudge({
        layout,
        sectionId: "s1",
        sectionTitle: "第一节",
        candidatesDir,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(out2.cacheHit).toBe(true);
      expect(calls).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not reuse cache across different apiBaseUrl values", async () => {
    let calls1 = 0;
    const server1 = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls1 += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "{\"chosenId\":\"c1\",\"ranked\":[{\"id\":\"c1\",\"score\":0.8,\"pass\":true,\"reason\":\"更好\"},{\"id\":\"c2\",\"score\":0.4,\"pass\":false,\"reason\":\"较弱\"}]}",
              },
            },
          ],
        }),
      );
    });

    let calls2 = 0;
    const server2 = createServer(async (req, res) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      calls2 += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "{\"chosenId\":\"c2\",\"ranked\":[{\"id\":\"c2\",\"score\":0.8,\"pass\":true,\"reason\":\"更好\"},{\"id\":\"c1\",\"score\":0.4,\"pass\":false,\"reason\":\"较弱\"}]}",
              },
            },
          ],
        }),
      );
    });

    const port1 = await new Promise<number>((resolve, reject) => {
      server1.listen(0, "127.0.0.1", () => resolve((server1.address() as AddressInfo).port));
      server1.once("error", reject);
    });
    const port2 = await new Promise<number>((resolve, reject) => {
      server2.listen(0, "127.0.0.1", () => resolve((server2.address() as AddressInfo).port));
      server2.once("error", reject);
    });

    const close1 = async () => await new Promise<void>((resolve) => server1.close(() => resolve()));
    const close2 = async () => await new Promise<void>((resolve) => server2.close(() => resolve()));

    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-judge-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));
      const candidatesDir = path.join(layout.projectDir, "正文", "_candidates", "s1", "run1");
      await fs.mkdir(candidatesDir, { recursive: true });
      await fs.writeFile(path.join(candidatesDir, "c1.md"), "候选一\n", "utf8");
      await fs.writeFile(path.join(candidatesDir, "c2.md"), "候选二\n", "utf8");

      const out1 = await runBestOfKJudge({
        layout,
        sectionId: "s1",
        sectionTitle: "第一节",
        candidatesDir,
        client: { apiBaseUrl: `http://127.0.0.1:${port1}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(out1.result.chosenId).toBe("c1");
      expect(out1.cacheHit).toBe(false);
      expect(calls1).toBe(1);
      expect(calls2).toBe(0);

      const out2 = await runBestOfKJudge({
        layout,
        sectionId: "s1",
        sectionTitle: "第一节",
        candidatesDir,
        client: { apiBaseUrl: `http://127.0.0.1:${port2}`, apiKey: "k", model: "m", endpoint: "chat" },
      });
      expect(out2.cacheHit).toBe(false);
      expect(out2.result.chosenId).toBe("c2");
      expect(calls1).toBe(1);
      expect(calls2).toBe(1);
    } finally {
      await Promise.all([close1(), close2()]);
    }
  });

  it("supports n-best selection and persists the selection reason", async () => {
    const server = createServer(async (req, res) => {
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
                content:
                  "{\"chosenId\":\"c3\",\"ranked\":[{\"id\":\"c3\",\"score\":0.92,\"pass\":true,\"reason\":\"证据最完整\"},{\"id\":\"c2\",\"score\":0.87,\"pass\":true,\"reason\":\"结构稳定\"},{\"id\":\"c1\",\"score\":0.4,\"pass\":false,\"reason\":\"偏弱\"}]}",
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
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-judge-nbest-${randomUUID()}-`));
      const layout = await ensureHistwriteProject(path.join(tmp, "proj"));
      const candidatesDir = path.join(layout.projectDir, "正文", "_candidates", "s1", "run1");
      await fs.mkdir(candidatesDir, { recursive: true });
      await fs.writeFile(path.join(candidatesDir, "c1.md"), "候选一\n", "utf8");
      await fs.writeFile(path.join(candidatesDir, "c2.md"), "候选二\n", "utf8");
      await fs.writeFile(path.join(candidatesDir, "c3.md"), "候选三\n", "utf8");

      const out = await runBestOfKJudge({
        layout,
        sectionId: "s1",
        sectionTitle: "第一节",
        candidatesDir,
        topN: 2,
        client: { apiBaseUrl: `http://127.0.0.1:${port}`, apiKey: "k", model: "m", endpoint: "chat" },
      });

      expect(out.result.chosenId).toBe("c3");
      expect(out.result.selection.selectedIds).toEqual(["c3", "c2"]);
      expect(out.result.selection.reason).toContain("证据最完整");
      expect(await fs.readFile(out.judgePath, "utf8")).toContain("\"topN\": 2");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
