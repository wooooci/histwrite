import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type OpencodeConfig = {
  model?: string;
  provider?: Record<string, { options?: Record<string, unknown> }>;
};

export function defaultOpencodeConfigPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  // Minimal JSONC support: remove // and /* */ comments, and remove trailing commas before } or ].
  const out: string[] = [];
  let i = 0;
  let inString = false;
  let escape = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < input.length) {
    const ch = input[i]!;
    const next = i + 1 < input.length ? input[i + 1]! : "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out.push(ch);
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      out.push(ch);
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Trailing comma removal: if we see a comma, look ahead for the next non-whitespace; if it's } or ], skip it.
    if (ch === ",") {
      let j = i + 1;
      while (j < input.length) {
        const cj = input[j]!;
        if (cj === " " || cj === "\t" || cj === "\r" || cj === "\n") {
          j += 1;
          continue;
        }
        if (cj === "}" || cj === "]") {
          // skip comma
          i += 1;
          break;
        }
        out.push(ch);
        i += 1;
        break;
      }
      if (j >= input.length) {
        out.push(ch);
        i += 1;
      }
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}

async function readConfigFile(filePath: string): Promise<string> {
  return await fs.readFile(path.resolve(filePath), "utf8");
}

export async function readOpencodeConfig(filePath: string): Promise<OpencodeConfig> {
  const raw = await readConfigFile(filePath);
  try {
    return JSON.parse(raw) as OpencodeConfig;
  } catch {
    const stripped = stripJsonCommentsAndTrailingCommas(raw);
    return JSON.parse(stripped) as OpencodeConfig;
  }
}

function resolveEnvRef(value: string): string | null {
  const s = value.trim();
  const m1 = s.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m1?.[1]) return process.env[m1[1]] ?? null;
  const m2 = s.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (m2?.[1]) return process.env[m2[1]] ?? null;
  const m3 = s.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (m3?.[1]) return process.env[m3[1]] ?? null;
  return null;
}

export function parseOpencodeModelRef(modelRef: string): { providerName: string; modelId: string } {
  const trimmed = modelRef.trim();
  const idx = trimmed.indexOf("/");
  if (idx === -1) throw new Error(`invalid opencode model ref (expected provider/model): ${trimmed}`);
  const providerName = trimmed.slice(0, idx).trim();
  const modelId = trimmed.slice(idx + 1).trim();
  if (!providerName || !modelId) {
    throw new Error(`invalid opencode model ref (expected provider/model): ${trimmed}`);
  }
  return { providerName, modelId };
}

export async function resolveOpenAiCompatFromOpencode(params: {
  configPath?: string;
  modelRef?: string | null;
  providerName?: string | null;
  modelOverride?: string | null;
}): Promise<{ providerName: string; apiBaseUrl: string; apiKey: string; model: string }> {
  const configPath = params.configPath?.trim() ? params.configPath.trim() : defaultOpencodeConfigPath();
  const cfg = await readOpencodeConfig(configPath);
  const providers = cfg.provider ?? {};

  const modelRef = params.modelRef?.trim()
    ? params.modelRef.trim()
    : cfg.model?.trim()
      ? cfg.model.trim()
      : "";

  let providerName = params.providerName?.trim() ? params.providerName.trim() : "";
  let modelId = "";

  if (modelRef) {
    const parsed = parseOpencodeModelRef(modelRef);
    if (!providerName) providerName = parsed.providerName;
    modelId = parsed.modelId;
  }

  const model = params.modelOverride?.trim() ? params.modelOverride.trim() : modelId;
  if (!providerName) throw new Error("opencode config missing provider name (use --opencodeModel or --opencodeProvider)");
  if (!model) throw new Error("opencode config missing model id (use --model or --opencodeModel)");

  const prov = providers[providerName];
  if (!prov) throw new Error(`opencode provider not found: ${providerName}`);
  const opts = prov.options ?? {};

  const baseURL = (opts.baseURL ?? opts.baseUrl ?? opts.base_url) as unknown;
  const apiKeyRaw = (opts.apiKey ?? opts.api_key) as unknown;

  const apiBaseUrl = typeof baseURL === "string" ? baseURL.trim() : "";
  if (!apiBaseUrl) throw new Error(`opencode provider ${providerName} has no options.baseURL`);

  let apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
  if (apiKey) {
    const env = resolveEnvRef(apiKey);
    if (env !== null) apiKey = env.trim();
  }
  if (!apiKey) throw new Error(`opencode provider ${providerName} has no options.apiKey`);

  return { providerName, apiBaseUrl, apiKey, model };
}

