import fs from "node:fs/promises";
import path from "node:path";

import { ensureHistwriteProject, resolveHistwriteLayout } from "./project.js";
import { buildMaterialsV2FromLibraryIndex, indexMaterials, writeLibraryIndexMarkdown, type LibraryIndex } from "./indexing.js";
import { createRunLogger } from "./runlog.js";
import { captureRelaySnapshot } from "./capture.js";
import { exportDraftMarkdown } from "./exporting.js";
import { createEpisodesStore } from "./episodes.js";
import { runBestOfKJudge } from "./judge.js";
import { defaultOpencodeConfigPath, resolveOpenAiCompatFromOpencode } from "./opencode.js";
import { startOpenAiCompatProxy } from "./openai-proxy.js";
import { loadDotEnvFromDir } from "./dotenv.js";
import { rewriteMarkdownFile } from "./rewrite.js";
import { analyzeFinalCheck, renderFinalCheckMarkdown } from "./final-check.js";
import { buildClaimsArtifactV1 } from "./artifacts/claims.js";
import { artifactRefFromValue, setArtifactHead } from "./artifacts/heads.js";
import type { MaterialsV2Dataset } from "./artifacts/materials.js";
import { extractClaimMap } from "./claims/extract.js";
import { interpretMaterialsToEvidenceCards } from "./cards/interpret.js";
import { readEvidenceCardsDataset } from "./cards/migrate.js";
import { runVerifyCommand } from "./gates/command.js";
import { buildPackArtifacts } from "./packs/command.js";
import type { SectionPackV1 } from "./packs/schema.js";
import { buildMaterialQaDataset } from "./qa/builder.js";
import { writeSectionDraft } from "./writing/write-section.js";
import { runScannerCommand } from "./scanners/command.js";
import { runWeaveCommand } from "./weave/command.js";
import { runFinalizeCommand } from "./finalize/finalize.js";
import { runFixtureEval } from "./e2e/harness.js";
import { parsePlatformMatrixRow } from "./platform/contract.js";
import { dispatchPlatformDownload } from "./platform/dispatch.js";
import {
  extractUmichHits,
  hydrateUmichHitsWithVendorLanding,
  matchGuideEntriesToUmichHits,
  renderPlatformMatrixMarkdown,
  renderPlatformMatrixTsv,
} from "./platform/matrix.js";

function usage(exitCode = 0) {
  const msg = [
    "Usage:",
    "  histwrite init --project <dir>",
    "  histwrite project init|status|export --project <dir>",
    "  histwrite index --project <dir> [--materials <dir>]",
    "  histwrite library index|status --project <dir> [--materials <dir>]",
    "  histwrite materials build|status --project <dir> [--materials <dir>]",
    "  histwrite platform matrix --project <dir> --guide-json <path> --umich-json <path> [--no-resolve-landing]",
    "  histwrite sources matrix|platform-plan|download --project <dir> [--platform <id>] [--mode <mode>]",
    "  histwrite interpret --project <dir> [--materials <path>] [--out <path>] [--materialId <id>] [--maxItems <n>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache]",
    "  histwrite qa build --project <dir> [--materials <path>] [--cards <path>] [--out <path>] [--cardId <id>] [--maxItems <n>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache]",
    "  histwrite pack build --project <dir> [--blueprint <path>] [--cards <path>] [--materials <path>] [--qa <path>] [--outDir <dir>] [--useJudge] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--rubric <path>] [--minPassScore <n>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--no-cache] [--json]",
    "  histwrite write section --project <dir> --pack <path> [--out <path>] [--instruction <text>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache]",
    "  histwrite claims extract --project <dir> --pack <path> --draft <path> [--out <path>]",
    "  histwrite verify --project <dir> --pack <path> --draft <path> [--materials <path>] [--cards <path>] [--claims <path>] [--lexicon <path>] [--mode draft|final] [--useJudge] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--json]",
    "  histwrite weave --project <dir> --pack <path> --draft <path> [--out <path>] [--materials <path>] [--cards <path>] [--claims <path>] [--lexicon <path>] [--mode draft|final] [--useJudge] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache] [--json]",
    "  histwrite finalize --project <dir> --pack <path> --draft <path> [--materials <path>] [--cards <path>] [--lexicon <path>] [--mode draft|final] [--outDir <dir>] [--useJudge] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache] [--json]",
    "  histwrite eval run --fixture <dir> [--runs <n>] [--outDir <dir>] [--mode draft|final] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--json]",
    "  histwrite capture --project <dir> [--relay <url>] [--targetId <id>] [--no-png] [--no-text] [--maxChars <n>] [--outDir <dir>]",
    "  histwrite scan <jstor|proquest|gale|adammatthew|hathitrust> [scanner args]",
    "  histwrite relay status [--relay <url>]",
    "  histwrite export --project <dir> [--draft <dir>] [--out <path>] [--title <text>]",
    "  histwrite finalcheck --project <dir> --file <path>",
    "  histwrite rewrite --project <dir> --in <path> [--out <path>] [--memory <path>] [--instruction <text>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache]",
    "  histwrite judge --project <dir> --candidatesDir <dir> [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--rubric <path>] [--sectionId <id>] [--sectionTitle <title>] [--minPassScore <n>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--no-cache]",
    "  histwrite proxy [--listen <host>] [--port <n>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--forceModel] [--timeoutMs <n>] [--cacheDir <dir>] [--maxConcurrency <n>] [--maxRetries <n>] [--backoffBaseMs <n>] [--backoffMaxMs <n>]",
    "  histwrite episodes append --project <dir> [--file <path>]",
    "  histwrite doctor [--project <dir>]",
    "",
    "Run with:",
    "  node --import tsx runner/src/cli.ts <command> ...",
  ].join("\n");
  // eslint-disable-next-line no-console
  console.log(msg);
  process.exit(exitCode);
}

function readArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const raw = process.argv[idx + 1];
  if (!raw) return null;
  return String(raw);
}

