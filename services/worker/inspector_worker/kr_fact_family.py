"""Conservative KR-055/058/059 proposals from committed document text.

This extractor never links PD and RD elements or emits a finding. Its only
cross-block association is an isolated value cell on the same physical row as
one explicit element label. Page, source, and stage provenance stay attached.
"""

from __future__ import annotations

import re
from typing import Any

from .fact_comparison import make_fact_id
from .parameter_routing import _validate_artifact


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_CLASS = re.compile(r"(?<![\w])([BВ][1-9][0-9]?)(?!(?:[.,]\d)|\d)")
_THICKNESS = re.compile(
    r"(?<!\d[ \u00a0])(?<!\d)([1-9][0-9]{0,2}(?:[ \u00a0][0-9]{3})+|[1-9][0-9]{1,3})"
    r"(?!\d)\s*(мм)(?!\w)", re.I,
)
_ZONE = re.compile(r"\b(?:корпус|секция|зона)\s*(?:№\s*)?(?:[КK]?\d+[А-ЯA-Z]?|[А-ЯA-Z])\b", re.I)
_FLOOR_GROUP = re.compile(r"(?<!\d)[−-]?\d+\s*(?:и|,|/)\s*[−-]?\d+\s*этаж\w*", re.I)
_FLOOR = re.compile(r"(?<!\d)[−-]?\d+\s*(?:-?го|-?й)?\s*этаж\w*|\bподземн\w*\s+этаж\w*", re.I)
_ELEMENTS = {
    "FOUNDATION": re.compile(r"(?:фундаментн\w*\s+плит\w*|плит\w*\s+фундамент\w*|ростверк\w*)", re.I),
    "SLAB": re.compile(r"(?:плит\w*\s+(?:перекрыти\w*|покрыти\w*)|(?:перекрыти\w*|покрыти\w*)\s+плит\w*|перекрыти\w*)", re.I),
    "WALL": re.compile(r"\bстен\w*\b", re.I),
    "STAIR": re.compile(r"(?:лестниц\w*|лестнич\w*|лестничн\w*\s+марш\w*)", re.I),
}
_THICKNESS_HINT = re.compile(r"(?:толщин\w*|\bh\s*=|\bН\s*=|\bплит\w*|\bперекрыти\w*)", re.I)
_MULTI_THICKNESS = re.compile(
    r"(?<!\d)\d{2,4}\s*(?:мм\s*)?(?:и|или|/|,|;)\s*\d{2,4}\s*мм\b", re.I,
)
_OTHER_ELEMENT = re.compile(
    r"(?:бетонн\w*\s+подготовк\w*|тощ\w*\s+бетон\w*|\bкроме\b)", re.I,
)
_OTHER_DIMENSION = re.compile(r"(?:\bшаг\w*|\bрасстоян\w*|\bарматур\w*)", re.I)
_THICKNESS_MEASURE = re.compile(r"(?:толщин\w*|\b[hHНн]\s*=)", re.I)
_BUILDING_HEADER = re.compile(r"^\s*корпус\s+(?:[КK]?\d+[А-ЯA-Z]?)\b", re.I)
_ROW_CLASS = re.compile(r"\s*[BВ][1-9][0-9]?\s*[,;.]?\s*\Z")
_ROW_THICKNESS = re.compile(
    r"\s*(?:[1-9][0-9]{0,2}(?:[ \u00a0][0-9]{3})+|[1-9][0-9]{1,3})"
    r"\s*мм\s*[.;]?\s*\Z", re.I,
)
_WALL_THICKNESS_LIST = re.compile(
    r"(?<!\w)толщин\w*\s+(?:ж\s*/\s*б\s+)?монолитн\w*\s+стен\w*\s+"
    r"(?P<values>(?:[1-9][0-9]{1,3}\s*мм\s*,\s*)+[1-9][0-9]{1,3}\s*мм)", re.I,
)


def _element_type(text: str) -> str | None:
    found = [name for name, pattern in _ELEMENTS.items() if pattern.search(text)]
    # A compound mention such as "foundation slab and floor slab" is not one element.
    return found[0] if len(found) == 1 else None


