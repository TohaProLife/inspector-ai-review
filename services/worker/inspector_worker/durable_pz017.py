"""Conservative PZ-017 facts from committed text artifacts in a fenced run.

Only single-line text blocks have usable cell geometry in document-text-v2.
Other table layouts abstain until a richer immutable line artifact exists.
"""

from __future__ import annotations

import re
from typing import Any

from .durable_text import download_text_artifact
from .heating_load import (
    _THERMAL_HEADING, _UNIT, _VALUE_ONLY, _component_from_table_header,
    compare_heat_load_components, extract_heat_load_lines, extract_heat_load_table,
)


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_MAX_FACTS = 128


def _stage_for_page(source: dict[str, Any], decision: object, page: int) -> str | None:
    stages = source["stages"]
    if isinstance(decision, dict):
        if decision.get("sourceSha256") != source["sha256"]:
            raise ValueError("PZ-017 source decision SHA differs from manifest")
        mapping = decision.get("pageStages", {})
        if not isinstance(mapping, dict):
            raise ValueError("PZ-017 pageStages must be an object")
        mapped = mapping.get(str(page))
        if mapped is not None:
            if mapped not in stages and mapped != "UNRESOLVED":
                raise ValueError("PZ-017 page stage differs from source stages")
            return mapped if mapped in {"PD", "RD"} else None
    return stages[0] if len(stages) == 1 and stages[0] in {"PD", "RD"} else None


def _cells(source: dict[str, Any], page: dict[str, Any]) -> list[dict[str, Any]]:
    cells = []
    for block_index, block in enumerate(page["blocks"]):
        raw_lines = [line.strip() for line in block["text"].splitlines() if line.strip()]
        for line_index, line in enumerate(raw_lines):
            cells.append({
                "sourceFileId": source["sourceFileId"], "inputSha256": source["sha256"],
                "pageNumber": page["pageNumber"], "blockIndex": block_index,
                "lineIndex": line_index, "text": line,
                "bboxMilliPoints": block["bboxMilliPoints"],
                "textKind": "LINE",
            })
    return cells


def _block_cells(source: dict[str, Any], page: dict[str, Any]) -> list[dict[str, Any]]:
    return [{
        "sourceFileId": source["sourceFileId"], "inputSha256": source["sha256"],
        "pageNumber": page["pageNumber"], "blockIndex": index,
        "lineIndex": 0, "text": block["text"], "textKind": "BLOCK",
        "bboxMilliPoints": block["bboxMilliPoints"],
    } for index, block in enumerate(page["blocks"])]


def _overlap_y(a: list[int], b: list[int]) -> bool:
    overlap = min(a[3], b[3]) - max(a[1], b[1])
    return overlap > 0 and overlap * 2 >= min(a[3] - a[1], b[3] - b[1])


def _table_facts(cells: list[dict[str, Any]], stage: str) -> list[dict[str, Any]]:
    # Require one unambiguous heading, one row of headers and one aligned value row.
    headings = [cell for cell in cells
                if (match := _THERMAL_HEADING.search(re.sub(r"\s+", " ", cell["text"])))
                and (match.group("unit") or re.search(
                    _UNIT, re.sub(r"\s+", " ", cell["text"])[match.end():match.end() + 70], re.I))]
    if len(headings) != 1:
        return []
    heading = headings[0]
    labels = [cell for cell in cells if _component_from_table_header(cell["text"])]
    if (len(labels) < 2 or len(labels) > 4
            or len({_component_from_table_header(cell["text"]) for cell in labels}) != len(labels)):
        return []
    labels.sort(key=lambda item: (item["bboxMilliPoints"][0] + item["bboxMilliPoints"][2]) / 2)
    if any(not _overlap_y(labels[0]["bboxMilliPoints"], item["bboxMilliPoints"])
           for item in labels[1:]):
        return []
    centers = [(item["bboxMilliPoints"][0] + item["bboxMilliPoints"][2]) / 2 for item in labels]
    if len(set(centers)) != len(centers):
        return []
    values = [cell for cell in cells if "\n" not in cell["text"] and _VALUE_ONLY.fullmatch(cell["text"])]
    all_options: list[list[dict[str, Any]]] = []
    for index, label in enumerate(labels):
        left = (centers[index - 1] + centers[index]) / 2 if index else centers[0] - (centers[1] - centers[0]) / 2
        right = (centers[index] + centers[index + 1]) / 2 if index + 1 < len(labels) else centers[-1] + (centers[-1] - centers[-2]) / 2
        options = [cell for cell in values
                   if left < (cell["bboxMilliPoints"][0] + cell["bboxMilliPoints"][2]) / 2 < right
                   and 0 < label["bboxMilliPoints"][1] - cell["bboxMilliPoints"][3] < 140_000]
        all_options.append(options)
    top_values = [cell for options in all_options for cell in options]
    if not top_values:
        return []
    anchor = max(top_values, key=lambda cell: cell["bboxMilliPoints"][3])
    columns = []
    for label, options in zip(labels, all_options):
        row = [cell for cell in options if _overlap_y(anchor["bboxMilliPoints"], cell["bboxMilliPoints"])]
        if len(row) > 1:
            return []
        if row:
            columns.append({"header": label, "value": row[0]})
    if len(columns) < 2:
        return []
    head_box, value_box = heading["bboxMilliPoints"], anchor["bboxMilliPoints"]
    heading_above = all(head_box[1] > label["bboxMilliPoints"][3] for label in labels)
    heading_left = head_box[2] < min(item["value"]["bboxMilliPoints"][0] for item in columns)
    if not (heading_above or (heading_left and _overlap_y(head_box, value_box))):
        return []
    return extract_heat_load_table(heading, columns, stage=stage, entity_key="building-total")