function readNumberArg(flag: string): number | null {
  const raw = readArg(flag);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function readNumberEnv(name: string): number | null {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function readFloatArg(flag: string): number | null {
  const raw = readArg(flag);
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function readStdinUtf8(): Promise<string> {
  process.stdin.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

function extractObjectArray(input: unknown, label: string): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    for (const key of ["rows", "items", "entries", "results"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
      }
    }
  }
  throw new Error(`invalid ${label}: expected array or object containing rows/items/entries/results`);
}

async function runPlatformMatrix(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const guideJsonPath = readArg("--guide-json");
  const umichJsonPath = readArg("--umich-json");
  if (!guideJsonPath || !umichJsonPath) usage(2);

  const guideInput = JSON.parse(await fs.readFile(path.resolve(guideJsonPath), "utf8")) as unknown;
  const umichInput = JSON.parse(await fs.readFile(path.resolve(umichJsonPath), "utf8")) as unknown;

  const guideEntries = extractObjectArray(guideInput, "guide-json");
  const baseUmichHits = extractUmichHits(umichInput);
  const umichHits = hasFlag("--no-resolve-landing")
    ? baseUmichHits
    : await hydrateUmichHitsWithVendorLanding(baseUmichHits);
  const rows = matchGuideEntriesToUmichHits(guideEntries, umichHits);

  const jsonPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.json");
  const tsvPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.tsv");
  const mdPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.md");

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    projectDir: layout.projectDir,
    guideJsonPath: path.resolve(guideJsonPath),
    umichJsonPath: path.resolve(umichJsonPath),
    rowCount: rows.length,
    rows,
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(tsvPath, renderPlatformMatrixTsv(rows), "utf8");
  await fs.writeFile(mdPath, renderPlatformMatrixMarkdown(rows), "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      rowCount: rows.length,
      jsonPath,
      tsvPath,
      mdPath,
    }),
  );
  process.exit(0);
}

async function readStoredPlatformMatrix(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const jsonPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.json");
  const tsvPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.tsv");
  const mdPath = path.join(layout.materialsIndexDir, "umich_platform_matrix.md");
  const parsed = JSON.parse(await fs.readFile(jsonPath, "utf8")) as {
    generatedAt?: string;
    rows?: unknown[];
  };
  const rows = Array.isArray(parsed.rows) ? parsed.rows.map((row) => parsePlatformMatrixRow(row)) : [];
  return { layout, jsonPath, tsvPath, mdPath, generatedAt: parsed.generatedAt ?? null, rows };
}

async function runSourcesMatrix(projectDir: string) {
  const stored = await readStoredPlatformMatrix(projectDir);
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: stored.layout.projectDir,
      generatedAt: stored.generatedAt,
      rowCount: stored.rows.length,
      jsonPath: stored.jsonPath,
      tsvPath: stored.tsvPath,
      mdPath: stored.mdPath,
    }),
  );
  process.exit(0);
}

async function runSourcesPlatformPlan(projectDir: string) {
  const stored = await readStoredPlatformMatrix(projectDir);
  const platforms: Record<string, { count: number; statuses: Record<string, number> }> = {};

  for (const row of stored.rows) {
    const bucket = (platforms[row.platform] ??= { count: 0, statuses: {} });
    bucket.count += 1;
    bucket.statuses[row.status] = (bucket.statuses[row.status] ?? 0) + 1;
  }

  console.log(
    JSON.stringify({
      ok: true,
      projectDir: stored.layout.projectDir,
      rowCount: stored.rows.length,
      platforms,
      matrixPath: stored.jsonPath,
    }),
  );
  process.exit(0);
}

async function runSourcesDownload(projectDir: string) {
  const stored = await readStoredPlatformMatrix(projectDir);
  const platform = String(readArg("--platform") ?? "").trim().toLowerCase();
  const mode = String(readArg("--mode") ?? "").trim().toLowerCase();
  if (!platform) usage(2);

  const row = stored.rows.find((candidate) => {
    if (candidate.platform !== platform) return false;
    if (mode && candidate.downloadMode !== mode) return false;
    return true;
  });
  if (!row) {
    throw new Error(`no matrix row found for platform=${platform}${mode ? ` mode=${mode}` : ""}`);
  }

  const relayBaseUrl = readArg("--relay") ?? "http://127.0.0.1:18992";
  const outDir = readArg("--outDir") ?? path.join(stored.layout.materialsIndexDir, "downloads", row.platform);
  const request = {
    projectDir: stored.layout.projectDir,
    outDir,
    targetId: readArg("--targetId") ?? undefined,
    term: readArg("--term") ?? undefined,
    includePng: !hasFlag("--no-png"),
    includeText: !hasFlag("--no-text"),
    maxChars: readNumberArg("--maxChars") ?? undefined,
    dryRun: hasFlag("--dry-run"),
  };

  const result = await dispatchPlatformDownload({
    deps: {
      relayBaseUrl,
      snapshot: async (input) => {
        if (request.dryRun) {
          return {
            id: "dry_run_snapshot",
            metaPath: path.join(input.outDir ?? outDir, "dry-run.json"),
            textPath: null,
            pngPath: null,
            tab: {
              targetId: input.targetId ?? "dry-run-target",
              title: `${row.platform} dry-run`,
              url: row.landingUrl ?? "",
            },
            capturedAt: "1970-01-01T00:00:00.000Z",
          };
        }
        return await captureRelaySnapshot({
          layout: stored.layout,
          relayBaseUrl,
          targetId: input.targetId,
          includePng: input.includePng,
          includeText: input.includeText,
          maxChars: input.maxChars,
          outDir: input.outDir,
        });
      },
      runCdp: async (input) => {
        if (input.kind === "gale") {
          return {
            scanner: "gale",
            dryRun: Boolean(input.request.dryRun),
            term: input.request.term ?? null,
            startUrl: input.row.landingUrl,
          };
        }
        return {
          kind: input.kind,
          relayBaseUrl: input.relayBaseUrl,
          landingUrl: input.row.landingUrl,
          dryRun: Boolean(input.request.dryRun),
        };
      },
    },
    row,
    request,
  });

  console.log(
    JSON.stringify({
      ok: true,
      row,
      result,
    }),
  );
  process.exit(0);
}

async function runProjectInit(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "project init", projectDir: layout.projectDir });
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runProjectStatus(projectDir: string) {
  const layout = resolveHistwriteLayout(projectDir);
  const check = async (target: string) => await fs.access(target).then(() => true).catch(() => false);
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      materialsDir: layout.materialsDir,
      blueprintDir: layout.blueprintDir,
      outlineDir: layout.outlineDir,
      draftDir: layout.draftDir,
      exportDir: layout.exportDir,
      metaDir: layout.metaDir,
      exists: {
        materialsDir: await check(layout.materialsDir),
        blueprintDir: await check(layout.blueprintDir),
        outlineDir: await check(layout.outlineDir),
        draftDir: await check(layout.draftDir),
        exportDir: await check(layout.exportDir),
      },
    }),
  );
  process.exit(0);
}