def _scope(text: str) -> dict[str, str] | None:
    zones = list(dict.fromkeys(match.group(0).strip() for match in _ZONE.finditer(text)))
    floors = list(dict.fromkeys(match.group(0).strip() for match in _FLOOR_GROUP.finditer(text)))
    if not floors:
        floors = list(dict.fromkeys(match.group(0).strip() for match in _FLOOR.finditer(text)))
    if len(zones) > 1 or len(floors) > 1:
        return None
    return {**({"zone": zones[0]} if zones else {}), **({"floor": floors[0]} if floors else {})}


def _stage(source: dict[str, Any], page_number: int) -> str | None:
    stages = source["stages"]
    if len(stages) == 1:
        return stages[0]
    # pageStages comes from the frozen, reviewed source-decision projection.
    mapped = source.get("pageStages", {}).get(str(page_number))
    return mapped if mapped in stages else None


def _locator(block: dict[str, Any], block_index: int, start: int, end: int) -> dict[str, Any]:
    return {
        "kind": "TEXT_BLOCK", "blockIndex": block_index,
        "start": start, "end": end,
        "bboxMilliPoints": block["bboxMilliPoints"],
    }


def _fact(
    object_id: str, source: dict[str, Any], page_number: int, stage: str,
    block: dict[str, Any], block_index: int, match: re.Match[str],
    attribute: str, element_type: str, context: dict[str, str],
    *, context_block: dict[str, Any] | None = None,
    context_block_index: int | None = None,
) -> dict[str, Any]:
    raw_value = match.group(1)
    fact: dict[str, Any] = {
        "schemaVersion": "typed-fact-v1",
        "parameterCode": {
            "CONCRETE_CLASS": "KR-055",
            "FOUNDATION_THICKNESS": "KR-058",
            "SLAB_THICKNESS": "KR-059",
        }[attribute],
        "objectId": object_id, "attribute": attribute, "stage": stage,
        "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
        "pageNumber": page_number, "rawText": block["text"],
        "rawValue": raw_value,
        "rawUnit": raw_value[0] if attribute == "CONCRETE_CLASS" else match.group(2),
        "locator": _locator(block, block_index, match.start(1), match.end(1)),
        "elementType": element_type,
        **context,
    }
    if context_block is not None and context_block_index is not None:
        fact["contextLocator"] = {
            **_locator(context_block, context_block_index, 0, len(context_block["text"])),
            "text": context_block["text"],
        }
    fact["factId"] = make_fact_id(fact)
    return fact


def _line_spans(text: str) -> list[tuple[str, int]]:
    return [(match.group(0), match.start()) for match in re.finditer(r"[^\r\n]+", text)
            if match.group(0).strip()]


def _line_scope(lines: list[tuple[str, int]], index: int) -> dict[str, str] | None:
    """Read local scope only; later table rows cannot scope an earlier value."""
    local = _scope(lines[index][0])
    if local is None:
        return None
    if index > 0 and _BUILDING_HEADER.search(lines[0][0]):
        header = _scope(lines[0][0])
        if header is None or ("zone" in header and "zone" in local
                              and header["zone"] != local["zone"]):
            return None
        return {**header, **local}
    return local


def _element_before_value(line: str, element: str, value_start: int) -> bool:
    return any(match.end() <= value_start for match in _ELEMENTS[element].finditer(line))


def _thickness_claim(line: str, element: str, value_start: int) -> bool:
    if _OTHER_ELEMENT.search(line) or _OTHER_DIMENSION.search(line):
        return False
    before = line[:value_start]
    if _THICKNESS_MEASURE.search(before):
        return _element_before_value(line, element, value_start)
    # A bare dimension is admissible only immediately after an element label,
    # optionally followed by an explicit floor and a separating dash.
    for label in _ELEMENTS[element].finditer(line):
        if label.end() > value_start:
            continue
        between = before[label.end():]
        between = _FLOOR_GROUP.sub("", between)
        between = _FLOOR.sub("", between)
        if re.fullmatch(r"[\s:—–\-+.,]*", between):
            return True
    return False


