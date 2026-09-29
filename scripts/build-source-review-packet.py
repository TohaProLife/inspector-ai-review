#!/usr/bin/env python3
"""Write SHA-pinned review queue for ambiguous public PD/RD source titles."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.source_review_packet import (  # noqa: E402
    TITLE_SHA256, build_source_review_packet,
)

DEFAULT_MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--titles", type=Path, required=True)
    parser.add_argument("--title-sha256", default=TITLE_SHA256,
                        help="expected SHA-256 of the audited title report")
    parser.add_argument("--output", type=Path, required=True)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--target-sources", type=int, default=25)
    selection.add_argument("--all-sources", action="store_true",
                           help="include every ambiguous source, including titles with no cue")
    args = parser.parse_args()
    try:
        report = build_source_review_packet(
            args.manifest, args.matrix, args.titles,
            target_sources=None if args.all_sources else args.target_sources,
            _expected_title_sha256=args.title_sha256)
    except (OSError, ValueError) as error:
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
