"""Narrow source-authored reinforcement declarations; no structural identity inferred.

Observed PD: 12000mpt lines, 1680 gap, paragraph indent34080; two original
single-line blocks. Scope header/stair line heights12000, vertical gap89760;
stair-to-declaration gap57120. Guards below admit only this source grammar.
Observed RD:11879mpt lines; stair concrete-to-declaration gap22681, leftdelta600,
rightdelta142. An intervening concrete-strength line11879 high is retained
as the third RD scope fragment, with two adjacent gaps5401mpt (guards0..7000).
Document scope is570181mpt above declaration, all left-half.
No class ranking, standard applicability, WORKING role, approval or cross-source
member equivalence follows from these strings. Conditional bending instructions
are not adopted governing declarations. Only six literal glyph aliases exist.
"""
from __future__ import annotations

import re
from typing import Any

EXTRACTOR_VERSION = "matrix-rebar-prose-v1"
_MAX_SAFE = 2**53 - 1
_SPACE = re.compile(r"[ \t\u00a0\u202f]+")
_ALIASES = {"А500C": "А500С", "A500C": "А500С", "A500С": "А500С", "А500С": "А500С",
            "A400": "А400", "А400": "А400"}
_CLASS = r"(?P<value>А500C|A500C|A500С|А500С|A400|А400)"
_PD = re.compile(r"Арматура для железобетонных конструкций предусмотрена класса " + _CLASS + r" по ГОСТ Р\Z")
_PD_STANDARD = "52544-2006."
_PD_HEADER = "Подземная часть"
_PD_STAIR = "Лестницы, лестничные площадки всех корпусов В30."
_RD = re.compile(r"Арматура всех конструкций класса " + _CLASS + r" по ГОСТ 34028-2016\. "
                 r"Армирование монолитных лестничных маршей и площадок выполняется отдельными "
                 r"стержнями с перевязкой их в местах пересечений\Z")
_RD_SCOPE = re.compile(r"В основном комплекте чертежей марки [А-Яа-яA-Za-z0-9.,_()/\-]{1,80} "
                       r"разработаны железобетонные конструкции внутренних монолитных лестниц "
                       r"подземной части \. При разработке были использованы\Z")
_RD_STRENGTH = "Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%."
_STRENGTH_ANCHOR = re.compile(r"минимальная прочность бетона конструкций после снятия опалубки", re.I)
_RD_STAIR = ("Класс бетона по прочности для лестничных маршей и площадок - В30, F150, W6, П4. "
             "В качестве крупного заполнителя для бетона применять гравий из плотных горных "
             "пород по ГОСТ 8267-93.")
# A second adopted/working class clause competes even when its value is malformed.
# The real RD's conditional '...для арматуры класса...' bending note is not one.
_GOVERNING = re.compile(r"арматура (?:для железобетонных конструкций|всех конструкций)\b|"
                        r"(?:^|[.;] )арматур(?:а|ные стержни|ные каркасы)\b|"
                        r"основная рабочая арматура\b", re.I)
_SCOPE_ANCHOR_PD = re.compile(r"(?:подземная|надземная) часть", re.I)
_SCOPE_ANCHOR_RD = re.compile(r"в основном комплекте чертежей марки", re.I)
_STAIR_ANCHOR_PD = re.compile(r"лестницы, лестничные площадки", re.I)
_STAIR_ANCHOR_RD = re.compile(r"класс бетона по прочности для лестничных", re.I)