def _same_block_facts(
    object_id: str, source: dict[str, Any], page_number: int, stage: str,
    block: dict[str, Any], block_index: int,
) -> list[dict[str, Any]]:
    text = block["text"]
    result: list[dict[str, Any]] = []
    lines = _line_spans(text)
    multi_row_classes = len(lines) > 2 and sum(len(_CLASS.findall(line)) for line, _ in lines) > 1
    for line_index, (line, offset) in enumerate(lines):
        element = _element_type(line)
        scope = _line_scope(lines, line_index)
        if element is None or scope is None or _OTHER_ELEMENT.search(line):
            continue
        classes = list(_CLASS.finditer(line))
        thicknesses = list(_THICKNESS.finditer(line))
        if (not multi_row_classes and len(classes) == 1
                and _element_before_value(line, element, classes[0].start(1))):
            match = classes[0]
            shifted = _shifted_match(_CLASS, text, offset + match.start(1))
            if shifted is not None:
                result.append(_fact(object_id, source, page_number, stage, block, block_index,
                                    shifted, "CONCRETE_CLASS", element, scope))
        if (element in {"FOUNDATION", "SLAB"} and len(thicknesses) == 1
                and not _MULTI_THICKNESS.search(line)
                and _thickness_claim(line, element, thicknesses[0].start(1))):
            match = thicknesses[0]
            shifted = _shifted_match(_THICKNESS, text, offset + match.start(1))
            if shifted is not None:
                attribute = "FOUNDATION_THICKNESS" if element == "FOUNDATION" else "SLAB_THICKNESS"
                result.append(_fact(object_id, source, page_number, stage, block, block_index,
                                    shifted, attribute, element, scope))
    # document-text-v2 has one bbox per block, not per line. Distinct lines in
    # a merged block therefore cannot establish a table row association.
    return result


def _shifted_match(pattern: re.Pattern[str], text: str, value_start: int) -> re.Match[str] | None:
    """Find exact token in full block; keep offsets stable for immutable locator."""
    return next((match for match in pattern.finditer(text) if match.start(1) == value_start), None)


def _same_row(a: list[int], b: list[int]) -> bool:
    height_a, height_b = a[3] - a[1], b[3] - b[1]
    overlap = min(a[3], b[3]) - max(a[1], b[1])
    return (0 < height_a <= 30_000 and 0 < height_b <= 30_000
            and overlap * 2 >= min(height_a, height_b))


