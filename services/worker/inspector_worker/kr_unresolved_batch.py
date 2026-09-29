"""Audit-gated lexical triage for eight unresolved public KR catalog codes.

Every lead remains ABSTAIN. Text mentions do not prove geometry, identity,
revision, approval, normative ranking or a PD/RD discrepancy.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from .kr_decrease_batch import EXPECTED_PUBLIC_COUNTS, _require_pass_audit
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest,
    readonly_index_uri,
)


SOURCE_IDS = ("F0105", "F0106", "F0107", "F0136", "F0139", "F0140",
              "F0141", "F0142", "F0143", "F0144")
CODES = ("KR-054", "KR-056", "KR-057", "KR-060", "KR-063", "KR-064",
         "KR-065", "KR-066")
EXPECTED_OBJECT = "OBJ-NOVOSLOBODSKAYA"
ANCHORS = {
    "KR-054": r"\b(?:ос[ьи]|координационн\w*|привязк\w*)\b",
    "KR-056": r"\b(?:сталь|стали|металлопрокат\w*|[СC]\s*(?:235|245|255|345|355))\b",
    "KR-057": r"\b(?:арматур\w*|[АA]\s*(?:400|500)[СC]?)\b",
    "KR-060": r"\b(?:колонн\w*|пилон\w*)\b",
    "KR-063": r"\b(?:шв\w*|шов\w*)\b",
    "KR-064": r"\b(?:лифт\w*|шахт\w*)\b",
    "KR-065": r"\b(?:про[её]м\w*|отверсти\w*)\b",
    "KR-066": r"\b(?:огнезащит\w*|огнестойк\w*|антикорроз\w*|REI\s*\d*)\b",
}
# Stronger lexical class requires two independent concepts in the same line.
# Still no geometry/material fact is inferred from this co-location.
CO_LOCATED = {
    "KR-054": (r"\b(?:ос[ьи]|координационн\w*|привязк\w*)\b",
               r"\b(?:колонн\w*|пилон\w*)\b"),
    "KR-056": (r"\b[СC]\s*(?:235|245|255|345|355)\b",
               r"\b(?:сталь|стали|металлопрокат\w*|марк\w*)\b"),
    "KR-057": (r"\b[АA]\s*(?:400|500)[СC]?\b",
               r"\b(?:арматур\w*|класс\w*)\b"),
    "KR-060": (r"\b(?:колонн\w*|пилон\w*)\b",
               r"\b(?:сечен\w*|размер\w*|габарит\w*)\b|\d+\s*[×хx]\s*\d+"),
    "KR-063": (r"\b(?:шв\w*|шов\w*)\b",
               r"\b(?:деформационн\w*|температурн\w*)\b"),
    "KR-064": (r"\b(?:лифт\w*|шахт\w*)\b",
               r"\b(?:закладн\w*|габарит\w*|привязк\w*)\b"),
    "KR-065": (r"\b(?:про[её]м\w*|отверсти\w*)\b",
               r"\b(?:обрамл\w*|армирован\w*|заделк\w*)\b"),
    "KR-066": (r"\b(?:огнезащит\w*|огнестойк\w*)\b",
               r"\b(?:REI\s*\d+|состав\w*|предел\w*)\b"),
}
COMPILED_ANCHORS = {code: re.compile(value, re.IGNORECASE)
                    for code, value in ANCHORS.items()}
COMPILED_CO_LOCATED = {
    code: tuple(re.compile(part, re.IGNORECASE) for part in pair)
    for code, pair in CO_LOCATED.items()
}


class KrUnresolvedBatchError(ValueError):
    """The public index or catalog provenance cannot support this triage."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def classify_text_line(text: str) -> dict[str, str]:
    """Return only lexical lead classes, never engineering facts."""
    if not isinstance(text, str):
        raise KrUnresolvedBatchError("indexed line text must be a string")
    result = {}
    for code, anchor in COMPILED_ANCHORS.items():
        if anchor.search(text):
            first, second = COMPILED_CO_LOCATED[code]
            result[code] = ("CO_LOCATED_TERMS" if first.search(text) and second.search(text)
                            else "ANCHOR_ONLY")
    return result


