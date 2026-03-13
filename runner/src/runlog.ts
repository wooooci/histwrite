import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { sha256Hex, stableJsonStringify } from "./cache.js";

export type RunLogEvent = {
  ts: string;
  seq?: number;
  name: string;
  data?: unknown;
  inputsHash?: string;
  outputsHash?: string;
  dependencies?: {
    heads?: unknown;
  };
  gateSummary?: unknown;
  prevEventHash?: string;
  eventHash?: string;
};

export type RunLogger = {
  path: string;
  write: (name: string, data?: unknown) => Promise<void>;
};

function shouldMarkInputs(name: string): boolean {
  return /(?:^|_)begin$/.test(name) || name === "command_start";
}

function shouldMarkOutputs(name: string): boolean {
  return /(?:^|_)done$/.test(name) || name === "command_end";
}

function resolveHeadsPath(logsDir: string): string {
  return path.resolve(logsDir, "..", "artifacts", "heads.json");
}

async function readHeadsIfExists(logsDir: string): Promise<unknown | null> {
  const headsPath = resolveHeadsPath(logsDir);
  try {
    return JSON.parse(await fs.readFile(headsPath, "utf8")) as unknown;
  } catch (error) {
    if (String(error).includes("ENOENT")) return null;
    throw error;
  }
}

function summarizeGateData(data: unknown): unknown | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const source = data as Record<string, unknown>;
  const base =
    "status" in source || "blockers" in source || "warnings" in source
      ? {
          ...(typeof source.status === "string" ? { status: source.status } : {}),
          ...(typeof source.blockers === "number" ? { blockers: source.blockers } : {}),
          ...(typeof source.warnings === "number" ? { warnings: source.warnings } : {}),
        }
      : {};

  const nested = {
    ...(isGateCounters(source.factcheck) ? { factcheck: source.factcheck } : {}),
    ...(isGateCounters(source.chronology) ? { chronology: source.chronology } : {}),
    ...(isGateCounters(source.finalcheck) ? { finalcheck: source.finalcheck } : {}),
    ...(isGateCounters(source.verify) ? { verify: source.verify } : {}),
  };

  const summary = { ...base, ...nested };
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function isGateCounters(value: unknown): value is { blockers?: number; warnings?: number; status?: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function createRunLogger(params: { logsDir: string; runId?: string }): Promise<RunLogger> {
  const logsDir = path.resolve(params.logsDir);
  await fs.mkdir(logsDir, { recursive: true });

  const runId = (params.runId ?? randomUUID()).trim() || randomUUID();
  const logPath = path.join(logsDir, `run-${runId}.jsonl`);
  let sequence = 0;
  let previousEventHash: string | undefined;

  return {
    path: logPath,
    write: async (name: string, data?: unknown) => {
      const ts = new Date().toISOString();
      const payloadHash = sha256Hex(stableJsonStringify(data ?? null));
      const heads = await readHeadsIfExists(logsDir);
      const evt: RunLogEvent = {
        ts,
        seq: sequence,
        name,
        data,
        ...(shouldMarkInputs(name) ? { inputsHash: payloadHash } : {}),
        ...(shouldMarkOutputs(name) ? { outputsHash: payloadHash } : {}),
        ...(heads ? { dependencies: { heads } } : {}),
        ...(summarizeGateData(data) ? { gateSummary: summarizeGateData(data) } : {}),
        ...(previousEventHash ? { prevEventHash: previousEventHash } : {}),
      };
      const eventHash = sha256Hex(
        stableJsonStringify({
          ts: evt.ts,
          seq: evt.seq,
          name: evt.name,
          inputsHash: evt.inputsHash ?? null,
          outputsHash: evt.outputsHash ?? null,
          prevEventHash: evt.prevEventHash ?? null,
          gateSummary: evt.gateSummary ?? null,
          dataHash: payloadHash,
        }),
      );
      evt.eventHash = eventHash;
      await fs.appendFile(logPath, `${JSON.stringify(evt)}\n`, "utf8");
      previousEventHash = eventHash;
      sequence += 1;
    },
  };
}
