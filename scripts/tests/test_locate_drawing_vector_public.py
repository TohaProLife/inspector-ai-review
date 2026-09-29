from __future__ import annotations

from pathlib import Path
import runpy
import unittest

import fitz


LOCATOR = runpy.run_path(str(Path(__file__).resolve().parents[1]
                           / "locate-drawing-vector-public.py"))


class FakePage:
    def __init__(self, drawings: list[dict]) -> None:
        self.drawings = drawings

    def get_drawings(self) -> list[dict]:
        return self.drawings


class DrawingVectorLocatorTests(unittest.TestCase):
    def test_cross_object_transfer_requires_explicit_public_eval(self) -> None:
        source = {"split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE", "object_id": "A"}
        target = {"split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE", "object_id": "B"}
        with self.assertRaisesRegex(ValueError, "cross-object evaluation flag"):
            LOCATOR["validate_training_sources"](source, target, "A", False)
        LOCATOR["validate_training_sources"](source, target, "A", True)
        target["split"] = "TEST_HIDDEN"
        with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
            LOCATOR["validate_training_sources"](source, target, "A", True)

    def test_red_panel_with_blue_contact_is_deduplicated(self) -> None:
        panel = fitz.Rect(10, 10, 16, 70)
        unsupported = fitz.Rect(30, 10, 36, 70)
        page = FakePage([
            {"color": (1, 0, 0), "rect": panel, "items": []},
            {"color": (1, 0, 0), "rect": fitz.Rect(panel), "items": []},
            {"color": (1, 0, 0), "rect": unsupported, "items": []},
            {"color": (0, 0, 1), "items": [("l", fitz.Point(16, 40), fitz.Point(8, 40))]},
        ])
        self.assertEqual(LOCATOR["panels_with_blue_contact"](page, panel), [panel])

    def test_red_panel_without_blue_contact_is_not_proposed(self) -> None:
        panel = fitz.Rect(10, 10, 16, 70)
        page = FakePage([{"color": (1, 0, 0), "rect": panel, "items": []}])
        self.assertEqual(LOCATOR["panels_with_blue_contact"](page, panel), [])


if __name__ == "__main__":
    unittest.main()
