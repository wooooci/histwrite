import fs from "node:fs/promises";
import path from "node:path";

import { cacheKey, createCasCache, sha256Hex } from "./cache.js";
import type { HistwriteProjectLayout } from "./project.js";
import { normalizeOpenAiCompatBaseUrl, openAiCompatGenerateText } from "./openai-compat.js";

async function readTextIfExists(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  try {
    return await fs.readFile(abs, "utf8");
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && (err as any).code === "ENOENT") return "";
    throw err;
  }
}

async function readMemoryFromDir(dirPath: string): Promise<string> {
  const dirAbs = path.resolve(dirPath);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dirAbs);
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && (err as any).code === "ENOENT") return "";
    throw err;
  }

  const names = entries
    .map((n) => String(n))
    .filter((n) => n.toLowerCase().endsWith(".md"))
    .filter((n) => !n.startsWith("."))
    .filter((n) => n !== "README.md")
    .filter((n) => n.startsWith("histwrite-"))
    .filter((n) => !n.includes(".compact."))
    .sort((a, b) => a.localeCompare(b, "en"));

  const parts: string[] = [];
  for (const name of names) {
    const abs = path.join(dirAbs, name);
    const text = await readTextIfExists(abs);
    const trimmed = text.trim();
    if (!trimmed) continue;
    parts.push(`--- memory file: ${name} ---\n${trimmed}`);
  }
  return parts.join("\n\n").trim();
}

async function readMemoryFromPath(memoryPath: string): Promise<string> {
  const abs = path.resolve(memoryPath);
  try {
    const st = await fs.stat(abs);
    if (st.isDirectory()) return await readMemoryFromDir(abs);
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && (err as any).code === "ENOENT") return "";
    throw err;
  }
  return await readTextIfExists(abs);
}

function buildRewriteSystem(params: { memory: string }): string {
  const parts: string[] = [
    "你是历史学论文中文写作编辑（学术稿件级别）。",
    "",
    "硬规则：",
    "- 不新增任何可核查事实/数据/引文/页码/档案号/书目；若确需新证据，用【缺口】标注。",
    "- 保持学术论文的严肃性与论证密度，避免科普腔与口语化。",
    "- 连接词与句式模板要打散：降频、变形、变语序、变句长；避免同构句式在近距离重复。",
    "  注意：打散不等于碎句化。优先在句内完成改造（语序/主语/断句调整），允许保留紧凑复句；禁止把一个紧凑复句机械拆成三句短句来“过关”。",
    "- 非直接引文不得使用引号；避免生造概念与过度术语化（例如堆叠“XX性”“重构/嵌入/张力”等）。",
    "- 术语尽量中文化；避免英文夹杂（必要时括注一次即可）。",
    "- 学术史段落只能依赖二手研究（不要把一手史料写成学术史证据）。",
    "- 保留原文中的脚注/注释标记（如 [^1]），不要改编号，不新增编号。",
    "- 输出只包含重写后的正文（Markdown），不要输出解释、清单、自我评价或过程描述。",
  ];
  const memory = params.memory.trim();
  if (memory) {
    parts.push("");
    parts.push("长期记忆（必须遵守）：");
    parts.push(memory);
  }
  return parts.join("\n").trim();
}

function buildRewritePrompt(params: { input: string; instruction?: string | null }): string {
  const extra = params.instruction?.trim();
  return [
    "任务：对下列“输入全文”做一次全篇重写。",
    "目标：在不新增事实/引文的前提下，把行文改成更像人类历史学论文的线性论证；减少 AI 痕迹（句式同构、连接词堆叠、冒号解释块、并列名词串等）。",
    extra ? `额外要求：${extra}` : null,
    "",
    "输入全文（Markdown）：",
    "```markdown",
    params.input.trim(),
    "```",
    "",
    "请直接输出重写后的全文（Markdown）。",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export type RewriteMarkdownResult = {
  outPath: string;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
  inputChars: number;
  outputChars: number;
};

export async function rewriteMarkdownFile(params: {
  layout: HistwriteProjectLayout;
  inPath: string;
  outPath: string;
  memoryPath?: string | null;
  instruction?: string | null;
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
}): Promise<RewriteMarkdownResult> {
  const inAbs = path.resolve(params.inPath);
  const outAbs = path.resolve(params.outPath);

  const input = await fs.readFile(inAbs, "utf8");
  const memory = params.memoryPath ? await readMemoryFromPath(params.memoryPath) : "";
  const system = buildRewriteSystem({ memory });
  const prompt = buildRewritePrompt({ input, instruction: params.instruction ?? null });

  const promptVersion = "rewrite_markdown_v1";
  const apiBaseUrlNormalized = normalizeOpenAiCompatBaseUrl(params.client.apiBaseUrl);
  const key = cacheKey({
    model: params.client.model,
    promptVersion,
    inputs: {
      apiBaseUrl: apiBaseUrlNormalized,
      endpoint: params.client.endpoint ?? "auto",
      inSha256: sha256Hex(Buffer.from(input, "utf8")),
      memorySha256: memory ? sha256Hex(Buffer.from(memory, "utf8")) : "",
      instructionSha256: params.instruction ? sha256Hex(params.instruction) : "",
      systemSha256: sha256Hex(system),
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "rewrite"));
  const cached = params.noCache ? null : await cache.getJson<{ endpoint?: unknown; text?: unknown }>(key);

  let cacheHit = false;
  let endpoint: "chat" | "responses" = "responses";
  let outText = "";

  if (cached && typeof cached.text === "string") {
    cacheHit = true;
    outText = cached.text;
    endpoint = cached.endpoint === "chat" ? "chat" : "responses";
  } else {
    const generated = await openAiCompatGenerateText({
      client: {
        apiBaseUrl: params.client.apiBaseUrl,
        apiKey: params.client.apiKey,
        model: params.client.model,
        ...(typeof params.client.timeoutMs === "number" ? { timeoutMs: params.client.timeoutMs } : {}),
        ...(typeof params.client.temperature === "number" ? { temperature: params.client.temperature } : {}),
        ...(typeof params.client.maxTokens === "number" ? { maxTokens: params.client.maxTokens } : {}),
      },
      system,
      prompt,
      endpoint: params.client.endpoint ?? "auto",
    });
    outText = generated.text;
    endpoint = generated.endpoint;
    await cache.putJson(key, { v: 1, at: Date.now(), endpoint, text: outText });
  }

  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await fs.writeFile(outAbs, `${outText.trim()}\n`, "utf8");

  return {
    outPath: outAbs,
    cacheHit,
    endpoint,
    model: params.client.model,
    inputChars: input.length,
    outputChars: outText.length,
  };
}
