"""Audit-gated read-only census of eight literal class labels in public PDFs.

Every approved page is read and SHA-checked. Counts are lexical research leads,
not verified facts, ordered comparisons, findings, or parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path
from typing import Any, Mapping

from .class_family_candidates import class_line_pattern, load_class_family_labels
from .numeric_label_probe import STANDARD_INVENTORY, _audit_gate
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _mapped_fts_text_matches, _validate_cached_page,
    _version_hash, load_public_manifest,
)


_HASH = re.compile(r"[a-f0-9]{64}\Z")
_CLASS_CUE = re.compile(
    r"(?<!\w)(?:EI|E|I)\s*[-–]?\s*[0-9]{1,3}(?!\w)"
    r"|(?<!\w)(?:КМ|KM|С|C)\s*[0-9](?!\w)"
    r"|(?<!\w)(?:[IVX]{1,4}|[A-GАВСДЕ]|[1-3])(?!\w)"
)


class ClassLabelProbeError(ValueError):
    """Public inventory, audit, source/page integrity, or report limit failed."""


def _sha_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _source_eligibility(rule: Mapping[str, Any], row: Mapping[str, Any]) -> str:
    """Metadata gate only; no page text can replace drawing section review."""
    if row["stage"] == rule["expectedStage"]:
        side = "Expected"
    elif row["stage"] in rule["allowedActualStages"]:
        side = "Actual"
    else:
        return "STAGE_OUTSIDE_RULE"
    if rule["manifestSectionStatus"][side.lower()] == "UNKNOWN_ABSTAIN":
        return "DRAWING_SECTION_RESOLUTION_REQUIRED"
    if row["section"] not in rule[f"required{side}Sections"]:
        return "MANIFEST_SECTION_OUTSIDE_RULE"
    if row["section"] not in rule[f"required{side}DrawingSections"]:
        return "DRAWING_MARK_PROOF_REQUIRED"
    return "MANIFEST_CATEGORY_MATCH_REVIEW_ONLY"


def _example(row: Mapping[str, Any], page_number: int, line: Mapping[str, Any],
             artifact_sha: str, *, kind: str, source_eligibility: str,
             value: str | None = None) -> dict[str, Any]:
    raw = line["text"]
    return {
        "sourceFileId": row["file_id"], "sourceSha256": row["sha256"],
        "objectId": row["object_id"], "stage": row["stage"],
        "manifestSection": row["section"],
        "sourceEligibility": source_eligibility,
        "pageNumber": page_number,
        "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
        "bboxMilliPoints": line["bboxMilliPoints"],
        "pageArtifactSha256": artifact_sha,
        "kind": kind, "rawValue": value,
        "lineTextSha256": _sha_bytes(raw.encode("utf-8")),
        "lineTextExcerpt": raw[:160], "lineTextTruncated": len(raw) > 160,
    }


def _retain(stats: dict[str, Any], key: str, example: dict[str, Any], limit: int) -> None:
    if len(stats[key]) < limit:
        stats[key].append(example)
    else:
        stats[key + "Truncated"] += 1


def _read_page_immutable(index_root: Path, database_uri: str, source_id: str,
                         page_number: int) -> dict[str, Any]:
    """Verify one original page and FTS map without SQLite WAL write access."""
    with closing(sqlite3.connect(database_uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
        record = connection.execute(
            "SELECT * FROM pages WHERE source_id=? AND page_number=?",
            (source_id, page_number)).fetchone()
        if source is None or record is None:
            raise ValueError("source or page is absent from public index")
        if record["source_sha256"] != source["source_sha256"]:
            raise ValueError("page source SHA differs from indexed source")
        page = _validate_cached_page(
            index_root, {"sha256": source["source_sha256"]}, page_number,
            (record["artifact_path"], record["artifact_sha256"], record["parser_provenance"]))
        if page is None:
            raise ValueError("indexed page artifact hash/schema/quality invalid")
        if (record["disposition"] != page["quality"]["disposition"]
                or record["block_count"] != len(page["blocks"])
                or record["section_candidate_count"] != len(page["sectionCandidates"])
                or record["table_candidate_count"] != len(page["tableRowCandidates"])
                or record["text_chars"] != len("\n".join(block["text"] for block in page["blocks"]))
                or not _mapped_fts_text_matches(connection, source_id, page_number,
                                                 page["blocks"])):
            raise ValueError("indexed page metadata or FTS text differs from artifact")
        return {
            "source": {key: source[key] for key in (
                "source_id", "object_id", "stage", "section", "source_sha256",
                "relative_path", "status")},
            "page": page,
        }


def probe_public_class_labels(
    manifest_path: Path, index_root: Path, audit_report_path: Path, *,
    required_inventory: tuple[int, int, int] = STANDARD_INVENTORY,
    max_examples_per_code: int = 20, max_ocr_queue: int = 2000,
) -> dict[str, Any]:
    """Visit all 10,142 pages once; retain bounded review and OCR addresses.

    A smaller required_inventory is accepted only by direct test callers. The
    CLI always uses the standard 203/202/10,142 public corpus gate.
    """
    if (type(max_examples_per_code) is not int or not 1 <= max_examples_per_code <= 100
            or type(max_ocr_queue) is not int or not 1 <= max_ocr_queue <= 10142
            or not isinstance(required_inventory, tuple) or len(required_inventory) != 3
            or any(type(value) is not int or value < 1 for value in required_inventory)):
        raise ClassLabelProbeError("invalid probe inventory or output limits")
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise ClassLabelProbeError("public manifest changed during probe setup")
    audit_bytes = audit_report_path.read_bytes()
    if len(audit_bytes) > 16 * 1024 * 1024:
        raise ClassLabelProbeError("audit receipt exceeds 16 MiB")
    try:
        audit = json.loads(audit_bytes)
        _audit_gate(audit, rows, _sha_bytes(manifest_bytes), required_inventory)
    except (UnicodeError, json.JSONDecodeError, ValueError, TypeError, KeyError) as error:
        raise ClassLabelProbeError("exact PASS audit receipt and public inventory required") from error
    policy = load_class_family_labels()
    compiled: dict[str, list[tuple[str, str, re.Pattern[str]]]] = defaultdict(list)
    for entry in policy["entries"]:
        label = entry["labels"][0]
        compiled[label[0].casefold()].append((entry["parameterCode"], label,
                                              class_line_pattern(entry)))
    pdf_rows = [row for row in rows if row["extension"] == ".pdf" and row["file_id"] != "F0194"]
    expected_keys = {(row["file_id"], page_number) for row in pdf_rows
                     for page_number in range(1, row["pdf_pages"] + 1)}
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise ClassLabelProbeError("public index database missing")
    wal = index_root / "index.sqlite3-wal"
    if wal.is_file() and wal.stat().st_size:
        raise ClassLabelProbeError("public index has uncheckpointed WAL; immutable scan unsafe")
    database_uri = database.resolve().as_uri() + "?mode=ro&immutable=1"
    before = database.stat()
    try:
        with closing(sqlite3.connect(database_uri, uri=True)) as connection:
            metadata = dict(connection.execute(
                "SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if metadata != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise ClassLabelProbeError("public index schema or version differs from PASS audit")
            artifacts = {(source_id, page_number): sha for source_id, page_number, sha in
                         connection.execute("SELECT source_id,page_number,artifact_sha256 FROM pages")}
    except sqlite3.DatabaseError as error:
        raise ClassLabelProbeError("public index metadata invalid") from error
    if (set(artifacts) != expected_keys
            or any(not isinstance(sha, str) or _HASH.fullmatch(sha) is None
                   for sha in artifacts.values())):
        raise ClassLabelProbeError("indexed page address/SHA inventory differs from PASS audit")
    code_stats: dict[str, dict[str, Any]] = {
        entry["parameterCode"]: {
            "family": "CLASS_DECREASE", "exactLineMatches": 0,
            "matchedPages": 0, "ambiguousPages": 0,
            "nearMissLines": 0, "nearMissPages": 0,
            "exactExamples": [], "exactExamplesTruncated": 0,
            "nearMissExamples": [], "nearMissExamplesTruncated": 0,
            "sourceEligibilityCounts": {},
            "sources": {},
        } for entry in policy["entries"]
    }
    source_stats: list[dict[str, Any]] = []
    ocr_queue: list[dict[str, Any]] = []
    ocr_truncated = 0
    total_text = total_ocr = 0
    for row in pdf_rows:
        source_id = row["file_id"]
        source_stat = {
            "sourceFileId": source_id, "objectId": row["object_id"],
            "stage": row["stage"], "manifestSection": row["section"],
            "expectedPages": row["pdf_pages"], "verifiedPages": 0,
            "textCandidatePages": 0, "ocrRequiredPages": 0,
            "exactLineMatches": 0, "nearMissLines": 0, "matchedCodes": {},
        }
        for page_number in range(1, row["pdf_pages"] + 1):
            try:
                indexed = _read_page_immutable(index_root, database_uri, source_id, page_number)
            except (OSError, ValueError, KeyError, sqlite3.DatabaseError) as error:
                raise ClassLabelProbeError(
                    f"{source_id} page {page_number} artifact/FTS verification failed: {error}") from error
            source, page = indexed["source"], indexed["page"]
            if (source["source_id"] != source_id or source["status"] != "COMPLETE"
                    or source["object_id"] != row["object_id"]
                    or source["stage"] != row["stage"] or source["section"] != row["section"]
                    or source["source_sha256"] != row["sha256"]
                    or source["relative_path"] != row["relative_path"]):
                raise ClassLabelProbeError(f"{source_id} page {page_number} source differs from manifest")
            source_stat["verifiedPages"] += 1
            disposition = page["quality"]["disposition"]
            artifact_sha = artifacts[(source_id, page_number)]
            if disposition == "OCR_REQUIRED":
                source_stat["ocrRequiredPages"] += 1
                total_ocr += 1
                if len(ocr_queue) < max_ocr_queue:
                    ocr_queue.append({
                        "sourceFileId": source_id, "pageNumber": page_number,
                        "objectId": row["object_id"], "stage": row["stage"],
                        "manifestSection": row["section"],
                        "sourceSha256": row["sha256"], "pageArtifactSha256": artifact_sha,
                        "reason": "INDEX_TEXT_LAYER_OCR_REQUIRED",
                    })
                else:
                    ocr_truncated += 1
                continue
            if disposition != "TEXT_LAYER_CANDIDATE":
                raise ClassLabelProbeError(f"{source_id} page {page_number} quality disposition invalid")
            source_stat["textCandidatePages"] += 1
            total_text += 1
            page_exact: dict[str, list[dict[str, Any]]] = defaultdict(list)
            page_near: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for line in page["lines"]:
                text = line["text"].lstrip()
                if not text:
                    continue
                for code, label, expression in compiled.get(text[0].casefold(), []):
                    if not text.casefold().startswith(label.casefold()):
                        continue
                    if len(text) > len(label) and text[len(label)].isalnum():
                        continue
                    exact = expression.fullmatch(line["text"])
                    source_gate = _source_eligibility(policy["rules"][code], row)
                    if exact is not None:
                        page_exact[code].append(_example(
                            row, page_number, line, artifact_sha, kind="EXACT_LINE",
                            source_eligibility=source_gate, value=exact.group("value")))
                    elif _CLASS_CUE.search(text[len(label):]):
                        page_near[code].append(_example(
                            row, page_number, line, artifact_sha, kind="NEAR_MISS",
                            source_eligibility=source_gate))
            for code, examples in page_exact.items():
                stat = code_stats[code]
                count = len(examples)
                stat["exactLineMatches"] += count
                stat["matchedPages"] += 1
                stat["ambiguousPages"] += count > 1
                source_stat["exactLineMatches"] += count
                source_stat["matchedCodes"][code] = source_stat["matchedCodes"].get(code, 0) + count
                source_code = stat["sources"].setdefault(source_id, {
                    "exactLineMatches": 0, "matchedPages": 0, "nearMissLines": 0})
                source_code["exactLineMatches"] += count
                source_code["matchedPages"] += 1
                for example in examples:
                    example["ambiguousSameCodeOnPage"] = count > 1
                    gate = example["sourceEligibility"]
                    stat["sourceEligibilityCounts"][gate] = (
                        stat["sourceEligibilityCounts"].get(gate, 0) + 1)
                    _retain(stat, "exactExamples", example, max_examples_per_code)
            for code, examples in page_near.items():
                stat = code_stats[code]
                count = len(examples)
                stat["nearMissLines"] += count
                stat["nearMissPages"] += 1
                source_stat["nearMissLines"] += count
                source_code = stat["sources"].setdefault(source_id, {
                    "exactLineMatches": 0, "matchedPages": 0, "nearMissLines": 0})
                source_code["nearMissLines"] += count
                for example in examples:
                    gate = example["sourceEligibility"]
                    stat["sourceEligibilityCounts"][gate] = (
                        stat["sourceEligibilityCounts"].get(gate, 0) + 1)
                    _retain(stat, "nearMissExamples", example, max_examples_per_code)
        if source_stat["verifiedPages"] != row["pdf_pages"]:
            raise ClassLabelProbeError(f"{source_id} page traversal incomplete")
        source_stats.append(source_stat)
    if (manifest_path.read_bytes() != manifest_bytes
            or audit_report_path.read_bytes() != audit_bytes):
        raise ClassLabelProbeError("manifest or PASS audit receipt changed during probe")
    after = database.stat()
    if any(getattr(before, field) != getattr(after, field)
           for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns")):
        raise ClassLabelProbeError("public index database changed during probe")
    if wal.is_file() and wal.stat().st_size:
        raise ClassLabelProbeError("public index WAL appeared during immutable scan")
    if (total_text != audit["actual"]["dispositions"].get("TEXT_LAYER_CANDIDATE", 0)
            or total_ocr != audit["actual"]["dispositions"].get("OCR_REQUIRED", 0)):
        raise ClassLabelProbeError("quality totals differ from PASS audit")
    return {
        "schemaVersion": "class-label-probe-v2", "status": "COMPLETE",
        "purpose": "LITERAL_LABEL_CENSUS_ONLY", "disposition": "REVIEW_ONLY",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "manifestSha256": _sha_bytes(manifest_bytes),
        "auditReportSha256": _sha_bytes(audit_bytes),
        "indexVersionHash": _version_hash(),
        "labelPackSha256": policy["labelPackSha256"],
        "inventory": {
            "sourceCount": len(rows), "pdfSources": len(pdf_rows),
            "pdfPages": sum(row["pdf_pages"] for row in pdf_rows),
            "txtInventorySources": 1, "textCandidatePages": total_text,
            "ocrRequiredPages": total_ocr,
        },
        "limits": {"maxExamplesPerCodeAndKind": max_examples_per_code,
                   "maxOcrQueue": max_ocr_queue},
        "totals": {
            "exactLineMatches": sum(stat["exactLineMatches"] for stat in code_stats.values()),
            "matchedCodePages": sum(stat["matchedPages"] for stat in code_stats.values()),
            "ambiguousPages": sum(stat["ambiguousPages"] for stat in code_stats.values()),
            "nearMissLines": sum(stat["nearMissLines"] for stat in code_stats.values()),
            "nearMissCodePages": sum(stat["nearMissPages"] for stat in code_stats.values()),
            "examplesTruncated": sum(stat["exactExamplesTruncated"] +
                                     stat["nearMissExamplesTruncated"] for stat in code_stats.values()),
        },
        "codes": code_stats, "sources": source_stats,
        "ocrQueue": ocr_queue, "ocrQueueTruncated": ocr_truncated,
        "findingCount": None, "parameterCoverage": None,
    }
