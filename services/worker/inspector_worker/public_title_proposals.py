"""Bounded, audit-gated title-page stage/section proposals for public PDFs.

This report does not promote a document's manifest stage or section. A cue on
one of the first three pages is evidence for review, not a source decision.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from .candidate_family_rules import DRAWING_TO_MANIFEST_SECTION
from .ocr_family_evidence import OcrFamilyEvidenceError, load_ocr_family_evidence
from .ocr_pilot import canonical_hash
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _validate_cached_page, _version_hash, load_public_manifest,
)
from .public_section_proposals import (
    EXPECTED_PUBLIC_COUNTS, PUBLIC_MANIFEST_SHA256, _audit_gate,
)


MAX_PAGES_PER_SOURCE = 3
MAX_PROPOSALS = 1200
MAX_LINES_PER_PAGE = 1024
MAX_BLOCKS_PER_PAGE = 512
MAX_TEXT_CHARACTERS = 8192
SNIPPET_CHARACTERS = 320
MAX_OCR_SELECTED_PAGES = 16
MAX_OCR_SELECTED_LINES_PER_PAGE = 32
MAX_OCR_SELECTED_LINES_TOTAL = 128

_STAGE_PHRASES = (
    ("RD", re.compile(r"\bрабочая\s+документация\b", re.IGNORECASE)),
    ("PD", re.compile(r"\bпроектная\s+документация\b", re.IGNORECASE)),
    ("ID", re.compile(r"\bисполнительная\s+документация\b", re.IGNORECASE)),
)
_STAGE_ALIASES = {"РД": "RD", "ПД": "PD", "ИД": "ID", "RD": "RD", "PD": "PD", "ID": "ID"}
_MARK_ALIASES = {
    "АР": "AR", "КР": "KR", "КЖ": "KJ", "КМ": "KM", "ОВ": "OV",
    "ВК": "VK", "ВВ": "VV", "ЭОМ": "EOM", "ГП": "GP", "ГСВ": "GSV",
    "НВК": "NVK", "ПОС": "POS", "ПЗ": "PZ", "СС": "SS",
    "СПОЗУ": "SPZU", "ПОД": "POD", "ОДИ": "ODI", "ППМ": "PPM",
    "ППР": "PPR", "ПП": "PP", "ЗУ": "ZU", "СМ": "SM",
    "AR": "AR", "KR": "KR", "KJ": "KJ", "KM": "KM", "OV": "OV",
    "VK": "VK", "VV": "VV", "EOM": "EOM", "GP": "GP", "GSV": "GSV",
    "NVK": "NVK", "POS": "POS", "PZ": "PZ", "SS": "SS",
    "SPZU": "SPZU", "POD": "POD", "ODI": "ODI", "PPM": "PPM",
    "PPR": "PPR", "PP": "PP", "ZU": "ZU", "SM": "SM",
}
_CIPHER = re.compile(
    r"(?<!\w)(?P<stage>" + "|".join(_STAGE_ALIASES) + r")\s*[-–.]\s*"
    r"(?P<mark>" + "|".join(re.escape(x) for x in sorted(_MARK_ALIASES, key=len, reverse=True))
    + r")(?P<suffix>\d+(?:\.\d+)*)?(?!\w)"
)
_PZ_TITLE = re.compile(r"\bраздел\s*1\s*[.:-]?\s*пояснительная\s+записка\b",
                       re.IGNORECASE)


class PublicTitleProposalError(ValueError):
    """The title proposal cannot be tied to the audited public index."""


def _validate_ocr_selections(selections: list[dict[str, Any]] | None,
                             cache_root: Path | None, pdfs: list[dict[str, Any]],
                             pages_per_source: int) -> list[dict[str, Any]]:
    if selections is None:
        if cache_root is not None:
            raise PublicTitleProposalError("OCR cache supplied without explicit selections")
        return []
    if (cache_root is None or not isinstance(selections, list)
            or not 1 <= len(selections) <= MAX_OCR_SELECTED_PAGES):
        raise PublicTitleProposalError("select 1..16 OCR title pages and cache root")
    by_id = {row["file_id"]: row for row in pdfs}
    required = {"sourceFileId", "pageNumber", "lineIndices", "dpi", "script",
                "rendererProfileId", "providerProfileId"}
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    selected_line_total = 0
    for item in selections:
        if not isinstance(item, dict) or set(item) != required:
            raise PublicTitleProposalError("OCR title selection fields invalid")
        source_id, page_number = item["sourceFileId"], item["pageNumber"]
        row = by_id.get(source_id) if isinstance(source_id, str) else None
        if (row is None or type(page_number) is not int
                or not 1 <= page_number <= min(pages_per_source, row["pdf_pages"])
                or (source_id, page_number) in seen):
            raise PublicTitleProposalError("OCR selection outside public PDF title pages")
        indices = item["lineIndices"]
        if (not isinstance(indices, list)
                or not 1 <= len(indices) <= MAX_OCR_SELECTED_LINES_PER_PAGE
                or any(type(value) is not int or value < 0 for value in indices)
                or len(set(indices)) != len(indices)):
            raise PublicTitleProposalError("OCR title line selection invalid or unbounded")
        if (type(item["dpi"]) is not int or not 72 <= item["dpi"] <= 300
                or any(not isinstance(item[key], str) or not item[key]
                       or len(item[key]) > 128 for key in
                       ("script", "rendererProfileId", "providerProfileId"))):
            raise PublicTitleProposalError("OCR title profile selection invalid")
        selected_line_total += len(indices)
        seen.add((source_id, page_number))
        normalized.append({**item, "lineIndices": sorted(indices)})
    if selected_line_total > MAX_OCR_SELECTED_LINES_TOTAL:
        raise PublicTitleProposalError("OCR title line selection exceeds 128 total")
    return sorted(normalized, key=lambda item: (item["sourceFileId"], item["pageNumber"]))


def _ocr_proposal(evidence: dict[str, Any], row: dict[str, Any],
                  indexed_page_artifact_sha256: str) -> dict[str, Any] | None:
    stages: set[str] = set()
    ciphers: set[tuple[str, str, str]] = set()
    section_titles: set[str] = set()
    selected_lines: list[dict[str, Any]] = []
    for line in evidence["lines"]:
        text = line["text"]
        if len(text) > MAX_TEXT_CHARACTERS:
            raise PublicTitleProposalError("selected OCR title line exceeds text bound")
        cues = explicit_title_cues(text)
        titles = ["PZ"] if _PZ_TITLE.search(text) else []
        stages.update(cues["stagePhraseHints"])
        ciphers.update((item["stage"], item["drawingSection"], item["literal"])
                       for item in cues["cipherHints"])
        section_titles.update(titles)
        selected_lines.append({**line, "stagePhraseHints": cues["stagePhraseHints"],
                               "cipherHints": cues["cipherHints"],
                               "sectionTitleHints": titles})
    if not stages and not ciphers and not section_titles:
        return None
    cues = {"stagePhraseHints": sorted(stages),
            "cipherHints": [{"stage": stage, "drawingSection": mark, "literal": literal}
                            for stage, mark, literal in sorted(ciphers)]}
    flags = _cue_flags(row, cues, "OCR_REQUIRED") + ["OCR_TEXT_REVIEW_REQUIRED"]
    if section_titles and row["section"] == "OTHER":
        flags.append("MANIFEST_SECTION_UNCLASSIFIED")
    if section_titles and row["section"] not in section_titles and row["section"] != "OTHER":
        flags.append("MANIFEST_SECTION_CONFLICT")
    return {
        "proposalKind": "OCR_PROPOSAL", "reviewStatus": "UNVERIFIED_PROPOSAL",
        "sourceFileId": evidence["sourceFileId"], "objectId": evidence["objectId"],
        "sourceSha256": evidence["sourceSha256"],
        "manifestStage": row["stage"], "manifestSection": row["section"],
        "pageNumber": evidence["pageNumber"],
        "indexedPageArtifactSha256": indexed_page_artifact_sha256,
        "indexVersionHash": evidence["indexVersionHash"],
        "pageDisposition": evidence["indexDisposition"],
        "cacheKey": evidence["cacheKey"],
        "cacheContentHash": evidence["cacheContentHash"],
        "ocrArtifactContentHash": evidence["artifactContentHash"],
        "ocrEvidenceSha256": evidence["evidenceSha256"],
        "coordinateSystem": evidence["coordinateSystem"],
        "render": evidence["render"], "provider": evidence["provider"],
        "selectedLineIndices": evidence["selectedLineIndices"],
        "selectedLines": selected_lines,
        "stagePhraseHints": cues["stagePhraseHints"],
        "cipherHints": cues["cipherHints"],
        "sectionTitleHints": sorted(section_titles),
        "possibleManifestSections": sorted(section_titles | {
            DRAWING_TO_MANIFEST_SECTION[mark] for _, mark, _ in ciphers
            if mark in DRAWING_TO_MANIFEST_SECTION}),
        "ambiguityFlags": sorted(set(flags)),
    }


def explicit_title_cues(text: str) -> dict[str, Any]:
    """Find literal stage phrases and stage-section ciphers in one text unit."""
    if not isinstance(text, str) or len(text) > MAX_TEXT_CHARACTERS:
        raise PublicTitleProposalError("title cue text invalid or exceeds bounded length")
    phrases = sorted({stage for stage, pattern in _STAGE_PHRASES if pattern.search(text)})
    ciphers = sorted({(_STAGE_ALIASES[match.group("stage")],
                       _MARK_ALIASES[match.group("mark")], match.group())
                      for match in _CIPHER.finditer(text)})
    return {"stagePhraseHints": phrases,
            "cipherHints": [{"stage": stage, "drawingSection": mark, "literal": literal}
                            for stage, mark, literal in ciphers]}


def _cue_flags(row: dict[str, Any], cues: dict[str, Any],
               disposition: str) -> list[str]:
    stages = set(cues["stagePhraseHints"]) | {item["stage"] for item in cues["cipherHints"]}
    marks = {item["drawingSection"] for item in cues["cipherHints"]}
    flags = ["TITLE_CUE_UNVERIFIED"]
    if len(stages) > 1:
        flags.append("MULTIPLE_STAGE_HINTS")
    if len(marks) > 1:
        flags.append("MULTIPLE_SECTION_HINTS")
    if row["stage"] == "RD_ID_MIXED":
        flags.append("MANIFEST_STAGE_MIXED_REVIEW_REQUIRED")
    elif row["stage"] == "UNKNOWN":
        flags.append("MANIFEST_STAGE_UNKNOWN")
    elif any(stage != row["stage"] for stage in stages):
        flags.append("MANIFEST_STAGE_CONFLICT")
    if marks:
        categories = {DRAWING_TO_MANIFEST_SECTION[mark] for mark in marks
                      if mark in DRAWING_TO_MANIFEST_SECTION}
        if row["section"] == "OTHER":
            flags.append("MANIFEST_SECTION_UNCLASSIFIED")
        elif categories and row["section"] not in categories:
            flags.append("MANIFEST_SECTION_CONFLICT")
        if any(mark not in DRAWING_TO_MANIFEST_SECTION for mark in marks):
            flags.append("SECTION_MARK_WITHOUT_EXACT_MANIFEST_CATEGORY")
    if disposition == "OCR_REQUIRED":
        flags.append("OCR_REQUIRED_PAGE")
    return flags


def build_public_title_proposals(
    manifest_path: Path, index_root: Path, audit_path: Path, *,
    pages_per_source: int = 3, max_proposals: int = 800,
    ocr_selections: list[dict[str, Any]] | None = None,
    ocr_cache_root: Path | None = None,
    _expected_counts: dict[str, int] | None = None,
    _expected_manifest_sha256: str | None = None,
) -> dict[str, Any]:
    """Inspect only title pages 1..3 of every public PDF, with exact provenance.

    Private scope overrides are for synthetic fixture tests; CLI exposes none.
    """
    if (type(pages_per_source) is not int or not 1 <= pages_per_source <= MAX_PAGES_PER_SOURCE
            or type(max_proposals) is not int or not 1 <= max_proposals <= MAX_PROPOSALS):
        raise PublicTitleProposalError("title-page/proposal limits outside bounded range")
    expected = EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    pinned_sha = PUBLIC_MANIFEST_SHA256 if _expected_manifest_sha256 is None else _expected_manifest_sha256
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != pinned_sha:
        raise PublicTitleProposalError("public manifest SHA differs from pinned allowlist")
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise PublicTitleProposalError("public manifest changed during read")
    audit_bytes = audit_path.read_bytes()
    try:
        audit = json.loads(audit_bytes)
    except json.JSONDecodeError as error:
        raise PublicTitleProposalError("audit JSON invalid") from error
    if not isinstance(audit, dict):
        raise PublicTitleProposalError("audit JSON must be an object")
    try:
        _audit_gate(audit, manifest_bytes, rows, expected)
    except ValueError as error:
        raise PublicTitleProposalError(str(error)) from error
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    normalized_ocr = _validate_ocr_selections(
        ocr_selections, ocr_cache_root, pdfs, pages_per_source)
    ocr_by_page = {(item["sourceFileId"], item["pageNumber"]): item
                   for item in normalized_ocr}
    by_id = {row["file_id"]: row for row in rows}
    proposals: list[dict[str, Any]] = []
    ocr_proposals: list[dict[str, Any]] = []
    source_reports: list[dict[str, Any]] = []
    total_pages = 0
    scanned_lines = 0
    omitted_lines = 0
    omitted_blocks = 0
    overlong_units = 0
    cue_count = 0
    # PASS audit seals this completed snapshot. immutable avoids SQLite trying
    # to create WAL shared-memory files through a read-only Docker bind mount.
    with closing(sqlite3.connect((index_root / "index.sqlite3").resolve().as_uri()
                                 + "?mode=ro&immutable=1", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
            raise PublicTitleProposalError("index schema/version differs from PASS audit")
        sources = {record["source_id"]: dict(record)
                   for record in connection.execute("SELECT * FROM sources")}
        if set(sources) != set(by_id):
            raise PublicTitleProposalError("index source inventory differs from public manifest")
        for source_id, source in sources.items():
            row = by_id[source_id]
            if (source["source_sha256"] != row["sha256"]
                    or source["object_id"] != row["object_id"]
                    or source["stage"] != row["stage"]
                    or source["section"] != row["section"]
                    or source["status"] != ("COMPLETE" if row["extension"] == ".pdf"
                                            else "SKIPPED_GROUND_TRUTH_TXT")):
                raise PublicTitleProposalError("index source metadata differs from manifest")

        for row in pdfs:
            source_id = row["file_id"]
            pages_to_scan = min(pages_per_source, row["pdf_pages"])
            source_report = {"sourceFileId": source_id, "objectId": row["object_id"],
                             "manifestStage": row["stage"],
                             "manifestSection": row["section"],
                             "sourceSha256": row["sha256"],
                             "titlePagesScanned": pages_to_scan,
                             "stageHints": [], "sectionHints": [],
                             "cueCount": 0, "proposalsReturned": 0}
            source_stages: set[str] = set()
            source_marks: set[str] = set()
            for page_number in range(1, pages_to_scan + 1):
                record = connection.execute("""
                    SELECT source_sha256,artifact_path,artifact_sha256,
                           parser_provenance,disposition FROM pages
                    WHERE source_id=? AND page_number=?
                """, (source_id, page_number)).fetchone()
                if record is None or record["source_sha256"] != row["sha256"]:
                    raise PublicTitleProposalError("title page missing or source SHA mismatch")
                page = _validate_cached_page(
                    index_root, row, page_number,
                    (record["artifact_path"], record["artifact_sha256"],
                     record["parser_provenance"]),
                )
                if page is None or page["quality"]["disposition"] != record["disposition"]:
                    raise PublicTitleProposalError("title page artifact or quality invalid")
                selection = ocr_by_page.get((source_id, page_number))
                if selection is not None:
                    if record["disposition"] != "OCR_REQUIRED":
                        raise PublicTitleProposalError("selected OCR title page is not OCR_REQUIRED")
                    assert ocr_cache_root is not None
                    try:
                        evidence = load_ocr_family_evidence(
                            manifest_path, index_root, ocr_cache_root,
                            source_id, page_number,
                            expected_object_id=row["object_id"],
                            expected_stage=row["stage"], expected_section=row["section"],
                            line_indices=selection["lineIndices"], dpi=selection["dpi"],
                            script=selection["script"],
                            renderer_profile_id=selection["rendererProfileId"],
                            provider_profile_id=selection["providerProfileId"],
                        )
                    except OcrFamilyEvidenceError as error:
                        raise PublicTitleProposalError(
                            f"selected OCR title evidence invalid for {source_id} p{page_number}"
                        ) from error
                    if (evidence["manifestSha256"] != pinned_sha
                            or evidence["indexVersionHash"] != _version_hash()
                            or evidence["sourceSha256"] != row["sha256"]):
                        raise PublicTitleProposalError("OCR title evidence identity differs from audit")
                    proposal = _ocr_proposal(evidence, row, record["artifact_sha256"])
                    if proposal is not None:
                        ocr_proposals.append(proposal)
                total_pages += 1
                line_stage_hints_by_block: dict[int, set[str]] = {}

                def accept(text: str, *, block_index: int, line_index: int | None,
                           bbox: list[int], kind: str, phrases_only: bool = False) -> None:
                    nonlocal cue_count, overlong_units
                    if len(text) > MAX_TEXT_CHARACTERS:
                        overlong_units += 1
                        return
                    cues = explicit_title_cues(text)
                    if phrases_only:
                        cues["cipherHints"] = []
                        cues["stagePhraseHints"] = sorted(
                            set(cues["stagePhraseHints"])
                            - line_stage_hints_by_block.get(block_index, set()))
                    if not cues["stagePhraseHints"] and not cues["cipherHints"]:
                        return
                    if kind == "LINE" and cues["stagePhraseHints"]:
                        line_stage_hints_by_block.setdefault(block_index, set()).update(
                            cues["stagePhraseHints"])
                    cue_count += 1
                    source_report["cueCount"] += 1
                    source_stages.update(cues["stagePhraseHints"])
                    source_stages.update(item["stage"] for item in cues["cipherHints"])
                    source_marks.update(item["drawingSection"] for item in cues["cipherHints"])
                    if len(proposals) >= max_proposals:
                        return
                    categories = sorted({DRAWING_TO_MANIFEST_SECTION[mark]
                                         for mark in (item["drawingSection"]
                                                      for item in cues["cipherHints"])
                                         if mark in DRAWING_TO_MANIFEST_SECTION})
                    proposals.append({
                        "sourceFileId": source_id, "objectId": row["object_id"],
                        "sourceSha256": row["sha256"],
                        "manifestStage": row["stage"],
                        "manifestSection": row["section"],
                        "pageNumber": page_number,
                        "pageArtifactSha256": record["artifact_sha256"],
                        "indexVersionHash": _version_hash(),
                        "pageDisposition": record["disposition"],
                        "parserProvenance": record["parser_provenance"],
                        "locatorKind": kind, "blockIndex": block_index,
                        "lineIndex": line_index,
                        "bboxMilliPoints": bbox,
                        "rawText": text,
                        "textSnippet": text[:SNIPPET_CHARACTERS],
                        "stagePhraseHints": cues["stagePhraseHints"],
                        "cipherHints": cues["cipherHints"],
                        "possibleManifestSections": categories,
                        "ambiguityFlags": _cue_flags(row, cues, record["disposition"]),
                        "reviewStatus": "UNVERIFIED_PROPOSAL",
                    })
                    source_report["proposalsReturned"] += 1

                lines = page["lines"]
                scanned_lines += min(len(lines), MAX_LINES_PER_PAGE)
                omitted_lines += max(0, len(lines) - MAX_LINES_PER_PAGE)
                for line in lines[:MAX_LINES_PER_PAGE]:
                    accept(line["text"], block_index=line["blockIndex"],
                           line_index=line["lineIndex"], bbox=line["bboxMilliPoints"],
                           kind="LINE")
                blocks = page["blocks"]
                omitted_blocks += max(0, len(blocks) - MAX_BLOCKS_PER_PAGE)
                for block_index, block in enumerate(blocks[:MAX_BLOCKS_PER_PAGE]):
                    accept(block["text"], block_index=block_index, line_index=None,
                           bbox=block["bboxMilliPoints"], kind="BLOCK",
                           phrases_only=True)
            source_report["stageHints"] = sorted(source_stages)
            source_report["sectionHints"] = sorted(source_marks)
            source_report["mixedCueStages"] = len(source_stages) > 1
            source_report["manifestStageDisagreesWithCue"] = (
                row["stage"] in {"PD", "RD", "ID"}
                and any(stage != row["stage"] for stage in source_stages))
            source_report["mixedManifestStageNeedsReview"] = (
                row["stage"] == "RD_ID_MIXED" and bool(source_stages))
            source_reports.append(source_report)
    if manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes:
        raise PublicTitleProposalError("manifest or PASS audit changed during report")
    report = {
        "schemaVersion": "public-title-proposals-v2" if normalized_ocr else "public-title-proposals-v1",
        "disposition": "REVIEW_ONLY_ABSTAIN",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_PDF_TITLE_PAGES_ONLY",
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
        "indexVersionHash": _version_hash(),
        "limits": {"pagesPerSource": pages_per_source,
                   "maxProposals": max_proposals,
                   "maxLinesPerPage": MAX_LINES_PER_PAGE,
                   "maxBlocksPerPage": MAX_BLOCKS_PER_PAGE},
        "totals": {"publicPdfSources": len(pdfs), "titlePagesScanned": total_pages,
                   "linesScanned": scanned_lines, "linesOmitted": omitted_lines,
                   "blocksOmitted": omitted_blocks,
                   "overlongTextUnitsOmitted": overlong_units,
                   "cueUnitsSeen": cue_count, "proposalsReturned": len(proposals),
                   "proposalsOmitted": cue_count - len(proposals)},
        "truncated": bool(omitted_lines or omitted_blocks or overlong_units
                          or cue_count > len(proposals)),
        "findingCount": None, "parameterCoverage": None,
        "sourceReports": source_reports,
        "proposals": proposals,
    }
    if normalized_ocr:
        report["ocrSelectionsSha256"] = canonical_hash(normalized_ocr)
        report["ocrSelectionLimits"] = {
            "maxPages": MAX_OCR_SELECTED_PAGES,
            "maxLinesPerPage": MAX_OCR_SELECTED_LINES_PER_PAGE,
            "maxLinesTotal": MAX_OCR_SELECTED_LINES_TOTAL,
        }
        report["totals"]["ocrSelectedPages"] = len(normalized_ocr)
        report["totals"]["ocrProposalsReturned"] = len(ocr_proposals)
        report["totals"]["ocrSelectedPagesWithoutCue"] = (
            len(normalized_ocr) - len(ocr_proposals))
        report["ocrProposals"] = ocr_proposals
    return report
