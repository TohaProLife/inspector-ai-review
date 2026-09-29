"""Read-only, catalog-pinned lexical batch for nine unresolved AR parameters.

This scans the already-built public page index. Matches are review leads, never
parameter facts, PD/RD comparisons, findings, or coverage. No OCR is invoked.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
AUDIT_SHA256 = "d4d04dccbbbaa2517d5b34a0b5cb0a54dde4dcc424d9b74ec4a6f5c4313ad8cc"
INDEX_VERSION_HASH = "5f599fc405acfbf9d858"
EXPECTED_COUNTS = {"sources": 203, "pdfSources": 202, "pdfPages": 10142,
                   "textPages": 8668, "ocrPages": 1474}
AR_CODES = ("AR-042", "AR-043", "AR-044", "AR-045", "AR-046", "AR-047",
            "AR-048", "AR-051", "AR-052")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
# Phrase conjunctions retain code-specific meaning; single broad tokens are
# deliberately excluded except the unambiguous acronym КЕО.
_TRIGGERS: dict[str, tuple[str, ...]] = {
    "AR-042": (r"высот\w*\s+.{0,70}(?:коридор\w*|про[её]м\w*|двер\w*)",
               r"(?:коридор\w*|про[её]м\w*|двер\w*)\s+.{0,70}высот\w*"),
    "AR-043": (r"эвакуац\w*\s+.{0,70}двер\w*\s+.{0,70}открыван\w*",
               r"открыван\w*\s+.{0,70}эвакуац\w*\s+.{0,70}двер\w*",
               r"двер\w*\s+.{0,70}открыван\w*\s+.{0,70}эвакуац\w*"),
    "AR-044": (r"кровл\w*\s+.{0,70}(?:пароизоляц\w*|мембран\w*|\bсло(?:й|я|и|ев|ёв)\b)",
               r"(?:пароизоляц\w*|мембран\w*)\s+.{0,70}кровл\w*"),
    "AR-045": (r"уклон\w*\s+.{0,70}кровл\w*",
               r"кровл\w*\s+.{0,70}уклон\w*",
               r"водосточн\w*\s+.{0,70}воронк\w*"),
    "AR-046": (r"ведомост\w*\s+.{0,40}заполнен\w*\s+.{0,30}про[её]м\w*",
               r"спецификац\w*\s+.{0,50}окон\w*",
               r"оконн\w*\s+блок\w*"),
    "AR-047": (r"тамбур\w*\s+.{0,70}глубин\w*",
               r"глубин\w*\s+.{0,70}тамбур\w*"),
    "AR-048": (r"лестничн\w*\s+марш\w*\s+.{0,60}\d",
               r"высот\w*\s+.{0,40}подступен\w*",
               r"(?:ширин\w*|размер\w*)\s+.{0,40}проступ\w*",
               r"(?:числ\w*|количеств\w*)\s+.{0,30}ступен\w*"),
    "AR-051": (r"\bкео\b", r"коэффициент\s+естественн\w*\s+освещ\w*",
               r"светопропускан\w*\s+.{0,50}окон\w*"),
    "AR-052": (r"колористич\w*\s+.{0,50}фасад\w*",
               r"цветов\w*\s+.{0,50}фасад\w*",
               r"фасад\w*\s+.{0,50}(?:цвет\w*|\bral\b)",
               r"\bral\b\s+.{0,50}фасад\w*"),
}
_COMPILED = {code: tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)
             for code, patterns in _TRIGGERS.items()}


class ArUnresolvedBatchError(ValueError):
    """Public index, pinned input, or artifact provenance failed closed."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_pinned(path: Path, expected_sha: str) -> bytes:
    data = path.read_bytes()
    if _sha(data) != expected_sha or path.read_bytes() != data:
        raise ArUnresolvedBatchError(f"pinned input differs: {path.name}")
    return data


def _normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _matched_patterns(code: str, text: str) -> list[str]:
    normalized = _normalize(text)
    return [pattern.pattern for pattern in _COMPILED[code] if pattern.search(normalized)]


def _valid_box(box: Any, width: int, height: int) -> bool:
    return (isinstance(box, list) and len(box) == 4
            and all(type(value) is int for value in box)
            and 0 <= box[0] < box[2] <= width
            and 0 <= box[1] < box[3] <= height)


