import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import JSZip from "jszip";

import type { HistwriteProjectLayout } from "./project.js";

const execFileAsync = promisify(execFile);

export type MaterialKind = "txt" | "md" | "docx" | "pdf" | "other";

export type MaterialIndexEntry = {
  id: string;
  kind: MaterialKind;
  title: string;
  sourcePath: string; // project-relative when possible
  sourceSha256: string;
  textPath: string | null; // project-relative when possible
  textSha256: string | null;
};

export type LibraryIndex = {
  version: 1;
  materials: MaterialIndexEntry[];
};

function sha256HexBytes(bytes: Uint8Array): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}

function titleFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.[^.]+$/, "");
}

function kindFromPath(filePath: string): MaterialKind {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".txt") return "txt";
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".docx") return "docx";
  if (ext === ".pdf") return "pdf";
  return "other";
}

function shouldSkipPath(filePath: string, materialsDir: string): boolean {
  const rel = path.relative(materialsDir, filePath);
  if (!rel || rel.startsWith("..")) return true;
  const parts = rel.split(path.sep);
  // Skip our own internal folders.
  return parts.some((p) => p === "_index" || p === "_downloads" || p === "_ocr" || p.startsWith("."));
}

async function listFilesRg(materialsDir: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("rg", ["--files", "--hidden", materialsDir], {
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p));
  } catch {
    return null;
  }
}

async function listFilesWalk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function decodeXmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCodePoint(Number.parseInt(String(n), 16)));
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file("word/document.xml");
  const xml = doc ? await doc.async("string") : "";
  if (!xml) return "";
  const paras = xml.split("</w:p>");
  const out: string[] = [];
  for (const p of paras) {
    const chunks = Array.from(p.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)).map((m) =>
      decodeXmlEntities(String(m[1] ?? "")),
    );
    const line = chunks.join("");
    if (line.trim() !== "") out.push(line);
  }
  return out.join("\n").trim();
}

function toProjectPath(layout: HistwriteProjectLayout, absPath: string): string {
  const rel = path.relative(layout.projectDir, absPath);
  if (!rel || rel.startsWith("..")) return absPath;
  return rel;
}

export async function indexMaterials(params: {
  layout: HistwriteProjectLayout;
  materialsDir: string;
}): Promise<LibraryIndex> {
  const materialsDir = path.resolve(params.materialsDir);
  const indexRoot = params.layout.materialsIndexDir;
  const textRoot = path.join(indexRoot, "text");
  await fs.mkdir(textRoot, { recursive: true });

  const listed = (await listFilesRg(materialsDir)) ?? (await listFilesWalk(materialsDir));
  const files = listed
    .filter((p) => !shouldSkipPath(p, materialsDir))
    .sort((a, b) => a.localeCompare(b));

  const entries: MaterialIndexEntry[] = [];

  for (const filePath of files) {
    const kind = kindFromPath(filePath);
    if (kind === "other") continue;

    const bytes = await fs.readFile(filePath);
    const sourceSha256 = sha256HexBytes(bytes);
    const id = `m_${sourceSha256.slice(0, 12)}`;
    const title = titleFromPath(filePath);

    let text: string | null = null;
    if (kind === "txt" || kind === "md") {
      text = bytes.toString("utf8");
    } else if (kind === "docx") {
      text = await extractDocxText(bytes);
    } else if (kind === "pdf") {
      text = null;
    }

    let textPath: string | null = null;
    let textSha256: string | null = null;
    if (typeof text === "string") {
      textSha256 = sha256HexBytes(Buffer.from(text, "utf8"));
      const absTextPath = path.join(textRoot, `${id}.txt`);
      await fs.writeFile(absTextPath, `${text}\n`, "utf8");
      textPath = toProjectPath(params.layout, absTextPath);
    }

    entries.push({
      id,
      kind,
      title,
      sourcePath: toProjectPath(params.layout, filePath),
      sourceSha256,
      textPath,
      textSha256,
    });
  }

  const library: LibraryIndex = { version: 1, materials: entries };
  const libraryPath = path.join(indexRoot, "library.json");
  await fs.writeFile(libraryPath, `${JSON.stringify(library, null, 2)}\n`, "utf8");
  return library;
}

export async function writeLibraryIndexMarkdown(params: {
  layout: HistwriteProjectLayout;
  library: LibraryIndex;
}): Promise<string> {
  const byKind = params.library.materials.reduce<Record<string, number>>((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1;
    return acc;
  }, {});
  const total = params.library.materials.length;
  const lines: string[] = [];
  lines.push("# 材料索引");
  lines.push("");
  lines.push(`- 总数：${total}`);
  lines.push(`- 分类：${Object.entries(byKind)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}`);
  lines.push("");
  lines.push("## 检索建议");
  lines.push("");
  lines.push("- 全文检索（推荐）：");
  lines.push("  - `rg -n \"关键词\" 材料/_index/text`");
  lines.push("- 只看某条材料（按 id）：");
  lines.push("  - `ls 材料/_index/text/m_*.txt`");
  lines.push("");
  lines.push("## 清单");
  lines.push("");
  for (const m of params.library.materials) {
    const src = m.sourcePath;
    const txt = m.textPath ?? "(未抽取文本)";
    lines.push(`- ${m.id} (${m.kind}) ${m.title}`);
    lines.push(`  - source: ${src}`);
    lines.push(`  - text: ${txt}`);
  }
  const outPath = path.join(params.layout.blueprintDir, "library_index.md");
  const content = `${lines.join("\n")}\n`;
  await fs.writeFile(outPath, content, "utf8");
  return outPath;
}