def _row_facts(
    object_id: str, source: dict[str, Any], page_number: int, stage: str,
    blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for value_index, value_block in enumerate(blocks):
        value = value_block["text"].strip()
        attribute: str | None = None
        match: re.Match[str] | None = None
        if _ROW_CLASS.fullmatch(value):
            attribute = "CONCRETE_CLASS"
            match = _CLASS.search(value_block["text"])
        elif _ROW_THICKNESS.fullmatch(value):
            match = _THICKNESS.search(value_block["text"])
        if match is None:
            continue
        value_box = value_block["bboxMilliPoints"]
        labels = [(index, block, _element_type(block["text"]))
                  for index, block in enumerate(blocks)
                  if index != value_index and "\n" not in block["text"]
                  and block["bboxMilliPoints"][2] <= value_box[0]
                  and value_box[0] - block["bboxMilliPoints"][2] <= 300_000
                  and _same_row(block["bboxMilliPoints"], value_box)]
        labels = [(index, block, element) for index, block, element in labels
                  if element and not _OTHER_ELEMENT.search(block["text"])]
        if len(labels) != 1:
            continue
        label_index, label_block, element = labels[0]
        if attribute is None:
            if element not in {"FOUNDATION", "SLAB"} or not _THICKNESS_HINT.search(label_block["text"]):
                continue
            attribute = "FOUNDATION_THICKNESS" if element == "FOUNDATION" else "SLAB_THICKNESS"
        # A second cell between label and value makes this row's association unsafe.
        if any(index not in {label_index, value_index}
               and label_block["bboxMilliPoints"][2] < block["bboxMilliPoints"][0]
               and block["bboxMilliPoints"][2] < value_box[0]
               and _same_row(block["bboxMilliPoints"], value_box)
               for index, block in enumerate(blocks)):
            continue
        scope = _scope(label_block["text"])
        if scope is None:
            continue
        result.append(_fact(object_id, source, page_number, stage, value_block, value_index,
                            match, attribute, element, scope,
                            context_block=label_block, context_block_index=label_index))
    return result


def extract_kr_facts(
    object_id: str,
    sources: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return source-local typed proposals; no element matching or verdict."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("KR objectId is required")
    if not isinstance(sources, list) or not isinstance(artifacts, list):
        raise ValueError("KR sources and artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("KR source metadata must be an object")
        source_id, sha, stages = source.get("sourceFileId"), source.get("sha256"), source.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in source_index
                or not isinstance(sha, str) or _HASH.fullmatch(sha) is None
                or not isinstance(stages, list) or not stages
                or len(set(stages)) != len(stages)
                or any(stage not in {"PD", "RD", "ID"} for stage in stages)):
            raise ValueError("KR source metadata is invalid")
        mapping = source.get("pageStages", {})
        if not isinstance(mapping, dict) or any(
            not isinstance(key, str) or not key.isdecimal() or str(int(key)) != key
            or int(key) < 1 or (value not in stages and value != "UNRESOLVED")
            for key, value in mapping.items()
        ) or (len(stages) == 1 and mapping):
            raise ValueError("KR pageStages are invalid")
        source_index[source_id] = source
    output: list[dict[str, Any]] = []
    seen_artifacts: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ValueError("KR text artifact must be an object")
        source_id = artifact.get("sourceFileId")
        if source_id not in source_index or source_id in seen_artifacts:
            raise ValueError("KR text artifact has unknown or duplicate source")
        seen_artifacts.add(source_id)
        source = source_index[source_id]
        _validate_artifact(artifact, source)
        if source.get("objectId") != object_id:
            continue
        if any(int(number) > artifact["pageCount"] for number in source.get("pageStages", {})):
            raise ValueError("KR pageStages exceed artifact page count")
        for page in artifact["pages"]:
            stage = _stage(source, page["pageNumber"])
            if stage is None or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                continue
            for index, block in enumerate(page["blocks"]):
                output.extend(_same_block_facts(object_id, source, page["pageNumber"], stage, block, index))
            output.extend(_row_facts(object_id, source, page["pageNumber"], stage, page["blocks"]))
    unique = {fact["factId"]: fact for fact in output}
    return sorted(unique.values(), key=lambda fact: (
        fact["sourceFileId"], fact["pageNumber"], fact["locator"]["blockIndex"],
        fact["locator"]["start"], fact["parameterCode"],
    ))


def extract_kr061_wall_list_observations(
    object_id: str,
    sources: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Record generic monolithic-wall thickness lists for review only.

    A list does not identify any core, shaft wall, or pylon. Its numbers must
    never become KR-061 typed facts or enter a PD/RD comparison automatically.
    """
    # Reuse the pinned source and document-text-v2 validation. Other KR facts
    # returned by this call are intentionally irrelevant to these observations.
    extract_kr_facts(object_id, sources, artifacts)
    source_index = {source["sourceFileId"]: source for source in sources}
    observations: list[dict[str, Any]] = []
    for artifact in artifacts:
        source = source_index[artifact["sourceFileId"]]
        if source.get("objectId") != object_id:
            continue
        for page in artifact["pages"]:
            stage = _stage(source, page["pageNumber"])
            if stage is None or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                continue
            for block_index, block in enumerate(page["blocks"]):
                matches = list(_WALL_THICKNESS_LIST.finditer(block["text"]))
                if len(matches) != 1:
                    continue
                match = matches[0]
                values_text = match.group("values")
                values = list(_THICKNESS.finditer(block["text"], match.start("values"), match.end("values")))
                if len(values) < 2 or not re.fullmatch(r"[\s,]*", _THICKNESS.sub("", values_text)):
                    continue
                row: dict[str, Any] = {
                    "schemaVersion": "kr061-wall-thickness-list-observation-v1",
                    "parameterCode": "KR-061", "objectId": object_id,
                    "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
                    "stage": stage, "pageNumber": page["pageNumber"],
                    "rawText": block["text"], "elementScope": "MONOLITHIC_WALLS_UNLINKED",
                    "disposition": "OBSERVATION_ONLY",
                    "values": [{"rawValue": value.group(1), "rawUnit": value.group(2),
                                "locator": _locator(block, block_index, value.start(1), value.end(1))}
                               for value in values],
                }
                row["observationId"] = make_fact_id(row)
                observations.append(row)
                if len(observations) > 64:
                    raise ValueError("KR-061 observation count exceeds safe bound")
    return sorted(observations, key=lambda row: (
        row["sourceFileId"], row["pageNumber"],
        row["values"][0]["locator"]["blockIndex"],
    ))
