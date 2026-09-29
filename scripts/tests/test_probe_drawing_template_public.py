from __future__ import annotations

from pathlib import Path
import runpy
import unittest

import fitz
import numpy as np


PROBE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "probe-drawing-template-public.py"))


class FakePage:
    def __init__(self, drawings: list[dict]) -> None:
        self.drawings = drawings

    def get_drawings(self) -> list[dict]:
        return self.drawings


class DrawingTemplateProbeTests(unittest.TestCase):
    def test_tile_origin_is_applied_on_both_axes(self) -> None:
        display = PROBE["tile_bbox_to_display"]((10, 20, 30, 40), (100, 200), 2)
        self.assertEqual(display, [55, 110, 65, 120])

    def test_color_signal_separates_red_and_blue(self) -> None:
        image = np.array([[[0, 0, 255], [255, 0, 0], [255, 255, 255]]], dtype=np.uint8)
        self.assertEqual(PROBE["signal_mask"](image, "red").tolist(), [[255, 0, 0]])
        self.assertEqual(PROBE["signal_mask"](image, "red_blue").tolist(), [[255, 127, 0]])

    def test_vector_context_requires_blue_contact_on_either_side(self) -> None:
        panel = fitz.Rect(10, 10, 16, 70)
        other = fitz.Rect(30, 10, 36, 70)
        page = FakePage([
            {"color": (1, 0, 0), "rect": panel, "items": []},
            {"color": (1, 0, 0), "rect": other, "items": []},
            {"color": (0, 0, 1), "items": [("l", fitz.Point(16, 40), fitz.Point(8, 20))]},
        ])
        supported = PROBE["red_panel_with_blue_leader_paths"](page, 6, 60)
        self.assertEqual(supported, [panel])

    def test_variable_height_panel_can_support_longer_template_box(self) -> None:
        panel = fitz.Rect(2262, 276.4, 2267.7, 316.12)
        candidate = [2261.98, 275.96, 2268.02, 344.4]
        self.assertTrue(PROBE["candidate_overlaps_panel"](candidate, panel))
        self.assertFalse(PROBE["candidate_overlaps_panel"]([100, 100, 106, 168], panel))


if __name__ == "__main__":
    unittest.main()
