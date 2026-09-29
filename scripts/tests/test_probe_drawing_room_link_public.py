"""Conservative room candidate checks for the TRAIN_PUBLIC drawing probe."""

from __future__ import annotations

from pathlib import Path
import runpy
import unittest

import fitz


ROOM = runpy.run_path(str(Path(__file__).resolve().parents[1]
                       / "probe-drawing-room-link-public.py"))


def label(number: str, x: float, y: float) -> dict:
    return {"number": number, "center": fitz.Point(x, y),
            "text_bbox_display_pt": [x - 6, y - 4, x + 6, y + 4],
            "circle_bbox_display_pt": [x - 10, y - 10, x + 10, y + 10]}


class FakePage:
    def get_text(self, mode: str):
        assert mode == "words"
        return [(90, 96, 110, 104, "233", 0, 0, 0),
                (190, 96, 210, 104, "273", 0, 0, 1),
                (290, 96, 310, 104, "4500", 0, 0, 2)]


class RoomProbeTests(unittest.TestCase):
    def test_only_circled_room_numbers_are_candidates(self) -> None:
        circles = [
            {"color": (0, 0, 0), "rect": fitz.Rect(90, 90, 110, 110),
             "items": [("c",) for _ in range(4)]},
            {"color": (1, 0, 0), "rect": fitz.Rect(190, 90, 210, 110),
             "items": [("c",) for _ in range(4)]},
        ]
        labels = ROOM["circled_room_labels"](FakePage(), circles)
        self.assertEqual([item["number"] for item in labels], ["233"])

    def test_blocked_nearest_label_does_not_win(self) -> None:
        panel = fitz.Rect(100, 100, 106, 160)
        leader = [[100, 130], [55, 115]]  # Callout left, room interior right.
        labels = [label("226", 175, 165), label("273", 230, 130)]
        result = ROOM["propose_room"](
            panel, leader, labels,
            lambda _start, end: 3 if end.x == 175 else 0)
        self.assertEqual(result["room_status"], "ROOM_GROUP_CANDIDATE_REVIEW_REQUIRED")
        self.assertEqual(result["proposed_room_group"]["number"], "273")

    def test_wall_blocks_only_room_label(self) -> None:
        result = ROOM["propose_room"](
            fitz.Rect(100, 100, 106, 160), [[110, 130], [160, 115]],
            [label("233", 40, 135)], lambda _start, _end: 1)
        self.assertEqual(result["room_status"], "ABSTAIN_NO_UNOBSTRUCTED_ROOM_LABEL")

    def test_two_near_room_labels_abstain(self) -> None:
        result = ROOM["propose_room"](
            fitz.Rect(100, 100, 106, 160), [[100, 130], [55, 115]],
            [label("273", 200, 120), label("274", 205, 165)],
            lambda _start, _end: 0)
        self.assertEqual(result["room_status"], "ABSTAIN_MULTIPLE_ROOM_LABELS")

    def test_missing_callout_abstains(self) -> None:
        result = ROOM["propose_room"](
            fitz.Rect(100, 100, 106, 160), [], [label("273", 200, 120)],
            lambda _start, _end: 0)
        self.assertEqual(result["room_status"], "ABSTAIN_CALLOUT_UNLINKED")


if __name__ == "__main__":
    unittest.main()
