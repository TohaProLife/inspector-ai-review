"""Page-scoped table row evidence from a verified PDF text layer.

The full text artifact deliberately stores blocks rather than every line. This
module revisits only routed pages and binds each line back to its saved block.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .text_layer import _milli_points


_LABEL = re.compile(r"общая\s+площадь\s+здания(?:\s*,\s*в\s+т\.?\s*ч\.?)?\s*:?\Z", re.I)
_UNIT = re.compile(r"(?:мм|см|м|mm|cm|m)\s*[²2]|кв\.?\s*м\.?\Z", re.I)
_NUMBER = re.compile(r"[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?\Z")


def _overlaps_row(left: list[int], right: list[int]) -> bool:
    overlap = min(left[3], right[3]) - max(left[1], right[1])
    return overlap > 0 and overlap * 2 >= min(left[3] - left[1], right[3] - right[1])


def _line_text(block: dict[str, Any], line_index: int) -> str | None:
    lines = [part.strip() for part in block["text"].splitlines() if part.strip()]
    return lines[line_index] if 0 <= line_index < len(lines) else None


def validate_table_row_fact(fact: dict[str, Any], page: dict[str, Any]) -> bool:
    """Check a proposed row against saved block text and bounded line geometry."""
    row = fact.get("tableRow")
    if not isinstance(row, dict) or set(row) != {"label", "unit", "value"}:
        return False
    blocks = page.get("blocks")
    if not isinstance(blocks, list):
        return False
    checked: dict[str, tuple[str, list[int]]] = {}
    for role in ("label", "unit", "value"):
        locator = row[role]
        if not isinstance(locator, dict) or set(locator) != {"blockIndex", "lineIndex", "bboxMilliPoints"}:
            return False
        block_index = locator["blockIndex"]
        line_index = locator["lineIndex"]
        bbox = locator["bboxMilliPoints"]
        if (type(block_index) is not int or not 0 <= block_index < len(blocks)
                or type(line_index) is not int or line_index < 0
                or not isinstance(bbox, list) or len(bbox) != 4
                or any(type(value) is not int for value in bbox)):
            return False
        block = blocks[block_index]
        outer = block["bboxMilliPoints"]
        if not (outer[0] <= bbox[0] <= bbox[2] <= outer[2]
                and outer[1] <= bbox[1] <= bbox[3] <= outer[3]):
            return False
        text = _line_text(block, line_index)
        if text is None:
            return False
        checked[role] = (text, bbox)
    label, label_box = checked["label"]
    unit, unit_box = checked["unit"]
    value, value_box = checked["value"]
    if (not _LABEL.fullmatch(label) or not _UNIT.fullmatch(unit) or not _NUMBER.fullmatch(value)
            or value != fact.get("rawValue") or unit != fact.get("rawUnit")
            or not (label_box[2] < unit_box[0] < value_box[0])
            or not _overlaps_row(label_box, unit_box)
            or not _overlaps_row(label_box, value_box)):
        return False
    return True


def extract_pz002_table_rows(
    path: Path, artifact: dict[str, Any], page_number: int, *, entity_key: str,
) -> list[dict[str, Any]]:
    """Return unambiguous label/unit/value rows on one routed text page."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer, LTTextLine

    if type(page_number) is not int or not 1 <= page_number <= artifact["pageCount"]:
        raise ValueError("table page is outside source artifact")
    page = artifact["pages"][page_number - 1]
    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
        return []
    layouts = list(extract_pages(str(path), page_numbers=[page_number - 1]))
    if len(layouts) != 1:
        raise ValueError("table page could not be parsed")
    layout = layouts[0]
    width = max(1, round(float(layout.width) * 1000))
    height = max(1, round(float(layout.height) * 1000))
    if width != page["widthMilliPoints"] or height != page["heightMilliPoints"]:
        raise ValueError("table page dimensions differ from committed text artifact")
    parsed = []
    for element in layout:
        if not isinstance(element, LTTextContainer):
            continue
        text = element.get_text().replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
        if not text:
            continue
        outer = [
            _milli_points(float(element.x0), float(layout.x0), width),
            _milli_points(float(element.y0), float(layout.y0), height),
            _milli_points(float(element.x1), float(layout.x0), width),
            _milli_points(float(element.y1), float(layout.y0), height),
        ]
        lines = []
        for line in element:
            if not isinstance(line, LTTextLine):
                continue
            line_text = line.get_text().replace("\x00", "").strip()
            if line_text:
                lines.append({
                    "text": line_text,
                    "bboxMilliPoints": [
                        _milli_points(float(line.x0), float(layout.x0), width),
                        _milli_points(float(line.y0), float(layout.y0), height),
                        _milli_points(float(line.x1), float(layout.x0), width),
                        _milli_points(float(line.y1), float(layout.y0), height),
                    ],
                })
        parsed.append({"text": text, "bboxMilliPoints": outer, "lines": lines})
    parsed.sort(key=lambda block: (
        -block["bboxMilliPoints"][3], block["bboxMilliPoints"][0],
        block["bboxMilliPoints"][1], block["text"],
    ))
    if len(parsed) != len(page["blocks"]) or any(
        block["text"] != original["text"] or block["bboxMilliPoints"] != original["bboxMilliPoints"]
        for block, original in zip(parsed, page["blocks"])
    ):
        raise ValueError("table page text differs from committed text artifact")
    lines = [
        {"text": line["text"], "blockIndex": block_index, "lineIndex": line_index,
         "bboxMilliPoints": line["bboxMilliPoints"]}
        for block_index, block in enumerate(parsed)
        for line_index, line in enumerate(block["lines"])
    ]
    labels = [line for line in lines if _LABEL.fullmatch(line["text"])]
    facts = []
    for label in labels:
        label_box = label["bboxMilliPoints"]
        units = [line for line in lines if _UNIT.fullmatch(line["text"])
                 and label_box[2] < line["bboxMilliPoints"][0]
                 and _overlaps_row(label_box, line["bboxMilliPoints"])]
        values = [line for line in lines if _NUMBER.fullmatch(line["text"])
                  and label_box[2] < line["bboxMilliPoints"][0]
                  and _overlaps_row(label_box, line["bboxMilliPoints"])]
        pairs = [(unit, value) for unit in units for value in values
                 if unit["bboxMilliPoints"][2] < value["bboxMilliPoints"][0]
                 and _overlaps_row(unit["bboxMilliPoints"], value["bboxMilliPoints"])]
        if len(pairs) != 1:
            continue
        unit, value = pairs[0]
        row = {role: {key: item[key] for key in ("blockIndex", "lineIndex", "bboxMilliPoints")}
               for role, item in (("label", label), ("unit", unit), ("value", value))}
        fact = {
            "sourceFileId": artifact["sourceFileId"], "inputSha256": artifact["inputSha256"],
            "pageNumber": page_number, "entityKey": entity_key,
            "rawValue": value["text"], "rawUnit": unit["text"],
            "unit": re.sub(r"[ \u00a0]", "", unit["text"]).rstrip("."),
            "evidenceKind": "TABLE_ROW", "tableRow": row,
            "extractionProfile": "pz-002-table-row-v1",
        }
        if validate_table_row_fact(fact, page):
            facts.append(fact)
    return facts
