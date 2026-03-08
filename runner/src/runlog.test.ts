import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRunLogger } from "./runlog.js";

describe("runlog", () => {
  it("writes jsonl events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-runlog-"));
    const logger = await createRunLogger({ logsDir: dir, runId: "test" });
    await logger.write("hello", { a: 1 });
    const raw = await fs.readFile(logger.path, "utf8");
    expect(raw).toContain("\"name\":\"hello\"");
    expect(raw).toContain("\"a\":1");
  });
});

