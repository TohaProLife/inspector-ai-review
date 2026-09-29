"""Review-only text navigation for KR-065 opening details.

Text-block geometry does not establish a drawing contour, shared element,
reinforcement, or authorization. Every code result remains ABSTAIN.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "kr065-opening-proposals-v1"
PROFILE_ID = "kr065-opening-review-v1"
CODE = "KR-065"
MAX_PROPOSALS = 16
MAX_ABSTENTIONS = 16
MAX_LINE_CHARS = 180
MAX_TEXT_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_OPENING = re.compile(r"(?:обрамлени[ея]|монтажн\w*\s+про[её]м|отверсти[яе])", re.I)
_NUMBER = re.compile(r"№\s*(\d{1,4})\b")
_DIMENSION = re.compile(r"(?<!\d)(\d{2,5})\s*[xх×]\s*(\d{2,5})(?:\s*\(h\))?\s*мм\b", re.I)
_CLOSURE = re.compile(r"деталь\s+заделки\s+монтажного\s+про[её]ма\b", re.I)
_DETAIL = re.compile(r"деталь\s+\d{1,3}\b", re.I)


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _locator(block_index: int, line_index: int, line: str,
             block: dict[str, Any]) -> dict[str, Any]:
    return {"blockIndex": block_index, "lineIndex": line_index,
            "lineText": line,
            "lineTextSha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
            "blockTextSha256": hashlib.sha256(block["text"].encode("utf-8")).hexdigest(),
            "bboxMilliPoints": block["bboxMilliPoints"]}


def _page_proposals(page: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int, int]:
    """Inspect a qualified page; never associate labels with drawing contours."""
    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
        return [], [], 0, 0
    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    oversize = duplicate = 0
    seen_labels: set[tuple[str, str, str]] = set()
    seen_headings: set[tuple[str, str]] = set()
    for block_index, block in enumerate(page["blocks"]):
        for line_index, line in enumerate(block["text"].splitlines()):
            if not (_OPENING.search(line) or _CLOSURE.search(line) or _DETAIL.search(line)):
                continue
            if len(line) > MAX_LINE_CHARS:
                oversize += 1
                continue
            locator = _locator(block_index, line_index, line, block)
            if _CLOSURE.search(line):
                if ("closure", line) in seen_headings:
                    duplicate += 1
                    abstentions.append({"reasonCode": "DUPLICATE_HEADING_CONTEXT_UNVERIFIED",
                                        "anchor": locator})
                seen_headings.add(("closure", line))
                proposals.append(_proposal("DESIGNED_CLOSURE_HEADING_NAVIGATION", locator,
                                           None, None))
                continue
            if _OPENING.search(line):
                numbers, dimensions = _NUMBER.findall(line), list(_DIMENSION.finditer(line))
                if len(numbers) == 1 and len(dimensions) == 1:
                    raw_dimension = dimensions[0].group(0)
                    key = (numbers[0], raw_dimension, line)
                    if key in seen_labels:
                        duplicate += 1
                        abstentions.append({"reasonCode": "DUPLICATE_OPENING_LABEL",
                                            "anchor": locator})
                        continue
                    seen_labels.add(key)
                    proposals.append(_proposal("OPENING_LABEL_DIMENSION_NAVIGATION", locator,
                                               numbers[0], raw_dimension))
                elif numbers or dimensions:
                    abstentions.append({"reasonCode": "OPENING_LABEL_AMBIGUOUS",
                                        "anchor": locator})
                continue
            # A repeated `Деталь 3` can identify unrelated details, including
            # F0141 p23 and F0143 p21. Keep it as a standalone heading.
            if ("detail", line) in seen_headings:
                duplicate += 1
                abstentions.append({"reasonCode": "DUPLICATE_HEADING_CONTEXT_UNVERIFIED",
                                    "anchor": locator})
            seen_headings.add(("detail", line))
            proposals.append(_proposal("DETAIL_HEADING_NAVIGATION", locator, None, None))
    return proposals, abstentions, oversize, duplicate


def _proposal(kind: str, locator: dict[str, Any], number: str | None,
              dimensions: str | None) -> dict[str, Any]:
    return {"proposalKind": kind, "rawOpeningNumber": number,
            "rawDimensionsText": dimensions, "rawAxes": None, "rawLevel": None,
            "drawingContourAssociation": "UNVERIFIED",
            "detailAssociation": "UNVERIFIED", "sameElementAssociation": "UNVERIFIED",
            "reinforcementStatus": "NOT_ESTABLISHED",
            "unauthorizedFillStatus": "NOT_ESTABLISHED",
            "anchor": locator}


def evaluate_kr065_opening_proposals(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("KR-065 objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("KR-065 inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("KR-065 sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("KR-065 duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("KR-065 artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("KR-065 unknown or duplicate text artifact")
        if len(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_TEXT_ARTIFACT_BYTES:
            raise ValueError("KR-065 text artifact exceeds bound")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        artifact_hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": artifact_hashes[source_id]}
        for source_id in sorted(artifacts)]
    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    reasons = {"REVIEW_ONLY_NOT_TYPED_FACT", "CONTOUR_ASSOCIATION_UNVERIFIED",
               "PD_RD_PAIR_UNVERIFIED", "SAME_ELEMENT_UNVERIFIED"}
    eligible = text_pages = ocr_pages = oversize = duplicates = 0
    for source_id in sorted(source_index):
        source = source_index[source_id]
        if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
            reasons.add("SOURCE_REVIEW_REQUIRED")
            continue
        if source["stages"] != ["RD"] or source.get("pageStages", {}):
            reasons.add("SOURCE_STAGE_UNRESOLVED")
            continue
        if source["sectionCode"] != "KR":
            reasons.add("SOURCE_ROLE_NOT_ALLOWED")
            continue
        artifact = artifacts.get(source_id)
        if artifact is None:
            reasons.add("TEXT_ARTIFACT_MISSING")
            continue
        eligible += 1
        for page in sorted(artifact["pages"], key=lambda item: item["pageNumber"]):
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                ocr_pages += 1
                reasons.add("OCR_REQUIRED_DEFERRED")
                continue
            text_pages += 1
            local_proposals, local_abstentions, long_count, duplicate_count = _page_proposals(page)
            oversize += long_count
            duplicates += duplicate_count
            for key, local_items, target in (("proposals", local_proposals, proposals),
                                             ("abstentions", local_abstentions, abstentions)):
                for item in local_items:
                    scoped = {"sourceFileId": source_id,
                              "sourceSha256": source["sha256"],
                              "textArtifactSha256": artifact_hashes[source_id],
                              "pageSha256": _hash(page), "pageNumber": page["pageNumber"],
                              "sourceStage": "RD", "sourceSection": "KR", **item}
                    scoped["scopedSha256"] = _hash(scoped)
                    target.append(scoped)
    proposals.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                     item["anchor"]["blockIndex"], item["anchor"]["lineIndex"],
                                     item["scopedSha256"]))
    abstentions.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                      item["anchor"]["blockIndex"], item["anchor"]["lineIndex"],
                                      item["scopedSha256"]))
    proposal_count, abstention_count = len(proposals), len(abstentions)
    if proposal_count > MAX_PROPOSALS:
        reasons.add("PROPOSAL_LIMIT_REACHED")
    if abstention_count > MAX_ABSTENTIONS:
        reasons.add("ABSTENTION_LIMIT_REACHED")
    if oversize:
        reasons.add("OVERSIZE_ANCHOR_LINE_DEFERRED")
    if duplicates:
        reasons.add("DUPLICATE_ANCHOR_DEFERRED")
    if eligible == 0:
        reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
    if proposal_count == 0:
        reasons.add("NO_SAFE_PROPOSAL_IN_SCANNED_TEXT" if text_pages else "NO_SCANNED_TEXT_IN_SCOPE")
    row = {"parameterCode": CODE, "status": "ABSTAIN",
           "reasonCodes": sorted(reasons), "eligibleSourceCount": eligible,
           "textCandidatePageCount": text_pages, "ocrRequiredPageCount": ocr_pages,
           "oversizeAnchorLineCount": oversize, "duplicateAnchorCount": duplicates,
           "proposalCount": proposal_count,
           "truncatedProposalCount": proposal_count - min(proposal_count, MAX_PROPOSALS),
           "abstentionCount": abstention_count,
           "truncatedAbstentionCount": abstention_count - min(abstention_count, MAX_ABSTENTIONS),
           "absenceConclusion": "NOT_AVAILABLE",
           "proposals": proposals[:MAX_PROPOSALS], "abstentions": abstentions[:MAX_ABSTENTIONS]}
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": [row], "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RESULT_BYTES:
        raise ValueError("KR-065 result exceeds bound")
    return result


def execute_durable_kr065_opening_proposals(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_kr065_opening_proposals(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
