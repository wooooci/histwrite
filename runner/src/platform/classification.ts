import type { PlatformId, PlatformMatrixRow } from "./contract.js";
import { normalizeGuideName, normalizeOcrArtifacts } from "./guide-cleaning.js";
import { resolveCatalogPlatformHint, type UmichCatalogEntry } from "./umich-csv.js";

export const platformResolutionCategories = [
  "matched_high_confidence",
  "matched_needs_review",
  "csv_vendor_hint",
  "public_open_access",
  "umich_direct_search",
  "manual_backlog",
] as const;

export type PlatformResolutionCategory = (typeof platformResolutionCategories)[number];

export type PlatformResolutionNextAction =
  | "keep_existing_match"
  | "review_existing_match"
  | "reuse_catalog_ddm_link"
  | "public_resolver"
  | "run_umich_database_search"
  | "manual_research";

export type PlatformResolutionReviewReason =
  | "low_name_overlap"
  | "country_conflict"
  | "catalog_open_access"
  | "catalog_vendor_hint"
  | "direct_search_needed"
  | "insufficient_signal";

export type PlatformResolutionClassificationRow = PlatformMatrixRow & {
  category: PlatformResolutionCategory;
  nextAction: PlatformResolutionNextAction;
  reviewReasons: PlatformResolutionReviewReason[];
  similarityScore: number | null;
  csvTitle: string | null;
  csvDdmLink: string | null;
  csvAccessType: string | null;
  csvPlatformLabel: string | null;
  csvVendorHint: string | null;
  csvCompanyGuess: string | null;
  csvPlatformHint: PlatformId | null;
};

type CatalogCandidate = {
  entry: UmichCatalogEntry;
  score: number;
};

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

function extractStateDepartmentLocation(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeOcrArtifacts(value).replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?):\s*Records of the U\.?S\.?\s+Department of State/i);
  if (!match?.[1]) return null;
  return normalizeGuideName(match[1]);
}

function hasCountryConflict(left: string | null, right: string | null): boolean {
  const leftCountry = extractStateDepartmentLocation(left);
  const rightCountry = extractStateDepartmentLocation(right);
  return Boolean(leftCountry && rightCountry && leftCountry !== rightCountry);
}

function isOpenAccess(entry: UmichCatalogEntry | null): boolean {
  return String(entry?.accessType ?? "")
    .toLowerCase()
    .includes("open access");
}

function scoreCatalogCandidate(guideName: string, entry: UmichCatalogEntry): number {
  const left = normalizeGuideName(guideName);
  const right = normalizeGuideName(entry.title);
  if (!left || !right) return 0;
  if (hasCountryConflict(guideName, entry.title)) return 0;
  if (left === right) return 1000;
  if (left.includes(right) || right.includes(left)) return 850;

  const overlap = countTokenOverlap(left, right);
  const dice = tokenDiceCoefficient(left, right);

  if (overlap >= 4 && dice >= 0.82) return 780;
  if (overlap >= 3 && dice >= 0.9) return 760;
  return 0;
}

