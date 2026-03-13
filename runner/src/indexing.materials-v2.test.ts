import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMaterialsV2FromLibraryIndex, indexMaterials } from "./indexing.js";
import { ensureHistwriteProject } from "./project.js";

describe("buildMaterialsV2FromLibraryIndex", () => {
  it("writes materials.v2.json with normalized text and skips entries without extracted text", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-runner-${randomUUID()}-`));
    const projectDir = path.join(tmp, "proj");
    const layout = await ensureHistwriteProject(projectDir);

    await fs.mkdir(layout.materialsDir, { recursive: true });
    await fs.writeFile(path.join(layout.materialsDir, "a.txt"), "a\r\nb\u00A0c", "utf8");
    await fs.writeFile(path.join(layout.materialsDir, "b.pdf"), "%PDF-1.4\n%", "utf8");

    const library = await indexMaterials({ layout, materialsDir: layout.materialsDir });
    const built = await buildMaterialsV2FromLibraryIndex({ layout, library });

    expect(built.outPath).toBe(path.join(layout.materialsIndexDir, "materials.v2.json"));
    const parsed = JSON.parse(await fs.readFile(built.outPath, "utf8")) as { materials?: unknown[] };
    expect(Array.isArray(parsed.materials)).toBe(true);

    expect(built.dataset.materials.length).toBe(1);
    expect(built.skipped.length).toBe(1);

    const m = built.dataset.materials[0]!;
    expect(m.provenance.kind).toBe("txt");
    expect(m.normText).toBe("a\nb c\n");
    expect(m.indexText).toBe(m.normText);
  });
});

