#!/usr/bin/env python3
"""Audit-gated page-local table review for 31 public numeric candidate codes."""

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

from inspector_worker.numeric_family_table_rows import (  # noqa: E402
    observe_indexed_numeric_family_table_rows,
)
from inspector_worker.numeric_label_probe import _audit_gate  # noqa: E402
from inspector_worker.public_document_index import load_public_manifest  # noqa: E402


DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page", action="append", required=True)
    args = parser.parse_args()
    try:
        if not args.output.parent.is_dir() or args.output.exists():
            raise ValueError("output directory must exist and report path must be new")
        if not 1 <= len(args.page) <= 20 or any(not re.fullmatch(r"F[0-9]{4}:[1-9][0-9]*", x)
                                               for x in args.page):
            raise ValueError("select 1..20 explicit public PDF pages")
        addresses = [(raw.split(":")[0], int(raw.split(":")[1])) for raw in args.page]
        if len(set(addresses)) != len(addresses):
            raise ValueError("page addresses must be distinct")
        manifest_bytes = args.manifest.read_bytes()
        rows = load_public_manifest(args.manifest)
        audit_bytes = args.audit_report.read_bytes()
        if len(audit_bytes) > 16 * 1024 * 1024:
            raise ValueError("audit receipt exceeds 16 MiB")
        _audit_gate(json.loads(audit_bytes), rows, hashlib.sha256(manifest_bytes).hexdigest(),
                    (203, 202, 10142))
        observations = [observe_indexed_numeric_family_table_rows(
            args.manifest, args.index, source_id, page_number)
            for source_id, page_number in addresses]
        if args.manifest.read_bytes() != manifest_bytes or args.audit_report.read_bytes() != audit_bytes:
            raise ValueError("manifest or audit receipt changed during selected-page probe")
        report = {
            "schemaVersion": "numeric-family-table-probe-v1",
            "status": "COMPLETE", "disposition": "REVIEW_ONLY_ABSTAIN",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "auditReportSha256": hashlib.sha256(audit_bytes).hexdigest(),
            "selectedPages": len(addresses),
            "exactGeometricRows": sum(
                item["row"] is not None
                for page in observations for item in page["observations"]),
            "ambiguousOrUnresolvedLabels": sum(
                item["row"] is None
                for page in observations for item in page["observations"]),
            "ocrRequiredPages": sum(page["reason"] == "OCR_REQUIRED"
                                    for page in observations),
            "pages": observations, "findingCount": None,
            "parameterCoverage": None,
        }
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"], "selectedPages": report["selectedPages"],
                          "exactGeometricRows": report["exactGeometricRows"],
                          "ambiguousOrUnresolvedLabels": report["ambiguousOrUnresolvedLabels"],
                          "ocrRequiredPages": report["ocrRequiredPages"],
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