def _review_sample(leads: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Prefer stronger, source-diverse, distinct-page leads; expose omitted count."""
    order = ("F0105", "F0136", "F0106", "F0139", "F0107", "F0140",
             "F0141", "F0142", "F0143", "F0144")
    chosen: list[dict[str, Any]] = []
    for kind in ("CO_LOCATED_TERMS", "ANCHOR_ONLY"):
        first: dict[str, list[dict[str, Any]]] = {source: [] for source in order}
        repeated: dict[str, list[dict[str, Any]]] = {source: [] for source in order}
        seen_pages: set[tuple[str, int]] = set()
        for lead in leads:
            if lead["leadClass"] != kind:
                continue
            source_id = lead["sourceFileId"]
            key = (source_id, lead["pageNumber"])
            (repeated if key in seen_pages else first)[source_id].append(lead)
            seen_pages.add(key)
        for buckets in (first, repeated):
            while len(chosen) < limit and any(buckets.values()):
                for source_id in order:
                    if buckets[source_id]:
                        chosen.append(buckets[source_id].pop(0))
                        if len(chosen) == limit:
                            return chosen
    return chosen


def _catalog_strategy(
    catalog_path: Path, registry_path: Path, strategy_path: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    catalog_bytes = catalog_path.read_bytes()
    registry_bytes = registry_path.read_bytes()
    strategy_bytes = strategy_path.read_bytes()
    strategy = json.loads(strategy_bytes)
    if (not isinstance(strategy, dict)
            or strategy.get("schemaVersion") != "unresolved-parameter-strategy-v1"
            or strategy.get("executionPolicy") != "DESIGN_ONLY"
            or strategy.get("catalogSha256") != _sha(catalog_bytes)
            or strategy.get("registrySha256") != _sha(registry_bytes)
            or not isinstance(strategy.get("entries"), list)
            or len(strategy["entries"]) != 80):
        raise KrUnresolvedBatchError("unresolved strategy or source SHA invalid")
    entries = [row for row in strategy["entries"]
               if isinstance(row, dict) and row.get("parameterCode") in CODES]
    if len(entries) != len(CODES) or {row["parameterCode"] for row in entries} != set(CODES):
        raise KrUnresolvedBatchError("strategy lacks exact eight KR unresolved codes")
    catalog = {}
    for line in catalog_bytes.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("parameter_code") in CODES:
            catalog[row["parameter_code"]] = row
    if len(catalog) != len(CODES) or any(
        catalog[code].get("pd_section") != "Раздел 4. КР" for code in CODES
    ):
        raise KrUnresolvedBatchError("catalog KR code contract changed")
    return {row["parameterCode"]: row for row in entries}, {
        "catalogSha256": _sha(catalog_bytes),
        "registrySha256": _sha(registry_bytes),
        "strategySha256": _sha(strategy_bytes),
    }


def _indexed_pages(index_root: Path, public_rows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise KrUnresolvedBatchError("public index database missing")
    result = []
    try:
        with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            meta = dict(connection.execute(
                "SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise KrUnresolvedBatchError("index schema/version mismatch")
            for source_id in SOURCE_IDS:
                row = public_rows[source_id]
                source = connection.execute("SELECT * FROM sources WHERE source_id=?",
                                            (source_id,)).fetchone()
                if source is None or source["status"] != "COMPLETE":
                    raise KrUnresolvedBatchError(f"{source_id} not COMPLETE")
                fields = (("object_id", "object_id"), ("stage", "stage"),
                          ("section", "section"), ("relative_path", "relative_path"),
                          ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                          ("expected_pages", "pdf_pages"))
                if (any(source[column] != row[key] for column, key in fields)
                        or source["observed_pages"] != row["pdf_pages"]
                        or source["error"] is not None):
                    raise KrUnresolvedBatchError(f"{source_id} differs from manifest")
                pages = [dict(item) for item in connection.execute(
                    "SELECT source_id,page_number,source_sha256,artifact_sha256,disposition,"
                    "parser_provenance FROM pages WHERE source_id=? ORDER BY page_number",
                    (source_id,))]
                if (len(pages) != row["pdf_pages"]
                        or [page["page_number"] for page in pages] != list(range(1, row["pdf_pages"] + 1))
                        or any(page["source_sha256"] != row["sha256"] for page in pages)):
                    raise KrUnresolvedBatchError(f"{source_id} page inventory invalid")
                result.extend(pages)
    except sqlite3.DatabaseError as error:
        raise KrUnresolvedBatchError("public index database invalid") from error
    return result


def evaluate_kr_unresolved_batch(
    manifest_path: Path, index_root: Path, audit_path: Path,
    catalog_path: Path, registry_path: Path, strategy_path: Path, *,
    max_leads_per_code: int = 40,
    _expected_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Scan all ten KR PDF page artifacts once, with explicit OCR unknowns.

    Internal test overrides support a tiny synthetic full index. Production CLI
    exposes neither override, so it requires the audited 203-document corpus.
    """
    if type(max_leads_per_code) is not int or not 1 <= max_leads_per_code <= 200:
        raise KrUnresolvedBatchError("max_leads_per_code must be 1..200")
    strategy, pins = _catalog_strategy(catalog_path, registry_path, strategy_path)
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise KrUnresolvedBatchError("public manifest changed during read")
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    if not isinstance(audit, dict):
        raise KrUnresolvedBatchError("audit must be JSON object")
    _require_pass_audit(audit, manifest_bytes, rows,
                        EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts)
    public = {row["file_id"]: row for row in rows}
    if any(source_id not in public for source_id in SOURCE_IDS):
        raise KrUnresolvedBatchError("required KR public sources missing")
    selected = {source_id: public[source_id] for source_id in SOURCE_IDS}
    if (len(selected) != len(SOURCE_IDS)
            or {row["object_id"] for row in selected.values()} != {EXPECTED_OBJECT}
            or {row["section"] for row in selected.values()} != {"KR"}
            or Counter(row["stage"] for row in selected.values())
            != Counter({"PD": 3, "RD": 7})):
        raise KrUnresolvedBatchError("KR object/stage/section source gate failed")
    pages = _indexed_pages(index_root, selected)
    report_sources = {source_id: {
        "sourceFileId": source_id, "objectId": row["object_id"],
        "stage": row["stage"], "section": row["section"],
        "sourceSha256": row["sha256"], "sourceRelativePath": row["relative_path"],
        "expectedPages": row["pdf_pages"], "textLayerPages": 0,
        "ocrRequiredPages": 0, "leadPagesByCode": {code: 0 for code in CODES},
    } for source_id, row in selected.items()}
    totals = {code: Counter() for code in CODES}
    all_leads = {code: [] for code in CODES}
    ocr = []
    page_addresses = set()
    for record in pages:
        source_id, number = record["source_id"], record["page_number"]
        indexed = get_indexed_page(index_root, source_id, number)
        page = indexed["page"]
        source = indexed["source"]
        if (source["status"] != "COMPLETE"
                or source["source_sha256"] != selected[source_id]["sha256"]
                or page["pageNumber"] != number
                or page["inputSha256"] != source["source_sha256"]
                or page["quality"]["disposition"] != record["disposition"]
                or indexed["parserProvenance"] != record["parser_provenance"]):
            raise KrUnresolvedBatchError("page/source indexed artifact provenance mismatch")
        if record["disposition"] == "OCR_REQUIRED":
            report_sources[source_id]["ocrRequiredPages"] += 1
            ocr.append({"sourceFileId": source_id, "pageNumber": number,
                        "sourceSha256": source["source_sha256"],
                        "pageArtifactSha256": record["artifact_sha256"],
                        "status": "OCR_REQUIRED_UNASSESSED_BY_THIS_BATCH",
                        "codeDisposition": "UNKNOWN"})
            continue
        if record["disposition"] != "TEXT_LAYER_CANDIDATE":
            raise KrUnresolvedBatchError("unsupported page disposition")
        report_sources[source_id]["textLayerPages"] += 1
        page_codes = set()
        for line in page["lines"]:
            text = line["text"]
            classified = classify_text_line(text)
            if not classified:
                continue
            for code, kind in classified.items():
                totals[code]["matchingLines"] += 1
                totals[code][kind] += 1
                page_codes.add(code)
                all_leads[code].append({
                        "sourceFileId": source_id, "stage": source["stage"],
                        "section": source["section"], "pageNumber": number,
                        "sourceSha256": source["source_sha256"],
                        "pageArtifactSha256": record["artifact_sha256"],
                        "parserProvenance": indexed["parserProvenance"],
                        "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                        "bboxMilliPoints": line["bboxMilliPoints"],
                        "lineSha256": _sha(text.encode("utf-8")),
                        "text": text[:300], "textTruncated": len(text) > 300,
                        "leadClass": kind, "status": "ABSTAIN",
                        "unproven": ["DRAWING_ROLE", "REVISION_APPROVAL",
                                     "SAME_ELEMENT", "GEOMETRY_OR_MATERIAL",
                                     "NORM_APPLICABILITY", "PD_RD_COMPARISON"],
                })
        for code in page_codes:
            totals[code]["matchingPages"] += 1
            report_sources[source_id]["leadPagesByCode"][code] += 1
        page_addresses.add((source_id, number))
    if (len(pages) != sum(row["pdf_pages"] for row in selected.values())
            or len(page_addresses) + len(ocr) != len(pages)
            or manifest_path.read_bytes() != manifest_bytes
            or audit_path.read_bytes() != audit_bytes):
        raise KrUnresolvedBatchError("index scan incomplete or inputs changed during scan")
    code_reports = {}
    for code in CODES:
        counter = totals[code]
        kept = _review_sample(all_leads[code], max_leads_per_code)
        code_reports[code] = {
            "candidateExtractorFamily": strategy[code]["candidateExtractorFamily"],
            "specificProofDependency": strategy[code]["specificProofDependency"],
            "matchingPages": counter["matchingPages"],
            "matchingLines": counter["matchingLines"],
            "coLocatedLines": counter["CO_LOCATED_TERMS"],
            "anchorOnlyLines": counter["ANCHOR_ONLY"],
            "shownLeads": len(kept),
            "omittedLeads": counter["matchingLines"] - len(kept),
            "leads": kept, "status": "ABSTAIN",
        }
    return {
        "schemaVersion": "kr-unresolved-public-batch-v1",
        "purpose": "REVIEW_ONLY", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "catalogStrategyPolicy": "DESIGN_ONLY",
        "manifestSha256": _sha(manifest_bytes), "auditSha256": _sha(audit_bytes),
        "indexVersionHash": _version_hash(), **pins,
        "objectId": EXPECTED_OBJECT, "sourceFileIds": list(SOURCE_IDS),
        "sourceReports": [report_sources[source_id] for source_id in SOURCE_IDS],
        "scannedPages": len(pages),
        "textLayerPages": len(page_addresses), "ocrRequiredPages": len(ocr),
        "ocrQueue": ocr, "codeReports": code_reports,
        "sourceGate": {"manifestObjectStageSection": "PASSED",
                       "revisionApproval": "UNPROVEN",
                       "drawingSheetRole": "UNPROVEN",
                       "elementIdentity": "UNPROVEN",
                       "crossDocumentPair": "UNPROVEN",
                       "normApplicability": "UNPROVEN",
                       "idSource": "UNAVAILABLE_IN_SELECTED_SET"},
        "overallStatus": "ABSTAIN", "findingCount": None,
        "parameterCoverage": None,
    }
