"""Narrow, source-authored stair concrete-strength declarations.

No imports from production extractors, no review/identity inference. The caller
must obtain both PD pages from one authenticated source artifact. This helper
cannot authenticate a source hash, PDF provenance or source-review approval.
These thresholds describe three verified pages; they are not a corpus-wide
claim. This module does not infer structural applicability or source approval.
"""
from __future__ import annotations

import re
from typing import Any

EXTRACTOR_VERSION = "matrix-concrete-prose-v1"
_SAFE = 2**53 - 1
_SPACE = re.compile(r"[ \t\u00a0\u202f]+")
_CLASS = r"(?P<value>[BВ](?:25|30))"
_PD = re.compile(r"Лестницы, лестничные площадки всех корпусов " + _CLASS + r"\.\Z")
_PD_HEADER = (
    "Для железобетонных конструкций предусматривается использование тяжелого бетона",
    "по ГОСТ 7473-2010 и ГОСТ 26633-2012 и приняты следующие классы по прочности на сжатие:",
)
_RD = re.compile(
    r"Класс бетона по прочности для лестничных маршей и площадок - " + _CLASS
    + r", F150, W6, П4\. В качестве крупного заполнителя для бетона применять гравий "
    r"из плотных горных пород по ГОСТ 8267-93\.\Z"
)
_RD_SCOPE = re.compile(
    r"В основном комплекте чертежей марки [А-Яа-яA-Za-z0-9.,_()/\-]{1,80} "
    r"разработаны железобетонные конструкции внутренних монолитных лестниц "
    r"подземной части \. При разработке были использованы\Z"
)
_PRIMARY_ANCHOR = {
    "PD": re.compile(r"лестницы, лестничные площадки", re.I),
    "RD": re.compile(r"класс бетона по прочности для лестничных", re.I),
}
_SCOPE_ANCHOR = {
    "PD": re.compile(r"(?:подземная|надземная) часть", re.I),
    "RD": re.compile(r"в основном комплекте чертежей марки", re.I),
}
_HEADER_ANCHOR = re.compile(r"для железобетонных конструкций предусматривается", re.I)
_HEADER_END_ANCHOR = re.compile(r"приняты следующие классы по прочности на сжатие", re.I)


def is_concrete_prose_fact(fact: Any) -> bool:
    """Reserve the stair grammar even when a forged fact drops/renames context.

    This selects strict validation; it does not authenticate or approve the fact.
    Generic/table concrete facts without these anchors retain their old path.
    """
    if type(fact) is not dict or fact.get("attribute") != "CONCRETE_CLASS":
        return False
    contexts, text = fact.get("contextFragments"), fact.get("rawText")
    return (type(contexts) is list and any(type(part) is dict and part.get("role") == "MATERIAL_SCOPE"
                                         for part in contexts)) or (type(text) is str and any(
        pattern.search(_clean(text)) for pattern in _PRIMARY_ANCHOR.values()))


def _clean(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is int and 0 <= n <= _SAFE for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _lines(page: Any) -> list[dict[str, Any]] | None:
    if (type(page) is not dict
            or set(page) != {"pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"}
            or any(type(page.get(k)) is not int or not 0 < page[k] <= _SAFE
                   for k in ("pageNumber", "widthMilliPoints", "heightMilliPoints"))
            or type(page["quality"]) is not dict
            or page["quality"].get("disposition") != "TEXT_LAYER_CANDIDATE"
            or type(page["blocks"]) is not list):
        return None
    result = []
    for bi, block in enumerate(page["blocks"]):
        if (type(block) is not dict
                or set(block) != {"text", "bboxMilliPoints", "lineBboxesMilliPoints"}
                or type(block["text"]) is not str
                or any(ord(c) < 32 and c not in "\n\t" or 0xd800 <= ord(c) <= 0xdfff
                       or c in "\u2028\u2029\ufffd" for c in block["text"])
                or not _box(block["bboxMilliPoints"], page["widthMilliPoints"], page["heightMilliPoints"])):
            return None
        texts, boxes = block["text"].split("\n"), block["lineBboxesMilliPoints"]
        if (type(boxes) is not list or len(texts) != len(boxes) or not boxes
                or any(not _box(b, page["widthMilliPoints"], page["heightMilliPoints"]) for b in boxes)
                or block["bboxMilliPoints"] != [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                                 max(b[2] for b in boxes), max(b[3] for b in boxes)]):
            return None
        for li, (text, box) in enumerate(zip(texts, boxes)):
            result.append({"pageNumber": page["pageNumber"], "blockIndex": bi, "lineIndex": li,
                           "rawText": text, "bboxMilliPoints": list(box)})
    return result


def _unique(lines: list[dict[str, Any]], pattern: re.Pattern[str]) -> dict[str, Any] | None:
    matches = [line for line in lines if pattern.search(_clean(line["rawText"]))]
    # Count repeated anchors even when the two clauses occupy a single line.
    return (matches[0] if len(matches) == 1
            and sum(len(pattern.findall(_clean(line["rawText"]))) for line in lines) == 1 else None)


def _anchor_count(page: dict[str, Any], pattern: re.Pattern[str]) -> int:
    # Reject a competing clause split across lines, without joining it into an
    # extraction candidate. Otherwise the original complete clause could hide it.
    return sum(len(pattern.findall(_clean(block["text"].replace("\n", " "))))
               for block in page["blocks"])


def _unobstructed(chosen: list[dict[str, Any]], lines: list[dict[str, Any]]) -> bool:
    keys = {(line["pageNumber"], line["blockIndex"], line["lineIndex"]) for line in chosen}
    boxes = [line["bboxMilliPoints"] for line in chosen]
    envelope = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes)]
    for line in lines:
        if (line["pageNumber"], line["blockIndex"], line["lineIndex"]) in keys or not line["rawText"].strip():
            continue
        b = line["bboxMilliPoints"]
        if b[0] < envelope[2] and b[2] > envelope[0] and b[1] < envelope[3] and b[3] > envelope[1]:
            return False
    return True


