import fs from "node:fs/promises";
import path from "node:path";

import type { HistwriteProjectLayout } from "./project.js";

export type ExportDraftResult = {
  outPath: string;
  inputFiles: Array<{ path: string; bytes: number }>;
};

function toPosixPath(p: string): string {
  return p.replaceAll(path.sep, "/");
}

export async function exportDraftMarkdown(params: {
  layout: HistwriteProjectLayout;
  draftDir?: string;
  outPath?: string;
  title?: string;
}): Promise<ExportDraftResult> {
  const draftDir = path.resolve(params.draftDir ?? params.layout.draftDir);
  const outPath = path.resolve(params.outPath ?? path.join(params.layout.exportDir, "draft.md"));

  const entries = await fs.readdir(draftDir, { withFileTypes: true }).catch((err: unknown) => {
    if (typeof err === "object" && err && "code" in err && (err as { code?: unknown }).code === "ENOENT") {
      return [];
    }
    throw err;
  });

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => path.join(draftDir, e.name))
    .sort((a, b) => a.localeCompare(b, "en"));

  const parts: string[] = [];
  const title = params.title?.trim();
  if (title) {
    parts.push(`# ${title}`);
    parts.push("");
  }

  const inputFiles: Array<{ path: string; bytes: number }> = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const rel = toPosixPath(path.relative(params.layout.projectDir, filePath));
    parts.push(`<!-- file: ${rel} -->`);
    parts.push("");
    parts.push(raw.trimEnd());
    parts.push("");
    parts.push("---");
    parts.push("");
    inputFiles.push({ path: filePath, bytes: Buffer.byteLength(raw, "utf8") });
  }

  const content = `${parts.join("\n")}\n`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, content, "utf8");
  return { outPath, inputFiles };
}

