import type { ClaimSetDiffV1 } from "../claims/diff.js";
import type { VerifyCommandResult } from "../gates/command.js";

export type WeaveNarrativeResultV1 = {
  version: 1;
  wovenDraft: string;
  anchorDiff: ClaimSetDiffV1;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
};

export type WeaveGateResultV1 = {
  version: 1;
  claimDiff: ClaimSetDiffV1;
  verify: VerifyCommandResult;
};

export type WeaveCommandResultV1 = {
  version: 1;
  outPath: string;
  cacheHit: boolean;
  endpoint: "chat" | "responses";
  model: string;
  claimDiff: ClaimSetDiffV1;
  verify: VerifyCommandResult;
};
