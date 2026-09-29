from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.durable_pz017 import execute_durable_pz017


def artifact(source: str, sha: str, text: str) -> dict:
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source, "inputSha256": sha,
        "pages": [{"pageNumber": 1, "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
                   "blocks": [{"text": text, "bboxMilliPoints": [1000, 1000, 9000, 2000]}]}],
    }


def source(source_id: str, sha: str, stages: list[str]) -> dict:
    return {"sourceFileId": source_id, "sha256": sha, "stages": stages,
            "mediaType": "application/pdf"}


class DurablePz017Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.lease = {
            "objectId": "OBJ-1", "inputManifestHash": "f" * 64,
            "inputs": {"sourceFiles": [source("PD", "a" * 64, ["PD"]),
                                       source("RD", "b" * 64, ["RD", "ID"])],
                       "sourceDecisions": {"RD": {"sourceSha256": "b" * 64,
                                                   "pageStages": {"1": "RD"}}}},
        }
        self.artifacts = {
            "PD": artifact("PD", "a" * 64, "Тепловая нагрузка на отопление — 0,335 Гкал/ч"),
            "RD": artifact("RD", "b" * 64, "Тепловой поток на вентиляцию: 0,926 Гкал/ч"),
        }

    def run_analysis(self) -> dict:
        with patch("inspector_worker.durable_pz017.download_text_artifact",
                   side_effect=lambda _lease, item, _attempt: self.artifacts[item["sourceFileId"]]):
            return execute_durable_pz017(self.lease, {"attemptId": "a", "fencingToken": 1})

    def test_mismatched_component_basis_abstains_without_total_or_finding(self) -> None:
        result = self.run_analysis()
        self.assertEqual(result["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["evaluation"]["reasonCode"], "COMPONENT_BASIS_MISMATCH")
        self.assertEqual(result["comparison"]["disposition"], "ABSTAIN")
        self.assertFalse(result["comparison"]["totalComparable"])
        self.assertIsNone(result["comparison"]["finding"])
        self.assertEqual(result["scannedPages"], {"PD": 1, "RD": 1})
        self.assertEqual(result["pdFacts"][0]["evidence"][0]["bboxMilliPoints"], [1000, 1000, 9000, 2000])

    def test_mixed_source_without_page_stage_is_missing_evidence(self) -> None:
        del self.lease["inputs"]["sourceDecisions"]
        result = self.run_analysis()
        self.assertEqual(result["evaluation"]["machineStatus"], "MISSING_EVIDENCE")
        self.assertEqual(result["rdFacts"], [])
        self.assertEqual(result["scannedPages"], {"PD": 1, "RD": 0})

    def test_stale_or_forged_source_decision_rejected(self) -> None:
        self.lease["inputs"]["sourceDecisions"]["RD"]["sourceSha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "SHA differs"):
            self.run_analysis()
        self.lease["inputs"]["sourceDecisions"]["RD"]["sourceSha256"] = "b" * 64
        self.lease["inputs"]["sourceDecisions"]["RD"]["pageStages"] = {"1": "PD"}
        with self.assertRaisesRegex(ValueError, "differs from source stages"):
            self.run_analysis()

    def test_ocr_required_page_does_not_emit_fact(self) -> None:
        self.artifacts["RD"]["pages"][0]["quality"]["disposition"] = "OCR_REQUIRED"
        result = self.run_analysis()
        self.assertEqual(result["rdFacts"], [])
        self.assertEqual(result["ocrRequiredPageCount"], 1)

    def test_unambiguous_single_line_block_table_keeps_block_geometry(self) -> None:
        table = [
            ("Тепловой поток, Гкал/ч", [1000, 9000, 9000, 10000]),
            ("на отопление", [1000, 7000, 3000, 8000]),
            ("на вентиляцию", [5000, 7000, 8000, 8000]),
            ("0,335", [1000, 5000, 3000, 6000]),
            ("0,926", [5000, 5000, 8000, 6000]),
        ]
        self.artifacts["RD"]["pages"][0]["blocks"] = [
            {"text": text, "bboxMilliPoints": box} for text, box in table
        ]
        result = self.run_analysis()
        self.assertEqual([fact["component"] for fact in result["rdFacts"]], ["HEATING", "VENTILATION"])
        self.assertEqual(result["rdFacts"][0]["evidence"][2]["blockIndex"], 3)
        self.assertEqual(result["rdFacts"][0]["evidence"][2]["bboxMilliPoints"], [1000, 5000, 3000, 6000])
        self.artifacts["RD"]["pages"][0]["blocks"][1]["text"] += "\nother"
        self.assertEqual(self.run_analysis()["rdFacts"], [])

    def test_public_page_shape_multiline_headers_and_missing_columns(self) -> None:
        self.artifacts["PD"]["pages"][0]["blocks"] = [
            {"text": text, "bboxMilliPoints": box} for text, box in [
                ("Тепловая\nнагрузка Q,\nГкал/час\nТемперату", [77184, 107867, 150530, 170627]),
                ("Отопле\nние", [157820, 197417, 201884, 227537]),
                ("Вентил\nяция", [214610, 197417, 258302, 227537]),
                ("Теплов\nые\nзавесы", [272690, 189377, 317720, 235577]),
                ("ГВС\nмакс.", [328030, 199337, 358660, 225578]),
                ("0,331", [164900, 156587, 200000, 170627]),
                ("0,927", [221690, 156587, 256760, 170627]),
                ("0,108", [278330, 156587, 313400, 170627]),
                ("0,6024", [333070, 156587, 375100, 170627]),
            ]
        ]
        self.artifacts["RD"]["pages"][0]["blocks"] = [
            {"text": text, "bboxMilliPoints": box} for text, box in [
                ("Тепловой поток,\nТепловой поток, Гкал/ч", [850020, 264758, 958075, 275753]),
                ("на\nотопление", [783720, 223658, 820547, 246473]),
                ("на\nвентиляцию", [826440, 224198, 868658, 247013]),
                ("на тепло-\nзавесы", [874440, 223658, 911286, 246473]),
                ("на ГВС", [922980, 229538, 953457, 240533]),
                ("0.335", [793680, 189818, 815636, 200813]),
                ("0.926", [838500, 189758, 860456, 200753]),
                ("-", [890040, 190058, 894999, 201053]),
                ("см. ВК", [925920, 190058, 953571, 201053]),
                ("1,261", [975780, 189938, 995262, 200933]),
                ("0.335", [793680, 167138, 815636, 178133]),
                ("0.926", [838500, 167078, 860456, 178073]),
            ]
        ]
        result = self.run_analysis()
        self.assertEqual([fact["component"] for fact in result["pdFacts"]],
                         ["HEATING", "VENTILATION", "CURTAINS", "DHW"])
        self.assertEqual([fact["component"] for fact in result["rdFacts"]],
                         ["HEATING", "VENTILATION"])
        self.assertEqual(result["evaluation"]["reasonCode"], "COMPONENT_BASIS_MISMATCH")
        self.assertEqual(result["pdFacts"][0]["evidence"][0]["textKind"], "BLOCK")
        self.assertEqual(result["rdFacts"][0]["evidence"][2]["bboxMilliPoints"],
                         [793680, 189818, 815636, 200813])


if __name__ == "__main__":
    unittest.main()
