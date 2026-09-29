"""Focused checks for geometry and OCR callout linking, including abstention."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

import fitz


MODULE_PATH = Path(__file__).resolve().parents[1] / "link-drawing-vector-callouts-public.py"
SPEC = importlib.util.spec_from_file_location("drawing_callouts", MODULE_PATH)
assert SPEC and SPEC.loader
callouts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(callouts)


def line(text: str, box: list[float], score: float = .99) -> dict:
    return {"text": text, "score": score, "bbox_display_pt": box}


class LinkCalloutTests(unittest.TestCase):
    def test_leader_anchors_only_its_own_label(self) -> None:
        leaders = [(fitz.Point(1666.1, 271.6), fitz.Point(1599.5, 251.6))]
        lines = [line("PRADO Universal", [1535, 241, 1599, 252]),
                 line("11-300-2600", [1542, 253, 1599, 264]),
                 line("PRADO Universal", [1710, 241, 1774, 252]),
                 line("11-300-1900", [1717, 253, 1774, 264]),
                 line("φ16×2,2", [1720, 270, 1750, 285])]
        result = callouts.link_callout(leaders, lines)
        self.assertEqual(result["link_status"], "LINKED_LABEL_REVIEW_REQUIRED")
        self.assertEqual(result["model_text"], "11-300-2600")

    def test_missing_leader_abstains_even_with_visible_label(self) -> None:
        result = callouts.link_callout([], [line("PRADO Universal", [1, 1, 60, 12])])
        self.assertEqual(result["link_status"], "ABSTAIN_NO_LEADER")

    def test_ambiguous_anchored_labels_abstain(self) -> None:
        leaders = [(fitz.Point(100, 100), fitz.Point(50, 90)),
                   (fitz.Point(100, 110), fitz.Point(150, 90))]
        lines = [line("PRADO Universal", [5, 82, 50, 92]),
                 line("11-300-1500", [8, 93, 50, 103]),
                 line("PRADO Universal", [150, 82, 195, 92]),
                 line("21-400-2400", [150, 93, 192, 103])]
        result = callouts.link_callout(leaders, lines)
        self.assertEqual(result["link_status"], "ABSTAIN_AMBIGUOUS_OR_MISSING_CALLOUT")
        self.assertEqual(result["anchored_callout_count"], 2)

    def test_wrong_ocr_model_abstains(self) -> None:
        leaders = [(fitz.Point(100, 100), fitz.Point(50, 90))]
        lines = [line("PRADO Universal", [5, 82, 50, 92]),
                 line("φ16×2,2", [8, 93, 50, 103])]
        result = callouts.link_callout(leaders, lines)
        self.assertEqual(result["link_status"], "ABSTAIN_AMBIGUOUS_OR_MISSING_CALLOUT")

    def test_ocr_boxes_preserve_pdf_coordinates(self) -> None:
        response = {"schemaVersion": "document-ai-ocr-response-v1",
                    "results": [{"overall_ocr_res": {
                        "rec_texts": ["PRADO Universal"], "rec_scores": [.99],
                        "rec_boxes": [[30, 60, 90, 90]]}}]}
        lines = callouts.ocr_lines(response, fitz.Rect(100, 200, 300, 400), 3)
        self.assertEqual(lines[0]["bbox_display_pt"], [110.0, 220.0, 130.0, 230.0])


if __name__ == "__main__":
    unittest.main()
