import fs from "node:fs/promises";
import path from "node:path";

import { cacheKey, createCasCache, sha256Hex, stableJsonStringify } from "../cache.js";
import { readEvidenceCardsDataset } from "../cards/migrate.js";
import { runBestOfKJudge } from "../judge.js";
import type { HistwriteProjectLayout } from "../project.js";
import type { MaterialQADatasetV1 } from "../qa/schema.js";
import type { ArtifactRef } from "../artifacts/heads.js";
import { buildSectionPacks, type BlueprintForSectionPacksV1, type PackRanker, type SectionBlueprintInputV1 } from "./packer.js";
import { buildSectionPacksV1Dataset } from "../artifacts/packs.js";
import type { SectionPackV1 } from "./schema.js";

type BlueprintFileV2 = {
  version: number;
  sections: SectionBlueprintInputV1[];
  constraints?: BlueprintForSectionPacksV1["constraints"];
};

export type PackBuildManifestV1 = {
  version: 1;
  createdAt: string;
  blueprintPath: string;
  cardsPath: string;
  qaPath?: string;
  packPaths: string[];
  sections: Array<{ sectionId: string; packId: string; path: string }>;
};

export type PackBuildCommandResult = {
  manifestPath: string;
  packPaths: string[];
  dataset: ReturnType<typeof buildSectionPacksV1Dataset>;
  manifest: PackBuildManifestV1;
  cacheHit: boolean;
};

export type PackJudgeConfig = {
  rubricPath?: string | null;
  minPassScore?: number;
  client: Parameters<typeof runBestOfKJudge>[0]["client"];
};

function safeStem(value: string): string {
  const normalized = value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "section";
}

