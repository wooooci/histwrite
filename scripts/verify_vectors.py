#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path


def normalize_v1(text: str) -> str:
    # v4.1 normalizeV1: deterministic, minimal, and mapping-friendly.
    # - \r\n and \r -> \n
    # - remove BOM (U+FEFF)
    # - NBSP (U+00A0) -> space
    text = text.replace("\ufeff", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    return text


def find_all_occurrences(text: str, needle: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start = 0
    while start <= len(text):
        i = text.find(needle, start)
        if i < 0:
            break
        out.append((i, i + len(needle)))
        start = i + 1  # allow overlaps
    return out


def matches_context(text: str, start: int, end: int, prefix: str | None, suffix: str | None) -> bool:
    if prefix:
        if start - len(prefix) < 0:
            return False
        if text[start - len(prefix) : start] != prefix:
            return False
    if suffix:
        if end + len(suffix) > len(text):
            return False
        if text[end : end + len(suffix)] != suffix:
            return False
    return True


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_vectors = repo_root / "runner" / "src" / "selector" / "vectors.v1.json"

    ap = argparse.ArgumentParser(
        description="Verify Histwrite selector contract vectors v1 (quote anchoring only)."
    )
    ap.add_argument("--file", type=Path, default=default_vectors, help="Path to vectors.v1.json")
    args = ap.parse_args()

    data = json.loads(args.file.read_text("utf-8"))
    cases = data.get("cases", [])
    if not isinstance(cases, list) or len(cases) == 0:
        print("No cases found in vectors file.", file=sys.stderr)
        return 2

    failures = 0
    for case in cases:
        case_id = case.get("id", "<missing id>")
        raw_b64 = case.get("rawTextB64", "")
        selector = case.get("selector", {}) or {}
        quote = selector.get("quote", {}) or {}
        expect = (case.get("expect", {}) or {}).get("method")

        try:
            raw_text = base64.b64decode(raw_b64).decode("utf-8")
        except Exception as e:
            failures += 1
            print(f"[FAIL] {case_id}: invalid rawTextB64: {e}", file=sys.stderr)
            continue

        layer = quote.get("layer", "normText")
        exact = quote.get("exact", "")
        prefix = quote.get("prefix")
        suffix = quote.get("suffix")

        if not isinstance(exact, str) or exact == "":
            failures += 1
            print(f"[FAIL] {case_id}: invalid quote.exact", file=sys.stderr)
            continue

        if layer == "normText":
            text = normalize_v1(raw_text)
        elif layer == "rawText":
            text = raw_text
        else:
            failures += 1
            print(f"[FAIL] {case_id}: unsupported quote.layer in python verifier: {layer}", file=sys.stderr)
            continue

        spans = [
            (s, e)
            for (s, e) in find_all_occurrences(text, exact)
            if matches_context(text, s, e, prefix, suffix)
        ]

        # Python verifier focuses on quote anchoring only.
        expected_kind = expect
        if expected_kind == "position_verified":
            expected_kind = "quote_anchored"

        ok = False
        if expected_kind == "unresolvable":
            ok = len(spans) == 0
        elif expected_kind == "quote_anchored":
            ok = len(spans) == 1
        elif expected_kind == "quote_anchored_ambiguous":
            ok = len(spans) > 1
        else:
            failures += 1
            print(f"[FAIL] {case_id}: unknown expect.method: {expect}", file=sys.stderr)
            continue

        if not ok:
            failures += 1
            got = "unresolvable" if len(spans) == 0 else ("quote_anchored" if len(spans) == 1 else "quote_anchored_ambiguous")
            print(
                f"[FAIL] {case_id}: expected {expected_kind}, got {got} (matches={len(spans)})",
                file=sys.stderr,
            )

    if failures:
        print(f"Vectors verification failed: {failures} failure(s).", file=sys.stderr)
        return 1

    print(f"OK: {len(cases)} vector case(s) verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

