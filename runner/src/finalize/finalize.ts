import fs from "node:fs/promises";
import path from "node:path";

import { createRunLogger, type RunLogger } from "../runlog.js";
import type { HistwriteProjectLayout } from "../project.js";
import { weaveNarrativeDraft } from "../weave/narrative-weaver.js";
import { runWeaveGates } from "../weave/gates.js";
import { runVerifyCommand, type VerifyCommandResult } from "../gates/command.js";
import { analyzeFinalCheck, renderFinalCheckMarkdown, type FinalCheckReport } from "../final-check.js";
import { runPolishStep, type PolishRunOutput } from "./polish.js";
import { exportFinalizeBundle, type ExportBundleResult } from "./export-bundle.js";

export type FinalizeStepName =
  | "weave"
  | "verify_after_weave"
  | "polish"
  | "verify_after_polish"
  | "finalcheck"
  | "export";

export type FinalizeStepResult = {
  step: FinalizeStepName;
  status: "passed" | "failed";
  blockers: number;
  warnings: number;
};

type FinalizeFinalCheckOutput = {
  report: FinalCheckReport;
  reportPath: string;
  jsonPath: string;
  blockers: number;
  warnings: number;
};

export type FinalizeSuccessResult = {
  version: 1;
  ok: true;
  status: "passed";
  runLogPath: string;
  steps: FinalizeStepResult[];
  weave: {
    outPath: string;
    cacheHit: boolean;
    endpoint: "chat" | "responses";
    model: string;
    claimDiff: Awaited<ReturnType<typeof runWeaveGates>>["claimDiff"];
  };
  verifyAfterWeave: VerifyCommandResult;
  polish: PolishRunOutput;
  verifyAfterPolish: VerifyCommandResult;
  finalcheck: {
    reportPath: string;
    jsonPath: string;
    blockers: number;
    warnings: number;
    summary: FinalCheckReport["summary"];
  };
  finalMarkdownPath: string;
  exportBundle: ExportBundleResult;
};

export type FinalizeFailedResult = {
  version: 1;
  ok: false;
  status: "failed";
  runLogPath: string;
  steps: FinalizeStepResult[];
  failedStep: FinalizeStepName;
  blockers: number;
  warnings: number;
  nextActions: string[];
};

export type FinalizeCommandResult = FinalizeSuccessResult | FinalizeFailedResult;

function safeStem(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "draft"
  );
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

async function collectVerifyNextActions(result: VerifyCommandResult): Promise<string[]> {
  const nextActions: string[] = [];

  const factcheck = await readJsonFile<{ workOrders?: Array<{ instructions?: string }>; issues?: Array<{ reason?: string; detail?: string }> }>(
    result.factcheck.path,
  );
  const chronology = await readJsonFile<{ workOrders?: Array<{ instructions?: string }>; issues?: Array<{ reason?: string; detail?: string }> }>(
    result.chronology.path,
  );

  for (const workOrder of factcheck.workOrders ?? []) {
    if (workOrder.instructions) nextActions.push(workOrder.instructions);
  }
  for (const workOrder of chronology.workOrders ?? []) {
    if (workOrder.instructions) nextActions.push(workOrder.instructions);
  }

  if (nextActions.length === 0) {
    for (const issue of [...(factcheck.issues ?? []), ...(chronology.issues ?? [])]) {
      if (issue.detail) {
        nextActions.push(issue.detail);
        continue;
      }
      if (issue.reason) nextActions.push(issue.reason);
    }
  }

  return uniqueNonEmpty(nextActions);
}

async function runFinalCheckStep(params: {
  layout: HistwriteProjectLayout;
  finalMarkdownPath: string;
}): Promise<FinalizeFinalCheckOutput> {
  const finalMarkdownPath = path.resolve(params.finalMarkdownPath);
  const markdown = await fs.readFile(finalMarkdownPath, "utf8");
  const report = analyzeFinalCheck({ filePath: finalMarkdownPath, markdown });
  const safeName = safeStem(path.parse(finalMarkdownPath).name);
  const outDir = path.join(params.layout.metaDir, "reports", "finalcheck", safeName, "latest");

  await fs.mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, "report.md");
  const jsonPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, `${renderFinalCheckMarkdown(report).trim()}\n`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    report,
    reportPath,
    jsonPath,
    blockers: report.summary.errorCount,
    warnings: report.summary.warningCount,
  };
}

