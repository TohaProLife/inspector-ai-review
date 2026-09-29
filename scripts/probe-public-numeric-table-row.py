#!/usr/bin/env python3
"""Audit-gated, page-local review of public PZ-002 table geometry."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_label_probe import _audit_gate  # noqa: E402
from inspector_worker.numeric_table_row_candidates import (  # noqa: E402
    NumericTableRowError, observe_indexed_numeric_table_row,
)
from inspector_worker.public_document_index import load_public_manifest  # noqa: E402


DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page", action="append", required=True,
                        help="repeat F0001:1, maximum 20 public PDF pages")
    args = parser.parse_args()
    try:
        if not args.output.parent.is_dir() or args.output.exists():
            raise NumericTableRowError("output directory must exist and report path must be new")
        if not 1 <= len(args.page) <= 20 or any(not re.fullmatch(r"F[0-9]{4}:[1-9][0-9]*", x)
                                               for x in args.page):
            raise NumericTableRowError("select 1..20 explicit public PDF pages")
        selected = [(raw.split(":")[0], int(raw.split(":")[1])) for raw in args.page]
        if len(set(selected)) != len(selected):
            raise NumericTableRowError("page addresses must be distinct")
        manifest_bytes = args.manifest.read_bytes()
        rows = load_public_manifest(args.manifest)
        audit_bytes = args.audit_report.read_bytes()
        if len(audit_bytes) > 16 * 1024 * 1024:
            raise NumericTableRowError("audit receipt exceeds 16 MiB")
        audit = json.loads(audit_bytes)
        _audit_gate(audit, rows, hashlib.sha256(manifest_bytes).hexdigest(), (203, 202, 10142))
        observations = [observe_indexed_numeric_table_row(
            args.manifest, args.index, source_id, page_number)
            for source_id, page_number in selected]
        if args.manifest.read_bytes() != manifest_bytes or args.audit_report.read_bytes() != audit_bytes:
            raise NumericTableRowError("manifest or audit receipt changed during probe")
        report = {
            "schemaVersion": "numeric-table-row-probe-v1",
            "status": "COMPLETE", "purpose": "TARGETED_PUBLIC_TABLE_REVIEW_ONLY",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "auditReportSha256": hashlib.sha256(audit_bytes).hexdigest(),
            "pageCount": len(observations),
            "parsedReviewRows": sum(item["row"] is not None for item in observations),
            "observations": observations,
            "findingCount": None, "parameterCoverage": None,
        }
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"], "output": str(args.output),
                          "pageCount": report["pageCount"],
                          "parsedReviewRows": report["parsedReviewRows"]},
                         ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
