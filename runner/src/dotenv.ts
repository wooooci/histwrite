import fs from "node:fs/promises";
import path from "node:path";

export type DotEnvLoadResult = {
  path: string;
  loaded: Record<string, string>;
  skipped: string[];
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed.length < 2) return trimmed;
  const last = trimmed[trimmed.length - 1];
  if (last !== quote) return trimmed;
  return trimmed.slice(1, -1);
}

function stripInlineComment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const first = trimmed[0];
  if (first === "\"" || first === "'") return trimmed;
  const idx = trimmed.search(/\s#/);
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx).trimEnd();
}

export async function loadDotEnvFromDir(params: {
  dir: string;
  filename?: string;
  override?: boolean;
}): Promise<DotEnvLoadResult | null> {
  const dir = path.resolve(params.dir);
  const filename = (params.filename ?? ".env").trim() || ".env";
  const envPath = path.join(dir, filename);
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch (err) {
    if (typeof err === "object" && err && "code" in err && (err as any).code === "ENOENT") return null;
    throw err;
  }

  const loaded: Record<string, string> = {};
  const skipped: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const maybeExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = maybeExport.indexOf("=");
    if (eq === -1) continue;

    const key = maybeExport.slice(0, eq).trim();
    if (!key) continue;
    const valueRaw = maybeExport.slice(eq + 1);
    const value = stripQuotes(stripInlineComment(valueRaw));

    if (!params.override && process.env[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    process.env[key] = value;
    loaded[key] = value;
  }

  return { path: envPath, loaded, skipped };
}

