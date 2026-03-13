import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sha256Hex } from "../cache.js";
import { runFinalizeCommand, type FinalizeCommandResult } from "../finalize/finalize.js";
import { resolveHistwriteLayout } from "../project.js";

type FixtureManifest = {
  version: 1;
  fixtureId: string;
  targetSection: {
    sectionId: string;
    title: string;
  };
};

export type FixtureEvalRun = {
  runId: string;
  status: "passed" | "failed";
  failedStep: string | null;
  verifyBlockers: number;
  factcheckBlockers: number | null;
  chronologyBlockers: number | null;
  finalcheckPlaceholderCount: number | null;
  weaveAddedClaims: number | null;
  polishAddedClaims: number | null;
  finalMarkdownSha256: string | null;
  finalMarkdownChars: number;
  bundleDir: string;
  resultPath: string;
};

export type FixtureEvalSummary = {
  runCount: number;
  passedRuns: number;
  failedRuns: number;
  ok: boolean;
  stableFinalOutput: boolean;
  uniqueFinalOutputCount: number;
  convergenceRate: number;
  allGateBlockersZero: boolean;
  allNoNewClaims: boolean;
  allPlaceholdersCleared: boolean;
};

export type FixtureEvalReport = {
  version: 1;
  fixtureId: string;
  sectionId: string;
  outDir: string;
  jsonPath: string;
  markdownPath: string;
  generatedAt: string;
  summary: FixtureEvalSummary;
  runs: FixtureEvalRun[];
};

function safeTimestamp(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

function countFinalHashes(runs: FixtureEvalRun[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.finalMarkdownSha256) continue;
    counts.set(run.finalMarkdownSha256, (counts.get(run.finalMarkdownSha256) ?? 0) + 1);
  }
  return counts;
}

function summarizeRuns(runs: FixtureEvalRun[]): FixtureEvalSummary {
  const runCount = runs.length;
  const passedRuns = runs.filter((run) => run.status === "passed").length;
  const failedRuns = runCount - passedRuns;
  const finalHashCounts = countFinalHashes(runs);
  const uniqueFinalOutputCount = finalHashCounts.size;
  const mostCommonFinalHashCount = Math.max(0, ...finalHashCounts.values());
  const stableFinalOutput = passedRuns === runCount && uniqueFinalOutputCount === 1;
  const convergenceRate = passedRuns === 0 ? 0 : mostCommonFinalHashCount / passedRuns;
  const allGateBlockersZero = runs.every(
    (run) =>
      run.verifyBlockers === 0 &&
      (run.factcheckBlockers ?? Number.POSITIVE_INFINITY) === 0 &&
      (run.chronologyBlockers ?? Number.POSITIVE_INFINITY) === 0,
  );
  const allNoNewClaims = runs.every(
    (run) =>
      (run.weaveAddedClaims ?? Number.POSITIVE_INFINITY) === 0 &&
      (run.polishAddedClaims ?? Number.POSITIVE_INFINITY) === 0,
  );
  const allPlaceholdersCleared = runs.every((run) => (run.finalcheckPlaceholderCount ?? Number.POSITIVE_INFINITY) === 0);

  return {
    runCount,
    passedRuns,
    failedRuns,
    ok: failedRuns === 0 && allGateBlockersZero && allNoNewClaims && allPlaceholdersCleared,
    stableFinalOutput,
    uniqueFinalOutputCount,
    convergenceRate,
    allGateBlockersZero,
    allNoNewClaims,
    allPlaceholdersCleared,
  };
}

