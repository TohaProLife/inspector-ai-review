"""Review-only KR-067 material totals from explicitly selected public KR lines.

Only one complete, same-line total with an explicit structure scope and unit is
accepted. PDF table cells are never joined by reading order alone. This module
does not link PD to RD, verify drawing sections or revisions, or issue findings.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Sequence

from .fact_comparison import make_fact_id
from .indexed_page_evidence import load_indexed_page_evidence


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_INDEX_VERSION = re.compile(r"[0-9a-f]{20}\Z")
_NUMBER = r"(?:[0-9]{1,3}(?:[ \u00a0][0-9]{3})+|[0-9]+)(?:[.,][0-9]+)?"
_SCOPE = r"(?P<scope_kind>корпус|секция|здание|блок)\s*(?:№\s*)?(?P<scope_id>[1-9][0-9]{0,2}[А-ЯA-Z]?)"
_PREFIX = rf"^\s*{_SCOPE}\s*[,;:]\s*"
_CONCRETE = re.compile(
    _PREFIX + r"(?:(?:общ(?:ий|его)|итогов(?:ый|ого))\s+объ[её]м\s+бетона"
    r"|(?:итого|всего)\s*[:—–-]?\s*объ[её]м\s+бетона)"
    rf"\s*(?:[:=—–-]\s*|\s+)(?P<value>{_NUMBER})\s*"
    r"(?P<unit>м³|м3|m³|m3|куб\.\s*м)\s*[.;]?\s*$", re.I,
)
_STEEL = re.compile(
    _PREFIX + r"(?:(?:общ(?:ая|ей)|итогов(?:ая|ой))\s+масса\s+стали"
    r"|(?:итого|всего)\s*[:—–-]?\s*масса\s+стали)"
    rf"\s*(?:[:=—–-]\s*|\s+)(?P<value>{_NUMBER})\s*"
    r"(?P<unit>т\.?|t|кг|kg)\s*[.;]?\s*$", re.I,
)
_TARGET = re.compile(r"объ[её]м\s+бетона|масса\s+стали", re.I)
_SPECS = {
    "CONCRETE_VOLUME": (_CONCRETE, "m3"),
    "STEEL_MASS": (_STEEL, "t"),
}
_SCOPE_NAMES = {"корпус": "КОРПУС", "секция": "СЕКЦИЯ", "здание": "ЗДАНИЕ", "блок": "БЛОК"}
_TABLE_HEADINGS = {
    "CONCRETE_VOLUME": re.compile(
        r"\s*Сводная\s+ведомость\s+расхода\s+бетона\s*,\s*"
        r"(?P<unit>м3|м³|куб\.\s*м)\.?\s*\Z", re.I),
    "STEEL_MASS": re.compile(
        r"\s*Сводная\s+ведомость\s+расхода\s+стали\s*,\s*"
        r"(?P<unit>кг|т)\.?\s*\Z", re.I),
}
_ANY_MATERIAL_HEADING = re.compile(r"ведомость\s+расхода\s+(?:бетона|стали)", re.I)
_TOTAL_CELL = re.compile(r"\s*ИТОГО\s*:?\s*\Z", re.I)
_NUMBER_CELL = re.compile(rf"\s*(?P<value>{_NUMBER})\s*\Z")


class InvalidTableGeometry(ValueError):
    """Complete page cannot safely support a geometry-based table observation."""


def _hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _valid_box(box: object) -> bool:
    return (isinstance(box, list) and len(box) == 4
            and all(type(value) is int and value >= 0 for value in box)
            and box[0] < box[2] and box[1] < box[3])


def _validate_evidence(evidence: object) -> dict[str, Any]:
    if not isinstance(evidence, dict) or evidence.get("schemaVersion") != "indexed-page-evidence-v1":
        raise ValueError("indexed page evidence schema invalid")
    digest = evidence.get("evidenceSha256")
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise ValueError("indexed page evidence SHA invalid")
    try:
        if _hash({key: value for key, value in evidence.items() if key != "evidenceSha256"}) != digest:
            raise ValueError("indexed page evidence SHA mismatch")
    except (TypeError, ValueError) as error:
        raise ValueError("indexed page evidence SHA or content invalid") from error
    if (evidence.get("candidateStatus") != "CANDIDATE"
            or evidence.get("stage") not in {"PD", "RD"}
            or evidence.get("section") != "KR"
            or evidence.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"
            or not isinstance(evidence.get("quality"), dict)
            or evidence["quality"].get("disposition") != "TEXT_LAYER_CANDIDATE"
            or not isinstance(evidence.get("lines"), list)
            or not isinstance(evidence.get("blocks"), list)
            or not isinstance(evidence.get("selectedBlockIndices"), list)):
        raise ValueError("indexed page evidence scope or quality invalid")
    if any(not isinstance(evidence.get(key), str) or not evidence[key].strip() for key in
           ("objectId", "sourceFileId", "parserProvenance")):
        raise ValueError("indexed page evidence source invalid")
    if not re.fullmatch(r"F[0-9]{4}", evidence["sourceFileId"]) or evidence["sourceFileId"] == "F0194":
        raise ValueError("indexed page evidence source outside PDF scope")
    if any(not isinstance(evidence.get(key), str) or not _SHA256.fullmatch(evidence[key]) for key in
           ("manifestSha256", "sourceSha256", "pageArtifactSha256")):
        raise ValueError("indexed page evidence provenance SHA invalid")
    if (not isinstance(evidence.get("indexVersionHash"), str)
            or not _INDEX_VERSION.fullmatch(evidence["indexVersionHash"])):
        raise ValueError("indexed page evidence index version invalid")
    if type(evidence.get("pageNumber")) is not int or evidence["pageNumber"] < 1:
        raise ValueError("indexed page evidence page invalid")
    indices = evidence["selectedBlockIndices"]
    blocks = evidence["blocks"]
    if (not 1 <= len(indices) <= 64 or indices != sorted(set(indices))
            or len(blocks) != len(indices)
            or any(type(index) is not int or index < 0 for index in indices)
            or any(not isinstance(block, dict) or block.get("blockIndex") != index
                   or not isinstance(block.get("text"), str) or not _valid_box(block.get("bboxMilliPoints"))
                   for block, index in zip(blocks, indices))):
        raise ValueError("indexed page evidence selected blocks invalid")
    if (len(evidence["lines"]) > 512 or any(
            not isinstance(line, dict) or line.get("blockIndex") not in indices
            or type(line.get("lineIndex")) is not int or line["lineIndex"] < 0
            or not isinstance(line.get("text"), str) or not _valid_box(line.get("bboxMilliPoints"))
            for line in evidence["lines"])):
        raise ValueError("indexed page evidence selected lines invalid")
    if len({(line["blockIndex"], line["lineIndex"]) for line in evidence["lines"]}) != len(evidence["lines"]):
        raise ValueError("indexed page evidence line locators duplicate")
    return evidence


def _row_overlap(first: list[int], second: list[int]) -> float:
    intersection = max(0, min(first[3], second[3]) - max(first[1], second[1]))
    return intersection / max(1, min(first[3] - first[1], second[3] - second[1]))


def _table_triples(page: dict[str, Any]) -> list[tuple[str, dict[str, Any], dict[str, Any], dict[str, Any], str]]:
    """Find unique material/total/value triples across a complete indexed page.

    The returned geometry is page-local. It never establishes structure scope
    or comparability with another document.
    """
    lines = page.get("lines")
    blocks = page.get("blocks")
    if (not isinstance(lines, list) or not isinstance(blocks, list)
            or not all(isinstance(line, dict) and isinstance(line.get("text"), str)
                       and type(line.get("blockIndex")) is int
                       and 0 <= line["blockIndex"] < len(blocks)
                       and _valid_box(line.get("bboxMilliPoints")) for line in lines)):
        raise InvalidTableGeometry("complete indexed page geometry invalid")
    candidates = []
    for attribute, heading_expression in _TABLE_HEADINGS.items():
        headings = [(line, match) for line in lines
                    if (match := heading_expression.fullmatch(line["text"])) is not None]
        # A second heading of the same material makes the page-level total
        # ambiguous, even when only one heading was selected by FTS.
        if len(headings) != 1:
            continue
        heading, heading_match = headings[0]
        heading_box = heading["bboxMilliPoints"]
        other_material_headings = [line for line in lines if line is not heading
                                   and _ANY_MATERIAL_HEADING.search(line["text"])]
        totals = []
        for total in lines:
            if not _TOTAL_CELL.fullmatch(total["text"]):
                continue
            box = total["bboxMilliPoints"]
            # PDF bottom-left: table total must lie below its heading and
            # within a bounded vertical region on the same page.
            if not (0 < heading_box[1] - box[3] <= 250000
                    and box[0] >= heading_box[0] - 100000
                    and box[2] <= heading_box[2] + 100000):
                continue
            if any(box[3] < other["bboxMilliPoints"][1] <= box[3] + 250000
                   for other in other_material_headings):
                continue
            totals.append(total)
        if len(totals) != 1:
            continue
        total = totals[0]
        total_box = total["bboxMilliPoints"]
        # Count *all* pure numeric cells to the right on the same row before
        # choosing the nearest. A six-column steel summary must abstain.
        values = [(line, match) for line in lines if line is not total
                  and (match := _NUMBER_CELL.fullmatch(line["text"])) is not None
                  and line["bboxMilliPoints"][0] > total_box[2]
                  and _row_overlap(total_box, line["bboxMilliPoints"]) >= 0.7]
        if len(values) != 1:
            continue
        value, _ = values[0]
        if value["bboxMilliPoints"][0] - total_box[2] > 60000:
            continue
        candidates.append((attribute, heading, total, value, heading_match.group("unit")))
    return candidates


def select_kr_relative_delta_table_blocks(page: dict[str, Any]) -> list[int]:
    """Select complete-page-proven table cells for a checked evidence read."""
    return sorted({line["blockIndex"] for _, heading, total, value, _ in _table_triples(page)
                   for line in (heading, total, value)})


def extract_kr_relative_delta_table_observations(
    evidence: dict[str, Any], complete_page: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return page-local table observations, never KR-067 typed facts.

    ``complete_page`` must come from SHA-checked ``get_indexed_page``. Its
    complete lines prevent a selected-block subset from hiding a competing
    total, material heading or numeric column.
    """
    evidence = _validate_evidence(evidence)
    if (not isinstance(complete_page, dict)
            or complete_page.get("pageNumber") != evidence["pageNumber"]
            or complete_page.get("inputSha256") != evidence["sourceSha256"]
            or complete_page.get("indexVersionHash") != evidence["indexVersionHash"]
            or complete_page.get("coordinateSystem") != evidence["coordinateSystem"]
            or not isinstance(complete_page.get("blocks"), list)):
        raise ValueError("complete indexed page provenance invalid")
    full_blocks = complete_page["blocks"]
    for selected in evidence["blocks"]:
        index = selected["blockIndex"]
        if index >= len(full_blocks) or selected["text"] != full_blocks[index].get("text") \
                or selected["bboxMilliPoints"] != full_blocks[index].get("bboxMilliPoints"):
            raise ValueError("selected block differs from complete indexed page")
    selected_lines = {(line["blockIndex"], line["lineIndex"]): line for line in evidence["lines"]}
    observations: list[dict[str, Any]] = []
    for attribute, heading, total, value, unit in _table_triples(complete_page):
        key_lines = (heading, total, value)
        if any(selected_lines.get((line["blockIndex"], line["lineIndex"])) != line
               for line in key_lines):
            continue
        raw = full_blocks[value["blockIndex"]]["text"]
        value_text = value["text"]
        if raw.count(value_text) != 1:
            continue
        value_start = raw.index(value_text) + _NUMBER_CELL.fullmatch(value_text).start("value")
        value_end = value_start + len(_NUMBER_CELL.fullmatch(value_text).group("value"))
        if raw[value_start:value_end] != value_text.strip():
            continue
        table_scope = f"{evidence['sourceFileId']}:p{evidence['pageNumber']}:b{heading['blockIndex']}"
        observation = {
            "schemaVersion": "kr-relative-delta-table-observation-v1",
            "status": "PAGE_LOCAL_REVIEW_CANDIDATE", "parameterCode": "KR-067",
            "attribute": attribute, "scopeStatus": "TABLE_OR_COMPONENT_ONLY",
            "structureScopeStatus": "UNVERIFIED", "tableScope": table_scope,
            "headingText": heading["text"], "totalText": total["text"],
            "rawValue": raw[value_start:value_end], "rawUnit": unit,
            "canonicalUnit": _SPECS[attribute][1],
            "objectId": evidence["objectId"], "stage": evidence["stage"],
            "sourceFileId": evidence["sourceFileId"], "sourceSha256": evidence["sourceSha256"],
            "pageNumber": evidence["pageNumber"],
            "locators": {
                "heading": {"blockIndex": heading["blockIndex"], "lineIndex": heading["lineIndex"],
                            "bboxMilliPoints": heading["bboxMilliPoints"]},
                "total": {"blockIndex": total["blockIndex"], "lineIndex": total["lineIndex"],
                          "bboxMilliPoints": total["bboxMilliPoints"]},
                "value": {"blockIndex": value["blockIndex"], "lineIndex": value["lineIndex"],
                          "bboxMilliPoints": value["bboxMilliPoints"],
                          "start": value_start, "end": value_end},
            },
            "indexProvenance": {
                "manifestSha256": evidence["manifestSha256"],
                "indexVersionHash": evidence["indexVersionHash"],
                "pageArtifactSha256": evidence["pageArtifactSha256"],
                "parserProvenance": evidence["parserProvenance"],
                "evidenceSha256": evidence["evidenceSha256"],
            },
        }
        observation["observationSha256"] = _hash(observation)
        observations.append(observation)
    return observations


