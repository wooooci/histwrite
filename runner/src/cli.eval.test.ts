import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function extractMarkdownInput(prompt: string): string {
  const match = prompt.match(/```markdown\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("mock upstream did not receive markdown input block");
  }
  return match[1].trim();
}

describe("histwrite runner cli eval run", () => {
  it("runs the fixture harness and prints convergence summary json", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "content/examples/v4.1-fixture");
    const sourceDraft = (
      await fs.readFile(path.join(fixtureRoot, "project", "正文", "section.s1.md"), "utf8")
    ).trim();

    const upstream = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.map((message) => String(message.content ?? "")).join("\n") ?? "";
      const content = prompt.includes("这一步是 FINAL 阶段的 polish") ? extractMarkdownInput(prompt) : sourceDraft;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          "--import",
          "tsx",
          cliPath,
          "eval",
          "run",
          "--fixture",
          fixtureRoot,
          "--runs",
          "2",
          "--apiBaseUrl",
          `http://127.0.0.1:${port}`,
          "--model",
          "fixture-eval-model",
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
        summary: {
          runCount: number;
          passedRuns: number;
          stableFinalOutput: boolean;
          uniqueFinalOutputCount: number;
          allGateBlockersZero: boolean;
        };
        jsonPath: string;
      };

      expect(parsed.summary.runCount).toBe(2);
      expect(parsed.summary.passedRuns).toBe(2);
      expect(parsed.summary.stableFinalOutput).toBe(true);
      expect(parsed.summary.uniqueFinalOutputCount).toBe(1);
      expect(parsed.summary.allGateBlockersZero).toBe(true);
      await expect(fs.access(parsed.jsonPath)).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
