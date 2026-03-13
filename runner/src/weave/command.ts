import fs from "node:fs/promises";
import path from "node:path";

import type { HistwriteProjectLayout } from "../project.js";
import { runWeaveGates } from "./gates.js";
import { weaveNarrativeDraft } from "./narrative-weaver.js";
import type { WeaveCommandResultV1 } from "./schema.js";

export async function runWeaveCommand(params: {
  layout: HistwriteProjectLayout;
  packPath: string;
  draftPath: string;
  outPath: string;
  materialsPath: string;
  cardsPath: string;
  claimsPath?: string | null;
  lexiconPath?: string | null;
  mode?: "draft" | "final";
  noCache?: boolean;
  useJudge?: boolean;
  judgeClient?: Parameters<typeof runWeaveGates>[0]["judgeClient"];
  client: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  };
}): Promise<WeaveCommandResultV1> {
  const draft = await fs.readFile(path.resolve(params.draftPath), "utf8");
  const woven = await weaveNarrativeDraft({
    draft,
    layout: params.layout,
    noCache: params.noCache,
    client: params.client,
  });

  const outPath = path.resolve(params.outPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${woven.wovenDraft.trim()}\n`, "utf8");

  const gates = await runWeaveGates({
    projectDir: params.layout.projectDir,
    beforeDraft: draft,
    wovenDraftPath: outPath,
    packPath: params.packPath,
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
    outPath,
    cacheHit: woven.cacheHit,
    endpoint: woven.endpoint,
    model: woven.model,
    claimDiff: gates.claimDiff,
    verify: gates.verify,
  };
}
