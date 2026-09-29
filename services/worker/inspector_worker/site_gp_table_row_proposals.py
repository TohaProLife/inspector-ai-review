"""Review-only block adjacency proposals for road layers and MAF schedules.

Document-text-v2 has block boxes, not table cells. This module pairs only
unambiguous nearby page-local boxes under exact table headers. A block bbox
cannot prove two cells share a drawn row: every adjacency stays unverified.
No quantity, typed fact, comparison, finding, or coverage is made.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "site-gp-table-row-proposals-v1"
PROFILE_ID = "site-gp-table-row-review-v1"
CODES = ("SPZU-029", "SPZU-032")
MAX_PROPOSALS_PER_CODE = 32
MAX_ABSTENTIONS_PER_CODE = 64
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_ROAD_HEADING = re.compile(r"конструкции\s+дорожных\s+одежд\s*\([^)]{1,80}\)\Z", re.I)
_MAF_HEADING = re.compile(r"ведомость\s+малых\s+архитектурных\s+форм\Z", re.I)
_TYPE = re.compile(r"тип\s*\d+[а-я]?\Z", re.I)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?\Z")
_POSITION = re.compile(r"\d{1,3}\Z")
_CYRILLIC = re.compile(r"[А-Яа-яЁё]")


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _normalized(text: str) -> str:
    return " ".join(text.split())


def _role(index: int, block: dict[str, Any]) -> dict[str, Any]:
    return {"blockIndex": index, "blockText": block["text"],
            "blockTextSha256": hashlib.sha256(block["text"].encode("utf-8")).hexdigest(),
            "bboxMilliPoints": block["bboxMilliPoints"]}


def _overlap(left: list[int], right: list[int]) -> bool:
    overlap = min(left[3], right[3]) - max(left[1], right[1])
    return overlap > 0 and 2 * overlap >= min(left[3] - left[1], right[3] - right[1])


def _in_section(box: list[int], top: int, bottom: int) -> bool:
    return bottom <= box[1] and box[3] < top


def _unique_header(
    blocks: list[dict[str, Any]], title_index: int, floor: int,
    label: str, *, x_min: int | None = None, x_max: int | None = None,
) -> int | None:
    title_box = blocks[title_index]["bboxMilliPoints"]
    hits = []
    for index, block in enumerate(blocks):
        box = block["bboxMilliPoints"]
        if not _in_section(box, title_box[1], floor):
            continue
        if title_box[1] - box[3] > 80000:
            continue
        if (x_min is not None and box[0] < x_min) or (x_max is not None and box[0] > x_max):
            continue
        if _normalized(block["text"]).casefold() == label.casefold():
            hits.append(index)
    return hits[0] if len(hits) == 1 else None


def _abstention(reason: str, index: int, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    result = {"reasonCode": reason, "anchor": _role(index, blocks[index])}
    result["abstentionSha256"] = _hash(result)
    return result


def _road_page(blocks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    headings = [index for index, block in enumerate(blocks)
                if _ROAD_HEADING.fullmatch(_normalized(block["text"]))]
    headings.sort(key=lambda index: -blocks[index]["bboxMilliPoints"][3])
    for offset, heading in enumerate(headings):
        title_box = blocks[heading]["bboxMilliPoints"]
        floor = (blocks[headings[offset + 1]]["bboxMilliPoints"][3]
                 if offset + 1 < len(headings) else 0)
        construction = _unique_header(blocks, heading, floor, "Конструкция")
        thickness = _unique_header(blocks, heading, floor, "Толщина слоя, м")
        type_header = _unique_header(blocks, heading, floor, "Тип")
        if any(index is None for index in (construction, thickness, type_header)):
            abstentions.append(_abstention("ROAD_TABLE_HEADERS_AMBIGUOUS", heading, blocks))
            continue
        assert construction is not None and thickness is not None and type_header is not None
        construct_box = blocks[construction]["bboxMilliPoints"]
        thick_box = blocks[thickness]["bboxMilliPoints"]
        type_box = blocks[type_header]["bboxMilliPoints"]
        if not type_box[0] < construct_box[0] < thick_box[0]:
            abstentions.append(_abstention("ROAD_TABLE_COLUMNS_AMBIGUOUS", heading, blocks))
            continue
        # Material and thickness are columns within this particular table.
        # Multiline blocks may span several rows; mutual uniqueness is required.
        materials = [index for index, block in enumerate(blocks)
                     if (index not in {heading, construction, thickness, type_header}
                         and _in_section(block["bboxMilliPoints"], construct_box[1], floor)
                         and construct_box[0] <= block["bboxMilliPoints"][0]
                         and block["bboxMilliPoints"][2] < thick_box[0]
                         and _CYRILLIC.search(block["text"])
                         and len(block["text"]) <= 600)]
        depths = [index for index, block in enumerate(blocks)
                  if (index not in {heading, construction, thickness, type_header}
                      and _in_section(block["bboxMilliPoints"], thick_box[1], floor)
                      and thick_box[0] <= block["bboxMilliPoints"][0]
                      and _NUMBER.fullmatch(_normalized(block["text"]))) ]
        by_material: dict[int, list[int]] = defaultdict(list)
        by_depth: dict[int, list[int]] = defaultdict(list)
        for material in materials:
            for depth in depths:
                if _overlap(blocks[material]["bboxMilliPoints"],
                            blocks[depth]["bboxMilliPoints"]):
                    by_material[material].append(depth)
                    by_depth[depth].append(material)
        for depth in depths:
            matches = by_depth[depth]
            if len(matches) != 1 or len(by_material[matches[0]]) != 1:
                abstentions.append(_abstention("ROAD_LAYER_ALIGNMENT_AMBIGUOUS", depth, blocks))
                continue
            material = matches[0]
            proposal = {"proposalKind": "ROAD_LAYER_THICKNESS_ADJACENCY",
                        "rowAssociationStatus": "UNVERIFIED",
                        "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED"],
                        "unitInterpretationStatus": "UNVERIFIED",
                        "assemblyTypeStatus": "UNRESOLVED",
                        "roles": {"roadHeading": _role(heading, blocks[heading]),
                                  "unitHeader": _role(thickness, blocks[thickness]),
                                  "material": _role(material, blocks[material]),
                                  "thickness": _role(depth, blocks[depth])}}
            proposal["adjacencyEvidenceSha256"] = _hash(proposal)
            proposals.append(proposal)
        # Assembly work/type is a separate row. Never attach its type to a
        # material row merely because both are within the same table.
        works = [index for index, block in enumerate(blocks)
                 if (index != heading and _in_section(block["bboxMilliPoints"], type_box[1], floor)
                     and block["bboxMilliPoints"][0] < type_box[0]
                     and block["bboxMilliPoints"][2] < type_box[0]
                     and _normalized(block["text"]).casefold().startswith("устройство "))]
        types = [index for index, block in enumerate(blocks)
                 if (_in_section(block["bboxMilliPoints"], type_box[1], floor)
                     and abs(block["bboxMilliPoints"][0] - type_box[0]) <= 35000
                     and _TYPE.fullmatch(_normalized(block["text"]))) ]
        by_work: dict[int, list[int]] = defaultdict(list)
        by_type: dict[int, list[int]] = defaultdict(list)
        for work in works:
            for typ in types:
                if _overlap(blocks[work]["bboxMilliPoints"], blocks[typ]["bboxMilliPoints"]):
                    by_work[work].append(typ)
                    by_type[typ].append(work)
        for typ in types:
            matches = by_type[typ]
            if len(matches) != 1 or len(by_work[matches[0]]) != 1:
                abstentions.append(_abstention("ROAD_ASSEMBLY_TYPE_ALIGNMENT_AMBIGUOUS", typ, blocks))
                continue
            work = matches[0]
            proposal = {"proposalKind": "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY",
                        "rowAssociationStatus": "UNVERIFIED",
                        "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED"],
                        "layerAssociationStatus": "UNRESOLVED",
                        "roles": {"roadHeading": _role(heading, blocks[heading]),
                                  "work": _role(work, blocks[work]),
                                  "type": _role(typ, blocks[typ])}}
            proposal["adjacencyEvidenceSha256"] = _hash(proposal)
            proposals.append(proposal)
    return proposals, abstentions


def _maf_page(blocks: list[dict[str, Any]], height: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    headings = [index for index, block in enumerate(blocks)
                if _MAF_HEADING.fullmatch(_normalized(block["text"]))]
    for heading in headings:
        title_box = blocks[heading]["bboxMilliPoints"]
        floor = max(height // 10, title_box[1] - 500000)
        x_min, x_max = title_box[0] - 120000, title_box[2] + 100000
        position = _unique_header(blocks, heading, floor, "Поз.", x_min=x_min, x_max=x_max)
        name = _unique_header(blocks, heading, floor, "Наименование", x_min=x_min, x_max=x_max)
        quantity = _unique_header(blocks, heading, floor, "Кол. Примечание",
                                  x_min=x_min, x_max=x_max)
        if any(index is None for index in (position, name, quantity)):
            abstentions.append(_abstention("MAF_TABLE_HEADERS_AMBIGUOUS", heading, blocks))
            continue
        assert position is not None and name is not None and quantity is not None
        pos_box = blocks[position]["bboxMilliPoints"]
        name_box = blocks[name]["bboxMilliPoints"]
        qty_box = blocks[quantity]["bboxMilliPoints"]
        if not pos_box[0] < name_box[0] < qty_box[0]:
            abstentions.append(_abstention("MAF_TABLE_COLUMNS_AMBIGUOUS", heading, blocks))
            continue
        positions = [index for index, block in enumerate(blocks)
                     if (_in_section(block["bboxMilliPoints"], pos_box[1], floor)
                         and abs(block["bboxMilliPoints"][0] - pos_box[0]) <= 30000
                         and _POSITION.fullmatch(_normalized(block["text"]))) ]
        names = [index for index, block in enumerate(blocks)
                 if (_in_section(block["bboxMilliPoints"], name_box[1], floor)
                     and name_box[0] - 35000 <= block["bboxMilliPoints"][0]
                     <= name_box[2] + 55000
                     and block["bboxMilliPoints"][2] < qty_box[0]
                     and _CYRILLIC.search(block["text"])
                     and len(block["text"]) <= 300)]
        by_position: dict[int, list[int]] = defaultdict(list)
        by_name: dict[int, list[int]] = defaultdict(list)
        for pos in positions:
            for item in names:
                if _overlap(blocks[pos]["bboxMilliPoints"], blocks[item]["bboxMilliPoints"]):
                    by_position[pos].append(item)
                    by_name[item].append(pos)
        for pos in positions:
            matches = by_position[pos]
            if len(matches) != 1 or len(by_name[matches[0]]) != 1:
                abstentions.append(_abstention("MAF_POSITION_NAME_ALIGNMENT_AMBIGUOUS", pos, blocks))
                continue
            item = matches[0]
            proposal = {"proposalKind": "MAF_POSITION_NAME_ADJACENCY",
                        "rowAssociationStatus": "UNVERIFIED",
                        "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED"],
                        "rawQuantity": None, "quantityStatus": "UNKNOWN",
                        "roles": {"mafHeading": _role(heading, blocks[heading]),
                                  "positionHeader": _role(position, blocks[position]),
                                  "nameHeader": _role(name, blocks[name]),
                                  "quantityHeader": _role(quantity, blocks[quantity]),
                                  "position": _role(pos, blocks[pos]),
                                  "name": _role(item, blocks[item])}}
            proposal["adjacencyEvidenceSha256"] = _hash(proposal)
            proposals.append(proposal)
    return proposals, abstentions


def _page_proposals(page: dict[str, Any]) -> dict[str, tuple[list[dict[str, Any]],
                                                              list[dict[str, Any]]]]:
    """Pure page-local geometry, useful for SHA-checked original PDF audit."""
    blocks = page["blocks"]
    return {"SPZU-029": _maf_page(blocks, page["heightMilliPoints"]),
            "SPZU-032": _road_page(blocks)}


def evaluate_site_gp_table_row_proposals(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return only bounded proposals from immutable, reviewed PD/GP text."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("site GP table objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("site GP table inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("site GP table sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("site GP table duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("site GP table artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("site GP table unknown or duplicate text artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        artifact_hashes[source_id] = _hash(artifact)
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": artifact_hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    collected = {code: {"proposals": [], "abstentions": [],
                        "reasons": {"REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED"},
                        "eligible": 0, "textPages": 0, "ocrPages": 0} for code in CODES}
    for source_id in sorted(source_index):
        source = source_index[source_id]
        if source["stages"] != ["PD"] or source.get("pageStages", {}):
            for row in collected.values():
                row["reasons"].add("SOURCE_STAGE_UNRESOLVED")
            continue
        if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
            for row in collected.values():
                row["reasons"].add("SOURCE_REVIEW_REQUIRED")
            continue
        if source["sectionCode"] != "GP":
            for row in collected.values():
                row["reasons"].add("DRAWING_SECTION_UNRESOLVED")
            continue
        artifact = artifacts.get(source_id)
        if artifact is None:
            for row in collected.values():
                row["reasons"].add("TEXT_ARTIFACT_MISSING")
            continue
        for row in collected.values():
            row["eligible"] += 1
        for page in artifact["pages"]:
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                for row in collected.values():
                    row["ocrPages"] += 1
                    row["reasons"].add("OCR_REQUIRED_IN_SCOPE")
                continue
            for row in collected.values():
                row["textPages"] += 1
            page_rows = _page_proposals(page)
            for code in CODES:
                proposals, abstentions = page_rows[code]
                for key, items in (("proposals", proposals), ("abstentions", abstentions)):
                    for item in items:
                        scoped = {"sourceFileId": source_id, "sourceSha256": source["sha256"],
                                  "textArtifactSha256": artifact_hashes[source_id],
                                  "pageNumber": page["pageNumber"],
                                  "sourceRole": "PD_GP_TABLE", **item}
                        scoped["scopedSha256"] = _hash(scoped)
                        collected[code][key].append(scoped)
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
        if proposal_count == 0:
            row["reasons"].add("NO_UNAMBIGUOUS_ROW_PROPOSAL")
        rows.append({"parameterCode": code, "status": "ABSTAIN",
                     "reasonCodes": sorted(row["reasons"]),
                     "eligibleSourceCount": row["eligible"],
                     "textCandidatePageCount": row["textPages"],
                     "ocrRequiredPageCount": row["ocrPages"],
                     "proposalCount": proposal_count,
                     "abstentionCount": abstention_count,
                     "proposals": proposals, "abstentions": abstentions})
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": rows, "findingCount": None,
              "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result


def execute_durable_site_gp_table_row_proposals(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_site_gp_table_row_proposals(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
