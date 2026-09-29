"""Uncoded, review-only table rows from a committed bounded OCR stage.

Caller supplies the trusted SHA-256 of the committed canonical stage bytes.
OCR text and geometry remain observations; no source approval or rule outcome is
inferred from a visually plausible row.
"""

from __future__ import annotations

import re
from typing import Any

from .durable_ocr_layout import (PROFILE_HASH_V4, PROFILE_HASH_V5,
                                 PROFILE_ID_V4, PROFILE_ID_V5,
                                 PROFILE_V4, PROFILE_V5)
from .ocr_pilot import canonical_hash, validate_ocr_artifact


SCHEMA_VERSION = "ocr-table-row-proposals-v1"
PROFILE_ID = "conservative-ocr-table-rows-v1"
SCHEMA_VERSION_V2 = "ocr-table-row-proposals-v2"
PROFILE_ID_V2 = "conservative-ocr-table-rows-v2"
SCHEMA_VERSION_V3 = "ocr-table-row-proposals-v3"
PROFILE_ID_V3 = "conservative-ocr-table-rows-v3"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_HEADERS = ("наименование", "значение")
_MIN_SCORE = 0.8
_MAX_ROW_GAP_PX = 200
_PROFILES = {
    PROFILE_ID_V4: ("bounded-ocr-layout-analysis-v4", PROFILE_HASH_V4, PROFILE_V4),
    PROFILE_ID_V5: ("bounded-ocr-layout-analysis-v5", PROFILE_HASH_V5, PROFILE_V5),
}


def _entry(page: dict[str, Any], index: int, role: str) -> dict[str, Any]:
    line = page["lines"][index]
    return {"role": role, "lineIndex": index, "text": line["text"],
            "bboxPx": line["bboxPx"], "score": line["score"]}


def _overlap_y(first: dict[str, Any], second: dict[str, Any]) -> bool:
    a, b = first["bboxPx"], second["bboxPx"]
    overlap = min(a[3], b[3]) - max(a[1], b[1])
    return overlap > 0 and overlap * 2 >= min(a[3] - a[1], b[3] - b[1])


def _header(page: dict[str, Any]) -> tuple[int, int] | None:
    lines = page["lines"]
    names = [[index for index, line in enumerate(lines)
              if " ".join(line["text"].split()).casefold() == title]
             for title in _HEADERS]
    if any(len(indices) != 1 for indices in names):
        return None
    left_index, right_index = names[0][0], names[1][0]
    left, right = lines[left_index], lines[right_index]
    if (left["score"] < _MIN_SCORE or right["score"] < _MIN_SCORE
            or left["bboxPx"][2] >= right["bboxPx"][0]
            or not _overlap_y(left, right)):
        return None
    return left_index, right_index


