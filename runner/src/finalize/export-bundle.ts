import fs from "node:fs/promises";
import path from "node:path";

import { readArtifactHeads } from "../artifacts/heads.js";
import type { HistwriteProjectLayout } from "../project.js";

export type ExportBundleResult = {
  outDir: string;
  files: {
    finalMarkdown: string;
    factcheck: string;
    chronology: string;
    finalcheck: string;
    runlog: string;
    artifactHeads: string;
    artifactsDir?: string;
  };
};

function safeStem(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "final"
  );
}

async function copyFileIntoBundle(fromPath: string, toPath: string): Promise<string> {
  const fromAbs = path.resolve(fromPath);
  const toAbs = path.resolve(toPath);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.copyFile(fromAbs, toAbs);
  return toAbs;
}

export async function exportFinalizeBundle(params: {
  layout: HistwriteProjectLayout;
  finalMarkdownPath: string;
  factcheckReportPath: string;
  chronologyReportPath: string;
  finalcheckReportPath: string;
  runLogPath: string;
  artifactPaths?: {
    materialsPath?: string | null;
    cardsPath?: string | null;
    packPath?: string | null;
    qaPath?: string | null;
    claimsPath?: string | null;
  } | null;
  outDir?: string | null;
}): Promise<ExportBundleResult> {
  const stem = safeStem(path.parse(params.finalMarkdownPath).name);
  const outDir = path.resolve(params.outDir ?? path.join(params.layout.exportDir, "finalize", `${stem}-bundle`));

  const finalMarkdown = await copyFileIntoBundle(params.finalMarkdownPath, path.join(outDir, "Final.md"));
  const factcheck = await copyFileIntoBundle(params.factcheckReportPath, path.join(outDir, "reports", "factcheck.json"));
  const chronology = await copyFileIntoBundle(params.chronologyReportPath, path.join(outDir, "reports", "chronology.json"));
  const finalcheck = await copyFileIntoBundle(params.finalcheckReportPath, path.join(outDir, "reports", "finalcheck.md"));
  const runlog = await copyFileIntoBundle(params.runLogPath, path.join(outDir, "runlog.jsonl"));

  const artifactHeads = path.join(outDir, "artifact-heads.json");
  const heads = await readArtifactHeads(params.layout);
  await fs.mkdir(path.dirname(artifactHeads), { recursive: true });
  await fs.writeFile(artifactHeads, `${JSON.stringify(heads, null, 2)}\n`, "utf8");

  let artifactsDir: string | undefined;
  const artifactEntries = [
    params.artifactPaths?.materialsPath ? { from: params.artifactPaths.materialsPath, name: "materials.v2.json" } : null,
    params.artifactPaths?.cardsPath ? { from: params.artifactPaths.cardsPath, name: "cards.v2.json" } : null,
    params.artifactPaths?.packPath ? { from: params.artifactPaths.packPath, name: path.basename(params.artifactPaths.packPath) } : null,
    params.artifactPaths?.qaPath ? { from: params.artifactPaths.qaPath, name: path.basename(params.artifactPaths.qaPath) } : null,
    params.artifactPaths?.claimsPath ? { from: params.artifactPaths.claimsPath, name: path.basename(params.artifactPaths.claimsPath) } : null,
  ].filter((entry): entry is { from: string; name: string } => Boolean(entry));

  if (artifactEntries.length > 0) {
    artifactsDir = path.join(outDir, "artifacts");
    await Promise.all(
      artifactEntries.map((entry) => copyFileIntoBundle(entry.from, path.join(artifactsDir!, entry.name))),
    );
  }

  return {
    outDir,
    files: {
      finalMarkdown,
      factcheck,
      chronology,
      finalcheck,
      runlog,
      artifactHeads,
      ...(artifactsDir ? { artifactsDir } : {}),
    },
  };
}
