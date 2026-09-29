"""Text-layer fact proposals for PZ-004 and PZ-007, plus a PZ-010 probe.

Each proposal points to one exact value span in a committed document-text-v2
block. Cross-block rows additionally retain the label and unit cell anchors.
No proposal certifies building scope, source revision, a PD/RD link, or a finding.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from .fact_comparison import make_fact_id
from .parameter_routing import _validate_artifact


_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_NUMBER = r"(?<![\d.,])(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d+)?(?![\d.,])"
_VOLUME_LABEL = re.compile(
    r"(?:строительн\w*\s+)?об[ъь]?[её]м\s+(?:здания|по\s+зданию)\b"
    r"|строительн\w*\s+об[ъь]?[её]м\b", re.I,
)
_VOLUME_UNIT = re.compile(r"(?:тыс\.?\s*)?(?:м\s*[³3]|куб\.?\s*м)(?![\w])", re.I)
_FLOOR_LABEL = re.compile(
    r"этажность(?:\s+здания)?\b|(?:количество|число)\s+надземных\s+этажей\b"
    r"|надземных\s+этажей\b", re.I,
)
_FLOOR_VALUE = re.compile(r"(?<!\d)(?P<value>\d{1,2})(?!\d)")
_FLOOR_SUFFIX = re.compile(r"(?:этаж(?:а|ей)?|эт\.)(?![\w])", re.I)
_BASEMENT = re.compile(r"\+\s*(?:подвал\w*|цоколь\w*(?:\s+этаж\w*)?|подземн\w*\s+этаж\w*)", re.I)
_SUBPART = re.compile(r"\b(?:надземн\w*|подземн\w*|цокольн\w*|подвал\w*)\s+(?:част\w*|об[ъь]?[её]м\w*)\b", re.I)
_BUILDING_CODE = re.compile(r"\b(?:корпус|здание)\s*[№#-]?\s*(?:[КK]\s*[-]?\s*)?\d+\b|\b[КK]\s*[-]?\s*\d+\b", re.I)
_MULTIPLE_BUILDINGS = re.compile(r"\b\d+\s*/\s*\d+\b|\b[КK]\s*\d+\s*/\s*(?:[КK]\s*)?\d+\b", re.I)
_APARTMENT_LABEL = re.compile(r"количество\s+квартир\b", re.I)
_APARTMENT_UNIT = re.compile(r"(?:кв\.|шт\.)", re.I)
_TOTAL_HEADER = re.compile(r"^\s*(всего)\s*:", re.I)
_INTEGER_CELL = re.compile(r"\s*(\d{1,6})\s*\Z")
_STAGES = {"PD", "RD", "ID"}
_MAX_FACTS = 512


def _anchor(block: dict[str, Any], index: int, start: int, end: int) -> dict[str, Any]:
    return {
        "kind": "TEXT_BLOCK", "blockIndex": index, "start": start, "end": end,
        "bboxMilliPoints": block["bboxMilliPoints"],
    }


def _cell_anchor(block: dict[str, Any], index: int, start: int, end: int) -> dict[str, Any]:
    return {**_anchor(block, index, start, end), "text": block["text"]}


def _number_valid(raw: str) -> bool:
    try:
        value = Decimal(raw.replace(" ", "").replace("\u00a0", "").replace(",", "."))
    except InvalidOperation:
        return False
    return value.is_finite() and value > 0


def _stage(source: dict[str, Any], page_number: int) -> str | None:
    stages = source["stages"]
    if len(stages) == 1:
        return stages[0]
    return source.get("pageStages", {}).get(str(page_number))


def _has_ambiguous_building_scope(page: dict[str, Any], block: dict[str, Any]) -> bool:
    if _BUILDING_CODE.search(block["text"]) or _MULTIPLE_BUILDINGS.search(block["text"]):
        return True
    codes = {
        match.group().casefold().replace(" ", "")
        for item in page["blocks"] for match in _BUILDING_CODE.finditer(item["text"])
    }
    return len(codes) > 1 or any(_MULTIPLE_BUILDINGS.search(item["text"]) for item in page["blocks"])


def _row_overlap(left: list[int], right: list[int]) -> bool:
    height = min(left[3] - left[1], right[3] - right[1])
    return height > 0 and min(left[3], right[3]) - max(left[1], right[1]) >= height / 2


def _overlap_fraction(left: list[int], right: list[int]) -> float:
    height = min(left[3] - left[1], right[3] - right[1])
    if height <= 0:
        return 0
    return max(0, min(left[3], right[3]) - max(left[1], right[1])) / height


def _emit(
    object_id: str, source: dict[str, Any], page: dict[str, Any], stage: str,
    block_index: int, start: int, end: int, raw_unit: str,
    parameter: str, attribute: str, *,
    label_anchor: dict[str, Any] | None = None,
    unit_anchor: dict[str, Any] | None = None,
    context_anchor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    block = page["blocks"][block_index]
    fact = {
        "schemaVersion": "typed-fact-v1", "parameterCode": parameter,
        "objectId": object_id, "attribute": attribute, "stage": stage,
        "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
        "pageNumber": page["pageNumber"], "rawText": block["text"],
        "rawValue": block["text"][start:end], "rawUnit": raw_unit,
        "locator": _anchor(block, block_index, start, end),
    }
    if label_anchor is not None:
        fact["labelLocator"] = label_anchor
    if unit_anchor is not None:
        fact["unitLocator"] = unit_anchor
    if context_anchor is not None:
        fact["contextLocator"] = context_anchor
    return {"factId": make_fact_id(fact), **fact}


def _inline_volume(
    object_id: str, source: dict[str, Any], page: dict[str, Any], stage: str,
    index: int,
) -> list[dict[str, Any]]:
    text = page["blocks"][index]["text"]
    labels = list(_VOLUME_LABEL.finditer(text))
    facts = []
    for label_index, label in enumerate(labels):
        segment_end = labels[label_index + 1].start() if label_index + 1 < len(labels) else len(text)
        segment = text[label.end():min(segment_end, label.end() + 160)]
        candidates: list[tuple[int, int, str]] = []
        for number in re.finditer(_NUMBER, segment):
            if not _number_valid(number.group()):
                continue
            after = _VOLUME_UNIT.match(segment, number.end())
            if after is None:
                after = re.match(r"\s*", segment[number.end():])
                unit = _VOLUME_UNIT.match(segment, number.end() + len(after.group())) if after else None
            else:
                unit = after
            if unit is not None and unit.end() > unit.start():
                between = segment[:number.start()]
                if not _SUBPART.search(between):
                    candidates.append((label.end() + number.start(), label.end() + number.end(), unit.group()))
                continue
            before = list(_VOLUME_UNIT.finditer(segment[:number.start()]))
            if before and not _SUBPART.search(segment[:number.start()]):
                unit = before[-1]
                if not segment[unit.end():number.start()].strip(" \t\n:=;.,"):
                    candidates.append((label.end() + number.start(), label.end() + number.end(), unit.group()))
        for start, end, unit in candidates:
            facts.append(_emit(object_id, source, page, stage, index, start, end,
                               unit, "PZ-004", "BUILDING_VOLUME"))
    return facts


def _floor_value(text: str, offset: int) -> tuple[int, int] | None:
    suffix = text[offset:offset + 80]
    found = _FLOOR_VALUE.search(suffix)
    if found is None or found.start() > 35:
        return None
    before = suffix[:found.start()]
    if re.search(r"[^\s:;,.=–—-]", before):
        return None
    trailing = suffix[found.end():]
    if re.match(r"\s*[/–—-]\s*\d", trailing):
        return None
    if re.match(r"\s*\+", trailing) and _BASEMENT.match(trailing.lstrip()) is None:
        return None
    value = int(found.group("value"))
    if value < 1 or value > 99:
        return None
    return offset + found.start("value"), offset + found.end("value")


def _floor_unit(text: str, label: re.Match[str], end: int) -> str:
    suffix = _FLOOR_SUFFIX.match(text[end:].lstrip())
    if suffix:
        return suffix.group()
    label_unit = re.search(r"этажей\b", label.group(), re.I)
    return label_unit.group() if label_unit else label.group()


def _inline_floors(
    object_id: str, source: dict[str, Any], page: dict[str, Any], stage: str,
    index: int,
) -> list[dict[str, Any]]:
    text = page["blocks"][index]["text"]
    facts = []
    for label in _FLOOR_LABEL.finditer(text):
        span = _floor_value(text, label.end())
        if span is None:
            continue
        start, end = span
        facts.append(_emit(object_id, source, page, stage, index, start, end,
                           _floor_unit(text, label, end), "PZ-007", "ABOVE_GROUND_FLOOR_COUNT"))
    return facts


def _row_facts(
    object_id: str, source: dict[str, Any], page: dict[str, Any], stage: str,
) -> list[dict[str, Any]]:
    """Pair only unique single-line cells on the same geometric row."""
    blocks = page["blocks"]
    facts = []
    for label_index, label_block in enumerate(blocks):
        label_text = label_block["text"]
        if "\n" in label_text or _has_ambiguous_building_scope(page, label_block):
            continue
        volume_label = _VOLUME_LABEL.search(label_text)
        floor_label = _FLOOR_LABEL.search(label_text)
        if volume_label is None and floor_label is None:
            continue
        if re.search(r"\d", label_text):
            continue
        label_box = label_block["bboxMilliPoints"]
        peers = [(index, block) for index, block in enumerate(blocks)
                 if index != label_index and "\n" not in block["text"]
                 and block["bboxMilliPoints"][0] > label_box[2]
                 and _row_overlap(label_box, block["bboxMilliPoints"])]
        label_anchor = _cell_anchor(label_block, label_index,
                                    (volume_label or floor_label).start(),
                                    (volume_label or floor_label).end())
        if volume_label is not None:
            units = [(index, block, match) for index, block in peers
                     if (match := _VOLUME_UNIT.fullmatch(block["text"].strip()))]
            values = [(index, block, match) for index, block in peers
                      if (match := re.fullmatch(r"\s*(" + _NUMBER + r")\s*", block["text"]))
                      and _number_valid(match.group(1))]
            if len(units) != 1 or len(values) != 1:
                continue
            unit_index, unit_block, unit_match = units[0]
            value_index, value_block, value_match = values[0]
            unit_box, value_box = unit_block["bboxMilliPoints"], value_block["bboxMilliPoints"]
            if not _row_overlap(unit_box, value_box) or not (unit_box[2] < value_box[0] or value_box[2] < unit_box[0]):
                continue
            unit_start = unit_block["text"].find(unit_match.group())
            facts.append(_emit(
                object_id, source, page, stage, value_index,
                value_match.start(1), value_match.end(1), unit_match.group(),
                "PZ-004", "BUILDING_VOLUME", label_anchor=label_anchor,
                unit_anchor=_cell_anchor(unit_block, unit_index,
                                         unit_start, unit_start + len(unit_match.group())),
            ))
        elif floor_label is not None:
            values = [(index, block, _floor_value(block["text"], 0)) for index, block in peers]
            values = [(index, block, span) for index, block, span in values
                      if span is not None and not re.search(r"[^\s\d+а-яё.-]", block["text"], re.I)]
            if len(values) != 1:
                continue
            value_index, value_block, (start, end) = values[0]
            raw_unit = _floor_unit(value_block["text"], floor_label, end)
            unit_anchor = None
            if raw_unit not in value_block["text"]:
                unit_start = label_text.find(raw_unit, floor_label.start())
                unit_anchor = _cell_anchor(label_block, label_index,
                                           unit_start, unit_start + len(raw_unit))
            facts.append(_emit(
                object_id, source, page, stage, value_index, start, end,
                raw_unit, "PZ-007", "ABOVE_GROUND_FLOOR_COUNT",
                label_anchor=label_anchor, unit_anchor=unit_anchor,
            ))
    return facts


def _apartment_total_row(
    object_id: str, source: dict[str, Any], page: dict[str, Any], stage: str,
) -> dict[str, Any] | None:
    """Anchor a printed total to its label, unit, and 'Всего' column."""
    blocks = page["blocks"]
    labels = [(index, block, match) for index, block in enumerate(blocks)
              if (match := _APARTMENT_LABEL.search(block["text"]))]
    if len(labels) != 1:
        return None
    label_index, label_block, label_match = labels[0]
    label_box = label_block["bboxMilliPoints"]
    units = [(index, block, match) for index, block in enumerate(blocks)
             if (match := _APARTMENT_UNIT.fullmatch(block["text"].strip()))
             and label_box[2] < block["bboxMilliPoints"][0]
             and _overlap_fraction(label_box, block["bboxMilliPoints"]) >= 0.5]
    if len(units) != 1:
        return None
    unit_index, unit_block, unit_match = units[0]
    unit_box = unit_block["bboxMilliPoints"]
    headers = [(index, block, match) for index, block in enumerate(blocks)
               if (match := _TOTAL_HEADER.search(block["text"]))
               and unit_box[2] < block["bboxMilliPoints"][0]
               and _overlap_fraction(label_box, block["bboxMilliPoints"]) >= 0.25]
    if len(headers) != 1:
        return None
    header_index, header_block, header_match = headers[0]
    header_box = header_block["bboxMilliPoints"]
    values = []
    for index, block in enumerate(blocks):
        match = _INTEGER_CELL.fullmatch(block["text"])
        if match is None or int(match.group(1)) < 1:
            continue
        box = block["bboxMilliPoints"]
        if (box[0] < header_box[0] or box[2] > header_box[0] + (header_box[2] - header_box[0]) // 2
                or _overlap_fraction(label_box, box) < 0.25
                or not 0 <= header_box[1] - box[3] <= 30_000):
            continue
        values.append((index, block, match))
    if len(values) != 1:
        return None
    value_index, _, value_match = values[0]
    raw_unit = unit_match.group()
    unit_start = unit_block["text"].find(raw_unit)
    return _emit(
        object_id, source, page, stage, value_index,
        value_match.start(1), value_match.end(1), raw_unit,
        "PZ-010", "APARTMENT_COUNT",
        label_anchor=_cell_anchor(label_block, label_index, label_match.start(), label_match.end()),
        unit_anchor=_cell_anchor(unit_block, unit_index, unit_start, unit_start + len(raw_unit)),
        context_anchor=_cell_anchor(header_block, header_index,
                                    header_match.start(1), header_match.end(1)),
    )


def extract_pz010_observations(
    object_id: str, source: dict[str, Any], artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return PZ-010 source-local proposals, without comparison or coverage."""
    if not isinstance(object_id, str) or not object_id.strip() or not isinstance(source, dict):
        raise ValueError("PZ-010 source object is invalid")
    source_id, sha, stages = source.get("sourceFileId"), source.get("sha256"), source.get("stages")
    if (not isinstance(source_id, str) or not source_id
            or not isinstance(sha, str) or _SHA256.fullmatch(sha) is None
            or source.get("objectId") != object_id
            or not isinstance(stages, list) or not stages
            or any(not isinstance(stage, str) or stage not in _STAGES for stage in stages)
            or len(set(stages)) != len(stages)):
        raise ValueError("PZ-010 source identity, object or stage is invalid")
    mapping = source.get("pageStages", {})
    if (not isinstance(mapping, dict) or (len(stages) == 1 and mapping)
            or any(not isinstance(key, str) or not key.isdecimal() or str(int(key)) != key
                   or int(key) < 1 or value not in {*stages, "UNRESOLVED"}
                   for key, value in mapping.items())):
        raise ValueError("PZ-010 pageStages are invalid")
    if not isinstance(artifact, dict):
        raise ValueError("PZ-010 text artifact must be an object")
    _validate_artifact(artifact, source)
    if any(int(page) > artifact["pageCount"] for page in mapping):
        raise ValueError("PZ-010 pageStages exceed page count")
    observations = []
    for page in artifact["pages"]:
        stage = _stage(source, page["pageNumber"])
        if stage not in _STAGES or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        fact = _apartment_total_row(object_id, source, page, stage)
        if fact is not None:
            observations.append(fact)
        if len(observations) > _MAX_FACTS:
            raise ValueError("PZ-010 observation count exceeds safe bound")
    return sorted(observations, key=lambda fact: (fact["pageNumber"], fact["factId"]))


