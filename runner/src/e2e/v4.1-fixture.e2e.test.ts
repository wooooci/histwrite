import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runFinalizeCommand } from "../finalize/finalize.js";
import { resolveHistwriteLayout } from "../project.js";

type FactLikeReport = {
  blockers: number;
};

type FinalcheckLikeReport = {
  summary: {
    placeholderCount: number;
  };
};

function extractMarkdownInput(prompt: string): string {
  const match = prompt.match(/```markdown\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("mock upstream did not receive markdown input block");
  }
  return match[1].trim();
}

async function copyFixtureProjectToTemp() {
  const fixtureRoot = path.resolve(process.cwd(), "content/examples/v4.1-fixture");
  const sourceProjectDir = path.join(fixtureRoot, "project");
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-v41-fixture-e2e-"));
  const projectDir = path.join(tmpRoot, "project");
  await fs.cp(sourceProjectDir, projectDir, { recursive: true });

  const layout = resolveHistwriteLayout(projectDir);
  return {
    fixtureRoot,
    projectDir,
    layout,
    materialsPath: path.join(layout.materialsIndexDir, "materials.v2.json"),
    cardsPath: path.join(layout.artifactsDir, "cards.v2.json"),
    packPath: path.join(layout.artifactsDir, "section.s1.pack.v1.json"),
    draftPath: path.join(layout.draftDir, "section.s1.md"),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

describe("v4.1 fixture end-to-end finalize regression", () => {
  it("replays the fixture through finalize with zero gate blockers and no new claims", async () => {
    const fixture = await copyFixtureProjectToTemp();
    const sourceDraft = (await fs.readFile(path.join(fixture.fixtureRoot, "project", "正文", "section.s1.md"), "utf8")).trim();
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
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.map((message) => String(message.content ?? "")).join("\n") ?? "";

      const content =
        calls === 1
          ? sourceDraft
          : extractMarkdownInput(prompt)
              .replace("在这种背景下，调整首先表现为整账而非立刻加派。", "在这种背景下，调整首先表现为整账，而不是立刻加派。")
              .replace("更重要的是，地方社会并不支持借机立即增设新附加。", "进一步看，地方社会并不支持借机立即增设新附加。");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });

    const port = await new Promise<number>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve((upstream.address() as AddressInfo).port));
      upstream.once("error", reject);
    });

    try {
      const result = await runFinalizeCommand({
        layout: fixture.layout,
        packPath: fixture.packPath,
        draftPath: fixture.draftPath,
        materialsPath: fixture.materialsPath,
        cardsPath: fixture.cardsPath,
        mode: "final",
        noCache: true,
        client: {
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiKey: "test-key",
          model: "fixture-regression-model",
          endpoint: "chat",
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected finalize success, got ${result.failedStep}`);
      }

      expect(result.steps.map((item) => item.step)).toEqual([
        "weave",
        "verify_after_weave",
        "polish",
        "verify_after_polish",
        "finalcheck",
        "export",
      ]);
      expect(result.weave.claimDiff.addedClaims).toBe(0);
      expect(result.weave.claimDiff.added).toHaveLength(0);
      expect(result.verifyAfterPolish.blockers).toBe(0);
      expect(result.polish.diff.addedClaims).toBe(0);
      expect(result.polish.diff.added).toHaveLength(0);
      expect(result.polish.placeholderCount).toBe(3);
      expect(result.finalcheck.summary.placeholderCount).toBe(0);
      expect(calls).toBe(2);

      const factcheck = await readJsonFile<FactLikeReport>(result.verifyAfterPolish.factcheck.path);
      const chronology = await readJsonFile<FactLikeReport>(result.verifyAfterPolish.chronology.path);
      const finalcheck = await readJsonFile<FinalcheckLikeReport>(result.finalcheck.jsonPath);
      expect(factcheck.blockers).toBe(0);
      expect(chronology.blockers).toBe(0);
      expect(finalcheck.summary.placeholderCount).toBe(0);

      expect(result.exportBundle.files.artifactsDir).toBeTruthy();
      await expect(fs.access(path.join(result.exportBundle.outDir, "Final.md"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "reports", "factcheck.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "reports", "chronology.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "artifacts", "materials.v2.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "artifacts", "cards.v2.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(result.exportBundle.outDir, "artifacts", "section.s1.pack.v1.json"))).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
