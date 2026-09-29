"""Bounded numeric rule executor with source and evidence gates.

Facts must be extracted upstream from immutable source blocks. This module
checks their provenance and comparison semantics; it never infers missing facts.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from .numeric_extraction import building_area_matches
from .ocr_pilot import validate_ocr_artifact
from .parameter_routing import _validate_artifact
from .table_rows import validate_table_row_fact
from .table_visual import crosscheck_table_fact


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_NUMBER = re.compile(r"-?[0-9]+(?:[.,][0-9]+)?\Z")
_GROUPED_NUMBER = re.compile(r"-?(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?\Z")
_AREA_FACTORS = {
    "m2": Decimal("1"),
    "m²": Decimal("1"),
    "м2": Decimal("1"),
    "м²": Decimal("1"),
    "кв.м": Decimal("1"),
    "cm2": Decimal("0.0001"),
    "cm²": Decimal("0.0001"),
    "см2": Decimal("0.0001"),
    "см²": Decimal("0.0001"),
    "mm2": Decimal("0.000001"),
    "mm²": Decimal("0.000001"),
    "мм2": Decimal("0.000001"),
    "мм²": Decimal("0.000001"),
}


def _required_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _result(rule: dict[str, Any], status: str, reason: str, **fields: object) -> dict[str, Any]:
    return {
        "schemaVersion": "typed-rule-result-v1",
        "ruleId": rule["ruleId"],
        "ruleVersion": rule["version"],
        "parameterCode": rule["parameterCode"],
        "objectId": rule["objectId"],
        "executionStatus": "SUCCEEDED",
        "machineStatus": status,
        "reasonCode": reason,
        "entityKey": None,
        "normalizedExpected": None,
        "normalizedActual": None,
        "delta": None,
        "canonicalUnit": rule["canonicalUnit"],
        "evidence": [],
        "evidenceFingerprint": None,
        **fields,
    }


def _parse_area(raw_value: object, unit: object) -> Decimal | None:
    if not isinstance(raw_value, str) or not isinstance(unit, str):
        return None
    if _GROUPED_NUMBER.fullmatch(raw_value) is None:
        return None
    clean = raw_value.replace("\u00a0", "").replace(" ", "")
    factor = _AREA_FACTORS.get(unit.strip().casefold())
    if factor is None:
        return None
    try:
        number = Decimal(clean.replace(",", ".")) * factor
    except InvalidOperation:
        return None
    return number if number.is_finite() and number >= 0 else None


def _validate_rule(rule: dict[str, Any]) -> Decimal:
    if not isinstance(rule, dict) or rule.get("schemaVersion") != "typed-numeric-rule-v1":
        raise ValueError("numeric rule schemaVersion is invalid")
    for key in ("ruleId", "version", "parameterCode", "objectId"):
        _required_string(rule.get(key), key)
    if rule["parameterCode"] != "PZ-002":
        raise ValueError("typed-numeric-rule-v1 currently supports only PZ-002")
    if rule.get("expectedStage") != "PD" or rule.get("actualStage") not in {"RD", "ID"}:
        raise ValueError("numeric rule requires PD as expected and RD/ID as actual")
    if rule.get("canonicalUnit") != "m2":
        raise ValueError("numeric rule canonicalUnit must be m2")
    comparator = rule.get("comparator")
    if (not isinstance(comparator, dict) or comparator.get("family") != "RELATIVE_DELTA"
            or comparator.get("operator") != ">"):
        raise ValueError("numeric rule comparator must be RELATIVE_DELTA >")
    threshold = comparator.get("threshold")
    if not isinstance(threshold, str) or _NUMBER.fullmatch(threshold) is None:
        raise ValueError("numeric rule threshold must be a non-negative decimal string")
    value = Decimal(threshold.replace(",", "."))
    if not value.is_finite() or value < 0:
        raise ValueError("numeric rule threshold must be non-negative and finite")
    return value


def evaluate_numeric_rule(
    rule: dict[str, Any],
    sources: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
    facts: list[dict[str, Any]],
    *,
    ocr_artifacts: list[dict[str, Any]] | None = None,
    table_ocr_artifacts: list[dict[str, Any]] | None = None,
    table_crosschecks: list[dict[str, Any]] | None = None,
    search_complete: bool = True,
) -> dict[str, Any]:
    """Compare one PD fact with one RD/ID fact; abstain on unresolved gates."""
    threshold = _validate_rule(rule)
    if not isinstance(sources, list) or not isinstance(artifacts, list) or not isinstance(facts, list):
        raise ValueError("sources, artifacts and facts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("source must be an object")
        source_id = _required_string(source.get("sourceFileId"), "sourceFileId")
        if source_id in source_index:
            raise ValueError("duplicate sourceFileId")
        source_hash = source.get("sha256")
        if not isinstance(source_hash, str) or _HASH.fullmatch(source_hash) is None:
            raise ValueError("source sha256 is invalid")
        source_index[source_id] = source
    artifact_index: dict[str, dict[str, Any]] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ValueError("text artifact must be an object")
        source_id = _required_string(artifact.get("sourceFileId"), "artifact sourceFileId")
        if source_id not in source_index or source_id in artifact_index:
            raise ValueError("unknown or duplicate text artifact sourceFileId")
        _validate_artifact(artifact, source_index[source_id])
        artifact_index[source_id] = artifact
    ocr_index: dict[tuple[str, int], dict[str, Any]] = {}
    for artifact in ocr_artifacts or []:
        if not isinstance(artifact, dict):
            raise ValueError("OCR artifact must be an object")
        source_id = _required_string(artifact.get("sourceFileId"), "OCR sourceFileId")
        page_number = artifact.get("pageNumber")
        if source_id not in source_index or type(page_number) is not int:
            raise ValueError("OCR artifact source or page is invalid")
        key = (source_id, page_number)
        if key in ocr_index:
            raise ValueError("duplicate OCR artifact page")
        validate_ocr_artifact(artifact, source_id=source_id,
                              source_hash=source_index[source_id]["sha256"], page_number=page_number)
        ocr_index[key] = artifact
    table_ocr_index: dict[tuple[str, int], dict[str, Any]] = {}
    for artifact in table_ocr_artifacts or []:
        if not isinstance(artifact, dict):
            raise ValueError("table OCR artifact must be an object")
        source_id = _required_string(artifact.get("sourceFileId"), "table OCR sourceFileId")
        page_number = artifact.get("pageNumber")
        if source_id not in source_index or type(page_number) is not int:
            raise ValueError("table OCR artifact source or page is invalid")
        key = (source_id, page_number)
        if key in table_ocr_index:
            raise ValueError("duplicate table OCR artifact page")
        validate_ocr_artifact(artifact, source_id=source_id,
                              source_hash=source_index[source_id]["sha256"], page_number=page_number)
        table_ocr_index[key] = artifact

    per_stage: dict[str, list[dict[str, Any]]] = {rule["expectedStage"]: [], rule["actualStage"]: []}
    for fact in facts:
        if not isinstance(fact, dict):
            raise ValueError("fact must be an object")
        source_id = _required_string(fact.get("sourceFileId"), "fact sourceFileId")
        source = source_index.get(source_id)
        if source is None:
            return _result(rule, "NOT_COMPARABLE", "SOURCE_OUTSIDE_MANIFEST")
        if source.get("objectId") != rule["objectId"]:
            return _result(rule, "NOT_COMPARABLE", "CROSS_OBJECT_SOURCE")
        if fact.get("inputSha256") != source["sha256"]:
            return _result(rule, "NOT_COMPARABLE", "SOURCE_HASH_MISMATCH")
        stages = source.get("stages")
        if not isinstance(stages, list) or not stages:
            return _result(rule, "NOT_COMPARABLE", "SOURCE_STAGE_UNKNOWN")
        page_number = fact.get("pageNumber")
        if type(page_number) is not int or page_number < 1:
            return _result(rule, "NOT_COMPARABLE", "INVALID_PAGE_LOCATOR")
        if len(stages) > 1:
            stage = source.get("pageStages", {}).get(str(page_number))
            if stage is None:
                return _result(rule, "CLARIFICATION_REQUIRED", "STAGE_SEGMENTATION_REQUIRED")
            if stage == "UNRESOLVED":
                return _result(rule, "CLARIFICATION_REQUIRED", "STAGE_SEGMENTATION_REQUIRED")
            if stage not in stages:
                return _result(rule, "NOT_COMPARABLE", "SOURCE_STAGE_MISMATCH")
        else:
            stage = stages[0]
        if stage not in per_stage:
            return _result(rule, "NOT_COMPARABLE", "SOURCE_STAGE_MISMATCH")
        per_stage[stage].append(fact)

    if any(not values for values in per_stage.values()):
        return _result(rule, "MISSING_EVIDENCE", "REQUIRED_STAGE_FACT_MISSING")
    if any(len(values) != 1 for values in per_stage.values()):
        return _result(rule, "CLARIFICATION_REQUIRED", "AMBIGUOUS_FACTS")

    selected = [per_stage[rule["expectedStage"]][0], per_stage[rule["actualStage"]][0]]
    if selected[0].get("entityKey") != selected[1].get("entityKey"):
        return _result(rule, "CLARIFICATION_REQUIRED", "ENTITY_LINK_CONFLICT")
    entity_key = selected[0].get("entityKey")
    if not isinstance(entity_key, str) or not entity_key.strip():
        return _result(rule, "CLARIFICATION_REQUIRED", "ENTITY_UNRESOLVED")

    selected_sources = [source_index[fact["sourceFileId"]] for fact in selected]
    for source in selected_sources:
        if len(source["stages"]) > 1:
            artifact = artifact_index.get(source["sourceFileId"])
            mapping = source.get("pageStages", {})
            if (artifact is None or len(mapping) != artifact["pageCount"]
                    or "UNRESOLVED" in mapping.values()):
                return _result(rule, "CLARIFICATION_REQUIRED", "STAGE_SEGMENTATION_REQUIRED")
        if source.get("revisionStatus") == "SUPERSEDED":
            return _result(rule, "NOT_COMPARABLE", "SUPERSEDED_REVISION")
        if source.get("revisionStatus") != "CURRENT":
            return _result(rule, "CLARIFICATION_REQUIRED", "REVISION_UNRESOLVED")
        if source.get("approvalStatus") == "UNAPPROVED":
            return _result(rule, "NOT_COMPARABLE", "SOURCE_UNAPPROVED")
        if source.get("approvalStatus") != "APPROVED":
            return _result(rule, "CLARIFICATION_REQUIRED", "APPROVAL_UNRESOLVED")
    link_groups = [source.get("linkGroupId") for source in selected_sources]
    if any(not isinstance(group, str) or not group.strip() for group in link_groups):
        return _result(rule, "CLARIFICATION_REQUIRED", "LINK_UNRESOLVED")
    if link_groups[0] != link_groups[1]:
        return _result(rule, "NOT_COMPARABLE", "LINK_CONFLICT")

    evidence: list[dict[str, Any]] = []
    values: list[Decimal] = []
    for stage, fact, source in zip((rule["expectedStage"], rule["actualStage"]), selected, selected_sources):
        artifact = artifact_index.get(fact["sourceFileId"])
        if artifact is None:
            return _result(rule, "MISSING_EVIDENCE", "TEXT_ARTIFACT_MISSING")
        page_number = fact["pageNumber"]
        if page_number > artifact["pageCount"]:
            return _result(rule, "NOT_COMPARABLE", "INVALID_PAGE_LOCATOR")
        page = artifact["pages"][page_number - 1]
        raw_value = fact.get("rawValue")
        if not isinstance(fact.get("unit"), str) or fact["unit"].strip().casefold() not in _AREA_FACTORS:
            return _result(rule, "NOT_COMPARABLE", "INVALID_UNIT")
        raw_unit = fact.get("rawUnit", fact["unit"])
        if not isinstance(raw_value, str) or not isinstance(raw_unit, str) or not raw_unit:
            return _result(rule, "NOT_COMPARABLE", "INVALID_VALUE")
        if re.sub(r"[ \u00a0]", "", raw_unit).rstrip(".").casefold() != fact["unit"].strip().casefold():
            return _result(rule, "NOT_COMPARABLE", "RAW_UNIT_MISMATCH")
        if fact.get("evidenceKind", "TEXT_LAYER") == "OCR":
            if page["quality"]["disposition"] != "OCR_REQUIRED":
                return _result(rule, "NOT_COMPARABLE", "OCR_PAGE_NOT_REQUIRED")
            ocr = ocr_index.get((fact["sourceFileId"], page_number))
            if ocr is None:
                return _result(rule, "MISSING_EVIDENCE", "OCR_ARTIFACT_MISSING")
            if fact.get("ocrArtifactHash") != ocr["contentHash"]:
                return _result(rule, "NOT_COMPARABLE", "OCR_ARTIFACT_HASH_MISMATCH")
            indexes = fact.get("lineIndexes")
            if (not isinstance(indexes, list) or not 1 <= len(indexes) <= 3
                    or any(type(index) is not int or index < 0 or index >= len(ocr["lines"]) for index in indexes)
                    or indexes != list(range(indexes[0], indexes[0] + len(indexes)))):
                return _result(rule, "NOT_COMPARABLE", "INVALID_OCR_LINE_LOCATOR")
            lines = [ocr["lines"][index] for index in indexes]
            text = " ".join(line["text"].strip() for line in lines)
            if not any(match.group("value") == raw_value and match.group("unit") == raw_unit
                       for match in building_area_matches(text)):
                return _result(rule, "NOT_COMPARABLE", "VALUE_UNIT_NOT_IN_OCR_LINES")
            boxes = [line["bboxPx"] for line in lines]
            locator = {
                "evidenceKind": "OCR", "coordinateSystem": "RENDER_TOP_LEFT_PX",
                "ocrArtifactHash": ocr["contentHash"], "renderSha256": ocr["render"]["sha256"],
                "renderWidthPx": ocr["render"]["widthPx"],
                "renderHeightPx": ocr["render"]["heightPx"],
                "ocrProfileId": ocr["provider"]["profileId"], "lineIndexes": indexes,
                "bboxPx": [min(box[0] for box in boxes), min(box[1] for box in boxes),
                           max(box[2] for box in boxes), max(box[3] for box in boxes)],
                "minimumOcrScore": min(line["score"] for line in lines),
            }
        elif fact.get("evidenceKind") == "TABLE_ROW":
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                return _result(rule, "MISSING_EVIDENCE", "OCR_REQUIRED")
            if not validate_table_row_fact(fact, page):
                return _result(rule, "NOT_COMPARABLE", "TABLE_ROW_PROVENANCE_MISMATCH")
            visual = (crosscheck_table_fact(fact, table_ocr_index[(fact["sourceFileId"], page_number)])
                      if (fact["sourceFileId"], page_number) in table_ocr_index else None)
            if visual is None or visual not in (table_crosschecks or []):
                return _result(rule, "CLARIFICATION_REQUIRED", "TABLE_VISUAL_UNVERIFIED")
            boxes = [item["bboxMilliPoints"] for item in fact["tableRow"].values()]
            locator = {
                "evidenceKind": "TABLE_ROW", "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
                "tableRow": fact["tableRow"], "tableVisual": visual,
                "bboxMilliPoints": [min(box[0] for box in boxes), min(box[1] for box in boxes),
                                    max(box[2] for box in boxes), max(box[3] for box in boxes)],
            }
        elif fact.get("evidenceKind", "TEXT_LAYER") == "TEXT_LAYER":
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                return _result(rule, "MISSING_EVIDENCE", "OCR_REQUIRED")
            block_index = fact.get("blockIndex")
            if type(block_index) is not int or block_index < 0 or block_index >= len(page["blocks"]):
                return _result(rule, "NOT_COMPARABLE", "INVALID_BLOCK_LOCATOR")
            block = page["blocks"][block_index]
            if re.search(r"(?<!\w)" + re.escape(raw_value) + r"(?!\w)", block["text"]) is None:
                return _result(rule, "NOT_COMPARABLE", "VALUE_NOT_IN_SOURCE_BLOCK")
            value_then_unit = re.escape(raw_value) + r"\s*" + re.escape(raw_unit)
            unit_then_value = re.escape(raw_unit) + r"\s*" + re.escape(raw_value)
            if not (re.search(value_then_unit, block["text"], re.IGNORECASE)
                    or re.search(unit_then_value, block["text"], re.IGNORECASE)):
                return _result(rule, "NOT_COMPARABLE", "VALUE_UNIT_NOT_IN_SOURCE_BLOCK")
            if not any(match.group("value") == raw_value and match.group("unit") == raw_unit
                       for match in building_area_matches(block["text"])):
                return _result(rule, "NOT_COMPARABLE", "PZ_002_LABEL_NOT_IN_SOURCE_BLOCK")
            locator = {"evidenceKind": "TEXT_LAYER", "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
                       "blockIndex": block_index, "bboxMilliPoints": block["bboxMilliPoints"]}
        else:
            return _result(rule, "NOT_COMPARABLE", "UNKNOWN_EVIDENCE_KIND")
        normalized = _parse_area(raw_value, fact.get("unit"))
        if normalized is None:
            return _result(rule, "NOT_COMPARABLE", "INVALID_VALUE")
        values.append(normalized)
        evidence.append({
            "role": "EXPECTED" if stage == rule["expectedStage"] else "ACTUAL",
            "stage": stage,
            "sourceFileId": fact["sourceFileId"],
            "inputSha256": source["sha256"],
            "pageNumber": page_number,
            **locator,
            "rawValue": raw_value,
            "rawUnit": raw_unit,
            "sourceUnit": fact["unit"],
            "normalizedValue": str(normalized),
            "canonicalUnit": "m2",
        })
    expected, actual = values
    if expected == 0:
        return _result(rule, "NOT_COMPARABLE", "ZERO_BASELINE", entityKey=entity_key, evidence=evidence)
    delta = abs(actual - expected) / abs(expected)
    if not search_complete:
        return _result(
            rule, "CLARIFICATION_REQUIRED", "SEARCH_SCOPE_INCOMPLETE",
            entityKey=entity_key,
            normalizedExpected=str(expected),
            normalizedActual=str(actual),
            delta=str(delta),
            evidence=evidence,
        )
    if delta <= threshold:
        return _result(
            rule, "CLARIFICATION_REQUIRED", "NEGATIVE_COVERAGE_UNVERIFIED",
            entityKey=entity_key,
            normalizedExpected=str(expected),
            normalizedActual=str(actual),
            delta=str(delta),
            evidence=evidence,
        )
    fingerprint_payload = {
        "ruleId": rule["ruleId"],
        "ruleVersion": rule["version"],
        "parameterCode": rule["parameterCode"],
        "objectId": rule["objectId"],
        "entityKey": entity_key,
        "evidence": evidence,
    }
    fingerprint = hashlib.sha256(json.dumps(
        fingerprint_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    return _result(
        rule, "CANDIDATE", "THRESHOLD_EXCEEDED_OCR_REVIEW_REQUIRED" if any(
            item["evidenceKind"] == "OCR" for item in evidence) else "THRESHOLD_EXCEEDED",
        entityKey=entity_key,
        normalizedExpected=str(expected),
        normalizedActual=str(actual),
        delta=str(delta),
        evidence=evidence,
        evidenceFingerprint=fingerprint,
    )
