"""Circle OCR only proposes complete decimal labels inside their source circle."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import runpy
import unittest

import fitz


OCR = runpy.run_path(str(Path(__file__).resolve().parents[1]
                      / "ocr-drawing-red-circles-public.py"))


def response(text: str, score: float = .99) -> dict:
    return {"schemaVersion": "document-ai-ocr-response-v1", "results": [
        {"overall_ocr_res": {"rec_texts": [text], "rec_scores": [score],
                             "rec_boxes": [[120, 120, 264, 264]]}}]}


class RedCircleOcrTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clip = fitz.Rect(34, 34, 66, 66)
        self.circle = fitz.Rect(40, 40, 60, 60)

    def test_complete_decimal_inside_circle_is_review_only(self) -> None:
        result = OCR["recognize"](response("233.1"), self.clip, self.circle)
        self.assertEqual(result["label_status"], "RED_SUBROOM_LABEL_REVIEW_REQUIRED")
        self.assertEqual(result["proposed_label"]["number"], "233.1")

    def test_incomplete_decimal_abstains(self) -> None:
        result = OCR["recognize"](response("233."), self.clip, self.circle)
        self.assertEqual(result["label_status"], "ABSTAIN_RED_SUBROOM_OCR")

    def test_low_score_abstains(self) -> None:
        result = OCR["recognize"](response("233.1", .85), self.clip, self.circle)
        self.assertEqual(result["label_status"], "ABSTAIN_RED_SUBROOM_OCR")

    def test_integer_room_mode_accepts_only_whole_number(self) -> None:
        result = OCR["recognize"](response("254"), self.clip, self.circle, "integer")
        self.assertEqual(result["label_status"], "RED_ROOM_LABEL_REVIEW_REQUIRED")
        self.assertEqual(result["proposed_label"]["number"], "254")
        rejected = OCR["recognize"](response("254.1"), self.clip, self.circle, "integer")
        self.assertEqual(rejected["label_status"], "ABSTAIN_RED_ROOM_OCR")

    @unittest.skipUnless(importlib.util.find_spec("cv2"), "OpenCV probe runtime required")
    def test_circle_stroke_is_removed_from_crop(self) -> None:
        import cv2
        import numpy as np

        with fitz.open() as document:
            page = document.new_page(width=100, height=100)
            page.draw_circle(fitz.Point(50, 50), 10, color=(1, 0, 0), width=.42)
            clip, original, cleaned = OCR["crop_without_circle"](page, self.circle)
        self.assertEqual(clip, self.clip)
        before = cv2.imdecode(np.frombuffer(original, np.uint8), cv2.IMREAD_COLOR)
        after = cv2.imdecode(np.frombuffer(cleaned, np.uint8), cv2.IMREAD_COLOR)
        self.assertGreater(np.count_nonzero(before[:, :, 1] < 250), 0)
        self.assertLess(np.count_nonzero(after[:, :, 1] < 250),
                        np.count_nonzero(before[:, :, 1] < 250))


if __name__ == "__main__":
    unittest.main()