async function runProjectExport(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "project export", projectDir: layout.projectDir });
  const draftDir = readArg("--draft") ?? layout.draftDir;
  const outPath = readArg("--out") ?? path.join(layout.exportDir, "draft.md");
  const title = readArg("--title") ?? "草稿汇总";
  await logger.write("export_begin", { draftDir: path.resolve(draftDir), outPath: path.resolve(outPath) });
  const result = await exportDraftMarkdown({ layout, draftDir, outPath, title });
  await logger.write("export_done", { outPath: result.outPath, files: result.inputFiles.length });
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, outPath: result.outPath, inputFiles: result.inputFiles.map((f) => ({ path: f.path, bytes: f.bytes })), runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runLibraryIndex(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "library index", projectDir: layout.projectDir });
  const materialsDir = readArg("--materials") ?? layout.materialsDir;
  await logger.write("index_begin", { materialsDir: path.resolve(materialsDir) });
  const library = await indexMaterials({ layout, materialsDir });
  await logger.write("index_done", { count: library.materials.length });
  const mdPath = await writeLibraryIndexMarkdown({ layout, library });
  await logger.write("library_index_written", { path: mdPath });
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, materialsDir: path.resolve(materialsDir), count: library.materials.length, libraryIndexMarkdown: mdPath, runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runLibraryStatus(projectDir: string) {
  const layout = resolveHistwriteLayout(projectDir);
  const libraryPath = path.join(layout.materialsIndexDir, "library.json");
  let indexed = false;
  let count = 0;
  try {
    const parsed = JSON.parse(await fs.readFile(libraryPath, "utf8")) as { materials?: unknown[] };
    indexed = true;
    count = Array.isArray(parsed.materials) ? parsed.materials.length : 0;
  } catch {
    indexed = false;
  }
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, materialsDir: layout.materialsDir, indexDir: layout.materialsIndexDir, libraryPath, indexed, count }));
  process.exit(0);
}

async function readLibraryIndexOrBuild(params: {
  projectDir: string;
  materialsDir: string;
}): Promise<{ layout: Awaited<ReturnType<typeof ensureHistwriteProject>>; library: LibraryIndex; fromIndex: boolean }> {
  const layout = await ensureHistwriteProject(params.projectDir);
  const libraryPath = path.join(layout.materialsIndexDir, "library.json");
  try {
    const parsed = JSON.parse(await fs.readFile(libraryPath, "utf8")) as LibraryIndex;
    if (parsed?.version !== 1 || !Array.isArray(parsed.materials)) throw new Error("invalid library.json");
    return { layout, library: parsed, fromIndex: false };
  } catch {
    const library = await indexMaterials({ layout, materialsDir: params.materialsDir });
    return { layout, library, fromIndex: true };
  }
}

async function runMaterialsBuild(projectDir: string) {
  const materialsDirArg = readArg("--materials");
  const { layout, library, fromIndex } = await readLibraryIndexOrBuild({
    projectDir,
    materialsDir: materialsDirArg ?? resolveHistwriteLayout(projectDir).materialsDir,
  });

  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "materials build", projectDir: layout.projectDir });
  await logger.write("materials_build_begin", { fromIndex, materialsDir: materialsDirArg ? path.resolve(materialsDirArg) : layout.materialsDir });

  const built = await buildMaterialsV2FromLibraryIndex({ layout, library });
  const ref = artifactRefFromValue({ outPath: built.outPath, value: built.dataset });
  const heads = await setArtifactHead(layout, { key: "materialsV2", ref });
  await logger.write("materials_build_done", { outPath: built.outPath, count: built.dataset.materials.length, skipped: built.skipped.length });
  await logger.write("heads_updated", { headsPath: path.join(layout.artifactsDir, "heads.json"), materialsV2: heads.materialsV2 });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: built.outPath,
      count: built.dataset.materials.length,
      skipped: built.skipped,
      head: heads.materialsV2,
      fromIndex,
      runLog: logger.path,
    }),
  );

  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runMaterialsStatus(projectDir: string) {
  const layout = resolveHistwriteLayout(projectDir);
  const outPath = path.join(layout.materialsIndexDir, "materials.v2.json");
  let built = false;
  let count = 0;
  try {
    const parsed = JSON.parse(await fs.readFile(outPath, "utf8")) as { materials?: unknown[] };
    built = true;
    count = Array.isArray(parsed.materials) ? parsed.materials.length : 0;
  } catch {
    built = false;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, outPath, built, count }));
  process.exit(0);
}

