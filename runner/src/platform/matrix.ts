import { parsePlatformMatrixRow, type DownloadMode, type PlatformId, type PlatformMatrixRow, type SupportStatus } from "./contract.js";
import { normalizeGuideName, splitMergedGuideEntries, type GuideEntryLike } from "./guide-cleaning.js";
import { hydrateUmichHitsWithVendorLanding as hydrateVendorLandingHits, resolveVendorLandingForHit } from "./vendor-landing.js";
import { resolveCatalogPlatformHint, type UmichCatalogEntry } from "./umich-csv.js";

export type UmichEntryKind = "umich_database_link" | "umich_proxy_login" | "umich_search" | "direct_vendor";
type PlatformSource = "host" | "name" | "fallback";

export type UmichHitLike = {
  name?: string | null;
  title?: string | null;
  url?: string | null;
  resolvedUrl?: string | null;
  landingUrl?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function readUmichName(entry: UmichHitLike): string | null {
  return readNullableString(entry.name) ?? readNullableString(entry.title);
}

function extractEmbeddedObjectArray(input: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(input)) {
    return input.filter((item): item is Record<string, unknown> => isRecord(item));
  }
  if (!isRecord(input)) return null;
  for (const key of ["rows", "items", "entries", "results"]) {
    const value = input[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => isRecord(item));
    }
  }
  return null;
}