def _valid_row(row: dict[str, Any], page: dict[str, Any],
               addressed: dict[tuple[int, int], dict[str, Any]]) -> bool:
    key = (row.get("blockIndex"), row.get("lineIndex"))
    line = addressed.get(key)
    return (row.get("kind") == "TABLE_ROW_CANDIDATE"
            and row.get("status") == "CANDIDATE"
            and line is not None and row.get("text") == line.get("text")
            and row.get("bboxMilliPoints") == line.get("bboxMilliPoints")
            and _valid_box(row.get("bboxMilliPoints"), page["widthMilliPoints"],
                           page["heightMilliPoints"]))


def _load_public_manifest(data: bytes) -> list[dict[str, Any]]:
    all_rows = [json.loads(line) for line in data.splitlines() if line.strip()]
    rows = [row for row in all_rows
            if (row.get("split"), row.get("distribution_status"),
                row.get("label_visibility")) == ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN")]
    pdfs = [row for row in rows if row.get("extension") == ".pdf"]
    if (len(rows) != EXPECTED_COUNTS["sources"]
            or len(pdfs) != EXPECTED_COUNTS["pdfSources"]
            or sum(row.get("pdf_pages", 0) for row in pdfs) != EXPECTED_COUNTS["pdfPages"]
            or len({row["file_id"] for row in rows}) != len(rows)):
        raise ArUnresolvedBatchError("public manifest inventory differs from 203-source pin")
    for row in rows:
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
            raise ArUnresolvedBatchError("source outside public allowlist")
        if not _HASH.fullmatch(row.get("sha256", "")):
            raise ArUnresolvedBatchError("source SHA absent")
    txt = [row for row in rows if row.get("extension") == ".txt"]
    if len(txt) != 1 or txt[0]["file_id"] != "F0194" or txt[0]["annotation_status"] != "GROUND_TRUTH_INDEX":
        raise ArUnresolvedBatchError("ground-truth TXT scope differs")
    return rows


def _catalog_entries(catalog: bytes, strategy: dict[str, Any], registry: bytes) -> dict[str, dict[str, Any]]:
    if _sha(catalog) != strategy.get("catalogSha256") or _sha(registry) != strategy.get("registrySha256"):
        raise ArUnresolvedBatchError("catalog or registry differs from strategy pin")
    entries = {entry["parameter_code"]: entry for line in catalog.splitlines()
               if (entry := json.loads(line)).get("parameter_code") in AR_CODES}
    strategies = {entry["parameterCode"]: entry for entry in strategy["entries"]
                  if entry["parameterCode"] in AR_CODES}
    registry_json = json.loads(registry)
    registered = {entry["parameterCode"]: entry for entry in registry_json["entries"]
                  if entry["parameterCode"] in AR_CODES}
    if (set(entries) != set(AR_CODES) or set(strategies) != set(AR_CODES)
            or set(registered) != set(AR_CODES)
            or any(registered[code]["classification"] != "UNRESOLVED" for code in AR_CODES)):
        raise ArUnresolvedBatchError("nine unresolved AR entries are not pinned")
    return {code: {**entries[code], "strategy": strategies[code]} for code in AR_CODES}


def _role(source: dict[str, Any]) -> str:
    stage, section = source["stage"], source["section"]
    if stage == "PD" and section == "AR":
        return "PD_AR_EXACT_MANIFEST"
    if stage == "RD" and section == "AR":
        return "RD_AR_EXACT_MANIFEST"
    if stage == "PD" and section == "OTHER":
        return "PD_SECTION_UNRESOLVED"
    if stage == "RD" and section == "OTHER":
        return "RD_SECTION_UNRESOLVED"
    if stage == "RD_ID_MIXED" and section in {"AR", "OTHER"}:
        return "MIXED_STAGE_SECTION_UNRESOLVED"
    return "INELIGIBLE_MANIFEST_ROLE"


def _audit(audit: dict[str, Any], manifest_sha: str) -> None:
    if (audit.get("schemaVersion") != "public-document-index-audit-v1"
            or audit.get("status") != "PASS" or audit.get("findings") != []
            or audit.get("findingCount") != 0 or audit.get("fatalFindingCount") != 0
            or audit.get("manifestSha256") != manifest_sha
            or audit.get("indexVersionHash") != INDEX_VERSION_HASH):
        raise ArUnresolvedBatchError("complete PASS index audit missing")
    actual = audit.get("actual", {})
    if (actual.get("sourceCount") != 203 or actual.get("completePdfSources") != 202
            or actual.get("indexedPages") != 10142 or actual.get("ftsRows") != 10142
            or actual.get("verifiedPageArtifacts") != 10142):
        raise ArUnresolvedBatchError("public audit inventory incomplete")


def _checked_page(index_root: Path, record: sqlite3.Row, source: dict[str, Any]) -> dict[str, Any]:
    rel = record["artifact_path"]
    if not isinstance(rel, str) or not rel.startswith("pages/") or ".." in Path(rel).parts:
        raise ArUnresolvedBatchError("artifact path outside public index")
    raw = (index_root / rel).read_bytes()
    if _sha(raw) != record["artifact_sha256"]:
        raise ArUnresolvedBatchError("indexed page artifact SHA mismatch")
    page = json.loads(gzip.decompress(raw))
    if (page.get("schemaVersion") != "public-document-index-v1"
            or page.get("inputSha256") != source["sha256"]
            or page.get("pageNumber") != record["page_number"]
            or page.get("indexVersionHash") != INDEX_VERSION_HASH
            or page.get("quality", {}).get("disposition") != record["disposition"]
            or page.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"):
        raise ArUnresolvedBatchError("indexed page metadata differs from pin")
    if not isinstance(page.get("lines"), list) or not isinstance(page.get("tableRowCandidates"), list):
        raise ArUnresolvedBatchError("indexed page lines or rows invalid")
    return page


def _lead(source: dict[str, Any], record: sqlite3.Row, line: dict[str, Any],
          matched: list[str], kind: str) -> dict[str, Any]:
    return {
        "sourceFileId": source["file_id"], "sourceRelativePath": source["relative_path"],
        "sourceSha256": source["sha256"], "objectId": source["object_id"],
        "stage": source["stage"], "manifestSection": source["section"],
        "sourceRole": _role(source), "pageNumber": record["page_number"],
        "pageArtifactSha256": record["artifact_sha256"],
        "parserProvenance": record["parser_provenance"],
        "lineAddress": [line["blockIndex"], line["lineIndex"]],
        "bboxMilliPoints": line["bboxMilliPoints"], "text": line["text"],
        "matchKind": kind, "matchedTriggerPatterns": matched,
        "proofGaps": ["DRAWING_SECTION_UNVERIFIED", "REVISION_UNVERIFIED",
                      "ELEMENT_IDENTITY_UNVERIFIED", "DEFINITION_OR_UNITS_UNVERIFIED",
                      "PD_RD_COMPARABILITY_UNVERIFIED"],
        "disposition": "ABSTAIN_REVIEW_LEAD",
    }


def build_ar_unresolved_batch(
    manifest_path: Path, index_root: Path, audit_path: Path,
    strategy_path: Path, catalog_path: Path, registry_path: Path, *,
    max_leads_per_code: int = 500, max_ocr_queue: int = 24,
) -> dict[str, Any]:
    """Scan 10,142 pinned public page addresses; return review-only report."""
    if not 1 <= max_leads_per_code <= 500 or not 0 <= max_ocr_queue <= 100:
        raise ArUnresolvedBatchError("batch bounds invalid")
    manifest_data = _read_pinned(manifest_path, MANIFEST_SHA256)
    audit_data = _read_pinned(audit_path, AUDIT_SHA256)
    manifest = _load_public_manifest(manifest_data)
    _audit(json.loads(audit_data), _sha(manifest_data))
    strategy_data = strategy_path.read_bytes()
    strategy = json.loads(strategy_data)
    if strategy.get("schemaVersion") != "unresolved-parameter-strategy-v1" or strategy.get("executionPolicy") != "DESIGN_ONLY":
        raise ArUnresolvedBatchError("unresolved strategy must be design-only")
    catalog = _catalog_entries(catalog_path.read_bytes(), strategy, registry_path.read_bytes())
    source_by_id = {row["file_id"]: row for row in manifest}
    database = index_root / "index.sqlite3"
    uri = f"file:{database.resolve().as_posix()}?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": INDEX_VERSION_HASH}:
            raise ArUnresolvedBatchError("public index schema/version differs")
        sources = list(connection.execute("SELECT * FROM sources ORDER BY source_id"))
        if len(sources) != 203:
            raise ArUnresolvedBatchError("public index source count differs")
        for record in sources:
            source = source_by_id.get(record["source_id"])
            if source is None or any(record[column] != source[field] for column, field in (
                ("object_id", "object_id"), ("stage", "stage"), ("section", "section"),
                ("relative_path", "relative_path"), ("source_sha256", "sha256"),
                ("byte_size", "size_bytes"))):
                raise ArUnresolvedBatchError("index source differs from public manifest")
        page_records = list(connection.execute("SELECT * FROM pages ORDER BY source_id,page_number"))
        if len(page_records) != 10142:
            raise ArUnresolvedBatchError("public index page count differs")
        role_sources: dict[str, list[str]] = defaultdict(list)
        for source in manifest:
            if source["extension"] == ".pdf":
                role_sources[_role(source)].append(source["file_id"])
        counts: dict[str, Counter[str]] = {code: Counter() for code in AR_CODES}
        leads: dict[str, list[dict[str, Any]]] = {code: [] for code in AR_CODES}
        line_matched_pages: dict[str, set[tuple[str, int]]] = {code: set() for code in AR_CODES}
        invalid_rows = 0
        invalid_lines = 0
        inventory = Counter()
        ocr_records: list[sqlite3.Row] = []
        for record in page_records:
            source = source_by_id[record["source_id"]]
            if source["extension"] != ".pdf" or record["source_sha256"] != source["sha256"]:
                raise ArUnresolvedBatchError("page source differs from public manifest")
            if record["disposition"] not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}:
                raise ArUnresolvedBatchError("page quality disposition unknown")
            inventory["textPages" if record["disposition"] == "TEXT_LAYER_CANDIDATE" else "ocrPages"] += 1
            if record["disposition"] == "OCR_REQUIRED":
                ocr_records.append(record)
            page = _checked_page(index_root, record, source)
            if record["disposition"] != "TEXT_LAYER_CANDIDATE":
                continue
            width, height = page["widthMilliPoints"], page["heightMilliPoints"]
            addressed = {}
            for line in page["lines"]:
                key = (line.get("blockIndex"), line.get("lineIndex"))
                if key in addressed:
                    raise ArUnresolvedBatchError("duplicate indexed line address")
                if not _valid_box(line.get("bboxMilliPoints"), width, height):
                    invalid_lines += 1
                    continue
                addressed[key] = line
            valid_rows = set()
            for row in page["tableRowCandidates"]:
                if _valid_row(row, page, addressed):
                    valid_rows.add((row["blockIndex"], row["lineIndex"]))
                else:
                    invalid_rows += 1
            for key, line in addressed.items():
                for code in AR_CODES:
                    matches = _matched_patterns(code, line["text"])
                    if not matches:
                        continue
                    kind = "GEOMETRIC_TABLE_ROW" if key in valid_rows else "TEXT_LINE"
                    counts[code][kind] += 1
                    counts[code]["matchedLines"] += 1
                    counts[code][_role(source)] += 1
                    line_matched_pages[code].add((source["file_id"], record["page_number"]))
                    if len(leads[code]) < max_leads_per_code:
                        leads[code].append(_lead(source, record, line, matches, kind))
        if inventory != {"textPages": 8668, "ocrPages": 1474}:
            raise ArUnresolvedBatchError("public index quality totals differ")
    except sqlite3.DatabaseError as error:
        raise ArUnresolvedBatchError("public index SQLite invalid") from error
    finally:
        if "connection" in locals():
            connection.close()

    by_object: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for source in manifest:
        if source["extension"] == ".pdf":
            by_object[source["object_id"]][_role(source)].append(source["file_id"])
    pairs = [{"objectId": object_id,
              "pdArSourceIds": sorted(roles.get("PD_AR_EXACT_MANIFEST", [])),
              "rdArSourceIds": sorted(roles.get("RD_AR_EXACT_MANIFEST", [])),
              "pdUnresolvedSourceIds": sorted(roles.get("PD_SECTION_UNRESOLVED", [])),
              "rdUnresolvedSourceIds": sorted(roles.get("RD_SECTION_UNRESOLVED", [])),
              "mixedSourceIds": sorted(roles.get("MIXED_STAGE_SECTION_UNRESOLVED", []))}
             for object_id, roles in sorted(by_object.items())]
    exact_pairs = sum(bool(item["pdArSourceIds"] and item["rdArSourceIds"]) for item in pairs)
    code_reports = []
    for code in AR_CODES:
        item = catalog[code]
        code_reports.append({
            "parameterCode": code, "parameterName": item["parameter_name"],
            "unit": item["unit"], "catalogTrigger": item["trigger"],
            "candidateExtractorFamily": item["strategy"]["candidateExtractorFamily"],
            "specificProofDependency": item["strategy"]["specificProofDependency"],
            "triggerPatterns": list(_TRIGGERS[code]),
            "sameObjectExactPdRdArPairCount": exact_pairs,
            "scanCounts": dict(sorted(counts[code].items())),
            "matchedPageCount": len(line_matched_pages[code]),
            "leadDisplayCount": len(leads[code]),
            "leadsTruncated": counts[code]["matchedLines"] > len(leads[code]),
            "leads": leads[code],
            "proofGaps": ["NO_EXACT_RD_AR_MANIFEST_SOURCE", "DRAWING_SECTION_UNVERIFIED",
                          "REVISION_UNVERIFIED", "ELEMENT_IDENTITY_UNVERIFIED",
                          "DEFINITION_OR_UNITS_UNVERIFIED", "PD_RD_COMPARABILITY_UNVERIFIED"],
            "disposition": "ABSTAIN",
        })
    queue = []
    for record in ocr_records:
        source = source_by_id[record["source_id"]]
        role = _role(source)
        if role not in {"PD_AR_EXACT_MANIFEST", "PD_SECTION_UNRESOLVED",
                        "RD_SECTION_UNRESOLVED", "MIXED_STAGE_SECTION_UNRESOLVED"}:
            continue
        adjacent = sum((source["file_id"], neighbor) in line_matched_pages[code]
                       for code in AR_CODES for neighbor in range(max(1, record["page_number"] - 2),
                                                                   record["page_number"] + 3))
        # An unclassified RD title is not reason to OCR every page. Outside
        # exact PD/AR, require a nearby code-specific text-layer lead first.
        if role != "PD_AR_EXACT_MANIFEST" and adjacent == 0:
            continue
        priority = (0 if role == "PD_AR_EXACT_MANIFEST" else
                    1 if role == "RD_SECTION_UNRESOLVED" else
                    2 if role == "MIXED_STAGE_SECTION_UNRESOLVED" else 3)
        queue.append((priority, -adjacent, source["file_id"], record["page_number"], {
            "sourceFileId": source["file_id"], "sourceSha256": source["sha256"],
            "sourceRelativePath": source["relative_path"], "objectId": source["object_id"],
            "stage": source["stage"], "manifestSection": source["section"],
            "sourceRole": role, "pageNumber": record["page_number"],
            "pageArtifactSha256": record["artifact_sha256"],
            "adjacentCodeLeadCount": adjacent,
            "reason": "OCR_REQUIRED_IN_AR_SOURCE_ROLE; target page only; section and comparison remain unverified",
            "disposition": "QUEUED_REVIEW_ONLY",
        }))
    queue.sort(key=lambda item: item[:4])
    return {
        "schemaVersion": "ar-unresolved-public-batch-v1", "status": "REVIEW_ONLY_ABSTAIN",
        "manifestSha256": MANIFEST_SHA256, "auditSha256": AUDIT_SHA256,
        "indexVersionHash": INDEX_VERSION_HASH,
        "strategySha256": _sha(strategy_data),
        "catalogSha256": strategy["catalogSha256"],
        "registrySha256": strategy["registrySha256"],
        "inventory": {"sources": 203, "pdfSources": 202, "pdfPages": 10142,
                      "textPages": inventory["textPages"], "ocrPages": inventory["ocrPages"],
                      "geometricallyInvalidLinesSkipped": invalid_lines,
                      "geometricallyInvalidTableRows": invalid_rows},
        "sourceRoles": {role: sorted(ids) for role, ids in sorted(role_sources.items())},
        "objectSourceRoles": pairs, "sameObjectExactPdRdArPairCount": exact_pairs,
        "codes": code_reports,
        "targetedOcrQueue": {"eligiblePageCount": len(queue), "displayCount": min(len(queue), max_ocr_queue),
                             "queueTruncated": len(queue) > max_ocr_queue,
                             "pages": [item[4] for item in queue[:max_ocr_queue]],
                             "executionPolicy": "PLAN_ONLY"},
        "findingCount": None, "parameterCoverage": None,
    }