def _clean(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is int and 0 <= n <= _MAX_SAFE for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _page_lines(page: Any) -> list[dict[str, Any]] | None:
    if (type(page) is not dict
            or set(page) != {"pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"}
            or any(type(page.get(k)) is not int or not 0 < page[k] <= _MAX_SAFE
                   for k in ("pageNumber", "widthMilliPoints", "heightMilliPoints"))
            or type(page.get("quality")) is not dict
            or page["quality"].get("disposition") != "TEXT_LAYER_CANDIDATE"
            or type(page.get("blocks")) is not list):
        return None
    width, height = page["widthMilliPoints"], page["heightMilliPoints"]
    result = []
    for bi, block in enumerate(page["blocks"]):
        if (type(block) is not dict or set(block) != {"text", "bboxMilliPoints", "lineBboxesMilliPoints"}
                or type(block.get("text")) is not str
                or any(c in block["text"] for c in ("\r", "\u2028", "\u2029"))
                or not _box(block.get("bboxMilliPoints"), width, height)):
            return None
        texts, boxes = block["text"].split("\n"), block["lineBboxesMilliPoints"]
        if (type(boxes) is not list or len(boxes) != len(texts) or not boxes
                or any(not _box(box, width, height) for box in boxes)):
            return None
        union = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                 max(b[2] for b in boxes), max(b[3] for b in boxes)]
        if union != block["bboxMilliPoints"]:
            return None
        for li, (text, box) in enumerate(zip(texts, boxes)):
            result.append({"blockIndex": bi, "lineIndex": li,
                           "rawText": text, "bboxMilliPoints": list(box)})
    return result


def _height(line: dict[str, Any]) -> int:
    box = line["bboxMilliPoints"]
    return box[3] - box[1]


def _unobstructed(chosen: list[dict[str, Any]], lines: list[dict[str, Any]],
                  column_left: int | None = None) -> bool:
    keys = {(x["blockIndex"], x["lineIndex"]) for x in chosen}
    boxes = [x["bboxMilliPoints"] for x in chosen]
    envelope = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes)]
    if column_left is not None:
        envelope[0] = column_left
    for line in lines:
        if (line["blockIndex"], line["lineIndex"]) in keys or not line["rawText"].strip():
            continue
        b = line["bboxMilliPoints"]
        if b[0] < envelope[2] and b[2] > envelope[0] and b[1] < envelope[3] and b[3] > envelope[1]:
            return False
    return True


def _unique_anchor(lines: list[dict[str, Any]], pattern: re.Pattern[str]) -> dict[str, Any] | None:
    matches = [line for line in lines if pattern.search(_clean(line["rawText"]))]
    return matches[0] if len(matches) == 1 else None


