"""Read-only, audit-gated KR-061/062 page observations from public index.

No PD/RD comparison, finding, coverage or negative conclusion is made here.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from .kr_decrease_family import extract_kr_decrease_from_evidence
from .public_document_index import _version_hash, load_public_manifest
from .public_family_batch import discover_public_family_batch


EXPECTED_PUBLIC_COUNTS = {"sourceCount": 203, "pdfSources": 202,
                          "pdfPages": 10142, "txtInventorySources": 1}
CODES = ("KR-061", "KR-062")


class KrDecreaseBatchError(ValueError):
    """Audit or public index cannot support this bounded evaluation."""


def _exact_int(value: Any, expected: int) -> bool:
    return type(value) is int and value == expected


def _require_pass_audit(
    audit: dict[str, Any], manifest_bytes: bytes, rows: list[dict[str, Any]],
    expected: dict[str, int],
) -> None:
    if (audit.get("schemaVersion") != "public-document-index-audit-v1"
            or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != hashlib.sha256(manifest_bytes).hexdigest()
            or audit.get("indexVersionHash") != _version_hash()
            or not _exact_int(audit.get("findingCount"), 0)
            or not _exact_int(audit.get("fatalFindingCount"), 0)
            or audit.get("findings") != []
            or not _exact_int(audit.get("findingsTruncated"), 0)):
        raise KrDecreaseBatchError("PASS audit, manifest SHA or index version is invalid")
    pdf_rows = [row for row in rows if row["extension"] == ".pdf"]
    txt_rows = [row for row in rows if row["extension"] == ".txt"]
    inventory = {"sourceCount": len(rows), "pdfSources": len(pdf_rows),
                 "pdfPages": sum(row["pdf_pages"] for row in pdf_rows),
                 "txtInventorySources": len(txt_rows)}
    if (inventory != expected or len(txt_rows) != 1
            or txt_rows[0]["file_id"] != "F0194"
            or txt_rows[0].get("annotation_status") != "GROUND_TRUTH_INDEX"):
        raise KrDecreaseBatchError("manifest public inventory does not match expected counts")
    recorded = audit.get("expected")
    actual = audit.get("actual")
    if not isinstance(recorded, dict) or not isinstance(actual, dict):
        raise KrDecreaseBatchError("audit counts missing")
    if any(not _exact_int(recorded.get(key), value) for key, value in expected.items()):
        raise KrDecreaseBatchError("audit expected counts do not match public inventory")
    required_actual = {
        "sourceCount": expected["sourceCount"],
        "completePdfSources": expected["pdfSources"],
        "txtInventorySources": expected["txtInventorySources"],
        "indexedPages": expected["pdfPages"],
        "ftsRows": expected["pdfPages"],
        "ftsMapRows": expected["pdfPages"],
        "verifiedPageArtifacts": expected["pdfPages"],
    }
    if any(not _exact_int(actual.get(key), value) for key, value in required_actual.items()):
        raise KrDecreaseBatchError("audit actual counts do not prove complete public index")
    sources = audit.get("sources")
    if (not isinstance(sources, list) or len(sources) != expected["sourceCount"]
            or {source.get("sourceId") for source in sources if isinstance(source, dict)}
            != {row["file_id"] for row in rows}
            or any(not isinstance(source, dict) or source.get("issueCount") != 0
                   for source in sources)):
        raise KrDecreaseBatchError("audit source inventory invalid")
    audit_sources = {source["sourceId"]: source for source in sources}
    for row in rows:
        source = audit_sources[row["file_id"]]
        expected_status = ("COMPLETE" if row["extension"] == ".pdf"
                           else "SKIPPED_GROUND_TRUTH_TXT")
        expected_pages = row["pdf_pages"] if row["extension"] == ".pdf" else 0
        if (source.get("status") != expected_status
                or source.get("objectId") != row["object_id"]
                or source.get("stage") != row["stage"]
                or source.get("section") != row["section"]
                or not _exact_int(source.get("expectedPages"), expected_pages)
                or not _exact_int(source.get("indexedPages"), expected_pages)):
            raise KrDecreaseBatchError("audit source completion differs from public manifest")


def _summary(counters: Counter[str]) -> dict[str, int]:
    return {"candidatePages": counters["REVIEW_CANDIDATE"],
            "abstainPages": counters["ABSTAIN"]}


def evaluate_kr_decrease_batch(
    manifest_path: Path, index_root: Path, audit_path: Path, *,
    source_ids: Sequence[str] | None = None, terms: Sequence[str] | None = None,
    max_pages: int = 40, max_blocks_per_page: int = 4, max_ocr_pages: int = 100,
    _expected_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Evaluate selected KR pages after one complete integrity audit.

    `_expected_counts` exists for tiny synthetic-index tests only; CLI has no
    override and always requires the 203-document production public inventory.
    """
    expected = EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise KrDecreaseBatchError("public manifest changed during audit check")
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    if not isinstance(audit, dict):
        raise KrDecreaseBatchError("audit JSON must be an object")
    _require_pass_audit(audit, manifest_bytes, rows, expected)
    discovery = discover_public_family_batch(
        manifest_path, index_root, family="DECREASE", source_ids=source_ids,
        terms=terms, max_pages=max_pages,
        max_blocks_per_page=max_blocks_per_page, max_ocr_pages=max_ocr_pages,
    )
    if (discovery["manifestSha256"] != audit["manifestSha256"]
            or discovery["indexVersionHash"] != audit["indexVersionHash"]):
        raise KrDecreaseBatchError("discovery and audit provenance differ")

    by_source = {source_id: {"sourceFileId": source_id, "stage": row["stage"],
                             "section": row["section"], "sourceSha256": row["sha256"],
                             "pages": [], "codes": {code: Counter() for code in CODES}}
                 for source_id in discovery["sourceFileIds"]
                 for row in rows if row["file_id"] == source_id}
    by_stage: dict[str, dict[str, Any]] = {
        report["stage"]: {"stage": report["stage"],
                          "codes": {code: Counter() for code in CODES}}
        for report in by_source.values()
    }
    overall = {code: Counter() for code in CODES}
    any_blocks_truncated = False
    for candidate in discovery["candidates"]:
        evidence = candidate["evidence"]
        source_id = candidate["sourceFileId"]
        result = extract_kr_decrease_from_evidence(evidence)
        if (result["sourceFileId"] != source_id
                or result["pageNumber"] != candidate["pageNumber"]
                or result["evidenceSha256"] != evidence["evidenceSha256"]):
            raise KrDecreaseBatchError("extractor provenance differs from selected page")
        page = {"pageNumber": candidate["pageNumber"],
                "sourceSha256": evidence["sourceSha256"],
                "pageArtifactSha256": evidence["pageArtifactSha256"],
                "evidenceSha256": evidence["evidenceSha256"],
                "indexVersionHash": evidence["indexVersionHash"],
                "parserProvenance": evidence["parserProvenance"],
                "selectedBlockIndices": evidence["selectedBlockIndices"],
                "matchedBlockCount": candidate["matchedBlockCount"],
                "blocksTruncated": candidate["blocksTruncated"],
                "selectionComplete": False,
                "drawingSectionStatus": result["drawingSectionStatus"],
                "revisionApprovalStatus": result["revisionApprovalStatus"],
                "entityLinkStatus": result["entityLinkStatus"],
                "results": result["results"]}
        if page["sourceSha256"] != by_source[source_id]["sourceSha256"]:
            raise KrDecreaseBatchError("page source SHA differs from manifest")
        by_source[source_id]["pages"].append(page)
        stage = by_source[source_id]["stage"]
        stage_entry = by_stage.setdefault(stage, {"stage": stage,
                                                   "codes": {code: Counter() for code in CODES}})
        for code in CODES:
            disposition = page["results"][code]["status"]
            if disposition not in {"REVIEW_CANDIDATE", "ABSTAIN"}:
                raise KrDecreaseBatchError("unknown extractor disposition")
            by_source[source_id]["codes"][code][disposition] += 1
            stage_entry["codes"][code][disposition] += 1
            overall[code][disposition] += 1
        any_blocks_truncated |= candidate["blocksTruncated"]

    selection = {item["sourceFileId"]: item for item in discovery["sourceSelection"]}
    source_reports = []
    for source_id in discovery["sourceFileIds"]:
        report = by_source[source_id]
        report.update(selection[source_id])
        report["codes"] = {code: _summary(report["codes"][code]) for code in CODES}
        source_reports.append(report)
    stage_reports = []
    for stage in sorted(by_stage):
        source_count = sum(item["stage"] == stage for item in source_reports)
        stage_reports.append({"stage": stage, "sourceCount": source_count,
                              "selectedTextPages": sum(item["selectedTextPages"] for item in source_reports
                                                       if item["stage"] == stage),
                              "ocrRequiredPages": sum(item["ocrRequiredPages"] for item in source_reports
                                                      if item["stage"] == stage),
                              "codes": {code: _summary(by_stage[stage]["codes"][code])
                                        for code in CODES}})
    if manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes:
        raise KrDecreaseBatchError("manifest or audit changed during batch")
    return {
        "schemaVersion": "kr-decrease-public-batch-v1", "purpose": "REVIEW_ONLY",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY", "codes": list(CODES),
        "manifestSha256": audit["manifestSha256"],
        "indexVersionHash": audit["indexVersionHash"],
        "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
        "auditExpected": audit["expected"], "auditActual": {key: audit["actual"][key] for key in
                                                         ("sourceCount", "completePdfSources",
                                                          "txtInventorySources", "indexedPages",
                                                          "ftsRows", "ftsMapRows",
                                                          "verifiedPageArtifacts")},
        "sourceFileIds": discovery["sourceFileIds"],
        "ftsTerms": discovery["ftsTerms"], "limits": discovery["limits"],
        "truncated": {**discovery["truncated"], "blocks": any_blocks_truncated},
        "sourceReports": source_reports, "stageReports": stage_reports,
        "codes": {code: _summary(overall[code]) for code in CODES},
        "ocrQueue": discovery["ocrQueue"],
        "findingCount": None, "parameterCoverage": None,
    }
