"""Bounded, review-only navigation for road, roof, and wall layer sheets.

Committed text has block boxes but no verified table-cell or construction-zone
geometry. Neighbouring blocks remain suggestions, never assigned layer values.
Road row proposals already live in the separate SITE_GP_TABLE_ROW profile.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "layer-assembly-proposals-v1"
PROFILE_ID = "layer-assembly-review-v1"
CODES = ("SPZU-032", "AR-044", "ZU-125")
MAX_PROPOSALS_PER_CODE = 16
MAX_ABSTENTIONS_PER_CODE = 16
MAX_LINE_CHARS = 160
MAX_TEXT_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_ROOF_HEADING = re.compile(
    r"(?:конструкция\s+кровли\s*:?|(?:не)?эксплуатируемая\s+кровля\b.{0,105})\Z", re.I)
_ROOF_EXPLICIT = re.compile(r"конструкция\s+кровли\s*:?\Z", re.I)
_TYPE = re.compile(r"тип\s*\d+[а-я]?\Z", re.I)
_ROOF_MATERIAL = re.compile(r"филизол|техноэласт|мембран|пароизоляц|руф\s+баттс", re.I)
_WALL_MATERIAL = re.compile(r"минераловат|rockwool|утеплит", re.I)
_PURE_THICKNESS = re.compile(r"\d{1,3}(?:[.,]\d+)?\s*мм\Z", re.I)
_SCOPE_BREAK = re.compile(r"цоколь|конструкция\s+кровли|конструкции\s+дорожных", re.I)
_ALLOWED_SECTIONS = {"SPZU-032": {"GP", "SPZU"}, "AR-044": {"AR"},
                     "ZU-125": {"AR", "ZU"}}


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _normalized(value: str) -> str:
    return " ".join(value.split())


def _locator(block_index: int, line_index: int, line: str,
             block: dict[str, Any]) -> dict[str, Any]:
    return {"blockIndex": block_index, "lineIndex": line_index,
            "lineText": line,
            "lineTextSha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
            "blockTextSha256": hashlib.sha256(block["text"].encode("utf-8")).hexdigest(),
            "bboxMilliPoints": block["bboxMilliPoints"]}


def _line_records(page: dict[str, Any]) -> list[dict[str, Any]]:
    records = []
    for block_index, block in enumerate(page["blocks"]):
        for line_index, line in enumerate(block["text"].splitlines()):
            records.append({"blockIndex": block_index, "lineIndex": line_index,
                            "line": line, "normalized": _normalized(line),
                            "box": block["bboxMilliPoints"], "block": block})
    return records


def _role(record: dict[str, Any]) -> dict[str, Any]:
    return _locator(record["blockIndex"], record["lineIndex"],
                    record["line"], record["block"])


def _abstain(reason: str, record: dict[str, Any]) -> dict[str, Any]:
    return {"reasonCode": reason, "anchor": _role(record)}


def _above(heading: dict[str, Any], item: dict[str, Any], *, gap: int) -> bool:
    # PDF origin is bottom-left. A heading above a row has a higher y band.
    return (0 <= heading["box"][1] - item["box"][3] <= gap
            and abs(heading["box"][0] - item["box"][0]) <= 300000)


def _row_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    a, b = left["box"], right["box"]
    overlap = min(a[3], b[3]) - max(a[1], b[1])
    return (a[2] < b[0] <= a[2] + 250000 and overlap > 0
            and 2 * overlap >= min(a[3] - a[1], b[3] - b[1]))


def _safe_records(records: list[dict[str, Any]], pattern: re.Pattern[str],
                  *, full: bool = False) -> tuple[list[dict[str, Any]], int]:
    matches = [record for record in records
               if (pattern.fullmatch(record["normalized"]) if full
                   else pattern.search(record["normalized"]))]
    return ([record for record in matches if len(record["line"]) <= MAX_LINE_CHARS],
            sum(len(record["line"]) > MAX_LINE_CHARS for record in matches))


def _page_proposals(page: dict[str, Any], code: str) -> tuple[list[dict[str, Any]],
                                                               list[dict[str, Any]], int]:
    """Inspect one already qualified page; no source role is inferred here."""
    if code not in CODES:
        raise ValueError("layer assembly unsupported code")
    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
        return [], [], 0
    records = _line_records(page)
    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    if code == "SPZU-032":
        return proposals, abstentions, 0

    if code == "AR-044":
        headings, over_heading = _safe_records(records, _ROOF_HEADING, full=True)
        explicit = [row for row in headings if _ROOF_EXPLICIT.fullmatch(row["normalized"])]
        materials, over_material = _safe_records(records, _ROOF_MATERIAL)
        oversize = over_heading + over_material
        for heading in headings:
            proposals.append({"proposalKind": "ROOF_HEADING_NAVIGATION",
                              "rowAssociationStatus": "UNVERIFIED",
                              "typeAssociationStatus": "UNVERIFIED",
                              "zoneAssociationStatus": "UNVERIFIED",
                              "rawThickness": None, "rawQuantity": None,
                              "roles": {"heading": _role(heading)}})
        # Only an explicit roof-table heading can scope adjacent blocks. A
        # page with many roof descriptions (F0104 p48) stays navigation only.
        types, _ = _safe_records(records, _TYPE, full=True)
        depths, _ = _safe_records(records, _PURE_THICKNESS, full=True)
        for material in materials:
            scoped = [heading for heading in explicit if _above(heading, material, gap=240000)]
            if len(scoped) != 1:
                continue
            heading = scoped[0]
            typ = [item for item in types if _above(heading, item, gap=180000)
                   and _above(item, material, gap=140000)]
            if len(typ) != 1:
                abstentions.append(_abstain("ROOF_TYPE_CONTEXT_AMBIGUOUS", material))
                continue
            nearby = [depth for depth in depths if _row_overlap(material, depth)]
            reverse = [other for other in materials if nearby and _row_overlap(other, nearby[0])]
            if len(nearby) != 1 or len(reverse) != 1:
                abstentions.append(_abstain("MATERIAL_THICKNESS_ROW_UNVERIFIED", material))
                continue
            proposals.append({"proposalKind": "ROOF_MATERIAL_THICKNESS_NEIGHBORHOOD",
                              "rowAssociationStatus": "UNVERIFIED",
                              "typeAssociationStatus": "UNVERIFIED",
                              "zoneAssociationStatus": "UNVERIFIED",
                              "rawThickness": None, "rawQuantity": None,
                              "roles": {"heading": _role(heading), "type": _role(typ[0]),
                                        "material": _role(material), "thickness": _role(nearby[0])}})
        return proposals, abstentions, oversize

    # ZU-125: a standalone "Тип N" is never enough. Require a mineral-wool
    # material in the interval before the next type/cokle/roof boundary.
    materials, oversize = _safe_records(records, _WALL_MATERIAL)
    types, _ = _safe_records(records, _TYPE, full=True)
    depths, _ = _safe_records(records, _PURE_THICKNESS, full=True)
    boundaries = [record for record in records if _SCOPE_BREAK.search(record["normalized"])]
    for material in materials:
        preceding = [typ for typ in types if _above(typ, material, gap=200000)]
        preceding.sort(key=lambda typ: typ["box"][1])
        if not preceding:
            abstentions.append(_abstain("WALL_TYPE_CONTEXT_UNVERIFIED", material))
            continue
        typ = preceding[0]
        # A roof may restart its local type numbering. A bare "Тип 1" below
        # that heading is not a wall type even when a material sits nearby.
        roof_before_type = [item for item in boundaries
                            if _ROOF_EXPLICIT.fullmatch(item["normalized"])
                            and item["box"][1] > typ["box"][3]
                            and item["box"][1] - typ["box"][3] <= 160000]
        if roof_before_type:
            abstentions.append(_abstain("ROOF_TYPE_NOT_WALL_TYPE", material))
            continue
        if any(typ["box"][1] > item["box"][1] > material["box"][3]
               for item in boundaries):
            abstentions.append(_abstain("SECTION_BOUNDARY_BETWEEN_TYPE_AND_LAYER", material))
            continue
        nearby = [depth for depth in depths if _row_overlap(material, depth)]
        reverse = [other for other in materials if nearby and _row_overlap(other, nearby[0])]
        if len(nearby) != 1 or len(reverse) != 1:
            abstentions.append(_abstain("MATERIAL_THICKNESS_ROW_UNVERIFIED", material))
            continue
        proposals.append({"proposalKind": "WALL_MATERIAL_THICKNESS_NEIGHBORHOOD",
                          "rowAssociationStatus": "UNVERIFIED",
                          "typeAssociationStatus": "UNVERIFIED",
                          "zoneAssociationStatus": "UNVERIFIED",
                          "rawThickness": None, "rawQuantity": None,
                          "roles": {"type": _role(typ), "material": _role(material),
                                    "thickness": _role(nearby[0])}})
    return proposals, abstentions, oversize


def evaluate_layer_assembly_proposals(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """All outputs abstain; page geometry and revision are never invented."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("layer assembly objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("layer assembly inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("layer assembly sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("layer assembly duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("layer assembly artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("layer assembly unknown or duplicate text artifact")
        if len(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_TEXT_ARTIFACT_BYTES:
            raise ValueError("layer assembly text artifact exceeds bound")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        artifact_hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": artifact_hashes[source_id]}
        for source_id in sorted(artifacts)]
    collected = {code: {"proposals": [], "abstentions": [], "eligible": 0,
                        "textPages": 0, "ocrPages": 0, "oversize": 0,
                        "reasons": {"REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED",
                                    "TYPE_OR_ZONE_LINK_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED"}}
                 for code in CODES}
    collected["SPZU-032"]["reasons"].add("EXISTING_SITE_GP_TABLE_ROW_REVIEW")
    for source_id in sorted(source_index):
        source = source_index[source_id]
        eligible_codes = [code for code in CODES
                          if source["sectionCode"] in _ALLOWED_SECTIONS[code]]
        if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
            for row in collected.values():
                row["reasons"].add("SOURCE_REVIEW_REQUIRED")
            continue
        if source["stages"] != ["PD"] or source.get("pageStages", {}):
            for row in collected.values():
                row["reasons"].add("SOURCE_STAGE_UNRESOLVED")
            continue
        for code in CODES:
            if code not in eligible_codes:
                collected[code]["reasons"].add("SOURCE_ROLE_NOT_ALLOWED")
        artifact = artifacts.get(source_id)
        if artifact is None:
            for code in eligible_codes:
                collected[code]["reasons"].add("TEXT_ARTIFACT_MISSING")
            continue
        for code in eligible_codes:
            collected[code]["eligible"] += 1
        for page in sorted(artifact["pages"], key=lambda item: item["pageNumber"]):
            for code in eligible_codes:
                row = collected[code]
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    row["ocrPages"] += 1
                    row["reasons"].add("OCR_REQUIRED_DEFERRED")
                    continue
                row["textPages"] += 1
                proposals, abstentions, oversize = _page_proposals(page, code)
                row["oversize"] += oversize
                if oversize:
                    row["reasons"].add("OVERSIZE_ANCHOR_LINE_DEFERRED")
                for key, items in (("proposals", proposals), ("abstentions", abstentions)):
                    for item in items:
                        scoped = {"sourceFileId": source_id,
                                  "sourceSha256": source["sha256"],
                                  "textArtifactSha256": artifact_hashes[source_id],
                                  "pageSha256": _hash(page),
                                  "pageNumber": page["pageNumber"],
                                  "sourceStage": "PD", "sourceSection": source["sectionCode"],
                                  **item}
                        scoped["scopedSha256"] = _hash(scoped)
                        row[key].append(scoped)
    rows = []
    for code in CODES:
        row = collected[code]
        proposals = sorted(row["proposals"], key=lambda item: (
            item["sourceFileId"], item["pageNumber"], item["proposalKind"],
            item["scopedSha256"]))
        abstentions = sorted(row["abstentions"], key=lambda item: (
            item["sourceFileId"], item["pageNumber"], item["reasonCode"],
            item["scopedSha256"]))
        proposal_count, abstention_count = len(proposals), len(abstentions)
        if proposal_count > MAX_PROPOSALS_PER_CODE:
            row["reasons"].add("PROPOSAL_LIMIT_REACHED")
            proposals = proposals[:MAX_PROPOSALS_PER_CODE]
        if abstention_count > MAX_ABSTENTIONS_PER_CODE:
            row["reasons"].add("ABSTENTION_LIMIT_REACHED")
            abstentions = abstentions[:MAX_ABSTENTIONS_PER_CODE]
        if row["eligible"] == 0:
            row["reasons"].add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if proposal_count == 0 and code != "SPZU-032":
            row["reasons"].add("NO_SAFE_PROPOSAL_IN_SCANNED_TEXT" if row["textPages"]
                               else "NO_SCANNED_TEXT_IN_SCOPE")
        rows.append({"parameterCode": code, "status": "ABSTAIN",
                     "reasonCodes": sorted(row["reasons"]),
                     "eligibleSourceCount": row["eligible"],
                     "textCandidatePageCount": row["textPages"],
                     "ocrRequiredPageCount": row["ocrPages"],
                     "oversizeAnchorLineCount": row["oversize"],
                     "proposalCount": proposal_count,
                     "truncatedProposalCount": proposal_count - len(proposals),
                     "abstentionCount": abstention_count,
                     "truncatedAbstentionCount": abstention_count - len(abstentions),
                     "absenceConclusion": "NOT_AVAILABLE",
                     "proposals": proposals, "abstentions": abstentions})
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": rows, "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RESULT_BYTES:
        raise ValueError("layer assembly result exceeds bound")
    return result


def execute_durable_layer_assembly_proposals(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_layer_assembly_proposals(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
