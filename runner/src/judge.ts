import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "./cache.js";
import type { HistwriteProjectLayout } from "./project.js";
import { createEpisodesStore } from "./episodes.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText, parseJsonFromText } from "./openai-compat.js";

export type JudgeDims = {
  evidence?: number;
  macro?: number;
  clarity?: number;
  style?: number;
  coherence?: number;
};

export type JudgeRank = {
  id: string;
  score: number;
  pass: boolean;
  reason: string;
  dims?: JudgeDims;
};

export type JudgeBestOfKResult = {
  chosenId: string;
  ranked: JudgeRank[];
  chosen?: {
    sectionSummary?: string;
    docSummary?: string;
    gaps?: string[];
  };
};

export type JudgeRunOutput = {
  runId: string;
  judgePath: string;
  episodesPath: string;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  result: JudgeBestOfKResult;
};

type CandidateRec = {
  id: string;
  absPath: string;
  relPath: string;
  text: string;
  sha256: string;
  chars: number;
};

function clampFloat(v: unknown, fallback: number, opts: { min: number; max: number }): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  if (n < opts.min) return opts.min;
  if (n > opts.max) return opts.max;
  return n;
}

function toPosix(p: string): string {
  return p.replaceAll(path.sep, "/");
}

function toProjectRel(layout: HistwriteProjectLayout, absPath: string): string {
  const rel = path.relative(layout.projectDir, absPath);
  if (!rel || rel.startsWith("..")) return absPath;
  return toPosix(rel);
}

function extractRubricBody(markdown: string): string {
  const lines = markdown.split("\n");
  const idx = lines.findIndex((l) => l.trim() === "## Rubric 正文");
  if (idx === -1) return markdown.trim();
  let start = idx + 1;
  while (start < lines.length && lines[start]!.trim() === "") start += 1;
  return lines.slice(start).join("\n").trim();
}

function defaultRubric(): string {
  // Keep this aligned with extensions/histwrite/src/histwrite-tool.ts defaultHistwriteEvalRubric().
  return [
    "你是历史学论文写作评审（LLM-as-a-judge）。请只用中文输出 reason，并严格按 JSON 结构返回：",
    '{"reason":"...","score":0.0,"pass":false}',
    "",
    "评审对象是一个 JSON 字符串输出。你必须先解析它：",
    "- 若不是合法 JSON，或缺少 reply 字段：score=0，pass=false。",
    "- 只评估 reply 文本（忽略其他字段）。",
    "",
    "硬性否决（命中任意一条：pass=false 且 score≤0.2）：",
    "- 编造可核查引用：书名/作者/页码/原文引文/档案号/卷期/DOI 等（除非这些信息明确来自材料）。",
    "- 出现免责声明或模型自述：例如“作为 AI/我无法/我不能访问”等。",
    "- 把可核查事实写成确定结论但没有任何材料支撑，且不标注【缺口】（例如具体人名/日期/机构/文件名/统计数字等凭空出现）。",
    "",
    "评分维度（0.0~1.0，越高越好；score 反映综合质量）：",
    "1) 史论结合：是否以材料为证据支撑论点，避免空泛泛论；能把“史实/材料”与“解释/论证”扣合起来（优先用【m1】标注材料 id）。",
    "2) 大局意识：是否有宏观框架/因果链条/时代背景回扣，而非只堆细节。",
    "3) 意图清晰：是否围绕核心问题组织段落，论点明确，层次清楚。",
    "4) 竞争解释：是否至少指出一种可竞争的解释路径，并说明为何本解释更有说服力/或需要补证。",
    "5) 去 AI 感：避免模板腔（“首先其次”“综上所述”机械堆叠）、避免免责声明（“作为 AI…”）。重点检查句式多样性：不要反复用固定连接词/固定句型（如“并非…而是…”“当…时，就…”“越…就越…”“……，却……”等），避免单字连词（如“而”）密集重复，避免被动句模板（“X 被 Y …”）过密，避免“概括+冒号+分句解释块”反复出现导致块状堆叠；段落要线性推进、转场自然。",
    "6) 证据纪律：不得编造书名/作者/页码/原文引文；材料不足时要用【缺口】标注需要补什么证据。",
    "7) 归因与可核查性：对“学界观点/争论/共识”是否做了归因；推断是否显式标注；是否避免跳跃式合成。",
    "8) 连贯性：段落推进是否顺滑；是否有自然转场；是否避免重复与自相矛盾。",
    "",
    "给出一个整体 score，并设置 pass：当且仅当整体质量达到“可作为论文草稿段落继续扩写”的水平才 pass=true。",
  ].join("\n");
}

