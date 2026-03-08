import fs from "node:fs/promises";
import path from "node:path";

import type { HistwriteProjectLayout } from "./project.js";

export type EpisodesStore = {
  episodesPath: string;
  append: (episode: unknown) => Promise<void>;
};

export function resolveEpisodesPath(layout: HistwriteProjectLayout): string {
  return path.join(layout.episodesDir, "episodes.jsonl");
}

export async function createEpisodesStore(params: { layout: HistwriteProjectLayout }): Promise<EpisodesStore> {
  const episodesPath = resolveEpisodesPath(params.layout);
  await fs.mkdir(path.dirname(episodesPath), { recursive: true });
  return {
    episodesPath,
    append: async (episode: unknown) => {
      await fs.appendFile(episodesPath, `${JSON.stringify(episode)}\n`, "utf8");
    },
  };
}

