import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensureHistwriteProject } from "./project.js";
import { createRunLogger } from "./runlog.js";

describe("runlog v4.1", () => {
  it("writes hash-chain events with inputs/outputs hashes, dependency heads, and gate summaries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runlog-v41-"));
    const layout = await ensureHistwriteProject(root);
    const headsPath = path.join(layout.artifactsDir, "heads.json");
    await fs.writeFile(
      headsPath,
      `${JSON.stringify(
        {
          version: 1,
          updatedAt: "2026-03-12T00:00:00.000Z",
          materialsV2: {
            artifactId: "sha256:materials",
            sha256: "materials",
            path: "/tmp/materials.v2.json",
            builtAt: "2026-03-12T00:00:00.000Z",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const logger = await createRunLogger({ logsDir: layout.logsDir, runId: "test-v41" });
    await logger.write("pack_build_begin", { sectionId: "s1", cards: ["c1", "c2"] });
    await logger.write("verify_done", {
      status: "passed",
      blockers: 0,
      warnings: 1,
      factcheck: { blockers: 0, warnings: 1 },
      chronology: { blockers: 0, warnings: 0 },
    });

    const lines = (await fs.readFile(logger.path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.inputsHash).toBeTypeOf("string");
    expect(lines[0]?.outputsHash).toBeUndefined();
    expect((lines[0]?.dependencies as { heads?: { version?: number } })?.heads?.version).toBe(1);
    expect(lines[0]?.eventHash).toBeTypeOf("string");

    expect(lines[1]?.outputsHash).toBeTypeOf("string");
    expect(lines[1]?.prevEventHash).toBe(lines[0]?.eventHash);
    expect(lines[1]?.gateSummary).toEqual({
      status: "passed",
      blockers: 0,
      warnings: 1,
      factcheck: { blockers: 0, warnings: 1 },
      chronology: { blockers: 0, warnings: 0 },
    });
  });
});
