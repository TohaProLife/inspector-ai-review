"""Audit-gated, read-only corpus census of literal numeric labels.

Matches are research leads only. This module never resolves source sections,
promotes candidates to facts, compares values, or reports findings/coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path
from typing import Any, Mapping, Sequence

from .indexed_numeric_rows import _pattern
from .numeric_family_candidates import load_numeric_family_labels
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest,
    readonly_index_uri,
)


STANDARD_INVENTORY = (203, 202, 10142)
_VALUE_LIKE_AFTER_LABEL = re.compile(
    r"^\s*(?:\([^()\n]{1,40}\)\s*)?(?:(?:[:=—–-]\s*)|(?:[^\W\d_]{1,3}\s*=\s*))?\d",
    re.UNICODE,
)


class NumericLabelProbeError(ValueError):
    """Audit gate, public source/page, or report limit failed closed."""


def _sha_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _audit_gate(report: Mapping[str, Any], rows: list[dict[str, Any]], manifest_sha: str,
                inventory: tuple[int, int, int]) -> None:
    source_count, pdf_count, pdf_pages = inventory
    expected_sources = {row["file_id"]: row for row in rows}
    pdf_rows = [row for row in rows if row["extension"] == ".pdf" and row["file_id"] != "F0194"]
    txt_rows = [row for row in rows if row["extension"] == ".txt"]
    if (len(rows), len(pdf_rows), sum(row["pdf_pages"] for row in pdf_rows)) != inventory:
        raise NumericLabelProbeError("public manifest inventory differs from required corpus")
    if (len(txt_rows) != 1 or txt_rows[0]["file_id"] != "F0194"
            or txt_rows[0].get("annotation_status") != "GROUND_TRUTH_INDEX"):
        raise NumericLabelProbeError("F0194 must remain metadata-only ground-truth inventory")
    if (not isinstance(report, Mapping)
            or report.get("schemaVersion") != "public-document-index-audit-v1"
            or report.get("status") != "PASS"
            or report.get("manifestSha256") != manifest_sha
            or report.get("indexVersionHash") != _version_hash()
            or report.get("findingCount") != 0
            or report.get("fatalFindingCount") != 0
            or report.get("findings") != []
            or report.get("findingsTruncated") != 0):
        raise NumericLabelProbeError("exact PASS audit receipt is required")
    expected = report.get("expected")
    actual = report.get("actual")
    if (not isinstance(expected, dict) or expected != {
                "sourceCount": source_count, "pdfSources": pdf_count,
                "pdfPages": pdf_pages, "txtInventorySources": 1}
            or not isinstance(actual, dict)
            or actual.get("sourceCount") != source_count
            or actual.get("completePdfSources") != pdf_count
            or actual.get("txtInventorySources") != 1
            or actual.get("indexedPages") != pdf_pages
            or actual.get("ftsRows") != pdf_pages
            or actual.get("ftsMapRows") != pdf_pages
            or actual.get("verifiedPageArtifacts") != pdf_pages):
        raise NumericLabelProbeError("PASS audit inventory or artifact counts differ")
    dispositions = actual.get("dispositions")
    if (not isinstance(dispositions, dict)
            or set(dispositions) - {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
            or any(type(value) is not int or value < 0 for value in dispositions.values())
            or sum(dispositions.values()) != pdf_pages):
        raise NumericLabelProbeError("PASS audit quality counts invalid")
    source_reports = report.get("sources")
    if not isinstance(source_reports, list) or len(source_reports) != source_count:
        raise NumericLabelProbeError("PASS audit source inventory missing")
    seen: set[str] = set()
    for item in source_reports:
        if not isinstance(item, dict) or not isinstance(item.get("sourceId"), str):
            raise NumericLabelProbeError("PASS audit source entry invalid")
        source_id = item["sourceId"]
        row = expected_sources.get(source_id)
        if row is None or source_id in seen:
            raise NumericLabelProbeError("PASS audit source outside public inventory or duplicate")
        seen.add(source_id)
        expected_status = "SKIPPED_GROUND_TRUTH_TXT" if source_id == "F0194" else "COMPLETE"
        if (item.get("status") != expected_status
                or item.get("stage") != row["stage"] or item.get("section") != row["section"]
                or item.get("objectId") != row["object_id"]
                or item.get("expectedPages") != (row.get("pdf_pages") or 0)
                or item.get("indexedPages") != (row.get("pdf_pages") or 0)
                or item.get("issueCount") != 0):
            raise NumericLabelProbeError("PASS audit source metadata differs from manifest")
    if seen != set(expected_sources):
        raise NumericLabelProbeError("PASS audit has missing public source")


def _compiled_labels(policy: dict[str, Any]) -> dict[str, list[tuple[str, str, str, Any]]]:
    by_first_character: dict[str, list[tuple[str, str, str, Any]]] = defaultdict(list)
    for entry in policy["entries"]:
        code = entry["parameterCode"]
        for attribute in entry["attributes"]:
            key = attribute["key"]
            for label in attribute["labels"]:
                by_first_character[label[0].casefold()].append(
                    (code, key, label, _pattern(label, attribute["unitAliases"])))
    return dict(by_first_character)


def _example(source_id: str, page_number: int, line: Mapping[str, Any],
             artifact_sha: str, *, attribute: str, label: str,
             kind: str, value: str | None = None, unit: str | None = None) -> dict[str, Any]:
    return {"sourceFileId": source_id, "pageNumber": page_number,
            "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
            "pageArtifactSha256": artifact_sha, "attribute": attribute,
            "label": label, "kind": kind, "rawValue": value, "rawUnit": unit,
            "lineTextExcerpt": line["text"][:160],
            "lineTextTruncated": len(line["text"]) > 160}


def probe_public_numeric_labels(
    manifest_path: Path, index_root: Path, audit_report_path: Path, *,
    label_pack_path: Path | None = None,
    required_inventory: tuple[int, int, int] = STANDARD_INVENTORY,
    max_examples_per_code: int = 20,
    selected_pages: Sequence[tuple[str, int]] | None = None,
) -> dict[str, Any]:
    """Scan all public pages, or at most 20 explicit pages for alias validation."""
    if (type(max_examples_per_code) is not int or not 1 <= max_examples_per_code <= 100
            or not isinstance(required_inventory, tuple) or len(required_inventory) != 3
            or any(type(value) is not int or value < 1 for value in required_inventory)):
        raise NumericLabelProbeError("invalid probe inventory or example limit")
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise NumericLabelProbeError("public manifest changed during probe setup")
    audit_bytes = audit_report_path.read_bytes()
    if len(audit_bytes) > 16 * 1024 * 1024:
        raise NumericLabelProbeError("audit receipt exceeds 16 MiB")
    try:
        audit = json.loads(audit_bytes)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise NumericLabelProbeError("audit receipt is invalid JSON") from error
    _audit_gate(audit, rows, _sha_bytes(manifest_bytes), required_inventory)
    policy = load_numeric_family_labels(label_pack_path) if label_pack_path is not None else load_numeric_family_labels()
    labels = _compiled_labels(policy)
    pdf_rows = [row for row in rows if row["extension"] == ".pdf" and row["file_id"] != "F0194"]
    expected_page_keys = {(row["file_id"], page_number) for row in pdf_rows
                          for page_number in range(1, row["pdf_pages"] + 1)}
    if selected_pages is not None:
        if (isinstance(selected_pages, (str, bytes))
                or not isinstance(selected_pages, Sequence)
                or not 1 <= len(selected_pages) <= 20
                or any(not isinstance(item, tuple) or len(item) != 2
                       or not isinstance(item[0], str) or type(item[1]) is not int
                       for item in selected_pages)
                or len(set(selected_pages)) != len(selected_pages)
                or not set(selected_pages).issubset(expected_page_keys)):
            raise NumericLabelProbeError("select 1..20 distinct public PDF page addresses")
        chosen = set(selected_pages)
    else:
        chosen = expected_page_keys
    if (required_inventory == STANDARD_INVENTORY
            and policy["publicManifestSha256"] != _sha_bytes(manifest_bytes)):
        raise NumericLabelProbeError("verified alias evidence uses a different public manifest")
    alias_samples_by_page: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for alias in policy["verifiedAliasEvidence"]:
        for sample in alias["samples"]:
            key = (sample["sourceFileId"], sample["pageNumber"])
            if required_inventory == STANDARD_INVENTORY and key not in expected_page_keys:
                raise NumericLabelProbeError("verified alias address outside public manifest")
            if key in chosen:
                alias_samples_by_page[key].append(sample)
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise NumericLabelProbeError("public index database missing")
    database_before = database.stat()
    # Reuse the core reader's WAL-aware read-only URI. A checkpointed index can
    # use immutable mode; a pending WAL must remain visible to the reader.
    with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        metadata = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if metadata != {"schemaVersion": INDEX_SCHEMA_VERSION,
                        "versionHash": _version_hash()}:
            raise NumericLabelProbeError("public index schema or version differs from PASS audit")
        page_artifacts = {(source_id, page_number): sha for source_id, page_number, sha in
                          connection.execute("SELECT source_id,page_number,artifact_sha256 FROM pages")}
    if (set(page_artifacts) != expected_page_keys
            or any(not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha)
                   for sha in page_artifacts.values())):
        raise NumericLabelProbeError("indexed page addresses or SHA inventory differs from PASS audit")
    code_stats: dict[str, dict[str, Any]] = {
        entry["parameterCode"]: {
            "family": entry["family"], "exactLineMatches": 0,
            "matchedPages": 0, "ambiguousAttributePages": 0,
            "nonExactNumericLines": 0, "examples": [], "examplesTruncated": 0,
            "sources": {},
        } for entry in policy["entries"]}
    source_stats: list[dict[str, Any]] = []
    total_text = 0
    total_ocr = 0
    verified_alias_samples = 0
    for row in pdf_rows:
        source_id = row["file_id"]
        page_numbers = [number for number in range(1, row["pdf_pages"] + 1)
                        if (source_id, number) in chosen]
        if not page_numbers:
            continue
        source_report = {"sourceFileId": source_id, "objectId": row["object_id"],
                         "stage": row["stage"], "manifestSection": row["section"],
                         "sourceTotalPages": row["pdf_pages"],
                         "selectedPages": len(page_numbers), "verifiedPages": 0,
                         "textCandidatePages": 0, "ocrRequiredPages": 0,
                         "exactLineMatches": 0, "nonExactNumericLines": 0,
                         "matchedCodes": {}}
        for page_number in page_numbers:
            try:
                indexed = get_indexed_page(index_root, source_id, page_number)
            except (OSError, ValueError, KeyError, sqlite3.DatabaseError) as error:
                raise NumericLabelProbeError(
                    f"{source_id} page {page_number} artifact/FTS verification failed: {error}") from error
            source = indexed["source"]
            if (source["source_id"] != source_id or source["status"] != "COMPLETE"
                    or source["object_id"] != row["object_id"]
                    or source["stage"] != row["stage"] or source["section"] != row["section"]
                    or source["source_sha256"] != row["sha256"]
                    or source["relative_path"] != row["relative_path"]):
                raise NumericLabelProbeError(f"{source_id} page {page_number} source differs from manifest")
            page = indexed["page"]
            source_report["verifiedPages"] += 1
            disposition = page["quality"]["disposition"]
            if disposition == "OCR_REQUIRED":
                source_report["ocrRequiredPages"] += 1
                total_ocr += 1
                continue
            if disposition != "TEXT_LAYER_CANDIDATE":
                raise NumericLabelProbeError(f"{source_id} page {page_number} quality disposition invalid")
            source_report["textCandidatePages"] += 1
            total_text += 1
            for sample in alias_samples_by_page.get((source_id, page_number), []):
                if (sample["sourceSha256"] != row["sha256"]
                        or sample["stage"] != row["stage"]
                        or sample["manifestSection"] != row["section"]
                        or sample["pageArtifactSha256"]
                           != page_artifacts[(source_id, page_number)]):
                    raise NumericLabelProbeError("verified alias source or page SHA differs")
                addressed = [line for line in page["lines"]
                             if line["blockIndex"] == sample["blockIndex"]
                             and line["lineIndex"] == sample["lineIndex"]]
                if len(addressed) != 1 or addressed[0]["text"] != sample["lineText"]:
                    raise NumericLabelProbeError("verified alias line address or text differs")
                verified_alias_samples += 1
            page_exact: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
            page_near: dict[tuple[str, str], dict[tuple[int, int], dict[str, Any]]] = defaultdict(dict)
            for line in page["lines"]:
                text = line["text"].lstrip()
                if not text:
                    continue
                for code, attribute, label, expression in labels.get(text[0].casefold(), []):
                    if not text.casefold().startswith(label.casefold()):
                        continue
                    # A longer unrelated word must not become a label near miss.
                    if len(text) > len(label) and text[len(label)].isalnum():
                        continue
                    match = expression.fullmatch(line["text"])
                    if match is not None:
                        page_exact[(code, attribute)].append(_example(
                            source_id, page_number, line, page_artifacts[(source_id, page_number)],
                            attribute=attribute, label=label, kind="EXACT_LINE",
                            value=match.group("value"), unit=match.group("unit")))
                    elif _VALUE_LIKE_AFTER_LABEL.match(text[len(label):]):
                        address = (line["blockIndex"], line["lineIndex"])
                        page_near[(code, attribute)].setdefault(address, _example(
                            source_id, page_number, line, page_artifacts[(source_id, page_number)],
                            attribute=attribute, label=label, kind="NON_EXACT_NUMERIC_LINE"))
            matched_codes: set[str] = set()
            for (code, attribute), examples in page_exact.items():
                stat = code_stats[code]
                count = len(examples)
                stat["exactLineMatches"] += count
                source_report["exactLineMatches"] += count
                source_report["matchedCodes"][code] = source_report["matchedCodes"].get(code, 0) + count
                source_code = stat["sources"].setdefault(source_id, {"exactLineMatches": 0,
                                                                      "matchedPages": 0,
                                                                      "nonExactNumericLines": 0})
                source_code["exactLineMatches"] += count
                if code not in matched_codes:
                    stat["matchedPages"] += 1
                    source_code["matchedPages"] += 1
                    matched_codes.add(code)
                if count > 1:
                    stat["ambiguousAttributePages"] += 1
                for example in examples:
                    example["ambiguousSameAttributeOnPage"] = count > 1
                    if len(stat["examples"]) < max_examples_per_code:
                        stat["examples"].append(example)
                    else:
                        stat["examplesTruncated"] += 1
            for (code, attribute), addresses in page_near.items():
                # Near misses are diagnostic only; text/units are never guessed.
                exact_addresses = {(example["blockIndex"], example["lineIndex"])
                                   for example in page_exact.get((code, attribute), [])}
                addresses = {address: example for address, example in addresses.items()
                             if address not in exact_addresses}
                count = len(addresses)
                if not count:
                    continue
                stat = code_stats[code]
                stat["nonExactNumericLines"] += count
                source_report["nonExactNumericLines"] += count
                source_code = stat["sources"].setdefault(source_id, {"exactLineMatches": 0,
                                                                      "matchedPages": 0,
                                                                      "nonExactNumericLines": 0})
                source_code["nonExactNumericLines"] += count
                for example in addresses.values():
                    if len(stat["examples"]) < max_examples_per_code:
                        stat["examples"].append(example)
                    else:
                        stat["examplesTruncated"] += 1
        if source_report["verifiedPages"] != len(page_numbers):
            raise NumericLabelProbeError(f"{source_id} page traversal incomplete")
        source_stats.append(source_report)
    if (manifest_path.read_bytes() != manifest_bytes
            or audit_report_path.read_bytes() != audit_bytes):
        raise NumericLabelProbeError("manifest or PASS audit receipt changed during probe")
    database_after = database.stat()
    if any(getattr(database_before, field) != getattr(database_after, field)
           for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns")):
        raise NumericLabelProbeError("public index database changed during probe")
    if (selected_pages is None
            and (total_text != audit["actual"]["dispositions"].get("TEXT_LAYER_CANDIDATE", 0)
                 or total_ocr != audit["actual"]["dispositions"].get("OCR_REQUIRED", 0))):
        raise NumericLabelProbeError("quality totals differ from PASS audit")
    if verified_alias_samples != sum(len(items) for items in alias_samples_by_page.values()):
        raise NumericLabelProbeError("verified public alias samples were not all checked")
    return {
        "schemaVersion": "numeric-label-probe-v1", "status": "COMPLETE",
        "purpose": ("LITERAL_LABEL_CENSUS_ONLY" if selected_pages is None
                    else "TARGETED_ALIAS_VALIDATION_ONLY"),
        "disposition": "REVIEW_ONLY",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "manifestSha256": _sha_bytes(manifest_bytes),
        "auditReportSha256": _sha_bytes(audit_bytes),
        "indexVersionHash": _version_hash(),
        "labelPackSha256": policy["labelPackSha256"],
        "inventory": {"sourceCount": len(rows), "pdfSources": len(pdf_rows),
                      "pdfPages": sum(row["pdf_pages"] for row in pdf_rows),
                      "txtInventorySources": 1,
                      "scannedPdfSources": len(source_stats),
                      "scannedPages": total_text + total_ocr,
                      "textCandidatePages": total_text, "ocrRequiredPages": total_ocr},
        "limits": {"maxExamplesPerCode": max_examples_per_code},
        "selectedPages": (None if selected_pages is None else [
            {"sourceFileId": source_id, "pageNumber": page_number}
            for source_id, page_number in sorted(chosen)]),
        "totals": {"exactLineMatches": sum(item["exactLineMatches"] for item in code_stats.values()),
                   "matchedCodePages": sum(item["matchedPages"] for item in code_stats.values()),
                   "ambiguousAttributePages": sum(item["ambiguousAttributePages"] for item in code_stats.values()),
                   "nonExactNumericLines": sum(item["nonExactNumericLines"] for item in code_stats.values()),
                   "verifiedAliasSamples": verified_alias_samples,
                   "examplesTruncated": sum(item["examplesTruncated"] for item in code_stats.values())},
        "codes": code_stats, "sources": source_stats,
        "findingCount": None, "parameterCoverage": None,
    }
