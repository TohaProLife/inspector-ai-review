"""Draft: literal native-PDF wall concrete class, without identity or approval.

The caller authenticates the full original. This bounded parser returns exact
source fragments only. It never infers a wall, floor, role or calibrated score.
Old stair extraction remains in its existing module and is not modified.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from .concrete_prose import _lines

EXTRACTOR_VERSION = "matrix-concrete-wall-prose-v1"
_SAFE = 9007199254740991
_MAX_BYTES = 8000000
_MAX_NODES = 650000
_MAX_DEPTH = 64
_MAX_ITEMS = 32768
_HSPACE = re.compile(r"[ \t\u00a0\u202f]+")
_CLASS = r"[BВ][1-9][0-9]{0,2}(?:[.,][0-9])?"
_DIMENSION = r"[1-9][0-9]*[хx×][1-9][0-9]*мм"
_PRIMARY_TEXT = "Класс бетона по прочности на сжатие для стен "
_PRIMARY_ANCHOR = re.compile(r"класс бетона по прочности на сжатие для стен", re.I)
_SCOPE_ANCHOR = re.compile(r"толщина ж/б монолитных стен", re.I)
_PRIMARY = re.compile(
    r"(?:" + _DIMENSION + r"(?:, " + _DIMENSION + r"){0,7}\. )?"
    + re.escape(_PRIMARY_TEXT) + r"(?P<value>" + _CLASS + r")"
    + r"(?:\.| \(заполнитель - гранитный)?\Z"
)
_SCOPE = re.compile(
    r"Толщина ж/б монолитных стен [1-9][0-9]*мм"
    r"(?:, [1-9][0-9]*мм){0,15}(?:, пилоны сечением)?\Z"
)


class _NativeError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _native(value: Any) -> None:
    """Exact builtins before access; normalized finite bbox fractions are valid.

    A custom dict/list/string/number is rejected without invoking its iterator,
    conversion, attributes or serializer. The fixed budget counts object keys.
    """
    active: set[int] = set()
    nodes = 0

    def visit(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > _MAX_NODES or depth > _MAX_DEPTH:
            raise _NativeError("INPUT_LIMIT")
        kind = type(item)
        if item is None or kind is bool:
            return
        if kind is str:
            if len(item) > _MAX_BYTES:
                raise _NativeError("INPUT_LIMIT")
            if any(0xD800 <= ord(c) <= 0xDFFF for c in item):
                raise _NativeError("INVALID_INPUT")
            return
        if kind is int:
            if abs(item) > _SAFE:
                raise _NativeError("INVALID_INPUT")
            return
        if kind is float:
            if not math.isfinite(item) or abs(item) > _SAFE:
                raise _NativeError("INVALID_INPUT")
            return
        if kind not in (dict, list):
            raise _NativeError("INVALID_INPUT")
        if len(item) > _MAX_ITEMS:
            raise _NativeError("INPUT_LIMIT")
        identity = id(item)
        if identity in active:
            raise _NativeError("INVALID_INPUT")
        active.add(identity)
        if kind is dict:
            for key, child in dict.items(item):
                if type(key) is not str:
                    raise _NativeError("INVALID_INPUT")
                visit(key, depth + 1)
                visit(child, depth + 1)
        else:
            for child in item:
                visit(child, depth + 1)
        active.remove(identity)

    visit(value, 0)
    # All reachable values are now callback-free native JSON values.
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > _MAX_BYTES:
        raise _NativeError("INPUT_LIMIT")


def _clean(text: str) -> str:
    return _HSPACE.sub(" ", text).strip()


def _unique(lines: list[dict[str, Any]], anchor: re.Pattern[str]) -> dict[str, Any] | None:
    matches = [line for line in lines if anchor.search(_clean(line["rawText"]))]
    return (matches[0] if len(matches) == 1
            and sum(len(anchor.findall(_clean(line["rawText"]))) for line in lines) == 1 else None)


def _reserved_wall_fact(fact: Any) -> bool:
    """Private dispatch hint only; a marker or raw anchor never grants trust."""
    if type(fact) is not dict:
        return False
    version, text = fact.get("extractorVersion"), fact.get("rawText")
    return ((type(version) is str and version == EXTRACTOR_VERSION)
            or (type(text) is str and _PRIMARY_ANCHOR.search(_clean(text)) is not None))


def extract_concrete_wall_candidates_v1(page: Any, stage: Any) -> list[dict[str, Any]]:
    """One explicit whole-line class and one same-page native scope, or []."""
    try:
        _native(page)
    except _NativeError:
        return []
    if type(stage) is not str or stage != "RD":
        return []
    lines = _lines(page)
    if lines is None or any(len(line["rawText"]) > 100000 for line in lines):
        return []
    primary = _unique(lines, _PRIMARY_ANCHOR)
    scope = _unique(lines, _SCOPE_ANCHOR)
    if primary is None or scope is None:
        return []
    # A competing split clause is ambiguity, never joined into a candidate.
    if any(sum(len(anchor.findall(_clean(block["text"].replace("\n", " "))))
               for block in page["blocks"]) != 1
           for anchor in (_PRIMARY_ANCHOR, _SCOPE_ANCHOR)):
        return []
    match = _PRIMARY.fullmatch(_clean(primary["rawText"]))
    if match is None or _SCOPE.fullmatch(_clean(scope["rawText"])) is None:
        return []
    p, s = primary["bboxMilliPoints"], scope["bboxMilliPoints"]
    gap = s[1] - p[3]
    overlap_left, overlap_right = max(p[0], s[0]), min(p[2], s[2])
    smaller_width = min(p[2] - p[0], s[2] - s[0])
    if (not 0 < gap <= 4 * max(p[3] - p[1], s[3] - s[1])
            or 10 * (overlap_right - overlap_left) < 9 * smaller_width):
        return []
    chosen = {(part["blockIndex"], part["lineIndex"]) for part in (primary, scope)}
    for line in lines:
        if (line["blockIndex"], line["lineIndex"]) in chosen or not line["rawText"].strip():
            continue
        box = line["bboxMilliPoints"]
        if box[0] < overlap_right and box[2] > overlap_left and box[1] < s[1] and box[3] > p[3]:
            return []
    value = match.group("value")
    return [{"value": value, "rawValue": value, "rawUnit": "B_CLASS", "canonicalUnit": "B_CLASS",
             "primaryFragments": [primary], "contextFragments": [{**scope, "role": "MATERIAL_SCOPE"}]}]