def extract_pz_facts(
    object_id: str, sources: list[dict[str, Any]], artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return source-anchored proposals. Missing/OCR pages make no absence claim."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("PZ fact objectId is required")
    if not isinstance(sources, list) or not isinstance(artifacts, list):
        raise ValueError("PZ fact sources and artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("PZ fact source must be an object")
        source_id, sha, stages = source.get("sourceFileId"), source.get("sha256"), source.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in source_index
                or not isinstance(sha, str) or _SHA256.fullmatch(sha) is None
                or source.get("objectId") != object_id
                or not isinstance(stages, list) or not stages
                or any(not isinstance(stage, str) or stage not in _STAGES for stage in stages)
                or len(set(stages)) != len(stages)):
            raise ValueError("PZ fact source identity, object or stage is invalid")
        mapping = source.get("pageStages", {})
        if (not isinstance(mapping, dict) or (len(stages) == 1 and mapping)
                or any(not isinstance(key, str) or not key.isdecimal() or str(int(key)) != key
                       or int(key) < 1 or value not in {*stages, "UNRESOLVED"}
                       for key, value in mapping.items())):
            raise ValueError("PZ fact pageStages are invalid")
        source_index[source_id] = source
    seen_artifacts: set[str] = set()
    facts: list[dict[str, Any]] = []
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ValueError("PZ fact artifact must be an object")
        source_id = artifact.get("sourceFileId")
        if source_id not in source_index or source_id in seen_artifacts:
            raise ValueError("PZ fact artifact source is missing or duplicated")
        seen_artifacts.add(source_id)
        source = source_index[source_id]
        _validate_artifact(artifact, source)
        if any(int(page) > artifact["pageCount"] for page in source.get("pageStages", {})):
            raise ValueError("PZ fact pageStages exceed page count")
        for page in artifact["pages"]:
            stage = _stage(source, page["pageNumber"])
            if stage not in _STAGES or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                continue
            for index, block in enumerate(page["blocks"]):
                if _has_ambiguous_building_scope(page, block):
                    continue
                facts.extend(_inline_volume(object_id, source, page, stage, index))
                facts.extend(_inline_floors(object_id, source, page, stage, index))
            facts.extend(_row_facts(object_id, source, page, stage))
            if len(facts) > _MAX_FACTS:
                raise ValueError("PZ fact count exceeds safe bound")
    return sorted(facts, key=lambda fact: (fact["sourceFileId"], fact["pageNumber"],
                                           fact["locator"]["blockIndex"], fact["locator"]["start"],
                                           fact["parameterCode"], fact["factId"]))
