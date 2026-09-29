"""Focused classifier and source-integrity tests for AR-042 review."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from inspector_worker.ar_evacu_height_review import (
    HeightReviewError,
    _valid_line_geometry,
    classify_height_line,
    review_ocr_lines,
    select_ocr_dpi,
    verify_originals,
)


class EvacuationHeightReviewTests(unittest.TestCase):
    def test_height_mentions_stay_review_only_and_keep_raw_units(self) -> None:
        self.assertEqual(
            classify_height_line("Локальные проемы выполнить высотой не менее 2,2 м от пола"),
            ("LOCAL_OPENING_UNLINKED", ["2,2 м"]),
        )
        self.assertEqual(
            classify_height_line("Высота дверей лифтов принята 2,4 м"),
            ("LIFT_DOOR_CONTEXT", ["2,4 м"]),
        )
        self.assertEqual(
            classify_height_line("Все оконные проемы располагаются на высоте 1000 мм"),
            ("WINDOW_CONTEXT", ["1000 мм"]),
        )
        self.assertEqual(
            classify_height_line("Пороги в дверных проемах высотой не более 50 мм"),
            ("THRESHOLD_OR_LEVEL_CONTEXT", ["50 мм"]),
        )
        self.assertEqual(
            classify_height_line("Полоса на высоту 0,3 м от пола. В дверях"),
            ("IMPACT_STRIP_CONTEXT", ["0,3 м"]),
        )
        self.assertEqual(
            classify_height_line("Высота дверного проема на пути эвакуации 2,0 м"),
            ("EVACUATION_CONTEXT_UNLINKED", ["2,0 м"]),
        )
        self.assertIsNone(classify_height_line("Высота лестничных ограждений 1,2 м"))

    def test_candidate_requires_valid_page_geometry(self) -> None:
        page = {"widthMilliPoints": 1000, "heightMilliPoints": 2000}
        self.assertTrue(_valid_line_geometry({"bboxMilliPoints": [0, 1, 1000, 1999]}, page))
        self.assertFalse(_valid_line_geometry({"bboxMilliPoints": [0, 1, 1001, 1999]}, page))
        self.assertFalse(_valid_line_geometry({"bboxMilliPoints": [5, 1, 5, 100]}, page))

    def test_original_pdf_sha_gate_rejects_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "public.zip"
            source = {"relative_path": "PD/AR.pdf", "size_bytes": 4,
                      "sha256": hashlib.sha256(b"%PDF").hexdigest()}
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("public/PD/AR.pdf", b"%PDF")
            verify_originals(archive_path, {"F0104": source})
            with self.assertRaisesRegex(HeightReviewError, "SHA mismatch"):
                verify_originals(archive_path, {"F0104": {**source, "sha256": "0" * 64}})
            with self.assertRaisesRegex(HeightReviewError, "ambiguous"):
                verify_originals(archive_path, {"F0104": source, "F0156": source})

    def test_bounded_ocr_dpi_and_review_only_lead(self) -> None:
        self.assertEqual(select_ocr_dpi({"widthMilliPoints": 595000,
                                         "heightMilliPoints": 842000}), 120)
        self.assertLess(select_ocr_dpi({"widthMilliPoints": 3370000,
                                        "heightMilliPoints": 2384000}), 120)
        with self.assertRaisesRegex(HeightReviewError, "too large"):
            select_ocr_dpi({"widthMilliPoints": 10000000,
                            "heightMilliPoints": 10000000})
        leads = review_ocr_lines({"lines": [
            {"text": "Высота дверей лифтов 2,4 м", "bboxPx": [1, 2, 50, 20],
             "score": 0.9},
            {"text": "Локальный проем высотой 2,2 м", "bboxPx": [1, 30, 60, 50],
             "score": 0.8},
            {"text": "План этажа", "bboxPx": [1, 60, 50, 80], "score": 0.7},
        ]})
        self.assertEqual(len(leads), 2)
        self.assertEqual(leads[0]["contextClass"], "LIFT_DOOR_CONTEXT")
        self.assertEqual(leads[1]["reviewStatus"], "REVIEW_ONLY_ABSTAIN")
        self.assertIsNone(leads[1]["typedFact"])


if __name__ == "__main__":
    unittest.main()
