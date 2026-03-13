import path from "node:path";

import { describe, expect, it } from "vitest";

import register from "./index.js";

describe("plugin-openclaw tool help", () => {
  it("shows scan examples and the unified relay default port", async () => {
    let factory: ((ctx: unknown) => { execute: (toolCallId: string, params?: { command?: string }) => Promise<any> }) | null =
      null;

    const api = {
      pluginConfig: {},
      resolvePath: (value: string) => path.resolve("/tmp/base", value),
      registerTool(fn: typeof factory) {
        factory = fn;
      },
    } as any;

    register(api);
    expect(factory).toBeTruthy();

    const tool = factory!({ workspaceDir: "/tmp/workspace" });
    const result = await tool.execute("tool-1", {});
    const text = String(result.content?.[0]?.text ?? "");

    expect(text).toMatch(/scan jstor/i);
    expect(text).toMatch(/sources matrix/i);
    expect(text).toContain("18992");
  });
});