def extract_concrete_candidates(page: Any, stage: str, previous_page: Any = None) -> list[dict[str, Any]]:
    """Candidates include explicit pageNumber for PD cross-page evidence.

    It returns class text and source fragments only. No entity, binding, source
    approval, structural applicability, probability or negative-completeness
    claim follows. RD does not inspect/rely on the previous page at all.
    """
    if stage not in ("PD", "RD"):
        return []
    lines = _lines(page)
    if lines is None:
        return []
    primary, scope = _unique(lines, _PRIMARY_ANCHOR[stage]), _unique(lines, _SCOPE_ANCHOR[stage])
    if (primary is None or scope is None or _anchor_count(page, _PRIMARY_ANCHOR[stage]) != 1
            or _anchor_count(page, _SCOPE_ANCHOR[stage]) != 1):
        return []
    match = (_PD if stage == "PD" else _RD).fullmatch(_clean(primary["rawText"]))
    if not match:
        return []
    p, s = primary["bboxMilliPoints"], scope["bboxMilliPoints"]
    chosen = [primary, scope]
    contexts = []
    if stage == "PD":
        if _clean(scope["rawText"]) != "Подземная часть":
            return []
        if abs(p[0] - s[0]) > 2000 or not 60000 <= s[1] - p[3] <= 120000:
            return []
        header_pages = [(page, lines)]
        if previous_page is not None:
            previous_lines = _lines(previous_page)
            if (previous_lines is None or previous_page["pageNumber"] + 1 != page["pageNumber"]
                    or previous_page["widthMilliPoints"] != page["widthMilliPoints"]
                    or previous_page["heightMilliPoints"] != page["heightMilliPoints"]):
                return []
            header_pages.append((previous_page, previous_lines))
        all_header_lines = [line for _, ls in header_pages for line in ls]
        first, second = _unique(all_header_lines, _HEADER_ANCHOR), _unique(all_header_lines, _HEADER_END_ANCHOR)
        if (first is None or second is None
                or sum(_anchor_count(hp, _HEADER_ANCHOR) for hp, _ in header_pages) != 1
                or sum(_anchor_count(hp, _HEADER_END_ANCHOR) for hp, _ in header_pages) != 1
                or first["pageNumber"] != second["pageNumber"]
                or first["blockIndex"] != second["blockIndex"]
                or first["lineIndex"] + 1 != second["lineIndex"]
                or _clean(first["rawText"]) != _PD_HEADER[0]
                or _clean(second["rawText"]) != _PD_HEADER[1]):
            return []
        a, b = first["bboxMilliPoints"], second["bboxMilliPoints"]
        if (not 0 <= a[1] - b[3] <= 4000 or not 0 <= a[0] - b[0] <= 40000
                or abs(a[2] - b[2]) > 2000 or abs(a[0] - p[0]) > 2000
                or (first["pageNumber"] == page["pageNumber"] and b[1] < s[3])):
            return []
        actual_header_lines = next(ls for hp, ls in header_pages if hp["pageNumber"] == first["pageNumber"])
        if (any(not 11000 <= line["bboxMilliPoints"][3] - line["bboxMilliPoints"][1] <= 13000
                for line in (first, second)) or not _unobstructed([first, second], actual_header_lines)):
            return []
        contexts = [{**first, "role": "ATTRIBUTE_HEADER"}, {**second, "role": "ATTRIBUTE_HEADER"}]
    else:
        if (not _RD_SCOPE.fullmatch(_clean(scope["rawText"]))
                or any(b[2] * 2 > page["widthMilliPoints"] for b in (p, s))
                or not 0 <= p[0] - s[0] <= 40000
                or not 450000 <= s[1] - p[3] <= 650000):
            return []
    heights = [line["bboxMilliPoints"][3] - line["bboxMilliPoints"][1] for line in chosen + contexts]
    if (any(not 11000 <= height <= 13000 for height in heights) or max(heights) - min(heights) > 1000
            or any(not _unobstructed([line], lines) for line in chosen)):
        return []
    contexts.append({**scope, "role": "MATERIAL_SCOPE"})
    value = match.group("value")
    return [{"value": value, "rawValue": value, "rawUnit": "B_CLASS", "canonicalUnit": "B_CLASS",
             "primaryFragments": [primary], "contextFragments": contexts}]