function renderFixtureEvalMarkdown(report: FixtureEvalReport): string {
  const lines = [
    `# Fixture Eval — ${report.fixtureId}`,
    "",
    `- 生成时间：${report.generatedAt}`,
    `- sectionId：${report.sectionId}`,
    `- 运行次数：${report.summary.runCount}`,
    `- 通过次数：${report.summary.passedRuns}`,
    `- 失败次数：${report.summary.failedRuns}`,
    `- 最终文本稳定：${report.summary.stableFinalOutput ? "是" : "否"}`,
    `- 不同最终文本数：${report.summary.uniqueFinalOutputCount}`,
    `- 收敛率：${report.summary.convergenceRate.toFixed(4)}`,
    `- Gate blockers 全零：${report.summary.allGateBlockersZero ? "是" : "否"}`,
    `- 新 claim 全零：${report.summary.allNoNewClaims ? "是" : "否"}`,
    `- placeholder 全清理：${report.summary.allPlaceholdersCleared ? "是" : "否"}`,
    "",
    "## Runs",
    "",
  ];

  for (const run of report.runs) {
    lines.push(
      `- ${run.runId}: status=${run.status}, failedStep=${run.failedStep ?? "-"}, verifyBlockers=${run.verifyBlockers}, factcheck=${run.factcheckBlockers ?? "-"}, chronology=${run.chronologyBlockers ?? "-"}, placeholders=${run.finalcheckPlaceholderCount}, weaveAdded=${run.weaveAddedClaims}, polishAdded=${run.polishAddedClaims}, finalHash=${run.finalMarkdownSha256 ?? "-"}`,
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildDefaultOutDir(fixtureId: string): string {
  return path.join(os.tmpdir(), "histwrite-evals", fixtureId, safeTimestamp());
}

async function runSingleFixtureEval(params: {
  fixtureId: string;
  sourceProjectDir: string;
  sectionId: string;
  outDir: string;
  runIndex: number;
  mode: "draft" | "final";
  noCache: boolean;
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<FixtureEvalRun> {
  const runId = `run-${String(params.runIndex + 1).padStart(3, "0")}`;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-${params.fixtureId}-${runId}-`));
  const projectDir = path.join(tmpRoot, "project");
  const resultPath = path.join(params.outDir, "runs", runId, "result.json");
  const bundleDir = path.join(params.outDir, "runs", runId, "bundle");

  try {
    await fs.cp(params.sourceProjectDir, projectDir, { recursive: true });
    const layout = resolveHistwriteLayout(projectDir);
    const materialsPath = path.join(layout.materialsIndexDir, "materials.v2.json");
    const cardsPath = path.join(layout.artifactsDir, "cards.v2.json");
    const packPath = path.join(layout.artifactsDir, `section.${params.sectionId}.pack.v1.json`);
    const draftPath = path.join(layout.draftDir, `section.${params.sectionId}.md`);

    const result = await runFinalizeCommand({
      layout,
      packPath,
      draftPath,
      materialsPath,
      cardsPath,
      outDir: bundleDir,
      mode: params.mode,
      noCache: params.noCache,
      client: params.client,
    });

    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

    if (!result.ok) {
      return {
        runId,
        status: "failed",
        failedStep: result.failedStep,
        verifyBlockers: result.blockers,
        factcheckBlockers: null,
        chronologyBlockers: null,
        finalcheckPlaceholderCount: null,
        weaveAddedClaims: null,
        polishAddedClaims: null,
        finalMarkdownSha256: null,
        finalMarkdownChars: 0,
        bundleDir,
        resultPath,
      };
    }

    return await summarizeSuccessfulRun({
      runId,
      bundleDir,
      resultPath,
      result,
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function summarizeSuccessfulRun(params: {
  runId: string;
  bundleDir: string;
  resultPath: string;
  result: Extract<FinalizeCommandResult, { ok: true }>;
}): Promise<FixtureEvalRun> {
  const finalMarkdown = await fs.readFile(params.result.finalMarkdownPath, "utf8");
  return {
    runId: params.runId,
    status: "passed",
    failedStep: null,
    verifyBlockers: params.result.verifyAfterPolish.blockers,
    factcheckBlockers: params.result.verifyAfterPolish.factcheck.blockers,
    chronologyBlockers: params.result.verifyAfterPolish.chronology.blockers,
    finalcheckPlaceholderCount: params.result.finalcheck.summary.placeholderCount,
    weaveAddedClaims: params.result.weave.claimDiff.addedClaims,
    polishAddedClaims: params.result.polish.diff.addedClaims,
    finalMarkdownSha256: sha256Hex(finalMarkdown.trim()),
    finalMarkdownChars: finalMarkdown.trim().length,
    bundleDir: params.bundleDir,
    resultPath: params.resultPath,
  };
}

export async function runFixtureEval(params: {
  fixtureRoot: string;
  runs?: number;
  outDir?: string | null;
  mode?: "draft" | "final";
  noCache?: boolean;
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<FixtureEvalReport> {
  const fixtureRoot = path.resolve(params.fixtureRoot);
  const manifest = await readJsonFile<FixtureManifest>(path.join(fixtureRoot, "fixture.manifest.json"));
  const sourceProjectDir = path.join(fixtureRoot, "project");
  const outDir = path.resolve(params.outDir ?? buildDefaultOutDir(manifest.fixtureId));
  const jsonPath = path.join(outDir, "summary.json");
  const markdownPath = path.join(outDir, "summary.md");
  const runs = Math.max(1, params.runs ?? 3);
  const mode = params.mode ?? "final";
  const noCache = params.noCache ?? true;

  await fs.mkdir(outDir, { recursive: true });

  const runItems: FixtureEvalRun[] = [];
  for (let index = 0; index < runs; index += 1) {
    runItems.push(
      await runSingleFixtureEval({
        fixtureId: manifest.fixtureId,
        sourceProjectDir,
        sectionId: manifest.targetSection.sectionId,
        outDir,
        runIndex: index,
        mode,
        noCache,
        client: params.client,
      }),
    );
  }

  const report: FixtureEvalReport = {
    version: 1,
    fixtureId: manifest.fixtureId,
    sectionId: manifest.targetSection.sectionId,
    outDir,
    jsonPath,
    markdownPath,
    generatedAt: new Date().toISOString(),
    summary: summarizeRuns(runItems),
    runs: runItems,
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, renderFixtureEvalMarkdown(report), "utf8");

  return report;
}
