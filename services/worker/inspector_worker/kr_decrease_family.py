"""Bounded, review-only KR-061/062 observations from selected public index lines.

The extractor intentionally accepts only complete claims on one indexed line.
It does not join PDF cells, link PD to RD, compare values, or infer absence from
an unselected page. Drawing marks, revisions and approvals remain review gates.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Sequence

from .fact_comparison import make_fact_id
from .indexed_page_evidence import load_indexed_page_evidence


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_INDEX_VERSION_HASH = re.compile(r"[0-9a-f]{20}\Z")
_MM = re.compile(r"(?<![\w])([1-9][0-9]{0,3})\s*(мм|mm)\b", re.I)
_DIAMETER = re.compile(
    r"(?<![\w])(?:[Ø⌀] ?\s*|(?:диаметр|диам\.)\s*)"
    r"([1-9][0-9]{0,2})(?:\s*(мм|mm))?(?![\d])", re.I,
)
_ZONE = re.compile(r"\b(?:корпус|секция|зона)\s*(?:№\s*)?([А-ЯA-Z0-9-]*\d[А-ЯA-Z0-9-]*)\b", re.I)
_FLOOR = re.compile(r"(?<!\d)(?:этаж\s*№?\s*([−-]?\d+)|([−-]?\d+)\s*(?:-?й|-?го)?\s*этаж\w*)", re.I)
_FLOOR_GROUP = re.compile(
    r"(?<!\d)[−-]?\d+(?:-?й|-?го)?\s*"
    r"(?:[-–—/]|\bи\b|\bпо\b)\s*[−-]?\d+(?:-?й|-?го)?\s*этаж\w*"
    r"|(?<!\d)[−-]?\d+,[−-]?\d+(?:-?й|-?го)?\s*этаж\w*"
    r"|\bэтаж\w*\s*(?:№\s*)?[−-]?\d+\s*(?:[-–—/,]|\bи\b|\bпо\b)\s*[−-]?\d+", re.I,
)
_ZONE_GROUP = re.compile(
    r"\b(?:корпус|секция|зона)\s*(?:№\s*)?"
    r"(?:[А-ЯA-Z]{0,3}[-]?)?\d+[А-ЯA-Z]?\s*"
    r"(?P<separator>[/,−–—-]|\bи\b|\bпо\b)\s*"
    r"(?:[А-ЯA-Z]{0,3}[-]?)?\d+[А-ЯA-Z]?", re.I,
)
_ELEMENT_GROUP = re.compile(
    r"\b(?:стен\w*|колонн\w*|пилон\w*)\s+"
    r"[А-ЯA-Z]{1,3}[-]?[0-9]+\s*(?:[/,]|\bи\b|[-–—])\s*"
    r"[А-ЯA-Z]{1,3}[-]?[0-9]+", re.I,
)
_WALL = re.compile(r"\bстен\w*\b", re.I)
_WALL_ID = re.compile(r"\bстен\w*\s*(?:марки\s*)?(?:№\s*)?([А-ЯA-Z]{1,3}[-]?[0-9]+[А-ЯA-Z0-9-]*)\b", re.I)
_COLUMN = re.compile(r"\b(?:колонн\w*|пилон\w*)\b", re.I)
_COLUMN_ID = re.compile(r"\b(?:колонн\w*|пилон\w*)\s*(?:марки\s*)?(?:№\s*)?([А-ЯA-Z]{1,3}[-]?[0-9]+[А-ЯA-Z0-9-]*)\b", re.I)
_THICKNESS = re.compile(r"\bтолщин\w*\b", re.I)
_LOAD_BEARING = re.compile(r"\bнесущ\w*\b", re.I)
_MONOLITHIC = re.compile(r"\bмонолитн\w*\b", re.I)
_LONGITUDINAL = re.compile(r"\bпродольн\w*\b", re.I)
_REBAR = re.compile(r"\bарматур\w*\b|\bстержн\w*\b", re.I)
_OTHER_ROLE = re.compile(r"\b(?:поперечн\w*|хомут\w*|шаг\w*|сетк\w*)\b", re.I)
_OTHER_WALL = re.compile(r"\b(?:ненесущ\w*|перегородк\w*|утеплител\w*|кладк\w*)\b", re.I)
_NEGATED = re.compile(
    r"\b(?:не\s+предусмотр\w*|не\s+(?:явля\w*\s+)?"
    r"(?:несущ\w*|монолитн\w*|продольн\w*)|кроме|за\s+исключением|демонтир\w*)\b", re.I,
)

_SPECS = {
    "KR-061": ("LOAD_BEARING_MONOLITHIC_WALL_THICKNESS", "WALL"),
    "KR-062": ("LONGITUDINAL_REBAR_DIAMETER", "COLUMN_OR_PYLON"),
}


def _json_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _unique_match(pattern: re.Pattern[str], text: str) -> re.Match[str] | None:
    matches = list(pattern.finditer(text))
    return matches[0] if len(matches) == 1 else None


def _has_grouped_zone(text: str) -> bool:
    for match in _ZONE_GROUP.finditer(text):
        # "Корпус 1, 3 этаж" has one corpus and one floor. Comma is a
        # boundary there, not a list of corpora.
        if match.group("separator") == "," and re.match(
                r"\s*(?:-?й|-?го)?\s*этаж\w*\b", text[match.end():], re.I):
            continue
        return True
    return False


def _evidence_is_valid(evidence: Any) -> bool:
    if not isinstance(evidence, dict) or evidence.get("schemaVersion") != "indexed-page-evidence-v1":
        return False
    digest = evidence.get("evidenceSha256")
    if not isinstance(digest, str) or _HASH.fullmatch(digest) is None:
        return False
    try:
        if digest != _json_hash({key: value for key, value in evidence.items()
                                if key != "evidenceSha256"}):
            return False
    except (TypeError, ValueError):
        return False
    if (evidence.get("candidateStatus") != "CANDIDATE"
            or evidence.get("stage") not in {"PD", "RD"}
            or evidence.get("section") != "KR"
            or evidence.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"
            or not isinstance(evidence.get("quality"), dict)
            or evidence["quality"].get("disposition") != "TEXT_LAYER_CANDIDATE"
            or not isinstance(evidence.get("lines"), list)
            or not isinstance(evidence.get("blocks"), list)
            or not isinstance(evidence.get("selectedBlockIndices"), list)):
        return False
    if any(not isinstance(evidence.get(key), str) or not evidence[key] for key in
           ("objectId", "sourceFileId", "sourceSha256", "pageArtifactSha256",
            "parserProvenance", "manifestSha256", "indexVersionHash")):
        return False
    if any(_HASH.fullmatch(evidence[key]) is None for key in
           ("sourceSha256", "pageArtifactSha256", "manifestSha256")):
        return False
    if _INDEX_VERSION_HASH.fullmatch(evidence["indexVersionHash"]) is None:
        return False
    if type(evidence.get("pageNumber")) is not int or evidence["pageNumber"] < 1:
        return False
    blocks = evidence["blocks"]
    indices = evidence["selectedBlockIndices"]
    if (not 1 <= len(indices) <= 64 or indices != sorted(set(indices))
            or any(type(index) is not int or index < 0 for index in indices)
            or len(blocks) != len(indices)
            or any(not isinstance(block, dict) or block.get("blockIndex") != index
                   or not isinstance(block.get("text"), str)
                   or not isinstance(block.get("bboxMilliPoints"), list)
                   or len(block["bboxMilliPoints"]) != 4
                   for block, index in zip(blocks, indices))):
        return False
    return all(isinstance(line, dict) and line.get("blockIndex") in indices
               and type(line.get("lineIndex")) is int and line["lineIndex"] >= 0
               and isinstance(line.get("text"), str)
               and isinstance(line.get("bboxMilliPoints"), list)
               and len(line["bboxMilliPoints"]) == 4
               for line in evidence["lines"])


def _line_claim(code: str, text: str) -> tuple[re.Match[str] | None, dict[str, str] | None, str]:
    """Return value and exact local context or one abstention reason."""
    if _NEGATED.search(text):
        return None, None, "NEGATED_OR_EXCLUDED"
    if _FLOOR_GROUP.search(text) or _has_grouped_zone(text) or _ELEMENT_GROUP.search(text):
        return None, None, "ELEMENT_ZONE_OR_FLOOR_UNRESOLVED"
    zone = _unique_match(_ZONE, text)
    floor = _unique_match(_FLOOR, text)
    if code == "KR-061":
        if not (_WALL.search(text) and _LOAD_BEARING.search(text)
                and _MONOLITHIC.search(text) and _THICKNESS.search(text)):
            return None, None, "NOT_TARGET_CLAIM"
        if _OTHER_WALL.search(text) or _COLUMN.search(text):
            return None, None, "MIXED_ELEMENT_OR_MATERIAL"
        element = _unique_match(_WALL_ID, text)
        values = list(_MM.finditer(text))
        if len(values) != 1:
            return None, None, "MULTIPLE_OR_MISSING_VALUES"
        value = values[0]
        # Reject a number before thickness claim; another dimension may belong
        # to a different column in a flattened row.
        if _THICKNESS.search(text).start() > value.start(1):
            return None, None, "VALUE_PRECEDES_MEASUREMENT"
        basis = "EXPLICIT_THICKNESS_MM"
    else:
        if not (_COLUMN.search(text) and _LONGITUDINAL.search(text) and _REBAR.search(text)):
            return None, None, "NOT_TARGET_CLAIM"
        if _OTHER_ROLE.search(text) or _WALL.search(text):
            return None, None, "MIXED_ELEMENT_OR_REBAR_ROLE"
        element = _unique_match(_COLUMN_ID, text)
        values = list(_DIAMETER.finditer(text))
        # A second metric on same line, including a bar pitch, makes role
        # attribution unsafe without a reviewed table/header association.
        if len(values) != 1 or len(_MM.findall(text)) > (1 if values and values[0].group(2) else 0):
            return None, None, "MULTIPLE_OR_MISSING_VALUES"
        value = values[0]
        if value.group(2) is None and text[value.start():value.start()+1] not in {"Ø", "⌀"}:
            return None, None, "DIAMETER_UNIT_UNRESOLVED"
        basis = "DIAMETER_SYMBOL_MM" if value.group(2) is None else "EXPLICIT_DIAMETER_MM"
    if zone is None or floor is None or element is None:
        return None, None, "ELEMENT_ZONE_OR_FLOOR_UNRESOLVED"
    if re.search(r"\d[-/]\d", zone.group(1)) or re.search(r"\d[-/]\d", element.group(1)):
        return None, None, "ELEMENT_ZONE_OR_FLOOR_UNRESOLVED"
    return value, {
        "elementId": element.group(1).upper(),
        "zone": zone.group(0).strip(),
        "floor": floor.group(0).strip(),
        "measurementBasis": basis,
    }, "MATCH"


def _fact(evidence: dict[str, Any], code: str, block: dict[str, Any],
          line: dict[str, Any], match: re.Match[str], context: dict[str, str]) -> dict[str, Any] | None:
    raw_text = block["text"]
    line_text = line["text"]
    # A repeated line in one block has no unique character offset.
    if raw_text.count(line_text) != 1:
        return None
    start = raw_text.index(line_text) + match.start(1)
    end = start + len(match.group(1))
    if raw_text[start:end] != match.group(1):
        return None
    fact: dict[str, Any] = {
        "schemaVersion": "typed-fact-v1", "parameterCode": code,
        "attribute": _SPECS[code][0], "objectId": evidence["objectId"],
        "stage": evidence["stage"], "sourceFileId": evidence["sourceFileId"],
        "sourceSha256": evidence["sourceSha256"], "pageNumber": evidence["pageNumber"],
        "rawText": raw_text, "rawValue": match.group(1), "rawUnit": match.group(2) or "мм",
        "canonicalUnit": "mm", "elementType": _SPECS[code][1],
        **context,
        "locator": {"kind": "TEXT_BLOCK", "blockIndex": block["blockIndex"],
                    "start": start, "end": end,
                    "bboxMilliPoints": block["bboxMilliPoints"]},
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


def extract_kr_decrease_from_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return selected-line proposals only; every unmatched code abstains."""
    if not _evidence_is_valid(evidence):
        raise ValueError("indexed page evidence schema, scope or SHA is invalid")
    blocks = {block["blockIndex"]: block for block in evidence["blocks"]}
    results: dict[str, dict[str, Any]] = {}
    for code in _SPECS:
        candidates: list[dict[str, Any]] = []
        ambiguous = False
        for line in evidence["lines"]:
            value, context, reason = _line_claim(code, line["text"])
            if reason in {"MULTIPLE_OR_MISSING_VALUES", "MIXED_ELEMENT_OR_MATERIAL",
                          "MIXED_ELEMENT_OR_REBAR_ROLE", "DIAMETER_UNIT_UNRESOLVED",
                          "ELEMENT_ZONE_OR_FLOOR_UNRESOLVED", "VALUE_PRECEDES_MEASUREMENT"}:
                ambiguous = True
            if value is None or context is None:
                continue
            candidate = _fact(evidence, code, blocks[line["blockIndex"]], line, value, context)
            if candidate is None:
                ambiguous = True
            else:
                candidates.append(candidate)
        if ambiguous or len(candidates) > 1:
            results[code] = {"status": "ABSTAIN", "reasonCode": "AMBIGUOUS_SELECTED_EVIDENCE", "facts": []}
        elif candidates:
            results[code] = {"status": "REVIEW_CANDIDATE", "reasonCode": "STRUCTURED_LINE_ONLY",
                             "facts": candidates}
        else:
            results[code] = {"status": "ABSTAIN", "reasonCode": "NO_QUALIFIED_SELECTED_LINE", "facts": []}
    return {
        "schemaVersion": "kr-decrease-observations-v1", "disposition": "REVIEW_ONLY",
        "objectId": evidence["objectId"], "sourceFileId": evidence["sourceFileId"],
        "sourceSha256": evidence["sourceSha256"], "pageNumber": evidence["pageNumber"],
        "evidenceSha256": evidence["evidenceSha256"],
        "selectionComplete": False, "drawingSectionStatus": "UNVERIFIED",
        "revisionApprovalStatus": "UNVERIFIED", "entityLinkStatus": "UNVERIFIED",
        "results": results,
    }


def extract_kr_decrease_candidates(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, block_indices: Sequence[int],
) -> dict[str, Any]:
    """Read one explicitly selected public KR page through the checked adapter."""
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=expected_object_id, expected_stage=expected_stage,
        expected_section="KR", block_indices=block_indices,
    )
    return extract_kr_decrease_from_evidence(evidence)
