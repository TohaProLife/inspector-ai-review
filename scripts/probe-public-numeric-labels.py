#!/usr/bin/env python3
"""Audit-gated census of literal numeric labels across 202 public PDFs."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_label_probe import (  # noqa: E402
    NumericLabelProbeError, probe_public_numeric_labels,
)


DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--label-pack", type=Path,
                        help="explicit versioned label policy for this index snapshot")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-examples-per-code", type=int, default=20)
    parser.add_argument("--page", action="append", default=None,
                        help="repeat SOURCE:PAGE for a targeted 1..20-page validation")
    args = parser.parse_args()
    try:
        if not args.output.parent.is_dir() or args.output.exists():
            raise NumericLabelProbeError("output directory must exist and report path must be new")
        selected = None
        if args.page is not None:
            if not 1 <= len(args.page) <= 20:
                raise NumericLabelProbeError("select 1..20 explicit pages")
            selected = []
            for raw in args.page:
                if not re.fullmatch(r"F[0-9]{4}:[1-9][0-9]*", raw):
                    raise NumericLabelProbeError("page address must be F0001:1")
                source_id, page_number = raw.split(":", 1)
                selected.append((source_id, int(page_number)))
        report = probe_public_numeric_labels(
            args.manifest, args.index, args.audit_report,
            label_pack_path=args.label_pack,
            max_examples_per_code=args.max_examples_per_code,
            selected_pages=selected)
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"], "output": str(args.output),
                          "inventory": report["inventory"], "totals": report["totals"]},
                         ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError,
            NumericLabelProbeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
