"""Strict project-authored zero-datum prose candidates, without identity/review inference.

Observed public PD13: two same-block lines, height10020, gap2040,
left delta3 milli-points. Guards9000..14000/span1000/gap0..6000/left1000
keep the shorter continuation legitimate. Observed RD4: one full datum line,
height11879; explicit unit note lines11879 high/gap5221/leftdelta360.
Unit guards9000..14000/span1000/gap0..7000/left1000. All three RD lines
belong to the left page half (rightmost832182 < 1684000/2).
These bounds describe the first grammar, not universal PDF layout tolerances.
No source IDs, hashes, approval, external datum or same-floor match is inferred.
"""
from __future__ import annotations

import re
from typing import Any

EXTRACTOR_VERSION = "matrix-project-zero-prose-v1"
_MAX_SAFE = 2**53 - 1
_SPACE = re.compile(r"[ \t\u00a0\u202f]+")
_NUMBER = r"[+-]?(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?"
_PD_FIRST = re.compile(r"За относительную отметку (?P<zero>0[,.]000) принята абсолютная отметка "
                       r"(?P<value>" + _NUMBER + r") (?P<unit>м)\., что соответствует\Z")
_PD_SECOND = "отметке чистого пола входного вестибюля на 1-м этаже."
_RD = re.compile(r"За относительную отметку (?P<zero>±?0[,.]000) принята отметка "
                 r"(?P<reference>чистого пола первого этажа), соответствующая абсолютной отметке "
                 r"(?P<value>" + _NUMBER + r")\.\Z")
_UNIT_LAST = "отметки - в метрах."
_UNIT_PREVIOUS_END = "Все размеры даны в миллиметрах,"
_DECLARATION = re.compile(r"отметки\s*(?:[-–—:=]|(?:даны|указаны|приведены|измеряются|в)\b)", re.I)
_UNIT_MENTION = re.compile(r"отметк[а-я]*\b.*(?:метр[а-я]*|(?<!\w)(?:м|мм|см|m|mm|cm)\b)", re.I)
_SIZE_DECLARATION = re.compile(r"размеры\s+(?:даны|указаны|приведены|в)\b", re.I)


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


def _pair(first: dict[str, Any], second: dict[str, Any], gap_limit: int) -> bool:
    a, b = first["bboxMilliPoints"], second["bboxMilliPoints"]
    heights = [a[3] - a[1], b[3] - b[1]]
    return (first["blockIndex"] == second["blockIndex"]
            and second["lineIndex"] == first["lineIndex"] + 1
            and all(9000 <= n <= 14000 for n in heights)
            and abs(heights[0] - heights[1]) <= 1000
            and 0 <= a[1] - b[3] <= gap_limit and abs(a[0] - b[0]) <= 1000)


def _unobstructed(chosen: list[dict[str, Any]], lines: list[dict[str, Any]]) -> bool:
    keys = {(x["blockIndex"], x["lineIndex"]) for x in chosen}
    boxes = [x["bboxMilliPoints"] for x in chosen]
    envelope = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes)]
    for line in lines:
        if (line["blockIndex"], line["lineIndex"]) in keys or not line["rawText"].strip():
            continue
        b = line["bboxMilliPoints"]
        if b[0] < envelope[2] and b[2] > envelope[0] and b[1] < envelope[3] and b[3] > envelope[1]:
            return False
    return True


def _decimal(raw: str) -> str | None:
    if len(raw) > 64:
        return None
    negative = raw.startswith("-")
    unsigned = raw.lstrip("+-").replace(",", ".")
    whole, _, fraction = unsigned.partition(".")
    fraction = fraction.rstrip("0")
    canonical = whole + ("." + fraction if fraction else "")
    return ("-" if negative and canonical != "0" else "") + canonical


def _candidate(match: re.Match[str], raw_unit: str, reference: str,
               primary: list[dict[str, Any]], units: list[dict[str, Any]]) -> dict[str, Any] | None:
    raw_value = match.group("value")
    value = _decimal(raw_value)
    if value is None:
        return None
    return {"value": value, "rawValue": raw_value, "rawUnit": raw_unit, "canonicalUnit": "m",
            "localZero": "0", "referenceKind": "FINISHED_FLOOR", "referenceText": reference,
            "datumName": None, "primaryFragments": primary, "unitAuthorityFragments": units}


