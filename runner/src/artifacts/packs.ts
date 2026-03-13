import type { SectionPackV1 } from "../packs/schema.js";

export type SectionPacksV1Dataset = {
  version: 1;
  createdAt: string;
  packs: SectionPackV1[];
};

export function buildSectionPacksV1Dataset(packs: SectionPackV1[]): SectionPacksV1Dataset {
  return { version: 1, createdAt: new Date().toISOString(), packs };
}

