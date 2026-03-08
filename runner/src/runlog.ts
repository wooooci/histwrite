import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type RunLogEvent = {
  ts: string;
  name: string;
  data?: unknown;
};

export type RunLogger = {
  path: string;
  write: (name: string, data?: unknown) => Promise<void>;
};

export async function createRunLogger(params: { logsDir: string; runId?: string }): Promise<RunLogger> {
  const logsDir = path.resolve(params.logsDir);
  await fs.mkdir(logsDir, { recursive: true });

  const runId = (params.runId ?? randomUUID()).trim() || randomUUID();
  const logPath = path.join(logsDir, `run-${runId}.jsonl`);

  return {
    path: logPath,
    write: async (name: string, data?: unknown) => {
      const evt: RunLogEvent = { ts: new Date().toISOString(), name, data };
      await fs.appendFile(logPath, `${JSON.stringify(evt)}\n`, "utf8");
    },
  };
}

