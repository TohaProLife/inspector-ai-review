"""Run-scoped navigation for three unresolved site-area parameters.

The reviewed source and its committed text artifact supply literal line leads.
No line is an engineering fact: this module never infers an area value, drawing
identity, PD/RD pair, approval of a design change, or parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "site-tep-area-run-review-v1"
PROFILE_ID = "site-tep-area-text-review-v1"
CODES = ("PZ-001", "SPZU-026", "SPZU-027")
SOURCE_ROLE = "PD_GP_TEP"
MAX_LEADS_PER_CODE = 16
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_PREFIX = r"\s*(?:\d+(?:\.\d+)*\.?\s+)?"
_SUFFIX = r"\*?(?:,\s*в\s+(?:т\.\s*ч\.|том\s+числе)\s*:?)?\s*"
_LABELS = {
    "PZ-001": re.compile(_PREFIX + r"Площадь\s+застройки" + _SUFFIX + r"\Z", re.I),
    "SPZU-026": re.compile(
        _PREFIX + r"Площадь\s+(?:тв[её]рдых\s+покрытий|покрытий|"
        r"покрытия\s+из\s+(?:бетонной|тротуарной)\s+плитки(?:\s+с)?)"
        + _SUFFIX + r"\Z", re.I),
    "SPZU-027": re.compile(_PREFIX + r"Площадь\s+озеленения" + _SUFFIX + r"\Z", re.I),
}


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _lines(block_text: str):
    for line_index, part in enumerate(block_text.splitlines(keepends=True)):
        yield line_index, part.rstrip("\r\n")


def evaluate_site_tep_area_run_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return SHA-bound PD/GP table-label addresses, always with ABSTAIN."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("site TEP review objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("site TEP review inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("site TEP review sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("site TEP review duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("site TEP review artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("site TEP review unknown or duplicate text artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    rows = []
    for code in CODES:
        reasons = {"LEAD_NOT_VERIFIED_FACT"}
        if code == "SPZU-026":
            # A generic covering row does not identify tile paving material.
            reasons.add("PAVING_MATERIAL_UNRESOLVED")
        leads = []
        eligible = text_pages = ocr_pages = 0
        for source_id in sorted(source_index):
            source = source_index[source_id]
            if source["stages"] != ["PD"] or source.get("pageStages", {}):
                reasons.add("SOURCE_STAGE_UNRESOLVED")
                continue
            if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
                reasons.add("SOURCE_REVIEW_REQUIRED")
                continue
            if source["sectionCode"] != "GP":
                reasons.add("DRAWING_SECTION_UNRESOLVED")
                continue
            artifact = artifacts.get(source_id)
            if artifact is None:
                reasons.add("TEXT_ARTIFACT_MISSING")
                continue
            eligible += 1
            for page in artifact["pages"]:
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    ocr_pages += 1
                    reasons.add("OCR_REQUIRED_IN_SCOPE")
                    continue
                text_pages += 1
                for block_index, block in enumerate(page["blocks"]):
                    block_text = block["text"]
                    block_sha = hashlib.sha256(block_text.encode("utf-8")).hexdigest()
                    for line_index, line in _lines(block_text):
                        if len(line) > 500 or _LABELS[code].fullmatch(line) is None:
                            continue
                        lead = {"sourceFileId": source_id,
                                "sourceSha256": source["sha256"],
                                "textArtifactSha256": hashes[source_id],
                                "pageNumber": page["pageNumber"],
                                "blockIndex": block_index, "lineIndex": line_index,
                                "lineText": line, "blockTextSha256": block_sha,
                                "bboxMilliPoints": block["bboxMilliPoints"],
                                "sourceRole": SOURCE_ROLE}
                        lead["leadSha256"] = _hash(lead)
                        leads.append(lead)
        leads.sort(key=lambda lead: (lead["sourceFileId"], lead["pageNumber"],
                                     lead["blockIndex"], lead["lineIndex"],
                                     lead["lineText"]))
        lead_count = len(leads)
        if lead_count > MAX_LEADS_PER_CODE:
            reasons.add("LEAD_LIMIT_REACHED")
            leads = leads[:MAX_LEADS_PER_CODE]
        if eligible == 0:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if lead_count == 0:
            reasons.add("NO_EXACT_LINE_LEAD")
        rows.append({"parameterCode": code, "status": "ABSTAIN",
                     "reasonCodes": sorted(reasons),
                     "eligibleSourceCount": eligible,
                     "textCandidatePageCount": text_pages,
                     "ocrRequiredPageCount": ocr_pages,
                     "leadCount": lead_count, "leads": leads})
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": rows, "findingCount": None,
              "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result


def execute_durable_site_tep_area_run_review(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_site_tep_area_run_review(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
