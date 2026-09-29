"""Red subroom links require OCR, a matching red circle, and a clear wall ray."""

from __future__ import annotations

from pathlib import Path
import runpy
import unittest

import fitz


SUBROOM = runpy.run_path(str(Path(__file__).resolve().parents[1]
                          / "probe-drawing-subroom-link-public.py"))


def line(number: str, x: float = 50, y: float = 130, score: float = .96) -> dict:
    return {"text": number, "score": score,
            "bbox_display_pt": [x - 8, y - 5, x + 8, y + 5]}


class SubroomProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.panel = fitz.Rect(100, 100, 106, 160)
        self.leader = [[105, 130], [160, 130]]  # Callout right, interior left.
        self.circle = fitz.Rect(40, 120, 60, 140)

    def test_red_circle_requires_four_bezier_segments(self) -> None:
        drawings = [
            {"color": (1, 0, 0), "rect": self.circle,
             "items": [("c",) for _ in range(4)]},
            {"color": (0, 0, 0), "rect": fitz.Rect(70, 120, 90, 140),
             "items": [("c",) for _ in range(4)]},
            {"color": (1, 0, 0), "rect": fitz.Rect(10, 120, 30, 140),
             "items": [("l",) for _ in range(4)]},
        ]
        self.assertEqual(SUBROOM["red_circles"](drawings), [self.circle])

    def test_clear_red_label_remains_review_only(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader, [line("233.2")], [self.circle],
            lambda _start, _end: 0)
        self.assertEqual(result["subroom_status"], "SUBROOM_CANDIDATE_REVIEW_REQUIRED")
        self.assertEqual(result["proposed_subroom"]["number"], "233.2")

    def test_wall_blocks_visible_neighbor_subroom(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader, [line("233.2")], [self.circle],
            lambda _start, _end: 1)
        self.assertEqual(result["subroom_status"], "ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM")
        self.assertEqual(result["red_subroom_options"][0]["wall_mask_hits"], 1)

    def test_ocr_text_without_red_circle_does_not_link(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader, [line("233.2")], [], lambda _start, _end: 0)
        self.assertEqual(result["subroom_status"], "ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM")

    def test_multiple_visible_subrooms_abstain(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader,
            [line("233.1", 50, 100), line("233.2", 50, 160)],
            [fitz.Rect(40, 90, 60, 110), fitz.Rect(40, 150, 60, 170)],
            lambda _start, _end: 0)
        self.assertEqual(result["subroom_status"], "ABSTAIN_MULTIPLE_SUBROOM_LABELS")

    def test_distant_second_label_does_not_block_review_proposal(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader,
            [line("233.1", 50, 130), line("233.2", 50, 240)],
            [fitz.Rect(40, 120, 60, 140), fitz.Rect(40, 230, 60, 250)],
            lambda _start, _end: 0)
        self.assertEqual(result["subroom_status"], "SUBROOM_CANDIDATE_REVIEW_REQUIRED")
        self.assertEqual(result["proposed_subroom"]["number"], "233.1")

    def test_low_confidence_label_abstains(self) -> None:
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader, [line("233.2", score=.89)], [self.circle],
            lambda _start, _end: 0)
        self.assertEqual(result["subroom_status"], "ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM")

    def test_paired_vector_wall_blocks_label_missed_by_raster(self) -> None:
        drawings = [
            {"color": (0, 0, 0), "items": [("l", fitz.Point(10, y), fitz.Point(90, y))]}
            for y in (120, 122, 140)]
        segments = SUBROOM["paired_horizontal_walls"](drawings)
        self.assertEqual(len(segments), 2)
        self.assertEqual(SUBROOM["vector_wall_hits"](
            segments, fitz.Point(50, 155), fitz.Point(50, 100)), 2)
        self.assertEqual(SUBROOM["vector_wall_hits"](
            segments, fitz.Point(50, 155), fitz.Point(50, 145)), 0)
        result = SUBROOM["propose_subroom"](
            self.panel, self.leader, [line("233.2", 50, 100)],
            [fitz.Rect(40, 90, 60, 110)], lambda _start, _end: 0,
            lambda _start, _end: 2)
        self.assertEqual(result["subroom_status"], "ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM")
        self.assertEqual(result["red_subroom_options"][0]["paired_vector_wall_hits"], 2)


if __name__ == "__main__":
    unittest.main()
