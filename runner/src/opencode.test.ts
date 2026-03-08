import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseOpencodeModelRef, readOpencodeConfig, resolveOpenAiCompatFromOpencode } from "./opencode.js";

describe("opencode config", () => {
  it("parses provider/model refs", () => {
    expect(parseOpencodeModelRef("p/m")).toEqual({ providerName: "p", modelId: "m" });
  });

  it("reads opencode.json and resolves baseURL/apiKey/model", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-opencode-"));
    const cfgPath = path.join(dir, "opencode.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify(
        {
          model: "vendor/gpt-x",
          provider: {
            vendor: { options: { baseURL: "https://example.invalid/v1", apiKey: "k" } },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const cfg = await readOpencodeConfig(cfgPath);
    expect(cfg.model).toBe("vendor/gpt-x");

    const resolved = await resolveOpenAiCompatFromOpencode({ configPath: cfgPath });
    expect(resolved.providerName).toBe("vendor");
    expect(resolved.apiBaseUrl).toBe("https://example.invalid/v1");
    expect(resolved.apiKey).toBe("k");
    expect(resolved.model).toBe("gpt-x");
  });

  it("supports jsonc comments and trailing commas", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-opencode-jsonc-"));
    const cfgPath = path.join(dir, "opencode.jsonc");
    await fs.writeFile(
      cfgPath,
      `{\n` +
        `  // comment\n` +
        `  \"model\": \"vendor/gpt-x\",\n` +
        `  \"provider\": {\n` +
        `    \"vendor\": {\n` +
        `      \"options\": {\n` +
        `        \"baseURL\": \"https://example.invalid/v1\",\n` +
        `        \"apiKey\": \"k\",\n` +
        `      },\n` +
        `    },\n` +
        `  },\n` +
        `}\n`,
      "utf8",
    );

    const resolved = await resolveOpenAiCompatFromOpencode({ configPath: cfgPath });
    expect(resolved.providerName).toBe("vendor");
    expect(resolved.model).toBe("gpt-x");
  });
});

