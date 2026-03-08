import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { exportDraftMarkdown } from "./exporting.js";
import { ensureHistwriteProject } from "./project.js";

describe("exportDraftMarkdown", () => {
  it("concats markdown files in stable order", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `histwrite-export-${randomUUID()}-`));
    const layout = await ensureHistwriteProject(path.join(tmp, "proj"));

    await fs.writeFile(path.join(layout.draftDir, "b.md"), "B\n", "utf8");
    await fs.writeFile(path.join(layout.draftDir, "a.md"), "A\n", "utf8");

    const outPath = path.join(layout.exportDir, "draft.md");
    await exportDraftMarkdown({ layout, outPath, title: "草稿汇总" });
    const out = await fs.readFile(outPath, "utf8");
    const idxA = out.indexOf("<!-- file: 正文/a.md -->");
    const idxB = out.indexOf("<!-- file: 正文/b.md -->");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
    expect(out).toContain("# 草稿汇总");
    expect(out).toContain("A");
    expect(out).toContain("B");
  });
});

