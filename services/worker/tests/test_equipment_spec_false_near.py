"""Audited near misses stay navigation, never equipment facts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.equipment_spec_false_near import (
    _find_near_context,
    evaluate_equipment_spec_false_near,
)


AUDITED = {
    "F0165": (Path("/tmp/inspector-equipment-false-near-F0165.pdf"),
              "f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64",
              24_884_908, 38, "VK", "IOS2-073"),
    "F0160": (Path("/tmp/inspector-equipment-false-near-F0160.pdf"),
              "72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd",
              38_153_328, 126, "EOM", "ODI-115"),
}


def manifest(file_id: str) -> dict:
    path, sha, size, pages, section, _ = AUDITED[file_id]
    return {"file_id": file_id, "object_id": "OBJ-TYUMENSKAYA-5-GOLD-SEED",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "sha256": sha,
            "size_bytes": size, "pdf_pages": pages, "stage": "PD",
            "section": section}


class EquipmentSpecFalseNearTests(unittest.TestCase):
    def test_pure_patterns_require_explicit_excluding_context(self) -> None:
        pump = ["Насосная", "установка", "для", "пожарной", "системы",
                "(спринклеры)", "Насосная", "установка:", "ВНУпж"]
        lift_board = ["ЩЛ", "-", "щит", "лифта", "(подъемника", "МГН);"]
        self.assertEqual(_find_near_context("F0165", pump),
                         [("FIRE_SPRINKLER_PUMP", 0, 6)])
        self.assertEqual(_find_near_context("F0160", lift_board),
                         [("LIFT_POWER_BOARD_LEGEND", 0, 6)])
        self.assertEqual(_find_near_context("F0165", ["Насосная", "установка", "для", "питьевой", "воды"]), [])
        self.assertEqual(_find_near_context("F0160", ["ЩЛ", "-", "подъемник", "МГН"]), [])
        self.assertEqual(_find_near_context("F0160", pump), [])

    def test_rejects_unapproved_changed_or_wrong_scope(self) -> None:
        for file_id in AUDITED:
            with self.subTest(file_id=file_id):
                row = manifest(file_id)
                with self.assertRaisesRegex(ValueError, "PDF SHA mismatch"):
                    evaluate_equipment_spec_false_near(b"not original", row)
                row["label_visibility"] = "RESTRICTED"
                with self.assertRaisesRegex(ValueError, "permitted public"):
                    evaluate_equipment_spec_false_near(b"not original", row)
                row = manifest(file_id)
                row["section"] = "OTHER"
                with self.assertRaisesRegex(ValueError, "audited source metadata"):
                    evaluate_equipment_spec_false_near(b"not original", row)

    def test_sha_checked_originals_are_near_but_ineligible(self) -> None:
        if not all(row[0].is_file() for row in AUDITED.values()):
            self.skipTest("public originals unavailable")
        for file_id, (path, sha, _, _, _, code) in AUDITED.items():
            with self.subTest(file_id=file_id):
                data = path.read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), sha)
                result = evaluate_equipment_spec_false_near(data, manifest(file_id))
                self.assertEqual(result["parameterCode"], code)
                self.assertEqual(result["status"], "ABSTAIN")
                self.assertEqual(result["purpose"], "REVIEW_ONLY")
                self.assertEqual(result["proposalCount"], 1)
                self.assertIsNone(result["findingCount"])
                self.assertIsNone(result["parameterCoverage"])
                self.assertIsNone(result["typedFact"])
                self.assertEqual(result["contentHash"], hashlib.sha256(json.dumps(
                    {k: v for k, v in result.items() if k != "contentHash"},
                    ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                    allow_nan=False).encode()).hexdigest())
                proposal = result["proposals"][0]
                self.assertEqual(proposal["eligibility"], "INELIGIBLE_FOR_PARAMETER_FACT")
                self.assertEqual(proposal["sourceFileId"], file_id)
                self.assertEqual(proposal["sourceSha256"], sha)
                self.assertEqual(proposal["pageNumber"], 26 if file_id == "F0165" else 37)
                self.assertTrue(proposal["wordLocators"])
                self.assertTrue(all(len(word["bboxMilliPointsTopLeft"]) == 4
                                    for word in proposal["wordLocators"]))
                self.assertFalse({"model", "quantity", "rawValue", "value"} & set(proposal))
                reason = ("FIRE_SPRINKLER_SYSTEM_NOT_DOMESTIC_DRINKING_WATER"
                          if file_id == "F0165" else "POWER_BOARD_NOT_INSTALLED_LIFT")
                self.assertIn(reason, proposal["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
