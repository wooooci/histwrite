import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { HistwriteProjectLayout } from "./project.js";

export type RelaySnapshotResponse = {
  ok?: boolean;
  capturedAt?: string;
  tab?: {
    sessionId?: string;
    targetId?: string;
    title?: string;
    url?: string;
  };
  pngBase64?: string | null;
  text?: string | null;
  error?: string;
};

export type CaptureSnapshotResult = {
  id: string;
  metaPath: string;
  textPath: string | null;
  pngPath: string | null;
  tab: { targetId: string; title: string; url: string };
  capturedAt: string;
};

function normalizeBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  if (!base) return "http://127.0.0.1:18792";
  return base;
}

export async function captureRelaySnapshot(params: {
  layout: HistwriteProjectLayout;
  relayBaseUrl?: string;
  targetId?: string;
  includePng?: boolean;
  includeText?: boolean;
  maxChars?: number;
  outDir?: string;
}): Promise<CaptureSnapshotResult> {
  const relayBaseUrl = normalizeBaseUrl(params.relayBaseUrl ?? "http://127.0.0.1:18792");
  const includePng = params.includePng !== false;
  const includeText = params.includeText !== false;
  const maxChars = Math.max(0, Math.min(2_000_000, params.maxChars ?? 200_000));

  const outDir = path.resolve(params.outDir ?? path.join(params.layout.materialsIndexDir, "snapshots"));
  await fs.mkdir(outDir, { recursive: true });

  const url = new URL(`${relayBaseUrl}/snapshot`);
  if (!includePng) url.searchParams.set("png", "0");
  if (!includeText) url.searchParams.set("text", "0");
  url.searchParams.set("maxChars", String(maxChars));
  if (params.targetId?.trim()) url.searchParams.set("targetId", params.targetId.trim());

  const res = await fetch(url);
  const payload = (await res.json()) as RelaySnapshotResponse;
  if (!res.ok || payload.ok !== true) {
    const err = payload.error ? String(payload.error) : `HTTP ${res.status}`;
    throw new Error(`relay snapshot failed: ${err}`);
  }

  const capturedAt = String(payload.capturedAt ?? new Date().toISOString());
  const targetId = String(payload.tab?.targetId ?? "").trim();
  const title = String(payload.tab?.title ?? "").trim();
  const pageUrl = String(payload.tab?.url ?? "").trim();
  if (!targetId) throw new Error("relay snapshot missing tab.targetId");

  const id = `s_${randomUUID()}`;
  const metaPath = path.join(outDir, `${id}.json`);

  let textPath: string | null = null;
  if (includeText && typeof payload.text === "string") {
    const abs = path.join(outDir, `${id}.txt`);
    await fs.writeFile(abs, `${payload.text}\n`, "utf8");
    textPath = abs;
  }

  let pngPath: string | null = null;
  if (includePng && typeof payload.pngBase64 === "string" && payload.pngBase64.trim() !== "") {
    const abs = path.join(outDir, `${id}.png`);
    const bytes = Buffer.from(payload.pngBase64, "base64");
    await fs.writeFile(abs, bytes);
    pngPath = abs;
  }

  const meta = {
    id,
    capturedAt,
    tab: { targetId, title, url: pageUrl },
    textPath,
    pngPath,
    relayBaseUrl,
  };
  await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  return { id, metaPath, textPath, pngPath, tab: { targetId, title, url: pageUrl }, capturedAt };
}

