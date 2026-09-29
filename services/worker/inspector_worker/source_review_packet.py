"""Prioritize human title review from pinned public planning reports.

An observed title cue is never a verified source gate. This module reads only
the public manifest and two SHA-pinned, review-only JSON reports; no PDF/TXT,
index artifact, OCR provider, rule execution, or source mutation is involved.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from .candidate_family_rules import DRAWING_TO_MANIFEST_SECTION
from .public_document_index import load_public_manifest


MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
MATRIX_SHA256 = "bae837695b1f7219ca7328515b605eef6cf87f04e3a53d428aa465dcab16dedd"
TITLE_SHA256 = "b89830d4789a24cc0b8712a54f0f1ddf696aec51758e3fb4440d42966f316e6a"
PACK_SHA256 = "a3ad00a04865f04bfeef5c2f21f5a11054fec88dcab264590fdb66d70a968581"
PUBLIC_COUNTS = {"sourceCount": 203, "pdfSources": 202, "pdfPages": 10_142,
                 "txtInventorySources": 1}
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_LOCATORS_PER_SOURCE = 6
AMBIGUOUS_BUCKETS = ("unresolvedSectionSourceIds", "mixedStageSourceIds",
                     "mixedStageUnclassifiedSourceIds")
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_EXECUTION_DRAWING = re.compile(r"\bисполнительн\w*\s+чертеж\w*\b", re.IGNORECASE)


class SourceReviewPacketError(ValueError):
    """Input reports cannot be trusted for this public review packet."""


def _sha(value: Any) -> bool:
    return isinstance(value, str) and _HASH.fullmatch(value) is not None


def _read_pinned_json(path: Path, expected_sha256: str) -> dict[str, Any]:
    if not _sha(expected_sha256):
        raise SourceReviewPacketError("expected report SHA-256 invalid")
    raw = path.read_bytes()
    if len(raw) > MAX_REPORT_BYTES or hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise SourceReviewPacketError("report SHA-256 differs from pinned input")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceReviewPacketError("pinned report JSON invalid") from error
    if not isinstance(value, dict):
        raise SourceReviewPacketError("pinned report must be JSON object")
    return value


def _manifest_rows(path: Path, expected_sha256: str,
                   counts: dict[str, int]) -> dict[str, dict[str, Any]]:
    before = path.read_bytes()
    if hashlib.sha256(before).hexdigest() != expected_sha256:
        raise SourceReviewPacketError("public manifest SHA-256 differs from pinned input")
    rows = load_public_manifest(path)
    if path.read_bytes() != before:
        raise SourceReviewPacketError("public manifest changed during read")
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    txt = [row for row in rows if row["extension"] == ".txt"]
    if (len(rows) != counts["sourceCount"] or len(pdfs) != counts["pdfSources"]
            or sum(row["pdf_pages"] for row in pdfs) != counts["pdfPages"]
            or len(txt) != counts["txtInventorySources"]
            or len(txt) != 1 or txt[0]["file_id"] != "F0194"
            or txt[0].get("annotation_status") != "GROUND_TRUTH_INDEX"):
        raise SourceReviewPacketError("public manifest inventory differs from pinned scope")
    return {row["file_id"]: row for row in pdfs}


def _checked_locator(source: dict[str, Any], proposal: dict[str, Any],
                     *, ocr: bool) -> list[dict[str, Any]]:
    if (proposal.get("sourceFileId") != source["file_id"]
            or proposal.get("sourceSha256") != source["sha256"]
            or proposal.get("objectId") != source["object_id"]
            or proposal.get("manifestStage") != source["stage"]
            or proposal.get("manifestSection") != source["section"]
            or type(proposal.get("pageNumber")) is not int
            or not 1 <= proposal["pageNumber"] <= min(3, source["pdf_pages"])):
        raise SourceReviewPacketError("title proposal source/page differs from manifest")
    if proposal.get("reviewStatus") != "UNVERIFIED_PROPOSAL":
        raise SourceReviewPacketError("title proposal lost unverified status")
    page = proposal["pageNumber"]
    if ocr:
        if (proposal.get("proposalKind") != "OCR_PROPOSAL"
                or proposal.get("pageDisposition") != "OCR_REQUIRED"
                or proposal.get("coordinateSystem") != "IMAGE_TOP_LEFT_PIXELS"
                or any(not _sha(proposal.get(key)) for key in (
                    "indexedPageArtifactSha256", "ocrArtifactContentHash",
                    "cacheKey", "cacheContentHash", "ocrEvidenceSha256"))):
            raise SourceReviewPacketError("OCR title provenance invalid")
        render = proposal.get("render")
        provider = proposal.get("provider")
        lines = proposal.get("selectedLines")
        if (not isinstance(render, dict) or not isinstance(lines, list)
                or not 1 <= len(lines) <= 32
                or not _sha(render.get("sha256"))
                or type(render.get("widthPx")) is not int
                or type(render.get("heightPx")) is not int
                or render["widthPx"] <= 0 or render["heightPx"] <= 0
                or type(render.get("dpi")) is not int
                or not isinstance(render.get("rendererProfileId"), str)
                or not render["rendererProfileId"]
                or not isinstance(provider, dict)
                or not isinstance(provider.get("profileId"), str)
                or not provider["profileId"]
                or not isinstance(provider.get("script"), str)
                or not provider["script"]
                or [line.get("lineIndex") for line in lines] != proposal.get("selectedLineIndices")):
            raise SourceReviewPacketError("OCR title lines/render invalid")
        result = []
        for line in lines:
            bbox = line.get("bboxPx")
            if (type(line.get("lineIndex")) is not int or line["lineIndex"] < 0
                    or not isinstance(line.get("text"), str) or len(line["text"]) > 8192
                    or not isinstance(bbox, list) or len(bbox) != 4
                    or any(type(value) is not int for value in bbox)
                    or not 0 <= bbox[0] < bbox[2] <= render["widthPx"]
                    or not 0 <= bbox[1] < bbox[3] <= render["heightPx"]
                    or type(line.get("score")) not in (int, float)
                    or not math.isfinite(line["score"])
                    or not 0 <= line["score"] <= 1):
                raise SourceReviewPacketError("OCR title pixel locator invalid")
            result.append({
                "evidenceKind": "OCR", "pageNumber": page,
                "lineIndex": line["lineIndex"], "rawText": line["text"],
                "bboxPx": bbox, "score": line.get("score"),
                "indexedPageArtifactSha256": proposal["indexedPageArtifactSha256"],
                "cacheKey": proposal["cacheKey"],
                "cacheContentHash": proposal["cacheContentHash"],
                "ocrArtifactContentHash": proposal["ocrArtifactContentHash"],
                "ocrEvidenceSha256": proposal["ocrEvidenceSha256"],
                "renderSha256": render["sha256"], "dpi": render["dpi"],
                "rendererProfileId": render["rendererProfileId"],
                "providerProfileId": provider["profileId"],
                "script": provider["script"],
                "stagePhraseHints": line.get("stagePhraseHints", []),
                "cipherHints": line.get("cipherHints", []),
                "sectionTitleHints": line.get("sectionTitleHints", []),
            })
        return result
    if (not _sha(proposal.get("pageArtifactSha256"))
            or proposal.get("locatorKind") not in {"LINE", "BLOCK"}
            or type(proposal.get("blockIndex")) is not int
            or proposal["blockIndex"] < 0
            or not isinstance(proposal.get("rawText"), str)
            or len(proposal["rawText"]) > 8192):
        raise SourceReviewPacketError("PDF title locator invalid")
    bbox = proposal.get("bboxMilliPoints")
    if (not isinstance(bbox, list) or len(bbox) != 4
            or any(type(value) is not int for value in bbox)
            or not 0 <= bbox[0] < bbox[2] or not 0 <= bbox[1] < bbox[3]):
        raise SourceReviewPacketError("PDF title box invalid")
    line_index = proposal.get("lineIndex")
    if (proposal["locatorKind"] == "LINE" and
            (type(line_index) is not int or line_index < 0)):
        raise SourceReviewPacketError("PDF title line index invalid")
    if proposal["locatorKind"] == "BLOCK" and line_index is not None:
        raise SourceReviewPacketError("PDF title block locator invalid")
    return [{
        "evidenceKind": "PDF_TEXT", "pageNumber": page,
        "locatorKind": proposal["locatorKind"],
        "blockIndex": proposal["blockIndex"], "lineIndex": line_index,
        "rawText": proposal["rawText"], "bboxMilliPoints": bbox,
        "pageArtifactSha256": proposal["pageArtifactSha256"],
        "stagePhraseHints": proposal.get("stagePhraseHints", []),
        "cipherHints": proposal.get("cipherHints", []),
        "sectionTitleHints": [],
    }]


def _labels(units: list[dict[str, Any]]) -> tuple[set[str], set[str], set[str]]:
    stages: set[str] = set()
    sections: set[str] = set()
    ciphers: set[str] = set()
    for unit in units:
        stages.update(unit["stagePhraseHints"])
        sections.update(unit["sectionTitleHints"])
        for cue in unit["cipherHints"]:
            stages.add(cue["stage"])
            sections.add(cue["drawingSection"])
            ciphers.add(cue["literal"])
    return stages, sections, ciphers


def _title_aligned_marks(units: list[dict[str, Any]], role_stage: str) -> set[str]:
    by_page_stages: dict[int, set[str]] = defaultdict(set)
    for unit in units:
        by_page_stages[unit["pageNumber"]].update(unit["stagePhraseHints"])
        by_page_stages[unit["pageNumber"]].update(
            cue["stage"] for cue in unit["cipherHints"])
    aligned: set[str] = set()
    for unit in units:
        aligned.update(cue["drawingSection"] for cue in unit["cipherHints"]
                       if cue["stage"] == role_stage)
        if by_page_stages[unit["pageNumber"]] == {role_stage}:
            aligned.update(unit["sectionTitleHints"])
    return aligned


def _conflicts(source: dict[str, Any], stages: set[str], sections: set[str],
               units: list[dict[str, Any]]) -> list[dict[str, str]]:
    found: set[tuple[str, str, str]] = set()
    for stage in stages:
        if source["stage"] == "RD_ID_MIXED":
            found.add(("MANIFEST_MIXED_STAGE", source["stage"], stage))
        elif source["stage"] != stage:
            found.add(("TITLE_MANIFEST_STAGE_CONFLICT", source["stage"], stage))
    if len(stages) > 1:
        found.add(("MULTIPLE_TITLE_STAGES", source["stage"], ",".join(sorted(stages))))
    for section in sections:
        category = DRAWING_TO_MANIFEST_SECTION.get(section)
        if source["section"] == "OTHER":
            found.add(("MANIFEST_SECTION_UNCLASSIFIED", "OTHER", section))
        if category is None:
            found.add(("TITLE_SECTION_WITHOUT_MANIFEST_MAPPING", source["section"], section))
        elif source["section"] != "OTHER" and category != source["section"]:
            found.add(("TITLE_MANIFEST_SECTION_CONFLICT", source["section"], section))
    if len(sections) > 1:
        found.add(("MULTIPLE_TITLE_SECTIONS", source["section"],
                   ",".join(sorted(sections))))
    if any(_EXECUTION_DRAWING.search(unit["rawText"]) for unit in units):
        found.add(("EXECUTION_DRAWING_REFERENCE", source["stage"],
                   "Исполнительные чертежи"))
    return [{"kind": kind, "manifestLabel": manifest, "titleLabel": title}
            for kind, manifest, title in sorted(found)]


def _evidence_sample(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for unit in sorted(units, key=lambda unit: (
            unit["pageNumber"], unit.get("blockIndex", -1), unit.get("lineIndex", -1),
            unit["evidenceKind"])):
        key = (unit["evidenceKind"], unit["rawText"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(unit)
    # Keep every selected OCR title line on F0150, including revision context.
    ocr = [unit for unit in unique if unit["evidenceKind"] == "OCR"]
    text = [unit for unit in unique if unit["evidenceKind"] == "PDF_TEXT"]
    result = (ocr + text)[:MAX_LOCATORS_PER_SOURCE] if ocr else text[:MAX_LOCATORS_PER_SOURCE]
    return result


def _source_rank(item: dict[str, Any]) -> tuple[Any, ...]:
    return (-item["titleAlignedCodeRoleCount"],
            -int(item["manifestStage"] == "RD_ID_MIXED"),
            -int(item["manifestStage"] == "RD"),
            -int(item["manifestSection"] == "OTHER"),
            -item["matrixAmbiguityCodeRoleCount"], item["sourceFileId"])


def _select_diverse(items: list[dict[str, Any]], target: int) -> list[dict[str, Any]]:
    ranked = sorted(items, key=_source_rank)
    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def add(item: dict[str, Any]) -> None:
        if len(selected) < target and item["sourceFileId"] not in seen_ids:
            selected.append(item)
            seen_ids.add(item["sourceFileId"])

    for item in ranked:
        if item["titleAlignedCodeRoleCount"]:
            add(item)
    represented = {(item["objectId"], item["manifestStage"], item["manifestSection"])
                   for item in selected}
    for item in ranked:
        group = (item["objectId"], item["manifestStage"], item["manifestSection"])
        if group not in represented:
            add(item)
            represented.add(group)
    for item in ranked:
        add(item)
    return selected


def build_source_review_packet(
    manifest_path: Path, matrix_path: Path, title_path: Path, *,
    target_sources: int | None = 25,
    _expected_manifest_sha256: str = MANIFEST_SHA256,
    _expected_matrix_sha256: str = MATRIX_SHA256,
    _expected_title_sha256: str = TITLE_SHA256,
    _expected_pack_sha256: str = PACK_SHA256,
    _expected_counts: dict[str, int] | None = None,
    _expected_code_count: int = 47,
) -> dict[str, Any]:
    """Return a bounded title priority packet or every ambiguous task, never decisions."""
    if target_sources is not None and (type(target_sources) is not int
                                       or not 20 <= target_sources <= 30):
        raise SourceReviewPacketError("review packet target must be 20..30 sources or all")
    counts = PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    pdf_by_id = _manifest_rows(manifest_path, _expected_manifest_sha256, counts)
    matrix = _read_pinned_json(matrix_path, _expected_matrix_sha256)
    title = _read_pinned_json(title_path, _expected_title_sha256)
    if (matrix.get("schemaVersion") != "candidate-source-matrix-v1"
            or matrix.get("disposition") != "SOURCE_PLANNING_ONLY_ABSTAIN"
            or matrix.get("manifestSha256") != _expected_manifest_sha256
            or matrix.get("candidatePackSha256") != _expected_pack_sha256
            or matrix.get("inventory", {}).get("publicSources") != counts["sourceCount"]
            or matrix.get("inventory", {}).get("publicPdfSources") != counts["pdfSources"]
            or matrix.get("inventory", {}).get("publicPdfPages") != counts["pdfPages"]
            or matrix.get("inventory", {}).get("metadataOnlySourceId") != "F0194"):
        raise SourceReviewPacketError("candidate matrix identity/scope invalid")
    codes = matrix.get("codes")
    if (not isinstance(codes, list) or len(codes) != _expected_code_count
            or len({code.get("parameterCode") for code in codes}) != len(codes)):
        raise SourceReviewPacketError("candidate matrix code inventory invalid")
    if (title.get("schemaVersion") != "public-title-proposals-v2"
            or title.get("disposition") != "REVIEW_ONLY_ABSTAIN"
            or title.get("manifestSha256") != _expected_manifest_sha256
            or not _sha(title.get("auditSha256"))
            or not isinstance(title.get("indexVersionHash"), str)
            or title.get("truncated") is not False
            or title.get("findingCount") is not None
            or title.get("parameterCoverage") is not None
            or not isinstance(title.get("proposals"), list)
            or not isinstance(title.get("ocrProposals"), list)):
        raise SourceReviewPacketError("title report identity/status invalid")
    title_sources = title.get("sourceReports")
    if (not isinstance(title_sources, list) or len(title_sources) != len(pdf_by_id)
            or {item.get("sourceFileId") for item in title_sources} != set(pdf_by_id)):
        raise SourceReviewPacketError("title source inventory differs from public PDFs")
    for item in title_sources:
        row = pdf_by_id[item["sourceFileId"]]
        if (item.get("sourceSha256") != row["sha256"]
                or item.get("objectId") != row["object_id"]
                or item.get("manifestStage") != row["stage"]
                or item.get("manifestSection") != row["section"]):
            raise SourceReviewPacketError("title source report differs from manifest")
    if (title.get("totals", {}).get("publicPdfSources") != len(pdf_by_id)
            or title["totals"].get("proposalsReturned") != len(title["proposals"])
            or title["totals"].get("ocrProposalsReturned") != len(title["ocrProposals"])):
        raise SourceReviewPacketError("title report counts inconsistent")

    title_units: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for is_ocr, key in ((False, "proposals"), (True, "ocrProposals")):
        for proposal in title[key]:
            source_id = proposal.get("sourceFileId")
            source = pdf_by_id.get(source_id)
            if source is None:
                raise SourceReviewPacketError("title proposal outside public PDF inventory")
            title_units[source_id].extend(_checked_locator(source, proposal, ocr=is_ocr))

    matrix_roles: dict[str, dict[tuple[str, str], dict[str, Any]]] = defaultdict(dict)
    for code in codes:
        parameter_code = code.get("parameterCode")
        if (not isinstance(parameter_code, str) or not parameter_code
                or code.get("disposition") != "SOURCE_PLANNING_ONLY_ABSTAIN"
                or not isinstance(code.get("objects"), list)):
            raise SourceReviewPacketError("candidate code malformed")
        for object_plan in code["objects"]:
            object_id = object_plan.get("objectId")
            for role, stage in (("expected", "PD"), ("actual", "RD")):
                plan = object_plan.get(role)
                if (not isinstance(plan, dict) or plan.get("stage") != stage
                        or not isinstance(plan.get("requiredDrawingSections"), list)):
                    raise SourceReviewPacketError("candidate role plan malformed")
                for bucket in AMBIGUOUS_BUCKETS:
                    ids = plan.get(bucket)
                    if not isinstance(ids, list):
                        raise SourceReviewPacketError("candidate role source list malformed")
                    for source_id in ids:
                        source = pdf_by_id.get(source_id)
                        if (source is None or source["object_id"] != object_id
                                or role == "expected" and source["stage"] != "PD"
                                or role == "actual" and source["stage"] not in
                                {"RD", "RD_ID_MIXED"}):
                            raise SourceReviewPacketError("candidate role source outside manifest scope")
                        key = (parameter_code, role)
                        if key in matrix_roles[source_id]:
                            raise SourceReviewPacketError("candidate role source duplicated")
                        matrix_roles[source_id][key] = {
                            "parameterCode": parameter_code, "role": role,
                            "matrixBucket": bucket.removesuffix("SourceIds"),
                            "requiredDrawingSections": plan["requiredDrawingSections"],
                            "requiredManifestSections": plan.get("requiredManifestSections", []),
                        }

    candidates: list[dict[str, Any]] = []
    for source_id, roles in sorted(matrix_roles.items()):
        units = title_units.get(source_id, [])
        if not units and target_sources is not None:
            continue
        source = pdf_by_id[source_id]
        stages, sections, ciphers = _labels(units)
        aligned_by_stage = {stage: _title_aligned_marks(units, stage)
                            for stage in ("PD", "RD")}
        gates = []
        for gate in sorted(roles.values(), key=lambda gate: (gate["parameterCode"], gate["role"])):
            matched = sorted(set(gate["requiredDrawingSections"])
                             & aligned_by_stage["PD" if gate["role"] == "expected" else "RD"])
            gates.append({**gate, "titleAlignedDrawingSections": matched})
        direct = [gate for gate in gates if gate["titleAlignedDrawingSections"]]
        conflicts = _conflicts(source, stages, sections, units)
        item = {
            "sourceFileId": source_id, "sourceSha256": source["sha256"],
            "sourceRelativePath": source["relative_path"],
            "objectId": source["object_id"], "manifestStage": source["stage"],
            "manifestSection": source["section"],
            "priorityTier": ("NO_TITLE_CUE_REVIEW" if not units else
                             "EXPLICIT_TITLE_SECTION_ALIGNMENT" if direct else
                             "UNMAPPED_OR_CONFLICTING_TITLE" if sections or conflicts else
                             "STAGE_ONLY_TITLE_REVIEW"),
            "sourceGateStatus": "UNVERIFIED_REVIEW_ONLY",
            "matrixAmbiguityCodeRoleCount": len(gates),
            "titleAlignedCodeRoleCount": len(direct),
            "codeList": sorted({gate["parameterCode"] for gate in gates}),
            "titleAlignedCodeList": sorted({gate["parameterCode"] for gate in direct}),
            "candidateCodeRoles": gates,
            "titleLabels": {"stages": sorted(stages), "drawingSections": sorted(sections),
                            "literalCiphers": sorted(ciphers)},
            "conflictingTitleLabels": conflicts,
            "titleLocators": _evidence_sample(units),
            "titleLocatorsOmitted": max(0, len(units) - len(_evidence_sample(units))),
        }
        candidates.append(item)
    if target_sources is None:
        target_sources = len(candidates)
    if len(candidates) < target_sources:
        raise SourceReviewPacketError("fewer title-backed candidates than requested packet")
    selected = _select_diverse(candidates, target_sources)
    for rank, item in enumerate(selected, 1):
        item["reviewRank"] = rank
    groups = {(item["objectId"], item["manifestStage"], item["manifestSection"])
              for item in selected}
    return {
        "schemaVersion": "source-review-packet-v1",
        "disposition": "HUMAN_REVIEW_ONLY_ABSTAIN",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_PDF_METADATA_AND_TITLE_CUES",
        "manifestSha256": _expected_manifest_sha256,
        "candidateMatrixSha256": _expected_matrix_sha256,
        "titleProposalsSha256": _expected_title_sha256,
        "candidatePackSha256": _expected_pack_sha256,
        "titleAuditSha256": title["auditSha256"],
        "indexVersionHash": title["indexVersionHash"],
        "selectionPolicy": "EXPLICIT_SECTION_ALIGNMENT_THEN_DISTINCT_OBJECT_STAGE_SECTION_GROUPS_THEN_RANK",
        "totals": {"candidateCodes": len(codes),
                   "ambiguousSources": len(matrix_roles),
                   "titleBackedAmbiguousSources": sum(bool(title_units.get(item["sourceFileId"]))
                                                      for item in candidates),
                   "sourcesWithoutTitleCue": sum(not title_units.get(item["sourceFileId"])
                                                 for item in candidates),
                   "selectedSources": len(selected), "targetSources": target_sources,
                   "selectedManifestGroups": len(groups),
                   "sourcesWithExplicitTitleSectionAlignment": sum(
                       bool(item["titleAlignedCodeRoleCount"]) for item in selected),
                   "titleAlignedCodeRoles": sum(
                       item["titleAlignedCodeRoleCount"] for item in selected)},
        "findingCount": None, "parameterCoverage": None,
        "sources": selected,
    }
