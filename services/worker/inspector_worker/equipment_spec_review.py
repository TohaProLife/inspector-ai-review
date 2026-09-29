"""Run-scoped equipment specification navigation, without equipment facts.

The PDF text artifact has only text-container boxes. A model, capacity, flow,
pressure, quantity, room, or system cannot be joined into an equipment row
from those boxes. These leads keep schedule, calculation and register prose
separate and always abstain from a parameter verdict.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "equipment-spec-run-review-v1"
PROFILE_ID = "equipment-spec-text-navigation-v1"
CODES = ("IOS4-077", "IOS4-079", "PPM-112")
MAX_LEADS_PER_CODE = 24
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_RADIATOR = re.compile(r"радиатор\w*|\bPRADO\s+Classic\b", re.I)
_FAN = re.compile(r"вентилятор\w*", re.I)
_SMOKE = re.compile(r"дымоудален\w*|противодым\w*|подпор\w*", re.I)
_REGISTER_DOCUMENT = re.compile(r"(?:АНО|РД)[/-][\w.\-/]{5,}", re.I)
_CALCULATION = re.compile(r"расч[её]т\s+системы|потери\s+давления|"
                          r"об[ъь]емн\w*\s+расход\s+вентилятора|"
                          r"давление\s+вентилятора", re.I)


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _lines(text: str):
    for index, part in enumerate(text.splitlines(keepends=True)):
        yield index, part.rstrip("\r\n")


def _page_context(page: dict[str, Any]) -> tuple[str, bool]:
    text = "\n".join(block["text"] for block in page["blocks"])
    flat = " ".join(text.split())
    register = ("Содержание изменения" in flat
                or len(_REGISTER_DOCUMENT.findall(text)) >= 3)
    schedule = (re.search(r"\bпозици[яи]\b", flat, re.I) is not None
                and re.search(r"наименование\s+и\s+техническая\s+характеристика", flat,
                              re.I) is not None
                and re.search(r"количеств|коли-\s*чество", flat, re.I) is not None)
    calculation = _CALCULATION.search(flat) is not None
    context = ("REGISTER_PROSE" if register else "CALCULATION_PROSE" if calculation
               else "SCHEDULE_TOKEN" if schedule else "CONTEXT_UNRESOLVED")
    return context, _SMOKE.search(text) is not None


def _line_codes(line: str, *, context: str, smoke_context: bool) -> tuple[str, ...]:
    """Route lexical cues only; an unqualified fan on a smoke page is ambiguous."""
    if not line.strip() or len(line) > 500:
        return ()
    codes = []
    if _RADIATOR.search(line) and (context == "SCHEDULE_TOKEN"
                                  or "радиатор" in line.casefold()):
        codes.append("IOS4-077")
    line_smoke = _SMOKE.search(line) is not None
    if line_smoke:
        codes.append("PPM-112")
    elif _FAN.search(line):
        if context == "CALCULATION_PROSE" and smoke_context:
            codes.append("PPM-112")
        elif not smoke_context:
            codes.append("IOS4-079")
    return tuple(codes)


def evaluate_equipment_spec_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return bounded, exact text locators after reviewed PD/RD OV source gates."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("equipment spec objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("equipment spec inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("equipment spec sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("equipment spec duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("equipment spec artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("equipment spec unknown or duplicate text artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    rows = {code: {"reasons": {"LEXICAL_NAVIGATION_ONLY", "ROW_ASSOCIATION_UNVERIFIED",
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
        if source["sectionCode"] != "OV":
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
            context, smoke_context = _page_context(page)
            for block_index, block in enumerate(page["blocks"]):
                block_sha = hashlib.sha256(block["text"].encode("utf-8")).hexdigest()
                for line_index, line in _lines(block["text"]):
                    for code in _line_codes(line, context=context,
                                            smoke_context=smoke_context):
                        lead = {"sourceFileId": source_id,
                                "sourceSha256": source["sha256"],
                                "textArtifactSha256": hashes[source_id],
                                "sourceStage": source["stages"][0],
                                "sourceRole": "OV_EQUIPMENT_NAVIGATION",
                                "pageNumber": page["pageNumber"],
                                "blockIndex": block_index, "lineIndex": line_index,
                                "blockTextSha256": block_sha,
                                "lineText": line,
                                "lineTextSha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
                                "bboxMilliPoints": block["bboxMilliPoints"],
                                "leadKind": context,
                                "rowAssociationStatus": "UNVERIFIED",
                                "systemAssignmentStatus": "UNVERIFIED"}
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


def execute_durable_equipment_spec_review(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_equipment_spec_review(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