async function runInterpret(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });

  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "interpret", projectDir: layout.projectDir });

  const materialsPath = readArg("--materials") ?? path.join(layout.materialsIndexDir, "materials.v2.json");
  const outPath = readArg("--out") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const materialId = (readArg("--materialId") ?? "").trim() || null;
  const maxItems = readNumberArg("--maxItems") ?? 6;
  const noCache = hasFlag("--no-cache");

  const materials = JSON.parse(await fs.readFile(path.resolve(materialsPath), "utf8")) as MaterialsV2Dataset;

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_INTERPRET_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "interpret requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "interpret requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "interpret requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `interpret requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("interpret requires --model (or opencode model ref / env HISTWRITE_INTERPRET_MODEL/OPENAI_MODEL)");

  await logger.write("interpret_begin", { materialsPath: path.resolve(materialsPath), outPath: path.resolve(outPath), materialId, maxItems, model, endpoint });

  const { dataset, result } = await interpretMaterialsToEvidenceCards({
    layout,
    materials,
    outPath,
    materialId,
    maxItemsPerMaterial: maxItems,
    noCache,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  const ref = artifactRefFromValue({ outPath: result.outPath, value: dataset });
  const heads = await setArtifactHead(layout, { key: "cardsV2", ref });

  await logger.write("interpret_done", { outPath: result.outPath, cards: result.cards, gaps: result.gaps, cacheHits: result.cacheHits, head: heads.cardsV2 });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: result.outPath,
      cards: result.cards,
      gaps: result.gaps,
      cacheHits: result.cacheHits,
      endpoint: result.endpoint,
      model: result.model,
      head: heads.cardsV2,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runQaBuild(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });

  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "qa build", projectDir: layout.projectDir });

  const materialsPath = readArg("--materials") ?? path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = readArg("--cards") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const outPath = readArg("--out") ?? path.join(layout.artifactsDir, "qa.v1.json");
  const cardId = (readArg("--cardId") ?? "").trim() || null;
  const maxItems = readNumberArg("--maxItems") ?? 6;
  const noCache = hasFlag("--no-cache");

  const materials = JSON.parse(await fs.readFile(path.resolve(materialsPath), "utf8")) as MaterialsV2Dataset;
  const cards = await readEvidenceCardsDataset({ cardsPath, materials });

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_QA_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "qa build requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "qa build requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "qa build requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `qa build requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("qa build requires --model (or opencode model ref / env HISTWRITE_QA_MODEL/OPENAI_MODEL)");

  await logger.write("qa_build_begin", {
    materialsPath: path.resolve(materialsPath),
    cardsPath: path.resolve(cardsPath),
    outPath: path.resolve(outPath),
    cardId,
    maxItems,
    model,
    endpoint,
  });

  const { dataset, result } = await buildMaterialQaDataset({
    layout,
    materials,
    cards,
    outPath,
    cardId,
    maxItemsPerCard: maxItems,
    noCache,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  const ref = artifactRefFromValue({ outPath: result.outPath, value: dataset });
  const heads = await setArtifactHead(layout, { key: "qaV1", ref });

  await logger.write("qa_build_done", {
    outPath: result.outPath,
    items: result.items,
    gaps: result.gaps,
    cacheHits: result.cacheHits,
    head: heads.qaV1,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: result.outPath,
      items: result.items,
      gaps: result.gaps,
      cacheHits: result.cacheHits,
      endpoint: result.endpoint,
      model: result.model,
      head: heads.qaV1,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runPackBuild(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "pack build", projectDir: layout.projectDir });

  const blueprintPath = readArg("--blueprint") ?? path.join(layout.blueprintDir, "blueprint.v2.json");
  const cardsPath = readArg("--cards") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const materialsPath = readArg("--materials");
  const qaPath = readArg("--qa");
  const outDir = readArg("--outDir") ?? path.join(layout.artifactsDir, "packs");
  const noCache = hasFlag("--no-cache");
  const useJudge = hasFlag("--useJudge");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  let judgeConfig: Parameters<typeof buildPackArtifacts>[0]["judge"] = null;
  if (useJudge) {
    const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
    const modelArg = (readArg("--model") ?? process.env.HISTWRITE_PACK_MODEL ?? process.env.HISTWRITE_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
    const apiBaseUrlArg =
      (readArg("--apiBaseUrl") ??
        process.env.OPENAI_BASE_URL ??
        process.env.OPENAI_API_BASE ??
        process.env.OPENAI_API_BASE_URL ??
        "").trim();

    let apiBaseUrl = apiBaseUrlArg;
    let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
    let model = modelArg;

    if (useOpencode) {
      const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
      const opencodeModel = readArg("--opencodeModel");
      const opencodeProvider = readArg("--opencodeProvider");
      const resolved = await resolveOpenAiCompatFromOpencode({
        configPath: opencodeConfig,
        modelRef: opencodeModel,
        providerName: opencodeProvider,
        modelOverride: model || null,
      });
      apiBaseUrl = resolved.apiBaseUrl;
      apiKey = resolved.apiKey;
      model = resolved.model;
    }

    const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
    const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
    const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
    const maxTokens = readNumberArg("--maxTokens") ?? null;
    const minPassScore = readFloatArg("--minPassScore") ?? 0.6;
    const rubricPath = readArg("--rubric");

    if (!apiBaseUrl.trim()) {
      throw new Error(
        useOpencode
          ? "pack build --useJudge requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
          : "pack build --useJudge requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
      );
    }
    if (!apiKey) {
      throw new Error(
        useOpencode
          ? "pack build --useJudge requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
          : `pack build --useJudge requires env ${apiKeyEnv} (API key not found)`,
      );
    }
    if (!model) {
      throw new Error("pack build --useJudge requires --model (or opencode model ref / env HISTWRITE_PACK_MODEL/HISTWRITE_JUDGE_MODEL/OPENAI_MODEL)");
    }

    judgeConfig = {
      rubricPath,
      minPassScore,
      client: {
        apiBaseUrl,
        apiKey,
        model,
        endpoint,
        timeoutMs,
        temperature: 0,
        ...(typeof maxTokens === "number" ? { maxTokens } : {}),
      },
    };
  }

  await logger.write("pack_build_begin", {
    blueprintPath: path.resolve(blueprintPath),
    cardsPath: path.resolve(cardsPath),
    materialsPath: materialsPath ? path.resolve(materialsPath) : null,
    qaPath: qaPath ? path.resolve(qaPath) : null,
    outDir: path.resolve(outDir),
    noCache,
    useJudge,
    judgeModel: judgeConfig?.client.model ?? null,
  });

  const built = await buildPackArtifacts({
    layout,
    blueprintPath,
    cardsPath,
    materialsPath,
    qaPath,
    outDir,
    noCache,
    judge: judgeConfig,
  });

  const ref = artifactRefFromValue({ outPath: built.manifestPath, value: built.manifest });
  const heads = await setArtifactHead(layout, { key: "packsV1", ref });

  await logger.write("pack_build_done", {
    manifestPath: built.manifestPath,
    packPaths: built.packPaths,
    cacheHit: built.cacheHit,
    head: heads.packsV1,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      manifestPath: built.manifestPath,
      packPaths: built.packPaths,
      sections: built.manifest.sections,
      cacheHit: built.cacheHit,
      usedJudge: Boolean(judgeConfig),
      head: heads.packsV1,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runWriteSection(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "write section", projectDir: layout.projectDir });

  const packPath = readArg("--pack");
  if (!packPath) usage(2);
  const pack = JSON.parse(await fs.readFile(path.resolve(packPath), "utf8")) as SectionPackV1;
  const outPath = readArg("--out") ?? path.join(layout.draftDir, `section.${pack.sectionId}.md`);
  const instruction = readArg("--instruction");
  const noCache = hasFlag("--no-cache");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_WRITE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0.2;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "write section requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "write section requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "write section requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `write section requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("write section requires --model (or opencode model ref / env HISTWRITE_WRITE_MODEL/OPENAI_MODEL)");

  await logger.write("write_section_begin", {
    packPath: path.resolve(packPath),
    outPath: path.resolve(outPath),
    sectionId: pack.sectionId,
    model,
    endpoint,
  });

  const result = await writeSectionDraft({
    layout,
    pack,
    outPath,
    instruction,
    noCache,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  await logger.write("write_section_done", {
    outPath: result.outPath,
    claims: result.claims,
    cacheHit: result.cacheHit,
  });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: result.outPath,
      claims: result.claims,
      cacheHit: result.cacheHit,
      endpoint: result.endpoint,
      model: result.model,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runClaimsExtract(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "claims extract", projectDir: layout.projectDir });

  const packPath = readArg("--pack");
  const draftPath = readArg("--draft");
  if (!packPath || !draftPath) usage(2);

  const pack = JSON.parse(await fs.readFile(path.resolve(packPath), "utf8")) as SectionPackV1;
  const draftText = await fs.readFile(path.resolve(draftPath), "utf8");
  const draftBaseName = path.basename(draftPath, path.extname(draftPath));
  const outPath = readArg("--out") ?? path.join(layout.artifactsDir, "claims", `${draftBaseName}.claims.v1.json`);

  await logger.write("claims_extract_begin", {
    packPath: path.resolve(packPath),
    draftPath: path.resolve(draftPath),
    outPath: path.resolve(outPath),
    sectionId: pack.sectionId,
  });

  const claimMap = extractClaimMap({ draft: draftText, pack });
  const artifact = buildClaimsArtifactV1({
    claims: claimMap.claims,
    draftPath: path.resolve(draftPath),
    packPath: path.resolve(packPath),
    packId: pack.packId,
    sectionId: pack.sectionId,
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(path.resolve(outPath), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const invalidClaims = artifact.claims.filter((claim) => claim.riskFlags.includes("invalid_evidence_ref")).length;

  await logger.write("claims_extract_done", {
    outPath: path.resolve(outPath),
    claims: artifact.claims.length,
    invalidClaims,
    claimSet: artifact.claimSet.claims.length,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: path.resolve(outPath),
      claims: artifact.claims.length,
      invalidClaims,
      claimSet: artifact.claimSet.claims.length,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

async function runVerify(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "verify", projectDir: layout.projectDir });

  const packPath = readArg("--pack");
  const draftPath = readArg("--draft");
  if (!packPath || !draftPath) usage(2);

  const materialsPath = readArg("--materials") ?? path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = readArg("--cards") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const claimsPath = readArg("--claims");
  const lexiconPath = readArg("--lexicon");
  const mode = (readArg("--mode") ?? "final").trim().toLowerCase() === "draft" ? "draft" : "final";
  const useJudge = hasFlag("--useJudge");
  const jsonMode = hasFlag("--json");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  let judgeClient: Parameters<typeof runVerifyCommand>[0]["judgeClient"] = null;
  if (useJudge) {
    const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
    const modelArg = (readArg("--model") ?? process.env.HISTWRITE_VERIFY_MODEL ?? process.env.HISTWRITE_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
    const apiBaseUrlArg =
      (readArg("--apiBaseUrl") ??
        process.env.OPENAI_BASE_URL ??
        process.env.OPENAI_API_BASE ??
        process.env.OPENAI_API_BASE_URL ??
        "").trim();

    let apiBaseUrl = apiBaseUrlArg;
    let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
    let model = modelArg;

    if (useOpencode) {
      const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
      const opencodeModel = readArg("--opencodeModel");
      const opencodeProvider = readArg("--opencodeProvider");
      const resolved = await resolveOpenAiCompatFromOpencode({
        configPath: opencodeConfig,
        modelRef: opencodeModel,
        providerName: opencodeProvider,
        modelOverride: model || null,
      });
      apiBaseUrl = resolved.apiBaseUrl;
      apiKey = resolved.apiKey;
      model = resolved.model;
    }

    const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
    const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
    const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
    const maxTokens = readNumberArg("--maxTokens") ?? null;

    if (!apiBaseUrl.trim()) {
      throw new Error(
        useOpencode
          ? "verify --useJudge requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
          : "verify --useJudge requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
      );
    }
    if (!apiKey) {
      throw new Error(
        useOpencode
          ? "verify --useJudge requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
          : `verify --useJudge requires env ${apiKeyEnv} (API key not found)`,
      );
    }
    if (!model) {
      throw new Error("verify --useJudge requires --model (or opencode model ref / env HISTWRITE_VERIFY_MODEL/HISTWRITE_JUDGE_MODEL/OPENAI_MODEL)");
    }

    judgeClient = {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature: 0,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    };
  }

  await logger.write("verify_begin", {
    packPath: path.resolve(packPath),
    draftPath: path.resolve(draftPath),
    materialsPath: path.resolve(materialsPath),
    cardsPath: path.resolve(cardsPath),
    claimsPath: claimsPath ? path.resolve(claimsPath) : null,
    lexiconPath: lexiconPath ? path.resolve(lexiconPath) : null,
    mode,
    useJudge,
  });

  const result = await runVerifyCommand({
    layout,
    packPath,
    draftPath,
    materialsPath,
    cardsPath,
    claimsPath,
    lexiconPath,
    mode,
    useJudge,
    judgeClient,
  });

  await logger.write("verify_done", result);

  if (jsonMode) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...result, runLog: logger.path }));
    await logger.write("command_end", { ok: true, status: result.status });
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...result, runLog: logger.path }));
  await logger.write("command_end", { ok: true, status: result.status });
  process.exit(result.status === "failed" ? 1 : 0);
}

async function runWeave(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "weave", projectDir: layout.projectDir });

  const packPath = readArg("--pack");
  const draftPath = readArg("--draft");
  if (!packPath || !draftPath) usage(2);

  const materialsPath = readArg("--materials") ?? path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = readArg("--cards") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const claimsPath = readArg("--claims");
  const lexiconPath = readArg("--lexicon");
  const outPath = readArg("--out") ?? path.join(layout.draftDir, `${path.basename(draftPath, path.extname(draftPath))}.woven.md`);
  const mode = (readArg("--mode") ?? "final").trim().toLowerCase() === "draft" ? "draft" : "final";
  const noCache = hasFlag("--no-cache");
  const useJudge = hasFlag("--useJudge");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_WEAVE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0.2;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "weave requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "weave requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "weave requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `weave requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("weave requires --model (or opencode model ref / env HISTWRITE_WEAVE_MODEL/OPENAI_MODEL)");

  let judgeClient: Parameters<typeof runWeaveCommand>[0]["judgeClient"] = null;
  if (useJudge) {
    judgeClient = {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature: 0,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    };
  }

  await logger.write("weave_begin", {
    packPath: path.resolve(packPath),
    draftPath: path.resolve(draftPath),
    outPath: path.resolve(outPath),
    materialsPath: path.resolve(materialsPath),
    cardsPath: path.resolve(cardsPath),
    claimsPath: claimsPath ? path.resolve(claimsPath) : null,
    lexiconPath: lexiconPath ? path.resolve(lexiconPath) : null,
    mode,
    useJudge,
  });

  const result = await runWeaveCommand({
    layout,
    packPath,
    draftPath,
    outPath,
    materialsPath,
    cardsPath,
    claimsPath,
    lexiconPath,
    mode,
    noCache,
    useJudge,
    judgeClient,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  await logger.write("weave_done", {
    outPath: result.outPath,
    claimDiff: result.claimDiff,
    verify: result.verify,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...result, runLog: logger.path }));
  await logger.write("command_end", { ok: true, status: result.verify.status });
  process.exit(result.verify.status === "failed" ? 1 : 0);
}

async function runFinalize(projectDir: string) {
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "finalize", projectDir: layout.projectDir });

  const packPath = readArg("--pack");
  const draftPath = readArg("--draft");
  if (!packPath || !draftPath) usage(2);

  const materialsPath = readArg("--materials") ?? path.join(layout.materialsIndexDir, "materials.v2.json");
  const cardsPath = readArg("--cards") ?? path.join(layout.artifactsDir, "cards.v2.json");
  const lexiconPath = readArg("--lexicon");
  const outDir = readArg("--outDir");
  const mode = (readArg("--mode") ?? "final").trim().toLowerCase() === "draft" ? "draft" : "final";
  const noCache = hasFlag("--no-cache");
  const useJudge = hasFlag("--useJudge");
  const jsonMode = hasFlag("--json");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg =
    (readArg("--model") ??
      process.env.HISTWRITE_FINALIZE_MODEL ??
      process.env.HISTWRITE_WEAVE_MODEL ??
      process.env.HISTWRITE_WRITE_MODEL ??
      process.env.OPENAI_MODEL ??
      "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0.2;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "finalize requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "finalize requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "finalize requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `finalize requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) {
    throw new Error(
      "finalize requires --model (or opencode model ref / env HISTWRITE_FINALIZE_MODEL/HISTWRITE_WEAVE_MODEL/HISTWRITE_WRITE_MODEL/OPENAI_MODEL)",
    );
  }

  let judgeClient: Parameters<typeof runFinalizeCommand>[0]["judgeClient"] = null;
  if (useJudge) {
    judgeClient = {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature: 0,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    };
  }

  await logger.write("finalize_begin", {
    packPath: path.resolve(packPath),
    draftPath: path.resolve(draftPath),
    materialsPath: path.resolve(materialsPath),
    cardsPath: path.resolve(cardsPath),
    lexiconPath: lexiconPath ? path.resolve(lexiconPath) : null,
    outDir: outDir ? path.resolve(outDir) : null,
    mode,
    useJudge,
  });

  const result = await runFinalizeCommand({
    layout,
    packPath,
    draftPath,
    materialsPath,
    cardsPath,
    lexiconPath,
    outDir,
    mode,
    noCache,
    useJudge,
    judgeClient,
    logger,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  await logger.write("finalize_done", result);

  if (jsonMode) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...result, runLog: logger.path }));
    await logger.write("command_end", { ok: result.ok, status: result.status });
    process.exit(result.status === "failed" ? 1 : 0);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...result, runLog: logger.path }));
  await logger.write("command_end", { ok: result.ok, status: result.status });
  process.exit(result.status === "failed" ? 1 : 0);
}

async function runEvalRun() {
  const fixtureRoot = readArg("--fixture");
  if (!fixtureRoot) usage(2);

  const fixtureProjectDir = path.join(path.resolve(fixtureRoot), "project");
  await loadDotEnvFromDir({ dir: fixtureProjectDir });

  const runs = Math.max(1, readNumberArg("--runs") ?? 3);
  const outDir = readArg("--outDir");
  const mode = (readArg("--mode") ?? "final").trim().toLowerCase() === "draft" ? "draft" : "final";
  const jsonMode = hasFlag("--json");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg =
    (readArg("--model") ??
      process.env.HISTWRITE_FINALIZE_MODEL ??
      process.env.HISTWRITE_WEAVE_MODEL ??
      process.env.HISTWRITE_WRITE_MODEL ??
      process.env.OPENAI_MODEL ??
      "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0.2;

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "eval run requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "eval run requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "eval run requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `eval run requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) {
    throw new Error(
      "eval run requires --model (or opencode model ref / env HISTWRITE_FINALIZE_MODEL/HISTWRITE_WEAVE_MODEL/HISTWRITE_WRITE_MODEL/OPENAI_MODEL)",
    );
  }

  const result = await runFixtureEval({
    fixtureRoot,
    runs,
    outDir,
    mode,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });

  if (jsonMode) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result));
    process.exit(result.summary.ok ? 0 : 1);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
  process.exit(result.summary.ok ? 0 : 1);
}

