import type { PlatformId } from "./contract.js";
import { normalizeGuideName, normalizeOcrArtifacts } from "./guide-cleaning.js";

export type UmichCatalogEntry = {
  title: string;
  uid: string | null;
  ddmLink: string | null;
  accessType: string | null;
  coverage: string | null;
  platformLabel: string | null;
  vendorHint: string | null;
  companyGuess: string | null;
  description: string | null;
  historyFacets: string | null;
};

function normalizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function readNullableCell(row: Record<string, string>, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

export function parseUmichCatalogCsv(text: string): UmichCatalogEntry[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map(normalizeHeader);

  return dataRows.map((cells) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index] ?? `column_${index}`] = cells[index] ?? "";
    }

    return {
      title: readNullableCell(record, "title") ?? "",
      uid: readNullableCell(record, "uid"),
      ddmLink: readNullableCell(record, "ddm_link"),
      accessType: readNullableCell(record, "access_type"),
      coverage: readNullableCell(record, "coverage"),
      platformLabel: readNullableCell(record, "platform"),
      vendorHint: readNullableCell(record, "vendor_hint"),
      companyGuess: readNullableCell(record, "company_guess"),
      description: readNullableCell(record, "description"),
      historyFacets: readNullableCell(record, "history_facets"),
    };
  });
}

export function resolveCatalogPlatformHint(entry: UmichCatalogEntry): PlatformId {
  const haystack = normalizeGuideName(
    [
      entry.title,
      entry.platformLabel,
      entry.vendorHint,
      entry.companyGuess,
      normalizeOcrArtifacts(entry.description ?? ""),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const words = new Set(haystack.split(/\s+/).filter(Boolean));

  if (words.has("jstor") || haystack.includes("ithaka")) return "jstor";
  if (
    words.has("proquest") ||
    words.has("pqdt") ||
    haystack.includes("clarivate") ||
    haystack.includes("historical newspapers")
  ) {
    return "proquest";
  }
  if (
    words.has("gale") ||
    words.has("galegroup") ||
    haystack.includes("cengage") ||
    haystack.includes("archives unbound")
  ) {
    return "gale";
  }
  if (words.has("amd") || haystack.includes("adam matthew") || haystack.includes("amdigital")) {
    return "adammatthew";
  }
  if (words.has("hathitrust")) return "hathitrust";
  if (words.has("cnki") || haystack.includes("中国知网")) return "cnki";
  return "fallback";
}
