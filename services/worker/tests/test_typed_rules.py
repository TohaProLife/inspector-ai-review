from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.analysis_pilot import run_pz002_pilot
from inspector_worker.typed_rules import evaluate_numeric_rule
from inspector_worker.numeric_extraction import extract_pz_002_facts
from inspector_worker.parameter_routing import route_parameter
from inspector_worker.table_rows import validate_table_row_fact
from inspector_worker.text_layer import qualify_page_text
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.table_visual import crosscheck_table_fact
from test_parameter_routing import HASH_A, HASH_B, artifact, page


def case() -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    rule = {
        "schemaVersion": "typed-numeric-rule-v1",
        "ruleId": "pz-002-area-v1",
        "version": "1",
        "parameterCode": "PZ-002",
        "objectId": "OBJECT-1",
        "expectedStage": "PD",
        "actualStage": "RD",
        "canonicalUnit": "m2",
        "comparator": {"family": "RELATIVE_DELTA", "threshold": "0.01", "operator": ">"},
    }
    sources = [
        {"sourceFileId": "PD-1", "sha256": HASH_A, "objectId": "OBJECT-1", "stages": ["PD"],
         "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "linkGroupId": "BUILDING-1"},
        {"sourceFileId": "RD-1", "sha256": HASH_B, "objectId": "OBJECT-1", "stages": ["RD"],
         "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "linkGroupId": "BUILDING-1"},
    ]
    artifacts = [
        artifact("PD-1", HASH_A, [page(1, "Общая площадь здания 100,00 м²")]),
        artifact("RD-1", HASH_B, [page(1, "Общая площадь здания 102,00 м²")]),
    ]
    facts = [
        {"sourceFileId": "PD-1", "inputSha256": HASH_A, "pageNumber": 1,
         "blockIndex": 0, "entityKey": "building-total", "rawValue": "100,00", "unit": "м²"},
        {"sourceFileId": "RD-1", "inputSha256": HASH_B, "pageNumber": 1,
         "blockIndex": 0, "entityKey": "building-total", "rawValue": "102,00", "unit": "м²"},
    ]
    return rule, sources, artifacts, facts


class TypedRuleTests(unittest.TestCase):
    def test_mixed_source_unresolved_pages_cannot_produce_candidate(self) -> None:
        rule, sources, artifacts, facts = case()
        sources[1]["stages"] = ["RD", "ID"]
        artifacts[1] = artifact("RD-1", HASH_B, [
            page(1, "Общая площадь здания 102,00 м²"), page(2, "Каталог оборудования"),
        ])
        sources[1]["pageStages"] = {"1": "RD", "2": "UNRESOLVED"}
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual((result["machineStatus"], result["reasonCode"]),
                         ("CLARIFICATION_REQUIRED", "STAGE_SEGMENTATION_REQUIRED"))
        sources[1]["pageStages"] = {"1": "RD"}
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual((result["machineStatus"], result["reasonCode"]),
                         ("CLARIFICATION_REQUIRED", "STAGE_SEGMENTATION_REQUIRED"))

    def test_table_row_is_bound_to_three_source_blocks_and_line_boxes(self) -> None:
        rule, sources, artifacts, facts = case()
        blocks = [
            {"bboxMilliPoints": [10_000, 20_000, 300_000, 120_000],
             "text": "Количество мест\nОбщая площадь здания, в т.ч.:\n- выше отм. 0,000"},
            {"bboxMilliPoints": [340_000, 90_000, 370_000, 110_000], "text": "м ²"},
            {"bboxMilliPoints": [400_000, 20_000, 470_000, 120_000],
             "text": "600\n100,00\n90,00"},
        ]
        page_data = {
            "pageNumber": 1, "widthMilliPoints": 595_000, "heightMilliPoints": 842_000,
            "blocks": blocks, "quality": qualify_page_text([block["text"] for block in blocks]),
        }
        artifacts[0] = artifact("PD-1", HASH_A, [page_data])
        facts[0] = {
            "sourceFileId": "PD-1", "inputSha256": HASH_A, "pageNumber": 1,
            "entityKey": "building-total", "rawValue": "100,00", "rawUnit": "м ²",
            "unit": "м²", "evidenceKind": "TABLE_ROW",
            "tableRow": {
                "label": {"blockIndex": 0, "lineIndex": 1,
                          "bboxMilliPoints": [10_000, 90_000, 280_000, 110_000]},
                "unit": {"blockIndex": 1, "lineIndex": 0,
                         "bboxMilliPoints": [345_000, 90_000, 365_000, 110_000]},
                "value": {"blockIndex": 2, "lineIndex": 1,
                          "bboxMilliPoints": [410_000, 90_000, 460_000, 110_000]},
            },
        }
        self.assertTrue(validate_table_row_fact(facts[0], page_data))
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"],
                         "TABLE_VISUAL_UNVERIFIED")
        visual = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "PD-1",
            "inputSha256": HASH_A, "pageNumber": 1,
            "render": {"sha256": "c" * 64, "widthPx": 1000, "heightPx": 1000,
                       "dpi": 120, "rendererProfileId": "test-render"},
            "provider": {"profileId": "test-ocr", "script": "eslav"},
            "lines": [
                {"text": "Общая площадь здания, в т.ч.:", "score": 0.96,
                 "bboxPx": [10, 100, 350, 130]},
                {"text": "100,00", "score": 0.99, "bboxPx": [500, 101, 590, 130]},
            ],
        }
        visual["contentHash"] = canonical_hash(visual)
        crosscheck = crosscheck_table_fact(facts[0], visual)
        self.assertIsNotNone(crosscheck)
        result = evaluate_numeric_rule(rule, sources, artifacts, facts,
                                       table_ocr_artifacts=[visual], table_crosschecks=[crosscheck])
        self.assertEqual(result["machineStatus"], "CANDIDATE")
        self.assertEqual(result["evidence"][0]["evidenceKind"], "TABLE_ROW")
        self.assertEqual(result["evidence"][0]["tableVisual"], crosscheck)
        wrong_row = copy.deepcopy(visual)
        wrong_row["lines"][1]["bboxPx"] = [500, 150, 590, 180]
        wrong_row["contentHash"] = canonical_hash({key: value for key, value in wrong_row.items()
                                                     if key != "contentHash"})
        self.assertIsNone(crosscheck_table_fact(facts[0], wrong_row))
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts,
                                               table_ocr_artifacts=[wrong_row],
                                               table_crosschecks=[crosscheck])["reasonCode"],
                         "TABLE_VISUAL_UNVERIFIED")
        tampered = copy.deepcopy(facts)
        tampered[0]["tableRow"]["value"]["lineIndex"] = 2
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, tampered,
                                              table_ocr_artifacts=[visual], table_crosschecks=[crosscheck])["reasonCode"],
                         "TABLE_ROW_PROVENANCE_MISMATCH")
        tampered = copy.deepcopy(facts)
        tampered[0]["tableRow"]["value"]["bboxMilliPoints"][1:4:2] = [20_000, 40_000]
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, tampered,
                                              table_ocr_artifacts=[visual], table_crosschecks=[crosscheck])["reasonCode"],
                         "TABLE_ROW_PROVENANCE_MISMATCH")

    def test_public_pilot_needs_reviewed_source_decisions_for_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for file_id, stage in (("PD-1", "PD"), ("RD-1", "RD")):
                path = root / f"{file_id}.pdf"
                path.write_bytes(file_id.encode())
                rows.append({
                    "file_id": file_id, "object_id": "OBJECT-1", "split": "TRAIN_PUBLIC",
                    "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                    "relative_path": path.name, "extension": ".pdf", "stage": stage,
                    "section": "PZ", "size_bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pdf_pages": 1,
                })
            manifest = root / "manifest.jsonl"
            manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
            navigation = {
                "ruleId": "pz-002-navigation", "version": "1", "parameterCode": "PZ-002",
                "requiredStages": ["PD", "RD"], "subjectTerms": ["общая площадь здания"],
                "locationTerms": [], "visualFactRequired": False,
            }
            numeric = case()[0]
            del numeric["objectId"]
            decisions = {
                row["file_id"]: {
                    "sourceSha256": row["sha256"], "revisionStatus": "CURRENT",
                    "approvalStatus": "APPROVED", "linkGroupId": "BUILDING-1",
                    "basis": {"reference": "synthetic reviewed fixture"},
                } for row in rows
            }

            def extract(_path: Path, file_id: str, digest: str) -> dict[str, object]:
                value = "100,00" if file_id == "PD-1" else "102,00"
                return artifact(file_id, digest, [page(1, f"Общая площадь здания {value} м²")])

            with patch("inspector_worker.public_pilot.extract_pdf_text_artifact", side_effect=extract):
                unreviewed = run_pz002_pilot(manifest, root, ["PD-1", "RD-1"], navigation, numeric)
                reviewed = run_pz002_pilot(manifest, root, ["PD-1", "RD-1"], navigation, numeric, decisions)
            self.assertEqual(unreviewed["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
            self.assertEqual(reviewed["evaluation"]["machineStatus"], "CANDIDATE")
            self.assertEqual(len(reviewed["extractedFacts"]), 2)

    def test_routing_to_text_extraction_to_typed_comparison(self) -> None:
        rule, sources, artifacts, _ = case()
        route = route_parameter({
            "schemaVersion": "parameter-route-request-v1", "inputManifestHash": "f" * 64,
            "objectId": "OBJECT-1",
            "rule": {
                "ruleId": "pz-002-navigation", "version": "1", "parameterCode": "PZ-002",
                "requiredStages": ["PD", "RD"], "sectionCodes": ["PZ"],
                "subjectTerms": ["общая площадь здания"], "locationTerms": [],
                "visualFactRequired": False,
            },
            "sources": sources, "textArtifacts": artifacts,
        })
        facts = extract_pz_002_facts(route, artifacts, entity_key="building-total")
        self.assertEqual(len(facts), 2)
        self.assertEqual([fact["rawValue"] for fact in facts], ["100,00", "102,00"])
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["machineStatus"], "CANDIDATE")

    def test_building_area_table_and_variable_forms_keep_source_locators(self) -> None:
        rule, sources, artifacts, _ = case()
        artifacts[0] = artifact("PD-1", HASH_A, [page(1,
            "Общая площадь здания, в т.ч.:\nм ²\n100,00\n- выше отм. 0,000 90")])
        artifacts[1] = artifact("RD-1", HASH_B, [page(1,
            "Общая площадь здания S=102,00 кв.м;")])
        route = route_parameter({
            "schemaVersion": "parameter-route-request-v1", "inputManifestHash": "f" * 64,
            "objectId": "OBJECT-1",
            "rule": {
                "ruleId": "pz-002-navigation", "version": "1", "parameterCode": "PZ-002",
                "requiredStages": ["PD", "RD"], "subjectTerms": ["общая площадь здания"],
                "locationTerms": [], "visualFactRequired": False,
            },
            "sources": sources, "textArtifacts": artifacts,
        })
        facts = extract_pz_002_facts(route, artifacts, entity_key="building-total")
        self.assertEqual([(fact["rawValue"], fact["unit"]) for fact in facts],
                         [("100,00", "м²"), ("102,00", "кв.м")])
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["machineStatus"], "CANDIDATE")
        self.assertEqual([item["blockIndex"] for item in result["evidence"]], [0, 0])

    def test_extraction_does_not_treat_plot_area_as_building_area(self) -> None:
        rule, sources, artifacts, _ = case()
        artifacts[1] = artifact("RD-1", HASH_B, [page(1, "Общая площадь участка 102,00 м²")])
        route = route_parameter({
            "schemaVersion": "parameter-route-request-v1", "inputManifestHash": "f" * 64,
            "objectId": "OBJECT-1",
            "rule": {
                "ruleId": "pz-002-navigation", "version": "1", "parameterCode": "PZ-002",
                "requiredStages": ["PD", "RD"], "subjectTerms": ["общая площадь"],
                "locationTerms": [], "visualFactRequired": False,
            },
            "sources": sources, "textArtifacts": artifacts,
        })
        facts = extract_pz_002_facts(route, artifacts, entity_key="building-total")
        self.assertEqual([fact["sourceFileId"] for fact in facts], ["PD-1"])
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["machineStatus"], "MISSING_EVIDENCE")

    def test_candidate_has_two_verified_source_locators_and_fingerprint(self) -> None:
        result = evaluate_numeric_rule(*case())
        self.assertEqual(result["machineStatus"], "CANDIDATE")
        self.assertEqual(result["normalizedExpected"], "100.00")
        self.assertEqual(result["normalizedActual"], "102.00")
        self.assertEqual(result["delta"], "0.02")
        self.assertEqual([item["sourceFileId"] for item in result["evidence"]], ["PD-1", "RD-1"])
        self.assertEqual(result["evidence"][0]["bboxMilliPoints"], [100, 200, 500, 600])
        self.assertEqual(len(result["evidenceFingerprint"]), 64)

    def test_strict_threshold_and_zero_baseline(self) -> None:
        rule, sources, artifacts, facts = case()
        artifacts[1] = artifact("RD-1", HASH_B, [page(1, "Общая площадь здания 101,00 м²")])
        facts[1]["rawValue"] = "101,00"
        incomplete = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(incomplete["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(incomplete["reasonCode"], "NEGATIVE_COVERAGE_UNVERIFIED")
        artifacts[0] = artifact("PD-1", HASH_A, [page(1, "Общая площадь здания 0 м²")])
        facts[0]["rawValue"] = "0"
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["machineStatus"], "NOT_COMPARABLE")
        self.assertEqual(result["reasonCode"], "ZERO_BASELINE")

    def test_missing_fact_never_becomes_negative(self) -> None:
        rule, sources, artifacts, facts = case()
        result = evaluate_numeric_rule(rule, sources, artifacts, facts[:1])
        self.assertEqual(result["machineStatus"], "MISSING_EVIDENCE")
        self.assertEqual(result["evidenceFingerprint"], None)

    def test_unknown_approval_and_link_conflict_abstain(self) -> None:
        rule, sources, artifacts, facts = case()
        sources[1]["approvalStatus"] = "UNKNOWN"
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"], "APPROVAL_UNRESOLVED")
        sources[1]["approvalStatus"] = "APPROVED"
        sources[1]["linkGroupId"] = "DIFFERENT-BUILDING"
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"], "LINK_CONFLICT")

    def test_cross_object_or_forged_value_fails_closed(self) -> None:
        rule, sources, artifacts, facts = case()
        sources[1]["objectId"] = "OBJECT-2"
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["machineStatus"], "NOT_COMPARABLE")
        self.assertEqual(result["reasonCode"], "CROSS_OBJECT_SOURCE")

        sources[1]["objectId"] = "OBJECT-1"
        facts[1]["rawValue"] = "999"
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["machineStatus"], "NOT_COMPARABLE")
        self.assertEqual(result["reasonCode"], "VALUE_NOT_IN_SOURCE_BLOCK")

        facts[1]["rawValue"] = "102,00"
        facts[1]["unit"] = "см²"
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["reasonCode"], "VALUE_UNIT_NOT_IN_SOURCE_BLOCK")

        facts[1]["unit"] = "м²"
        artifacts[1] = artifact("RD-1", HASH_B, [page(1, "Общая площадь участка 102,00 м²")])
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["machineStatus"], "NOT_COMPARABLE")
        self.assertEqual(result["reasonCode"], "PZ_002_LABEL_NOT_IN_SOURCE_BLOCK")

    def test_ambiguous_entities_and_duplicate_facts_abstain(self) -> None:
        rule, sources, artifacts, facts = case()
        facts[1]["entityKey"] = "other-building"
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"], "ENTITY_LINK_CONFLICT")
        facts[1]["entityKey"] = "building-total"
        facts.append(copy.deepcopy(facts[1]))
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"], "AMBIGUOUS_FACTS")

    def test_unit_conversion_and_invalid_units(self) -> None:
        rule, sources, artifacts, facts = case()
        artifacts[1] = artifact("RD-1", HASH_B, [page(1, "Общая площадь здания 1020000 дм²")])
        facts[1]["rawValue"] = "1020000"
        facts[1]["unit"] = "дм²"
        self.assertEqual(evaluate_numeric_rule(rule, sources, artifacts, facts)["reasonCode"], "INVALID_UNIT")

        artifacts[1] = artifact("RD-1", HASH_B, [page(1, "Общая площадь здания 1020000 см²")])
        facts[1]["unit"] = "см²"
        result = evaluate_numeric_rule(rule, sources, artifacts, facts)
        self.assertEqual(result["normalizedActual"], "102.0000")
        self.assertEqual(result["machineStatus"], "CANDIDATE")


if __name__ == "__main__":
    unittest.main()
