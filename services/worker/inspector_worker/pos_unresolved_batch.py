"""Public POS research batch. Lexical leads only; never engineering facts.

The six unresolved POS triggers need geometry, norms, phase/element linkage,
and often PPR or as-built proof. A matched line cannot satisfy those gates.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any

from .numeric_label_probe import _audit_gate
from .public_document_index import get_indexed_page, load_public_manifest, readonly_index_uri


POS_CODES = ("POS-081", "POS-083", "POS-084", "POS-085", "POS-087", "POS-089")
POS_SOURCES = ("F0112", "F0113", "F0187", "F0188")
EXPECTED_POS_PAGES = 245
OCR_BUDGET = 5

# Patterns identify report leads, not a triggered comparison. Exact means the
# target design concept is explicit in text, not that a violation is proven.
PATTERN_TEXT = {
    "POS-081": (
        r"(?:опасн\w*\s+зон\w*.*(?:кран|границ)|(?:кран|границ).*опасн\w*\s+зон\w*)",
        r"(?:башенн\w*\s+кран|стрел\w*\s+кран|опасн\w*\s+зон)",
    ),
    "POS-083": (
        r"(?:экспликац\w*.*временн\w*\s+здан|бытов\w*\s+(?:помещен|город)|временн\w*\s+(?:здан|бытов))",
        r"(?:охранн\w*\s+зон|пожарн\w*\s+разрыв|бытов\w*|временн\w*\s+здан)",
    ),
    "POS-084": (
        r"(?:временн\w*\s+дорог\w*.*ширин|ширин\w*.*временн\w*\s+дорог|временн\w*\s+(?:авто)?дорог\w*|схем\w*\s+движен\w*\s+транспорт)",
        r"(?:ширин\w*\s+(?:дорог|проезд)|(?:дорог|проезд)\w*\s+ширин|временн\w*\s+проезд)",
    ),
    "POS-085": (
        r"(?:площад\w*\s+складир|складир\w*.*площад|складир\w*.*перекрыт|нагруз\w*.*перекрыт)",
        r"(?:складир\w*|откос\w*\s+котлован|склад\w*\s+временн)",
    ),
    "POS-087": (
        r"(?:технологическ\w*\s+последоват|метод\w*\s+производств|технологическ\w*\s+карт)",
        r"(?:технологическ\w*\s+схем|последоват\w*\s+работ|производств\w*\s+работ\w*\s+по\s+ппр)",
    ),
    "POS-089": (
        r"(?:(?:мойк|очистк)\w*\s+кол[её]с|оборотн\w*\s+водоснаб|пост\w*\s+мойк)",
        r"(?:выезд\w*\s+со\s+стройплощад|пункт\w*\s+мойк|грязеотстойник)",
    ),
}
PATTERNS = {code: tuple(re.compile(pattern, re.IGNORECASE) for pattern in pair)
            for code, pair in PATTERN_TEXT.items()}

MISSING_PROOF = {
    "POS-081": ["crane_position_and_working_radius", "hazard_polygon_site_boundary_same_coordinates",
                "PPR_or_as_built_operating_phase"],
    "POS-083": ["temporary_building_footprints", "utility_protection_and_fire_separation_geometry",
                "applicable_norm_revision", "PPR_or_as_built_placement"],
    "POS-084": ["road_segment_and_clear_width", "traffic_regime_and_applicable_norm",
                "same_segment_PPR_or_as_built_measurement"],
    "POS-085": ["storage_footprint_and_material_mass", "excavation_slope_or_slab_load_limit",
                "same_phase_PPR_or_as_built_placement"],
    "POS-087": ["specific_method_and_work_sequence", "same_operation_PPR_or_execution_record",
                "approval_status_for_change"],
    "POS-089": ["wash_station_and_exit_geometry", "recirculating_water_system_at_actual_station",
                "same_phase_PPR_or_as_built_record"],
}

AMBIGUITY = {
    "POS-081": {"scope": "site_boundary_vs_crane_zone_unlinked",
                "phase": "crane_operating_phase_unlinked", "component": "crane_identity_unbound",
                "quantity": "radius_or_hazard_polygon_unbound", "norm": "none_for_literal_catalog_trigger"},
    "POS-083": {"scope": "temporary_building_vs_utility_zone_unlinked",
                "phase": "placement_phase_unlinked", "component": "building_identity_unbound",
                "quantity": "fire_separation_distance_unbound", "norm": "applicable_fire_and_utility_rules_missing"},
    "POS-084": {"scope": "road_segment_unlinked", "phase": "traffic_phase_unlinked",
                "component": "road_class_and_traffic_regime_unbound",
                "quantity": "clear_width_of_same_segment_unbound", "norm": "applicable_3_5_or_4_5_m_threshold_missing"},
    "POS-085": {"scope": "storage_footprint_vs_slope_or_slab_unlinked",
                "phase": "storage_phase_unlinked", "component": "material_and_support_identity_unbound",
                "quantity": "load_or_mass_and_capacity_unbound", "norm": "slope_or_slab_allowance_missing"},
    "POS-087": {"scope": "same_operation_between_pos_ppr_execution_unlinked",
                "phase": "work_sequence_unlinked", "component": "construction_method_identity_unbound",
                "quantity": "not_numeric", "norm": "approval_authority_and_revision_missing"},
    "POS-089": {"scope": "wash_station_vs_exit_unlinked", "phase": "active_site_phase_unlinked",
                "component": "wash_station_identity_unbound", "quantity": "recirculation_capacity_unbound",
                "norm": "none_for_literal_catalog_trigger"},
}


def classify_line(code: str, text: str) -> str | None:
    """An exact anchor is still only explicit design wording, not a trigger."""
    if code not in PATTERNS or not isinstance(text, str):
        raise ValueError("unknown POS code or invalid line")
    normalized = " ".join(text.split()).casefold()
    if PATTERNS[code][0].search(normalized):
        return "EXACT_LEXICAL_ANCHOR"
    if PATTERNS[code][1].search(normalized):
        return "NEAR_TOPIC_MENTION"
    return None


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _strategy_entries(strategy: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if strategy.get("schemaVersion") != "unresolved-parameter-strategy-v1" or strategy.get("executionPolicy") != "DESIGN_ONLY":
        raise ValueError("unresolved strategy must remain DESIGN_ONLY")
    if strategy.get("catalogSha256") is None:
        raise ValueError("strategy has no catalog SHA")
    entries = {row["parameterCode"]: row for row in strategy["entries"]
               if row.get("parameterCode") in POS_CODES}
    catalog_by_code = {row["parameter_code"]: row for row in catalog
                       if row.get("parameter_code") in POS_CODES}
    if set(entries) != set(POS_CODES) or set(catalog_by_code) != set(POS_CODES):
        raise ValueError("six POS entries and catalog rows required")
    if any(not entries[code].get("specificProofDependency") for code in POS_CODES):
        raise ValueError("POS proof dependency missing")
    return {code: {"strategy": entries[code], "catalog": catalog_by_code[code]}
            for code in POS_CODES}


def _source_roles(rows: list[dict[str, Any]]) -> dict[str, Any]:
    objects = sorted({row["object_id"] for row in rows if row["extension"] == ".pdf"})
    roles = []
    for object_id in objects:
        subset = [row for row in rows if row["object_id"] == object_id and row["extension"] == ".pdf"]
        pd_pos = sorted(row["file_id"] for row in subset if row["stage"] == "PD" and row["section"] == "POS")
        rd_pos = sorted(row["file_id"] for row in subset if row["stage"] == "RD" and row["section"] == "POS")
        rd_other = sorted(row["file_id"] for row in subset if row["stage"] == "RD" and row["section"] == "OTHER")
        mixed = sorted(row["file_id"] for row in subset if row["stage"] == "RD_ID_MIXED")
        roles.append({"objectId": object_id, "pdPosSourceIds": pd_pos, "rdPosSourceIds": rd_pos,
                      "rdOtherSourceIds": rd_other, "mixedStageSourceIds": mixed,
                      "exactPdPosRdPosPair": bool(pd_pos and rd_pos),
                      "status": "SOURCE_ROLES_ONLY_ABSTAIN"})
    return {"objects": roles, "exactPairObjectCount": sum(item["exactPdPosRdPosPair"] for item in roles)}


def _ocr_proposals(records: list[dict[str, Any]], sources: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    ocr = [record for record in records if record["disposition"] == "OCR_REQUIRED"]
    proposals = []
    for record in ocr:
        source_id, page = record["sourceId"], record["pageNumber"]
        # F0112 p.77 lists five graphical sheets; p.78-82 have no text layer.
        graph_sheet = source_id == "F0112" and 78 <= page <= 82
        proposals.append({"sourceFileId": source_id, "pageNumber": page,
                          "sourceSha256": sources[source_id]["sha256"],
                          "pageArtifactSha256": record["artifactSha256"],
                          "reason": "GRAPHICAL_PART_AFTER_F0112_PAGE_77_INVENTORY" if graph_sheet
                                    else "OCR_REQUIRED_WITHOUT_VERIFIED_POS_SHEET_ROLE",
                          "priority": 0 if graph_sheet else 1,
                          "status": "OCR_PROPOSAL_ONLY"})
    proposals.sort(key=lambda item: (item["priority"], item["sourceFileId"], item["pageNumber"]))
    return proposals[:OCR_BUDGET], len(proposals) - min(len(proposals), OCR_BUDGET)


def build_pos_unresolved_report(manifest_path: Path, index_dir: Path, audit_path: Path,
                                strategy_path: Path, catalog_path: Path) -> dict[str, Any]:
    """Inspect every indexed PD/POS page, with source and artifact SHA gates."""
    manifest_bytes = manifest_path.read_bytes()
    manifest_sha = _sha(manifest_bytes)
    rows = load_public_manifest(manifest_path)
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    _audit_gate(audit, rows, manifest_sha, (203, 202, 10142))
    strategy_bytes = strategy_path.read_bytes()
    catalog_bytes = catalog_path.read_bytes()
    strategy = json.loads(strategy_bytes)
    if strategy["catalogSha256"] != _sha(catalog_bytes):
        raise ValueError("strategy/catalog SHA mismatch")
    catalog = [json.loads(line) for line in catalog_bytes.splitlines() if line.strip()]
    specs = _strategy_entries(strategy, catalog)
    sources = {row["file_id"]: row for row in rows}
    pos_rows = [row for row in rows if row["extension"] == ".pdf"
                and row["stage"] == "PD" and row["section"] == "POS"]
    if tuple(sorted(row["file_id"] for row in pos_rows)) != POS_SOURCES or sum(row["pdf_pages"] for row in pos_rows) != EXPECTED_POS_PAGES:
        raise ValueError("POS public PDF inventory drift")
    database = index_dir / "index.sqlite3"
    before = database.stat()
    with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        records = connection.execute(
            "SELECT source_id,page_number,source_sha256,disposition,artifact_sha256,"
            "table_candidate_count FROM pages WHERE source_id IN (?,?,?,?) "
            "ORDER BY source_id,page_number", POS_SOURCES).fetchall()
    if len(records) != EXPECTED_POS_PAGES:
        raise ValueError("POS index page inventory drift")
    candidates: dict[str, list[dict[str, Any]]] = {code: [] for code in POS_CODES}
    dispositions = Counter()
    table_rows_seen = 0
    ocr_records = []
    for source_id, page_number, source_sha, disposition, artifact_sha, table_count in records:
        source = sources[source_id]
        if source_sha != source["sha256"] or not 1 <= page_number <= source["pdf_pages"]:
            raise ValueError("POS index source identity drift")
        verified = get_indexed_page(index_dir, source_id, page_number)
        if (verified["source"]["source_sha256"] != source_sha
                or verified["page"]["quality"]["disposition"] != disposition):
            raise ValueError("POS page source/quality mismatch")
        # get_indexed_page checks source SHA, indexed artifact SHA, schema, and FTS.
        dispositions[disposition] += 1
        page = verified["page"]
        table_rows_seen += len(page["tableRowCandidates"])
        if len(page["tableRowCandidates"]) != table_count:
            raise ValueError("POS table candidate count drift")
        if disposition == "OCR_REQUIRED":
            ocr_records.append({"sourceId": source_id, "pageNumber": page_number,
                                "disposition": disposition, "artifactSha256": artifact_sha})
            continue
        if disposition != "TEXT_LAYER_CANDIDATE":
            raise ValueError("unsupported POS text quality")
        seen: set[tuple[str, str]] = set()
        table_locators = {(item["blockIndex"], item["lineIndex"])
                          for item in page["tableRowCandidates"]}
        for line in page["lines"]:
            text = line["text"]
            normalized = " ".join(text.split()).casefold()
            for code in POS_CODES:
                kind = classify_line(code, text)
                if kind is None or (code, normalized) in seen:
                    continue
                seen.add((code, normalized))
                candidates[code].append({
                    "sourceFileId": source_id, "objectId": source["object_id"],
                    "sourceSha256": source_sha, "stage": source["stage"],
                    "manifestSection": source["section"], "pageNumber": page_number,
                    "pageArtifactSha256": artifact_sha,
                    "line": {"blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                             "bboxMilliPoints": line["bboxMilliPoints"],
                             "text": text, "textSha256": _sha(text.encode("utf-8"))},
                    "matchKind": kind,
                    "inTableRowCandidate": (line["blockIndex"], line["lineIndex"]) in table_locators,
                    "status": "REVIEW_ONLY_ABSTAIN",
                })
    after = database.stat()
    if (manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes
            or strategy_path.read_bytes() != strategy_bytes or catalog_path.read_bytes() != catalog_bytes
            or any(getattr(before, field) != getattr(after, field)
                   for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns"))):
        raise ValueError("POS inputs changed during batch")
    roles = _source_roles(rows)
    proposals, deferred = _ocr_proposals(ocr_records, sources)
    codes = []
    for code in POS_CODES:
        spec = specs[code]
        leads = candidates[code]
        codes.append({"parameterCode": code, "parameterName": spec["catalog"]["parameter_name"],
                      "candidateExtractorFamily": spec["strategy"]["candidateExtractorFamily"],
                      "evidenceKinds": spec["strategy"]["evidenceKinds"],
                      "specificProofDependency": spec["strategy"]["specificProofDependency"],
                      "catalogTrigger": spec["catalog"]["trigger"],
                      "catalogSourcePd": spec["catalog"]["source_pd"],
                      "catalogSourceRd": spec["catalog"]["source_rd"],
                      "catalogSourceId": spec["catalog"]["source_id"],
                      "missingProof": MISSING_PROOF[code], "ambiguity": AMBIGUITY[code],
                      "leadCount": len(leads),
                      "exactLexicalAnchorCount": sum(lead["matchKind"] == "EXACT_LEXICAL_ANCHOR" for lead in leads),
                      "nearTopicMentionCount": sum(lead["matchKind"] == "NEAR_TOPIC_MENTION" for lead in leads),
                      "leads": leads, "status": "ABSTAIN", "findingCount": None,
                      "parameterCoverage": None})
    return {"schemaVersion": "pos-unresolved-public-batch-v1",
            "status": "COMPLETE_REVIEW_ONLY_ABSTAIN", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": manifest_sha, "auditReportSha256": _sha(audit_bytes),
            "strategySha256": _sha(strategy_bytes), "catalogSha256": _sha(catalog_bytes),
            "sourceRoles": roles, "pdPosSourceIds": list(POS_SOURCES),
            "indexedPosPages": len(records), "textLayerCandidatePages": dispositions["TEXT_LAYER_CANDIDATE"],
            "ocrRequiredPages": dispositions["OCR_REQUIRED"],
            "indexTableRowCandidates": table_rows_seen,
            "ocrProposals": proposals, "ocrProposalBudget": OCR_BUDGET,
            "ocrPagesDeferred": deferred,
            "codes": codes, "findingCount": None, "parameterCoverage": None}
