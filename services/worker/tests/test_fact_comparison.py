from __future__ import annotations

import copy
import hashlib
import json
import unittest

from inspector_worker.fact_comparison import evaluate_fact_comparison, make_fact_id


PD_SHA = "a" * 64
RD_SHA = "b" * 64


def fixture(*, family: str = "DIFFERENT", canonical_unit: str = "m3",
            attribute: str = "BUILDING_VOLUME", pd_value: str = "100", rd_value: str = "110",
            pd_unit: str = "м³", rd_unit: str = "м³", threshold: str = "0",
            parameter_code: str = "PZ-004"):
    operator = "!=" if family == "DIFFERENT" else ">"
    rule = {
        "schemaVersion": "fact-comparison-rule-v1", "ruleId": "RULE-1", "version": "1",
        "objectId": "OBJECT-1", "parameterCode": parameter_code, "attribute": attribute,
        "expectedStage": "PD", "actualStage": "RD", "canonicalUnit": canonical_unit,
        "comparator": {"family": family, "operator": operator, "threshold": threshold},
    }
    sources = [
        {"sourceFileId": file_id, "objectId": "OBJECT-1", "sha256": sha,
         "stages": [stage], "pageCount": 1, "pageStages": {}, "revisionStatus": "CURRENT",
         "approvalStatus": "APPROVED", "linkGroupId": "BUILDING-1"}
        for file_id, sha, stage in (("PD-1", PD_SHA, "PD"), ("RD-1", RD_SHA, "RD"))
    ]
    facts = []
    for file_id, sha, stage, value, unit in (
        ("PD-1", PD_SHA, "PD", pd_value, pd_unit),
        ("RD-1", RD_SHA, "RD", rd_value, rd_unit),
    ):
        raw_text = f"Объем здания: {value} {unit}"
        start = raw_text.index(value)
        fact = {
            "schemaVersion": "typed-fact-v1", "parameterCode": rule["parameterCode"],
            "objectId": "OBJECT-1", "attribute": attribute, "stage": stage,
            "sourceFileId": file_id, "sourceSha256": sha, "pageNumber": 1,
            "rawText": raw_text, "rawValue": value, "rawUnit": unit,
            "locator": {"kind": "TEXT_BLOCK", "blockIndex": 0, "start": start,
                        "end": start + len(value), "bboxMilliPoints": [1, 2, 100, 20]},
        }
        fact["factId"] = make_fact_id(fact)
        facts.append(fact)
    link = {
        "schemaVersion": "fact-entity-link-v1", "pdFactId": facts[0]["factId"],
        "actualFactId": facts[1]["factId"], "objectId": "OBJECT-1",
        "linkGroupId": "BUILDING-1", "basis": {"reference": "approved cross-stage schedule"},
        "evidence": [{key: copy.deepcopy(fact[key]) for key in
                      ("factId", "sourceFileId", "sourceSha256", "pageNumber", "locator")}
                     for fact in facts],
    }
    return rule, sources, facts, [link]


def evaluate(case):
    return evaluate_fact_comparison(*case)


def set_context(case, index: int, **values):
    fact = case[2][index]
    fact.update(values)
    fact["factId"] = make_fact_id(fact)
    link = case[3][0]
    link["pdFactId" if index == 0 else "actualFactId"] = fact["factId"]
    link["evidence"][index]["factId"] = fact["factId"]


