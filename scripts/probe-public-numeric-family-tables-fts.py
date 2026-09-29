#!/usr/bin/env python3
"""Audit-gated FTS census of literal numeric table rows on public PDF pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from collections import defaultdict
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402
from inspector_worker.numeric_family_table_rows import (  # noqa: E402
    _definitions, observe_indexed_numeric_family_table_rows,
)
from inspector_worker.numeric_label_probe import _audit_gate  # noqa: E402
from inspector_worker.numeric_table_row_candidates import load_numeric_table_policy  # noqa: E402
from inspector_worker.public_document_index import (  # noqa: E402
    load_public_manifest, readonly_index_uri,
)


MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def fts_literal_phrase(label: str) -> str:
    """Use the same Unicode word sequence as an exact line; punctuation is verified later."""
    words = re.findall(r"[^\W_]+", label, re.UNICODE)
    if not words or len(words) > 24:
        raise ValueError("numeric label has no bounded FTS phrase")
    return '"' + " ".join(words) + '"'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=1000)
    args = parser.parse_args()
    try:
        if (not args.output.parent.is_dir() or args.output.exists()
                or not 1 <= args.max_pages <= 2000):
            raise ValueError("new report path and max-pages 1..2000 required")
        manifest_bytes = args.manifest.read_bytes()
        rows = load_public_manifest(args.manifest)
        manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
        audit_bytes = args.audit_report.read_bytes()
        if len(audit_bytes) > 16 * 1024 * 1024:
            raise ValueError("audit receipt exceeds 16 MiB")
        audit = json.loads(audit_bytes)
        _audit_gate(audit, rows, manifest_sha, (203, 202, 10142))
        label_policy = load_numeric_family_labels()
        table_policy = load_numeric_table_policy()
        if (label_policy["publicManifestSha256"] != manifest_sha
                or table_policy["publicManifestSha256"] != manifest_sha):
            raise ValueError("literal table labels not pinned to public manifest")
        definitions = _definitions(label_policy, table_policy)
        database = args.index / "index.sqlite3"
        before = database.stat()
        page_labels: dict[tuple[str, int], set[tuple[str, str]]] = defaultdict(set)
        label_queries = []
        with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            for definition in definitions:
                query = fts_literal_phrase(definition["label"])
                addresses = [(source_id, page_number) for source_id, page_number in
                             connection.execute("SELECT source_id,page_number FROM page_fts "
                                                "WHERE page_fts MATCH ?", (query,))]
                for address in addresses:
                    page_labels[address].add((definition["parameterCode"],
                                              definition["attribute"]))
                label_queries.append({
                    "parameterCode": definition["parameterCode"],
                    "attribute": definition["attribute"],
                    "label": definition["label"], "ftsPhrase": query,
                    "ftsMatchedPages": len(addresses),
                })
        addresses = sorted(page_labels)
        selected = addresses[:args.max_pages]
        pages = [observe_indexed_numeric_family_table_rows(
            args.manifest, args.index, source_id, page_number)
            for source_id, page_number in selected]
        after = database.stat()
        if (args.manifest.read_bytes() != manifest_bytes
                or args.audit_report.read_bytes() != audit_bytes
                or any(getattr(before, field) != getattr(after, field)
                       for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns"))):
            raise ValueError("manifest, audit, or index changed during FTS probe")
        report = {
            "schemaVersion": "numeric-family-table-fts-probe-v1",
            "status": "COMPLETE" if len(selected) == len(addresses) else "TRUNCATED",
            "disposition": "REVIEW_ONLY_ABSTAIN",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": manifest_sha,
            "auditReportSha256": hashlib.sha256(audit_bytes).hexdigest(),
            "labelPackSha256": label_policy["labelPackSha256"],
            "tablePolicySha256": table_policy["policySha256"],
            "labelDefinitions": len(definitions),
            "ftsMatchedPages": len(addresses),
            "selectedPages": len(selected),
            "pagesOmittedByLimit": len(addresses) - len(selected),
            "auditOcrRequiredPages": audit["actual"]["dispositions"].get("OCR_REQUIRED", 0),
            "selectedOcrRequiredPages": sum(page["reason"] == "OCR_REQUIRED" for page in pages),
            "exactGeometricRows": sum(
                item["row"] is not None for page in pages
                for item in page["observations"]),
            "ambiguousOrUnresolvedLabels": sum(
                item["row"] is None for page in pages
                for item in page["observations"]),
            "labelQueries": label_queries,
            "pages": pages, "findingCount": None, "parameterCoverage": None,
        }
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"],
                          "labelDefinitions": report["labelDefinitions"],
                          "ftsMatchedPages": report["ftsMatchedPages"],
                          "selectedPages": report["selectedPages"],
                          "pagesOmittedByLimit": report["pagesOmittedByLimit"],
                          "exactGeometricRows": report["exactGeometricRows"],
                          "ambiguousOrUnresolvedLabels": report["ambiguousOrUnresolvedLabels"],
                          "auditOcrRequiredPages": report["auditOcrRequiredPages"],
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
