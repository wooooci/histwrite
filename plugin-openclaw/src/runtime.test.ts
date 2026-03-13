import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRunnerArgv, resolveDefaultProjectDir, resolvePluginConfig, resolveRunnerEntry } from "./runtime.js";

const fakeApi = {
  pluginConfig: {},
  resolvePath: (value: string) => path.resolve("/tmp/base", value),
} as any;

describe("plugin-openclaw runtime helpers", () => {
  it("fills default node binary", () => {
    expect(resolvePluginConfig(fakeApi).nodeBin).toBe("node");
  });

  it("resolves custom runner entry via plugin api", () => {
    const runner = resolveRunnerEntry(fakeApi, { runnerEntry: "runner/src/cli.ts" });
    expect(runner).toBe(path.resolve("/tmp/base", "runner/src/cli.ts"));
  });

  it("builds runner argv from raw command", () => {
    const argv = buildRunnerArgv({
      api: fakeApi,
      ctx: {},
      cfg: { nodeBin: "node", runnerEntry: "runner/src/cli.ts" },
      command: "project init --project demo",
    });
    expect(argv[0]).toBe("node");
    expect(argv.slice(-4)).toEqual(["project", "init", "--project", "demo"]);
  });

  it("passes scanner commands through without rewriting argv", () => {
    const argv = buildRunnerArgv({
      api: fakeApi,
      ctx: {},
      cfg: { nodeBin: "node", runnerEntry: "runner/src/cli.ts" },
      command: "scan jstor --project demo --max-items 3",
    });

    expect(argv.slice(-5)).toEqual(["jstor", "--project", "demo", "--max-items", "3"]);
    expect(argv).toContain("scan");
  });

  it("passes sources commands through without rewriting argv", () => {
    const argv = buildRunnerArgv({
      api: fakeApi,
      ctx: {},
      cfg: { nodeBin: "node", runnerEntry: "runner/src/cli.ts" },
      command: "sources matrix --project demo",
    });

    expect(argv.slice(-4)).toEqual(["sources", "matrix", "--project", "demo"]);
  });

  it("prefers workspaceDir as default project dir", () => {
    expect(resolveDefaultProjectDir({}, { workspaceDir: "/tmp/workspace" })).toBe("/tmp/workspace");
  });
});
