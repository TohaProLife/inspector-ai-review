"""Conservative thermal-row proposals from committed bounded OCR pages.

This is an independent review aid. It never creates PZ-017 facts, comparisons,
coverage, or findings. Page stage comes from the immutable source manifest
for single-stage files, or from reviewed page assignments for mixed files.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any

from .ocr_pilot import validate_ocr_artifact


PROFILE_ID = "conservative-ocr-heat-rows-v1"
SCHEMA_VERSION = "ocr-heat-row-proposals-v1"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_PAIR = re.compile(
    r"\s*(?P<kw>\d+(?:[.,]\d+)?)\s*(?:кВт|КВТ|квт)\.?\s*\(\s*"
    r"(?P<gcal>\d+(?:[.,]\d+)?)\s*(?:Гкал|ГКАЛ|гкал)\s*/\s*(?:час|ч|ЧАС|Ч)\s*\)\s*",
)
_THERMAL_VALUE = re.compile(r"\d[\d.,]*\s*(?:кВт|Гкал)\b", re.IGNORECASE)
_SECTION = (
    ("HEATING", re.compile(r"^\s*Система\s+отопления\s*$", re.I)),
    ("VENTILATION", re.compile(r"^\s*Теплоснабжение\s+вентиляции\s*$", re.I)),
    ("DHW", re.compile(r"^\s*Система\s+горячего\s+водоснабжения\s*$", re.I)),
)
_HEATING = re.compile(r"^\s*Расчетный\s+расход\s+тепла\s+на\s+отопление\b", re.I)
_VENTILATION = re.compile(r"^\s*Расчетный\s+расход\s+тепла\s*$", re.I)
_DHW_MAX = re.compile(r"^\s*Максимальный\s+расчетный\s+расход\s+тепла\s+с\s+учетом\s*$", re.I)
_DHW_MEAN = re.compile(r"^\s*Средний\s+расчетный\s+расход\s+тепла\s*$", re.I)
_CIRCULATION = re.compile(r"^\s*циркуляции\s*$", re.I)
_KW_PER_GCAL_H = Decimal("1163")
_PAIR_TOLERANCE_KW = Decimal("0.65")
_MIN_OCR_SCORE = 0.75


def _entry(page: dict[str, Any], index: int, role: str) -> dict[str, Any]:
    line = page["lines"][index]
    return {"role": role, "lineIndex": index, "text": line["text"],
            "bboxPx": line["bboxPx"], "score": line["score"]}


def _center_y(line: dict[str, Any]) -> float:
    return (line["bboxPx"][1] + line["bboxPx"][3]) / 2


def _near_row(label: dict[str, Any], value: dict[str, Any]) -> bool:
    """Require label in left column on the same OCR row."""
    return (label["bboxPx"][2] < value["bboxPx"][0]
            and abs(_center_y(label) - _center_y(value)) <= 24)


def _sections(page: dict[str, Any]) -> list[tuple[int, str]]:
    result = []
    for index, line in enumerate(page["lines"]):
        for component, pattern in _SECTION:
            if pattern.fullmatch(line["text"]):
                result.append((index, component))
    result.sort(key=lambda item: _center_y(page["lines"][item[0]]))
    return result


def _section_for_value(page: dict[str, Any], sections: list[tuple[int, str]],
                       value: dict[str, Any]) -> tuple[int, str] | None:
    prior = [(index, component) for index, component in sections
             if 0 < _center_y(value) - _center_y(page["lines"][index]) <= 300]
    return prior[-1] if prior else None


def _labels_for_value(page: dict[str, Any], value_index: int, component: str,
                      section_index: int) -> list[tuple[int, str]]:
    value = page["lines"][value_index]
    section_y = _center_y(page["lines"][section_index])
    matches = []
    for index, line in enumerate(page["lines"]):
        if index in {section_index, value_index} or _center_y(line) <= section_y:
            continue
        if not _near_row(line, value):
            continue
        raw = line["text"]
        if component == "HEATING" and _HEATING.search(raw):
            matches.append((index, "DESIGN_HEAT_RATE"))
        elif component == "VENTILATION" and _VENTILATION.fullmatch(raw):
            matches.append((index, "DESIGN_HEAT_RATE"))
        elif component == "DHW" and _DHW_MAX.fullmatch(raw):
            matches.append((index, "MAX_INCLUDING_CIRCULATION"))
        elif component == "DHW" and _DHW_MEAN.fullmatch(raw):
            matches.append((index, "MEAN"))
    return matches


def _continuation(page: dict[str, Any], label_index: int, value_index: int) -> int | None:
    label = page["lines"][label_index]
    value = page["lines"][value_index]
    options = []
    for index, line in enumerate(page["lines"]):
        if not _CIRCULATION.fullmatch(line["text"]):
            continue
        if (abs(line["bboxPx"][0] - label["bboxPx"][0]) <= 25
                and 0 <= _center_y(line) - _center_y(label) <= 35
                and line["bboxPx"][2] < value["bboxPx"][0]):
            options.append(index)
    return options[0] if len(options) == 1 else None


def _pair_values(raw: str) -> dict[str, str] | None:
    match = _PAIR.fullmatch(raw)
    if match is None:
        return None
    kw_text = match.group("kw").replace(",", ".")
    gcal_text = match.group("gcal").replace(",", ".")
    for number_text in (kw_text, gcal_text):
        whole, separator, fraction = number_text.partition(".")
        if len(whole) > 12 or (separator and len(fraction) > 6):
            return None
    try:
        kw = Decimal(kw_text)
        gcal = Decimal(gcal_text)
    except InvalidOperation:
        return None
    if not kw.is_finite() or not gcal.is_finite() or kw <= 0 or gcal <= 0:
        return None
    # Keep OCR's digit spelling after decimal-separator normalization. The
    # independent API re-derives these strings from the same source line.
    return {"kW": kw_text, "Gcal/h": gcal_text}


def _abstention(page: dict[str, Any], value_index: int, reason: str,
                evidence: list[dict[str, Any]]) -> dict[str, Any]:
    return {"sourceFileId": page["sourceFileId"], "inputSha256": page["inputSha256"],
            "pageNumber": page["pageNumber"], "lineIndex": value_index,
            "reasonCode": reason, "evidence": evidence}


def extract_ocr_heat_rows(stage: dict[str, Any],
                          source_review: dict[str, dict[str, Any]],
                          source_files: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract paired heat-rate rows; hold every unsupported interpretation.

    ``source_files`` is the lease's immutable manifest projection. Review
    assignments are needed only when a source has multiple stages.
    Revision/approval remain external gates.
    """
    if (not isinstance(stage, dict)
            or stage.get("schemaVersion") != "analysis-stage-result-v2"
            or stage.get("providerProfileId") not in {
                "local-bounded-ocr-layout-v3", "local-bounded-ocr-layout-v4",
                "local-bounded-ocr-layout-v5"}):
        raise ValueError("OCR heat rows require committed bounded OCR stage")
    analysis = stage.get("analysis")
    manifest_hash = stage.get("inputManifestHash")
    if (not isinstance(analysis, dict)
            or analysis.get("schemaVersion") != (
                "bounded-ocr-layout-analysis-v5" if stage["providerProfileId"].endswith("v5")
                else "bounded-ocr-layout-analysis-v4" if stage["providerProfileId"].endswith("v4")
                else "bounded-ocr-layout-analysis-v3")
            or not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None
            or analysis.get("inputManifestHash") != manifest_hash
            or not isinstance(analysis.get("sources"), list)
            or not isinstance(source_review, dict) or not isinstance(source_files, list)):
        raise ValueError("OCR heat rows stage or source review invalid")

    manifest_sources: dict[str, dict[str, Any]] = {}
    for source_file in source_files:
        if not isinstance(source_file, dict):
            raise ValueError("OCR heat rows manifest source invalid")
        source_id = source_file.get("sourceFileId")
        source_hash = source_file.get("sha256")
        stages = source_file.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in manifest_sources
                or not isinstance(source_hash, str) or _SHA256.fullmatch(source_hash) is None
                or not isinstance(stages, list) or not stages
                or any(item not in {"PD", "RD", "ID"} for item in stages)
                or len(stages) != len(set(stages))):
            raise ValueError("OCR heat rows manifest source identity or stages invalid")
        manifest_sources[source_id] = source_file
    if set(source_review) - set(manifest_sources):
        raise ValueError("OCR heat rows review contains unknown source")

    proposals: list[dict[str, Any]] = []
    abstentions: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for source in analysis["sources"]:
        if not isinstance(source, dict):
            raise ValueError("OCR heat rows source invalid")
        source_id = source.get("sourceFileId")
        source_hash = source.get("sourceSha256")
        pages = source.get("pages")
        if (not isinstance(source_id, str) or not source_id or source_id in seen_sources
                or not isinstance(source_hash, str) or _SHA256.fullmatch(source_hash) is None
                or not isinstance(pages, list)):
            raise ValueError("OCR heat rows source identity or pages invalid")
        seen_sources.add(source_id)
        manifest_source = manifest_sources.get(source_id)
        if manifest_source is None or manifest_source["sha256"] != source_hash:
            raise ValueError("OCR heat rows source differs from immutable manifest")
        source_stages = manifest_source["stages"]
        if not pages:
            continue
        review = source_review.get(source_id)
        if review is None:
            page_stages = {}
        elif not isinstance(review, dict) or review.get("sourceSha256") != source_hash:
            raise ValueError("OCR heat rows source review SHA missing or stale")
        else:
            page_stages = review.get("pageStages")
        if not isinstance(page_stages, dict):
            raise ValueError("OCR heat rows pageStages invalid")
        if any(mapped not in {*source_stages, "UNRESOLVED"} for mapped in page_stages.values()):
            raise ValueError("OCR heat rows page stage differs from source stages")
        seen_pages: set[int] = set()
        for page in pages:
            if not isinstance(page, dict) or type(page.get("pageNumber")) is not int:
                raise ValueError("OCR heat rows page invalid")
            number = page["pageNumber"]
            if number < 1 or number in seen_pages:
                raise ValueError("OCR heat rows duplicate page")
            seen_pages.add(number)
            validate_ocr_artifact(page, source_id=source_id, source_hash=source_hash,
                                  page_number=number)
            sections = _sections(page)
            stage_for_page = page_stages.get(str(number),
                                             source_stages[0] if len(source_stages) == 1 else None)
            if stage_for_page not in {"PD", "RD", "ID", "UNRESOLVED", None}:
                raise ValueError("OCR heat rows page stage invalid")
            for index, value in enumerate(page["lines"]):
                if not _THERMAL_VALUE.search(value["text"]):
                    continue
                evidence = [_entry(page, index, "value")]
                if stage_for_page != "RD":
                    abstentions.append(_abstention(page, index, "PAGE_STAGE_UNRESOLVED" if
                                                   stage_for_page in {None, "UNRESOLVED"} else
                                                   "PAGE_STAGE_NOT_RD", evidence))
                    continue
                section = _section_for_value(page, sections, value)
                if section is None:
                    abstentions.append(_abstention(page, index, "SECTION_UNRESOLVED", evidence))
                    continue
                section_index, component = section
                matches = _labels_for_value(page, index, component, section_index)
                if len(matches) != 1:
                    abstentions.append(_abstention(page, index, "ROW_LABEL_UNRESOLVED", evidence))
                    continue
                label_index, basis = matches[0]
                evidence = [_entry(page, section_index, "section"),
                            _entry(page, label_index, "rowLabel")]
                if basis == "MAX_INCLUDING_CIRCULATION":
                    continuation = _continuation(page, label_index, index)
                    if continuation is None:
                        abstentions.append(_abstention(page, index, "BASIS_AMBIGUOUS",
                                                       [*evidence, _entry(page, index, "value")]))
                        continue
                    evidence.append(_entry(page, continuation, "basisContinuation"))
                evidence.append(_entry(page, index, "value"))
                if any(item["score"] < _MIN_OCR_SCORE for item in evidence):
                    abstentions.append(_abstention(page, index, "OCR_SCORE_TOO_LOW", evidence))
                    continue
                values = _pair_values(value["text"])
                if values is None:
                    abstentions.append(_abstention(page, index, "OCR_UNIT_UNREADABLE", evidence))
                    continue
                if abs(Decimal(values["kW"]) - Decimal(values["Gcal/h"]) * _KW_PER_GCAL_H) > _PAIR_TOLERANCE_KW:
                    abstentions.append(_abstention(page, index, "PAIRED_UNITS_CONTRADICT", evidence))
                    continue
                proposals.append({
                    "sourceFileId": source_id, "inputSha256": source_hash,
                    "pageNumber": number, "stage": "RD", "component": component,
                    "basis": basis, "values": values,
                    "ocrPageContentHash": page["contentHash"],
                    "renderSha256": page["render"]["sha256"], "evidence": evidence,
                })

    by_key: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for proposal in proposals:
        key = proposal["sourceFileId"], proposal["component"], proposal["basis"]
        by_key.setdefault(key, []).append(proposal)
    unique: list[dict[str, Any]] = []
    for proposal in proposals:
        key = proposal["sourceFileId"], proposal["component"], proposal["basis"]
        if len(by_key[key]) > 1:
            abstentions.append({
                "sourceFileId": proposal["sourceFileId"], "inputSha256": proposal["inputSha256"],
                "pageNumber": proposal["pageNumber"],
                "lineIndex": proposal["evidence"][-1]["lineIndex"],
                "reasonCode": "DUPLICATE_COMPONENT_BASIS", "evidence": proposal["evidence"],
            })
        else:
            unique.append(proposal)
    return {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
            "inputManifestHash": manifest_hash, "proposals": unique,
            "abstentions": abstentions, "findingCount": 0}
