"""Fail-closed comparison of explicitly linked, pinned PD and RD/ID facts.

This module checks internal provenance and comparison semantics. A caller must
separately verify rawText and locator against a committed text artifact. Results
are review proposals only; they never establish a durable finding or coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_NUMBER = re.compile(r"(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?\Z")
_CLASS = re.compile(r"[BВ]([0-9]+(?:[.,][0-9]+)?)\Z")
_FACT_SCHEMA = "typed-fact-v1"
_RULE_SCHEMA = "fact-comparison-rule-v1"
_LINK_SCHEMA = "fact-entity-link-v1"
_RESULT_SCHEMA = "fact-comparison-result-v1"

_UNITS: dict[str, dict[str, Decimal]] = {
    "m2": {"m2": Decimal(1), "m²": Decimal(1), "м2": Decimal(1), "м²": Decimal(1),
           "кв.м": Decimal(1), "кв. м": Decimal(1), "cm2": Decimal("0.0001"),
           "cm²": Decimal("0.0001"), "см2": Decimal("0.0001"), "см²": Decimal("0.0001"),
           "mm2": Decimal("0.000001"), "mm²": Decimal("0.000001"),
           "мм2": Decimal("0.000001"), "мм²": Decimal("0.000001")},
    "m3": {"m3": Decimal(1), "m³": Decimal(1), "м3": Decimal(1), "м³": Decimal(1),
           "куб.м": Decimal(1), "куб. м": Decimal(1), "cm3": Decimal("0.000001"),
           "cm³": Decimal("0.000001"), "см3": Decimal("0.000001"),
           "см³": Decimal("0.000001"), "mm3": Decimal("0.000000001"),
           "mm³": Decimal("0.000000001"), "мм3": Decimal("0.000000001"),
           "мм³": Decimal("0.000000001"), "тыс. м3": Decimal(1000),
           "тыс. м³": Decimal(1000), "тыс. куб.м": Decimal(1000),
           "тыс. куб. м": Decimal(1000)},
    "mm": {"mm": Decimal(1), "мм": Decimal(1), "cm": Decimal(10), "см": Decimal(10),
           "m": Decimal(1000), "м": Decimal(1000)},
    "count": {"count": Decimal(1), "pcs": Decimal(1), "шт": Decimal(1),
              "шт.": Decimal(1), "ед": Decimal(1), "ед.": Decimal(1),
              "кв.": Decimal(1),
              "этаж": Decimal(1), "этажа": Decimal(1), "этажей": Decimal(1),
              "эт.": Decimal(1), "этажность": Decimal(1)},
}


def _canonical_hash(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def make_fact_id(fact_without_id: dict[str, Any]) -> str:
    """Stable identity for exact fact fields, including source and locator."""
    if not isinstance(fact_without_id, dict):
        raise ValueError("fact must be an object")
    try:
        return _canonical_hash({key: value for key, value in fact_without_id.items() if key != "factId"})
    except (TypeError, ValueError) as error:
        raise ValueError("fact contains non-canonical JSON") from error


def _string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _decimal(value: object) -> Decimal | None:
    if not isinstance(value, str) or _NUMBER.fullmatch(value) is None:
        return None
    try:
        parsed = Decimal(value.replace(" ", "").replace("\u00a0", "").replace(",", "."))
    except InvalidOperation:
        return None
    return parsed if parsed.is_finite() and parsed >= 0 else None


def _decimal_text(value: Decimal) -> str:
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _normalize(fact: dict[str, Any], canonical_unit: str) -> Decimal | None:
    raw_value, raw_unit = fact.get("rawValue"), fact.get("rawUnit")
    if not isinstance(raw_unit, str) or not raw_unit.strip():
        return None
    if canonical_unit == "B_CLASS":
        if raw_unit not in {"B", "В"} or not isinstance(raw_value, str):
            return None
        match = _CLASS.fullmatch(raw_value)
        if match is None or raw_value[0] != raw_unit:
            return None
        return _decimal(match.group(1))
    value = _decimal(raw_value)
    if value is None:
        return None
    unit = raw_unit.strip().casefold()
    if unit == "этажность" and fact.get("attribute") != "ABOVE_GROUND_FLOOR_COUNT":
        return None
    if unit == "кв." and fact.get("attribute") != "APARTMENT_COUNT":
        return None
    factor = _UNITS.get(canonical_unit, {}).get(unit)
    if factor is None:
        return None
    with localcontext() as context:
        context.prec = max(80, len(value.as_tuple().digits) + len(factor.as_tuple().digits) + 10)
        normalized = value * factor
    if canonical_unit == "count" and normalized != normalized.to_integral_value():
        return None
    return normalized


def _valid_locator(locator: object, raw_text: str, raw_value: str) -> bool:
    if not isinstance(locator, dict) or locator.get("kind") != "TEXT_BLOCK":
        return False
    block_index, start, end = (locator.get(key) for key in ("blockIndex", "start", "end"))
    bbox = locator.get("bboxMilliPoints")
    return (type(block_index) is int and block_index >= 0 and type(start) is int and start >= 0
            and type(end) is int and start < end <= len(raw_text)
            and raw_text[start:end] == raw_value
            and isinstance(bbox, list) and len(bbox) == 4
            and all(type(point) is int and point >= 0 for point in bbox)
            and bbox[0] < bbox[2] and bbox[1] < bbox[3])


def _result(rule: dict[str, Any], status: str, reason: str, *,
            expected: dict[str, Any] | None = None, actual: dict[str, Any] | None = None,
            normalized_expected: Decimal | None = None,
            normalized_actual: Decimal | None = None,
            comparison: dict[str, Any] | None = None) -> dict[str, Any]:
    result = {
        "schemaVersion": _RESULT_SCHEMA,
        "ruleId": rule.get("ruleId") if isinstance(rule.get("ruleId"), str) else None,
        "ruleVersion": rule.get("version") if isinstance(rule.get("version"), str) else None,
        "objectId": rule.get("objectId") if isinstance(rule.get("objectId"), str) else None,
        "parameterCode": rule.get("parameterCode") if isinstance(rule.get("parameterCode"), str) else None,
        "attribute": rule.get("attribute") if isinstance(rule.get("attribute"), str) else None,
        "expectedStage": rule.get("expectedStage") if isinstance(rule.get("expectedStage"), str) else None,
        "actualStage": rule.get("actualStage") if isinstance(rule.get("actualStage"), str) else None,
        "canonicalUnit": rule.get("canonicalUnit") if isinstance(rule.get("canonicalUnit"), str) else None,
        "status": status, "reasonCodes": [reason],
        "expectedFactId": expected.get("factId") if expected and isinstance(expected.get("factId"), str) else None,
        "actualFactId": actual.get("factId") if actual and isinstance(actual.get("factId"), str) else None,
        "normalizedExpected": _decimal_text(normalized_expected) if normalized_expected is not None else None,
        "normalizedActual": _decimal_text(normalized_actual) if normalized_actual is not None else None,
        "comparison": comparison,
    }
    result["contentHash"] = _canonical_hash(result)
    return result


def _valid_rule(rule: object) -> bool:
    if not isinstance(rule, dict) or rule.get("schemaVersion") != _RULE_SCHEMA:
        return False
    if any(not _string(rule.get(key)) for key in
           ("ruleId", "version", "objectId", "parameterCode", "attribute")):
        return False
    if rule.get("expectedStage") != "PD" or not isinstance(rule.get("actualStage"), str) or rule.get("actualStage") not in {"RD", "ID"}:
        return False
    unit = rule.get("canonicalUnit")
    comparator = rule.get("comparator")
    if not isinstance(unit, str) or unit not in {*_UNITS, "B_CLASS"} or not isinstance(comparator, dict):
        return False
    family, operator = comparator.get("family"), comparator.get("operator")
    if not isinstance(family, str) or not isinstance(operator, str):
        return False
    if family == "DIFFERENT":
        if operator != "!=":
            return False
    elif family in {"DECREASE", "CLASS_DECREASE", "INCREASE",
                    "RELATIVE_DELTA", "RELATIVE_INCREASE"}:
        if operator != ">":
            return False
    else:
        return False
    if (family == "CLASS_DECREASE") != (unit == "B_CLASS"):
        return False
    threshold = _decimal(comparator.get("threshold"))
    return threshold is not None and (family != "DIFFERENT" or threshold == 0)


def _source_stage(source: dict[str, Any], page_number: int) -> tuple[str | None, str | None]:
    stages = source.get("stages")
    if not isinstance(stages, list) or not stages or any(not isinstance(stage, str) for stage in stages):
        return None, "SOURCE_STAGE_INVALID"
    if len(stages) != len(set(stages)) or any(
            stage not in {"PD", "RD", "ID"} for stage in stages):
        return None, "SOURCE_STAGE_INVALID"
    page_count = source.get("pageCount")
    if page_count is not None and (type(page_count) is not int or page_count < 1 or page_number > page_count):
        return None, "PAGE_OUT_OF_RANGE"
    mapping = source.get("pageStages", {})
    if not isinstance(mapping, dict):
        return None, "PAGE_STAGE_INVALID"
    if len(stages) == 1:
        if mapping and (mapping.get(str(page_number)) != stages[0]
                        or any(stage != stages[0] for stage in mapping.values())):
            return None, "PAGE_STAGE_MISMATCH"
        return stages[0], None
    if type(page_count) is not int or page_count < 1:
        return None, "PAGE_STAGE_UNRESOLVED"
    if set(mapping) != {str(number) for number in range(1, page_count + 1)}:
        return None, "PAGE_STAGE_UNRESOLVED"
    if any(stage not in stages for stage in mapping.values()):
        return None, "PAGE_STAGE_UNRESOLVED"
    return mapping[str(page_number)], None


def _valid_fact(fact: object, rule: dict[str, Any], sources: dict[str, dict[str, Any]]) -> str | None:
    if not isinstance(fact, dict) or fact.get("schemaVersion") != _FACT_SCHEMA:
        return "FACT_SCHEMA_INVALID"
    if any(not _string(fact.get(key)) for key in ("factId", "parameterCode", "objectId",
                                                   "attribute", "stage", "sourceFileId",
                                                   "rawText", "rawValue", "rawUnit")):
        return "FACT_SCHEMA_INVALID"
    try:
        valid_id = fact.get("factId") == make_fact_id(fact)
    except ValueError:
        valid_id = False
    if not valid_id:
        return "FACT_ID_MISMATCH"
    if (fact["parameterCode"] != rule["parameterCode"] or fact["objectId"] != rule["objectId"]
            or fact["attribute"] != rule["attribute"]):
        return "FACT_SCOPE_MISMATCH"
    if "canonicalUnit" in fact and fact["canonicalUnit"] != rule["canonicalUnit"]:
        return "FACT_UNIT_MISMATCH"
    if not isinstance(fact["stage"], str) or fact["stage"] not in {rule["expectedStage"], rule["actualStage"]}:
        return "FACT_STAGE_MISMATCH"
    if type(fact.get("pageNumber")) is not int or fact["pageNumber"] < 1:
        return "PAGE_LOCATOR_INVALID"
    if not _valid_locator(fact.get("locator"), fact["rawText"], fact["rawValue"]):
        return "PAGE_LOCATOR_INVALID"
    source = sources.get(fact["sourceFileId"])
    if source is None:
        return "SOURCE_MISSING"
    if source.get("objectId") != rule["objectId"]:
        return "SOURCE_OBJECT_MISMATCH"
    source_hash = source.get("sha256")
    if not isinstance(source_hash, str) or _HASH.fullmatch(source_hash) is None:
        return "SOURCE_HASH_INVALID"
    if fact.get("sourceSha256") != source_hash:
        return "SOURCE_HASH_MISMATCH"
    stage, reason = _source_stage(source, fact["pageNumber"])
    if reason:
        return reason
    if stage != fact["stage"]:
        return "PAGE_STAGE_MISMATCH"
    if source.get("revisionStatus") != "CURRENT":
        return "REVISION_NOT_CURRENT"
    if source.get("approvalStatus") != "APPROVED":
        return "APPROVAL_NOT_APPROVED"
    if not _string(source.get("linkGroupId")):
        return "LINK_GROUP_MISSING"
    return None


def _valid_link(link: object, expected: dict[str, Any], actual: dict[str, Any],
                sources: dict[str, dict[str, Any]]) -> bool:
    if not isinstance(link, dict) or link.get("schemaVersion") != _LINK_SCHEMA:
        return False
    if (link.get("pdFactId") != expected["factId"] or link.get("actualFactId") != actual["factId"]
            or link.get("objectId") != expected["objectId"]):
        return False
    if expected["sourceFileId"] == actual["sourceFileId"]:
        return False
    expected_group = sources[expected["sourceFileId"]].get("linkGroupId")
    actual_group = sources[actual["sourceFileId"]].get("linkGroupId")
    if expected_group != actual_group or link.get("linkGroupId") != expected_group:
        return False
    basis = link.get("basis")
    if not (_string(basis) or isinstance(basis, dict) and _string(basis.get("reference"))):
        return False
    evidence = link.get("evidence")
    if not isinstance(evidence, list) or len(evidence) != 2:
        return False
    by_id = {item.get("factId"): item for item in evidence
             if isinstance(item, dict) and isinstance(item.get("factId"), str)}
    if len(by_id) != 2:
        return False
    for fact in (expected, actual):
        item = by_id.get(fact["factId"])
        if item is None or any(item.get(key) != fact[key] for key in
                               ("sourceFileId", "sourceSha256", "pageNumber", "locator")):
            return False
    return True


def _entity_context_matches(rule: dict[str, Any], expected: dict[str, Any],
                            actual: dict[str, Any]) -> bool:
    """A reviewed pair link cannot override conflicting element or scope labels."""
    required_element = rule["parameterCode"].startswith("KR-")
    if required_element and (not _string(expected.get("elementType"))
                             or not _string(actual.get("elementType"))):
        return False
    for key in ("elementType", "zone", "floor", "scope"):
        if key in expected or key in actual:
            left, right = expected.get(key), actual.get(key)
            if not _string(left) or not _string(right) or left != right:
                return False
    return True


def evaluate_fact_comparison(
    rule: dict[str, Any], sources: list[dict[str, Any]], facts: list[dict[str, Any]],
    entity_links: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return review-only comparison or abstain at first unresolved evidence gate."""
    if not _valid_rule(rule):
        return _result(rule if isinstance(rule, dict) else {}, "ABSTAIN", "RULE_INVALID")
    if not all(isinstance(items, list) for items in (sources, facts, entity_links)):
        return _result(rule, "ABSTAIN", "INPUT_INVALID")
    source_index: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict) or not _string(source.get("sourceFileId")):
            return _result(rule, "ABSTAIN", "SOURCE_SCHEMA_INVALID")
        if source["sourceFileId"] in source_index:
            return _result(rule, "ABSTAIN", "DUPLICATE_SOURCE")
        source_index[source["sourceFileId"]] = source
    candidates = [fact for fact in facts if isinstance(fact, dict) and
                  fact.get("objectId") == rule["objectId"] and
                  fact.get("parameterCode") == rule["parameterCode"] and
                  fact.get("attribute") == rule["attribute"] and
                  (fact.get("stage") == "PD" or fact.get("stage") == rule["actualStage"])]
    if any(not isinstance(fact, dict) for fact in facts):
        return _result(rule, "ABSTAIN", "FACT_SCHEMA_INVALID")
    by_stage = {stage: [fact for fact in candidates if fact.get("stage") == stage]
                for stage in ("PD", rule["actualStage"])}
    if any(len(stage_facts) == 0 for stage_facts in by_stage.values()):
        return _result(rule, "ABSTAIN", "REQUIRED_FACT_MISSING")
    if any(len(stage_facts) > 1 for stage_facts in by_stage.values()):
        all_candidates = by_stage["PD"] + by_stage[rule["actualStage"]]
        candidate_ids = [fact.get("factId") for fact in all_candidates]
        if (any(not isinstance(fact_id, str) for fact_id in candidate_ids)
                or len(set(candidate_ids)) != len(candidate_ids)):
            return _result(rule, "ABSTAIN", "AMBIGUOUS_FACTS")
        pd_by_id = {fact["factId"]: fact for fact in by_stage["PD"]}
        actual_by_id = {fact["factId"]: fact for fact in by_stage[rule["actualStage"]]}
        touching = [link for link in entity_links if isinstance(link, dict) and
                    (isinstance(link.get("pdFactId"), str) and link["pdFactId"] in pd_by_id
                     or isinstance(link.get("actualFactId"), str)
                     and link["actualFactId"] in actual_by_id)]
        if len(touching) > 1:
            return _result(rule, "ABSTAIN", "AMBIGUOUS_ENTITY_LINK")
        if len(touching) == 0:
            return _result(rule, "ABSTAIN", "AMBIGUOUS_FACTS")
        pd_id, actual_id = touching[0].get("pdFactId"), touching[0].get("actualFactId")
        if not isinstance(pd_id, str) or not isinstance(actual_id, str):
            return _result(rule, "ABSTAIN", "AMBIGUOUS_FACTS")
        expected = pd_by_id.get(pd_id)
        actual = actual_by_id.get(actual_id)
        if expected is None or actual is None:
            return _result(rule, "ABSTAIN", "AMBIGUOUS_FACTS")
    else:
        expected, actual = by_stage["PD"][0], by_stage[rule["actualStage"]][0]
    if expected.get("factId") == actual.get("factId"):
        return _result(rule, "ABSTAIN", "DUPLICATE_FACT_ID")
    for fact in (expected, actual):
        reason = _valid_fact(fact, rule, source_index)
        if reason:
            return _result(rule, "ABSTAIN", reason, expected=expected, actual=actual)
    if source_index[expected["sourceFileId"]]["linkGroupId"] != source_index[actual["sourceFileId"]]["linkGroupId"]:
        return _result(rule, "ABSTAIN", "LINK_GROUP_MISMATCH", expected=expected, actual=actual)
    related_links = [link for link in entity_links if isinstance(link, dict) and
                     (link.get("pdFactId") == expected["factId"] or
                      link.get("actualFactId") == actual["factId"])]
    if len(related_links) == 0:
        return _result(rule, "ABSTAIN", "ENTITY_LINK_MISSING", expected=expected, actual=actual)
    if len(related_links) > 1:
        return _result(rule, "ABSTAIN", "AMBIGUOUS_ENTITY_LINK", expected=expected, actual=actual)
    if not _valid_link(related_links[0], expected, actual, source_index):
        return _result(rule, "ABSTAIN", "ENTITY_LINK_INVALID", expected=expected, actual=actual)
    if not _entity_context_matches(rule, expected, actual):
        return _result(rule, "ABSTAIN", "ENTITY_CONTEXT_MISMATCH", expected=expected, actual=actual)
    expected_value = _normalize(expected, rule["canonicalUnit"])
    actual_value = _normalize(actual, rule["canonicalUnit"])
    if expected_value is None or actual_value is None:
        return _result(rule, "ABSTAIN", "VALUE_OR_UNIT_INVALID", expected=expected, actual=actual)
    family = rule["comparator"]["family"]
    threshold = _decimal(rule["comparator"]["threshold"])
    assert threshold is not None
    if family in {"RELATIVE_DELTA", "RELATIVE_INCREASE"} and expected_value == 0:
        return _result(rule, "ABSTAIN", "ZERO_BASELINE", expected=expected, actual=actual,
                       normalized_expected=expected_value, normalized_actual=actual_value)
    with localcontext() as context:
        context.prec = max(80, len(expected_value.as_tuple().digits) +
                           len(actual_value.as_tuple().digits) + 20)
        observed = (abs(actual_value - expected_value) / expected_value if family == "RELATIVE_DELTA"
                    else (actual_value - expected_value) / expected_value
                    if family == "RELATIVE_INCREASE"
                    else expected_value - actual_value if family in {"DECREASE", "CLASS_DECREASE"}
                    else actual_value - expected_value if family == "INCREASE"
                    else abs(actual_value - expected_value))
    triggered = (observed != 0 if family == "DIFFERENT" else observed > threshold)
    reason = ("NO_DIFFERENCE_OBSERVED" if expected_value == actual_value
              else "COMPARISON_TRIGGERED_REVIEW" if triggered else "COMPARISON_NOT_TRIGGERED_REVIEW")
    comparison = {"family": family, "operator": rule["comparator"]["operator"],
                  "threshold": _decimal_text(threshold), "observed": _decimal_text(observed),
                  "triggered": triggered}
    return _result(rule, "REVIEW_REQUIRED", reason, expected=expected, actual=actual,
                   normalized_expected=expected_value, normalized_actual=actual_value,
                   comparison=comparison)
