"""Semantic raster oracles: valid PNG dimensions alone cannot locate evidence."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import fitz

from inspector_worker import visual_proposal_adapter as adapter
from inspector_worker.visual_vlm import observe_proposals, render_crop


DISPLAY_METHOD = "normalized-display-square-v2"
LEGACY_METHOD = "normalized-derotated-square-v1"


def semantic_crop_fixture(directory: Path, rotation: int, offset: bool = False):
    """Public synthetic geometry, independent quarter-turn coordinate oracle."""
    path = directory / f"r{rotation}-{'offset' if offset else 'ordinary'}.pdf"
    with fitz.open() as document:
        page = document.new_page(width=600 if offset else 400, height=500 if offset else 300)
        ox, oy = (50, 40) if offset else (0, 0)
        for box, color in [((70, 60, 80, 90), (1, 0, 0)),
                           ((86, 68, 93, 76), (0, 0, 1)),
                           ((290, 210, 310, 230), (0, 1, 0))]:
            page.draw_rect(fitz.Rect(box[0] + ox, box[1] + oy, box[2] + ox, box[3] + oy),
                           color=None, fill=color)
        if offset:
            page.set_cropbox(fitz.Rect(50, 40, 450, 340))
        page.set_rotation(rotation)
        document.save(path)
    # Red marker center and bounds after quarter turns, without PyMuPDF matrices.
    centers = {0: (75, 75), 90: (225, 75), 180: (325, 225), 270: (75, 325)}
    boxes = {0: (70, 60, 80, 90), 90: (210, 70, 240, 80),
             180: (320, 210, 330, 240), 270: (60, 320, 90, 330)}
    width, height = (400, 300) if rotation in {0, 180} else (300, 400)
    box = boxes[rotation]
    bbox = [box[0] / width, box[1] / height, box[2] / width, box[3] / height]
    cx, cy = centers[rotation]
    # Four-times the marker's longest physical edge = a 120 point square.
    return path, bbox, fitz.Rect(cx - 60, cy - 60, cx + 60, cy + 60)


def color_counts(pixmap):
    samples = pixmap.samples
    pixels = zip(samples[0::3], samples[1::3], samples[2::3])
    red = blue = green = 0
    for r, g, b in pixels:
        red += r > 200 and g < 60 and b < 60
        blue += b > 200 and r < 60 and g < 60
        green += g > 200 and r < 60 and b < 60
    return red, blue, green


class VisualCropV8Tests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def test_eight_rotations_and_cropbox_offsets_equal_full_page_raster_oracle(self):
        for offset in [False, True]:
            for rotation in [0, 90, 180, 270]:
                with self.subTest(rotation=rotation, offset=offset):
                    path, bbox, clip = semantic_crop_fixture(self.directory, rotation, offset)
                    png = render_crop(path, 1, bbox)
                    crop = fitz.Pixmap(png)
                    self.assertEqual((crop.width, crop.height), (768, 768))
                    self.assertEqual(color_counts(crop), (12288, 2244, 0))
                    self.assertEqual(png, render_crop(path, 1, bbox))
                    with fitz.open(path) as document:
                        full = document[0].get_pixmap(matrix=fitz.Matrix(6.4, 6.4), alpha=False)
                    # Compare against full-page raster, not another clipped renderer.
                    x0, y0 = round(clip.x0 * 6.4), round(clip.y0 * 6.4)
                    expected, actual = full.samples, crop.samples
                    for row in range(1, 767):
                        start = ((y0 + row) * full.width + x0 + 1) * 3
                        self.assertEqual(actual[(row * 768 + 1) * 3:(row * 768 + 767) * 3],
                                         expected[start:start + 766 * 3])

    def test_legacy_path_and_unrotated_bytes_remain_exact(self):
        old_hashes = {0: "762b520da4dcc130f99cc22c95d0e391ebda3bba5e1c19bebee6e9a6f30127bb",
                      90: "253abafd4360055a5e350769031ad5d4d1d8595175bab318fb2a3a9dc71aef05"}
        for offset in [False, True]:
            for rotation in [0, 90, 180, 270]:
                with self.subTest(rotation=rotation, offset=offset):
                    path, bbox, displayed = semantic_crop_fixture(self.directory, rotation, offset)
                    legacy = render_crop(path, 1, bbox, crop_method_id=LEGACY_METHOD)
                    with fitz.open(path) as document:
                        page = document[0]
                        old_png = page.get_pixmap(matrix=fitz.Matrix(6.4, 6.4),
                            clip=displayed * page.derotation_matrix, alpha=False).tobytes("png")
                    self.assertEqual(legacy, old_png)
                    if not offset and rotation in old_hashes:
                        self.assertEqual(hashlib.sha256(legacy).hexdigest(), old_hashes[rotation])
                    if rotation == 0:
                        self.assertEqual(legacy, render_crop(path, 1, bbox))

    def test_invalid_bbox_page_method_and_pixel_png_limits_fail_closed(self):
        path, bbox, _ = semantic_crop_fixture(self.directory, 0)
        for invalid in [[], [0, 0, 0, 1], [-.1, 0, 1, 1], [0, 0, 1.1, 1],
                        [0, 0, float("nan"), 1], [0, 0, float("inf"), 1], ["0", 0, 1, 1]]:
            with self.subTest(bbox=invalid), self.assertRaises(ValueError):
                render_crop(path, 1, invalid)
        for page in [0, 2]:
            with self.subTest(page=page), self.assertRaises(ValueError):
                render_crop(path, page, bbox)
        with self.assertRaisesRegex(ValueError, "crop method"):
            render_crop(path, 1, bbox, crop_method_id="unversioned")
        with self.assertRaises(ValueError):
            render_crop(path, 1, bbox, max_edge=0)
        with patch("inspector_worker.visual_vlm.MAX_CROP_BYTES", 10):
            with self.assertRaisesRegex(ValueError, "PNG exceeds limit"):
                render_crop(path, 1, bbox)
        for width, height in [(0, 768), (768, 0), (773, 1), (1, 773)]:
            with self.subTest(width=width, height=height), \
                 patch.object(fitz.Page, "get_pixmap", return_value=SimpleNamespace(width=width, height=height)):
                with self.assertRaisesRegex(ValueError, "pixel count exceeds limit"):
                    render_crop(path, 1, bbox)
        for edge in [32, 768, 2048]:
            crop = fitz.Pixmap(render_crop(path, 1, bbox, max_edge=edge))
            self.assertLessEqual(max(crop.width, crop.height), edge + 4)

    def test_observe_defaults_legacy_and_explicit_v8_uses_displayed_crop(self):
        path, bbox, _ = semantic_crop_fixture(self.directory, 90)
        source = {"sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "proposals": [{"pageNumber": 1, "bboxNormalized": bbox}]}
        before = json.loads(json.dumps(source))
        old = observe_proposals(path, source, None)["observations"][0]
        new = observe_proposals(path, source, None, crop_method_id=DISPLAY_METHOD)["observations"][0]
        self.assertEqual(old["cropSha256"], hashlib.sha256(render_crop(
            path, 1, bbox, crop_method_id=LEGACY_METHOD)).hexdigest())
        self.assertEqual(new["cropSha256"], hashlib.sha256(render_crop(path, 1, bbox)).hexdigest())
        self.assertNotEqual(old["cropSha256"], new["cropSha256"])
        self.assertEqual(new["reasonCode"], "ENDPOINT_NOT_CONFIGURED")
        self.assertEqual(new["decision"], "ABSTAIN")
        self.assertEqual(source, before)

    def test_new_profile_namespace_does_not_reuse_legacy_cache_even_for_same_crop_bytes(self):
        path, bbox, _ = semantic_crop_fixture(self.directory, 0)
        source = {"sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "proposals": [{"pageNumber": 1, "bboxNormalized": bbox}]}
        with patch.dict(os.environ, {"INSPECTOR_VISUAL_CACHE_ROOT": str(self.directory / "cache")}), \
             patch("inspector_worker.visual_vlm._post_vlm", return_value=("ABSTAIN", "b" * 64)) as model:
            old = observe_proposals(path, source, "http://visual-vlm:8080/v1",
                cache_namespace=adapter.PROFILE_HASH_V7_SAMPLE)
            new = observe_proposals(path, source, "http://visual-vlm:8080/v1",
                crop_method_id=DISPLAY_METHOD, cache_namespace=adapter.PROFILE_HASH_V8_SAMPLE)
            self.assertEqual(model.call_count, 2)
            replay = observe_proposals(path, source, "http://visual-vlm:8080/v1",
                crop_method_id=DISPLAY_METHOD, cache_namespace=adapter.PROFILE_HASH_V8_SAMPLE)
            self.assertEqual(model.call_count, 2)
        self.assertEqual(new, replay)
        self.assertEqual(old, new)  # Namespace, not incidental pixel differences, separates releases.


if __name__ == "__main__":
    unittest.main()
