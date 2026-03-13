import type { CaptureSnapshotResult } from "../capture.js";
import type { DownloadMode, PlatformId, PlatformMatrixRow } from "./contract.js";

export type PlatformDownloadRequest = {
  projectDir: string;
  outDir?: string;
  targetId?: string;
  term?: string;
  includePng?: boolean;
  includeText?: boolean;
  maxChars?: number;
  dryRun?: boolean;
};

export type PlatformDriverSnapshotInput = {
  projectDir: string;
  outDir?: string;
  targetId?: string;
  includePng?: boolean;
  includeText?: boolean;
  maxChars?: number;
};

export type PlatformDriverCdpInput = {
  kind: PlatformId;
  relayBaseUrl: string;
  row: PlatformMatrixRow;
  request: PlatformDownloadRequest;
};

export type PlatformDriverDeps = {
  relayBaseUrl: string;
  snapshot: (input: PlatformDriverSnapshotInput) => Promise<CaptureSnapshotResult>;
  runCdp: (input: PlatformDriverCdpInput) => Promise<unknown>;
};

export type PlatformDriverResult =
  | {
      ok: true;
      kind: PlatformId;
      status: "ready" | "partial";
      data?: Record<string, unknown>;
    }
  | {
      ok: false;
      kind: PlatformId;
      status: "manual_required" | "blocked";
      reason: string;
      data?: Record<string, unknown>;
    };

export type PlatformDriverContext = {
  deps: PlatformDriverDeps;
  row: PlatformMatrixRow;
  request: PlatformDownloadRequest;
};

export type PlatformDriver = {
  kind: PlatformId;
  supportedDownloadModes: DownloadMode[];
  matches: (params: { platform: PlatformId; downloadMode: DownloadMode }) => boolean;
  run: (ctx: PlatformDriverContext) => Promise<PlatformDriverResult>;
};

export function unsupportedDownloadResult(kind: PlatformId, reason = "unsupported_download_mode"): PlatformDriverResult {
  return {
    ok: false,
    kind,
    status: "manual_required",
    reason,
  };
}

export function createManualPlatformDriver(kind: PlatformId, supportedDownloadModes: DownloadMode[]): PlatformDriver {
  return {
    kind,
    supportedDownloadModes,
    matches(params) {
      return params.platform === kind && supportedDownloadModes.includes(params.downloadMode);
    },
    async run() {
      return unsupportedDownloadResult(kind);
    },
  };
}
