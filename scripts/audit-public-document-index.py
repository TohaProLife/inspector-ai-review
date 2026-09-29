#!/usr/bin/env python3
"""Read-only integrity audit of the TRAIN_PUBLIC document page index."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_document_index import (  # noqa: E402
    INDEX_SCHEMA_VERSION, _version_hash, load_public_manifest,
)
from inspector_worker.text_layer import (  # noqa: E402
    TEXT_QUALITY_POLICY_VERSION, qualify_page_text,
)

DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")
MAX_PAGE_BYTES = 64 * 1024 * 1024
VALID_DISPOSITIONS = {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
VALID_PARSERS = {"PDFMINER", "PYMUPDF"}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _page_artifact(output: Path, relative: str, expected_sha: str) -> dict[str, Any]:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("unsafe artifact path")
    parts = PurePosixPath(relative).parts
    if (relative.startswith("/") or "/".join(parts) != relative
            or any(part in (".", "..") for part in parts)):
        raise ValueError("unsafe artifact path")
    path = (output / relative).resolve()
    if not path.is_relative_to(output.resolve()) or not path.is_file():
        raise ValueError("artifact missing or outside output")
    if path.stat().st_size > MAX_PAGE_BYTES:
        raise ValueError("compressed artifact exceeds audit limit")
    if _sha256_file(path) != expected_sha:
        raise ValueError("compressed artifact SHA-256 mismatch")
    with gzip.open(path, "rb") as source:
        content = source.read(MAX_PAGE_BYTES + 1)
    if len(content) > MAX_PAGE_BYTES:
        raise ValueError("decompressed artifact exceeds audit limit")
    page = json.loads(content)
    if not isinstance(page, dict):
        raise ValueError("page artifact is not JSON object")
    return page


def _counter_json(counter: Counter[str]) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def audit_public_document_index(
    manifest: Path, output: Path, *, max_errors: int = 200,
) -> dict[str, Any]:
    """Audit one SQLite snapshot and page cache without modifying either input."""
    if max_errors < 1:
        raise ValueError("max_errors must be positive")
    rows = load_public_manifest(manifest)
    expected = {row["file_id"]: row for row in rows}
    pdf_rows = [row for row in rows if row["extension"] == ".pdf"]
    txt_rows = [row for row in rows if row["extension"] == ".txt"]
    if len(txt_rows) != 1 or txt_rows[0]["file_id"] != "F0194" or txt_rows[0].get("annotation_status") != "GROUND_TRUTH_INDEX":
        raise ValueError("public TXT inventory is not exactly F0194 GROUND_TRUTH_INDEX")
    database = output / "index.sqlite3"
    if not database.is_file():
        raise FileNotFoundError(database)

    findings: list[dict[str, Any]] = []
    finding_count = 0
    fatal_count = 0
    incomplete = False
    source_reports: dict[str, dict[str, Any]] = {}
    by_object: dict[str, dict[str, Any]] = {}
    by_stage: dict[str, dict[str, Any]] = {}
    dispositions: Counter[str] = Counter()
    parsers: Counter[str] = Counter()
    fts_expected: dict[tuple[str, int], str] = {}
    page_keys: set[tuple[str, int]] = set()
    indexed_page_count = 0
    table_count = 0
    section_count = 0
    fts_rows_seen = 0
    fts_pairs_seen: set[tuple[str, int]] = set()
    fts_rowid_keys: dict[int, tuple[str, int]] = {}
    fts_map_rows_seen = 0

    def group(container: dict[str, dict[str, Any]], key: str) -> dict[str, Any]:
        if key not in container:
            container[key] = {"sources": 0, "completeSources": 0, "indexedPages": 0,
                              "dispositions": Counter(), "parserProvenance": Counter(),
                              "tableRowCandidates": 0, "sectionCandidates": 0,
                              "issues": 0, "issueCodes": Counter()}
        return container[key]

    def issue(code: str, *, source_id: str | None = None, page_number: int | None = None,
              detail: str | None = None, partial: bool = False) -> None:
        nonlocal finding_count, fatal_count, incomplete
        finding_count += 1
        fatal_count += 0 if partial else 1
        incomplete |= partial
        finding: dict[str, Any] = {"code": code}
        if source_id is not None:
            finding["sourceId"] = source_id
            if source_id in source_reports:
                source_reports[source_id]["issueCount"] += 1
                source_reports[source_id]["issueCodes"][code] += 1
                row = expected[source_id]
                group(by_object, row["object_id"])["issues"] += 1
                group(by_object, row["object_id"])["issueCodes"][code] += 1
                group(by_stage, row["stage"])["issues"] += 1
                group(by_stage, row["stage"])["issueCodes"][code] += 1
        if page_number is not None:
            finding["pageNumber"] = page_number
        if detail is not None:
            finding["detail"] = detail[:200]
        if len(findings) < max_errors:
            findings.append(finding)

    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        metadata = dict(connection.execute("SELECT key,value FROM meta"))
        version = _version_hash()
        if metadata.get("schemaVersion") != INDEX_SCHEMA_VERSION:
            issue("SCHEMA_VERSION_MISMATCH", detail=str(metadata.get("schemaVersion")))
        if metadata.get("versionHash") != version:
            issue("INDEX_VERSION_MISMATCH", detail=str(metadata.get("versionHash")))
        has_fts_map = connection.execute("""SELECT 1 FROM sqlite_master
            WHERE type='table' AND name='page_fts_map'""").fetchone() is not None
        if not has_fts_map:
            issue("FTS_MAP_MISSING")
        elif metadata.get("ftsRowidMapVersion") != "1":
            issue("FTS_MAP_VERSION_MISMATCH", detail=str(metadata.get("ftsRowidMapVersion")))
        columns = {record["name"] for record in connection.execute("PRAGMA table_info(pages)")}
        has_parser = "parser_provenance" in columns
        source_db = {record["source_id"]: dict(record) for record in connection.execute("SELECT * FROM sources")}
        for source_id in sorted(source_db.keys() - expected.keys()):
            issue("SOURCE_OUTSIDE_PUBLIC_ALLOWLIST", detail=source_id)

        for source_id, row in expected.items():
            db = source_db.get(source_id)
            source_report = {"sourceId": source_id, "objectId": row["object_id"],
                             "stage": row["stage"], "section": row["section"],
                             "status": db["status"] if db else "MISSING",
                             "expectedPages": row.get("pdf_pages") or 0,
                             "indexedPages": 0, "dispositions": Counter(),
                             "parserProvenance": Counter(), "tableRowCandidates": 0,
                             "sectionCandidates": 0, "issueCount": 0,
                             "issueCodes": Counter()}
            source_reports[source_id] = source_report
            object_group = group(by_object, row["object_id"])
            stage_group = group(by_stage, row["stage"])
            object_group["sources"] += 1
            stage_group["sources"] += 1
            if db is None:
                issue("SOURCE_MISSING", source_id=source_id, partial=True)
                continue
            for key, value in (("object_id", row["object_id"]), ("stage", row["stage"]),
                               ("section", row["section"]), ("relative_path", row["relative_path"]),
                               ("source_sha256", row["sha256"]), ("byte_size", row["size_bytes"]),
                               ("expected_pages", row.get("pdf_pages"))):
                if db[key] != value:
                    issue("SOURCE_MANIFEST_MISMATCH", source_id=source_id, detail=key)
            if row["extension"] == ".txt":
                if db["status"] != "SKIPPED_GROUND_TRUTH_TXT":
                    issue("TXT_INVENTORY_STATUS_INVALID", source_id=source_id,
                          detail=str(db["status"]), partial=db["status"] == "INDEXING")
                continue
            if db["status"] == "COMPLETE":
                object_group["completeSources"] += 1
                stage_group["completeSources"] += 1
                if db["observed_pages"] != row["pdf_pages"]:
                    issue("OBSERVED_PAGE_COUNT_MISMATCH", source_id=source_id)
                if db["error"] is not None:
                    issue("COMPLETE_SOURCE_HAS_ERROR", source_id=source_id)
            elif db["status"] in ("INDEXING", "PENDING"):
                issue("SOURCE_IN_PROGRESS", source_id=source_id, partial=True)
            elif db["status"] == "FAILED":
                issue("SOURCE_FAILED", source_id=source_id, detail=str(db["error"]))
            else:
                issue("SOURCE_STATUS_INVALID", source_id=source_id, detail=str(db["status"]))

        page_columns = "source_id,page_number,source_sha256,disposition,artifact_path,artifact_sha256,block_count,section_candidate_count,table_candidate_count,text_chars"
        if has_parser:
            page_columns += ",parser_provenance"
        previous_key: tuple[str, int] | None = None
        for record in connection.execute(f"SELECT {page_columns} FROM pages ORDER BY source_id,page_number"):
            indexed_page_count += 1
            source_id = record["source_id"]
            page_number = record["page_number"]
            key = (source_id, page_number)
            page_keys.add(key)
            if previous_key == key:
                issue("DUPLICATE_PAGE", source_id=source_id if source_id in expected else None,
                      page_number=page_number)
            previous_key = key
            if source_id not in expected or expected[source_id]["extension"] != ".pdf":
                if source_id in source_reports:
                    source_reports[source_id]["indexedPages"] += 1
                issue("PAGE_OUTSIDE_PUBLIC_PDF", source_id=source_id if source_id in expected else None,
                      page_number=page_number, detail=str(source_id))
                continue
            row = expected[source_id]
            report = source_reports[source_id]
            report["indexedPages"] += 1
            for target in (group(by_object, row["object_id"]), group(by_stage, row["stage"])):
                target["indexedPages"] += 1
            if not isinstance(page_number, int) or not 1 <= page_number <= row["pdf_pages"]:
                issue("PAGE_NUMBER_OUT_OF_RANGE", source_id=source_id, detail=str(page_number))
                continue
            if record["source_sha256"] != row["sha256"]:
                issue("PAGE_SOURCE_SHA_MISMATCH", source_id=source_id, page_number=page_number)
            if record["disposition"] not in VALID_DISPOSITIONS:
                issue("PAGE_DISPOSITION_INVALID", source_id=source_id, page_number=page_number)
            parser = record["parser_provenance"] if has_parser else "PDFMINER"
            if parser not in VALID_PARSERS:
                issue("PAGE_PARSER_INVALID", source_id=source_id, page_number=page_number,
                      detail=str(parser))
            try:
                page = _page_artifact(output, record["artifact_path"], record["artifact_sha256"])
                if (page.get("schemaVersion") != INDEX_SCHEMA_VERSION
                        or page.get("indexVersionHash") != version
                        or page.get("qualityPolicyVersion") != TEXT_QUALITY_POLICY_VERSION
                        or page.get("inputSha256") != row["sha256"]
                        or page.get("pageNumber") != page_number
                        or page.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"):
                    issue("PAGE_PROVENANCE_MISMATCH", source_id=source_id, page_number=page_number)
                json_parser = page.get("parserProvenance", "PDFMINER")
                if (json_parser != parser or (json_parser == "PYMUPDF"
                        and (not isinstance(page.get("parserVersion"), str)
                             or not page["parserVersion"]))):
                    issue("PAGE_PARSER_PROVENANCE_MISMATCH", source_id=source_id, page_number=page_number)
                blocks = page["blocks"]
                lines = page["lines"]
                sections = page["sectionCandidates"]
                tables = page["tableRowCandidates"]
                if not all(isinstance(item, list) for item in (blocks, lines, sections, tables)):
                    raise ValueError("page sections must be lists")
                texts = [block["text"] for block in blocks]
                if not all(isinstance(text, str) for text in texts):
                    raise ValueError("page block text invalid")
                width, height = page["widthMilliPoints"], page["heightMilliPoints"]
                if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1:
                    raise ValueError("page dimensions invalid")
                def valid_box(item: dict[str, Any]) -> bool:
                    box = item.get("bboxMilliPoints")
                    return (isinstance(box, list) and len(box) == 4
                            and all(isinstance(value, int) for value in box)
                            and 0 <= box[0] <= box[2] <= width
                            and 0 <= box[1] <= box[3] <= height)
                if not all(isinstance(block, dict) and valid_box(block) for block in blocks):
                    raise ValueError("page block geometry invalid")
                if not all(isinstance(line, dict) and valid_box(line)
                           and isinstance(line.get("text"), str)
                           and isinstance(line.get("blockIndex"), int)
                           and 0 <= line["blockIndex"] < len(blocks)
                           and isinstance(line.get("lineIndex"), int) and line["lineIndex"] >= 0
                           for line in lines):
                    raise ValueError("page line geometry or references invalid")
                line_refs = {(line["blockIndex"], line["lineIndex"], line["text"],
                              tuple(line["bboxMilliPoints"])) for line in lines}
                if not all(isinstance(candidate, dict) and valid_box(candidate)
                           and isinstance(candidate.get("text"), str)
                           and isinstance(candidate.get("blockIndex"), int)
                           and isinstance(candidate.get("lineIndex"), int)
                           and (candidate["blockIndex"], candidate["lineIndex"],
                                candidate["text"], tuple(candidate["bboxMilliPoints"])) in line_refs
                           for candidate in sections + tables):
                    raise ValueError("candidate line provenance invalid")
                quality = qualify_page_text(texts)
                if page["quality"] != quality or record["disposition"] != quality["disposition"]:
                    issue("PAGE_QUALITY_MISMATCH", source_id=source_id, page_number=page_number)
                if (record["block_count"] != len(blocks)
                        or record["section_candidate_count"] != len(sections)
                        or record["table_candidate_count"] != len(tables)
                        or record["text_chars"] != len("\n".join(texts))):
                    issue("PAGE_SUMMARY_MISMATCH", source_id=source_id, page_number=page_number)
                if not all(isinstance(item, dict) and item.get("status") == "CANDIDATE" for item in sections + tables):
                    issue("PAGE_CANDIDATE_STATUS_INVALID", source_id=source_id, page_number=page_number)
                text_hash = hashlib.sha256("\n".join(texts).encode("utf-8")).hexdigest()
                fts_expected[key] = text_hash
                dispositions[quality["disposition"]] += 1
                parsers[parser] += 1
                report["dispositions"][quality["disposition"]] += 1
                report["parserProvenance"][parser] += 1
                for target in (group(by_object, row["object_id"]), group(by_stage, row["stage"])):
                    target["dispositions"][quality["disposition"]] += 1
                    target["parserProvenance"][parser] += 1
                    target["tableRowCandidates"] += len(tables)
                    target["sectionCandidates"] += len(sections)
                table_count += len(tables)
                section_count += len(sections)
                report["tableRowCandidates"] += len(tables)
                report["sectionCandidates"] += len(sections)
            except (OSError, ValueError, TypeError, KeyError, gzip.BadGzipFile, EOFError, json.JSONDecodeError) as error:
                issue("PAGE_ARTIFACT_INVALID", source_id=source_id, page_number=page_number,
                      detail=str(error))

        for source_id, report in source_reports.items():
            row = expected[source_id]
            db = source_db.get(source_id)
            if row["extension"] == ".txt":
                if report["indexedPages"] != 0:
                    issue("TXT_INVENTORY_HAS_PAGES", source_id=source_id)
                continue
            if db is None:
                continue
            if db["status"] == "COMPLETE" and report["indexedPages"] != row["pdf_pages"]:
                issue("COMPLETE_PAGE_COUNT_MISMATCH", source_id=source_id)
            if db["status"] == "COMPLETE":
                if db["text_candidate_pages"] != report["dispositions"]["TEXT_LAYER_CANDIDATE"]:
                    issue("SOURCE_TEXT_COUNT_MISMATCH", source_id=source_id)
                if db["ocr_required_pages"] != report["dispositions"]["OCR_REQUIRED"]:
                    issue("SOURCE_OCR_COUNT_MISMATCH", source_id=source_id)
        # Inspect FTS addresses first. Never fetch text from out-of-allowlist or
        # F0194 rows, even when a damaged database contains such rows.
        for record in connection.execute("SELECT rowid,source_id,page_number FROM page_fts"):
            fts_rows_seen += 1
            source_id = record["source_id"]
            page_number = record["page_number"]
            key = (source_id, page_number)
            fts_rowid_keys[record["rowid"]] = key
            if key in fts_pairs_seen:
                issue("DUPLICATE_FTS_ROW", source_id=source_id if source_id in expected else None,
                      page_number=page_number)
            fts_pairs_seen.add(key)
            if key not in fts_expected:
                issue("FTS_ROW_WITHOUT_VALID_PAGE", source_id=source_id if source_id in expected else None,
                      page_number=page_number, detail=str(source_id))
            else:
                text_bytes, = connection.execute("SELECT length(CAST(text AS BLOB)) FROM page_fts WHERE rowid=?",
                                                 (record["rowid"],)).fetchone()
                if text_bytes is None or text_bytes > MAX_PAGE_BYTES:
                    issue("FTS_TEXT_SIZE_INVALID", source_id=source_id, page_number=page_number)
                    continue
                content, = connection.execute("SELECT text FROM page_fts WHERE rowid=?",
                                              (record["rowid"],)).fetchone()
                actual_hash = (hashlib.sha256(content.encode("utf-8")).hexdigest()
                               if isinstance(content, str) else None)
                if actual_hash != fts_expected[key]:
                    issue("FTS_TEXT_MISMATCH", source_id=source_id, page_number=page_number)
        for source_id, page_number in sorted(fts_expected.keys() - fts_pairs_seen):
            issue("PAGE_WITHOUT_FTS_ROW", source_id=source_id, page_number=page_number)
        if has_fts_map:
            map_keys: set[tuple[str, int]] = set()
            map_rowids: set[int] = set()
            for record in connection.execute("SELECT source_id,page_number,fts_rowid FROM page_fts_map"):
                fts_map_rows_seen += 1
                source_id = record["source_id"]
                page_number = record["page_number"]
                rowid = record["fts_rowid"]
                key = (source_id, page_number)
                valid_source = source_id if source_id in expected else None
                if key in map_keys:
                    issue("DUPLICATE_FTS_MAP_PAGE", source_id=valid_source,
                          page_number=page_number, detail=str(source_id))
                map_keys.add(key)
                if rowid in map_rowids:
                    issue("DUPLICATE_FTS_MAP_ROWID", source_id=valid_source,
                          page_number=page_number, detail=str(rowid))
                map_rowids.add(rowid)
                if key not in page_keys:
                    issue("FTS_MAP_ORPHAN_PAGE", source_id=valid_source,
                          page_number=page_number, detail=str(source_id))
                if rowid not in fts_rowid_keys:
                    issue("FTS_MAP_ROWID_MISSING", source_id=valid_source,
                          page_number=page_number, detail=str(rowid))
                elif fts_rowid_keys[rowid] != key:
                    issue("FTS_MAP_ADDRESS_MISMATCH", source_id=valid_source,
                          page_number=page_number, detail=str(rowid))
            for source_id, page_number in sorted(page_keys - map_keys):
                issue("PAGE_WITHOUT_FTS_MAP", source_id=source_id if source_id in expected else None,
                      page_number=page_number, detail=str(source_id))
            for rowid in sorted(fts_rowid_keys.keys() - map_rowids):
                source_id, page_number = fts_rowid_keys[rowid]
                issue("FTS_ROW_WITHOUT_MAP", source_id=source_id if source_id in expected else None,
                      page_number=page_number, detail=str(rowid))
    finally:
        connection.close()

    def finalize_groups(container: dict[str, dict[str, Any]]) -> dict[str, Any]:
        return {key: {field: _counter_json(value) if isinstance(value, Counter) else value
                      for field, value in report.items()}
                for key, report in sorted(container.items())}

    for report in source_reports.values():
        report["dispositions"] = _counter_json(report["dispositions"])
        report["parserProvenance"] = _counter_json(report["parserProvenance"])
        report["issueCodes"] = _counter_json(report["issueCodes"])
    status = "PASS" if finding_count == 0 else ("INCOMPLETE" if incomplete and fatal_count == 0 else "FAILED")
    return {
        "schemaVersion": "public-document-index-audit-v1", "status": status,
        "manifestSha256": _sha256_file(manifest), "indexVersionHash": metadata.get("versionHash"),
        "expected": {"sourceCount": len(rows), "pdfSources": len(pdf_rows),
                     "pdfPages": sum(row["pdf_pages"] for row in pdf_rows),
                     "txtInventorySources": len(txt_rows)},
        "actual": {"sourceCount": len(source_db),
                   "completePdfSources": sum(source_db.get(row["file_id"], {}).get("status") == "COMPLETE" for row in pdf_rows),
                   "txtInventorySources": sum(source_db.get(row["file_id"], {}).get("status") == "SKIPPED_GROUND_TRUTH_TXT" for row in txt_rows),
                   "indexedPages": indexed_page_count, "ftsRows": fts_rows_seen,
                   "ftsMapRows": fts_map_rows_seen,
                   "verifiedPageArtifacts": sum(dispositions.values()),
                   "dispositions": _counter_json(dispositions),
                   "parserProvenance": _counter_json(parsers),
                   "tableRowCandidates": table_count, "sectionCandidates": section_count},
        "findingCount": finding_count, "fatalFindingCount": fatal_count,
        "findings": findings,
        "findingsTruncated": max(0, finding_count - len(findings)),
        "byObject": finalize_groups(by_object), "byStage": finalize_groups(by_stage),
        "sources": [source_reports[source_id] for source_id in sorted(source_reports)],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-errors", type=int, default=200)
    parser.add_argument("--allow-incomplete", action="store_true",
                        help="exit zero for an otherwise valid in-progress snapshot")
    arguments = parser.parse_args()
    try:
        report = audit_public_document_index(arguments.manifest, arguments.output,
                                             max_errors=arguments.max_errors)
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["status"] == "PASS" or (arguments.allow_incomplete and report["status"] == "INCOMPLETE") else 1


if __name__ == "__main__":
    raise SystemExit(main())
