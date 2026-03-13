// v4.1 normalizeV1: deterministic, minimal, and mapping-friendly.
//
// Allowed transformations (fixed v1):
// - \r\n and \r -> \n
// - remove BOM (U+FEFF)
// - NBSP (U+00A0) -> space
//
// Explicitly NOT performed:
// - Unicode normalization (NFC/NFKC/etc.)
export function normalizeV1(input: string): string {
  let out = input;
  // Remove BOM (U+FEFF). Some sources may contain multiple.
  if (out.includes("\uFEFF")) out = out.replaceAll("\uFEFF", "");

  // Normalize newlines: CRLF / CR -> LF
  if (out.includes("\r")) out = out.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  // Normalize NBSP to regular space.
  if (out.includes("\u00A0")) out = out.replaceAll("\u00A0", " ");

  return out;
}

