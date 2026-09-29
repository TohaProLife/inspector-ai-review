"""Bounded SHA-checked public POD/OOS lexical triage; never evaluates rules."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from contextlib import closing
from pathlib import Path
from typing import Any

from .numeric_label_probe import _audit_gate
from .public_document_index import get_indexed_page, load_public_manifest, readonly_index_uri


CODES = ("POD-090", "POD-091", "POD-094", "POD-096", "POD-097",
         "OOS-098", "OOS-099", "OOS-100", "OOS-101")
PAGE_CAP_PER_CODE = 16
OCR_PROPOSAL_CAP = 8
OOS_FILENAME_HINT_IDS = frozenset({"F0114", "F0115", "F0189", "F0190", "F0191", "F0192"})

# FTS is used only to queue pages. All matches must be checked against the
# original indexed page artifact, with explicit unexamined-page counts.
FTS_TERMS = {
    "POD-090": ('"зона развала"', '"зоны развала"', '"план сноса"', '"снос"', '"демонтаж"'),
    "POD-091": ('"метод демонтажа"', '"последовательность демонтажа"', '"демонтаж"', '"разборка"', '"снос"'),
    "POD-094": ('"опасные отходы"', '"класс опасности"', '"отходы"', '"утилизация"'),
    "POD-096": ('"временные подпорки"', '"расчленение"', '"подпорки"', '"крепления"'),
    "POD-097": ('"складирование лома"', '"строительный мусор"', '"мусор"', '"котлована"'),
    "OOS-098": ('"ОСИГ"', '"разрешение на перемещение"', '"ОСС"', '"лимиты"'),
    "OOS-099": ('"ГЛОНАСС"', '"РНИС"', '"самосвал"', '"телеметрия"'),
    "OOS-100": ('"КПТС"', '"QR"', '"весовой контроль"', '"самосвал"'),
    "OOS-101": ('"ГРОО"', '"полигон"', '"утилизация"', '"отходы"'),
}

PATTERN_TEXT = {
    "POD-090": (r"(?:зон\w*\s+развал|развал\w*\s+зон|обрушен\w*\s+конструкц)",
                r"(?:демонтаж|(?<![а-яё])снос(?:а|у|ом|е)?(?![а-яё])|опасн\w*\s+зон)"),
    "POD-091": (r"(?:метод\w*.*демонтаж|демонтаж\w*.*метод|последоват\w*.*демонтаж|демонтаж\w*.*последоват)",
                r"(?:демонтаж|разборк|(?<![а-яё])снос(?:а|у|ом|е)?(?![а-яё]))"),
    "POD-094": (r"(?:класс\w*\s+опасност\w*.*отход|отход\w*.*класс\w*\s+опасност)",
                r"(?:класс\w*\s+опасност|опасн\w*\s+отход|утилиз|отход)"),
    "POD-096": (r"(?:временн\w*\s+подпорк|расчленен\w*.*конструкц)",
                r"(?:подпорк|креплен\w*.*конструкц|демонтаж\w*.*креплен)"),
    "POD-097": (r"(?:складир\w*.*(?:(?<![а-яё])лом(?:а|у|ом|е)?(?![а-яё])|мусор)|(?:(?<![а-яё])лом(?:а|у|ом|е)?(?![а-яё])|мусор).*складир)",
                r"(?:строительн\w*\s+мусор|откос\w*\s+котлован|бровк\w*\s+котлован|(?<![а-яё])лом(?:а|у|ом|е)?(?![а-яё]))"),
    "OOS-098": (r"(?:осиг|разрешен\w*.*перемещен\w*.*(?:отход|осс))",
                r"(?:разрешен\w*\s+на\s+перемещен|\bосс\b|лимит\w*.*отход)"),
    "OOS-099": (r"(?:глонасс|\bрнис\b)", r"(?:самосвал|трекер|телеметр)"),
    "OOS-100": (r"(?:\bкптс\b|qr.{0,30}самосвал|самосвал.{0,30}qr)",
                r"(?:\bqr\b|весов\w*\s+контрол|самосвал)"),
    "OOS-101": (r"(?:\bгроо\b|полигон\w*.*утилиз|утилиз\w*.*полигон)",
                r"(?:полигон|утилиз|отход)"),
}
PATTERNS = {code: tuple(re.compile(value, re.IGNORECASE) for value in pair)
            for code, pair in PATTERN_TEXT.items()}

PROOF_GATES = {
    "POD-090": ["demolition_hazard_polygon", "site_and_pedestrian_boundary_same_coordinates",
                "same_object_PPR_demolition_plan"],
    "POD-091": ["PD_demolition_method", "same_operation_PPR_and_execution_method",
                "approval_for_changed_method"],
    "POD-094": ["waste_class_and_mass_per_material", "same_batch_PPR_and_ID_tickets",
                "licensed_disposal_or_classification_proof"],
    "POD-096": ["same_temporary_support_element", "dimensions_and_section_capacity",
                "RD_detail_and_mounting_act"],
    "POD-097": ["debris_storage_footprint", "excavation_edge_or_live_network_geometry",
                "material_mass_and_work_phase"],
    "OOS-098": ["authorized_OSIG_snapshot", "permit_status_and_validity_time",
                "same_site_work_start_event"],
    "OOS-099": ["authorized_RNIS_or_OSIG_trip_snapshot", "vehicle_and_tracker_identity",
                "same_trip_time_and_route"],
    "OOS-100": ["authorized_mobile_KPTS_event_snapshot", "same_truck_exit_and_QR_event",
                "event_time_and_source_identity"],
    "OOS-101": ["authorized_landfill_or_GROO_snapshot", "same_waste_batch_and_destination",
                "TRPO_inclusion_and_license_validity"],
}


def _sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def classify_line(code: str, raw_text: str) -> str | None:
    if code not in PATTERNS or not isinstance(raw_text, str):
        raise ValueError("unknown POD/OOS code or invalid text")
    text = " ".join(raw_text.split()).casefold()
    if PATTERNS[code][0].search(text):
        return "EXACT_LEXICAL_ANCHOR"
    if PATTERNS[code][1].search(text):
        return "NEAR_TOPIC_MENTION"
    return None


def _source_role(row: dict[str, Any]) -> str:
    if row["section"] in {"POD", "OOS"}:
        return "EXACT_MANIFEST_SECTION"
    if row["file_id"] in OOS_FILENAME_HINT_IDS:
        return "OOS_FILENAME_HINT_ONLY"
    return "MANIFEST_SECTION_UNRESOLVED_OR_OTHER"


def select_addresses(hits: dict[tuple[str, int], set[str]], rows: dict[str, dict[str, Any]],
                     code: str, *, cap: int = PAGE_CAP_PER_CODE) -> list[tuple[str, int]]:
    """Deterministic, bounded, source-diverse FTS research queue."""
    if code not in CODES or not 1 <= cap <= 64:
        raise ValueError("invalid code or page cap")
    is_oos = code.startswith("OOS-")

    def rank(address: tuple[str, int]) -> tuple[int, int, int, str, int]:
        source_id, page = address
        row = rows[source_id]
        terms = hits[address]
        # Multiword terms are more specific. A source filename is only a hint.
        specificity = max(len(term.strip('"').split()) for term in terms)
        source_hint = int(is_oos and source_id in OOS_FILENAME_HINT_IDS)
        stage_hint = int(row["stage"] == "PD")
        return (-specificity, -source_hint, -stage_hint, source_id, page)

    ordered = sorted(hits, key=rank)
    selected: list[tuple[str, int]] = []
    per_source = Counter()
    for address in ordered:
        if len(selected) == cap:
            break
        if per_source[address[0]] >= 4:
            continue
        selected.append(address)
        per_source[address[0]] += 1
    for address in ordered:
        if len(selected) == cap:
            break
        if address not in selected:
            selected.append(address)
    return selected


def _ocr_inventory(connection: sqlite3.Connection, rows: dict[str, dict[str, Any]],
                   target_anchor_addresses: set[tuple[str, int]]) -> dict[str, Any]:
    oos_sources = sorted(OOS_FILENAME_HINT_IDS & set(rows))
    records = connection.execute(
        "SELECT source_id,page_number,source_sha256,artifact_sha256 FROM pages "
        "WHERE disposition='OCR_REQUIRED' AND source_id IN (?,?,?,?,?,?) "
        "ORDER BY source_id,page_number", oos_sources).fetchall()
    candidates = []
    for source_id, page, source_sha, artifact_sha in records:
        if source_sha != rows[source_id]["sha256"]:
            raise ValueError("OOS OCR source SHA drift")
        distance = min((abs(page - selected_page) for selected_source, selected_page in target_anchor_addresses
                        if selected_source == source_id), default=10_000)
        candidates.append({"sourceFileId": source_id, "pageNumber": page,
                           "sourceSha256": source_sha, "pageArtifactSha256": artifact_sha,
                           "priorityDistanceToLexicalHitPage": distance,
                           "status": "OCR_REQUIRED_UNKNOWN_NOT_ABSENCE"})
    candidates.sort(key=lambda item: (item["priorityDistanceToLexicalHitPage"],
                                      item["sourceFileId"], item["pageNumber"]))
    justified = [item for item in candidates if item["priorityDistanceToLexicalHitPage"] <= 2]
    return {"ocrRequiredPagesInOosFilenameHintSources": len(records),
            "proposalCap": OCR_PROPOSAL_CAP, "adjacentToTargetAnchorPages": len(justified),
            "proposals": justified[:OCR_PROPOSAL_CAP],
            "deferredPages": len(records) - min(len(justified), OCR_PROPOSAL_CAP),
            "status": "TRIAGE_ONLY_NO_OCR_RUN"}


def build_pod_oos_unresolved_report(manifest_path: Path, index_dir: Path, audit_path: Path,
                                    strategy_report_path: Path, catalog_path: Path) -> dict[str, Any]:
    manifest_bytes = manifest_path.read_bytes()
    manifest_sha = _sha(manifest_bytes)
    rows = load_public_manifest(manifest_path)
    audit_bytes = audit_path.read_bytes()
    _audit_gate(json.loads(audit_bytes), rows, manifest_sha, (203, 202, 10142))
    strategy_bytes = strategy_report_path.read_bytes()
    strategy = json.loads(strategy_bytes)
    catalog_bytes = catalog_path.read_bytes()
    catalog_sha = _sha(catalog_bytes)
    if (strategy.get("schemaVersion") != "unresolved-parameter-strategy-report-v1"
            or strategy.get("summary", {}).get("unresolvedCodes") != 80
            or strategy.get("inputSha256", {}).get("catalog") != catalog_sha
            or strategy.get("inputSha256", {}).get("manifest") != manifest_sha):
        raise ValueError("unresolved strategy report drift")
    plans = {entry["parameterCode"]: entry for entry in strategy["parameters"]
             if entry.get("parameterCode") in CODES}
    catalog = {entry["parameter_code"]: entry
               for entry in (json.loads(line) for line in catalog_bytes.splitlines() if line.strip())
               if entry.get("parameter_code") in CODES}
    if set(plans) != set(CODES) or set(catalog) != set(CODES):
        raise ValueError("exact nine POD/OOS unresolved codes required")
    if any(plan.get("executionStatus") != "DESIGN_ONLY"
           or plan.get("findingOrCoveragePromoted") is not False for plan in plans.values()):
        raise ValueError("strategy attempted POD/OOS promotion")
    public = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    if any(row["section"] in {"POD", "OOS"} for row in public.values()):
        raise ValueError("public POD/OOS exact source category drift")
    database = index_dir / "index.sqlite3"
    before = database.stat()
    hits: dict[str, dict[tuple[str, int], set[str]]] = {code: defaultdict(set) for code in CODES}
    queries = []
    with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        for code in CODES:
            for query in FTS_TERMS[code]:
                addresses = connection.execute(
                    "SELECT source_id,page_number FROM page_fts WHERE page_fts MATCH ?", (query,)).fetchall()
                included = 0
                for source_id, page in addresses:
                    if source_id not in public:
                        raise ValueError("FTS page outside public PDF manifest")
                    hits[code][(source_id, page)].add(query)
                    included += 1
                queries.append({"parameterCode": code, "ftsTerm": query,
                                "matchedPublicPages": included})
        selected = {code: select_addresses(hits[code], public, code) for code in CODES}
        selected_addresses = set(address for addresses in selected.values() for address in addresses)
        # Generic words such as "отходы" occur inside unrelated dispersion
        # calculations. OCR is justified only near an explicit system/permit
        # term in a plausible OOS volume, never from a broad topic word.
        exact_oos_terms = {
            '"ОСИГ"', '"разрешение на перемещение"', '"ОСС"',
            '"ГЛОНАСС"', '"РНИС"', '"КПТС"', '"весовой контроль"', '"ГРОО"',
        }
        target_anchors = {address for code in CODES if code.startswith("OOS-")
                          for address, terms in hits[code].items()
                          if address[0] in OOS_FILENAME_HINT_IDS and terms & exact_oos_terms}
        ocr = _ocr_inventory(connection, public, target_anchors)
        page_hashes = {}
        for source_id, page in selected_addresses:
            record = connection.execute(
                "SELECT artifact_sha256 FROM pages WHERE source_id=? AND page_number=?",
                (source_id, page)).fetchone()
            if record is None:
                raise ValueError("FTS selected page missing from index")
            page_hashes[(source_id, page)] = record[0]
    verified_pages: dict[tuple[str, int], dict[str, Any]] = {}
    for source_id, page in sorted(selected_addresses):
        checked = get_indexed_page(index_dir, source_id, page)
        if checked["source"]["source_sha256"] != public[source_id]["sha256"]:
            raise ValueError("selected POD/OOS source SHA drift")
        verified_pages[(source_id, page)] = checked
    after = database.stat()
    if (manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes
            or strategy_report_path.read_bytes() != strategy_bytes
            or catalog_path.read_bytes() != catalog_bytes
            or any(getattr(before, field) != getattr(after, field)
                   for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns"))):
        raise ValueError("POD/OOS input changed during batch")
    code_reports = []
    for code in CODES:
        observations = []
        plan = plans[code]
        for source_id, page_number in selected[code]:
            checked = verified_pages[(source_id, page_number)]
            page = checked["page"]
            row = public[source_id]
            seen = set()
            lines = []
            table_locators = {(item["blockIndex"], item["lineIndex"])
                              for item in page["tableRowCandidates"]}
            if page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE":
                for line in page["lines"]:
                    kind = classify_line(code, line["text"])
                    normalized = " ".join(line["text"].split()).casefold()
                    if kind is None or normalized in seen:
                        continue
                    seen.add(normalized)
                    lines.append({"blockIndex": line["blockIndex"],
                                  "lineIndex": line["lineIndex"],
                                  "bboxMilliPoints": line["bboxMilliPoints"],
                                  "text": line["text"],
                                  "textSha256": _sha(line["text"].encode("utf-8")),
                                  "matchKind": kind,
                                  "inTableRowCandidate": (line["blockIndex"],
                                                          line["lineIndex"]) in table_locators})
            observations.append({
                "sourceFileId": source_id, "objectId": row["object_id"],
                "sourceSha256": row["sha256"], "stage": row["stage"],
                "manifestSection": row["section"], "sourceRole": _source_role(row),
                "pageNumber": page_number,
                "pageArtifactSha256": page_hashes[(source_id, page_number)],
                "pageDisposition": page["quality"]["disposition"],
                "ftsTerms": sorted(hits[code][(source_id, page_number)]),
                "tableRowCandidateCount": len(page["tableRowCandidates"]),
                "lineLeadCount": len(lines), "lineLeads": lines,
                "reason": "OCR_REQUIRED_UNKNOWN" if page["quality"]["disposition"] == "OCR_REQUIRED"
                          else "LEXICAL_CONTEXT_ONLY_SOURCE_AND_PROOF_GATES_OPEN",
                "status": "REVIEW_ONLY_ABSTAIN",
            })
        matched_pages = len(hits[code])
        code_reports.append({"parameterCode": code, "parameterName": catalog[code]["parameter_name"],
                             "candidateExtractorFamily": plan["candidateExtractorFamily"],
                             "requiredEvidenceKinds": plan["requiredEvidenceKinds"],
                             "catalogSourceRequirements": plan["catalogSourceRequirements"],
                             "catalogTrigger": plan["catalogTrigger"],
                             "missingProof": PROOF_GATES[code],
                             "externalEventSnapshot": "NOT_PROVIDED" if code.startswith("OOS-")
                                                      else "NOT_APPLICABLE",
                             "ftsMatchedPageAddresses": matched_pages,
                             "selectedPageAddresses": len(observations),
                             "pagesOmittedByCap": matched_pages - len(observations),
                             "queueTruncated": matched_pages > len(observations),
                             "exactLexicalLineCount": sum(line["matchKind"] == "EXACT_LEXICAL_ANCHOR"
                                                          for item in observations for line in item["lineLeads"]),
                             "nearTopicLineCount": sum(line["matchKind"] == "NEAR_TOPIC_MENTION"
                                                       for item in observations for line in item["lineLeads"]),
                             "pages": observations, "status": "ABSTAIN", "findingCount": None,
                             "parameterCoverage": None})
    stage_sections = Counter((row["stage"], row["section"]) for row in public.values())
    return {"schemaVersion": "pod-oos-unresolved-public-batch-v1",
            "status": "BOUNDED_REVIEW_ONLY_ABSTAIN", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": manifest_sha, "auditReportSha256": _sha(audit_bytes),
            "strategyReportSha256": _sha(strategy_bytes), "catalogSha256": catalog_sha,
            "publicPdfSourceCount": len(public),
            "publicPdfPageCount": sum(row["pdf_pages"] for row in public.values()),
            "exactPodSectionSourceCount": sum(row["section"] == "POD" for row in public.values()),
            "exactOosSectionSourceCount": sum(row["section"] == "OOS" for row in public.values()),
            "oosFilenameHintSourceIds": sorted(OOS_FILENAME_HINT_IDS),
            "sourceStageSectionCounts": [{"stage": stage, "section": section, "sources": count}
                                         for (stage, section), count in sorted(stage_sections.items())],
            "pageCapPerCode": PAGE_CAP_PER_CODE,
            "uniqueShaVerifiedSelectedPages": len(verified_pages),
            "ftsQueries": queries, "ocrTriage": ocr,
            "codes": code_reports, "findingCount": None, "parameterCoverage": None}
