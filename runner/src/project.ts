import fs from "node:fs/promises";
import path from "node:path";

export type HistwriteProjectLayout = {
  projectDir: string;
  materialsDir: string;
  materialsDownloadsDir: string;
  materialsOcrDir: string;
  materialsIndexDir: string;
  blueprintDir: string;
  outlineDir: string;
  draftDir: string;
  exportDir: string;
  metaDir: string;
  artifactsDir: string;
  cacheDir: string;
  logsDir: string;
  learnDir: string;
  episodesDir: string;
  judgesDir: string;
};

export function resolveHistwriteLayout(projectDir: string): HistwriteProjectLayout {
  const root = path.resolve(projectDir);
  const materialsDir = path.join(root, "材料");
  const metaDir = path.join(root, ".histwrite");
  const artifactsDir = path.join(metaDir, "artifacts");
  const learnDir = path.join(metaDir, "learn");
  const judgesDir = path.join(learnDir, "judges");
  return {
    projectDir: root,
    materialsDir,
    materialsDownloadsDir: path.join(materialsDir, "_downloads"),
    materialsOcrDir: path.join(materialsDir, "_ocr"),
    materialsIndexDir: path.join(materialsDir, "_index"),
    blueprintDir: path.join(root, "蓝图"),
    outlineDir: path.join(root, "大纲"),
    draftDir: path.join(root, "正文"),
    exportDir: path.join(root, "导出"),
    metaDir,
    artifactsDir,
    cacheDir: path.join(metaDir, "cache"),
    logsDir: path.join(metaDir, "logs"),
    learnDir,
    episodesDir: path.join(learnDir, "episodes"),
    judgesDir,
  };
}

export async function ensureHistwriteProject(projectDir: string): Promise<HistwriteProjectLayout> {
  const layout = resolveHistwriteLayout(projectDir);
  const dirs = [
    layout.materialsDir,
    layout.materialsDownloadsDir,
    layout.materialsOcrDir,
    layout.materialsIndexDir,
    layout.blueprintDir,
    layout.outlineDir,
    layout.draftDir,
    layout.exportDir,
    layout.metaDir,
    layout.artifactsDir,
    layout.cacheDir,
    layout.logsDir,
    layout.learnDir,
    layout.episodesDir,
    layout.judgesDir,
  ];
  await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
  return layout;
}