async function loadRubric(rubricPath: string | null): Promise<{ text: string; source: string | null; sha256: string }> {
  if (rubricPath && rubricPath.trim()) {
    const abs = path.resolve(rubricPath);
    const raw = await fs.readFile(abs, "utf8");
    const text = extractRubricBody(raw);
    return { text, source: abs, sha256: sha256Hex(text) };
  }

  try {
    const defaultPath = fileURLToPath(new URL("../../histwrite/templates/eval-rubric.zh.md", import.meta.url));
    const raw = await fs.readFile(defaultPath, "utf8");
    const text = extractRubricBody(raw);
    return { text, source: defaultPath, sha256: sha256Hex(text) };
  } catch {
    const text = defaultRubric();
    return { text, source: null, sha256: sha256Hex(text) };
  }
}

async function loadCandidatesFromDir(params: {
  layout: HistwriteProjectLayout;
  candidatesDir: string;
  maxCandidateChars: number;
}): Promise<CandidateRec[]> {
  const dir = path.resolve(params.candidatesDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, "en"));

  const out: CandidateRec[] = [];
  for (const absPath of files) {
    const id = path.basename(absPath).replace(/\.[^.]+$/, "").trim();
    if (!id) continue;
    const raw = await fs.readFile(absPath, "utf8");
    const text = raw.length > params.maxCandidateChars ? `${raw.slice(0, params.maxCandidateChars)}\n…(truncated)` : raw;
    const sha = sha256Hex(Buffer.from(raw, "utf8"));
    out.push({
      id,
      absPath,
      relPath: toProjectRel(params.layout, absPath),
      text,
      sha256: sha,
      chars: raw.length,
    });
  }
  return out;
}

