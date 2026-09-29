"""Bounded review navigation for PZ-006 table cells in an original public PDF.

Word boxes suggest nearby cells; they do not prove table row membership, unit,
source role, corpus identity, or the contradictory catalog semantics. No fact.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_VERSION = "pz006-building-levels-proposals-v1"
PROFILE_ID = "pz006-building-levels-review-v1"
MAX_PDF_BYTES = 100 * 1024 * 1024
MAX_WORDS = 20_000
MAX_PROPOSALS = 24
MAX_WORDS_PER_PROPOSAL = 64
MAX_RESULT_BYTES = 256 * 1024
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_CORPUS = re.compile(r"\bкорпус\s+(\d{1,3})\b", re.I)
_NUMBER = re.compile(r"\d[\d\s]*[,\.]?\d*")


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _box(raw: tuple[Any, ...]) -> list[int]:
    return [round(float(value) * 1000) for value in raw[:4]]


def _word(index: int, raw: tuple[Any, ...]) -> dict[str, Any]:
    value = str(raw[4])
    return {"wordIndex": index, "text": value,
            "textSha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
            "bboxMilliPoints": _box(raw)}


def _joined(words: list[dict[str, Any]]) -> str:
    return " ".join(word["text"] for word in words)


def _proposal(kind: str, line: list[dict[str, Any]], width: int,
              corpus: str | None = None) -> dict[str, Any]:
    label = [word for word in line if int(width * .10) <= word["bboxMilliPoints"][0] < int(width * .66)]
    unit = [word for word in line if int(width * .66) <= word["bboxMilliPoints"][0] < int(width * .78)]
    value = [word for word in line if word["bboxMilliPoints"][0] >= int(width * .78)]
    raw_unit = _joined(unit) or None
    raw_value = _joined(value) or None
    reasons = ["ROW_ASSOCIATION_UNVERIFIED", "TABLE_CELL_BOUNDARIES_UNVERIFIED"]
    if kind == "FLOOR_COUNT_HEADER" or kind == "FLOOR_COUNT_CONTINUATION":
        reasons.append("COMPOSITE_FLOOR_COUNT_UNRESOLVED")
    if kind == "CORPUS_FLOOR_COUNT" and raw_unit and raw_unit.strip(" .").lower() not in {"эт", "этаж", "этажей"}:
        reasons.append("FLOOR_ROW_UNIT_CONFLICT")
    if kind == "VOLUME_TOTAL" and raw_unit and "кв" in raw_unit.lower():
        reasons.append("VOLUME_UNIT_CONFLICT")
    if raw_value is None or _NUMBER.search(raw_value) is None:
        reasons.append("VALUE_CELL_UNRESOLVED")
    if kind == "CORPUS_FLOOR_COUNT" and raw_value and re.fullmatch(r"\d{1,3}", raw_value) is None:
        reasons.append("MULTIPLE_VALUE_CELLS_AMBIGUOUS")
    result = {"proposalKind": kind, "corpusLabelRaw": corpus,
              "rawLabel": _joined(label) or None, "rawUnit": raw_unit,
              "rawValue": raw_value, "rowAssociationStatus": "UNVERIFIED",
              "corpusAssociationStatus": "UNVERIFIED", "unitStatus": "UNVERIFIED",
              "typedFact": None, "reasonCodes": sorted(reasons),
              "wordLocators": line}
    result["proposalSha256"] = _hash(result)
    return result


def evaluate_pz006_building_levels_proposals(
    pdf_bytes: bytes, manifest_record: dict[str, Any], page_number: int,
) -> dict[str, Any]:
    """Verify allowed original bytes, then expose word-box-backed navigation."""
    import fitz

    if not isinstance(pdf_bytes, bytes) or not 0 < len(pdf_bytes) <= MAX_PDF_BYTES:
        raise ValueError("PZ-006 PDF bytes invalid or too large")
    if not isinstance(manifest_record, dict):
        raise ValueError("PZ-006 manifest record required")
    if (manifest_record.get("split"), manifest_record.get("distribution_status"),
            manifest_record.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
        raise ValueError("PZ-006 source is not permitted public training data")
    expected = manifest_record.get("sha256")
    actual = hashlib.sha256(pdf_bytes).hexdigest()
    if not isinstance(expected, str) or not _SHA.fullmatch(expected) or actual != expected:
        raise ValueError("PZ-006 original PDF SHA mismatch")
    if manifest_record.get("size_bytes") != len(pdf_bytes):
        raise ValueError("PZ-006 original PDF size mismatch")
    if not isinstance(page_number, int) or isinstance(page_number, bool) or page_number < 1:
        raise ValueError("PZ-006 physical page invalid")
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if len(document) != manifest_record.get("pdf_pages") or page_number > len(document):
            raise ValueError("PZ-006 PDF page count mismatch")
        page = document[page_number - 1]
        raw_words = page.get_text("words", sort=False)
        if len(raw_words) > MAX_WORDS:
            raise ValueError("PZ-006 page word count exceeds bound")
        width = round(page.rect.width * 1000)
        height = round(page.rect.height * 1000)
    words = [_word(index, raw) for index, raw in enumerate(raw_words)]
    # PDF text lines split table cells into separate blocks. Group words by
    # vertical overlap only for navigation, never as a verified table row.
    ordered = sorted(words, key=lambda word: ((word["bboxMilliPoints"][1] +
                                               word["bboxMilliPoints"][3]) / 2,
                                              word["bboxMilliPoints"][0]))
    groups: list[list[dict[str, Any]]] = []
    centers: list[float] = []
    for word in ordered:
        center = (word["bboxMilliPoints"][1] + word["bboxMilliPoints"][3]) / 2
        if not groups or abs(center - centers[-1]) > 5800:
            groups.append([word])
            centers.append(center)
        else:
            groups[-1].append(word)
            centers[-1] = sum((item["bboxMilliPoints"][1] + item["bboxMilliPoints"][3]) / 2
                              for item in groups[-1]) / len(groups[-1])
    proposals: list[dict[str, Any]] = []
    oversize_line_count = 0
    floor_header_y: float | None = None
    volume_total_y: float | None = None
    for line, y in zip(groups, centers):
        line.sort(key=lambda word: (word["bboxMilliPoints"][0], word["wordIndex"]))
        text = _joined(line)
        low = text.lower()
        kind = None
        corpus = None
        if "количество этажей" in low:
            kind = "FLOOR_COUNT_HEADER"
            floor_header_y = y
        elif (match := _CORPUS.search(low)) and floor_header_y is not None and 0 < y - floor_header_y < 45000:
            kind, corpus = "CORPUS_FLOOR_COUNT", match.group(1)
        elif "строительный объем" in low or "строительный объём" in low:
            kind = "VOLUME_TOTAL"
            volume_total_y = y
        elif "подземная часть" in low and volume_total_y is not None and 0 < y - volume_total_y < 50000:
            kind = "VOLUME_UNDERGROUND_PART"
        elif "наземная часть" in low and volume_total_y is not None and 0 < y - volume_total_y < 50000:
            kind = "VOLUME_ABOVEGROUND_PART"
        elif ("подз" in low and floor_header_y is not None
              and 0 < y - floor_header_y < 20000
              and any(word["bboxMilliPoints"][0] >= int(width * .78) for word in line)):
            kind = "FLOOR_COUNT_CONTINUATION"
        if kind is not None:
            if len(line) > MAX_WORDS_PER_PROPOSAL:
                oversize_line_count += 1
                continue
            proposals.append(_proposal(kind, line, width, corpus))
    proposal_count = len(proposals)
    # Unit conflict spans distinct table rows. Keep observations separate and
    # flag nearby total/part proposals rather than silently resolving it.
    total = next((p for p in proposals if p["proposalKind"] == "VOLUME_TOTAL"), None)
    parts = [p for p in proposals if p["proposalKind"] in {"VOLUME_UNDERGROUND_PART", "VOLUME_ABOVEGROUND_PART"}]
    if total and parts and total["rawUnit"] and any(part["rawUnit"] and part["rawUnit"] != total["rawUnit"] for part in parts):
        for item in [total, *parts]:
            item["reasonCodes"] = sorted(set(item["reasonCodes"] + ["TOTAL_VS_PART_UNIT_CONFLICT"]))
            item["proposalSha256"] = _hash({key: value for key, value in item.items() if key != "proposalSha256"})
    reasons = {"REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_APPROVAL_UNVERIFIED",
               "PD_RD_PAIR_UNVERIFIED", "PZ006_CATALOG_TITLE_TRIGGER_CONFLICT",
               "ROW_ASSOCIATION_UNVERIFIED"}
    if not proposals:
        reasons.add("NO_SAFE_PROPOSAL_IN_SCANNED_TEXT")
    if proposal_count > MAX_PROPOSALS:
        reasons.add("PROPOSAL_LIMIT_REACHED")
    if oversize_line_count:
        reasons.add("OVERSIZE_LINE_DEFERRED")
    if total and "VOLUME_UNIT_CONFLICT" in total["reasonCodes"]:
        reasons.add("VOLUME_UNIT_CONFLICT")
    if any("TOTAL_VS_PART_UNIT_CONFLICT" in p["reasonCodes"] for p in proposals):
        reasons.add("TOTAL_VS_PART_UNIT_CONFLICT")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "parameterCode": "PZ-006",
              "sourceFileId": manifest_record.get("file_id"),
              "objectId": manifest_record.get("object_id"),
              "sourceSha256": actual, "sourceStageFromManifest": manifest_record.get("stage"),
              "sourceSectionFromManifest": manifest_record.get("section"),
              "sourceApprovalStatus": "UNVERIFIED", "pageNumber": page_number,
              "pageWidthMilliPoints": width, "pageHeightMilliPoints": height,
              "wordLayoutSha256": _hash(words), "wordCount": len(words),
              "status": "ABSTAIN", "reasonCodes": sorted(reasons),
              "proposalCount": proposal_count, "oversizeLineCount": oversize_line_count,
              "truncatedProposalCount": max(0, proposal_count - MAX_PROPOSALS),
              "proposals": proposals[:MAX_PROPOSALS],
              "rowAssociationStatus": "UNVERIFIED", "typedFact": None,
              "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RESULT_BYTES:
        raise ValueError("PZ-006 result exceeds bound")
    return result
