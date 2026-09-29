"""Audit-gated, review-only KR-067 material observations from public index.

The two material totals remain atomic. This batch does not compare PD/RD,
infer absence, establish coverage, or create findings.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from .kr_decrease_batch import (EXPECTED_PUBLIC_COUNTS, KrDecreaseBatchError,
                                _require_pass_audit)
from .indexed_page_evidence import load_indexed_page_evidence
from .kr_relative_delta_family import (
    InvalidTableGeometry,
    extract_kr_relative_delta_from_evidence,
    extract_kr_relative_delta_table_observations,
    select_kr_relative_delta_table_blocks,
)
from .public_document_index import get_indexed_page, load_public_manifest
from .public_family_batch import DEFAULT_KR_SOURCES, discover_public_family_batch


ATTRIBUTES = ("CONCRETE_VOLUME", "STEEL_MASS")
DEFAULT_KR067_TERMS = ("бетон*", "объем*", "объём*", "стал*", "масс*")


class KrRelativeDeltaBatchError(ValueError):
    """Public audit, source selection or index cannot support this batch."""


def _summary(counters: Counter[str]) -> dict[str, int]:
    return {"candidatePages": counters["REVIEW_CANDIDATE"],
            "abstainPages": counters["ABSTAIN"]}


def evaluate_kr_relative_delta_batch(
    manifest_path: Path, index_root: Path, audit_path: Path, *,
    source_ids: Sequence[str] | None = None, terms: Sequence[str] | None = None,
    max_pages: int = 100, max_blocks_per_page: int = 8, max_ocr_pages: int = 100,
    _expected_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Evaluate selected KR text pages only after a full, matching PASS audit.

    `_expected_counts` supports miniature synthetic tests. The CLI exposes no
    override and always requires exact 203/202/10142 public inventory.
    """
    selected_sources = DEFAULT_KR_SOURCES if source_ids is None else source_ids
    selected_terms = DEFAULT_KR067_TERMS if terms is None else terms
    if (source_ids is None) != (terms is None):
        raise KrRelativeDeltaBatchError("source IDs and terms must be supplied together")
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise KrRelativeDeltaBatchError("public manifest changed during audit check")
    audit_bytes = audit_path.read_bytes()
    try:
        audit = json.loads(audit_bytes)
    except (ValueError, UnicodeDecodeError) as error:
        raise KrRelativeDeltaBatchError("audit JSON invalid") from error
    if not isinstance(audit, dict):
        raise KrRelativeDeltaBatchError("audit JSON must be an object")
    expected = EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    try:
        _require_pass_audit(audit, manifest_bytes, rows, expected)
    except KrDecreaseBatchError as error:
        raise KrRelativeDeltaBatchError(str(error)) from error
    by_id = {row["file_id"]: row for row in rows}
    if (isinstance(selected_sources, (str, bytes)) or not isinstance(selected_sources, Sequence)
            or any(not isinstance(source_id, str) or source_id not in by_id
                   or by_id[source_id]["extension"] != ".pdf"
                   or by_id[source_id]["section"] != "KR"
                   or by_id[source_id]["stage"] not in {"PD", "RD"}
                   for source_id in selected_sources)):
        raise KrRelativeDeltaBatchError("select only public PDF PD/RD KR sources")
    objects = {by_id[source_id]["object_id"] for source_id in selected_sources}
    if len(objects) != 1:
        raise KrRelativeDeltaBatchError("KR-067 batch must select one object")
    discovery = discover_public_family_batch(
        manifest_path, index_root, family="RELATIVE_DELTA",
        source_ids=selected_sources, terms=selected_terms,
        max_pages=max_pages, max_blocks_per_page=max_blocks_per_page,
        max_ocr_pages=max_ocr_pages,
    )
    if (discovery["manifestSha256"] != audit["manifestSha256"]
            or discovery["indexVersionHash"] != audit["indexVersionHash"]):
        raise KrRelativeDeltaBatchError("discovery and audit provenance differ")
    by_source = {source_id: {
        "sourceFileId": source_id, "stage": by_id[source_id]["stage"],
        "section": "KR", "sourceSha256": by_id[source_id]["sha256"],
        "pages": [], "attributes": {attribute: Counter() for attribute in ATTRIBUTES},
        "tableObservationCounts": {attribute: 0 for attribute in ATTRIBUTES},
    } for source_id in discovery["sourceFileIds"]}
    by_stage: dict[str, dict[str, Any]] = {
        report["stage"]: {"stage": report["stage"],
                          "attributes": {attribute: Counter() for attribute in ATTRIBUTES},
                          "tableObservationCounts": {attribute: 0 for attribute in ATTRIBUTES}}
        for report in by_source.values()
    }
    overall = {attribute: Counter() for attribute in ATTRIBUTES}
    table_overall = {attribute: 0 for attribute in ATTRIBUTES}
    any_blocks_truncated = False
    any_table_blocks_truncated = False
    for candidate in discovery["candidates"]:
        source_id = candidate["sourceFileId"]
        indexed = get_indexed_page(index_root, source_id, candidate["pageNumber"])
        complete_page = indexed["page"]
        if (indexed["source"]["status"] != "COMPLETE"
                or indexed["source"]["source_sha256"] != by_source[source_id]["sourceSha256"]):
            raise KrRelativeDeltaBatchError("table scan source provenance invalid")
        evidence = candidate["evidence"]
        table_scan_status = "COMPLETE_INDEXED_PAGE_SHA_CHECKED"
        try:
            table_indices = select_kr_relative_delta_table_blocks(complete_page)
        except InvalidTableGeometry:
            # A malformed cell can be a competing total or value. Fail the
            # entire page-local table scan rather than silently dropping it.
            table_indices = []
            table_scan_status = "ABSTAIN_INVALID_GEOMETRY"
        selected_indices = sorted(set(evidence["selectedBlockIndices"]) | set(table_indices))
        table_blocks_truncated = len(selected_indices) > 64
        if not table_blocks_truncated and selected_indices != evidence["selectedBlockIndices"]:
            row = by_id[source_id]
            evidence = load_indexed_page_evidence(
                manifest_path, index_root, source_id, candidate["pageNumber"],
                expected_object_id=row["object_id"], expected_stage=row["stage"],
                expected_section="KR", block_indices=selected_indices,
            )
        result = extract_kr_relative_delta_from_evidence(evidence)
        table_observations = ([] if table_blocks_truncated or table_scan_status == "ABSTAIN_INVALID_GEOMETRY"
                              else extract_kr_relative_delta_table_observations(evidence, complete_page))
        if (result["sourceFileId"] != source_id
                or result["pageNumber"] != candidate["pageNumber"]
                or result["evidenceSha256"] != evidence["evidenceSha256"]):
            raise KrRelativeDeltaBatchError("extractor provenance differs from selected page")
        if evidence["sourceSha256"] != by_source[source_id]["sourceSha256"]:
            raise KrRelativeDeltaBatchError("page source SHA differs from public manifest")
        page = {
            "pageNumber": candidate["pageNumber"],
            "sourceSha256": evidence["sourceSha256"],
            "pageArtifactSha256": evidence["pageArtifactSha256"],
            "evidenceSha256": evidence["evidenceSha256"],
            "indexVersionHash": evidence["indexVersionHash"],
            "parserProvenance": evidence["parserProvenance"],
            "selectedBlockIndices": evidence["selectedBlockIndices"],
            "matchedTermsByBlock": candidate["matchedTermsByBlock"],
            "matchedBlockCount": candidate["matchedBlockCount"],
            "blocksTruncated": candidate["blocksTruncated"],
            "tableBlocksTruncated": table_blocks_truncated,
            "tableGeometryScanStatus": table_scan_status,
            "tableObservations": table_observations,
            "selectionComplete": False,
            "drawingSectionStatus": result["drawingSectionStatus"],
            "revisionApprovalStatus": result["revisionApprovalStatus"],
            "entityLinkStatus": result["entityLinkStatus"],
            "relativeDenominatorStatus": result["relativeDenominatorStatus"],
            "results": result["results"],
        }
        by_source[source_id]["pages"].append(page)
        stage = by_source[source_id]["stage"]
        for attribute in ATTRIBUTES:
            disposition = page["results"][attribute]["status"]
            if disposition not in {"REVIEW_CANDIDATE", "ABSTAIN"}:
                raise KrRelativeDeltaBatchError("unknown extractor disposition")
            by_source[source_id]["attributes"][attribute][disposition] += 1
            by_stage[stage]["attributes"][attribute][disposition] += 1
            overall[attribute][disposition] += 1
            table_count = sum(item["attribute"] == attribute for item in table_observations)
            by_source[source_id]["tableObservationCounts"][attribute] += table_count
            by_stage[stage]["tableObservationCounts"][attribute] += table_count
            table_overall[attribute] += table_count
        any_blocks_truncated |= candidate["blocksTruncated"]
        any_table_blocks_truncated |= table_blocks_truncated
    selection = {item["sourceFileId"]: item for item in discovery["sourceSelection"]}
    source_reports = []
    for source_id in discovery["sourceFileIds"]:
        report = by_source[source_id]
        report.update(selection[source_id])
        report["attributes"] = {attribute: _summary(report["attributes"][attribute])
                                for attribute in ATTRIBUTES}
        source_reports.append(report)
    stage_reports = []
    for stage in sorted(by_stage):
        selected = [item for item in source_reports if item["stage"] == stage]
        stage_reports.append({
            "stage": stage, "sourceCount": len(selected),
            "selectedTextPages": sum(item["selectedTextPages"] for item in selected),
            "ocrRequiredPages": sum(item["ocrRequiredPages"] for item in selected),
            "attributes": {attribute: _summary(by_stage[stage]["attributes"][attribute])
                           for attribute in ATTRIBUTES},
            "tableObservationCounts": by_stage[stage]["tableObservationCounts"],
        })
    if manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes:
        raise KrRelativeDeltaBatchError("manifest or audit changed during batch")
    return {
        "schemaVersion": "kr-relative-delta-public-batch-v1", "purpose": "REVIEW_ONLY",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY", "parameterCode": "KR-067",
        "attributes": list(ATTRIBUTES), "objectId": next(iter(objects)),
        "manifestSha256": audit["manifestSha256"],
        "indexVersionHash": audit["indexVersionHash"],
        "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
        "auditExpected": audit["expected"],
        "auditActual": {key: audit["actual"][key] for key in
                        ("sourceCount", "completePdfSources", "txtInventorySources",
                         "indexedPages", "ftsRows", "ftsMapRows", "verifiedPageArtifacts")},
        "sourceFileIds": discovery["sourceFileIds"],
        "ftsTerms": discovery["ftsTerms"], "limits": discovery["limits"],
        "truncated": {**discovery["truncated"], "blocks": any_blocks_truncated,
                      "tableBlocks": any_table_blocks_truncated},
        "sourceReports": source_reports, "stageReports": stage_reports,
        "attributeCounts": {attribute: _summary(overall[attribute]) for attribute in ATTRIBUTES},
        "tableObservationCounts": table_overall,
        "ocrQueue": discovery["ocrQueue"],
        "findingCount": None, "parameterCoverage": None,
    }