async function runRelayStatus(relayBaseUrl: string) {
  const baseUrl = relayBaseUrl.replace(/\/$/, "");
  const [status, tabs] = await Promise.all([
    fetchJson(`${baseUrl}/extension/status`) as Promise<{ connected?: boolean }>,
    fetchJson(`${baseUrl}/tabs`).catch(() => []) as Promise<unknown>,
  ]);
  console.log(JSON.stringify({ ok: true, relayBaseUrl: baseUrl, connected: Boolean(status?.connected), tabs }));
  process.exit(0);
}

async function runDoctor(projectDir: string) {
  const layout = resolveHistwriteLayout(projectDir);
  const checks = {
    projectDir: layout.projectDir,
    materialsDir: await fs.access(layout.materialsDir).then(() => true).catch(() => false),
    blueprintDir: await fs.access(layout.blueprintDir).then(() => true).catch(() => false),
    draftDir: await fs.access(layout.draftDir).then(() => true).catch(() => false),
  };
  console.log(JSON.stringify({ ok: true, checks }));
  process.exit(0);
}

const args = process.argv.slice(2);
const cmd = args[0] ?? "";
const sub = args[1] ?? "";

if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") usage(0);

if (cmd === "project") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "init") await runProjectInit(projectDir);
  if (sub === "status") await runProjectStatus(projectDir);
  if (sub === "export") await runProjectExport(projectDir);
  usage(2);
}