export function extractUmichHits(input: unknown): UmichHitLike[] {
  const direct = extractEmbeddedObjectArray(input);
  if (direct) return direct;

  if (isRecord(input) && Array.isArray(input.disciplines)) {
    const hits: UmichHitLike[] = [];
    const seen = new Set<string>();

    for (const bucket of input.disciplines) {
      if (!isRecord(bucket) || !Array.isArray(bucket.rows)) continue;

      for (const rawRow of bucket.rows) {
        if (!isRecord(rawRow)) continue;
        const title = readNullableString(rawRow.title) ?? readNullableString(rawRow.name);
        const url =
          readNullableString(rawRow.permalink) ?? readNullableString(rawRow.url) ?? readNullableString(rawRow.recordUrl);
        const dedupeKey = readNullableString(rawRow.recordId) ?? `${title ?? ""}::${url ?? ""}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        hits.push({
          ...rawRow,
          title,
          name: readNullableString(rawRow.name) ?? title,
          url,
        });
      }
    }

    return hits;
  }

  throw new Error("invalid umich-json: expected array, rows/items/entries/results, or disciplines[].rows[]");
}

export const hydrateUmichHitsWithVendorLanding = hydrateVendorLandingHits;

function resolveLandingUrl(entry: UmichHitLike): string | null {
  const explicit = readNullableString(entry.landingUrl) ?? readNullableString(entry.resolvedUrl);
  if (explicit) return explicit;

  const url = readNullableString(entry.url);
  const parsed = parseUrl(url);
  if (!parsed) return url;

  if (parsed.hostname === "proxy.lib.umich.edu") {
    const proxied = parsed.searchParams.get("qurl") ?? parsed.searchParams.get("url");
    if (proxied) return proxied;
  }

  return parsed.toString();
}

function resolveLandingHost(entry: UmichHitLike): string | null {
  const parsed = parseUrl(resolveLandingUrl(entry));
  return parsed?.host ?? null;
}

function tokenize(value: string): string[] {
  return normalizeGuideName(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function countTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  let score = 0;
  for (const token of tokenize(right)) {
    if (leftTokens.has(token)) score += 1;
  }
  return score;
}

function tokenDiceCoefficient(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) overlap += 1;
  }
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function scoreNameSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (left.includes(right) || right.includes(left)) return 500;

  const overlap = countTokenOverlap(left, right);
  const dice = tokenDiceCoefficient(left, right);

  if (overlap >= 3 && dice >= 0.75) return 300 + overlap * 10;
  return 0;
}

function extractStateDepartmentLocation(value: string | null): string | null {
  if (!value) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?):\s*Records of the U\.?S\.?\s+Department of State/i);
  if (!match?.[1]) return null;
  return normalizeGuideName(match[1]);
}

function hasCountryConflict(left: string | null, right: string | null): boolean {
  const leftCountry = extractStateDepartmentLocation(left);
  const rightCountry = extractStateDepartmentLocation(right);
  return Boolean(leftCountry && rightCountry && leftCountry !== rightCountry);
}

function scoreCatalogBackfillCandidate(guideName: string, title: string): number {
  const left = normalizeGuideName(guideName);
  const right = normalizeGuideName(title);
  if (!left || !right) return 0;
  if (hasCountryConflict(guideName, title)) return 0;
  if (left === right) return 1000;
  if (left.includes(right) || right.includes(left)) return 850;

  const overlap = countTokenOverlap(left, right);
  const dice = tokenDiceCoefficient(left, right);

  if (overlap >= 4 && dice >= 0.82) return 780;
  if (overlap >= 3 && dice >= 0.9) return 760;
  return 0;
}

function findCatalogBackfillCandidate(guideName: string, entries: UmichCatalogEntry[]): UmichCatalogEntry | null {
  let best: { entry: UmichCatalogEntry; score: number } | null = null;
  let secondBestScore = 0;

  for (const entry of entries) {
    const title = readNullableString(entry.title);
    if (!title) continue;
    const score = scoreCatalogBackfillCandidate(guideName, title);
    if (score <= 0) continue;

    if (!best || score > best.score) {
      secondBestScore = best?.score ?? secondBestScore;
      best = { entry, score };
      continue;
    }

    if (score > secondBestScore) secondBestScore = score;
  }

  if (!best) return null;
  if (best.score < 760) return null;
  if (best.score < 1000 && secondBestScore >= best.score - 40) return null;
  return best.entry;
}

function defaultDownloadModeForPlatform(platform: PlatformId): DownloadMode {
  switch (platform) {
    case "jstor":
    case "proquest":
      return "record_then_pdf";
    case "gale":
      return "page_range_dialog";
    case "hathitrust":
      return "direct_pdf";
    case "cnki":
      return "zotero_only";
    case "adammatthew":
    case "fallback":
    default:
      return "manual_only";
  }
}

function defaultStatusForPlatform(platform: PlatformId, matched: boolean): SupportStatus {
  if (!matched) return "manual_required";
  return "planned";
}

export function classifyUmichEntryKind(entry: { url?: string | null }): UmichEntryKind {
  const parsed = parseUrl(readNullableString(entry.url));
  const host = parsed?.hostname ?? "";
  const pathname = parsed?.pathname ?? "";

  if (host === "ddm.dnd.lib.umich.edu" && pathname.startsWith("/database/link/")) {
    return "umich_database_link";
  }
  if (host === "proxy.lib.umich.edu") {
    return "umich_proxy_login";
  }
  if (host === "apps.lib.umich.edu" || host === "search.lib.umich.edu") {
    return "umich_search";
  }
  return "direct_vendor";
}

export function resolvePlatformFromHostOrName(params: { host?: string | null; name?: string | null }): PlatformId {
  return resolvePlatformInfo(params).platform;
}

function resolvePlatformFromHost(host?: string | null): PlatformId {
  const haystack = String(host ?? "").toLowerCase().trim();
  if (haystack.includes("jstor")) return "jstor";
  if (haystack.includes("proquest") || haystack.includes("pqdt")) return "proquest";
  if (haystack.includes("gale") || haystack.includes("galegroup")) return "gale";
  if (haystack.includes("amdigital") || haystack.includes("adam matthew") || haystack.includes("amexplorer")) {
    return "adammatthew";
  }
  if (haystack.includes("hathitrust")) return "hathitrust";
  if (haystack.includes("cnki") || haystack.includes("中国知网")) return "cnki";
  return "fallback";
}

function resolvePlatformFromName(name?: string | null): PlatformId {
  const haystack = normalizeGuideName(String(name ?? ""));
  const words = new Set(haystack.split(/\s+/).filter(Boolean));
  if (words.has("jstor")) return "jstor";
  if (words.has("proquest") || words.has("pqdt")) return "proquest";
  if (words.has("gale") || words.has("galegroup")) return "gale";
  if (words.has("amd") || words.has("amdigital") || haystack.includes("adam matthew") || words.has("amexplorer")) {
    return "adammatthew";
  }
  if (words.has("hathitrust")) return "hathitrust";
  if (haystack.includes("cnki") || haystack.includes("中国知网")) return "cnki";
  return "fallback";
}

function resolvePlatformInfo(params: { host?: string | null; name?: string | null }): {
  platform: PlatformId;
  source: PlatformSource;
} {
  const hostPlatform = resolvePlatformFromHost(params.host);
  if (hostPlatform !== "fallback") return { platform: hostPlatform, source: "host" };

  const namePlatform = resolvePlatformFromName(params.name);
  if (namePlatform !== "fallback") return { platform: namePlatform, source: "name" };

  return { platform: "fallback", source: "fallback" };
}

export function matchGuideEntriesToUmichHits(
  guideEntries: GuideEntryLike[],
  umichHits: UmichHitLike[],
): PlatformMatrixRow[] {
  const splitGuideEntries = splitMergedGuideEntries(guideEntries ?? []);
  const normalizedHits = (umichHits ?? []).map((hit) => {
    const umichHit = readUmichName(hit);
    const landingUrl = resolveLandingUrl(hit);
    const landingHost = resolveLandingHost(hit);
    const platformInfo = resolvePlatformInfo({
      host: landingHost,
      name: umichHit,
    });
    return {
      raw: hit,
      umichHit,
      landingUrl,
      landingHost,
      platform: platformInfo.platform,
      platformSource: platformInfo.source,
      normalizedName: normalizeGuideName(umichHit ?? ""),
    };
  });
  const usedHitIndexes = new Set<number>();

  return splitGuideEntries.map((entry) => {
    const guideName = readNullableString(entry.guideName) ?? readNullableString(entry.name) ?? "";
    const guideCode = readNullableString(entry.guideCode) ?? readNullableString(entry.code);
    const guideNotes = readNullableString(entry.notes);
    const normalizedGuide = normalizeGuideName(guideName);
    const guidePlatform = resolvePlatformFromHostOrName({ name: guideName });

    const scoredHits = normalizedHits
      .map((hit, index) => {
        let score = scoreNameSimilarity(normalizedGuide, hit.normalizedName);
        if (score > 0 && guidePlatform !== "fallback" && hit.platform === guidePlatform) score += 50;
        if (usedHitIndexes.has(index)) score -= 10000;
        return { hit, index, score };
      })
      .sort((left, right) => right.score - left.score);

    let matchedHit = scoredHits.find((candidate) => candidate.score > 0)?.hit ?? null;
    let matchedHitIndex = scoredHits.find((candidate) => candidate.score > 0)?.index ?? null;
    if (!matchedHit && guidePlatform !== "fallback") {
      const samePlatformHits = normalizedHits
        .map((hit, index) => ({ hit, index }))
        .filter(
          ({ hit, index }) =>
            hit.platform === guidePlatform && hit.platformSource === "host" && !usedHitIndexes.has(index),
        );
      if (samePlatformHits.length === 1) {
        matchedHit = samePlatformHits[0]?.hit ?? null;
        matchedHitIndex = samePlatformHits[0]?.index ?? null;
      }
    }
    if (!matchedHit) {
      const hostSignaledHits = normalizedHits
        .map((hit, index) => ({ hit, index }))
        .filter(
          ({ hit, index }) =>
            hit.platformSource === "host" && hit.platform !== "fallback" && !usedHitIndexes.has(index),
        );
      if (hostSignaledHits.length === 1) {
        matchedHit = hostSignaledHits[0]?.hit ?? null;
        matchedHitIndex = hostSignaledHits[0]?.index ?? null;
      }
    }

    const platform = matchedHit?.platform ?? guidePlatform;
    if (matchedHitIndex != null) usedHitIndexes.add(matchedHitIndex);
    return parsePlatformMatrixRow({
      guideName,
      guideCode,
      umichHit: matchedHit?.umichHit ?? null,
      landingUrl: matchedHit?.landingUrl ?? null,
      landingHost: matchedHit?.landingHost ?? null,
      platform,
      downloadMode: defaultDownloadModeForPlatform(platform),
      status: defaultStatusForPlatform(platform, Boolean(matchedHit)),
      notes: guideNotes,
    });
  });
}

export type BackfillPlatformMatrixRowsDeps = {
  resolveHit?: (hit: UmichHitLike) => Promise<UmichHitLike>;
};

export async function backfillPlatformMatrixRowsFromCatalog(
  rows: PlatformMatrixRow[],
  catalogEntries: UmichCatalogEntry[],
  deps: BackfillPlatformMatrixRowsDeps = {},
): Promise<PlatformMatrixRow[]> {
  const out: PlatformMatrixRow[] = [];

  for (const row of rows) {
    if (row.status !== "manual_required" || row.umichHit) {
      out.push(row);
      continue;
    }

    const candidate = findCatalogBackfillCandidate(row.guideName, catalogEntries);
    if (!candidate) {
      out.push(row);
      continue;
    }

    const candidateTitle = readNullableString(candidate.title);
    const candidateDdmLink = readNullableString(candidate.ddmLink);
    const candidatePlatformHint = resolveCatalogPlatformHint(candidate);
    const hasBackfillSignal = Boolean(
      candidateDdmLink ||
        candidatePlatformHint !== "fallback" ||
        readNullableString(candidate.platformLabel) ||
        readNullableString(candidate.vendorHint) ||
        readNullableString(candidate.companyGuess),
    );

    if (!candidateTitle || !hasBackfillSignal) {
      out.push(row);
      continue;
    }

    let resolvedHit: UmichHitLike = {
      title: candidateTitle,
      name: candidateTitle,
      url: candidateDdmLink,
      notes: row.notes,
    };

    if (candidateDdmLink) {
      resolvedHit = deps.resolveHit
        ? await deps.resolveHit(resolvedHit)
        : await resolveVendorLandingForHit(resolvedHit);
    }

    const landingUrl = resolveLandingUrl(resolvedHit) ?? candidateDdmLink;
    const landingHost = resolveLandingHost(resolvedHit);
    const platformFromLanding = resolvePlatformFromHostOrName({
      host: landingHost,
      name: candidateTitle,
    });
    const platform =
      platformFromLanding !== "fallback"
        ? platformFromLanding
        : candidatePlatformHint !== "fallback"
          ? candidatePlatformHint
          : row.platform;

    out.push(
      parsePlatformMatrixRow({
        guideName: row.guideName,
        guideCode: row.guideCode,
        umichHit: candidateTitle,
        landingUrl,
        landingHost,
        platform,
        downloadMode: defaultDownloadModeForPlatform(platform),
        status: defaultStatusForPlatform(platform, true),
        notes: row.notes,
      }),
    );
  }

  return out;
}

function tsvCell(value: string | null): string {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

export function renderPlatformMatrixTsv(rows: PlatformMatrixRow[]): string {
  const header = [
    "guideName",
    "guideCode",
    "umichHit",
    "landingUrl",
    "landingHost",
    "platform",
    "downloadMode",
    "status",
    "notes",
  ];
  const lines = [header.join("\t")];
  for (const row of rows) {
    lines.push(
      [
        row.guideName,
        row.guideCode,
        row.umichHit,
        row.landingUrl,
        row.landingHost,
        row.platform,
        row.downloadMode,
        row.status,
        row.notes,
      ]
        .map(tsvCell)
        .join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderPlatformMatrixMarkdown(rows: PlatformMatrixRow[]): string {
  const lines: string[] = [];
  lines.push("# UMich Platform Matrix");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`总行数：${rows.length}`);
  lines.push("");
  lines.push("| guideName | guideCode | umichHit | landingHost | platform | downloadMode | status |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.guideName} | ${row.guideCode ?? ""} | ${row.umichHit ?? ""} | ${row.landingHost ?? ""} | ${row.platform} | ${row.downloadMode} | ${row.status} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