function buildFailureResult(params: {
  runLogPath: string;
  steps: FinalizeStepResult[];
  failedStep: FinalizeStepName;
  blockers: number;
  warnings: number;
  nextActions: string[];
}): FinalizeFailedResult {
  return {
    version: 1,
    ok: false,
    status: "failed",
    runLogPath: params.runLogPath,
    steps: params.steps,
    failedStep: params.failedStep,
    blockers: params.blockers,
    warnings: params.warnings,
    nextActions: uniqueNonEmpty(params.nextActions),
  };
}

export async function runFinalizeCommand(params: {
  layout: HistwriteProjectLayout;
  packPath: string;
  draftPath: string;
  materialsPath: string;
  cardsPath: string;
  lexiconPath?: string | null;
  mode?: "draft" | "final";
  outDir?: string | null;
  noCache?: boolean;
  useJudge?: boolean;
  judgeClient?: Parameters<typeof runVerifyCommand>[0]["judgeClient"];
  logger?: RunLogger | null;
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<FinalizeCommandResult> {
  const logger = params.logger ?? (await createRunLogger({ logsDir: params.layout.logsDir }));
  const steps: FinalizeStepResult[] = [];
  const mode = params.mode ?? "final";
  const safeName = safeStem(path.parse(params.draftPath).name);
  const workDir = path.join(params.layout.metaDir, "finalize", safeName, "latest");
  const wovenPath = path.join(workDir, "woven.md");
  const finalMarkdownPath = path.join(workDir, "Final.md");

  await fs.mkdir(workDir, { recursive: true });

  const originalDraft = await fs.readFile(path.resolve(params.draftPath), "utf8");

  await logger.write("finalize_weave_begin", {
    draftPath: path.resolve(params.draftPath),
    wovenPath,
  });

  let weaveOutput: Awaited<ReturnType<typeof weaveNarrativeDraft>>;
  try {
    weaveOutput = await weaveNarrativeDraft({
      draft: originalDraft,
      layout: params.layout,
      noCache: params.noCache,
      client: params.client,
    });
  } catch (error) {
    steps.push({ step: "weave", status: "failed", blockers: 1, warnings: 0 });
    await logger.write("finalize_weave_failed", { error: summarizeError(error) });
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "weave",
      blockers: 1,
      warnings: 0,
      nextActions: [summarizeError(error)],
    });
  }

  await fs.writeFile(wovenPath, `${weaveOutput.wovenDraft.trim()}\n`, "utf8");
  steps.push({ step: "weave", status: "passed", blockers: 0, warnings: 0 });
  await logger.write("finalize_weave_done", {
    wovenPath,
    cacheHit: weaveOutput.cacheHit,
    endpoint: weaveOutput.endpoint,
    model: weaveOutput.model,
  });

  await logger.write("finalize_verify_after_weave_begin", { wovenPath });
  let weaveGates: Awaited<ReturnType<typeof runWeaveGates>>;
  try {
    weaveGates = await runWeaveGates({
      projectDir: params.layout.projectDir,
      beforeDraft: originalDraft,
      wovenDraftPath: wovenPath,
      packPath: params.packPath,
      materialsPath: params.materialsPath,
      cardsPath: params.cardsPath,
      lexiconPath: params.lexiconPath,
      mode,
      useJudge: params.useJudge,
      judgeClient: params.judgeClient,
    });
  } catch (error) {
    steps.push({ step: "verify_after_weave", status: "failed", blockers: 1, warnings: 0 });
    await logger.write("finalize_verify_after_weave_failed", { error: summarizeError(error) });
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "verify_after_weave",
      blockers: 1,
      warnings: 0,
      nextActions: [summarizeError(error)],
    });
  }

  steps.push({
    step: "verify_after_weave",
    status: weaveGates.verify.status === "passed" ? "passed" : "failed",
    blockers: weaveGates.verify.blockers,
    warnings: weaveGates.verify.warnings,
  });
  await logger.write("finalize_verify_after_weave_done", {
    claimDiff: weaveGates.claimDiff,
    verify: weaveGates.verify,
  });

  if (weaveGates.verify.status === "failed") {
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "verify_after_weave",
      blockers: weaveGates.verify.blockers,
      warnings: weaveGates.verify.warnings,
      nextActions: await collectVerifyNextActions(weaveGates.verify),
    });
  }

  await logger.write("finalize_polish_begin", { inPath: wovenPath, outPath: finalMarkdownPath });
  let polish: PolishRunOutput;
  try {
    polish = await runPolishStep({
      layout: params.layout,
      inPath: wovenPath,
      outPath: finalMarkdownPath,
      noCache: params.noCache,
      client: params.client,
    });
  } catch (error) {
    steps.push({ step: "polish", status: "failed", blockers: 1, warnings: 0 });
    await logger.write("finalize_polish_failed", { error: summarizeError(error) });
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "polish",
      blockers: 1,
      warnings: 0,
      nextActions: [summarizeError(error)],
    });
  }

  steps.push({ step: "polish", status: "passed", blockers: 0, warnings: 0 });
  await logger.write("finalize_polish_done", {
    outPath: polish.outPath,
    diff: polish.diff,
    cacheHit: polish.cacheHit,
  });

  await logger.write("finalize_verify_after_polish_begin", { draftPath: finalMarkdownPath });
  const verifyAfterPolish = await runVerifyCommand({
    layout: params.layout,
    packPath: params.packPath,
    draftPath: finalMarkdownPath,
    materialsPath: params.materialsPath,
    cardsPath: params.cardsPath,
    lexiconPath: params.lexiconPath,
    mode,
    useJudge: params.useJudge,
    judgeClient: params.judgeClient,
  });
  steps.push({
    step: "verify_after_polish",
    status: verifyAfterPolish.status === "passed" ? "passed" : "failed",
    blockers: verifyAfterPolish.blockers,
    warnings: verifyAfterPolish.warnings,
  });
  await logger.write("finalize_verify_after_polish_done", verifyAfterPolish);

  if (verifyAfterPolish.status === "failed") {
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "verify_after_polish",
      blockers: verifyAfterPolish.blockers,
      warnings: verifyAfterPolish.warnings,
      nextActions: await collectVerifyNextActions(verifyAfterPolish),
    });
  }

  await logger.write("finalize_finalcheck_begin", { filePath: finalMarkdownPath });
  const finalcheck = await runFinalCheckStep({
    layout: params.layout,
    finalMarkdownPath,
  });
  steps.push({
    step: "finalcheck",
    status: finalcheck.blockers > 0 ? "failed" : "passed",
    blockers: finalcheck.blockers,
    warnings: finalcheck.warnings,
  });
  await logger.write("finalize_finalcheck_done", {
    reportPath: finalcheck.reportPath,
    jsonPath: finalcheck.jsonPath,
    summary: finalcheck.report.summary,
  });

  if (finalcheck.blockers > 0) {
    return buildFailureResult({
      runLogPath: logger.path,
      steps,
      failedStep: "finalcheck",
      blockers: finalcheck.blockers,
      warnings: finalcheck.warnings,
      nextActions: finalcheck.report.actions,
    });
  }

  await logger.write("finalize_export_begin", { outDir: params.outDir ? path.resolve(params.outDir) : null });
  const exportBundle = await exportFinalizeBundle({
    layout: params.layout,
    finalMarkdownPath,
    factcheckReportPath: verifyAfterPolish.factcheck.path,
    chronologyReportPath: verifyAfterPolish.chronology.path,
    finalcheckReportPath: finalcheck.reportPath,
    runLogPath: logger.path,
    artifactPaths: {
      materialsPath: params.materialsPath,
      cardsPath: params.cardsPath,
      packPath: params.packPath,
    },
    outDir: params.outDir,
  });
  steps.push({ step: "export", status: "passed", blockers: 0, warnings: 0 });
  await logger.write("finalize_export_done", exportBundle);
  await fs.copyFile(logger.path, path.join(exportBundle.outDir, "runlog.jsonl"));

  return {
    version: 1,
    ok: true,
    status: "passed",
    runLogPath: logger.path,
    steps,
    weave: {
      outPath: wovenPath,
      cacheHit: weaveOutput.cacheHit,
      endpoint: weaveOutput.endpoint,
      model: weaveOutput.model,
      claimDiff: weaveGates.claimDiff,
    },
    verifyAfterWeave: weaveGates.verify,
    polish,
    verifyAfterPolish,
    finalcheck: {
      reportPath: finalcheck.reportPath,
      jsonPath: finalcheck.jsonPath,
      blockers: finalcheck.blockers,
      warnings: finalcheck.warnings,
      summary: finalcheck.report.summary,
    },
    finalMarkdownPath,
    exportBundle,
  };
}
