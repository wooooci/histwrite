import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEpisodesStore } from "./episodes.js";
import { ensureHistwriteProject } from "./project.js";

describe("episodes", () => {
  it("appends jsonl lines under .histwrite/learn/episodes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-episodes-"));
    const layout = await ensureHistwriteProject(path.join(tmp, "proj"));
    const store = await createEpisodesStore({ layout });
    await store.append({ version: 1, kind: "test", at: 1, value: { a: 1 } });
    const raw = await fs.readFile(store.episodesPath, "utf8");
    expect(raw.trim()).toContain("\"kind\":\"test\"");
    expect(store.episodesPath).toContain(`${path.sep}.histwrite${path.sep}learn${path.sep}episodes${path.sep}episodes.jsonl`);
  });
});

