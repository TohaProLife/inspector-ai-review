#!/usr/bin/env python3
"""Build bounded, review-only OCR queues from the audited public index."""
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

from inspector_worker.public_family_ocr_queue import (  # noqa: E402
    PublicFamilyOcrQueueError, build_public_family_ocr_queue,
)

DEFAULT_MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--source-matrix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-per-family", type=int, default=16)
    parser.add_argument("--neighbor-radius", type=int, default=2)
    parser.add_argument("--planning-version", type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    try:
        report = build_public_family_ocr_queue(
            args.manifest, args.index, args.audit, args.source_matrix,
            max_per_family=args.max_per_family,
            neighbor_radius=args.neighbor_radius,
            planning_version=args.planning_version,
        )
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
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
        os.chmod(temporary, 0o644)
        os.replace(temporary, args.output)
    finally:
        temporary.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
