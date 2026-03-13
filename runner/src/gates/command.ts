import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClaimMapV1, ClaimsArtifactV1 } from "../artifacts/claims.js";
import type { MaterialsV2Dataset } from "../artifacts/materials.js";
import { readEvidenceCardsDataset } from "../cards/migrate.js";
import { extractClaimMap } from "../claims/extract.js";
import { runChronologyGate } from "./chronology.js";
import { runFactCheckJudge, type FactCheckJudgeRunOutput } from "./factcheck-judge.js";
import { runFactCheckGate } from "./factcheck.js";
import type { SectionPackV1 } from "../packs/schema.js";
import type { HistwriteProjectLayout } from "../project.js";

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

function defaultLexiconPath(): string {
  return fileURLToPath(new URL("../../../content/chronology/lexicon.v1.json", import.meta.url));
}

export type VerifyCommandResult = {
  ok: true;
  status: "passed" | "failed";
  blockers: number;
  warnings: number;
  claims: number;
  factcheck: { blockers: number; warnings: number; path: string };
  chronology: { blockers: number; warnings: number; path: string };
  judge?: { items: number; path: string };
};

export async function runVerifyCommand(params: {
  layout: HistwriteProjectLayout;
  packPath: string;
  draftPath: string;
  materialsPath: string;
  cardsPath: string;
  claimsPath?: string | null;
  lexiconPath?: string | null;
  mode?: "draft" | "final";
  useJudge?: boolean;
  judgeClient?: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    endpoint?: "auto" | "chat" | "responses";
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  } | null;
}): Promise<VerifyCommandResult> {
  const mode = params.mode ?? "final";
  const reportsDir = path.join(params.layout.metaDir, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const [pack, draftText, materials] = await Promise.all([
    readJsonFile<SectionPackV1>(params.packPath),
    fs.readFile(path.resolve(params.draftPath), "utf8"),
    readJsonFile<MaterialsV2Dataset>(params.materialsPath),
  ]);
  const cards = await readEvidenceCardsDataset({ cardsPath: params.cardsPath, materials });

  const claimMap: ClaimMapV1 = params.claimsPath
    ? ((await readJsonFile<ClaimsArtifactV1>(params.claimsPath)) as ClaimMapV1)
    : extractClaimMap({ draft: draftText, pack });

  const factcheck = runFactCheckGate({
    materials,
    cards,
    claims: claimMap,
    mode,
  });

  const chronology = await runChronologyGate({
    claims: claimMap,
    timeWindow: pack.timeWindow,
    lexiconPath: params.lexiconPath ?? defaultLexiconPath(),
    mode,
  });

  const factcheckPath = path.join(reportsDir, "factcheck.v1.json");
  const chronologyPath = path.join(reportsDir, "chronology.v1.json");
  await Promise.all([
    fs.writeFile(factcheckPath, `${JSON.stringify(factcheck, null, 2)}\n`, "utf8"),
    fs.writeFile(chronologyPath, `${JSON.stringify(chronology, null, 2)}\n`, "utf8"),
  ]);

  let judgeOut: FactCheckJudgeRunOutput | null = null;
  let judgePath: string | null = null;
  if (params.useJudge) {
    if (!params.judgeClient) {
      throw new Error("verify --useJudge requires judge client configuration");
    }
    judgeOut = await runFactCheckJudge({
      layout: params.layout,
      claims: claimMap,
      report: factcheck,
      client: params.judgeClient,
    });
    judgePath = path.join(reportsDir, "factcheck-judge.v1.json");
    await fs.writeFile(judgePath, `${JSON.stringify(judgeOut, null, 2)}\n`, "utf8");
  }

  const blockers = factcheck.blockers + chronology.blockers;
  const warnings = factcheck.warnings + chronology.warnings;

  return {
    ok: true,
    status: blockers > 0 ? "failed" : "passed",
    blockers,
    warnings,
    claims: claimMap.claims.length,
    factcheck: { blockers: factcheck.blockers, warnings: factcheck.warnings, path: factcheckPath },
    chronology: { blockers: chronology.blockers, warnings: chronology.warnings, path: chronologyPath },
    ...(judgeOut && judgePath ? { judge: { items: judgeOut.items.length, path: judgePath } } : {}),
  };
}
