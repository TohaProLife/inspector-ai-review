"""Reviewed-source KR material and fire-protection text navigation.

An isolated grade or REI string is not the material/protection of a matched
physical element. Document-text-v2 supplies text blocks, not verified element
identity or actual coating thickness. This module never produces typed facts.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "material-class-run-review-v1"
PROFILE_ID = "material-class-text-navigation-v1"
CODES = ("KR-056", "KR-057", "KR-066")
MAX_LEADS_PER_CODE = 24
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_STEEL = re.compile(r"(?<!\w)[СC]\s*(?:235|245|255|345|355)(?!\w)", re.I)
_REBAR = re.compile(r"(?<!\w)[АA]\s*(?:400|500[СC]?)(?!\w)", re.I)
_RATING = re.compile(r"(?<!\w)(?:REI|EI|R|ЕI|РЕI)\s*\d{2,3}(?!\w)", re.I)
_FIRE_REQUIREMENT = re.compile(r"предел\w*\s+огнестойк\w*|"
                               r"требован\w*\s+(?:к\s+)?огнестойк\w*", re.I)
_PROTECTION = re.compile(r"огнезащит\w*", re.I)
_PROTECTION_DETAIL = re.compile(r"состав\w*|покрыти\w*|толщин\w*|нанес\w*", re.I)
_GENERAL = re.compile(r"для\s+(?:всех\s+)?(?:железобетонн\w*|несущ\w*)\s+конструкц\w*|"
                      r"общ\w*\s+указан\w*|арматур\w*\s+для\s+железобетонн\w*", re.I)


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _lines(text: str):
    for index, part in enumerate(text.splitlines(keepends=True)):
        yield index, part.rstrip("\r\n")


def _page_has_rating_requirements(page: dict[str, Any]) -> bool:
    return _FIRE_REQUIREMENT.search(" ".join(
        block["text"] for block in page["blocks"])) is not None


def _classify_line(line: str, *, rating_requirement_page: bool) -> dict[str, str]:
    """Classify literal mentions; no nearby-line or cross-document joining."""
    if not line.strip() or len(line) > 500:
        return {}
    result: dict[str, str] = {}
    compact = " ".join(line.split())
    header = _STEEL.fullmatch(compact) is not None or _REBAR.fullmatch(compact) is not None
    material_kind = ("TABLE_HEADING_UNLINKED" if header else
                     "GENERAL_REQUIREMENT_UNLINKED" if _GENERAL.search(line) else
                     "SHEET_NOTE_UNLINKED" if "примечание" in line.casefold() else
                     "ELEMENT_CONTEXT_UNVERIFIED")
    if _STEEL.search(line):
        result["KR-056"] = material_kind
    if _REBAR.search(line):
        result["KR-057"] = material_kind
    protection = _PROTECTION.search(line) is not None
    rating = (_RATING.search(line) is not None
              or _FIRE_REQUIREMENT.search(line) is not None)
    if protection and rating:
        result["KR-066"] = "FIRE_CONTEXT_AMBIGUOUS"
    elif protection:
        result["KR-066"] = ("PROTECTION_COMPOSITION_MENTION_UNVERIFIED"
                            if _PROTECTION_DETAIL.search(line) else
                            "PROTECTION_MENTION_UNVERIFIED")
    elif rating:
        result["KR-066"] = ("FIRE_RATING_REQUIREMENT" if rating_requirement_page
                            else "FIRE_RATING_CONTEXT_UNRESOLVED")
    return result


def evaluate_material_class_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Emit exact KR line locators from committed reviewed PD/RD text only."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("material class objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("material class inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("material class sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("material class duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("material class artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("material class unknown or duplicate text artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    rows = {code: {"reasons": {"LEXICAL_NAVIGATION_ONLY", "ELEMENT_IDENTITY_UNVERIFIED",
                              "PD_RD_PAIR_UNVERIFIED"},
                   "leads": [], "eligible": 0, "textPages": 0, "ocrPages": 0}
            for code in CODES}
    for source_id in sorted(source_index):
        source = source_index[source_id]
        if source["stages"] not in (["PD"], ["RD"]) or source.get("pageStages", {}):
            for row in rows.values():
                row["reasons"].add("SOURCE_STAGE_UNRESOLVED")
            continue
        if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
            for row in rows.values():
                row["reasons"].add("SOURCE_REVIEW_REQUIRED")
            continue
        if source["sectionCode"] != "KR":
            for row in rows.values():
                row["reasons"].add("DRAWING_SECTION_UNRESOLVED")
            continue
        artifact = artifacts.get(source_id)
        if artifact is None:
            for row in rows.values():
                row["reasons"].add("TEXT_ARTIFACT_MISSING")
            continue
        for row in rows.values():
            row["eligible"] += 1
        for page in artifact["pages"]:
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                for row in rows.values():
                    row["ocrPages"] += 1
                    row["reasons"].add("OCR_REQUIRED_IN_SCOPE")
                continue
            for row in rows.values():
                row["textPages"] += 1
            rating_requirement_page = _page_has_rating_requirements(page)
            for block_index, block in enumerate(page["blocks"]):
                block_sha = hashlib.sha256(block["text"].encode("utf-8")).hexdigest()
                for line_index, line in _lines(block["text"]):
                    for code, kind in _classify_line(
                            line, rating_requirement_page=rating_requirement_page).items():
                        lead = {"sourceFileId": source_id,
                                "sourceSha256": source["sha256"],
                                "textArtifactSha256": hashes[source_id],
                                "sourceStage": source["stages"][0],
                                "sourceRole": "KR_MATERIAL_NAVIGATION",
                                "pageNumber": page["pageNumber"],
                                "blockIndex": block_index, "lineIndex": line_index,
                                "blockTextSha256": block_sha,
                                "lineText": line,
                                "lineTextSha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
                                "bboxMilliPoints": block["bboxMilliPoints"],
                                "leadKind": kind,
                                "elementAssociationStatus": "UNVERIFIED",
                                "crossFileMatchStatus": "UNVERIFIED"}
                        if code == "KR-066":
                            lead["actualProtectionStatus"] = "NOT_ESTABLISHED"
                        lead["leadSha256"] = _hash(lead)
                        rows[code]["leads"].append(lead)
    code_rows = []
    for code in CODES:
        row = rows[code]
        leads = sorted(row["leads"], key=lambda lead: (
            lead["sourceFileId"], lead["pageNumber"], lead["blockIndex"],
            lead["lineIndex"], lead["lineText"]))
        lead_count = len(leads)
        if lead_count > MAX_LEADS_PER_CODE:
            row["reasons"].add("LEAD_LIMIT_REACHED")
            leads = leads[:MAX_LEADS_PER_CODE]
        if row["eligible"] == 0:
            row["reasons"].add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if lead_count == 0:
            row["reasons"].add("NO_EXACT_LINE_LEAD")
        code_rows.append({"parameterCode": code, "status": "ABSTAIN",
                          "reasonCodes": sorted(row["reasons"]),
                          "eligibleSourceCount": row["eligible"],
                          "textCandidatePageCount": row["textPages"],
                          "ocrRequiredPageCount": row["ocrPages"],
                          "leadCount": lead_count, "leads": leads})
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": code_rows, "findingCount": None,
              "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result


def execute_durable_material_class_review(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_material_class_review(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