function blueprintArtifactRef(blueprintPath: string, blueprint: BlueprintFileV2): ArtifactRef {
  const normalized = stableJsonStringify(blueprint);
  const sha256 = sha256Hex(normalized);
  return {
    artifactId: `sha256:${sha256}`,
    sha256,
    path: blueprintPath,
    builtAt: new Date().toISOString(),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

function judgeConfigCacheShape(judge: PackJudgeConfig | null | undefined): Record<string, unknown> | null {
  if (!judge) return null;
  return {
    apiBaseUrl: judge.client.apiBaseUrl,
    model: judge.client.model,
    endpoint: judge.client.endpoint ?? "auto",
    timeoutMs: judge.client.timeoutMs ?? 60_000,
    maxTokens: typeof judge.client.maxTokens === "number" ? judge.client.maxTokens : null,
    minPassScore: typeof judge.minPassScore === "number" ? judge.minPassScore : 0.6,
    rubricPath: judge.rubricPath ?? null,
  };
}

function judgeCandidateId(index: number): string {
  return `cand_${String(index + 1).padStart(4, "0")}`;
}

function buildJudgeRanker(params: {
  layout: HistwriteProjectLayout;
  judge: PackJudgeConfig;
}): PackRanker {
  return async ({ section, candidates }) => {
    const key = sha256Hex(
      stableJsonStringify({
        sectionId: section.sectionId,
        judge: judgeConfigCacheShape(params.judge),
        candidates: candidates.map((candidate) => ({
          cardId: candidate.cardId,
          baseScore: candidate.baseScore,
          markdownSha256: sha256Hex(candidate.markdown),
        })),
      }),
    );

    const candidatesDir = path.join(params.layout.cacheDir, "packs", "judge-candidates", key);
    await fs.mkdir(candidatesDir, { recursive: true });

    const idToCardId = new Map<string, string>();
    await Promise.all(
      candidates.map(async (candidate, index) => {
        const candidateId = judgeCandidateId(index);
        idToCardId.set(candidateId, candidate.cardId);
        await fs.writeFile(path.join(candidatesDir, `${candidateId}.md`), `${candidate.markdown.trim()}\n`, "utf8");
      }),
    );

    const judged = await runBestOfKJudge({
      layout: params.layout,
      sectionId: section.sectionId,
      sectionTitle: section.title,
      candidatesDir,
      rubricPath: params.judge.rubricPath ?? null,
      minPassScore: params.judge.minPassScore,
      outPath: path.join(params.layout.judgesDir, `pack.${safeStem(section.sectionId)}.${key.slice(0, 12)}.json`),
      client: params.judge.client,
    });

    const orderedCardIds: string[] = [];
    const seen = new Set<string>();
    for (const ranked of judged.result.ranked) {
      const cardId = idToCardId.get(ranked.id);
      if (!cardId || seen.has(cardId)) continue;
      orderedCardIds.push(cardId);
      seen.add(cardId);
    }
    for (const candidate of candidates) {
      if (seen.has(candidate.cardId)) continue;
      orderedCardIds.push(candidate.cardId);
      seen.add(candidate.cardId);
    }
    return orderedCardIds;
  };
}

async function writePackOutputs(params: {
  outDir: string;
  packs: SectionPackV1[];
  blueprintPath: string;
  cardsPath: string;
  qaPath?: string;
}): Promise<{ manifestPath: string; packPaths: string[]; manifest: PackBuildManifestV1 }> {
  await fs.mkdir(params.outDir, { recursive: true });

  const packPaths: string[] = [];
  const sections: PackBuildManifestV1["sections"] = [];
  for (const pack of params.packs) {
    const packPath = path.join(params.outDir, `section.${safeStem(pack.sectionId)}.pack.v1.json`);
    await fs.writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
    packPaths.push(packPath);
    sections.push({ sectionId: pack.sectionId, packId: pack.packId, path: packPath });
  }

  const manifest: PackBuildManifestV1 = {
    version: 1,
    createdAt: new Date().toISOString(),
    blueprintPath: params.blueprintPath,
    cardsPath: params.cardsPath,
    ...(params.qaPath ? { qaPath: params.qaPath } : {}),
    packPaths,
    sections,
  };

  const manifestPath = path.join(params.outDir, "packs.v1.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifestPath, packPaths, manifest };
}

export async function buildPackArtifacts(params: {
  layout: HistwriteProjectLayout;
  blueprintPath: string;
  cardsPath: string;
  materialsPath?: string | null;
  qaPath?: string | null;
  outDir?: string | null;
  noCache?: boolean;
  judge?: PackJudgeConfig | null;
}): Promise<PackBuildCommandResult> {
  const blueprintPath = path.resolve(params.blueprintPath);
  const cardsPath = path.resolve(params.cardsPath);
  const materialsPath = params.materialsPath
    ? path.resolve(params.materialsPath)
    : path.join(params.layout.materialsIndexDir, "materials.v2.json");
  const qaPath = params.qaPath ? path.resolve(params.qaPath) : undefined;
  const outDir = path.resolve(params.outDir ?? path.join(params.layout.artifactsDir, "packs"));

  const [blueprintFile, cards, qa] = await Promise.all([
    readJsonFile<BlueprintFileV2>(blueprintPath),
    readEvidenceCardsDataset({ cardsPath, materialsPath }),
    qaPath ? readJsonFile<MaterialQADatasetV1>(qaPath) : Promise.resolve(undefined),
  ]);

  const blueprint: BlueprintForSectionPacksV1 = {
    version: blueprintFile.version,
    blueprintRef: blueprintArtifactRef(blueprintPath, blueprintFile),
    sections: blueprintFile.sections,
    constraints: blueprintFile.constraints,
  };

  const key = cacheKey({
    taskName: "pack_build",
    model: "packer_v1",
    promptVersion: "pack_build_v1",
    inputs: {
      blueprint: blueprintFile,
      cards,
      qa: qa ?? null,
      judge: judgeConfigCacheShape(params.judge),
    },
  });

  const cache = await createCasCache(path.join(params.layout.cacheDir, "packs"));
  const cached = params.noCache ? null : await cache.getJson<{ packs: SectionPackV1[] }>(key);

  const packs =
    cached?.packs ??
    (await buildSectionPacks({
      blueprint,
      cards,
      qa,
      ...(params.judge ? { ranker: buildJudgeRanker({ layout: params.layout, judge: params.judge }) } : {}),
    }));
  if (!cached) {
    await cache.putJson(key, { version: 1, packs });
  }

  const { manifestPath, packPaths, manifest } = await writePackOutputs({
    outDir,
    packs,
    blueprintPath,
    cardsPath,
    ...(qaPath ? { qaPath } : {}),
  });

  return {
    manifestPath,
    packPaths,
    dataset: buildSectionPacksV1Dataset(packs),
    manifest,
    cacheHit: Boolean(cached),
  };
}
