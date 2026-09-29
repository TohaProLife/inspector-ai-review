from __future__ import annotations

import copy
import unittest

from inspector_worker.pz010_index_observations import (
    OBJECT_ID, PUBLIC_MANIFEST_SHA256, SOURCE_ID, SOURCE_SHA256, _build_report,
)


def block(text: str, bbox: list[int]) -> dict:
    return {"text": text, "bboxMilliPoints": bbox}


def page(number: int, blocks: list[dict]) -> dict:
    return {
        "meta": {
            "manifestSha256": PUBLIC_MANIFEST_SHA256,
            "indexVersionHash": "index-version", "sourceFileId": SOURCE_ID,
            "sourceSha256": SOURCE_SHA256, "sourceRelativePath": "public/F0101.pdf",
            "objectId": OBJECT_ID, "stage": "PD", "section": "OTHER",
            "pageNumber": number, "pageArtifactSha256": str(number) * 64,
            "parserProvenance": "PDFMINER",
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        },
        "page": {"blocks": blocks},
    }


def title_page() -> dict:
    return page(1, [
        block("ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ", [201540, 627431, 414527, 641411]),
        block("Раздел 1", [267480, 592920, 345886, 608940]),
        block("Часть 2 «Пояснительная записка»", [178020, 563040, 438555, 579060]),
        block("НВС-2025/03-ПЗ", [240000, 530831, 364007, 544811]),
    ])


def total_page() -> dict:
    # Exact public F0101 p10 text and bottom-left milli-point geometry, with
    # other nearby numeric cells to verify row/column uniqueness.
    return page(10, [
        block("Всего:   Примечание", [456300, 650466, 567025, 660486]),
        block("Количество квартир, в \nт.ч.:", [96600, 636966, 212606, 658506]),
        block("12", [72780, 642726, 86662, 652746]),
        block("кв.", [241980, 642726, 258687, 652746]),
        block("92", [466740, 631026, 480622, 641046]),
        block("Корпус 1  шт. \nКорпус 2  шт.", [181740, 600066, 259407, 625566]),
        block("62", [466740, 615546, 480622, 625566]),
        block("30", [466740, 600066, 480622, 610086]),
        block("47", [323880, 631026, 353967, 666246]),
    ])


class Pz010IndexObservationTests(unittest.TestCase):
    def test_real_shaped_printed_total_is_review_only(self) -> None:
        report = _build_report(title_page(), total_page())
        self.assertEqual(report["comparisonDisposition"], "ABSTAIN")
        self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertIsNone(report["finding"])
        self.assertEqual(len(report["observations"]), 1)
        observed = report["observations"][0]
        fact = observed["typedFact"]
        self.assertEqual((fact["parameterCode"], fact["attribute"], fact["rawValue"],
                          fact["rawUnit"]), ("PZ-010", "APARTMENT_COUNT", "92", "кв."))
        self.assertEqual(observed["normalizedValueCount"], 92)
        self.assertEqual((fact["sourceFileId"], fact["sourceSha256"], fact["pageNumber"]),
                         (SOURCE_ID, SOURCE_SHA256, 10))
        self.assertEqual(fact["locator"]["bboxMilliPoints"], [466740, 631026, 480622, 641046])
        self.assertEqual(fact["labelLocator"]["text"], "Количество квартир, в \nт.ч.:")
        self.assertEqual(fact["unitLocator"]["text"], "кв.")
        self.assertEqual(fact["contextLocator"]["text"], "Всего:   Примечание")
        self.assertEqual([item["text"] for item in observed["sourceSectionProof"]["markers"]], [
            "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ", "Раздел 1", "Часть 2 «Пояснительная записка»",
            "НВС-2025/03-ПЗ",
        ])
        self.assertEqual(len(report["contentHash"]), 64)
        self.assertNotIn("coverage", report)

    def test_missing_or_duplicate_title_marker_abstains(self) -> None:
        for mode in ("missing", "duplicate"):
            title = title_page()
            if mode == "missing":
                title["page"]["blocks"].pop(2)
            else:
                title["page"]["blocks"].append(copy.deepcopy(title["page"]["blocks"][2]))
            report = _build_report(title, total_page())
            self.assertEqual(report["observations"], [])
            self.assertIn("PD_PZ_SECTION_UNPROVEN", report["evaluation"]["reasonCodes"])

    def test_duplicate_label_value_wrong_unit_or_row_abstains(self) -> None:
        for mode in ("duplicate-label", "duplicate-value", "wrong-unit", "wrong-row"):
            total = total_page()
            blocks = total["page"]["blocks"]
            if mode == "duplicate-label":
                blocks.append(copy.deepcopy(blocks[1]))
            elif mode == "duplicate-value":
                blocks.append(block("93", [467000, 631026, 481000, 641046]))
            elif mode == "wrong-unit":
                blocks[3]["text"] = "кв. м"
            else:
                blocks[4]["bboxMilliPoints"] = [466740, 570000, 480622, 580000]
            report = _build_report(title_page(), total)
            self.assertEqual(report["observations"], [], mode)
            self.assertIn("APARTMENT_TOTAL_NOT_UNIQUE_OR_UNVERIFIED",
                          report["evaluation"]["reasonCodes"])

    def test_source_or_page_provenance_mismatch_fails_closed(self) -> None:
        total = total_page()
        total["meta"]["sourceSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "provenance differ"):
            _build_report(title_page(), total)
        total = total_page()
        total["meta"]["pageNumber"] = 9
        with self.assertRaisesRegex(ValueError, "expected pages"):
            _build_report(title_page(), total)


if __name__ == "__main__":
    unittest.main()
