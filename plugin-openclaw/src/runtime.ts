import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClawdbotPluginApi, ClawdbotPluginToolContext } from "clawdbot/plugin-sdk";

export type HistwritePluginConfig = {
  nodeBin?: string;
  runnerEntry?: string;
  defaultProjectDir?: string;
  relayBaseUrl?: string;
};

export function resolvePluginConfig(api: ClawdbotPluginApi): Required<Pick<HistwritePluginConfig, "nodeBin">> & HistwritePluginConfig {
  const raw = (api.pluginConfig ?? {}) as HistwritePluginConfig;
  return {
    ...raw,
    nodeBin: typeof raw.nodeBin === "string" && raw.nodeBin.trim() ? raw.nodeBin.trim() : "node",
  };
}

export function resolveRunnerEntry(api: ClawdbotPluginApi, cfg: HistwritePluginConfig): string {
  if (typeof cfg.runnerEntry === "string" && cfg.runnerEntry.trim()) {
    return api.resolvePath(cfg.runnerEntry.trim());
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../runner/src/cli.ts");
}

export function buildRunnerArgv(params: {
  api: ClawdbotPluginApi;
  ctx: ClawdbotPluginToolContext;
  cfg: HistwritePluginConfig;
  command: string;
}): string[] {
  const runnerEntry = resolveRunnerEntry(params.api, params.cfg);
  const raw = params.command.trim();
  const argv = [params.cfg.nodeBin?.trim() || "node", "--import", "tsx", runnerEntry];
  if (!raw) return argv;
  return [...argv, ...raw.split(/\s+/).filter(Boolean)];
}

export function resolveDefaultProjectDir(cfg: HistwritePluginConfig, ctx: ClawdbotPluginToolContext): string | undefined {
  if (typeof cfg.defaultProjectDir === "string" && cfg.defaultProjectDir.trim()) {
    return cfg.defaultProjectDir.trim();
  }
  if (typeof ctx.workspaceDir === "string" && ctx.workspaceDir.trim()) {
    return ctx.workspaceDir.trim();
  }
  return undefined;
}