class FactComparisonTests(unittest.TestCase):
    def test_positive_review_and_canonical_hash(self):
        result = evaluate(fixture())
        self.assertEqual((result["status"], result["reasonCodes"]),
                         ("REVIEW_REQUIRED", ["COMPARISON_TRIGGERED_REVIEW"]))
        self.assertEqual(result["comparison"]["observed"], "10")
        self.assertTrue(result["comparison"]["triggered"])
        self.assertEqual(result["normalizedExpected"], "100")
        self.assertEqual(result["normalizedActual"], "110")
        expected_hash = hashlib.sha256(json.dumps(
            {key: value for key, value in result.items() if key != "contentHash"},
            ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")).hexdigest()
        self.assertEqual(result["contentHash"], expected_hash)
        self.assertFalse({"finding", "coverage", "NEGATIVE_VERIFIED"} & result.keys())

    def test_equal_values_require_review_without_global_negative_claim(self):
        result = evaluate(fixture(rd_value="100"))
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["reasonCodes"], ["NO_DIFFERENCE_OBSERVED"])
        self.assertFalse(result["comparison"]["triggered"])

    def test_area_and_volume_conversions(self):
        area = fixture(canonical_unit="m2", attribute="BUILDING_AREA",
                       pd_value="1 000,5", rd_value="10005000", pd_unit="м²", rd_unit="см²")
        result = evaluate(area)
        self.assertEqual(result["normalizedExpected"], "1000.5")
        self.assertEqual(result["normalizedActual"], "1000.5")
        thousand = fixture(pd_value="1,5", rd_value="1501", pd_unit="тыс. м³")
        result = evaluate(thousand)
        self.assertEqual(result["normalizedExpected"], "1500")
        self.assertEqual(result["comparison"]["observed"], "1")

    def test_count_and_length_conversions(self):
        count = fixture(canonical_unit="count", attribute="ABOVE_GROUND_FLOOR_COUNT",
                        pd_value="3", rd_value="4", pd_unit="Этажность", rd_unit="этажей")
        self.assertEqual(evaluate(count)["normalizedActual"], "4")
        length = fixture(family="DECREASE", canonical_unit="mm", attribute="SLAB_THICKNESS",
                         pd_value="0,3", rd_value="250", pd_unit="м", rd_unit="мм")
        result = evaluate(length)
        self.assertEqual(result["normalizedExpected"], "300")
        self.assertEqual(result["comparison"]["observed"], "50")
        self.assertTrue(result["comparison"]["triggered"])
        apartments = fixture(canonical_unit="count", attribute="APARTMENT_COUNT",
                             parameter_code="PZ-010", pd_value="92", rd_value="93",
                             pd_unit="кв.", rd_unit="шт.")
        self.assertEqual(evaluate(apartments)["normalizedExpected"], "92")
        unrelated = fixture(canonical_unit="count", attribute="OTHER_COUNT",
                            pd_value="92", rd_value="93", pd_unit="кв.", rd_unit="шт.")
        self.assertEqual(evaluate(unrelated)["reasonCodes"], ["VALUE_OR_UNIT_INVALID"])

    def test_class_order_and_strict_threshold(self):
        case = fixture(family="CLASS_DECREASE", canonical_unit="B_CLASS",
                       attribute="CONCRETE_CLASS", pd_value="В30", rd_value="B25",
                       pd_unit="В", rd_unit="B", threshold="5", parameter_code="KR-055")
        set_context(case, 0, elementType="FOUNDATION")
        set_context(case, 1, elementType="FOUNDATION")
        result = evaluate(case)
        self.assertEqual(result["comparison"]["observed"], "5")
        self.assertFalse(result["comparison"]["triggered"])
        case[0]["comparator"]["threshold"] = "4.99"
        self.assertTrue(evaluate(case)["comparison"]["triggered"])

    def test_relative_delta_boundary_and_zero_baseline(self):
        case = fixture(family="RELATIVE_DELTA", pd_value="100", rd_value="101", threshold="0.01")
        self.assertFalse(evaluate(case)["comparison"]["triggered"])
        case[0]["comparator"]["threshold"] = "0.009"
        self.assertTrue(evaluate(case)["comparison"]["triggered"])
        zero = fixture(family="RELATIVE_DELTA", pd_value="0", rd_value="1", threshold="0")
        self.assertEqual(evaluate(zero)["reasonCodes"], ["ZERO_BASELINE"])

    def test_increase_is_directional_and_strict(self):
        case = fixture(family="INCREASE", pd_value="100", rd_value="105", threshold="5")
        result = evaluate(case)
        self.assertEqual(result["comparison"]["observed"], "5")
        self.assertFalse(result["comparison"]["triggered"])
        case[0]["comparator"]["threshold"] = "4.99"
        self.assertTrue(evaluate(case)["comparison"]["triggered"])
        decrease = fixture(family="INCREASE", pd_value="100", rd_value="90")
        self.assertEqual(evaluate(decrease)["comparison"]["observed"], "-10")
        self.assertFalse(evaluate(decrease)["comparison"]["triggered"])

    def test_relative_increase_is_directional_and_requires_baseline(self):
        case = fixture(family="RELATIVE_INCREASE", pd_value="100", rd_value="105",
                       threshold="0.05")
        self.assertFalse(evaluate(case)["comparison"]["triggered"])
        case[0]["comparator"]["threshold"] = "0.049"
        self.assertEqual(evaluate(case)["comparison"]["observed"], "0.05")
        self.assertTrue(evaluate(case)["comparison"]["triggered"])
        decrease = fixture(family="RELATIVE_INCREASE", pd_value="100", rd_value="95")
        self.assertEqual(evaluate(decrease)["comparison"]["observed"], "-0.05")
        self.assertFalse(evaluate(decrease)["comparison"]["triggered"])
        zero = fixture(family="RELATIVE_INCREASE", pd_value="0", rd_value="1")
        self.assertEqual(evaluate(zero)["reasonCodes"], ["ZERO_BASELINE"])

    def test_unknown_approvals_and_revisions_abstain(self):
        for field, value, reason in (
            ("revisionStatus", "UNKNOWN", "REVISION_NOT_CURRENT"),
            ("revisionStatus", "SUPERSEDED", "REVISION_NOT_CURRENT"),
            ("approvalStatus", "UNKNOWN", "APPROVAL_NOT_APPROVED"),
            ("approvalStatus", "UNAPPROVED", "APPROVAL_NOT_APPROVED"),
        ):
            case = fixture()
            case[1][1][field] = value
            self.assertEqual(evaluate(case)["reasonCodes"], [reason])

    def test_mixed_page_stage_requires_complete_pinned_map(self):
        case = fixture()
        case[1][1]["stages"] = ["RD", "ID"]
        case[1][1]["pageCount"] = 2
        case[1][1]["pageStages"] = {"1": "RD"}
        self.assertEqual(evaluate(case)["reasonCodes"], ["PAGE_STAGE_UNRESOLVED"])
        case[1][1]["pageStages"] = {"1": "RD", "2": "UNRESOLVED"}
        self.assertEqual(evaluate(case)["reasonCodes"], ["PAGE_STAGE_UNRESOLVED"])
        case[1][1]["pageStages"] = {"1": "ID", "2": "RD"}
        self.assertEqual(evaluate(case)["reasonCodes"], ["PAGE_STAGE_MISMATCH"])
        case[1][1]["pageStages"] = {"1": "RD", "2": "ID"}
        self.assertEqual(evaluate(case)["status"], "REVIEW_REQUIRED")

    def test_hash_locator_and_evidence_tamper_abstain(self):
        case = fixture()
        case[2][1]["sourceSha256"] = "c" * 64
        self.assertEqual(evaluate(case)["reasonCodes"], ["FACT_ID_MISMATCH"])
        case = fixture()
        case[2][1]["locator"]["end"] -= 1
        self.assertEqual(evaluate(case)["reasonCodes"], ["FACT_ID_MISMATCH"])
        case = fixture()
        case[3][0]["evidence"][1]["locator"]["bboxMilliPoints"][2] = 101
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_LINK_INVALID"])
        case = fixture()
        case[1][1]["sha256"] = "c" * 64
        self.assertEqual(evaluate(case)["reasonCodes"], ["SOURCE_HASH_MISMATCH"])

    def test_unrelated_entity_and_duplicate_link_abstain(self):
        case = fixture()
        case[3][0]["actualFactId"] = "unrelated"
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_LINK_INVALID"])
        case = fixture()
        case[3].append(copy.deepcopy(case[3][0]))
        self.assertEqual(evaluate(case)["reasonCodes"], ["AMBIGUOUS_ENTITY_LINK"])

    def test_missing_and_duplicate_facts_abstain(self):
        case = fixture()
        case[2].pop()
        self.assertEqual(evaluate(case)["reasonCodes"], ["REQUIRED_FACT_MISSING"])
        case = fixture()
        case[2].append(copy.deepcopy(case[2][1]))
        self.assertEqual(evaluate(case)["reasonCodes"], ["AMBIGUOUS_FACTS"])

    def test_one_explicit_link_selects_unique_pair_among_extra_facts(self):
        case = fixture()
        extra = copy.deepcopy(case[2][1])
        extra["rawText"] = extra["rawText"].replace("110", "120")
        extra["rawValue"] = "120"
        extra["factId"] = make_fact_id(extra)
        case[2].append(extra)
        self.assertEqual(evaluate(case)["status"], "REVIEW_REQUIRED")
        self.assertEqual(evaluate(case)["actualFactId"], case[2][1]["factId"])

        no_link = copy.deepcopy(case)
        no_link[3].clear()
        result = evaluate(no_link)
        self.assertEqual(result["reasonCodes"], ["AMBIGUOUS_FACTS"])
        self.assertIsNone(result["actualFactId"])

        duplicate_link = copy.deepcopy(case)
        duplicate_link[3].append(copy.deepcopy(duplicate_link[3][0]))
        result = evaluate(duplicate_link)
        self.assertEqual(result["reasonCodes"], ["AMBIGUOUS_ENTITY_LINK"])
        self.assertIsNone(result["actualFactId"])

        partial_link = copy.deepcopy(case)
        partial_link[3][0]["actualFactId"] = "unrelated"
        result = evaluate(partial_link)
        self.assertEqual(result["reasonCodes"], ["AMBIGUOUS_FACTS"])
        self.assertIsNone(result["actualFactId"])

        invalid_link = copy.deepcopy(case)
        invalid_link[3][0]["evidence"][1]["sourceSha256"] = "c" * 64
        result = evaluate(invalid_link)
        self.assertEqual(result["reasonCodes"], ["ENTITY_LINK_INVALID"])
        self.assertEqual(result["actualFactId"], case[2][1]["factId"])

    def test_cross_object_unit_and_missing_link_abstain(self):
        case = fixture()
        case[1][1]["objectId"] = "OBJECT-2"
        self.assertEqual(evaluate(case)["reasonCodes"], ["SOURCE_OBJECT_MISMATCH"])
        case = fixture(rd_unit="мм")
        self.assertEqual(evaluate(case)["reasonCodes"], ["VALUE_OR_UNIT_INVALID"])
        case = fixture()
        case[3].clear()
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_LINK_MISSING"])

    def test_invalid_rule_does_not_infer_operator_semantics(self):
        for family, operator, threshold in (("DIFFERENT", ">", "0"),
                                            ("DECREASE", ">=", "0"),
                                            ("DIFFERENT", "!=", "1"),
                                            ("DECREASE", ">", "-1")):
            case = fixture(family=family)
            case[0]["comparator"] = {"family": family, "operator": operator,
                                     "threshold": threshold}
            result = evaluate(case)
            self.assertEqual((result["status"], result["reasonCodes"]),
                             ("ABSTAIN", ["RULE_INVALID"]))

    def test_kr_element_identity_gate_rejects_mismatched_and_missing_type(self):
        case = fixture(family="CLASS_DECREASE", canonical_unit="B_CLASS",
                       attribute="CONCRETE_CLASS", pd_value="В30", rd_value="B25",
                       pd_unit="В", rd_unit="B", parameter_code="KR-055")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 0, elementType="STAIR")
        set_context(case, 1, elementType="FOUNDATION")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 1, elementType="STAIR")
        self.assertEqual(evaluate(case)["status"], "REVIEW_REQUIRED")

    def test_zone_floor_and_building_scope_must_match_if_present(self):
        case = fixture(family="DECREASE", canonical_unit="mm", attribute="SLAB_THICKNESS",
                       pd_value="300", rd_value="250", pd_unit="мм", rd_unit="мм",
                       parameter_code="KR-059")
        set_context(case, 0, elementType="SLAB", zone="Корпус К1", floor="2 этаж")
        set_context(case, 1, elementType="SLAB", zone="Корпус К2", floor="2 этаж")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 1, zone="Корпус К1", floor="3 этаж")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 1, floor="2 этаж")
        self.assertEqual(evaluate(case)["status"], "REVIEW_REQUIRED")
        case = fixture()
        set_context(case, 0, scope="building-A")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 1, scope="building-B")
        self.assertEqual(evaluate(case)["reasonCodes"], ["ENTITY_CONTEXT_MISMATCH"])
        set_context(case, 1, scope="building-A")
        self.assertEqual(evaluate(case)["status"], "REVIEW_REQUIRED")


if __name__ == "__main__":
    unittest.main()
