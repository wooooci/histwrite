import fs from "node:fs/promises";
import path from "node:path";

import { ensureHistwriteProject, resolveHistwriteLayout } from "./project.js";
import { indexMaterials, writeLibraryIndexMarkdown } from "./indexing.js";
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

function usage(exitCode = 0) {
  const msg = [
    "Usage:",
    "  histwrite init --project <dir>",
    "  histwrite project init|status|export --project <dir>",
    "  histwrite index --project <dir> [--materials <dir>]",
    "  histwrite library index|status --project <dir> [--materials <dir>]",
    "  histwrite capture --project <dir> [--relay <url>] [--targetId <id>] [--no-png] [--no-text] [--maxChars <n>] [--outDir <dir>]",
    "  histwrite relay status [--relay <url>]",
    "  histwrite export --project <dir> [--draft <dir>] [--out <path>] [--title <text>]",
    "  histwrite finalcheck --project <dir> --file <path>",
    "  histwrite rewrite --project <dir> --in <path> [--out <path>] [--memory <path>] [--instruction <text>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--temperature <n>] [--no-cache]",
    "  histwrite judge --project <dir> --candidatesDir <dir> [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--rubric <path>] [--sectionId <id>] [--sectionTitle <title>] [--minPassScore <n>] [--endpoint auto|chat|responses] [--timeoutMs <n>] [--maxTokens <n>] [--no-cache]",
    "  histwrite proxy [--listen <host>] [--port <n>] [--model <id>] [--apiBaseUrl <url>] [--apiKeyEnv <env>] [--opencode] [--opencodeConfig <path>] [--opencodeModel <provider/model>] [--opencodeProvider <provider>] [--forceModel] [--timeoutMs <n>] [--cacheDir <dir>]",
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

if (cmd === "relay") {
  const relayBaseUrl = readArg("--relay") ?? "http://127.0.0.1:18792";
  if (sub === "status") await runRelayStatus(relayBaseUrl);
  usage(2);
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

  const relayBaseUrl = readArg("--relay") ?? "http://127.0.0.1:18792";
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

  const { server, url } = await startOpenAiCompatProxy({
    listenHost,
    port,
    upstreamBaseUrl: apiBaseUrl,
    upstreamApiKey: apiKey,
    defaultModel: model || undefined,
    forceModel,
    timeoutMs,
    ...(cacheDir.trim() ? { cacheDir: cacheDir.trim() } : {}),
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