def _observation(evidence: dict[str, Any], attribute: str, block: dict[str, Any],
                 line: dict[str, Any], match: re.Match[str]) -> dict[str, Any] | None:
    line_text = line["text"]
    raw_text = block["text"]
    # Source block must contain this physical line exactly once. Otherwise a
    # text-block offset would claim the wrong repeated occurrence.
    if raw_text.count(line_text) != 1:
        return None
    start = raw_text.index(line_text) + match.start("value")
    end = start + len(match.group("value"))
    if raw_text[start:end] != match.group("value"):
        return None
    kind = _SCOPE_NAMES[match.group("scope_kind").casefold()]
    scope_id = match.group("scope_id").upper()
    _, canonical_unit = _SPECS[attribute]
    fact: dict[str, Any] = {
        "schemaVersion": "typed-fact-v1", "parameterCode": "KR-067",
        "attribute": attribute, "objectId": evidence["objectId"],
        "stage": evidence["stage"], "sourceFileId": evidence["sourceFileId"],
        "sourceSha256": evidence["sourceSha256"], "pageNumber": evidence["pageNumber"],
        "rawText": raw_text, "rawValue": match.group("value"), "rawUnit": match.group("unit"),
        "canonicalUnit": canonical_unit,
        "elementType": "STRUCTURE_SCOPE", "elementId": f"{kind}:{scope_id}",
        "scope": f"{kind}:{scope_id}", "scopeText": line_text[match.start("scope_kind"):match.end("scope_id")],
        "materialComponent": attribute, "measurementBasis": "EXPLICIT_SAME_LINE_TOTAL",
        "locator": {"kind": "TEXT_BLOCK", "blockIndex": block["blockIndex"],
                    "start": start, "end": end, "bboxMilliPoints": block["bboxMilliPoints"]},
        "lineLocator": {"blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                        "bboxMilliPoints": line["bboxMilliPoints"]},
        "indexProvenance": {
            "manifestSha256": evidence["manifestSha256"],
            "indexVersionHash": evidence["indexVersionHash"],
            "pageArtifactSha256": evidence["pageArtifactSha256"],
            "parserProvenance": evidence["parserProvenance"],
            "evidenceSha256": evidence["evidenceSha256"],
        },
    }
    fact["factId"] = make_fact_id(fact)
    return fact


def extract_kr_relative_delta_from_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return atomic material observations, never a KR-067 finding or coverage."""
    evidence = _validate_evidence(evidence)
    blocks = {block["blockIndex"]: block for block in evidence["blocks"]}
    results: dict[str, dict[str, Any]] = {}
    for attribute, (expression, _) in _SPECS.items():
        candidates: list[dict[str, Any]] = []
        ambiguous = False
        for line in evidence["lines"]:
            text = line["text"]
            if not _TARGET.search(text):
                continue
            # A selected line naming another material is irrelevant to this
            # attribute; a line naming both is ambiguous for both.
            if (attribute == "CONCRETE_VOLUME" and not re.search(r"объ[её]м\s+бетона", text, re.I)
                    or attribute == "STEEL_MASS" and not re.search(r"масса\s+стали", text, re.I)):
                continue
            match = expression.fullmatch(text)
            if match is None or (attribute == "STEEL_MASS"
                                 and match.group("unit") not in {"т", "т.", "t", "кг", "kg"}):
                ambiguous = True
                continue
            candidate = _observation(evidence, attribute, blocks[line["blockIndex"]], line, match)
            if candidate is None:
                ambiguous = True
            else:
                candidates.append(candidate)
        if ambiguous or len(candidates) > 1:
            results[attribute] = {"status": "ABSTAIN", "reasonCode": "AMBIGUOUS_SELECTED_EVIDENCE", "facts": []}
        elif candidates:
            results[attribute] = {"status": "REVIEW_CANDIDATE", "reasonCode": "EXPLICIT_SAME_LINE_TOTAL",
                                  "facts": candidates}
        else:
            results[attribute] = {"status": "ABSTAIN", "reasonCode": "NO_QUALIFIED_SELECTED_LINE", "facts": []}
    return {
        "schemaVersion": "kr-relative-delta-observations-v1", "parameterCode": "KR-067",
        "disposition": "REVIEW_ONLY", "objectId": evidence["objectId"],
        "sourceFileId": evidence["sourceFileId"], "sourceSha256": evidence["sourceSha256"],
        "pageNumber": evidence["pageNumber"], "evidenceSha256": evidence["evidenceSha256"],
        "selectionComplete": False, "drawingSectionStatus": "UNVERIFIED",
        "revisionApprovalStatus": "UNVERIFIED", "entityLinkStatus": "UNVERIFIED",
        "relativeDenominatorStatus": "UNVERIFIED", "results": results,
    }


def extract_kr_relative_delta_candidates(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, block_indices: Sequence[int],
) -> dict[str, Any]:
    """Load one explicit TRAIN_PUBLIC KR selection through the checked adapter."""
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=expected_object_id, expected_stage=expected_stage,
        expected_section="KR", block_indices=block_indices,
    )
    return extract_kr_relative_delta_from_evidence(evidence)
