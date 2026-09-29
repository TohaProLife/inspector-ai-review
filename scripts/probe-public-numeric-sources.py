#!/usr/bin/env python3
"""Bounded SHA-verified FTS review of ten priority public numeric sources."""

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

from inspector_worker.candidate_source_matrix import build_candidate_source_matrix  # noqa: E402
from inspector_worker.numeric_label_probe import _audit_gate  # noqa: E402
from inspector_worker.public_document_index import (  # noqa: E402
    get_indexed_page, load_public_manifest, readonly_index_uri,
)


MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")
SOURCES = ("F0101", "F0150", "F0152", "F0105", "F0106",
           "F0136", "F0139", "F0140", "F0141", "F0142")
PINNED_PAGES = {"F0101": (9,), "F0150": (26,), "F0152": (64,)}
KR_TERMS = ("толщин*", "диаметр*", "ведомост*", "расход*", "арматур*")
PZ_TERMS = ("общая", "площад*", "этаж*")
KR_LINE = re.compile(r"толщин|диаметр|ведомост|расход|арматур|бетон|сталь", re.I)
PZ_LINE = re.compile(r"общая\s+площад|площад|сумма\s+площад", re.I)
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _plan_flags(matrix: dict, source_id: str, codes: tuple[str, ...]) -> list[str]:
    flags = []
    for code in codes:
        item = next(row for row in matrix["codes"] if row["parameterCode"] == code)
        for object_plan in item["objects"]:
            for side in ("expected", "actual"):
                plan = object_plan[side]
                if source_id in plan["exactSourceIds"]:
                    flags.append(code + ":" + side.upper() + "_EXACT_CATEGORY")
                if source_id in plan["unresolvedSectionSourceIds"]:
                    flags.append(code + ":" + side.upper() + "_SECTION_UNRESOLVED")
    return flags


