#!/usr/bin/env python3
"""Write bounded family review candidates from a completed public PDF index."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.public_family_batch import (  # noqa: E402
    FAMILIES, PublicFamilyBatchError, discover_public_family_batch,
)

DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--family", choices=sorted(FAMILIES), default="DECREASE")
    parser.add_argument("--source-id", action="append", help="repeat; supply with --term")
    parser.add_argument("--term", action="append", help="FTS word or terminal prefix such as толщин*")
    parser.add_argument("--max-pages", type=int, default=40)
    parser.add_argument("--max-blocks-per-page", type=int, default=4)
    parser.add_argument("--max-ocr-pages", type=int, default=100)
    parser.add_argument("--output", type=Path, help="write JSON to existing directory; stdout if absent")
    args = parser.parse_args()
    try:
        report = discover_public_family_batch(
            args.manifest, args.index, family=args.family,
            source_ids=args.source_id, terms=args.term,
            max_pages=args.max_pages, max_blocks_per_page=args.max_blocks_per_page,
            max_ocr_pages=args.max_ocr_pages,
        )
        payload = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.output is None:
            print(payload, end="")
        else:
            if not args.output.parent.is_dir() or args.output.exists():
                raise PublicFamilyBatchError("output parent must exist and output must be new")
            with args.output.open("x", encoding="utf-8") as destination:
                destination.write(payload)
            print(json.dumps({"status": "WRITTEN", "output": str(args.output),
                              "textCandidates": len(report["candidates"]),
                              "ocrQueue": len(report["ocrQueue"]),
                              "truncated": report["truncated"]}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, PublicFamilyBatchError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
