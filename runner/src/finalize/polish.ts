import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { diffClaimSets, type ClaimSetDiffV1 } from "../claims/diff.js";
import { extractClaimMap } from "../claims/extract.js";
import { parseClaimAnchors } from "../claims/parse.js";
import type { HistwriteProjectLayout } from "../project.js";
import { buildPolishInstruction, buildPolishPlaceholderToken } from "../prompts/polish.js";
import { rewriteMarkdownFile } from "../rewrite.js";

type PlaceholderBlock = {
  token: string;
  anchorBlock: string;
};

export type PolishRunOutput = {
  outPath: string;
  diff: ClaimSetDiffV1;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
  placeholderCount: number;
};

function normalizeDraft(text: string): string {
  return text.trim();
}

function maskClaimAnchors(draft: string): { maskedDraft: string; placeholders: PlaceholderBlock[] } {
  const anchors = parseClaimAnchors(draft);
  if (anchors.length === 0) {
    return { maskedDraft: draft, placeholders: [] };
  }

  const placeholders: PlaceholderBlock[] = [];
  const parts: string[] = [];
  let cursor = 0;

  anchors.forEach((anchor, index) => {
    parts.push(draft.slice(cursor, anchor.openTagStart));
    const token = buildPolishPlaceholderToken(index);
    parts.push(token);
    placeholders.push({
      token,
      anchorBlock: draft.slice(anchor.openTagStart, anchor.closeTagEnd),
    });
    cursor = anchor.closeTagEnd;
  });

  parts.push(draft.slice(cursor));
  return { maskedDraft: parts.join(""), placeholders };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function restoreClaimAnchors(params: { rewrittenMaskedDraft: string; placeholders: PlaceholderBlock[] }): string {
  let restored = params.rewrittenMaskedDraft;
  for (const placeholder of params.placeholders) {
    const count = countOccurrences(restored, placeholder.token);
    if (count !== 1) {
      throw new Error(`polish placeholder mismatch: ${placeholder.token} appears ${count} times`);
    }
    restored = restored.replace(placeholder.token, placeholder.anchorBlock);
  }
  return restored;
}

export async function runPolishStep(params: {
  layout: HistwriteProjectLayout;
  inPath: string;
  outPath: string;
  noCache?: boolean;
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<PolishRunOutput> {
  const inAbs = path.resolve(params.inPath);
  const outAbs = path.resolve(params.outPath);
  const sourceDraft = normalizeDraft(await fs.readFile(inAbs, "utf8"));
  const beforeClaims = extractClaimMap({ draft: sourceDraft });
  const { maskedDraft, placeholders } = maskClaimAnchors(sourceDraft);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "histwrite-polish-"));
  const maskedInPath = path.join(tmpDir, "masked-input.md");
  const maskedOutPath = path.join(tmpDir, "masked-output.md");

  try {
    await fs.writeFile(maskedInPath, `${maskedDraft}\n`, "utf8");
    const rewritten = await rewriteMarkdownFile({
      layout: params.layout,
      inPath: maskedInPath,
      outPath: maskedOutPath,
      instruction: buildPolishInstruction({ placeholders: placeholders.map((item) => item.token) }),
      noCache: params.noCache,
      client: params.client,
    });

    const rewrittenMaskedDraft = normalizeDraft(await fs.readFile(maskedOutPath, "utf8"));
    const polishedDraft = normalizeDraft(restoreClaimAnchors({ rewrittenMaskedDraft, placeholders }));
    const afterClaims = extractClaimMap({ draft: polishedDraft });
    const diff = diffClaimSets({ before: beforeClaims.claimSet, after: afterClaims.claimSet });

    if (diff.addedClaims > 0) {
      throw new Error(`polish introduced new claims: ${diff.added.map((item) => item.claimId).join(", ")}`);
    }

    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    await fs.writeFile(outAbs, `${polishedDraft}\n`, "utf8");

    return {
      outPath: outAbs,
      diff,
      cacheHit: rewritten.cacheHit,
      endpoint: rewritten.endpoint,
      model: rewritten.model,
      placeholderCount: placeholders.length,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
