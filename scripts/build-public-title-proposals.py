#!/usr/bin/env python3
"""Write audited, read-only title-page stage and section proposals."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_title_proposals import build_public_title_proposals  # noqa: E402

DEFAULT_MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pages-per-source", type=int, default=3)
    parser.add_argument("--max-proposals", type=int, default=800)
    parser.add_argument("--ocr-selections", type=Path,
                        help="JSON list of explicitly selected OCR_REQUIRED title pages")
    parser.add_argument("--ocr-cache-root", type=Path,
                        help="existing read-only OCR cache; requires --ocr-selections")
    args = parser.parse_args()
    try:
        if (args.ocr_selections is None) != (args.ocr_cache_root is None):
            raise ValueError("--ocr-selections and --ocr-cache-root must be paired")
        selections = None
        if args.ocr_selections is not None:
            if args.ocr_selections.stat().st_size > 64 * 1024:
                raise ValueError("OCR selections JSON exceeds 64 KiB")
            selections = json.loads(args.ocr_selections.read_text(encoding="utf-8"))
        report = build_public_title_proposals(
            args.manifest, args.index, args.audit,
            pages_per_source=args.pages_per_source, max_proposals=args.max_proposals,
            ocr_selections=selections, ocr_cache_root=args.ocr_cache_root,
        )
    except (OSError, ValueError, sqlite3.Error) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1
    content = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                     prefix=args.output.name + ".", suffix=".tmp",
                                     delete=False) as target:
        temporary = Path(target.name)
        try:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, args.output)
    finally:
        temporary.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
