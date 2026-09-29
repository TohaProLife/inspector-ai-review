"""Opt-in, run-scoped lexical review for three unresolved parameter codes.

Inputs are fenced, committed document-text-v2 artifacts. Output is navigation
only: no typed facts, comparisons, findings, or parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .pipe_material_review import line_observation
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "unresolved-family-run-review-v1"
PROFILE_ID = "unresolved-family-text-review-v1"
CODES = ("AR-042", "IOS2-072", "IOS3-075")
_SECTION = {"AR-042": "AR", "IOS2-072": "VK", "IOS3-075": "VK"}
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_HEIGHT = re.compile(r"высот\w*", re.I)
_HEIGHT_TARGET = re.compile(r"коридор\w*|про[её]м\w*|двер\w*", re.I)
_MAX_LEADS_PER_CODE = 16


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _line_codes(line: str) -> tuple[str, ...]:
    """Require same-line anchors; line is a clue, never an element fact."""
    if not line.strip() or len(line) > 500:
        return ()
    codes = []
    if _HEIGHT.search(line) and _HEIGHT_TARGET.search(line):
        codes.append("AR-042")
    pipe = line_observation(line)
    if pipe is not None:
        codes.extend(code for code in ("IOS2-072", "IOS3-075")
                     if code in pipe["sameLineCodeHints"])
    return tuple(codes)


def _lines(block_text: str):
    for line_index, part in enumerate(block_text.splitlines(keepends=True)):
        yield line_index, part.rstrip("\r\n")


def evaluate_unresolved_family_run_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build exact source/page/block/line leads after reviewed source gates."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("unresolved review objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("unresolved review inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("unresolved review sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("unresolved review duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("unresolved review artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("unresolved review unknown or duplicate text artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        hashes[source_id] = _hash(artifact)
        page_stages = source_index[source_id].get("pageStages", {})
        if any(int(number) > artifact["pageCount"] for number in page_stages):
            raise ValueError("unresolved review page stage outside artifact")
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    code_rows = []
    for code in CODES:
        reasons = {"LEAD_NOT_VERIFIED_FACT"}
        leads = []
        eligible_sources = 0
        for source_id in sorted(source_index):
            source = source_index[source_id]
            if not any(stage in {"PD", "RD"} for stage in source["stages"]):
                continue
            if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
                reasons.add("SOURCE_REVIEW_REQUIRED")
                continue
            if source["sectionCode"] != _SECTION[code]:
                reasons.add("DRAWING_SECTION_UNRESOLVED")
                continue
            artifact = artifacts.get(source_id)
            if artifact is None:
                reasons.add("TEXT_ARTIFACT_MISSING")
                continue
            stages = source["stages"]
            page_stages = source.get("pageStages", {})
            if len(stages) > 1 and set(page_stages) != {
                    str(number) for number in range(1, artifact["pageCount"] + 1)}:
                reasons.add("SOURCE_STAGE_UNRESOLVED")
                continue
            if "UNRESOLVED" in page_stages.values():
                reasons.add("SOURCE_STAGE_UNRESOLVED")
            eligible_sources += 1
            for page in artifact["pages"]:
                stage = stages[0] if len(stages) == 1 else page_stages.get(str(page["pageNumber"]))
                if stage not in {"PD", "RD"}:
                    reasons.add("SOURCE_STAGE_UNRESOLVED")
                    continue
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    reasons.add("OCR_REQUIRED_IN_SCOPE")
                    continue
                for block_index, block in enumerate(page["blocks"]):
                    block_text = block["text"]
                    block_sha = hashlib.sha256(block_text.encode("utf-8")).hexdigest()
                    for line_index, line in _lines(block_text):
                        if code not in _line_codes(line):
                            continue
                        lead = {"sourceFileId": source_id,
                                "sourceSha256": source["sha256"],
                                "textArtifactSha256": hashes[source_id],
                                "pageNumber": page["pageNumber"],
                                "blockIndex": block_index, "lineIndex": line_index,
                                "lineText": line, "blockTextSha256": block_sha,
                                "bboxMilliPoints": block["bboxMilliPoints"]}
                        lead["leadSha256"] = _hash(lead)
                        leads.append(lead)
        leads.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                     item["blockIndex"], item["lineIndex"], item["lineText"]))
        if len(leads) > _MAX_LEADS_PER_CODE:
            reasons.add("LEAD_LIMIT_REACHED")
            leads = leads[:_MAX_LEADS_PER_CODE]
        if eligible_sources == 0:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if not leads:
            reasons.add("NO_EXACT_LINE_LEAD")
        code_rows.append({"parameterCode": code, "status": "ABSTAIN",
                          "reasonCodes": sorted(reasons), "leads": leads})
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": code_rows, "findingCount": None,
              "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result


def execute_durable_unresolved_family_run_review(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    """Download immutable text artifacts under current fenced job attempt."""
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_unresolved_family_run_review(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
