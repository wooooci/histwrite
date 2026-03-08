import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalize(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (isPlainObject(value)) {
    const out: Record<string, Json> = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const k of keys) out[k] = canonicalize(value[k]);
    return out;
  }
  return String(value);
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(input);
  return h.digest("hex");
}

export type CasCache = {
  dir: string;
  getJson: <T>(key: string) => Promise<T | null>;
  putJson: (key: string, value: unknown) => Promise<void>;
};

export async function createCasCache(dir: string): Promise<CasCache> {
  const root = path.resolve(dir);
  await fs.mkdir(root, { recursive: true });

  const keyPath = (key: string) => path.join(root, `${key}.json`);

  return {
    dir: root,
    getJson: async <T>(key: string) => {
      try {
        const raw = await fs.readFile(keyPath(key), "utf8");
        return JSON.parse(raw) as T;
      } catch (err) {
        if (String(err).includes("ENOENT")) return null;
        throw err;
      }
    },
    putJson: async (key: string, value: unknown) => {
      const tmp = `${keyPath(key)}.tmp`;
      await fs.writeFile(tmp, `${stableJsonStringify(value)}\n`, "utf8");
      await fs.rename(tmp, keyPath(key));
    },
  };
}

export function cacheKey(params: {
  model: string;
  promptVersion: string;
  inputs: unknown;
}): string {
  const normalized = stableJsonStringify({
    model: params.model,
    promptVersion: params.promptVersion,
    inputs: params.inputs,
  });
  return sha256Hex(normalized);
}

