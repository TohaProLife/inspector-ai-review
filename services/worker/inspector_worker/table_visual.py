"""Independent OCR corroboration for a text-layer table row.

This is a second measurement of the same source page, not a source approval or
an assertion that all other pages were searched.
"""

from __future__ import annotations

import re
from typing import Any

from .ocr_pilot import validate_ocr_artifact


_LABEL = re.compile(r"общая\s+площадь\s+здания", re.I)


def _number(text: str) -> str:
    return text.replace("\u00a0", "").replace(" ", "").replace(",", ".")


def crosscheck_table_fact(fact: dict[str, Any], ocr: dict[str, Any]) -> dict[str, Any] | None:
    """Require one same-row OCR label/value pair for the proposed table value."""
    if fact.get("evidenceKind") != "TABLE_ROW":
        return None
    validate_ocr_artifact(ocr, source_id=fact["sourceFileId"],
                          source_hash=fact["inputSha256"], page_number=fact["pageNumber"])
    raw_value = fact.get("rawValue")
    if not isinstance(raw_value, str) or not raw_value:
        return None
    lines = ocr["lines"]
    labels = [index for index, line in enumerate(lines) if _LABEL.search(line["text"])]
    values = [index for index, line in enumerate(lines)
              if re.search(r"(?<!\d)" + re.escape(raw_value) + r"(?!\d)", line["text"])
              and _number(raw_value) in _number(line["text"])]
    pairs = []
    for label_index in labels:
        label = lines[label_index]
        for value_index in values:
            value = lines[value_index]
            if label_index != value_index:
                overlap = min(label["bboxPx"][3], value["bboxPx"][3]) - max(
                    label["bboxPx"][1], value["bboxPx"][1]
                )
                if overlap <= 0 or value["bboxPx"][0] < label["bboxPx"][2]:
                    continue
            pairs.append((label_index, value_index))
    if len(pairs) != 1:
        return None
    label_index, value_index = pairs[0]
    minimum_score = min(lines[label_index]["score"], lines[value_index]["score"])
    if minimum_score < 0.8:
        return None
    return {
        "sourceFileId": fact["sourceFileId"], "inputSha256": fact["inputSha256"],
        "pageNumber": fact["pageNumber"], "rawValue": raw_value,
        "ocrArtifactHash": ocr["contentHash"], "renderSha256": ocr["render"]["sha256"],
        "labelLineIndex": label_index, "valueLineIndex": value_index,
        "minimumOcrScore": minimum_score,
    }
