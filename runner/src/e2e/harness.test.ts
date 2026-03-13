import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runFixtureEval } from "./harness.js";

type HarnessSummaryJson = {
  summary: {
    runCount: number;
    passedRuns: number;
    failedRuns: number;
    uniqueFinalOutputCount: number;
    stableFinalOutput: boolean;
    convergenceRate: number;
    allGateBlockersZero: boolean;
    allNoNewClaims: boolean;
    allPlaceholdersCleared: boolean;
  };
};

function extractMarkdownInput(prompt: string): string {
  const match = prompt.match(/```markdown\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("mock upstream did not receive markdown input block");
  }
  return match[1].trim();
}

describe("runFixtureEval", () => {
  it("replays a fixture multiple times and reports convergence/stability metrics", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "content/examples/v4.1-fixture");
    const sourceDraft = (
      await fs.readFile(path.join(fixtureRoot, "project", "正文", "section.s1.md"), "utf8")
    ).trim();

    let calls = 0;
    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      calls += 1;
      const runNumber = Math.ceil(calls / 2);

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.map((message) => String(message.content ?? "")).join("\n") ?? "";

      const content =
        calls % 2 === 1
          ? sourceDraft
          : runNumber === 3
            ? extractMarkdownInput(prompt).replace(
                "# 1902年前后地方财政调整的启动逻辑",
                "# 1902年前后地方财政调整的启动逻辑（样本三）",
              )
            : extractMarkdownInput(prompt);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const result = await runFixtureEval({
        fixtureRoot,
        runs: 3,
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "fixture-harness-model",
          endpoint: "chat",
        },
      });

      expect(result.summary.runCount).toBe(3);
      expect(result.summary.passedRuns).toBe(3);
      expect(result.summary.failedRuns).toBe(0);
      expect(result.summary.uniqueFinalOutputCount).toBe(2);
      expect(result.summary.stableFinalOutput).toBe(false);
      expect(result.summary.convergenceRate).toBeCloseTo(2 / 3, 5);
      expect(result.summary.allGateBlockersZero).toBe(true);
      expect(result.summary.allNoNewClaims).toBe(true);
      expect(result.summary.allPlaceholdersCleared).toBe(true);
      expect(result.runs).toHaveLength(3);
      expect(calls).toBe(6);

      await expect(fs.access(result.jsonPath)).resolves.toBeUndefined();
      await expect(fs.access(result.markdownPath)).resolves.toBeUndefined();
      await expect(fs.access(result.runs[0]!.resultPath)).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.runs[0]!.bundleDir, "Final.md"))).resolves.toBeUndefined();

      const stored = JSON.parse(await fs.readFile(result.jsonPath, "utf8")) as HarnessSummaryJson;
      expect(stored.summary.uniqueFinalOutputCount).toBe(2);
      expect(stored.summary.stableFinalOutput).toBe(false);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
