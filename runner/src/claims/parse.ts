import {
  claimAnchorCloseTag,
  claimAnchorOpenPrefix,
  type ClaimAnchor,
  type ClaimAnchorParseErrorCode,
  type ClaimEvidenceRef,
} from "./contract.js";

type OpenTagParsed = {
  claimId: string;
  kind: string;
  evidenceRefs: ClaimEvidenceRef[];
};

function computeLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < safeOffset; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }
  return { line, column };
}

export class ClaimAnchorParseError extends Error {
  code: ClaimAnchorParseErrorCode;
  offset: number;
  line: number;
  column: number;

  constructor(params: { code: ClaimAnchorParseErrorCode; offset: number; line: number; column: number; message: string }) {
    super(params.message);
    this.name = "ClaimAnchorParseError";
    this.code = params.code;
    this.offset = params.offset;
    this.line = params.line;
    this.column = params.column;
  }
}

function createParseError(text: string, code: ClaimAnchorParseErrorCode, offset: number, detail: string): ClaimAnchorParseError {
  const { line, column } = computeLineColumn(text, offset);
  return new ClaimAnchorParseError({
    code,
    offset,
    line,
    column,
    message: `${detail} at ${line}:${column}`,
  });
}

function parseEvidenceRefs(raw: string, text: string, offset: number): ClaimEvidenceRef[] {
  const refs = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (refs.length === 0) {
    throw createParseError(text, "missing_evidence_refs", offset, "claim anchor missing evidence refs");
  }

  return refs.map((ref) => {
    const idx = ref.indexOf(":");
    if (idx <= 0 || idx === ref.length - 1) {
      throw createParseError(text, "invalid_evidence_ref", offset, `invalid evidence ref: ${ref}`);
    }
    const cardId = ref.slice(0, idx).trim();
    const evidenceId = ref.slice(idx + 1).trim();
    if (!cardId || !evidenceId) {
      throw createParseError(text, "invalid_evidence_ref", offset, `invalid evidence ref: ${ref}`);
    }
    return { cardId, evidenceId, raw: ref };
  });
}

function parseOpenTag(openTag: string, text: string, offset: number): OpenTagParsed {
  if (!openTag.startsWith(claimAnchorOpenPrefix) || !openTag.endsWith("〕")) {
    throw createParseError(text, "invalid_open_tag", offset, "invalid claim open tag");
  }

  const body = openTag.slice(claimAnchorOpenPrefix.length, -1);
  const segments = body.split("|");
  const claimId = segments.shift()?.trim() ?? "";
  if (!claimId) {
    throw createParseError(text, "invalid_open_tag", offset, "claim anchor missing claimId");
  }

  let kind = "";
  let evidenceRefs: ClaimEvidenceRef[] = [];

  for (const segment of segments) {
    const idx = segment.indexOf("=");
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (key === "kind") kind = value;
    if (key === "ev") evidenceRefs = parseEvidenceRefs(value, text, offset);
  }

  if (!kind) {
    throw createParseError(text, "missing_kind", offset, "claim anchor missing kind");
  }
  if (evidenceRefs.length === 0) {
    throw createParseError(text, "missing_evidence_refs", offset, "claim anchor missing ev");
  }

  return { claimId, kind, evidenceRefs };
}

export function parseClaimAnchors(text: string): ClaimAnchor[] {
  const anchors: ClaimAnchor[] = [];
  let cursor = 0;
  let active:
    | (OpenTagParsed & {
        openTag: string;
        openTagStart: number;
        openTagEnd: number;
        textStart: number;
      })
    | null = null;

  while (cursor < text.length) {
    const nextOpen = text.indexOf(claimAnchorOpenPrefix, cursor);
    const nextClose = text.indexOf(claimAnchorCloseTag, cursor);

    if (!active) {
      if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
        throw createParseError(text, "unexpected_close", nextClose, "unexpected claim close tag");
      }
      if (nextOpen === -1) break;

      const tagEnd = text.indexOf("〕", nextOpen);
      if (tagEnd === -1) {
        throw createParseError(text, "invalid_open_tag", nextOpen, "unterminated claim open tag");
      }

      const openTag = text.slice(nextOpen, tagEnd + 1);
      const parsed = parseOpenTag(openTag, text, nextOpen);
      active = {
        ...parsed,
        openTag,
        openTagStart: nextOpen,
        openTagEnd: tagEnd + 1,
        textStart: tagEnd + 1,
      };
      cursor = tagEnd + 1;
      continue;
    }

    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      throw createParseError(text, "nested_claim", nextOpen, "nested claim anchor is not allowed");
    }
    if (nextClose === -1) {
      throw createParseError(text, "unclosed_claim", active.openTagStart, "unclosed claim anchor");
    }

    const closeTagStart = nextClose;
    const closeTagEnd = nextClose + claimAnchorCloseTag.length;
    anchors.push({
      claimId: active.claimId,
      kind: active.kind,
      evidenceRefs: active.evidenceRefs,
      openTag: active.openTag,
      closeTag: claimAnchorCloseTag,
      openTagStart: active.openTagStart,
      openTagEnd: active.openTagEnd,
      textStart: active.textStart,
      textEnd: closeTagStart,
      closeTagStart,
      closeTagEnd,
      spanText: text.slice(active.textStart, closeTagStart),
    });
    active = null;
    cursor = closeTagEnd;
  }

  if (active) {
    throw createParseError(text, "unclosed_claim", active.openTagStart, "unclosed claim anchor");
  }

  return anchors;
}