function normalizeRanked(params: {
  candidateIds: Set<string>;
  rankedRaw: unknown;
  minPassScore: number;
}): JudgeRank[] {
  const ranked: JudgeRank[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(params.rankedRaw) ? params.rankedRaw : [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const id = typeof (r as any).id === "string" ? (r as any).id.trim() : "";
    if (!id || !params.candidateIds.has(id) || seen.has(id)) continue;
    const score = clampFloat((r as any).score, 0, { min: 0, max: 1 });
    const pass = typeof (r as any).pass === "boolean" ? (r as any).pass : score >= params.minPassScore;
    const reason = typeof (r as any).reason === "string" ? String((r as any).reason).trim() : "";
    const dimsRaw = (r as any).dims;
    const dims =
      dimsRaw && typeof dimsRaw === "object"
        ? {
            evidence: clampFloat((dimsRaw as any).evidence, 0, { min: 0, max: 1 }),
            macro: clampFloat((dimsRaw as any).macro, 0, { min: 0, max: 1 }),
            clarity: clampFloat((dimsRaw as any).clarity, 0, { min: 0, max: 1 }),
            style: clampFloat((dimsRaw as any).style, 0, { min: 0, max: 1 }),
            coherence: clampFloat((dimsRaw as any).coherence, 0, { min: 0, max: 1 }),
          }
        : undefined;
    ranked.push({
      id,
      score,
      pass: score < params.minPassScore ? false : pass,
      reason,
      ...(dims ? { dims } : {}),
    });
    seen.add(id);
  }

  // Fill missing candidates with a failing score.
  for (const id of params.candidateIds) {
    if (seen.has(id)) continue;
    ranked.push({ id, score: 0, pass: false, reason: "缺少评分（judge 未返回该候选）" });
    seen.add(id);
  }

  ranked.sort((a, b) => (b.score || 0) - (a.score || 0));
  return ranked;
}

export async function runBestOfKJudge(params: {
  layout: HistwriteProjectLayout;
  sectionId: string;
  sectionTitle: string;
  candidatesDir: string;
  rubricPath?: string | null;
  minPassScore?: number;
  maxCandidateChars?: number;
  outPath?: string | null;
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
}): Promise<JudgeRunOutput> {
  const sectionId = params.sectionId.trim() || "section";
  const sectionTitle = params.sectionTitle.trim() || sectionId;
  const minPassScore = clampFloat(params.minPassScore ?? 0.6, 0.6, { min: 0, max: 1 });
  const maxCandidateChars = Math.max(200, Math.min(200_000, params.maxCandidateChars ?? 30_000));

  const candidates = await loadCandidatesFromDir({
    layout: params.layout,
    candidatesDir: params.candidatesDir,
    maxCandidateChars,
  });
  if (!candidates.length) throw new Error(`no candidates found in ${path.resolve(params.candidatesDir)}`);

  const { text: rubricText, source: rubricSource, sha256: rubricSha } = await loadRubric(params.rubricPath ?? null);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const promptVersion = "judge_best_of_k_v1";
  const apiBaseUrlNormalized = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const key = cacheKey({
    model: params.client.model,
    promptVersion,
    inputs: {
      apiBaseUrl: apiBaseUrlNormalized,
      sectionId,
      sectionTitle,
      minPassScore,
      rubricSha,
      candidates: candidates.map((c) => ({ id: c.id, sha256: c.sha256 })).sort((a, b) => a.id.localeCompare(b.id)),
    },
  });

  const judgeCache = await createCasCache(path.join(params.layout.cacheDir, "judge"));
  const cached = params.noCache ? null : await judgeCache.getJson<{ endpoint: "chat" | "responses"; result: JudgeBestOfKResult }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "chat";
  let result: JudgeBestOfKResult | null = null;
  let judgeError: string | null = null;

  if (cached && cached.result && typeof cached.result === "object") {
    cacheHit = true;
    endpoint = cached.endpoint;
    result = cached.result;
  } else {
    const judgeSystem = "你是 Histwrite 的 judge（奖励函数）。";
    const judgeInstruction = [
      "任务：对多个候选正文打分并选优。",
      "",
      "评分标准在 RUBRIC（注意：RUBRIC 里包含单样本的输出格式说明，请忽略；你必须按本任务要求的 JSON 输出）。",
      "",
      "对每个候选：按 RUBRIC 评估其 reply（可视为评估 {\"reply\": candidate.reply}）。",
      "- score: 0.0~1.0（综合分）",
      `- 当 score < ${minPassScore.toFixed(2)} 时，pass 必须为 false`,
      "- reason: 中文、尽量短（<=80字），点出主要优缺点与违规点",
      "- 严禁编造引用：若出现材料之外的书名/作者/页码/档案号/原文引文等可核查信息，必须重罚并 pass=false",
      "",
      "选择规则：优先从 pass=true 的候选中选 score 最高者；若全都不 pass，则选 score 最高者。",
      "",
      "输出 JSON（不得包含任何额外文本/代码块/解释）：",
      "- chosenId: string（必须匹配 candidates[].id）",
      "- ranked: {id,score,pass,reason,dims?}[]（必须覆盖所有 candidates；按 score 从高到低排序）",
      "- 可选：chosen {sectionSummary, gaps?}",
    ].join("\n");

    const input = {
      section: { id: sectionId, title: sectionTitle },
      candidates: candidates.map((c) => ({ id: c.id, reply: c.text })),
    };

    const prompt = `${judgeInstruction}\n\nRUBRIC:\n${rubricText}\n\nINPUT_JSON:\n${stableJsonStringify(input)}\n`;

    try {
      const resp = await openAiCompatGenerateText({
        client: {
          apiBaseUrl: params.client.apiBaseUrl,
          apiKey: params.client.apiKey,
          model: params.client.model,
          timeoutMs: params.client.timeoutMs,
          temperature: params.client.temperature ?? 0,
          maxTokens: params.client.maxTokens,
        },
        system: judgeSystem,
        prompt,
        endpoint: params.client.endpoint ?? "auto",
      });
      endpoint = resp.endpoint;

      const parsed = parseJsonFromText(resp.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("judge returned non-object json");
      }
      const chosenIdRaw = typeof (parsed as any).chosenId === "string" ? String((parsed as any).chosenId).trim() : "";
      const ranked = normalizeRanked({ candidateIds, rankedRaw: (parsed as any).ranked, minPassScore });
      const chosenId =
        chosenIdRaw && candidateIds.has(chosenIdRaw) ? chosenIdRaw : ranked.length ? ranked[0]!.id : candidates[0]!.id;
      const chosenRaw = (parsed as any).chosen;
      const chosen =
        chosenRaw && typeof chosenRaw === "object"
          ? {
              ...(typeof (chosenRaw as any).sectionSummary === "string"
                ? { sectionSummary: String((chosenRaw as any).sectionSummary).trim() }
                : {}),
              ...(Array.isArray((chosenRaw as any).gaps)
                ? { gaps: (chosenRaw as any).gaps.map((g: any) => String(g).trim()).filter(Boolean) }
                : {}),
            }
          : undefined;

      result = { chosenId, ranked, ...(chosen ? { chosen } : {}) };
      if (!params.noCache) {
        await judgeCache.putJson(key, { endpoint, result });
      }
    } catch (err) {
      judgeError = err instanceof Error ? err.message : String(err);
      const fallbackId = candidates[0]!.id;
      result = {
        chosenId: fallbackId,
        ranked: candidates.map((c, idx) => ({
          id: c.id,
          score: idx === 0 ? 0.1 : 0,
          pass: false,
          reason: "judge 失败，使用 fallback",
        })),
      };
    }
  }

  const runId = randomUUID();
  const judgePath = params.outPath?.trim()
    ? path.resolve(params.outPath)
    : path.join(params.layout.judgesDir, `${runId}.json`);

  const judgeRecord = {
    version: 1,
    kind: "judge_best_of_k",
    at: Date.now(),
    section: { id: sectionId, title: sectionTitle },
    k: candidates.length,
    promptVersion,
    cacheHit,
    ...(judgeError ? { judgeError } : {}),
    judge: {
      apiBaseUrl: params.client.apiBaseUrl,
      model: params.client.model,
      endpoint,
      temperature: params.client.temperature ?? 0,
      ...(typeof params.client.maxTokens === "number" ? { maxTokens: params.client.maxTokens } : {}),
      timeoutMs: params.client.timeoutMs ?? 60_000,
      minPassScore,
    },
    rubric: { sha256: rubricSha, ...(rubricSource ? { source: rubricSource } : {}) },
    candidates: candidates.map((c) => ({ id: c.id, path: c.relPath, sha256: c.sha256, chars: c.chars })),
    result,
  };

  await fs.mkdir(path.dirname(judgePath), { recursive: true });
  await fs.writeFile(judgePath, `${JSON.stringify(judgeRecord, null, 2)}\n`, "utf8");

  const episodes = await createEpisodesStore({ layout: params.layout });
  const episode = {
    version: 1,
    kind: "judge_best_of_k",
    at: Date.now(),
    section: { id: sectionId, title: sectionTitle },
    k: candidates.length,
    cacheHit,
    ...(judgeError ? { judgeError } : {}),
    judgePath: toProjectRel(params.layout, judgePath),
    judge: { apiBaseUrl: params.client.apiBaseUrl, model: params.client.model, endpoint, minPassScore },
    candidates: candidates.map((c) => ({ id: c.id, path: c.relPath, sha256: c.sha256 })),
    ranked: result!.ranked,
    chosenId: result!.chosenId,
  };
  await episodes.append(episode);

  return {
    runId,
    judgePath,
    episodesPath: episodes.episodesPath,
    cacheHit,
    endpoint,
    result: result!,
  };
}
