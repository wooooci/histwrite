export const platformIds = [
  "jstor",
  "proquest",
  "gale",
  "adammatthew",
  "hathitrust",
  "cnki",
  "fallback",
] as const;

export const downloadModes = [
  "direct_pdf",
  "record_then_pdf",
  "page_range_dialog",
  "cart_batch",
  "zotero_only",
  "manual_only",
] as const;

export const supportStatuses = ["planned", "partial", "ready", "manual_required", "blocked"] as const;

export type PlatformId = (typeof platformIds)[number];
export type DownloadMode = (typeof downloadModes)[number];
export type SupportStatus = (typeof supportStatuses)[number];

export type PlatformMatrixRow = {
  guideName: string;
  guideCode: string | null;
  umichHit: string | null;
  landingUrl: string | null;
  landingHost: string | null;
  platform: PlatformId;
  downloadMode: DownloadMode;
  status: SupportStatus;
  notes: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${field}: expected non-empty string`);
  }
  return value.trim();
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("invalid nullable string: expected string, null, or undefined");
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asEnumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`invalid ${field}: expected one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

export function parsePlatformMatrixRow(input: unknown): PlatformMatrixRow {
  if (!isRecord(input)) throw new Error("invalid platform matrix row: expected object");

  return {
    guideName: asNonEmptyString(input.guideName, "guideName"),
    guideCode: asNullableString(input.guideCode),
    umichHit: asNullableString(input.umichHit),
    landingUrl: asNullableString(input.landingUrl),
    landingHost: asNullableString(input.landingHost),
    platform: asEnumValue(input.platform, platformIds, "platform"),
    downloadMode: asEnumValue(input.downloadMode, downloadModes, "downloadMode"),
    status: asEnumValue(input.status, supportStatuses, "status"),
    notes: asNullableString(input.notes),
  };
}