def extract_project_zero_candidates(page: Any, stage: str) -> list[dict[str, Any]]:
    """Return only exact adopted prose; never compare sources or manufacture proofs.

    Every line must retain declared valid original geometry. Coarse block geometry
    cannot prove absence of interleaving or competing unit/zero declarations.
    Returned fragments are fresh objects; input data is never changed.
    """
    if stage not in ("PD", "RD"):
        return []
    lines = _page_lines(page)
    if lines is None:
        return []
    # Search complete blocks as well: a malformed anchor split over newline still competes.
    anchors = [line for line in lines if "за относительную отметк" in _clean(line["rawText"]).casefold()]
    block_anchor_count = sum(_clean(b["text"].replace("\n", " ")).casefold().count("за относительную отметк")
                             for b in page["blocks"])
    if len(anchors) != 1 or block_anchor_count != 1:
        return []
    first = anchors[0]
    if stage == "PD":
        match = _PD_FIRST.fullmatch(_clean(first["rawText"]))
        if not match:
            return []
        continuations = [line for line in lines if line["blockIndex"] == first["blockIndex"]
                         and line["lineIndex"] == first["lineIndex"] + 1]
        if (len(continuations) != 1 or _clean(continuations[0]["rawText"]) != _PD_SECOND
                or not _pair(first, continuations[0], 6000)
                or not _unobstructed([first, continuations[0]], lines)):
            return []
        # Preserve the source substring verbatim, rather than inventing an RD floor identity.
        raw_reference = continuations[0]["rawText"].strip()
        candidate = _candidate(match, "м", raw_reference, [first, continuations[0]], [])
        return [candidate] if candidate else []
    match = _RD.fullmatch(_clean(first["rawText"]))
    if not match or not 9000 <= first["bboxMilliPoints"][3] - first["bboxMilliPoints"][1] <= 14000:
        return []
    declarations = [line for line in lines if (_DECLARATION.search(_clean(line["rawText"]))
                                                  or _UNIT_MENTION.search(_clean(line["rawText"])))]
    if len(declarations) != 1 or _clean(declarations[0]["rawText"]) != _UNIT_LAST:
        return []
    last = declarations[0]
    previous = [line for line in lines if line["blockIndex"] == last["blockIndex"]
                and line["lineIndex"] == last["lineIndex"] - 1]
    if (len(previous) != 1 or not _clean(previous[0]["rawText"]).endswith(_UNIT_PREVIOUS_END)
            or not _pair(previous[0], last, 7000)):
        return []
    previous = previous[0]
    previous_text = _clean(previous["rawText"])
    prefix = previous_text[:-len(_UNIT_PREVIOUS_END)]
    if (prefix and not prefix.endswith(". ")
            or any(c in previous_text for c in ('«', '»', '"', "'", '“', '”'))):
        return []
    size_declarations = [line for line in lines if _SIZE_DECLARATION.search(_clean(line["rawText"]))]
    if len(size_declarations) != 1 or size_declarations[0] != previous:
        return []
    fragments = [first, previous, last]
    if (any(f["bboxMilliPoints"][2] * 2 > page["widthMilliPoints"] for f in fragments)
            or max(f["bboxMilliPoints"][0] for f in fragments) - min(f["bboxMilliPoints"][0] for f in fragments) > 40000
            or not _unobstructed([first], lines) or not _unobstructed([previous, last], lines)):
        return []
    # Only literal source wording, including its original spacing, is retained.
    raw = first["rawText"]
    reference = re.search(r"чистого[ \t\u00a0\u202f]+пола[ \t\u00a0\u202f]+первого[ \t\u00a0\u202f]+этажа", raw)
    if not reference:
        return []
    candidate = _candidate(match, "метрах", reference.group(), [first], [previous, last])
    return [candidate] if candidate else []
