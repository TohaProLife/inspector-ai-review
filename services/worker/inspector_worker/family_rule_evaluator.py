"""Offline, non-executing review of catalog-pinned candidate rule families.

This module cannot create findings, change coverage, or certify a negative result.
An affirmative result is a preview for a human reviewer, contingent on explicit
source, entity, section, and family-specific evidence supplied by the caller.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, localcontext
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .fact_comparison import (_decimal, _decimal_text, _entity_context_matches,
                              _normalize, _valid_fact, _valid_link)


_NUMERIC_FAMILIES = {"DECREASE", "INCREASE", "DIFFERENT", "RELATIVE_DELTA",
                     "RELATIVE_INCREASE", "LOWER_BOUND", "UPPER_BOUND"}
_RESULT_SCHEMA = "candidate-family-evaluation-v1"
_HASH = re.compile(r"[0-9a-f]{64}\Z")

# Exact spellings from the 47-code catalog plus unambiguous dimension-preserving
# conversions. No generic casefolding: `МВт` and `мВт` differ by 10^9.
_CANDIDATE_NUMERIC_UNITS: dict[str, dict[str, Decimal]] = {
    "m": {"m": Decimal(1), "м": Decimal(1), "cm": Decimal("0.01"),
          "см": Decimal("0.01"), "mm": Decimal("0.001"), "мм": Decimal("0.001")},
    "kW": {"kW": Decimal(1), "кВт": Decimal(1), "Вт": Decimal("0.001"),
           "МВт": Decimal(1000)},
    "Gcal/h": {"Gcal/h": Decimal(1), "Гкал/ч": Decimal(1), "Гкал/час": Decimal(1)},
    "m3/day": {"m3/day": Decimal(1), "м³/сут": Decimal(1), "м3/сут": Decimal(1)},
    "m3/h": {"m3/h": Decimal(1), "м³/ч": Decimal(1), "м3/ч": Decimal(1)},
    "t": {"t": Decimal(1), "т": Decimal(1), "т.": Decimal(1),
          "кг": Decimal("0.001"), "kg": Decimal("0.001")},
    "day": {"day": Decimal(1), "дни": Decimal(1), "день": Decimal(1),
            "дня": Decimal(1), "сутки": Decimal(1), "сут": Decimal(1),
            "сут.": Decimal(1)},
    "W/(m*C)": {"W/(m*C)": Decimal(1), "Вт/(м·С)": Decimal(1),
                "Вт/(м·°С)": Decimal(1), "Вт/(м·C)": Decimal(1),
                "Вт/(м·°C)": Decimal(1)},
    "kWh/m2": {"kWh/m2": Decimal(1), "кВт·ч/м²": Decimal(1),
               "кВт·ч/м2": Decimal(1), "кВт*ч/м²": Decimal(1)},
    "thousand_rub": {"thousand_rub": Decimal(1), "тыс. руб.": Decimal(1),
                     "тыс руб.": Decimal(1), "тыс.руб.": Decimal(1),
                     "руб.": Decimal("0.001"), "руб": Decimal("0.001")},
}


def _verified(proof: object) -> bool:
    return (isinstance(proof, dict) and proof.get("status") == "VERIFIED"
            and isinstance(proof.get("reference"), str) and bool(proof["reference"].strip()))


def _result(rule: object, pack_sha: str | None, status: str, reason: str, *,
            object_id: str | None = None,
            comparisons: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    row = rule if isinstance(rule, dict) else {}
    values = comparisons if status == "REVIEW_REQUIRED" else []
    result = {
        "schemaVersion": _RESULT_SCHEMA,
        "packSha256": pack_sha,
        "ruleId": row.get("ruleId") if isinstance(row.get("ruleId"), str) else None,
        "ruleVersion": row.get("version") if isinstance(row.get("version"), str) else None,
        "parameterCode": row.get("parameterCode") if isinstance(row.get("parameterCode"), str) else None,
        "family": row.get("family") if isinstance(row.get("family"), str) else None,
        "objectId": object_id,
        "disposition": "REVIEW_ONLY",
        "executionPolicy": "NON_EXECUTING_ABSTAIN",
        "status": status,
        "reasonCodes": [reason],
        "comparison": ({"triggered": any(item["triggered"] for item in values),
                        "aggregation": "PER_ATTRIBUTE"} if values else None),
        "attributeComparisons": values,
    }
    result["contentHash"] = hashlib.sha256(json.dumps(
        result, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode("utf-8")).hexdigest()
    return result


def _canonical_numeric(fact: dict[str, Any], canonical_unit: str) -> Decimal | None:
    # Reuse only explicit conversions already vetted by typed-fact comparator.
    if canonical_unit in {"m2", "m3", "mm", "count"}:
        return _normalize(fact, canonical_unit)
    raw_unit = fact.get("rawUnit")
    if not isinstance(raw_unit, str):
        return None
    spelling = " ".join(raw_unit.split())  # Includes PDF NBSP and narrow NBSP.
    factor = _CANDIDATE_NUMERIC_UNITS.get(canonical_unit, {}).get(spelling)
    value = _decimal(fact.get("rawValue"))
    if factor is None or value is None:
        return None
    with localcontext() as context:
        context.prec = max(80, len(value.as_tuple().digits) + len(factor.as_tuple().digits) + 10)
        return value * factor


def _bound_section_proof(proof: object, source: dict[str, Any], *,
                         stage: str, drawing: str) -> bool:
    source_sha, manifest_sha = source.get("sha256"), source.get("manifestSha256")
    return (isinstance(proof, dict)
            and set(proof) == {"status", "reference", "sourceFileId", "sourceSha256",
                               "manifestSha256", "stage", "manifestSection", "drawingSection"}
            and _verified(proof)
            and isinstance(source_sha, str) and _HASH.fullmatch(source_sha) is not None
            and isinstance(manifest_sha, str) and _HASH.fullmatch(manifest_sha) is not None
            and proof.get("sourceFileId") == source.get("sourceFileId")
            and proof.get("sourceSha256") == source_sha
            and proof.get("manifestSha256") == manifest_sha
            and proof.get("stage") == stage
            and proof.get("manifestSection") == source.get("section")
            and proof.get("drawingSection") == drawing)


def _section_verified(rule: dict[str, Any], side: str, source: dict[str, Any],
                      stage: str, resolutions: dict[str, Any]) -> bool:
    drawing = source.get("drawingSection")
    allowed_drawing = rule[f"required{side.title()}DrawingSections"]
    if drawing not in allowed_drawing:
        return False
    proof = resolutions.get(side)
    if rule["manifestSectionStatus"][side] == "EXACT_CATEGORY":
        if source.get("section") not in rule[f"required{side.title()}Sections"]:
            return False
        return (proof is None if drawing == source.get("section")
                else _bound_section_proof(proof, source, stage=stage, drawing=drawing))
    return _bound_section_proof(proof, source, stage=stage, drawing=drawing)


def _source_index(sources: object) -> tuple[dict[str, dict[str, Any]], str | None, str | None]:
    if not isinstance(sources, list) or not sources:
        return {}, None, "SOURCE_MISSING"
    index: dict[str, dict[str, Any]] = {}
    object_ids: set[str] = set()
    for source in sources:
        if (not isinstance(source, dict) or not isinstance(source.get("sourceFileId"), str)
                or not source["sourceFileId"] or not isinstance(source.get("objectId"), str)
                or not source["objectId"]):
            return {}, None, "SOURCE_SCHEMA_INVALID"
        if source["sourceFileId"] in index:
            return {}, None, "DUPLICATE_SOURCE"
        index[source["sourceFileId"]] = source
        object_ids.add(source["objectId"])
    if len(object_ids) != 1:
        return {}, None, "AMBIGUOUS_OBJECT"
    manifest_hashes = {source.get("manifestSha256") for source in index.values()
                       if isinstance(source.get("manifestSha256"), str)}
    if (len(manifest_hashes) != 1 or any(not isinstance(source.get("manifestSha256"), str)
                                        or _HASH.fullmatch(source["manifestSha256"]) is None
                                        for source in index.values())):
        return {}, None, "SOURCE_MANIFEST_MISMATCH"
    return index, next(iter(object_ids)), None


def _pair(rule: dict[str, Any], attribute: dict[str, str], facts: list[dict[str, Any]],
          links: list[dict[str, Any]], sources: dict[str, dict[str, Any]],
          object_id: str, resolutions: dict[str, Any]) -> tuple[dict[str, Any] | None,
                                                                dict[str, Any] | None,
                                                                str | None]:
    code, key = rule["parameterCode"], attribute["key"]
    candidates = [row for row in facts if row.get("parameterCode") == code
                  and row.get("attribute") == key and row.get("objectId") == object_id]
    expected_rows = [row for row in candidates if row.get("stage") == "PD"]
    actual_rows = [row for row in candidates if row.get("stage") == "RD"]
    if not expected_rows or not actual_rows:
        return None, None, "REQUIRED_FACT_MISSING"
    if len(expected_rows) != 1 or len(actual_rows) != 1:
        return None, None, "AMBIGUOUS_FACTS"
    expected, actual = expected_rows[0], actual_rows[0]
    validation_rule = {"parameterCode": code, "objectId": object_id, "attribute": key,
                       "expectedStage": "PD", "actualStage": "RD",
                       "canonicalUnit": attribute["canonicalUnit"]}
    for fact in (expected, actual):
        reason = _valid_fact(fact, validation_rule, sources)
        if reason:
            return None, None, reason
    pd_source, rd_source = sources[expected["sourceFileId"]], sources[actual["sourceFileId"]]
    if pd_source["linkGroupId"] != rd_source["linkGroupId"]:
        return None, None, "LINK_GROUP_MISMATCH"
    if not _section_verified(rule, "expected", pd_source, expected["stage"], resolutions):
        return None, None, "EXPECTED_SECTION_UNVERIFIED"
    if not _section_verified(rule, "actual", rd_source, actual["stage"], resolutions):
        return None, None, "ACTUAL_SECTION_UNVERIFIED"
    touching = [link for link in links if isinstance(link, dict) and
                (link.get("pdFactId") == expected["factId"] or
                 link.get("actualFactId") == actual["factId"])]
    if len(touching) != 1:
        return None, None, "ENTITY_LINK_MISSING" if not touching else "AMBIGUOUS_ENTITY_LINK"
    if not _valid_link(touching[0], expected, actual, sources):
        return None, None, "ENTITY_LINK_INVALID"
    if not _entity_context_matches(validation_rule, expected, actual):
        return None, None, "ENTITY_CONTEXT_MISMATCH"
    return expected, actual, None


def _relative_proof(proofs: object, rule: dict[str, Any], attribute: str,
                    object_id: str, expected: dict[str, Any], actual: dict[str, Any],
                    manifest_sha: str) -> bool:
    proof = proofs.get(attribute) if isinstance(proofs, dict) else None
    return (_verified(proof) and proof.get("denominator") == "EXPECTED"
            and proof.get("parameterCode") == rule["parameterCode"]
            and proof.get("objectId") == object_id and proof.get("attribute") == attribute
            and proof.get("expectedFactId") == expected["factId"]
            and proof.get("actualFactId") == actual["factId"]
            and proof.get("manifestSha256") == manifest_sha)


def _norm_proof(proofs: object, rule: dict[str, Any], attribute: str,
                canonical_unit: str, object_id: str, expected: dict[str, Any],
                actual: dict[str, Any], manifest_sha: str) -> bool:
    proof = proofs.get(attribute) if isinstance(proofs, dict) else None
    threshold = rule["comparison"]["threshold"]
    return (_verified(proof) and proof.get("applicable") is True
            and proof.get("parameterCode") == rule["parameterCode"]
            and proof.get("objectId") == object_id and proof.get("attribute") == attribute
            and proof.get("canonicalUnit") == canonical_unit
            and proof.get("expectedFactId") == expected["factId"]
            and proof.get("actualFactId") == actual["factId"]
            and proof.get("manifestSha256") == manifest_sha
            and isinstance(threshold, dict) and proof.get("threshold") == threshold["value"])


def _class_observed(scale: object, canonical_unit: str, expected: dict[str, Any],
                    actual: dict[str, Any]) -> tuple[int | None, str | None]:
    if not isinstance(scale, dict) or scale.get("schemaVersion") != "candidate-class-scale-v1":
        return None, "CLASS_SCALE_UNVERIFIED"
    if (not _verified({"status": "VERIFIED", "reference": scale.get("reference")})
            or not isinstance(scale.get("scaleId"), str) or not scale["scaleId"].strip()
            or not isinstance(scale.get("version"), str) or not scale["version"].strip()
            or scale.get("canonicalUnit") != canonical_unit):
        return None, "CLASS_SCALE_UNVERIFIED"
    order = scale.get("orderedValuesLowToHigh")
    if (not isinstance(order, list) or len(order) < 2
            or any(not isinstance(item, str) or not item.strip() for item in order)
            or len(set(order)) != len(order)):
        return None, "CLASS_SCALE_UNVERIFIED"
    if (expected.get("rawUnit") != canonical_unit or actual.get("rawUnit") != canonical_unit
            or expected.get("rawValue") not in order or actual.get("rawValue") not in order):
        return None, "CLASS_VALUE_OR_UNIT_INVALID"
    return order.index(expected["rawValue"]) - order.index(actual["rawValue"]), None


def _set_observed(proofs: object, rule: dict[str, Any], attribute: str,
                  expected: dict[str, Any], actual: dict[str, Any],
                  manifest_sha: str) -> tuple[list[str] | None, str | None]:
    proof = proofs.get(attribute) if isinstance(proofs, dict) else None
    if (not _verified(proof) or proof.get("completeExpected") is not True
            or proof.get("completeActual") is not True
            or proof.get("sameSearchScope") is not True
            or proof.get("expectedFactId") != expected["factId"]
            or proof.get("actualFactId") != actual["factId"]
            or proof.get("parameterCode") != rule["parameterCode"]
            or proof.get("manifestSha256") != manifest_sha
            or expected.get("rawUnit") != "set" or actual.get("rawUnit") != "set"):
        return None, "SET_SCOPE_INCOMPLETE"
    left, right = proof.get("expectedMembers"), proof.get("actualMembers")
    if (not isinstance(left, list) or not left or not isinstance(right, list)
            or any(not isinstance(item, str) or not item.strip() for item in left + right)
            or len(set(left)) != len(left) or len(set(right)) != len(right)
            or any(item.casefold() not in expected["rawText"].casefold() for item in left)
            or any(item.casefold() not in actual["rawText"].casefold() for item in right)):
        return None, "SET_MEMBERSHIP_UNVERIFIED"
    return sorted(set(left) - set(right)), None


def evaluate_candidate_family_rule(
    rule: dict[str, Any], sources: list[dict[str, Any]], facts: list[dict[str, Any]],
    entity_links: list[dict[str, Any]], *, context_evidence: dict[str, Any],
    section_resolutions: dict[str, Any] | None = None,
    relative_basis: dict[str, Any] | None = None,
    norm_basis: dict[str, Any] | None = None,
    class_scale: dict[str, Any] | None = None,
    set_scope: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Preview one candidate rule; every unresolved gate returns ABSTAIN.

    The caller must independently verify rawText and locator against immutable
    source bytes. This evaluator checks internal provenance and explicit proofs.
    """
    try:
        pack = load_candidate_family_pack()
    except (OSError, ValueError, KeyError, TypeError):
        return _result(rule, None, "ABSTAIN", "RULE_PACK_INVALID")
    pack_sha = pack["packSha256"]
    pinned = next((item for item in pack["rules"] if isinstance(rule, dict)
                   and item["parameterCode"] == rule.get("parameterCode")), None)
    if pinned is None or rule != pinned:
        return _result(rule, pack_sha, "ABSTAIN", "RULE_NOT_CATALOG_PINNED")
    source_index, object_id, error = _source_index(sources)
    if error:
        return _result(rule, pack_sha, "ABSTAIN", error)
    if (not isinstance(facts, list) or any(not isinstance(row, dict) for row in facts)
            or not isinstance(entity_links, list) or any(not isinstance(row, dict) for row in entity_links)):
        return _result(rule, pack_sha, "ABSTAIN", "INPUT_INVALID", object_id=object_id)
    if not isinstance(context_evidence, dict):
        return _result(rule, pack_sha, "ABSTAIN", "CONTEXT_NOT_VERIFIED", object_id=object_id)
    for gate in rule["requiredContext"]:
        if gate.endswith("_MANIFEST_SECTION_UNRESOLVED"):
            continue  # Explicit source-specific resolution is checked below.
        if not _verified(context_evidence.get(gate)):
            return _result(rule, pack_sha, "ABSTAIN", "CONTEXT_NOT_VERIFIED", object_id=object_id)
    resolutions = section_resolutions if isinstance(section_resolutions, dict) else {}
    comparisons: list[dict[str, Any]] = []
    compare_keys = rule["comparison"]["attributeKeys"]
    required_keys = ([row["key"] for row in rule["attributes"]]
                     if rule["parameterCode"] in {"KR-067", "SPZU-024"} else compare_keys)
    attributes = {row["key"]: row for row in rule["attributes"]}
    if not required_keys or any(key not in attributes for key in required_keys):
        return _result(rule, pack_sha, "ABSTAIN", "RULE_COMPARISON_INVALID", object_id=object_id)
    if rule["family"] in _NUMERIC_FAMILIES and rule["comparison"]["operator"] is None:
        return _result(rule, pack_sha, "ABSTAIN", "RULE_COMPARISON_UNRESOLVED", object_id=object_id)
    composite_scopes: list[str] = []
    for key in required_keys:
        attribute = attributes[key]
        expected, actual, error = _pair(rule, attribute, facts, entity_links,
                                        source_index, object_id, resolutions)
        if error:
            return _result(rule, pack_sha, "ABSTAIN", error, object_id=object_id)
        assert expected is not None and actual is not None
        manifest_sha = source_index[expected["sourceFileId"]]["manifestSha256"]
        if rule["parameterCode"] in {"KR-067", "SPZU-024"}:
            scope = expected.get("scope")
            if not isinstance(scope, str) or not scope.strip() or scope != actual.get("scope"):
                return _result(rule, pack_sha, "ABSTAIN", "COMPOSITE_SCOPE_UNVERIFIED",
                               object_id=object_id)
            composite_scopes.append(scope)
        family, unit = rule["family"], attribute["canonicalUnit"]
        threshold_spec = rule["comparison"]["threshold"]
        if family in {"RELATIVE_DELTA", "RELATIVE_INCREASE"}:
            if not _relative_proof(relative_basis, rule, key, object_id,
                                   expected, actual, manifest_sha):
                return _result(rule, pack_sha, "ABSTAIN", "RELATIVE_BASIS_UNVERIFIED", object_id=object_id)
        if family in {"LOWER_BOUND", "UPPER_BOUND"}:
            if not _norm_proof(norm_basis, rule, key, unit, object_id,
                               expected, actual, manifest_sha):
                return _result(rule, pack_sha, "ABSTAIN", "NORM_APPLICABILITY_UNVERIFIED", object_id=object_id)
        if family in _NUMERIC_FAMILIES:
            left = _canonical_numeric(expected, unit)
            right = _canonical_numeric(actual, unit)
            if left is None or right is None:
                return _result(rule, pack_sha, "ABSTAIN", "VALUE_OR_UNIT_INVALID", object_id=object_id)
            if family in {"RELATIVE_DELTA", "RELATIVE_INCREASE"} and left == 0:
                return _result(rule, pack_sha, "ABSTAIN", "ZERO_BASELINE", object_id=object_id)
            threshold = _decimal(threshold_spec["value"]) if threshold_spec else Decimal(0)
            if threshold is None:
                return _result(rule, pack_sha, "ABSTAIN", "THRESHOLD_INVALID", object_id=object_id)
            with localcontext() as context:
                context.prec = max(80, len(left.as_tuple().digits) + len(right.as_tuple().digits) + 20)
                observed = (abs(right - left) / left * 100 if family == "RELATIVE_DELTA"
                            else (right - left) / left * 100 if family == "RELATIVE_INCREASE"
                            else left - right if family == "DECREASE"
                            else right - left if family == "INCREASE"
                            else right if family in {"LOWER_BOUND", "UPPER_BOUND"}
                            else abs(right - left))
            triggered = (observed != 0 if family == "DIFFERENT"
                         else observed < threshold if family == "LOWER_BOUND"
                         else observed > threshold)
            observed_text: str | list[str] = _decimal_text(observed)
            threshold_text = _decimal_text(threshold)
            observed_unit = ("percent" if family in {"RELATIVE_DELTA", "RELATIVE_INCREASE"}
                             else unit)
        elif family == "CLASS_DECREASE":
            observed_class, error = _class_observed(class_scale, unit, expected, actual)
            if error:
                return _result(rule, pack_sha, "ABSTAIN", error, object_id=object_id)
            assert observed_class is not None
            triggered = observed_class > 0
            observed_text, threshold_text, observed_unit = str(observed_class), "0", "class_steps"
        elif family == "PRESENCE_SET":
            missing, error = _set_observed(set_scope, rule, key,
                                           expected, actual, manifest_sha)
            if error:
                return _result(rule, pack_sha, "ABSTAIN", error, object_id=object_id)
            assert missing is not None
            triggered = bool(missing)
            observed_text, threshold_text, observed_unit = missing, None, "members_missing"
        else:
            return _result(rule, pack_sha, "ABSTAIN", "FAMILY_UNSUPPORTED", object_id=object_id)
        comparisons.append({"attribute": key, "canonicalUnit": unit,
                            "expectedFactId": expected["factId"], "actualFactId": actual["factId"],
                            "family": family, "observed": observed_text,
                            "observedUnit": observed_unit, "threshold": threshold_text,
                            "triggered": triggered})
    if composite_scopes and len(set(composite_scopes)) != 1:
        return _result(rule, pack_sha, "ABSTAIN", "COMPOSITE_SCOPE_MISMATCH",
                       object_id=object_id)
    return _result(rule, pack_sha, "REVIEW_REQUIRED",
                   "COMPARISON_TRIGGERED_REVIEW" if any(item["triggered"] for item in comparisons)
                   else "COMPARISON_NOT_TRIGGERED_REVIEW", object_id=object_id,
                   comparisons=comparisons)