def extract_rebar_candidates(page: Any, stage: str) -> list[dict[str, Any]]:
    """Extract narrow categorical declarations with complete local material scope.

    Fail closed for missing/coarse/invalid line geometry anywhere on the page.
    Preserve original complete lines and spacing. Return fresh fragment objects;
    no source/page allowlist, file-wide join, authority or member identity exists.
    Scope order: PD header/stair; RD document/stair/concrete-strength. The latter
    remains applicability context only and is not a numerical reinforcement fact.
    """
    if stage not in ("PD", "RD"):
        return []
    lines = _page_lines(page)
    if lines is None:
        return []
    first = _unique_anchor(lines, _GOVERNING)
    if first is None:
        return []
    # A split/malformed duplicate in one block still competes. This does not join
    # text for extraction: only counts governing anchors to reject ambiguity.
    if sum(len(_GOVERNING.findall(_clean(b["text"].replace("\n", " "))))
           for b in page["blocks"]) != 1:
        return []
    match = (_PD if stage == "PD" else _RD).fullmatch(_clean(first["rawText"]))
    if not match:
        return []
    header = _unique_anchor(lines, _SCOPE_ANCHOR_PD if stage == "PD" else _SCOPE_ANCHOR_RD)
    stair = _unique_anchor(lines, _STAIR_ANCHOR_PD if stage == "PD" else _STAIR_ANCHOR_RD)
    if header is None or stair is None:
        return []
    if (sum(len((_SCOPE_ANCHOR_PD if stage == "PD" else _SCOPE_ANCHOR_RD).findall(
            _clean(b["text"].replace("\n", " ")))) for b in page["blocks"]) != 1
            or sum(len((_STAIR_ANCHOR_PD if stage == "PD" else _STAIR_ANCHOR_RD).findall(
                _clean(b["text"].replace("\n", " ")))) for b in page["blocks"]) != 1):
        return []
    if (any(not 11000 <= _height(line) <= 13000 for line in (first, header, stair))
            or max(_height(line) for line in (first, header, stair))
               - min(_height(line) for line in (first, header, stair)) > 1000):
        return []
    a, h, s = (line["bboxMilliPoints"] for line in (first, header, stair))
    if stage == "PD":
        if _clean(header["rawText"]) != _PD_HEADER or _clean(stair["rawText"]) != _PD_STAIR:
            return []
        index = lines.index(first)
        if index + 1 >= len(lines):
            return []
        second = lines[index + 1]
        b = second["bboxMilliPoints"]
        adjacent = ((second["blockIndex"] == first["blockIndex"]
                     and second["lineIndex"] == first["lineIndex"] + 1)
                    or (second["blockIndex"] == first["blockIndex"] + 1
                        and first["lineIndex"] == 0 and second["lineIndex"] == 0
                        and len(page["blocks"][first["blockIndex"]]["lineBboxesMilliPoints"]) == 1
                        and len(page["blocks"][second["blockIndex"]]["lineBboxesMilliPoints"]) == 1))
        if (not adjacent or _clean(second["rawText"]) != _PD_STANDARD
                or not 11000 <= _height(second) <= 13000 or abs(_height(first) - _height(second)) > 1000
                or not 0 <= a[1] - b[3] <= 4000 or not 0 <= a[0] - b[0] <= 40000
                or not b[0] < b[2] <= a[2]
                or abs(h[0] - s[0]) > 2000 or abs(s[0] - a[0]) > 2000
                or not 60000 <= h[1] - s[3] <= 120000
                or not 30000 <= s[1] - a[3] <= 90000
                or not _unobstructed([first, second], lines)):
            return []
        primary = [first, second]
        scopes = [header, stair]
    else:
        if not _RD_SCOPE.fullmatch(_clean(header["rawText"])) or _clean(stair["rawText"]) != _RD_STAIR:
            return []
        strength = _unique_anchor(lines, _STRENGTH_ANCHOR)
        if (strength is None or _clean(strength["rawText"]) != _RD_STRENGTH
                or sum(len(_STRENGTH_ANCHOR.findall(_clean(b["text"].replace("\n", " "))))
                       for b in page["blocks"]) != 1
                or not 11000 <= _height(strength) <= 13000
                or abs(_height(strength) - _height(first)) > 1000):
            return []
        t = strength["bboxMilliPoints"]
        if (any(box[2] * 2 > page["widthMilliPoints"] for box in (a, h, s, t))
                or not 0 <= a[0] - h[0] <= 40000
                or abs(s[0] - a[0]) > 2000 or abs(s[2] - a[2]) > 2000
                or not 0 <= s[1] - a[3] <= 30000
                or not 450000 <= h[1] - a[3] <= 650000
                or not 0 <= a[0] - t[0] <= 40000 or t[2] > a[2]
                or not 0 <= s[1] - t[3] <= 7000 or not 0 <= t[1] - a[3] <= 7000
                or not _unobstructed([stair, strength, first], lines, max(a[0], s[0]))):
            return []
        primary = [first]
        scopes = [header, stair, strength]
    # RD source has list labels5./6. left of the common body column; the
    # sequence check excludes that gutter. Each complete source line still
    # receives its own full-width obstruction check.
    if any(not _unobstructed([line], lines) for line in primary + scopes):
        return []
    raw_value = match.group("value")
    return [{"value": _ALIASES[raw_value], "rawValue": raw_value, "rawUnit": None,
             "canonicalUnit": "rebar_catalog_example", "primaryFragments": primary,
             "scopeFragments": scopes}]
