import fs from "node:fs/promises";
import path from "node:path";

import { sha256Hex, stableJsonStringify } from "../cache.js";
import type { HistwriteProjectLayout } from "../project.js";

export type ArtifactRef = {
  artifactId: string;
  sha256: string;
  path: string;
  builtAt: string;
};

export type ArtifactHeadsV1 = {
  version: 1;
  updatedAt: string;
  libraryV1?: ArtifactRef;
  materialsV2?: ArtifactRef;
  cardsV2?: ArtifactRef;
  qaV1?: ArtifactRef;
  packsV1?: ArtifactRef;
};

export function artifactRefFromValue(params: { outPath: string; value: unknown; builtAt?: string }): ArtifactRef {
  const normalized = stableJsonStringify(params.value);
  const sha256 = sha256Hex(normalized);
  return {
    artifactId: `sha256:${sha256}`,
    sha256,
    path: params.outPath,
    builtAt: params.builtAt ?? new Date().toISOString(),
  };
}

export function headsPath(layout: HistwriteProjectLayout): string {
  return path.join(layout.artifactsDir, "heads.json");
}

export async function readArtifactHeads(layout: HistwriteProjectLayout): Promise<ArtifactHeadsV1> {
  const p = headsPath(layout);
  try {
    const parsed = JSON.parse(await fs.readFile(p, "utf8")) as ArtifactHeadsV1;
    if (parsed?.version !== 1) throw new Error("invalid heads version");
    return parsed;
  } catch (err) {
    if (String(err).includes("ENOENT")) {
      return { version: 1, updatedAt: new Date().toISOString() };
    }
    throw err;
  }
}

export async function writeArtifactHeads(layout: HistwriteProjectLayout, heads: ArtifactHeadsV1): Promise<string> {
  const p = headsPath(layout);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(heads, null, 2)}\n`, "utf8");
  return p;
}

export async function setArtifactHead(
  layout: HistwriteProjectLayout,
  params: { key: "libraryV1" | "materialsV2" | "cardsV2" | "qaV1" | "packsV1"; ref: ArtifactRef },
): Promise<ArtifactHeadsV1> {
  const cur = await readArtifactHeads(layout);
  const next: ArtifactHeadsV1 = {
    ...cur,
    version: 1,
    updatedAt: new Date().toISOString(),
    [params.key]: params.ref,
  };
  await writeArtifactHeads(layout, next);
  return next;
}