function findBestCatalogCandidate(guideName: string, entries: UmichCatalogEntry[]): CatalogCandidate | null {
  let best: CatalogCandidate | null = null;
  let secondBestScore = 0;

  for (const entry of entries) {
    const score = scoreCatalogCandidate(guideName, entry);
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
  return best;
}

function looksSearchable(guideName: string): boolean {
  const normalized = normalizeGuideName(guideName);
  if (normalized.length >= 8) return true;
  return normalized.replace(/\s+/g, "").length >= 6;
}

function buildRow(
  row: PlatformMatrixRow,
  input: {
    category: PlatformResolutionCategory;
    nextAction: PlatformResolutionNextAction;
    reviewReasons?: PlatformResolutionReviewReason[];
    similarityScore?: number | null;
    candidate?: CatalogCandidate | null;
  },
): PlatformResolutionClassificationRow {
  const candidate = input.candidate?.entry ?? null;

  return {
    ...row,
    category: input.category,
    nextAction: input.nextAction,
    reviewReasons: input.reviewReasons ?? [],
    similarityScore: input.similarityScore ?? null,
    csvTitle: candidate?.title ?? null,
    csvDdmLink: candidate?.ddmLink ?? null,
    csvAccessType: candidate?.accessType ?? null,
    csvPlatformLabel: candidate?.platformLabel ?? null,
    csvVendorHint: candidate?.vendorHint ?? null,
    csvCompanyGuess: candidate?.companyGuess ?? null,
    csvPlatformHint: candidate ? resolveCatalogPlatformHint(candidate) : null,
  };
}

export function classifyPlatformResolutionRows(
  rows: PlatformMatrixRow[],
  catalogEntries: UmichCatalogEntry[],
): PlatformResolutionClassificationRow[] {
  return rows.map((row) => {
    const candidate = findBestCatalogCandidate(row.guideName, catalogEntries);

    if (row.status !== "manual_required") {
      const similarityScore = row.umichHit ? tokenDiceCoefficient(row.guideName, row.umichHit) : null;
      const reviewReasons: PlatformResolutionReviewReason[] = [];
      if (hasCountryConflict(row.guideName, row.umichHit)) reviewReasons.push("country_conflict");
      if ((similarityScore ?? 1) < 0.45) reviewReasons.push("low_name_overlap");

      if (reviewReasons.length > 0) {
        return buildRow(row, {
          category: "matched_needs_review",
          nextAction: "review_existing_match",
          reviewReasons,
          similarityScore,
          candidate,
        });
      }

      if (candidate && isOpenAccess(candidate.entry)) {
        return buildRow(row, {
          category: "public_open_access",
          nextAction: "public_resolver",
          reviewReasons: ["catalog_open_access"],
          similarityScore: candidate.score / 1000,
          candidate,
        });
      }

      return buildRow(row, {
        category: "matched_high_confidence",
        nextAction: "keep_existing_match",
        similarityScore,
        candidate,
      });
    }

    if (candidate && isOpenAccess(candidate.entry)) {
      return buildRow(row, {
        category: "public_open_access",
        nextAction: "public_resolver",
        reviewReasons: ["catalog_open_access"],
        similarityScore: candidate.score / 1000,
        candidate,
      });
    }

    const csvPlatformHint = candidate ? resolveCatalogPlatformHint(candidate.entry) : "fallback";
    const hasVendorHint = Boolean(
      candidate &&
        (candidate.entry.ddmLink ||
          csvPlatformHint !== "fallback" ||
          candidate.entry.platformLabel ||
          candidate.entry.vendorHint ||
          candidate.entry.companyGuess),
    );

    if (candidate && hasVendorHint) {
      return buildRow(row, {
        category: "csv_vendor_hint",
        nextAction: "reuse_catalog_ddm_link",
        reviewReasons: ["catalog_vendor_hint"],
        similarityScore: candidate.score / 1000,
        candidate,
      });
    }

    if (looksSearchable(row.guideName)) {
      return buildRow(row, {
        category: "umich_direct_search",
        nextAction: "run_umich_database_search",
        reviewReasons: ["direct_search_needed"],
      });
    }

    return buildRow(row, {
      category: "manual_backlog",
      nextAction: "manual_research",
      reviewReasons: ["insufficient_signal"],
    });
  });
}

export function summarizePlatformResolutionClassification(
  rows: PlatformResolutionClassificationRow[],
): Record<PlatformResolutionCategory, number> {
  const summary = Object.fromEntries(
    platformResolutionCategories.map((category) => [category, 0]),
  ) as Record<PlatformResolutionCategory, number>;

  for (const row of rows) {
    summary[row.category] += 1;
  }

  return summary;
}

function tsvCell(value: string | null): string {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

export function renderPlatformResolutionClassificationTsv(rows: PlatformResolutionClassificationRow[]): string {
  const header = [
    "category",
    "nextAction",
    "guideName",
    "guideCode",
    "platform",
    "status",
    "umichHit",
    "landingHost",
    "reviewReasons",
    "similarityScore",
    "csvTitle",
    "csvDdmLink",
    "csvAccessType",
    "csvPlatformLabel",
    "csvVendorHint",
    "csvCompanyGuess",
    "csvPlatformHint",
  ];
  const lines = [header.join("\t")];

  for (const row of rows) {
    lines.push(
      [
        row.category,
        row.nextAction,
        row.guideName,
        row.guideCode,
        row.platform,
        row.status,
        row.umichHit,
        row.landingHost,
        row.reviewReasons.join(","),
        row.similarityScore == null ? null : row.similarityScore.toFixed(2),
        row.csvTitle,
        row.csvDdmLink,
        row.csvAccessType,
        row.csvPlatformLabel,
        row.csvVendorHint,
        row.csvCompanyGuess,
        row.csvPlatformHint,
      ]
        .map(tsvCell)
        .join("\t"),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderPlatformResolutionClassificationMarkdown(rows: PlatformResolutionClassificationRow[]): string {
  const summary = summarizePlatformResolutionClassification(rows);
  const lines: string[] = [];
  lines.push("# UMich Platform Resolution Classification");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  lines.push(`总行数：${rows.length}`);
  lines.push("");
  lines.push("## 分类汇总");
  lines.push("");
  for (const category of platformResolutionCategories) {
    lines.push(`- ${category}: ${summary[category]}`);
  }
  lines.push("");
  lines.push("| category | nextAction | guideName | platform | status | umichHit | csvTitle |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.category} | ${row.nextAction} | ${row.guideName} | ${row.platform} | ${row.status} | ${row.umichHit ?? ""} | ${row.csvTitle ?? ""} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