if (cmd === "library") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "index") await runLibraryIndex(projectDir);
  if (sub === "status") await runLibraryStatus(projectDir);
  usage(2);
}

if (cmd === "materials") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "build") await runMaterialsBuild(projectDir);
  if (sub === "status") await runMaterialsStatus(projectDir);
  usage(2);
}

if (cmd === "platform") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "matrix") await runPlatformMatrix(projectDir);
  usage(2);
}

if (cmd === "sources") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "matrix") await runSourcesMatrix(projectDir);
  if (sub === "platform-plan") await runSourcesPlatformPlan(projectDir);
  if (sub === "download") await runSourcesDownload(projectDir);
  usage(2);
}

if (cmd === "qa") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "build") await runQaBuild(projectDir);
  usage(2);
}

if (cmd === "pack") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "build") await runPackBuild(projectDir);
  usage(2);
}

if (cmd === "write") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "section") await runWriteSection(projectDir);
  usage(2);
}

if (cmd === "claims") {
  const projectDir = readArg("--project") ?? process.cwd();
  if (sub === "extract") await runClaimsExtract(projectDir);
  usage(2);
}

if (cmd === "verify") {
  const projectDir = readArg("--project") ?? process.cwd();
  await runVerify(projectDir);
}

if (cmd === "weave") {
  const projectDir = readArg("--project") ?? process.cwd();
  await runWeave(projectDir);
}

