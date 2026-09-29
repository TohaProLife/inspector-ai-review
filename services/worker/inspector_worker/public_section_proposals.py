"""Audit-gated, read-only drawing-section proposals from public page index.

Proposals are search hints for human review. They never change source metadata,
parameter coverage, findings, or stage/section classifications.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path
from typing import Any

from .candidate_family_rules import DRAWING_TO_MANIFEST_SECTION, load_candidate_family_pack
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _validate_cached_page, _version_hash, load_public_manifest,
    readonly_index_uri,
)


PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
EXPECTED_PUBLIC_COUNTS = {"sourceCount": 203, "pdfSources": 202,
                          "pdfPages": 10142, "txtInventorySources": 1}
MAX_PAGES = 500
MAX_PROPOSALS = 1000

# Explicit designation strings only. No free-text semantic classification.
_ALIASES = {
    "АР": "AR", "AR": "AR", "КР": "KR", "KR": "KR",
    "КЖ": "KJ", "KJ": "KJ", "КМ": "KM", "KM": "KM",
    "ОВ": "OV", "OV": "OV", "ВК": "VK", "VK": "VK",
    "ЭОМ": "EOM", "EOM": "EOM", "ГП": "GP", "GP": "GP",
    "ГСВ": "GSV", "GSV": "GSV", "НВК": "NVK", "NVK": "NVK",
    "ПОС": "POS", "POS": "POS", "ПЗ": "PZ", "PZ": "PZ",
    "СПОЗУ": "SPZU", "SPZU": "SPZU", "СС": "SS", "SS": "SS",
    "ППМ": "PPM", "PPM": "PPM", "ППР": "PPR", "PPR": "PPR",
    "ПП": "PP", "PP": "PP", "ПОД": "POD", "POD": "POD",
    "ОДИ": "ODI", "ODI": "ODI", "ЗУ": "ZU", "ZU": "ZU",
    "СМ": "SM", "SM": "SM", "ИОС1": "IOS1", "IOS1": "IOS1",
    "ИОС2": "IOS2", "IOS2": "IOS2", "ИОС3": "IOS3", "IOS3": "IOS3",
}
_TOKEN = re.compile(r"(?<!\w)(?:" + "|".join(
    re.escape(alias) for alias in sorted(_ALIASES, key=len, reverse=True)
) + r")(?!\w)")


class PublicSectionProposalError(ValueError):
    """Audit, inventory, or indexed page cannot support a proposal report."""


def explicit_designations(text: str) -> list[str]:
    """Return only standalone drawing-section marks visible in one candidate."""
    if not isinstance(text, str):
        raise PublicSectionProposalError("section candidate text must be a string")
    return sorted({_ALIASES[match.group().upper()] for match in _TOKEN.finditer(text)})


def _audit_gate(audit: dict[str, Any], manifest_bytes: bytes,
                rows: list[dict[str, Any]], expected: dict[str, int]) -> None:
    def exact_int(value: Any, desired: int) -> bool:
        return type(value) is int and value == desired

    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if (audit.get("schemaVersion") != "public-document-index-audit-v1"
            or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != manifest_sha
            or audit.get("indexVersionHash") != _version_hash()
            or not exact_int(audit.get("findingCount"), 0)
            or not exact_int(audit.get("fatalFindingCount"), 0)
            or audit.get("findings") != []
            or not exact_int(audit.get("findingsTruncated"), 0)):
        raise PublicSectionProposalError("PASS audit, manifest SHA, or index version invalid")
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    txt = [row for row in rows if row["extension"] == ".txt"]
    inventory = {"sourceCount": len(rows), "pdfSources": len(pdfs),
                 "pdfPages": sum(row["pdf_pages"] for row in pdfs),
                 "txtInventorySources": len(txt)}
    if (inventory != expected or len(txt) != 1 or txt[0]["file_id"] != "F0194"
            or txt[0].get("annotation_status") != "GROUND_TRUTH_INDEX"):
        raise PublicSectionProposalError("public inventory differs from expected scope")
    recorded, actual = audit.get("expected"), audit.get("actual")
    if not isinstance(recorded, dict) or not isinstance(actual, dict):
        raise PublicSectionProposalError("audit counts missing")
    required_actual = {"sourceCount": expected["sourceCount"],
                       "completePdfSources": expected["pdfSources"],
                       "txtInventorySources": expected["txtInventorySources"],
                       "indexedPages": expected["pdfPages"],
                       "ftsRows": expected["pdfPages"],
                       "ftsMapRows": expected["pdfPages"],
                       "verifiedPageArtifacts": expected["pdfPages"]}
    if (any(not exact_int(recorded.get(key), count) for key, count in expected.items())
            or any(not exact_int(actual.get(key), count)
                   for key, count in required_actual.items())):
        raise PublicSectionProposalError("audit does not prove complete public index")
    source_reports = audit.get("sources")
    if (not isinstance(source_reports, list)
            or len(source_reports) != expected["sourceCount"]
            or any(not isinstance(item, dict) for item in source_reports)
            or {item.get("sourceId") for item in source_reports}
            != {row["file_id"] for row in rows}):
        raise PublicSectionProposalError("audit source inventory invalid")
    by_id = {item["sourceId"]: item for item in source_reports}
    for row in rows:
        record = by_id[row["file_id"]]
        is_pdf = row["extension"] == ".pdf"
        page_count = row["pdf_pages"] if is_pdf else 0
        if (record.get("status") != ("COMPLETE" if is_pdf else "SKIPPED_GROUND_TRUTH_TXT")
                or record.get("objectId") != row["object_id"]
                or record.get("stage") != row["stage"]
                or record.get("section") != row["section"]
                or not exact_int(record.get("expectedPages"), page_count)
                or not exact_int(record.get("indexedPages"), page_count)
                or not exact_int(record.get("issueCount"), 0)):
            raise PublicSectionProposalError("audit source differs from public inventory")


def _unpaired_rules(rows: list[dict[str, Any]], rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_object: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["extension"] == ".pdf":
            by_object[row["object_id"]].append(row)
    result = []
    for rule in rules:
        pd_sections = set(rule["requiredExpectedSections"])
        rd_sections = set(rule["requiredActualSections"])
        exact_pair = pd_sections and rd_sections and any(
            any(row["stage"] == "PD" and row["section"] in pd_sections for row in group)
            and any(row["stage"] == "RD" and row["section"] in rd_sections for row in group)
            for group in by_object.values()
        )
        if not exact_pair:
            result.append(rule)
    return result


def _possible_codes(marks: list[str], stage: str,
                    rules: list[dict[str, Any]]) -> list[str]:
    if stage == "PD":
        field = "requiredExpectedDrawingSections"
    elif stage in {"RD", "RD_ID_MIXED"}:
        field = "requiredActualDrawingSections"
    else:
        return []
    return sorted({rule["parameterCode"] for rule in rules
                   if set(marks).intersection(rule[field])})


def build_public_section_proposals(
    manifest_path: Path, index_root: Path, audit_path: Path, *,
    max_pages: int = 300, max_proposals: int = 500,
    _expected_counts: dict[str, int] | None = None,
    _expected_manifest_sha256: str | None = None,
) -> dict[str, Any]:
    """Read bounded audited section candidates; leave all classifications unchanged.

    Private overrides only allow tiny synthetic-index tests. CLI exposes none.
    """
    if (type(max_pages) is not int or not 1 <= max_pages <= MAX_PAGES
            or type(max_proposals) is not int or not 1 <= max_proposals <= MAX_PROPOSALS):
        raise PublicSectionProposalError("page/proposal limits outside bounded range")
    expected = EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    pinned_sha = (PUBLIC_MANIFEST_SHA256 if _expected_manifest_sha256 is None
                  else _expected_manifest_sha256)
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != pinned_sha:
        raise PublicSectionProposalError("public manifest SHA differs from pinned allowlist")
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise PublicSectionProposalError("public manifest changed during read")
    audit_bytes = audit_path.read_bytes()
    try:
        audit = json.loads(audit_bytes)
    except json.JSONDecodeError as error:
        raise PublicSectionProposalError("audit JSON invalid") from error
    if not isinstance(audit, dict):
        raise PublicSectionProposalError("audit JSON must be an object")
    _audit_gate(audit, manifest_bytes, rows, expected)
    pack = load_candidate_family_pack()
    target_rules = _unpaired_rules(rows, pack["rules"])
    if expected == EXPECTED_PUBLIC_COUNTS and len(target_rules) != 44:
        raise PublicSectionProposalError("unpaired candidate-code set differs from pinned 44")
    by_id = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    manifest_by_id = {row["file_id"]: row for row in rows}
    eligible_ids = {source_id for source_id, row in by_id.items()
                    if row["stage"] in {"PD", "RD", "RD_ID_MIXED"}}
    proposals: list[dict[str, Any]] = []
    source_reports: dict[str, dict[str, Any]] = {}
    candidate_pages = 0
    scanned_pages = 0
    candidates_without_token = 0
    explicit_candidates = 0
    with closing(sqlite3.connect(readonly_index_uri(index_root / "index.sqlite3"), uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
            raise PublicSectionProposalError("index schema/version differs from PASS audit")
        index_sources = {record["source_id"]: dict(record)
                         for record in connection.execute("SELECT * FROM sources")}
        if set(index_sources) != {row["file_id"] for row in rows}:
            raise PublicSectionProposalError("index source inventory differs from manifest")
        for source_id, source in index_sources.items():
            row = manifest_by_id[source_id]
            if (source["source_sha256"] != row["sha256"]
                    or source["object_id"] != row["object_id"]
                    or source["stage"] != row["stage"]
                    or source["section"] != row["section"]
                    or source["status"] != ("COMPLETE" if row["extension"] == ".pdf"
                                            else "SKIPPED_GROUND_TRUTH_TXT")):
                raise PublicSectionProposalError("index source metadata differs from manifest")
        addresses = [record for record in connection.execute("""
            SELECT source_id,page_number,source_sha256,artifact_path,artifact_sha256,
                   parser_provenance,disposition,section_candidate_count
            FROM pages WHERE section_candidate_count>0 ORDER BY page_number,source_id
        """) if record["source_id"] in eligible_ids]
        candidate_pages = len(addresses)
        for record in addresses[:max_pages]:
            source_id = record["source_id"]
            row = by_id[source_id]
            if (record["source_sha256"] != row["sha256"]
                    or not 1 <= record["page_number"] <= row["pdf_pages"]):
                raise PublicSectionProposalError("indexed page differs from public manifest")
            page = _validate_cached_page(
                index_root, row, record["page_number"],
                (record["artifact_path"], record["artifact_sha256"], record["parser_provenance"]),
            )
            if (page is None or len(page["sectionCandidates"]) > 16
                    or len(page["sectionCandidates"]) != record["section_candidate_count"]):
                raise PublicSectionProposalError("selected page artifact or section count invalid")
            if page["quality"]["disposition"] != record["disposition"]:
                raise PublicSectionProposalError("page quality differs from index")
            lines = {(line["blockIndex"], line["lineIndex"]): line for line in page["lines"]}
            source_report = source_reports.setdefault(source_id, {
                "sourceFileId": source_id, "objectId": row["object_id"],
                "stage": row["stage"], "manifestSection": row["section"],
                "sourceSha256": row["sha256"], "scannedCandidatePages": 0,
                "explicitDesignationCandidates": 0, "proposalsReturned": 0,
            })
            source_report["scannedCandidatePages"] += 1
            scanned_pages += 1
            for candidate in page["sectionCandidates"]:
                line = lines.get((candidate.get("blockIndex"), candidate.get("lineIndex")))
                if (candidate.get("status") != "CANDIDATE" or line is None
                        or not isinstance(candidate.get("text"), str)
                        or len(candidate["text"]) > 200
                        or candidate.get("text") != line["text"]
                        or candidate.get("bboxMilliPoints") != line["bboxMilliPoints"]):
                    raise PublicSectionProposalError("section candidate line provenance invalid")
                marks = explicit_designations(candidate["text"])
                if not marks:
                    candidates_without_token += 1
                    continue
                explicit_candidates += 1
                source_report["explicitDesignationCandidates"] += 1
                if len(proposals) >= max_proposals:
                    continue
                categories = sorted({DRAWING_TO_MANIFEST_SECTION[mark] for mark in marks
                                     if mark in DRAWING_TO_MANIFEST_SECTION})
                flags = []
                if len(marks) > 1:
                    flags.append("MULTIPLE_EXPLICIT_DESIGNATIONS")
                if row["section"] == "OTHER":
                    flags.append("MANIFEST_SECTION_UNCLASSIFIED")
                elif categories and row["section"] not in categories:
                    flags.append("MANIFEST_CATEGORY_CONFLICT")
                if not categories or any(mark not in DRAWING_TO_MANIFEST_SECTION for mark in marks):
                    flags.append("DRAWING_MARK_HAS_NO_EXACT_MANIFEST_CATEGORY")
                if row["stage"] == "RD_ID_MIXED":
                    flags.append("STAGE_MIXED_UNVERIFIED")
                if record["disposition"] == "OCR_REQUIRED":
                    flags.append("OCR_REQUIRED_PAGE")
                proposals.append({
                    "sourceFileId": source_id, "objectId": row["object_id"],
                    "sourceSha256": row["sha256"], "sourceStage": row["stage"],
                    "sourceManifestSection": row["section"],
                    "pageNumber": record["page_number"],
                    "pageArtifactSha256": record["artifact_sha256"],
                    "indexVersionHash": _version_hash(),
                    "pageDisposition": record["disposition"],
                    "parserProvenance": record["parser_provenance"],
                    "blockIndex": candidate["blockIndex"],
                    "lineIndex": candidate["lineIndex"],
                    "textSnippet": candidate["text"][:200],
                    "bboxMilliPoints": candidate["bboxMilliPoints"],
                    "explicitDrawingDesignations": marks,
                    "possibleManifestCategories": categories,
                    "possibleParameterCodes": _possible_codes(marks, row["stage"], target_rules),
                    "ambiguityFlags": flags,
                    "reviewStatus": "UNVERIFIED_PROPOSAL",
                })
                source_report["proposalsReturned"] += 1
    if manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes:
        raise PublicSectionProposalError("manifest or PASS audit changed during report")
    return {
        "schemaVersion": "public-section-proposals-v1",
        "disposition": "REVIEW_ONLY_ABSTAIN",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_PDF_ONLY",
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
        "indexVersionHash": _version_hash(),
        "candidatePackSha256": pack["packSha256"],
        "targetCodeCount": len(target_rules),
        "targetCodes": sorted(rule["parameterCode"] for rule in target_rules),
        "limits": {"maxCandidatePages": max_pages, "maxProposals": max_proposals},
        "totals": {"candidatePagesAvailable": candidate_pages,
                   "candidatePagesScanned": scanned_pages,
                   "candidatePagesOmitted": candidate_pages - scanned_pages,
                   "sectionCandidatesWithoutExplicitToken": candidates_without_token,
                   "explicitDesignationCandidatesSeen": explicit_candidates,
                   "proposalsReturned": len(proposals),
                   "proposalsOmittedWithinScannedPages": explicit_candidates - len(proposals)},
        "truncated": candidate_pages > scanned_pages or explicit_candidates > len(proposals),
        "findingCount": None,
        "parameterCoverage": None,
        "sourceReports": [source_reports[key] for key in sorted(source_reports)],
        "proposals": proposals,
    }
