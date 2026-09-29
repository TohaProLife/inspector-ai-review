"""Conservative PZ-017 component extraction from provenance-bearing text.

This is an offline fact proposal, not a coverage or finding adapter. In
particular, a displayed ``Общий`` column is never added to its components.
The caller must independently validate PDF geometry, stage, revision, approval,
object link, and completeness of the relevant drawing/table scope.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_NUMBER = r"[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?"
_UNIT = r"(?:Гкал\s*/\s*(?:час|ч)|кВт|МВт|kW|MW)"
_THERMAL_HEADING = re.compile(
    rf"\bтеплов(?:ая|ой|ую)\s+(?:нагрузк\w*|поток\w*)(?:\s+Q)?\s*[,;:]?\s*(?P<unit>{_UNIT})?",
    re.IGNORECASE,
)
_GROUP_UNIT = re.compile(rf"[,;:]\s*(?P<unit>{_UNIT})\s*\Z", re.IGNORECASE)
_VALUE_ONLY = re.compile(rf"\s*(?P<value>{_NUMBER})\s*\Z")
_COMPONENT_LABELS = {
    "HEATING": re.compile(r"(?:на\s+)?отоплени[ея]\s*\Z", re.IGNORECASE),
    "VENTILATION": re.compile(r"(?:на\s+)?вентиляци[юя]\s*\Z", re.IGNORECASE),
    "CURTAINS": re.compile(r"(?:на\s+)?(?:тепло[\s-]*завесы|воздушно[\s-]*тепловые\s+завесы)\s*\Z", re.IGNORECASE),
    "DHW": re.compile(r"(?:на\s+)?(?:ГВС|горячее\s+водоснабжение)\s*\Z", re.IGNORECASE),
}
_INLINE_LABELS = {component: pattern.pattern.removesuffix(r"\s*\Z")
                  for component, pattern in _COMPONENT_LABELS.items()}
_INLINE = {
    component: re.compile(
        rf"(?P<label>{label})\s*[:=—–-]\s*"
        rf"(?P<value>{_NUMBER})\s*(?P<unit>{_UNIT})(?!\w)",
        re.IGNORECASE,
    )
    for component, label in _INLINE_LABELS.items()
}
_UNIT_CANONICAL = {
    "квт": ("kW", Decimal("1")),
    "kw": ("kW", Decimal("1")),
    "мвт": ("kW", Decimal("1000")),
    "mw": ("kW", Decimal("1000")),
    "гкал/ч": ("Gcal/h", Decimal("1")),
    "гкал/час": ("Gcal/h", Decimal("1")),
}


def _component_from_table_header(text: str) -> str | None:
    compact = re.sub(r"[\s\-]+", "", text).casefold().rstrip(".")
    aliases = {
        "HEATING": {"отопление", "наотопление"},
        "VENTILATION": {"вентиляция", "вентиляцию", "навентиляцию", "навентиляция"},
        "CURTAINS": {"тепловыезавесы", "теплозавесы", "натеплозавесы",
                     "воздушнотепловыезавесы", "навоздушнотепловыезавесы"},
        "DHW": {"гвс", "нагвс", "гвсмакс", "горячееводоснабжение", "нагорячееводоснабжение"},
    }
    return next((component for component, forms in aliases.items() if compact in forms), None)
# Keep Gcal/h and kW separate: conversion depends on the calorie convention
# adopted by the source, which this text-only slice cannot establish.


def _cell(cell: object) -> dict[str, Any]:
    """Reject detached or fabricated-looking locators before using their text."""
    if not isinstance(cell, dict):
        raise ValueError("heat-load cell must be an object")
    source = cell.get("sourceFileId")
    source_hash = cell.get("inputSha256")
    page = cell.get("pageNumber")
    block = cell.get("blockIndex")
    line = cell.get("lineIndex")
    raw = cell.get("text")
    if (not isinstance(source, str) or not source
            or not isinstance(source_hash, str) or _HASH.fullmatch(source_hash) is None
            or type(page) is not int or page < 1
            or type(block) is not int or block < 0
            or type(line) is not int or line < 0
            or not isinstance(raw, str) or not raw.strip()):
        raise ValueError("heat-load cell requires source hash, page/block/line, and raw text")
    result = {key: cell[key] for key in (
        "sourceFileId", "inputSha256", "pageNumber", "blockIndex", "lineIndex", "text",
    )}
    if "bboxMilliPoints" in cell:
        bbox = cell["bboxMilliPoints"]
        if (not isinstance(bbox, list) or len(bbox) != 4
                or any(type(value) is not int or value < 0 for value in bbox)
                or bbox[0] > bbox[2] or bbox[1] > bbox[3]):
            raise ValueError("heat-load cell block bbox is invalid")
        result["bboxMilliPoints"] = bbox
    if "textKind" in cell:
        if cell["textKind"] not in {"LINE", "BLOCK"}:
            raise ValueError("heat-load cell textKind is invalid")
        result["textKind"] = cell["textKind"]
    return result


def _numeric(raw_value: str, raw_unit: str) -> tuple[str, str]:
    try:
        number = Decimal(raw_value.replace(" ", "").replace("\u00a0", "").replace(",", "."))
    except InvalidOperation as error:
        raise ValueError("heat-load value is not a decimal") from error
    if not number.is_finite() or number < 0:
        raise ValueError("heat-load value must be finite and non-negative")
    unit = re.sub(r"\s+", "", raw_unit).casefold()
    if unit not in _UNIT_CANONICAL:
        raise ValueError("unsupported heat-load unit")
    canonical, factor = _UNIT_CANONICAL[unit]
    return format(number * factor, "f"), canonical


def _fact(
    component: str, raw_value: str, raw_unit: str, evidence: list[tuple[str, dict[str, Any]]],
    *, stage: str, entity_key: str,
) -> dict[str, Any]:
    normalized, unit = _numeric(raw_value, raw_unit)
    anchor = evidence[-1][1]
    return {
        "parameterCode": "PZ-017",
        "extractionProfile": "pz-017-heat-components-v1",
        "stage": stage,
        "entityKey": entity_key,
        "component": component,
        "sourceFileId": anchor["sourceFileId"],
        "inputSha256": anchor["inputSha256"],
        "pageNumber": anchor["pageNumber"],
        "blockIndex": anchor["blockIndex"],
        "lineIndex": anchor["lineIndex"],
        "rawValue": raw_value,
        "rawUnit": raw_unit,
        "normalizedValue": normalized,
        "canonicalUnit": unit,
        "evidence": [{"role": role, **cell} for role, cell in evidence],
    }


def _context(stage: str, entity_key: str) -> None:
    if stage not in {"PD", "RD"}:
        raise ValueError("PZ-017 component stage must be PD or RD")
    if not isinstance(entity_key, str) or not entity_key.strip():
        raise ValueError("PZ-017 entity key is required")


def extract_heat_load_lines(
    lines: list[dict[str, Any]], *, stage: str, entity_key: str,
) -> list[dict[str, Any]]:
    """Read explicit thermal component statements in individual source lines.

    A bare ``отопление 100 кВт`` may be an electrical load, so it is ignored.
    Multi-component lines are ignored because a number-to-component assignment
    cannot be proved by this narrow grammar.
    """
    _context(stage, entity_key)
    if not isinstance(lines, list):
        raise ValueError("heat-load lines must be an array")
    facts = []
    for raw_line in lines:
        line = _cell(raw_line)
        text = line["text"]
        if re.search(r"электрическ", text, re.IGNORECASE):
            continue
        heading = _THERMAL_HEADING.search(text)
        if heading is None:
            continue
        tail = text[heading.end():]
        matches = [(component, match) for component, pattern in _INLINE.items()
                   for match in pattern.finditer(tail)]
        if len(matches) != 1:
            continue
        component, match = matches[0]
        if any(name != component and pattern.search(tail) for name, pattern in _INLINE.items()):
            continue
        facts.append(_fact(
            component, match.group("value"), match.group("unit"), [("line", line)],
            stage=stage, entity_key=entity_key.strip(),
        ))
    return facts


def extract_heat_load_table(
    group_header: dict[str, Any], columns: list[dict[str, dict[str, Any]]],
    *, stage: str, entity_key: str,
) -> list[dict[str, Any]]:
    """Read aligned columns under an explicit thermal heading and shared unit.

    ``columns`` are pairs of original header and value cells. Their alignment
    must already have been checked against PDF/table geometry by the caller.
    Unrecognized, missing, and total columns produce no component fact.
    """
    _context(stage, entity_key)
    header = _cell(group_header)
    if not isinstance(columns, list):
        raise ValueError("heat-load columns must be an array")
    if re.search(r"электрическ", header["text"], re.IGNORECASE):
        return []
    heading_text = re.sub(r"\s+", " ", header["text"]).strip()
    heading = _THERMAL_HEADING.search(heading_text)
    if heading is None:
        return []
    trailing_unit = re.search(_UNIT, heading_text[heading.end():heading.end() + 70], re.IGNORECASE)
    raw_unit = heading.group("unit") or (trailing_unit.group(0) if trailing_unit else None)
    if raw_unit is None:
        return []
    facts = []
    for column in columns:
        if not isinstance(column, dict) or set(column) != {"header", "value"}:
            raise ValueError("heat-load column requires header and value cells")
        label = _cell(column["header"])
        value = _cell(column["value"])
        if any((item["sourceFileId"], item["inputSha256"], item["pageNumber"])
               != (header["sourceFileId"], header["inputSha256"], header["pageNumber"])
               for item in (label, value)):
            raise ValueError("heat-load table cells must share source and page")
        component = _component_from_table_header(label["text"])
        number = _VALUE_ONLY.fullmatch(value["text"])
        if component is None or number is None:
            continue
        facts.append(_fact(
            component, number.group("value"), raw_unit,
            [("thermalHeading", header), ("componentHeader", label), ("valueCell", value)],
            stage=stage, entity_key=entity_key.strip(),
        ))
    return facts


def compare_heat_load_components(
    pd_facts: list[dict[str, Any]], rd_facts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare like-for-like components; never declare a finding or total.

    Same subset on each side permits only component deltas. It does not prove
    the subset is exhaustive or that either document's overall total is valid.
    """
    if not isinstance(pd_facts, list) or not isinstance(rd_facts, list):
        raise ValueError("PZ-017 facts must be arrays")
    indexed: dict[str, dict[str, dict[str, Any]]] = {}
    for stage, facts in (("PD", pd_facts), ("RD", rd_facts)):
        by_component: dict[str, dict[str, Any]] = {}
        for fact in facts:
            if (not isinstance(fact, dict) or fact.get("parameterCode") != "PZ-017"
                    or fact.get("extractionProfile") != "pz-017-heat-components-v1"
                    or fact.get("stage") != stage or fact.get("component") not in _COMPONENT_LABELS
                    or fact.get("canonicalUnit") not in {"kW", "Gcal/h"}
                    or not isinstance(fact.get("entityKey"), str)
                    or not isinstance(fact.get("evidence"), list) or not fact["evidence"]):
                raise ValueError("PZ-017 comparison fact is invalid")
            evidence = fact["evidence"]
            try:
                value_evidence = _cell(evidence[-1])
                normalized, canonical_unit = _numeric(fact["rawValue"], fact["rawUnit"])
            except (KeyError, TypeError) as error:
                raise ValueError("PZ-017 comparison fact has incomplete evidence") from error
            if (value_evidence["sourceFileId"] != fact.get("sourceFileId")
                    or value_evidence["inputSha256"] != fact.get("inputSha256")
                    or value_evidence["pageNumber"] != fact.get("pageNumber")
                    or value_evidence["blockIndex"] != fact.get("blockIndex")
                    or value_evidence["lineIndex"] != fact.get("lineIndex")
                    or fact["rawValue"] not in value_evidence["text"]
                    or normalized != fact.get("normalizedValue")
                    or canonical_unit != fact["canonicalUnit"]):
                raise ValueError("PZ-017 comparison fact differs from its raw evidence")
            component = fact["component"]
            if component in by_component:
                return _abstain("DUPLICATE_COMPONENT")
            by_component[component] = fact
        indexed[stage] = by_component
    pd = indexed["PD"]
    rd = indexed["RD"]
    if not pd or not rd:
        return _abstain("MISSING_COMPONENT_EVIDENCE")
    if set(pd) != set(rd):
        return _abstain("COMPONENT_BASIS_MISMATCH", pdComponents=sorted(pd), rdComponents=sorted(rd))
    entities = {fact["entityKey"] for fact in [*pd.values(), *rd.values()]}
    if len(entities) != 1:
        return _abstain("ENTITY_BASIS_MISMATCH")
    comparisons = []
    for component in sorted(pd):
        expected = pd[component]
        actual = rd[component]
        if expected["canonicalUnit"] != actual["canonicalUnit"]:
            return _abstain("UNIT_BASIS_MISMATCH")
        try:
            pd_value = Decimal(expected["normalizedValue"])
            rd_value = Decimal(actual["normalizedValue"])
        except (InvalidOperation, KeyError, TypeError) as error:
            raise ValueError("PZ-017 normalized value is invalid") from error
        if not pd_value.is_finite() or not rd_value.is_finite():
            raise ValueError("PZ-017 normalized value must be finite")
        comparisons.append({
            "component": component,
            "canonicalUnit": expected["canonicalUnit"],
            "pdValue": format(pd_value, "f"),
            "rdValue": format(rd_value, "f"),
            "delta": format(rd_value - pd_value, "f"),
            "pdEvidence": expected["evidence"],
            "rdEvidence": actual["evidence"],
        })
    return {
        "schemaVersion": "pz-017-component-comparison-v1",
        "parameterCode": "PZ-017",
        "disposition": "COMPONENTS_COMPARABLE",
        "entityKey": entities.pop(),
        "componentBasis": sorted(pd),
        "comparisons": comparisons,
        "totalComparable": False,
        "finding": None,
    }


def _abstain(reason: str, **details: Any) -> dict[str, Any]:
    return {
        "schemaVersion": "pz-017-component-comparison-v1",
        "parameterCode": "PZ-017",
        "disposition": "ABSTAIN",
        "reasonCode": reason,
        "totalComparable": False,
        "finding": None,
        **details,
    }
