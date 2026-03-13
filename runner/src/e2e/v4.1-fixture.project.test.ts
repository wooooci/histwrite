import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type FixtureManifest = {
  version: 1;
  fixtureId: string;
  targetSection: {
    sectionId: string;
    title: string;
    minChars: number;
    maxChars: number;
  };
  projectFiles: string[];
  bundleFiles: string[];
};

describe("v4.1 regression fixture project", () => {
  it("ships a replayable fixture with project inputs and regression bundle outputs", async () => {
    const fixtureRoot = path.resolve(process.cwd(), "content/examples/v4.1-fixture");
    const manifestPath = path.join(fixtureRoot, "fixture.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as FixtureManifest;

    expect(manifest.version).toBe(1);
    expect(manifest.fixtureId).toBe("v4.1-fixture");
    expect(manifest.projectFiles.length).toBeGreaterThanOrEqual(5);
    expect(manifest.projectFiles.length).toBeLessThanOrEqual(20);

    await Promise.all(
      [...manifest.projectFiles, ...manifest.bundleFiles].map(async (relativePath) => {
        await expect(fs.access(path.join(fixtureRoot, relativePath))).resolves.toBeUndefined();
      }),
    );

    const finalMarkdown = await fs.readFile(path.join(fixtureRoot, "bundle", "Final.md"), "utf8");
    expect(finalMarkdown.length).toBeGreaterThanOrEqual(manifest.targetSection.minChars);
    expect(finalMarkdown.length).toBeLessThanOrEqual(manifest.targetSection.maxChars);

    const materials = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "project", "材料", "_index", "materials.v2.json"), "utf8"),
    ) as { materials?: unknown[] };
    expect(Array.isArray(materials.materials)).toBe(true);
    expect(materials.materials?.length).toBeGreaterThanOrEqual(5);
    expect(materials.materials?.length).toBeLessThanOrEqual(10);

    const cards = JSON.parse(await fs.readFile(path.join(fixtureRoot, "bundle", "artifacts", "cards.v2.json"), "utf8")) as {
      version: number;
      cards?: Array<{ selectorBundle?: unknown; resolvedSpan?: unknown }>;
    };
    expect(cards.version).toBe(2);
    expect(cards.cards?.every((card) => card.selectorBundle && card.resolvedSpan)).toBe(true);

    const factcheck = JSON.parse(await fs.readFile(path.join(fixtureRoot, "bundle", "reports", "factcheck.json"), "utf8")) as {
      blockers: number;
    };
    const chronology = JSON.parse(await fs.readFile(path.join(fixtureRoot, "bundle", "reports", "chronology.json"), "utf8")) as {
      blockers: number;
    };
    expect(factcheck.blockers).toBe(0);
    expect(chronology.blockers).toBe(0);

    const runlog = await fs.readFile(path.join(fixtureRoot, "bundle", "runlog.jsonl"), "utf8");
    expect(runlog.trim().split("\n").length).toBeGreaterThanOrEqual(5);
  });
});
