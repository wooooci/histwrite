import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDotEnvFromDir } from "./dotenv.js";

describe("dotenv loader", () => {
  const saved = new Map<string, string | undefined>();
  const save = (key: string) => {
    if (saved.has(key)) return;
    saved.set(key, process.env[key]);
  };
  const restoreAll = () => {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
  };

  afterEach(() => restoreAll());

  it("loads .env and does not override existing values by default", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-dotenv-"));
    await fs.writeFile(
      path.join(dir, ".env"),
      ["A=1", "B=\"two\"", "C='three'", "D=four # comment"].join("\n"),
      "utf8",
    );

    save("A");
    save("B");
    save("C");
    save("D");
    process.env.A = "existing";

    const res = await loadDotEnvFromDir({ dir });
    expect(res?.loaded).toMatchObject({ B: "two", C: "three", D: "four" });
    expect(process.env.A).toBe("existing");
    expect(process.env.B).toBe("two");
    expect(process.env.C).toBe("three");
    expect(process.env.D).toBe("four");
  });

  it("can override when override=true", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-dotenv-override-"));
    await fs.writeFile(path.join(dir, ".env"), "A=1\n", "utf8");

    save("A");
    process.env.A = "existing";

    await loadDotEnvFromDir({ dir, override: true });
    expect(process.env.A).toBe("1");
  });
});

