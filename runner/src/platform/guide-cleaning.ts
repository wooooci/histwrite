export type GuideEntryLike = {
  guideName?: string | null;
  guideCode?: string | null;
  name?: string | null;
  code?: string | null;
  raw?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

const OCR_ARTIFACTS: Array<[pattern: RegExp, replacement: string]> = [
  [/ꎬ/g, ","],
  [/􀆰/g, "."],
  [/􀆳/g, "'"],
];

const FULL_GUIDE_CODE_PATTERN = /\b([A-Z](?:\d+(?:\.\d+)?)?\s*\/\s*[A-Z]\d{2,3})\b/g;
const LEGACY_GUIDE_CODE_PATTERN = /\b([A-Z]\d{3})\b/g;

function readNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readGuideName(entry: GuideEntryLike): string | null {
  return readNullableString(entry.guideName) ?? readNullableString(entry.name) ?? readNullableString(entry.raw);
}

function readGuideCode(entry: GuideEntryLike): string | null {
  return readNullableString(entry.guideCode) ?? readNullableString(entry.code);
}

function normalizeGuideCode(value: string): string {
  return normalizeOcrArtifacts(value)
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "")
    .trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripGuideCodeFromSegment(segment: string, guideCode: string): string {
  const normalizedSegment = normalizeOcrArtifacts(segment).trim();
  const normalizedCode = normalizeGuideCode(guideCode);
  const codePattern = escapeForRegex(normalizedCode).replace(/\\\//g, "\\s*\\/\\s*");
  return normalizedSegment
    .replace(new RegExp(`^${codePattern}\\s*`, "i"), "")
    .replace(new RegExp(`\\s*${codePattern}$`, "i"), "")
    .trim();
}

export function normalizeOcrArtifacts(value: string): string {
  let next = String(value ?? "");
  for (const [pattern, replacement] of OCR_ARTIFACTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function normalizeGuideName(value: string): string {
  return normalizeOcrArtifacts(value)
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/['".,/:;()[\]{}|_+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitMergedGuideEntries(entries: GuideEntryLike[]): GuideEntryLike[] {
  const out: GuideEntryLike[] = [];

  for (const entry of entries ?? []) {
    const raw = normalizeOcrArtifacts(readNullableString(entry.raw) ?? readGuideName(entry) ?? "");
    const fullCodeMatches = [...raw.matchAll(FULL_GUIDE_CODE_PATTERN)];

    if (fullCodeMatches.length >= 2) {
      let segmentStart = 0;
      for (let index = 0; index < fullCodeMatches.length; index += 1) {
        const current = fullCodeMatches[index];
        const codeText = current[1] ?? current[0] ?? "";
        const guideCode = normalizeGuideCode(codeText);
        const codeEnd = (current.index ?? 0) + current[0].length;
        const segment = raw.slice(segmentStart, codeEnd).trim();
        segmentStart = codeEnd;
        const guideName = stripGuideCodeFromSegment(segment, guideCode) || normalizeOcrArtifacts(segment).trim();
        out.push({
          ...entry,
          raw: segment,
          guideCode: guideCode || null,
          code: guideCode || null,
          guideName,
          name: guideName,
        });
      }
      continue;
    }

    const matches = fullCodeMatches.length === 0 ? [...raw.matchAll(LEGACY_GUIDE_CODE_PATTERN)] : [];

    if (matches.length >= 2) {
      for (let index = 0; index < matches.length; index += 1) {
        const current = matches[index];
        const next = matches[index + 1];
        const segment = raw.slice(current.index ?? 0, next?.index ?? raw.length).trim();
        const guideCode = current[1] ?? null;
        const guideName = normalizeOcrArtifacts(segment.replace(/^\b[A-Z]\d{3}\b\s*/, "")).trim();
        out.push({
          ...entry,
          raw: segment,
          guideCode,
          code: guideCode,
          guideName,
          name: guideName,
        });
      }
      continue;
    }

    const guideCode =
      (fullCodeMatches[0]?.[1] ? normalizeGuideCode(fullCodeMatches[0][1]) : null) ??
      matches[0]?.[1] ??
      (readGuideCode(entry) ? normalizeGuideCode(readGuideCode(entry) ?? "") : null);
    const explicitGuideName = readNullableString(entry.guideName) ?? readNullableString(entry.name);
    const guideName =
      explicitGuideName ??
      (guideCode ? stripGuideCodeFromSegment(raw, guideCode) : null) ??
      readGuideName(entry) ??
      normalizeOcrArtifacts(raw.replace(/^\b[A-Z]\d{3}\b\s*/, "")).trim() ??
      raw.trim();

    out.push({
      ...entry,
      raw: raw || null,
      guideCode: guideCode ?? null,
      code: guideCode ?? null,
      guideName: guideName || null,
      name: guideName || null,
    });
  }

  return out;
}
