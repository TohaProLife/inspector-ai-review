"""Read-only public-index triage for 20 unresolved PZ/SPZU codes.

FTS selects pages, SHA-checked page artifacts supply bounded lexical leads.
Every code remains ABSTAIN until source role, revision and semantic comparison
are proven. No finding, coverage or negative conclusion is emitted.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from .kr_decrease_batch import EXPECTED_PUBLIC_COUNTS, _require_pass_audit
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest,
    readonly_index_uri,
)


EXPECTED_CODES = (
    "PZ-001", "PZ-003", "PZ-005", "PZ-006", "PZ-009", "PZ-011",
    "PZ-013", "PZ-019", "PZ-020", "SPZU-026", "SPZU-027",
    "SPZU-028", "SPZU-029", "SPZU-031", "SPZU-032", "SPZU-033",
    "SPZU-034", "SPZU-035", "SPZU-036", "SPZU-038",
)
# FTS terms are a broad retrieval envelope. A separate, more specific line
# expression determines whether a selected page has a lexical lead.
FTS_TERMS = {
    "PZ-001": ("застройк*", "контур*"),
    "PZ-003": ("полезн*", "расчетн*", "расчётн*"),
    "PZ-005": ("подземн*", "паркинг*", "подвал*"),
    "PZ-006": ("этажност*", "этаж*", "объем*", "объём*"),
    "PZ-009": ("абсолютн*", "отметк*", "геоподоснов*"),
    "PZ-011": ("квартирограф*", "квартир*", "однокомнатн*",
               "двухкомнатн*", "трехкомнатн*", "трёхкомнатн*"),
    "PZ-013": ("мощност*", "вместимост*", "школ*", "детск*"),
    "PZ-019": ("коэффициент*", "застройк*"),
    "PZ-020": ("коэффициент*", "плотност*"),
    "SPZU-026": ("мощени*", "тротуар*", "покрыти*"),
    "SPZU-027": ("озеленени*", "газон*", "насаждени*"),
    "SPZU-028": ("детск*", "спортивн*", "площадк*"),
    "SPZU-029": ("маф", "скамейк*", "архитектурн*"),
    "SPZU-031": ("радиус*", "поворот*", "проезд*"),
    "SPZU-032": ("асфальт*", "щебн*", "дорожн*"),
    "SPZU-033": ("уклон*", "водоотвод*", "рельеф*"),
    "SPZU-034": ("подключени*", "врезк*", "координат*"),
    "SPZU-035": ("охранн*", "зон*", "коммуникац*"),
    "SPZU-036": ("ограждени*", "забор*", "ворот*"),
    "SPZU-038": ("мгн", "машино*", "парковочн*"),
}
LINE_PATTERNS = {
    "PZ-001": r"площад[ьи]\s+застройк\w*|контур\w*\s+здани\w*|пятн\w*\s+застройк\w*",
    "PZ-003": r"(?:полезн\w*|расч[её]тн\w*)\s+площад(?:ь|и|ью|ей)\b(?!\s+(?:тушени\w*|орошени\w*))",
    "PZ-005": r"(?:строительн\w*\s+)?об[ъь]?[её]м\w*\s+(?:подземн\w*|паркинг\w*|подвал\w*)|подземн\w*\s+об[ъь]?[её]м\w*",
    "PZ-006": r"этажност\w*|количеств\w*\s+этаж\w*|надземн\w*\s+об[ъь]?[её]м\w*",
    "PZ-009": r"абсолютн\w*\s+отметк\w*|отметк\w*\s+0[.,]000|условн\w*\s+нул\w*",
    "PZ-011": r"квартирограф\w*|(?:количеств\w*|числ\w*)\s+квартир\w*|квартир\w*\s+по\s+типам|однокомнатн\w*|двухкомнатн\w*|тр[её]хкомнатн\w*|квартир\w*[- ]студи\w*",
    "PZ-013": r"технологическ\w*\s+мощност\w*|проектн\w*\s+вместимост\w*|производственн\w*\s+мощност\w*|(?:школ\w*|детск\w*\s+сад)\s+на\s+\d+\s+мест",
    "PZ-019": r"коэффициент\w*\s+застройк\w*|\bКЗ\s*[=:]",
    "PZ-020": r"коэффициент\w*\s+использовани\w*\s+территори\w*|\bКИТ\s*[=:]|плотност\w*\s+застройк\w*",
    "SPZU-026": r"площад\w*\s+(?:мощени\w*|(?:твердых\s+)?покрыти\w*)|мощени\w*\s+(?:тротуар\w*|площад\w*)",
    "SPZU-027": r"площад\w*\s+озеленени\w*|процент\w*\s+озеленени\w*|зелен\w*\s+насаждени\w*",
    "SPZU-028": r"детск\w*\s+площадк\w*|спортивн\w*\s+площадк\w*|площадк\w*\s+(?:отдыха|спорта)",
    "SPZU-029": r"\bМАФ\b|мал\w*\s+архитектурн\w*\s+форм\w*|спецификаци\w*\s+скамеек",
    "SPZU-031": r"радиус\w*\s+(?:поворот\w*|закруглени\w*)|пожарн\w*\s+проезд\w*",
    "SPZU-032": r"дорожн\w*\s+одежд\w*|сло\w*\s+(?:асфальт\w*|щебн\w*)|толщин\w*\s+асфальт\w*",
    "SPZU-033": r"уклон\w*\s+(?:дорог\w*|проезд\w*|покрыти\w*)|план\s+организаци\w*\s+рельеф\w*|водоотвод\w*",
    "SPZU-034": r"точк\w*\s+(?:подключени\w*|врезк\w*)|координат\w*\s+(?:подключени\w*|врезк\w*)",
    "SPZU-035": r"охранн\w*\s+зон\w*|зон\w*\s+охран\w*\s+(?:коммуникаци\w*|сет\w*)",
    "SPZU-036": r"ограждени\w*\s+(?:территори\w*|участк\w*)|высот\w*\s+ограждени\w*|шумозащитн\w*\s+(?:экран\w*|ограждени\w*)",
    "SPZU-038": r"машино.?мест\w*\s+(?:для\s+)?МГН|парковочн\w*\s+мест\w*\s+(?:для\s+)?МГН|мест\w*\s+для\s+инвалид\w*",
}
COMPILED = {code: re.compile(value, re.IGNORECASE) for code, value in LINE_PATTERNS.items()}
FTS_TERM_RE = re.compile(r"[^\W_]+\*?\Z", re.UNICODE)
PZ_GP_CODES = frozenset({"PZ-001", "PZ-019", "PZ-020"})


class PzSpzuUnresolvedBatchError(ValueError):
    """Public source, report or page evidence failed a required gate."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_strategy_report(
    report_path: Path, catalog_path: Path, registry_path: Path,
    strategy_path: Path, manifest_bytes: bytes,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    report_bytes = report_path.read_bytes()
    report = json.loads(report_bytes)
    if not isinstance(report, dict) or report.get("schemaVersion") != "unresolved-parameter-strategy-report-v1":
        raise PzSpzuUnresolvedBatchError("unresolved strategy report schema invalid")
    content = {key: value for key, value in report.items() if key != "reportSha256"}
    expected_hash = _sha((json.dumps(content, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")) + "\n").encode("utf-8"))
    if report.get("reportSha256") != expected_hash:
        raise PzSpzuUnresolvedBatchError("strategy report content hash invalid")
    pins = {"catalog": _sha(catalog_path.read_bytes()),
            "registry": _sha(registry_path.read_bytes()),
            "strategy": _sha(strategy_path.read_bytes()),
            "manifest": _sha(manifest_bytes)}
    if report.get("inputSha256") != pins:
        raise PzSpzuUnresolvedBatchError("strategy report input SHA drift")
    registry = json.loads(registry_path.read_bytes())
    if (registry.get("schemaVersion") != "parameter-family-registry-v1"
            or registry.get("executionPolicy") != "DESIGN_ONLY"
            or registry.get("catalogSha256") != pins["catalog"]):
        raise PzSpzuUnresolvedBatchError("registry catalog pin or policy invalid")
    design = json.loads(strategy_path.read_bytes())
    if (design.get("schemaVersion") != "unresolved-parameter-strategy-v1"
            or design.get("executionPolicy") != "DESIGN_ONLY"
            or design.get("catalogSha256") != pins["catalog"]
            or design.get("registrySha256") != pins["registry"]):
        raise PzSpzuUnresolvedBatchError("strategy design pin or policy invalid")
    entries = {row["parameterCode"]: row for row in report.get("parameters", [])
               if isinstance(row, dict) and row.get("parameterCode") in EXPECTED_CODES}
    registry_entries = {row["parameterCode"]: row for row in registry.get("entries", [])
                        if isinstance(row, dict) and row.get("parameterCode") in EXPECTED_CODES}
    if (len(report.get("parameters", [])) != 80
            or len(entries) != len(EXPECTED_CODES)
            or len(registry_entries) != len(EXPECTED_CODES)
            or set(entries) != set(EXPECTED_CODES)
            or set(FTS_TERMS) != set(EXPECTED_CODES)
            or set(LINE_PATTERNS) != set(EXPECTED_CODES)):
        raise PzSpzuUnresolvedBatchError("exact 20 unresolved PZ/SPZU codes required")
    for code in EXPECTED_CODES:
        entry = entries[code]
        if (registry_entries[code].get("classification") != "UNRESOLVED"
                or entry.get("executionStatus") != "DESIGN_ONLY"
                or entry.get("sourceAvailability", {}).get("verifiedComparablePair") is not False
                or entry.get("sourceAvailability", {}).get("metadataDisposition")
                != "CATALOG_SECTION_MAPPING_UNRESOLVED"):
            raise PzSpzuUnresolvedBatchError(f"{code} source/status gate changed")
    return entries, {"reportSha256": _sha(report_bytes), **{key + "Sha256": value
                                                       for key, value in pins.items()}}


def _fts_query(terms: tuple[str, ...]) -> str:
    if not terms or any(not FTS_TERM_RE.fullmatch(term) for term in terms):
        raise PzSpzuUnresolvedBatchError("unsafe FTS terms")
    return " OR ".join(f'"{term[:-1]}"*' if term.endswith("*") else f'"{term}"'
                       for term in terms)


def _read_index(
    index_root: Path, public: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise PzSpzuUnresolvedBatchError("public index database missing")
    hits = {}
    ocr = []
    try:
        with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            meta = dict(connection.execute(
                "SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise PzSpzuUnresolvedBatchError("public index schema/version mismatch")
            source_rows = {row["source_id"]: row for row in connection.execute(
                "SELECT * FROM sources WHERE status='COMPLETE'")}
            if len(source_rows) != len(public) or set(source_rows) != set(public):
                raise PzSpzuUnresolvedBatchError("public PDF source inventory differs from audited manifest")
            for source_id, row in public.items():
                source = source_rows[source_id]
                required = (("object_id", "object_id"), ("stage", "stage"),
                            ("section", "section"), ("source_sha256", "sha256"),
                            ("relative_path", "relative_path"), ("byte_size", "size_bytes"),
                            ("expected_pages", "pdf_pages"))
                if (any(source[column] != row[field] for column, field in required)
                        or source["observed_pages"] != row["pdf_pages"]):
                    raise PzSpzuUnresolvedBatchError(f"{source_id} source metadata drift")
            for code in EXPECTED_CODES:
                query = _fts_query(FTS_TERMS[code])
                hits[code] = [dict(row) for row in connection.execute(
                    "SELECT f.source_id,f.page_number,p.artifact_sha256,p.disposition,"
                    "bm25(page_fts) AS rank "
                    "FROM page_fts f JOIN pages p ON p.source_id=f.source_id "
                    "AND p.page_number=f.page_number JOIN sources s ON s.source_id=f.source_id "
                    "WHERE page_fts MATCH ? AND s.status='COMPLETE' "
                    "AND p.disposition='TEXT_LAYER_CANDIDATE' "
                    "ORDER BY rank,f.source_id,f.page_number", (query,))]
                if any(item["source_id"] not in public for item in hits[code]):
                    raise PzSpzuUnresolvedBatchError("FTS exposed source outside public allowlist")
            ocr = [dict(row) for row in connection.execute(
                "SELECT source_id,page_number,source_sha256,artifact_sha256 "
                "FROM pages WHERE disposition='OCR_REQUIRED' ORDER BY source_id,page_number")]
            if any(item["source_id"] not in public
                   or item["source_sha256"] != public[item["source_id"]]["sha256"]
                   for item in ocr):
                raise PzSpzuUnresolvedBatchError("OCR inventory differs from public manifest")
    except sqlite3.DatabaseError as error:
        raise PzSpzuUnresolvedBatchError("public index FTS database invalid") from error
    return hits, ocr


def _choose_pages(
    code: str, hits: list[dict[str, Any]], public: dict[str, dict[str, Any]],
    max_pages: int,
) -> list[dict[str, Any]]:
    """Balance objects/stages; prefer plausible manifest sections within bucket."""
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for hit in hits:
        row = public[hit["source_id"]]
        buckets[(row["object_id"], row["stage"])].append(hit)
    preferred = (("GP", "OTHER") if code.startswith("SPZU-") or code in PZ_GP_CODES
                 else ("OTHER", "GP", "AR", "KR"))

    def path_hint(source_id: str) -> int:
        row = public[source_id]
        if row["stage"] != "PD":
            return 1
        if code.startswith("SPZU-") or code in PZ_GP_CODES:
            return 0 if row["section"] == "GP" or "пзу" in row["relative_path"].casefold() else 1
        path = row["relative_path"].casefold()
        return 0 if ("пояснительная записка" in path
                     or path.endswith("-пз.pdf") or path.endswith("-опз.pdf")) else 1

    for group in buckets.values():
        group.sort(key=lambda hit: (
            path_hint(hit["source_id"]),
            preferred.index(public[hit["source_id"]]["section"])
            if public[hit["source_id"]]["section"] in preferred else 99,
            hit["rank"], hit["source_id"], hit["page_number"],
        ))
    objects = sorted({row["object_id"] for row in public.values()})
    stages = ("PD", "RD", "RD_ID_MIXED", "ID", "UNKNOWN")
    order = [(obj, stage) for stage in stages for obj in objects if (obj, stage) in buckets]
    selected = []
    offsets = {key: 0 for key in buckets}
    while len(selected) < max_pages:
        advanced = False
        for key in order:
            offset = offsets[key]
            if offset < len(buckets[key]):
                selected.append(buckets[key][offset])
                offsets[key] += 1
                advanced = True
                if len(selected) == max_pages:
                    break
        if not advanced:
            break
    return selected


def evaluate_pz_spzu_unresolved_batch(
    manifest_path: Path, index_root: Path, audit_path: Path,
    strategy_report_path: Path, catalog_path: Path, registry_path: Path,
    strategy_path: Path, *, max_pages_per_code: int = 16,
    max_lines_per_page: int = 3, max_ocr_queue: int = 80,
    _expected_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    if (type(max_pages_per_code) is not int or not 1 <= max_pages_per_code <= 60
            or type(max_lines_per_page) is not int or not 1 <= max_lines_per_page <= 10
            or type(max_ocr_queue) is not int or not 1 <= max_ocr_queue <= 500):
        raise PzSpzuUnresolvedBatchError("invalid bounded selection limits")
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise PzSpzuUnresolvedBatchError("public manifest changed during read")
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    if not isinstance(audit, dict):
        raise PzSpzuUnresolvedBatchError("audit must be JSON object")
    _require_pass_audit(audit, manifest_bytes, rows,
                        EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts)
    entries, pins = _load_strategy_report(
        strategy_report_path, catalog_path, registry_path, strategy_path, manifest_bytes)
    public = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    hits, ocr = _read_index(index_root, public)
    code_reports: dict[str, Any] = {}

    @lru_cache(maxsize=32)
    def checked_page(source_id: str, number: int) -> dict[str, Any]:
        indexed = get_indexed_page(index_root, source_id, number)
        row = public[source_id]
        source, page = indexed["source"], indexed["page"]
        if (source["status"] != "COMPLETE"
                or source["source_sha256"] != row["sha256"]
                or (source["object_id"], source["stage"], source["section"],
                    source["relative_path"])
                != (row["object_id"], row["stage"], row["section"], row["relative_path"])
                or page["pageNumber"] != number
                or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"
                or page["inputSha256"] != row["sha256"]):
            raise PzSpzuUnresolvedBatchError("indexed page provenance mismatch")
        return indexed

    selected_by_source: dict[str, list[int]] = defaultdict(list)
    for code in EXPECTED_CODES:
        lexical = []
        all_matching_lines = 0
        for item in hits[code]:
            source_id, number = item["source_id"], item["page_number"]
            indexed = checked_page(source_id, number)
            matches = [line for line in indexed["page"]["lines"]
                       if COMPILED[code].search(line["text"])]
            if matches:
                all_matching_lines += len(matches)
                lexical.append({**item, "matchingLineCount": len(matches),
                                "matchedLines": matches[:max_lines_per_page]})
        selected = _choose_pages(code, lexical, public, max_pages_per_code)
        leads = []
        for item in selected:
            source_id, number = item["source_id"], item["page_number"]
            row = public[source_id]
            indexed = checked_page(source_id, number)
            selected_by_source[source_id].append(number)
            for line in item["matchedLines"]:
                text = line["text"]
                leads.append({
                    "objectId": row["object_id"], "sourceFileId": source_id,
                    "sourceSha256": row["sha256"], "sourceRelativePath": row["relative_path"],
                    "stage": row["stage"], "section": row["section"],
                    "pageNumber": number, "pageArtifactSha256": item["artifact_sha256"],
                    "parserProvenance": indexed["parserProvenance"],
                    "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                    "bboxMilliPoints": line["bboxMilliPoints"],
                    "lineSha256": _sha(text.encode("utf-8")),
                    "text": text[:300], "textTruncated": len(text) > 300,
                    "revisionStatus": "UNVERIFIED", "catalogSourceRoleStatus": "UNRESOLVED",
                    "sameObjectPairStatus": "UNPROVEN", "status": "ABSTAIN",
                })
        if len({(item["source_id"], item["page_number"]) for item in hits[code]}) != len(hits[code]):
            raise PzSpzuUnresolvedBatchError("duplicate FTS page address")
        entry = entries[code]
        code_reports[code] = {
            "candidateExtractorFamily": entry["candidateExtractorFamily"],
            "registryReasonCode": entry["registryReasonCode"],
            "specificProofDependency": entry["nextProofGate"],
            "sourceAvailability": entry["sourceAvailability"],
            "ftsTerms": list(FTS_TERMS[code]),
            "ftsMatchedTextPages": len(hits[code]),
            "lexicalMatchedTextPages": len(lexical),
            "selectedTextPages": len(selected),
            "ftsPagesWithoutLineLead": len(hits[code]) - len(lexical),
            "omittedLexicalTextPages": len(lexical) - len(selected),
            "matchingLinesInAllFtsPages": all_matching_lines,
            "shownLines": len(leads),
            "omittedMatchingLines": all_matching_lines - len(leads),
            "leads": leads, "status": "ABSTAIN",
        }
    # OCR is ranked only near line leads. A same-source page is a request for
    # targeted review, never an assertion of presence or absence of a code.
    ocr_near = []
    for item in ocr:
        pages = selected_by_source.get(item["source_id"], [])
        if not pages:
            continue
        distance = min(abs(item["page_number"] - page) for page in pages)
        if distance <= 2:
            row = public[item["source_id"]]
            ocr_near.append({"objectId": row["object_id"],
                             "sourceFileId": item["source_id"],
                             "stage": row["stage"], "section": row["section"],
                             "pageNumber": item["page_number"],
                             "sourceSha256": row["sha256"],
                             "pageArtifactSha256": item["artifact_sha256"],
                             "distanceToSelectedTextPage": distance,
                             "status": "OCR_REQUIRED_UNKNOWN"})
    ocr_near.sort(key=lambda item: (item["distanceToSelectedTextPage"],
                                    item["sourceFileId"], item["pageNumber"]))
    for item in ocr_near[:max_ocr_queue]:
        source_id, number = item["sourceFileId"], item["pageNumber"]
        indexed = get_indexed_page(index_root, source_id, number)
        if (indexed["source"]["source_sha256"] != item["sourceSha256"]
                or indexed["page"]["pageNumber"] != number
                or indexed["page"]["quality"]["disposition"] != "OCR_REQUIRED"):
            raise PzSpzuUnresolvedBatchError("queued OCR page provenance mismatch")
    if (manifest_path.read_bytes() != manifest_bytes
            or audit_path.read_bytes() != audit_bytes
            or _sha(strategy_report_path.read_bytes()) != pins["reportSha256"]
            or _sha(catalog_path.read_bytes()) != pins["catalogSha256"]
            or _sha(registry_path.read_bytes()) != pins["registrySha256"]
            or _sha(strategy_path.read_bytes()) != pins["strategySha256"]):
        raise PzSpzuUnresolvedBatchError("inputs changed during batch")
    return {
        "schemaVersion": "pz-spzu-unresolved-public-batch-v1",
        "purpose": "REVIEW_ONLY", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "manifestSha256": _sha(manifest_bytes), "auditSha256": _sha(audit_bytes),
        "indexVersionHash": _version_hash(), **pins,
        "sourceCount": len(rows), "pdfSources": len(public),
        "pdfPages": sum(row["pdf_pages"] for row in public.values()),
        "ocrRequiredPagesInCorpus": len(ocr),
        "ocrNearSelectedPages": len(ocr_near),
        "ocrQueue": ocr_near[:max_ocr_queue],
        "ocrQueueOmitted": len(ocr_near) - min(len(ocr_near), max_ocr_queue),
        "limits": {"maxPagesPerCode": max_pages_per_code,
                   "maxLinesPerPage": max_lines_per_page,
                   "maxOcrQueue": max_ocr_queue},
        "selectionPolicy": "BALANCED_OBJECT_STAGE_WITH_UNVERIFIED_FILENAME_HINT",
        "codeReports": code_reports,
        "overallStatus": "ABSTAIN", "findingCount": None,
        "parameterCoverage": None,
    }