def execute_durable_pz017(lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
    manifest_hash = lease.get("inputManifestHash")
    object_id = lease.get("objectId")
    inputs = lease.get("inputs")
    if not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None:
        raise ValueError("PZ-017 lease has no immutable manifest hash")
    if not isinstance(object_id, str) or not object_id:
        raise ValueError("PZ-017 lease has no objectId")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list):
        raise ValueError("PZ-017 lease has no sourceFiles")
    decisions = inputs.get("sourceDecisions", {})
    if not isinstance(decisions, dict):
        raise ValueError("PZ-017 sourceDecisions must be an object")
    sources = inputs["sourceFiles"]
    ids: set[str] = set()
    facts: dict[str, list[dict[str, Any]]] = {"PD": [], "RD": []}
    scanned_pages = {"PD": 0, "RD": 0}
    ocr_required = 0
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("PZ-017 source metadata must be an object")
        source_id, source_sha, stages = source.get("sourceFileId"), source.get("sha256"), source.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in ids
                or not isinstance(source_sha, str) or _SHA256.fullmatch(source_sha) is None
                or not isinstance(stages, list) or not stages
                or any(stage not in {"PD", "RD", "ID"} for stage in stages)):
            raise ValueError("PZ-017 source metadata is invalid")
        ids.add(source_id)
        if source.get("mediaType") != "application/pdf":
            continue
        artifact = download_text_artifact(lease, source, attempt)
        for page in artifact["pages"]:
            stage = _stage_for_page(source, decisions.get(source_id), page["pageNumber"])
            if stage is None:
                continue
            scanned_pages[stage] += 1
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                ocr_required += 1
                continue
            cells = _cells(source, page)
            facts[stage].extend(extract_heat_load_lines(cells, stage=stage, entity_key="building-total"))
            facts[stage].extend(_table_facts(_block_cells(source, page), stage))
            if len(facts[stage]) > _MAX_FACTS:
                raise ValueError("PZ-017 fact count exceeds safe bound")
    if set(decisions) - ids:
        raise ValueError("PZ-017 sourceDecisions contain an unknown source")
    comparison = compare_heat_load_components(facts["PD"], facts["RD"])
    if not facts["PD"] or not facts["RD"]:
        status, reason = "MISSING_EVIDENCE", "MISSING_PD_OR_RD_HEAT_COMPONENT"
    elif comparison["disposition"] != "COMPONENTS_COMPARABLE":
        status, reason = "CLARIFICATION_REQUIRED", comparison["reasonCode"]
    else:
        # No total, source revision and link certification exists in this slice.
        status, reason = "CLARIFICATION_REQUIRED", "SOURCE_REVISION_LINK_AND_SCOPE_UNRESOLVED"
    return {
        "schemaVersion": "pz-017-analysis-v1", "objectId": object_id,
        "selectedManifestHash": manifest_hash, "selectedFileIds": sorted(ids),
        "extractionProfile": "pz-017-heat-components-v1",
        "pdFacts": facts["PD"], "rdFacts": facts["RD"],
        "scannedPages": scanned_pages, "ocrRequiredPageCount": ocr_required,
        "comparison": comparison,
        "evaluation": {
            "schemaVersion": "typed-rule-result-v1", "ruleId": "pilot-pz-017-heat",
            "ruleVersion": "1", "parameterCode": "PZ-017", "objectId": object_id,
            "executionStatus": "SUCCEEDED", "machineStatus": status,
            "reasonCode": reason, "evidence": [], "finding": None,
        },
    }
