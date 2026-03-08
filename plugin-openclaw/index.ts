import { spawn } from "node:child_process";

import { Type } from "@sinclair/typebox";
import type { ClawdbotPluginApi, ClawdbotPluginToolContext } from "clawdbot/plugin-sdk";

import { buildRunnerArgv, resolveDefaultProjectDir, resolvePluginConfig } from "./src/runtime.js";

async function runCommand(argv: string[], cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
    child.once("error", (err) => resolve({ code: 1, stdout, stderr: String(err) }));
  });
}

function createHistwriteTool(api: ClawdbotPluginApi, ctx: ClawdbotPluginToolContext) {
  return {
    name: "histwrite",
    description: "Run Histwrite runner commands from OpenClaw.",
    parameters: Type.Object({
      command: Type.Optional(Type.String({ description: "Runner command string, for example: project init --project demo" })),
    }),
    async execute(_toolCallId: string, params?: { command?: string }) {
      const cfg = resolvePluginConfig(api);
      const command = typeof params?.command === "string" ? params.command.trim() : "";
      if (!command) {
        const help = [
          "Histwrite OpenClaw 插件当前通过 runner 执行确定性命令。",
          "示例：",
          "- project init --project demo",
          "- index --project demo --materials demo/材料",
          "- capture --project demo --relay http://127.0.0.1:18792",
          "- export --project demo",
        ].join("\n");
        return { content: [{ type: "text", text: help }], details: { ok: true, help: true } };
      }

      const cwd = resolveDefaultProjectDir(cfg, ctx);
      const argv = buildRunnerArgv({ api, ctx, cfg, command });
      const result = await runCommand(argv, cwd);
      const text = result.code === 0 ? (result.stdout || "OK").trim() : (result.stderr || result.stdout || `exit=${result.code ?? "?"}`).trim();
      return {
        content: [{ type: "text", text }],
        details: {
          ok: result.code === 0,
          argv,
          cwd,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
        },
      };
    },
  };
}

export default function register(api: ClawdbotPluginApi) {
  api.registerTool((ctx) => createHistwriteTool(api, ctx));
}
