import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "../project.js";
import { artifactRefFromValue, readArtifactHeads, setArtifactHead } from "./heads.js";

describe("artifacts heads", () => {
  it("reads default heads and can update materialsV2 head", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-runner-${randomUUID()}-`));
    const projectDir = path.join(tmp, "proj");
    const layout = await ensureHistwriteProject(projectDir);

    const h0 = await readArtifactHeads(layout);
    expect(h0.version).toBe(1);
    expect(h0.materialsV2).toBeUndefined();

    const outPath = path.join(layout.materialsIndexDir, "materials.v2.json");
    const ref = artifactRefFromValue({ outPath, value: { version: 2, materials: [{ id: "m1" }] } });
    const h1 = await setArtifactHead(layout, { key: "materialsV2", ref });
    expect(h1.materialsV2?.artifactId).toBe(ref.artifactId);
  });
});