if (cmd === "finalize") {
  const projectDir = readArg("--project") ?? process.cwd();
  await runFinalize(projectDir);
}

if (cmd === "eval") {
  if (sub === "run") await runEvalRun();
  usage(2);
}

if (cmd === "interpret") {
  const projectDir = readArg("--project") ?? process.cwd();
  await runInterpret(projectDir);
}

if (cmd === "relay") {
  const relayBaseUrl = readArg("--relay") ?? "http://127.0.0.1:18992";
  if (sub === "status") await runRelayStatus(relayBaseUrl);
  usage(2);
}

if (cmd === "scan") {
  await runScannerCommand(args);
  process.exit(0);
}

if (cmd === "doctor") {
  const projectDir = readArg("--project") ?? process.cwd();
  await runDoctor(projectDir);
}

if (cmd === "init") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "init", projectDir: layout.projectDir });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, projectDir: layout.projectDir, runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "index") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "index", projectDir: layout.projectDir });
  const materialsDir = readArg("--materials") ?? layout.materialsDir;
  await logger.write("index_begin", { materialsDir: path.resolve(materialsDir) });
  const library = await indexMaterials({ layout, materialsDir });
  await logger.write("index_done", { count: library.materials.length });
  const mdPath = await writeLibraryIndexMarkdown({ layout, library });
  await logger.write("library_index_written", { path: mdPath });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      materialsDir: path.resolve(materialsDir),
      count: library.materials.length,
      libraryIndexMarkdown: mdPath,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "capture") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "capture", projectDir: layout.projectDir });

  const relayBaseUrl = readArg("--relay") ?? "http://127.0.0.1:18992";
  const targetId = readArg("--targetId") ?? null;
  const includePng = !hasFlag("--no-png");
  const includeText = !hasFlag("--no-text");
  const maxChars = readNumberArg("--maxChars") ?? 200_000;
  const outDir = readArg("--outDir") ?? path.join(layout.materialsIndexDir, "snapshots");

  await logger.write("capture_begin", { relayBaseUrl, targetId, includePng, includeText, maxChars, outDir });
  const result = await captureRelaySnapshot({
    layout,
    relayBaseUrl,
    targetId: targetId ?? undefined,
    includePng,
    includeText,
    maxChars,
    outDir,
  });
  await logger.write("capture_done", { id: result.id, metaPath: result.metaPath });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      id: result.id,
      capturedAt: result.capturedAt,
      tab: result.tab,
      metaPath: result.metaPath,
      textPath: result.textPath,
      pngPath: result.pngPath,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "export") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "export", projectDir: layout.projectDir });

  const draftDir = readArg("--draft") ?? layout.draftDir;
  const outPath = readArg("--out") ?? path.join(layout.exportDir, "draft.md");
  const title = readArg("--title") ?? "草稿汇总";
  await logger.write("export_begin", { draftDir: path.resolve(draftDir), outPath: path.resolve(outPath) });
  const result = await exportDraftMarkdown({ layout, draftDir, outPath, title });
  await logger.write("export_done", { outPath: result.outPath, files: result.inputFiles.length });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      projectDir: layout.projectDir,
      outPath: result.outPath,
      inputFiles: result.inputFiles.map((f) => ({ path: f.path, bytes: f.bytes })),
      runLog: logger.path,
    }),
  );

  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "finalcheck") {
  const projectDir = readArg("--project") ?? process.cwd();
  const filePath = readArg("--file") ?? readArg("--path");
  if (!filePath) usage(2);

  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  const resolvedPath = path.resolve(filePath);
  await logger.write("command_start", { cmd: "finalcheck", projectDir: layout.projectDir, filePath: resolvedPath });

  const markdown = await fs.readFile(resolvedPath, "utf8");
  const report = analyzeFinalCheck({ filePath: resolvedPath, markdown });
  const safeStem = (path.parse(resolvedPath).name || "draft")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "draft";
  const outDir = path.join(layout.metaDir, "reports", "finalcheck", safeStem, "latest");
  await fs.mkdir(outDir, { recursive: true });

  const reportPath = path.join(outDir, "report.md");
  const jsonPath = path.join(outDir, "report.json");
  await fs.writeFile(reportPath, `${renderFinalCheckMarkdown(report).trim()}
`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}
`, "utf8");

  await logger.write("finalcheck_done", { reportPath, jsonPath, errorCount: report.summary.errorCount, warningCount: report.summary.warningCount });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, filePath: resolvedPath, reportPath, jsonPath, summary: report.summary, runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "judge") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "judge", projectDir: layout.projectDir });

  const candidatesDir = readArg("--candidatesDir");
  if (!candidatesDir) usage(2);

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();

  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }
  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "judge requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "judge requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "judge requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `judge requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("judge requires --model (or opencode model ref / env HISTWRITE_JUDGE_MODEL/OPENAI_MODEL)");

  const rubricPath = readArg("--rubric");
  const sectionId = (readArg("--sectionId") ?? "section").trim() || "section";
  const sectionTitle = (readArg("--sectionTitle") ?? sectionId).trim() || sectionId;
  const minPassScore = readFloatArg("--minPassScore") ?? 0.6;
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const noCache = hasFlag("--no-cache");

  await logger.write("judge_begin", { candidatesDir: path.resolve(candidatesDir), model, endpoint, minPassScore });
  const out = await runBestOfKJudge({
    layout,
    sectionId,
    sectionTitle,
    candidatesDir,
    rubricPath,
    minPassScore,
    noCache,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature: 0,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });
  await logger.write("judge_done", { judgePath: out.judgePath, chosenId: out.result.chosenId, cacheHit: out.cacheHit });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      judgePath: out.judgePath,
      episodesPath: out.episodesPath,
      cacheHit: out.cacheHit,
      endpoint: out.endpoint,
      chosenId: out.result.chosenId,
      ranked: out.result.ranked,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "rewrite") {
  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  await loadDotEnvFromDir({ dir: layout.projectDir });
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "rewrite", projectDir: layout.projectDir });

  const inPath = readArg("--in") ?? readArg("--input");
  if (!inPath) usage(2);
  const outPath = readArg("--out") ?? path.join(layout.exportDir, "rewrite.md");

  const memoryPathArg = readArg("--memory");
  const defaultMemoryPath = path.join(layout.learnDir, "memory");
  const memoryPath = memoryPathArg?.trim() ? memoryPathArg.trim() : defaultMemoryPath;
  const instruction = readArg("--instruction");

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.HISTWRITE_WRITE_MODEL ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  const endpointRaw = (readArg("--endpoint") ?? "auto").trim().toLowerCase();
  const endpoint = endpointRaw === "chat" || endpointRaw === "responses" ? endpointRaw : "auto";
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;
  const maxTokens = readNumberArg("--maxTokens") ?? null;
  const temperature = readFloatArg("--temperature") ?? 0.2;
  const noCache = hasFlag("--no-cache");

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "rewrite requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "rewrite requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "rewrite requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `rewrite requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (!model) throw new Error("rewrite requires --model (or opencode model ref / env HISTWRITE_WRITE_MODEL/OPENAI_MODEL)");

  await logger.write("rewrite_begin", { inPath: path.resolve(inPath), outPath: path.resolve(outPath), model, endpoint });
  const res = await rewriteMarkdownFile({
    layout,
    inPath,
    outPath,
    memoryPath,
    instruction,
    noCache,
    client: {
      apiBaseUrl,
      apiKey,
      model,
      endpoint,
      timeoutMs,
      temperature,
      ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    },
  });
  await logger.write("rewrite_done", { outPath: res.outPath, cacheHit: res.cacheHit, endpoint: res.endpoint });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      outPath: res.outPath,
      cacheHit: res.cacheHit,
      endpoint: res.endpoint,
      model: res.model,
      inputChars: res.inputChars,
      outputChars: res.outputChars,
      runLog: logger.path,
    }),
  );
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "episodes") {
  const sub = args[1] ?? "";
  if (sub !== "append") usage(2);

  const projectDir = readArg("--project") ?? process.cwd();
  const layout = await ensureHistwriteProject(projectDir);
  const logger = await createRunLogger({ logsDir: layout.logsDir });
  await logger.write("command_start", { cmd: "episodes append", projectDir: layout.projectDir });

  const filePath = readArg("--file");
  const raw = filePath ? await fs.readFile(filePath, "utf8") : await readStdinUtf8();
  let episode: unknown;
  try {
    episode = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid episode json: ${String(err)}`);
  }
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    throw new Error("invalid episode json: expected object");
  }

  const store = await createEpisodesStore({ layout });
  await store.append(episode);
  await logger.write("episodes_append_done", { episodesPath: store.episodesPath });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, episodesPath: store.episodesPath, runLog: logger.path }));
  await logger.write("command_end", { ok: true });
  process.exit(0);
}

if (cmd === "proxy") {
  await loadDotEnvFromDir({ dir: process.cwd() });
  const listenHost = (readArg("--listen") ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = readNumberArg("--port") ?? 18795;
  const forceModel = hasFlag("--forceModel");
  const timeoutMs = readNumberArg("--timeoutMs") ?? readNumberEnv("HISTWRITE_TIMEOUT_MS") ?? 60_000;

  const useOpencode =
    hasFlag("--opencode") ||
    Boolean(readArg("--opencodeConfig")) ||
    Boolean(readArg("--opencodeModel")) ||
    Boolean(readArg("--opencodeProvider"));

  const apiKeyEnv = (readArg("--apiKeyEnv") ?? "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  const modelArg = (readArg("--model") ?? process.env.OPENAI_MODEL ?? "").trim();
  const apiBaseUrlArg =
    (readArg("--apiBaseUrl") ??
      process.env.OPENAI_BASE_URL ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_API_BASE_URL ??
      "").trim();

  let apiBaseUrl = apiBaseUrlArg;
  let apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  let model = modelArg;

  if (useOpencode) {
    const opencodeConfig = readArg("--opencodeConfig") ?? defaultOpencodeConfigPath();
    const opencodeModel = readArg("--opencodeModel");
    const opencodeProvider = readArg("--opencodeProvider");
    const resolved = await resolveOpenAiCompatFromOpencode({
      configPath: opencodeConfig,
      modelRef: opencodeModel,
      providerName: opencodeProvider,
      modelOverride: model || null,
    });
    apiBaseUrl = resolved.apiBaseUrl;
    apiKey = resolved.apiKey;
    model = resolved.model;
  }

  if (!apiBaseUrl.trim()) {
    throw new Error(
      useOpencode
        ? "proxy requires opencode provider.options.baseURL (or pass --apiBaseUrl)"
        : "proxy requires --apiBaseUrl (or env OPENAI_BASE_URL/OPENAI_API_BASE)",
    );
  }
  if (!apiKey) {
    throw new Error(
      useOpencode
        ? "proxy requires opencode provider.options.apiKey (or set --apiKeyEnv env var)"
        : `proxy requires env ${apiKeyEnv} (API key not found)`,
    );
  }
  if (forceModel && !model) {
    throw new Error("proxy requires --model when --forceModel is set");
  }

  const cacheDir = readArg("--cacheDir") ?? "";
  const maxConcurrency = readNumberArg("--maxConcurrency");
  const maxRetries = readNumberArg("--maxRetries");
  const backoffBaseMs = readNumberArg("--backoffBaseMs");
  const backoffMaxMs = readNumberArg("--backoffMaxMs");

  const { server, url } = await startOpenAiCompatProxy({
    listenHost,
    port,
    upstreamBaseUrl: apiBaseUrl,
    upstreamApiKey: apiKey,
    defaultModel: model || undefined,
    forceModel,
    timeoutMs,
    ...(cacheDir.trim() ? { cacheDir: cacheDir.trim() } : {}),
    ...(maxConcurrency != null || maxRetries != null || backoffBaseMs != null || backoffMaxMs != null
      ? {
          scheduler: {
            ...(maxConcurrency != null ? { maxConcurrency } : {}),
            ...(maxRetries != null ? { maxRetries } : {}),
            ...(backoffBaseMs != null ? { baseDelayMs: backoffBaseMs } : {}),
            ...(backoffMaxMs != null ? { maxDelayMs: backoffMaxMs } : {}),
          },
        }
      : {}),
  });

  const shutdown = () => {
    try {
      server.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      url,
      listenHost,
      port: (server.address() as any)?.port ?? port,
      forceModel,
      defaultModel: model || null,
      upstreamBaseUrl: apiBaseUrl,
    }),
  );
  // Keep running until signal.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  await new Promise<void>(() => {});
}

usage(2);
