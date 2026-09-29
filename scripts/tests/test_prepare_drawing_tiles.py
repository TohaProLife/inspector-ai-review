"""Synthetic PDF tests for the TRAIN_PUBLIC drawing tile preparation gate."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import fitz
from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-drawing-tiles.py"
SPEC = importlib.util.spec_from_file_location("prepare_drawing_tiles", SCRIPT)
assert SPEC and SPEC.loader
tiles = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tiles)


def fixture(root: Path, *, split: str = "TRAIN_PUBLIC", rotated: bool = False,
            pages: int = 1) -> tuple[Path, Path]:
    pdf = root / "original.pdf"
    with fitz.open() as document:
        page = document.new_page(width=120, height=80)
        if rotated:
            page.set_mediabox(fitz.Rect(-40, -30, 160, 130))
            page.set_cropbox(fitz.Rect(-20, 10, 140, 110))
            page.set_rotation(90)
        page.draw_rect(fitz.Rect(12, 15, 42, 45), color=None, fill=(1, 0, 0))
        for _ in range(1, pages):
            document.new_page(width=120, height=80)
        document.save(pdf)
    raw = pdf.read_bytes()
    manifest = root / "manifest.jsonl"
    entry = {
        "file_id": "F0001", "object_id": "OBJ-TEST", "stage": "PD",
        "split": split, "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
        "extension": ".pdf", "size_bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(), "pdf_pages": pages,
    }
    manifest.write_text(json.dumps(entry) + "\n", encoding="utf-8")
    return manifest, pdf


def read_records(output: Path) -> list[dict]:
    return [json.loads(line) for line in (output / "tiles.jsonl").read_text().splitlines()]


def affine(coefficients: list[float], x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = coefficients
    return a * x + c * y + e, b * x + d * y + f


class PrepareDrawingTilesTests(unittest.TestCase):
    def test_only_explicitly_selected_page_is_rendered(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            manifest, pdf = fixture(root, pages=2)
            output = root / "tiles"
            tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:2"], output,
                          dpi=72, tile_size=160, overlap=20, model_size=100)
            records = read_records(output)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["page_number"], 2)
            self.assertEqual(records[0]["file_id"], "F0001")
            self.assertEqual(records[0]["object_id"], "OBJ-TEST")
            self.assertEqual(records[0]["stage"], "PD")
            self.assertEqual(records[0]["source_sha256"], hashlib.sha256(pdf.read_bytes()).hexdigest())

    def test_padding_rgb_unlabeled_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            manifest, pdf = fixture(root)
            output = root / "tiles"
            count = tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output,
                                  dpi=72, tile_size=160, overlap=20, model_size=100)
            self.assertEqual(count, 1)
            record = read_records(output)[0]
            self.assertEqual(record["label_status"], "UNLABELED")
            self.assertEqual(record["tile"]["valid_rect_px"], [0, 0, 120, 80])
            self.assertEqual(record["tile"]["origin_px"], [0, 0])
            with Image.open(output / record["master_png"]) as image:
                self.assertEqual(image.mode, "RGB")
                self.assertEqual(image.size, (160, 160))
                self.assertEqual(image.getpixel((159, 159)), (255, 255, 255))
                self.assertEqual(image.getpixel((25, 25)), (255, 0, 0))
            with Image.open(output / record["model_png"]) as image:
                self.assertEqual(image.mode, "RGB")
                self.assertEqual(image.size, (100, 100))
                self.assertEqual(image.getpixel((99, 99)), (255, 255, 255))
            self.assertEqual(tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"],
                                           output, dpi=72, tile_size=160, overlap=20,
                                           model_size=100), 1)
            with self.assertRaisesRegex(tiles.PreparationError, "inputs/parameters differ"):
                tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output,
                              dpi=144, tile_size=160, overlap=20, model_size=100)
            (output / record["master_png"]).write_bytes(b"changed")
            with self.assertRaisesRegex(tiles.PreparationError, "missing or changed"):
                tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output,
                              dpi=72, tile_size=160, overlap=20, model_size=100)

    def test_manifest_split_and_source_hash_rejected_before_output(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            manifest, pdf = fixture(root, split="TEST_HIDDEN")
            output = root / "tiles"
            with self.assertRaisesRegex(tiles.PreparationError, "not included TRAIN_PUBLIC"):
                tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output)
            self.assertFalse(output.exists())
            manifest, pdf = fixture(root)
            pdf.write_bytes(pdf.read_bytes() + b"tampered")
            with self.assertRaisesRegex(tiles.PreparationError, "size/SHA-256 mismatch"):
                tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output)
            self.assertFalse(output.exists())

    def test_rotated_offset_boxes_round_trip_and_clipped_render_matches_full_page(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            manifest, pdf = fixture(root, rotated=True)
            output = root / "tiles"
            tiles.prepare(manifest, [f"F0001={pdf}"], ["F0001:1"], output,
                          dpi=144, tile_size=96, overlap=16, model_size=60)
            records = read_records(output)
            self.assertGreater(len(records), 1)
            with fitz.open(pdf) as document:
                page = document[0]
                full = page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csRGB,
                                       alpha=False)
                full_image = Image.frombytes("RGB", (full.width, full.height), full.samples)
                for record in records:
                    self.assertEqual(record["page_geometry"]["rotation_degrees"], 90)
                    self.assertNotEqual(record["page_geometry"]["mediabox_pt"][:2], [0, 0])
                    self.assertNotEqual(record["page_geometry"]["cropbox_pt"][:2], [0, 0])
                    self.assertEqual(record["render"]["raster_width_px"], full.width)
                    self.assertEqual(record["render"]["raster_height_px"], full.height)
                    x0, y0 = record["tile"]["origin_px"]
                    _, _, valid_width, valid_height = record["tile"]["valid_rect_px"]
                    with Image.open(output / record["master_png"]) as tile_image:
                        expected = full_image.crop((x0, y0, x0 + valid_width,
                                                    y0 + valid_height))
                        self.assertEqual(tile_image.crop((0, 0, valid_width, valid_height)).tobytes(),
                                         expected.tobytes())
                    point = (20.5, 31.25)
                    master = affine(record["transforms"]["display_pt_to_master_px"], *point)
                    recovered = affine(record["transforms"]["master_px_to_display_pt"], *master)
                    self.assertAlmostEqual(recovered[0], point[0], places=8)
                    self.assertAlmostEqual(recovered[1], point[1], places=8)
                    model = affine(record["transforms"]["master_px_to_model_px"], *master)
                    recovered_master = affine(record["transforms"]["model_px_to_master_px"], *model)
                    self.assertAlmostEqual(recovered_master[0], master[0], places=8)
                    self.assertAlmostEqual(recovered_master[1], master[1], places=8)
                    self.assertEqual(record["transforms"]["master_px_to_model_px"][0],
                                     record["transforms"]["master_px_to_model_px"][3])


if __name__ == "__main__":
    unittest.main()