def _page_rows(page: dict[str, Any], *, right_lower_tolerance_px: int = 32
               ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    source_id, source_sha = page["sourceFileId"], page["inputSha256"]
    number = page["pageNumber"]

    def abstain(index: int | None, reason: str) -> dict[str, Any]:
        return {"sourceFileId": source_id, "inputSha256": source_sha,
                "pageNumber": number, "lineIndex": index, "reasonCode": reason}

    header = _header(page)
    if header is None:
        return [], [abstain(None, "TWO_COLUMN_HEADER_UNRESOLVED")]
    left_header_index, right_header_index = header
    lines = page["lines"]
    left_header, right_header = lines[left_header_index], lines[right_header_index]
    header_bottom = max(left_header["bboxPx"][3], right_header["bboxPx"][3])
    # The right header anchors the value column. This excludes signatures and
    # revision-stamp text elsewhere on the page, even when vertically aligned.
    right_start = right_header["bboxPx"][0]
    right_end = right_header["bboxPx"][2]
    left_indices = [index for index, line in enumerate(lines)
                    if index not in header and line["bboxPx"][1] >= header_bottom
                    and line["bboxPx"][0] >= page["render"]["widthPx"] * 0.2
                    and line["bboxPx"][0] < right_start - 32
                    and line["bboxPx"][2] <= right_start
                    and len(line["text"].strip()) >= 4
                    and any(character.isalpha() for character in line["text"])]
    right_indices = [index for index, line in enumerate(lines)
                     if index not in header and line["bboxPx"][1] >= header_bottom
                     and right_start - right_lower_tolerance_px <= line["bboxPx"][0] <= right_end + 32
                     and any(character.isdigit() for character in line["text"])]
    edges: dict[int, list[int]] = {}
    reverse: dict[int, list[int]] = {}
    for right_index in right_indices:
        value = lines[right_index]
        matches = [left_index for left_index in left_indices
                   if lines[left_index]["bboxPx"][2] < value["bboxPx"][0]
                   and _overlap_y(lines[left_index], value)]
        if matches:
            edges[right_index] = matches
            for left_index in matches:
                reverse.setdefault(left_index, []).append(right_index)

    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    previous_bottom = header_bottom
    for right_index in sorted(edges, key=lambda index: (lines[index]["bboxPx"][1], index)):
        label_indices = edges[right_index]
        value = lines[right_index]
        if value["bboxPx"][1] - previous_bottom > _MAX_ROW_GAP_PX:
            break
        if len(label_indices) != 1 or len(reverse[label_indices[0]]) != 1:
            abstentions.append(abstain(right_index, "ROW_PAIR_AMBIGUOUS"))
            continue
        left_index = label_indices[0]
        label = lines[left_index]
        if min(label["score"], value["score"]) < _MIN_SCORE:
            abstentions.append(abstain(right_index, "OCR_SCORE_TOO_LOW"))
            continue
        proposals.append({
            "sourceFileId": source_id, "inputSha256": source_sha,
            "pageNumber": number, "ocrPageContentHash": page["contentHash"],
            "renderSha256": page["render"]["sha256"],
            "headerEvidence": [_entry(page, left_header_index, "labelHeader"),
                               _entry(page, right_header_index, "valueHeader")],
            "labelEvidence": _entry(page, left_index, "rowLabel"),
            "valueEvidence": _entry(page, right_index, "rawValue"),
        })
        previous_bottom = max(label["bboxPx"][3], value["bboxPx"][3])
    return proposals, abstentions


def _page_rows_v3(page: dict[str, Any]
                  ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Add at most one adjacent left-side continuation to each unique v2 row.

    The continuation is raw OCR evidence, never a corrected transcription.
    Ambiguous/low-score continuation removes that row rather than silently
    dropping part of its printed label.
    """
    proposals, abstentions = _page_rows(page, right_lower_tolerance_px=64)
    lines = page["lines"]
    used = {entry["lineIndex"] for row in proposals
            for entry in (*row["headerEvidence"], row["labelEvidence"],
                          row["valueEvidence"])}
    header = _header(page)
    if header is None:
        return proposals, abstentions
    right_header = lines[header[1]]["bboxPx"]
    other_values = [index for index, line in enumerate(lines)
                    if index not in header
                    and right_header[0] - 64 <= line["bboxPx"][0] <= right_header[2] + 32
                    and any(character.isdigit() for character in line["text"])]
    candidates: dict[int, list[int]] = {}
    owners: dict[int, list[int]] = {}
    for row_number, row in enumerate(proposals):
        label = row["labelEvidence"]
        value = row["valueEvidence"]
        label_box, value_box = label["bboxPx"], value["bboxPx"]
        matches: list[int] = []
        for index, line in enumerate(lines):
            if index in used or not line["text"].strip():
                continue
            box = line["bboxPx"]
            # Same label column, directly after the first line, and still
            # within this value's printed row. Excludes row ordinal column.
            if (abs(box[0] - label_box[0]) > 24
                    or box[1] <= label_box[1]
                    or box[1] > label_box[3] + 10
                    or box[3] < label_box[3]
                    or box[3] > value_box[3] + 16
                    or box[2] >= value_box[0]
                    or not _overlap_y(line, lines[value["lineIndex"]])):
                continue
            matches.append(index)
            owners.setdefault(index, []).append(row_number)
        candidates[row_number] = matches

    accepted: list[dict[str, Any]] = []
    for row_number, row in enumerate(proposals):
        matches = candidates[row_number]
        value_index = row["valueEvidence"]["lineIndex"]
        reason = None
        if len(matches) > 1 or any(len(owners[index]) != 1 for index in matches):
            reason = "ROW_LABEL_CONTINUATION_AMBIGUOUS"
        elif matches and any(
                other != value_index
                and lines[matches[0]]["bboxPx"][2] < lines[other]["bboxPx"][0]
                and _overlap_y(lines[matches[0]], lines[other])
                for other in other_values):
            reason = "ROW_LABEL_CONTINUATION_AMBIGUOUS"
        elif matches and lines[matches[0]]["score"] < _MIN_SCORE:
            reason = "OCR_SCORE_TOO_LOW"
        if reason is not None:
            abstentions.append({"sourceFileId": row["sourceFileId"],
                               "inputSha256": row["inputSha256"],
                               "pageNumber": row["pageNumber"],
                               "lineIndex": value_index, "reasonCode": reason})
            continue
        accepted.append({**row, "labelContinuationEvidence":
                         [_entry(page, matches[0], "rowLabelContinuation")]
                         if matches else []})
    return accepted, abstentions


def extract_ocr_table_rows(stage: dict[str, Any], *, stage_sha256: str,
                           profile_id: str = PROFILE_ID) -> dict[str, Any]:
    """Pair unique page-local label/value lines; verify committed-stage SHA.

    ``stage_sha256`` must come from trusted stage storage, not from the OCR JSON
    itself. Input pages retain their own content-hash and source-SHA provenance.
    """
    if profile_id not in (PROFILE_ID, PROFILE_ID_V2, PROFILE_ID_V3):
        raise ValueError("OCR table row extraction profile invalid")
    if not isinstance(stage_sha256, str) or _SHA256.fullmatch(stage_sha256) is None:
        raise ValueError("committed OCR stage SHA-256 invalid")
    if not isinstance(stage, dict) or canonical_hash(stage) != stage_sha256:
        raise ValueError("committed OCR stage SHA-256 mismatch")
    stage_profile_id = stage.get("providerProfileId")
    expected = _PROFILES.get(stage_profile_id)
    analysis = stage.get("analysis")
    manifest_hash = stage.get("inputManifestHash")
    if (expected is None or stage.get("schemaVersion") != "analysis-stage-result-v2"
            or stage.get("jobType") != "DOCUMENT_OCR_LAYOUT"
            or stage.get("providerKind") != "OCR_LAYOUT"
            or stage.get("disposition") != "OCR_LAYOUT_BOUNDED"
            or stage.get("reasonCode") != "BOUNDED_OCR_ONLY"
            or stage.get("providerConfigHash") != expected[1]
            or not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None
            or not isinstance(analysis, dict)
            or analysis.get("schemaVersion") != expected[0]
            or analysis.get("profile") != expected[2]
            or analysis.get("inputManifestHash") != manifest_hash
            or not isinstance(analysis.get("sources"), list)
            or type(analysis.get("sourceCount")) is not int
            or analysis["sourceCount"] != len(analysis["sources"])
            or type(analysis.get("processedPageCount")) is not int
            or type(stage.get("outputCount")) is not int
            or stage.get("outputCount") != analysis["processedPageCount"]):
        raise ValueError("committed bounded OCR stage schema or profile invalid")

    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    processed = 0
    for source in analysis["sources"]:
        if not isinstance(source, dict):
            raise ValueError("OCR source invalid")
        source_id, source_hash, pages = (source.get(key) for key in
                                         ("sourceFileId", "sourceSha256", "pages"))
        if (not isinstance(source_id, str) or not source_id or source_id in seen_sources
                or not isinstance(source_hash, str) or _SHA256.fullmatch(source_hash) is None
                or not isinstance(pages, list) or type(source.get("processedPageCount")) is not int
                or source["processedPageCount"] != len(pages)):
            raise ValueError("OCR source identity or page count invalid")
        seen_sources.add(source_id)
        seen_pages: set[int] = set()
        for page in pages:
            if not isinstance(page, dict) or type(page.get("pageNumber")) is not int:
                raise ValueError("OCR page invalid")
            number = page["pageNumber"]
            if number < 1 or number in seen_pages:
                raise ValueError("OCR page number duplicated or invalid")
            seen_pages.add(number)
            validate_ocr_artifact(page, source_id=source_id, source_hash=source_hash,
                                  page_number=number)
            if profile_id == PROFILE_ID_V3:
                page_proposals, page_abstentions = _page_rows_v3(page)
            else:
                page_proposals, page_abstentions = _page_rows(
                    page, right_lower_tolerance_px=64 if profile_id == PROFILE_ID_V2 else 32)
            proposals.extend(page_proposals)
            abstentions.extend(page_abstentions)
            processed += 1
    if processed != analysis["processedPageCount"]:
        raise ValueError("OCR processed page count invalid")
    result = {"schemaVersion": (SCHEMA_VERSION_V3 if profile_id == PROFILE_ID_V3 else
                                SCHEMA_VERSION_V2 if profile_id == PROFILE_ID_V2 else
                                SCHEMA_VERSION),
              "profileId": profile_id,
              "ocrStageSha256": stage_sha256, "inputManifestHash": manifest_hash,
              "proposals": proposals, "abstentions": abstentions, "findingCount": 0}
    result["contentHash"] = canonical_hash(result)
    return result