def _line_sample(line: dict, limit: int) -> dict:
    text = line["text"]
    return {
        "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
        "bboxMilliPoints": line["bboxMilliPoints"],
        "textExcerpt": text[:limit], "textTruncated": len(text) > limit,
        "lineTextSha256": hashlib.sha256(text.encode()).hexdigest(),
        "numericTokenCount": len(NUMBER.findall(text)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pages-per-source", type=int, default=12)
    parser.add_argument("--max-lines-per-page", type=int, default=5)
    args = parser.parse_args()
    try:
        if (not args.output.parent.is_dir() or args.output.exists()
                or not 1 <= args.max_pages_per_source <= 20
                or not 1 <= args.max_lines_per_page <= 10):
            raise ValueError("new report path and bounded page/line limits required")
        manifest_bytes = args.manifest.read_bytes()
        rows = load_public_manifest(args.manifest)
        by_id = {row["file_id"]: row for row in rows}
        if any(source_id not in by_id or by_id[source_id]["extension"] != ".pdf"
               for source_id in SOURCES):
            raise ValueError("priority source outside public PDF manifest")
        audit_bytes = args.audit_report.read_bytes()
        if len(audit_bytes) > 16 * 1024 * 1024:
            raise ValueError("audit receipt exceeds 16 MiB")
        audit = json.loads(audit_bytes)
        _audit_gate(audit, rows, hashlib.sha256(manifest_bytes).hexdigest(), (203, 202, 10142))
        matrix = build_candidate_source_matrix(args.manifest)
        database = args.index / "index.sqlite3"
        before = database.stat()
        sources = []
        with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            for source_id in SOURCES:
                pz = source_id in {"F0101", "F0150", "F0152"}
                terms = PZ_TERMS if pz else KR_TERMS
                codes = ("PZ-002",) if pz else ("KR-061", "KR-062", "KR-067")
                flags = _plan_flags(matrix, source_id, codes)
                if not flags:
                    raise ValueError(f"{source_id} absent from candidate source matrix")
                per_term: dict[str, list[int]] = {}
                all_matches: set[int] = set()
                for term in terms:
                    page_numbers = [page for (page,) in connection.execute(
                        "SELECT page_number FROM page_fts WHERE source_id=? "
                        "AND page_fts MATCH ? ORDER BY page_number",
                        (source_id, term))]
                    per_term[term] = page_numbers
                    all_matches.update(page_numbers)
                selected: dict[int, set[str]] = defaultdict(set)
                for number in PINNED_PAGES.get(source_id, ()):
                    selected[number].add("PINNED_REVIEW_PAGE")
                for term in terms:
                    for number in per_term[term][:6]:
                        if len(selected) >= args.max_pages_per_source and number not in selected:
                            continue
                        selected[number].add("FTS:" + term)
                if len(selected) > args.max_pages_per_source:
                    raise ValueError("pinned page count exceeds source budget")
                records = []
                for number in sorted(selected):
                    indexed = get_indexed_page(args.index, source_id, number)
                    if (indexed["source"]["source_sha256"] != by_id[source_id]["sha256"]
                            or indexed["source"]["status"] != "COMPLETE"):
                        raise ValueError(f"{source_id} indexed source differs from public manifest")
                    artifact = connection.execute(
                        "SELECT artifact_sha256 FROM pages WHERE source_id=? AND page_number=?",
                        (source_id, number)).fetchone()
                    if artifact is None or not re.fullmatch(r"[a-f0-9]{64}", artifact[0]):
                        raise ValueError(f"{source_id}:{number} page SHA missing")
                    page = indexed["page"]
                    if page["quality"]["disposition"] == "OCR_REQUIRED":
                        anchors = []
                    else:
                        expression = PZ_LINE if pz else KR_LINE
                        anchors = [line for line in page["lines"]
                                   if expression.search(line["text"])]
                    records.append({
                        "pageNumber": number, "pageArtifactSha256": artifact[0],
                        "qualityDisposition": page["quality"]["disposition"],
                        "selectionReasons": sorted(selected[number]),
                        "relevantLineCount": len(anchors),
                        "linesTruncated": max(0, len(anchors) - args.max_lines_per_page),
                        "lines": [_line_sample(line, 220)
                                  for line in anchors[:args.max_lines_per_page]],
                    })
                sources.append({
                    "sourceFileId": source_id, "sourceSha256": by_id[source_id]["sha256"],
                    "objectId": by_id[source_id]["object_id"],
                    "stage": by_id[source_id]["stage"],
                    "manifestSection": by_id[source_id]["section"],
                    "sourcePages": by_id[source_id]["pdf_pages"],
                    "matrixFlags": flags,
                    "ftsMatchedPages": len(all_matches),
                    "ftsPagesOmittedByBudget": len(all_matches - set(selected)),
                    "termPageCounts": {term: len(per_term[term]) for term in terms},
                    "selectedPages": records,
                })
        after = database.stat()
        if (args.manifest.read_bytes() != manifest_bytes
                or args.audit_report.read_bytes() != audit_bytes
                or any(getattr(before, field) != getattr(after, field)
                       for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns"))):
            raise ValueError("manifest, audit, or index changed during bounded probe")
        report = {
            "schemaVersion": "numeric-source-page-probe-v1",
            "status": "COMPLETE", "disposition": "REVIEW_ONLY_ABSTAIN",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "auditReportSha256": hashlib.sha256(audit_bytes).hexdigest(),
            "candidatePackSha256": matrix["candidatePackSha256"],
            "maxPagesPerSource": args.max_pages_per_source,
            "maxLinesPerPage": args.max_lines_per_page,
            "sourceCount": len(sources),
            "selectedPageCount": sum(len(item["selectedPages"]) for item in sources),
            "ocrRequiredSelectedPages": sum(
                page["qualityDisposition"] == "OCR_REQUIRED"
                for source in sources for page in source["selectedPages"]),
            "sources": sources, "findingCount": None, "parameterCoverage": None,
        }
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"], "sourceCount": report["sourceCount"],
                          "selectedPageCount": report["selectedPageCount"],
                          "ocrRequiredSelectedPages": report["ocrRequiredSelectedPages"],
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
