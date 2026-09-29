from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.candidate_family_rules import (
    CATALOG_PATH,
    PACK_PATH,
    REGISTRY_PATH,
    load_candidate_family_pack,
    rules_by_family,
)
from inspector_worker.parameter_family_registry import load_parameter_family_registry


class CandidateFamilyRulesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pack = json.loads(PACK_PATH.read_text(encoding="utf-8"))

    def _load_mutation(self, pack: dict) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "candidate-pack.json"
            path.write_text(json.dumps(pack, ensure_ascii=False), encoding="utf-8")
            load_candidate_family_pack(pack_path=path)

    def test_exact_candidates_and_review_only_definition(self) -> None:
        loaded = load_candidate_family_pack()
        registry = load_parameter_family_registry()
        expected = [row["parameterCode"] for row in registry["entries"]
                    if row["classification"] == "GENERIC_CANDIDATE"]
        rules = loaded["rules"]
        self.assertEqual([rule["parameterCode"] for rule in rules], expected)
        self.assertEqual(len(rules), 47)
        self.assertEqual(loaded["disposition"], "REVIEW_ONLY")
        self.assertEqual(loaded["executionPolicy"], "DEFINITION_ONLY")
        self.assertTrue(all(rule["missingEvidenceDisposition"] == "ABSTAIN" for rule in rules))
        self.assertEqual(sum(len(rows) for rows in rules_by_family(loaded).values()), 47)
        self.assertEqual(len(rules_by_family(loaded)), 9)

    def test_catalog_and_registry_hash_drift_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            changed_catalog = Path(temporary) / "catalog.jsonl"
            changed_catalog.write_bytes(CATALOG_PATH.read_bytes() + b"\n")
            with self.assertRaises(ValueError):
                load_candidate_family_pack(catalog_path=changed_catalog)
            changed_registry = Path(temporary) / "registry.json"
            changed_registry.write_bytes(REGISTRY_PATH.read_bytes() + b"\n")
            with self.assertRaises(ValueError):
                load_candidate_family_pack(registry_path=changed_registry)

    def test_missing_extra_and_duplicate_candidate_fail(self) -> None:
        for kind in ("missing", "extra", "duplicate"):
            with self.subTest(kind=kind):
                changed = copy.deepcopy(self.pack)
                if kind == "missing":
                    changed["rules"].pop()
                elif kind == "extra":
                    changed["rules"].append({**changed["rules"][0], "parameterCode": "PZ-001"})
                else:
                    changed["rules"][1]["parameterCode"] = changed["rules"][0]["parameterCode"]
                with self.assertRaises(ValueError):
                    self._load_mutation(changed)

    def test_wrong_family_unit_and_threshold_fail(self) -> None:
        for code, path, value in (
            ("KR-061", ("family",), "INCREASE"),
            ("KR-061", ("attributes", 0, "canonicalUnit"), "m2"),
            ("PZ-002", ("comparison", "threshold", "value"), "2"),
            ("PZ-008", ("comparison", "threshold"), {"value": "5", "unit": "percent", "strict": True}),
            ("SPZU-030", ("comparison", "threshold", "strict"), False),
        ):
            with self.subTest(code=code, path=path):
                changed = copy.deepcopy(self.pack)
                row = next(item for item in changed["rules"] if item["parameterCode"] == code)
                target = row
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = value
                with self.assertRaises(ValueError):
                    self._load_mutation(changed)

    def test_normative_class_and_set_rules_cannot_claim_execution(self) -> None:
        for code in ("SPZU-030", "AR-040", "ODI-118", "PZ-015", "PPM-103", "ODI-120"):
            with self.subTest(code=code):
                changed = copy.deepcopy(self.pack)
                row = next(item for item in changed["rules"] if item["parameterCode"] == code)
                row["evaluationPolicy"] = "EXECUTE"
                with self.assertRaises(ValueError):
                    self._load_mutation(changed)

    def test_composite_items_are_atomic_and_not_cross_compared(self) -> None:
        loaded = load_candidate_family_pack()
        by_code = {row["parameterCode"]: row for row in loaded["rules"]}
        self.assertEqual(by_code["SPZU-024"]["attributes"], [
            {"key": "EXCAVATION_VOLUME", "canonicalUnit": "m3"},
            {"key": "BACKFILL_VOLUME", "canonicalUnit": "m3"},
        ])
        self.assertEqual(by_code["KR-067"]["attributes"], [
            {"key": "CONCRETE_VOLUME", "canonicalUnit": "m3"},
            {"key": "STEEL_MASS", "canonicalUnit": "t"},
        ])
        self.assertEqual(by_code["SPZU-024"]["comparison"]["attributeKeys"],
                         ["EXCAVATION_VOLUME", "BACKFILL_VOLUME"])
        self.assertEqual(by_code["KR-067"]["comparison"]["aggregation"], "PER_ATTRIBUTE")
        self.assertEqual(by_code["POS-088"]["comparison"]["attributeKeys"],
                         ["TEMPORARY_POWER_DEMAND"])
        self.assertEqual(by_code["PPM-104"]["comparison"]["attributeKeys"],
                         ["EVACUATION_PASSAGE_WIDTH"])
        changed = copy.deepcopy(self.pack)
        row = next(item for item in changed["rules"] if item["parameterCode"] == "KR-067")
        row["attributes"] = [{"key": "MATERIAL_AMOUNT", "canonicalUnit": "m3"}]
        with self.assertRaises(ValueError):
            self._load_mutation(changed)

    def test_unverified_class_set_and_normative_semantics_are_abstain(self) -> None:
        loaded = load_candidate_family_pack()
        for row in loaded["rules"]:
            if row["family"] in {"CLASS_DECREASE", "PRESENCE_SET"}:
                self.assertIsNone(row["comparison"]["operator"])
                self.assertIsNone(row["comparison"]["threshold"])
                self.assertEqual(row["evaluationPolicy"], "NON_EXECUTING_ABSTAIN")
            if row["family"] in {"LOWER_BOUND", "UPPER_BOUND"}:
                self.assertIn("NORM_APPLICABILITY_VERIFIED", row["requiredContext"])
                self.assertEqual(row["evaluationPolicy"], "NON_EXECUTING_ABSTAIN")

    def test_non_catalog_baseline_and_relative_denominator_remain_unresolved(self) -> None:
        loaded = load_candidate_family_pack()
        by_code = {row["parameterCode"]: row for row in loaded["rules"]}
        self.assertIsNone(by_code["POS-086"]["comparison"]["operator"])
        self.assertIn("SITE_CAMP_CAPACITY_BASIS", by_code["POS-086"]["requiredContext"])
        for code in ("PZ-002", "SPZU-024", "KR-067", "POS-082", "SM-132"):
            with self.subTest(code=code):
                self.assertIsNone(by_code[code]["comparison"]["relativeBasis"])
                self.assertIn("RELATIVE_DENOMINATOR_VERIFIED", by_code[code]["requiredContext"])

    def test_manifest_sections_and_drawing_marks_are_distinct(self) -> None:
        loaded = load_candidate_family_pack()
        by_code = {row["parameterCode"]: row for row in loaded["rules"]}
        for code in ("KR-061", "KR-062", "KR-067"):
            with self.subTest(code=code):
                row = by_code[code]
                self.assertEqual(row["requiredExpectedSections"], ["KR"])
                self.assertEqual(row["requiredActualSections"], ["KR"])
                self.assertEqual(row["manifestSectionStatus"]["actual"], "EXACT_CATEGORY")
                self.assertIn("KJ", row["requiredActualDrawingSections"])
                self.assertIn("DRAWING_SECTION_VERIFIED", row["requiredContext"])
        self.assertEqual(by_code["KR-067"]["requiredActualDrawingSections"], ["KJ", "KM"])

        manifest_path = PACK_PATH.parents[3] / "datasets/reference_methodology/hackathon_gold_20260811" / \
            "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
        rows = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines()
                if line.strip()]
        allowed = [row for row in rows if row["split"] == "TRAIN_PUBLIC"
                   and row["distribution_status"] == "INCLUDE"
                   and row["label_visibility"] == "PUBLIC_TRAIN"]
        self.assertEqual(len(allowed), 203)
        kr_source_ids = {"F0105", "F0106", "F0107", "F0136", "F0139", "F0140",
                         "F0141", "F0142", "F0143", "F0144"}
        selected = {row["file_id"]: row for row in allowed if row["file_id"] in kr_source_ids}
        self.assertEqual(set(selected), kr_source_ids)
        self.assertTrue(all(row["section"] == "KR" for row in selected.values()))
        self.assertTrue(all(selected[code]["stage"] == "PD"
                            for code in {"F0105", "F0106", "F0107"}))
        self.assertTrue(all(selected[code]["stage"] == "RD"
                            for code in kr_source_ids - {"F0105", "F0106", "F0107"}))
        manifest_categories = {row["section"] for row in allowed}
        for rule in loaded["rules"]:
            for side in ("Expected", "Actual"):
                strict = rule[f"required{side}Sections"]
                self.assertTrue(set(strict) <= manifest_categories)
                if not strict:
                    self.assertEqual(rule["manifestSectionStatus"][side.lower()], "UNKNOWN_ABSTAIN")
                    self.assertIn(f"{side.upper()}_MANIFEST_SECTION_UNRESOLVED",
                                  rule["requiredContext"])
        self.assertEqual(by_code["SPZU-024"]["requiredActualSections"], [])
        self.assertEqual(by_code["SPZU-024"]["requiredActualDrawingSections"], ["PP"])


if __name__ == "__main__":
    unittest.main()
