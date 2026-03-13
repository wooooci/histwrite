import fs from "node:fs/promises";
import path from "node:path";

import { diffClaimSets } from "../claims/diff.js";
import { extractClaimMap } from "../claims/extract.js";
import { resolveHistwriteLayout } from "../project.js";
import { runVerifyCommand, type VerifyCommandResult } from "../gates/command.js";
import type { WeaveGateResultV1 } from "./schema.js";

export async function runWeaveGates(params: {
  projectDir: string;
  beforeDraft: string;
  wovenDraftPath: string;
  packPath: string;
  materialsPath: string;
  cardsPath: string;
  claimsPath?: string | null;
  lexiconPath?: string | null;
  mode?: "draft" | "final";
  useJudge?: boolean;
  judgeClient?: Parameters<typeof runVerifyCommand>[0]["judgeClient"];
}): Promise<WeaveGateResultV1> {
  const layout = resolveHistwriteLayout(params.projectDir);
  const wovenDraft = (await fs.readFile(path.resolve(params.wovenDraftPath), "utf8")).trim();
  const beforeClaims = extractClaimMap({ draft: params.beforeDraft.trim() });
  const afterClaims = extractClaimMap({ draft: wovenDraft });
  const claimDiff = diffClaimSets({ before: beforeClaims.claimSet, after: afterClaims.claimSet });

  if (claimDiff.addedClaims > 0) {
    throw new Error(`woven draft added claim anchors: ${claimDiff.added.map((item) => item.claimId).join(", ")}`);
  }

  const verify = await runVerifyCommand({
    layout,
    packPath: params.packPath,
    draftPath: params.wovenDraftPath,
    materialsPath: params.materialsPath,
    cardsPath: params.cardsPath,
    claimsPath: params.claimsPath,
    lexiconPath: params.lexiconPath,
    mode: params.mode,
    useJudge: params.useJudge,
    judgeClient: params.judgeClient,
  });

  return {
    version: 1,
    claimDiff,
    verify,
  };
}
