"""Geometry selection tests for proposal-to-tile mapping."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "map-drawing-symbol-proposals.py"
SPEC = importlib.util.spec_from_file_location("map_drawing_symbol_proposals", SCRIPT)
assert SPEC and SPEC.loader
mapper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mapper)


SCALE = 200 / 72


def pt(pixel: float) -> float:
    return pixel / SCALE


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def sample_tile(tile_id: str, x: int, valid_width: int = 1024) -> dict:
    return {
        "tile_id": tile_id, "file_id": "F0001", "object_id": "OBJ-TEST",
        "stage": "PD", "page_number": 1, "source_sha256": "a" * 64,
        "label_status": "UNLABELED", "model_size_px": 640,
        "page_geometry": {"rect_pt": [0, 0, 720, pt(1024)]},
        "render": {"dpi": 200},
        "tile": {"origin_px": [x, 0], "size_px": 1024,
                 "valid_rect_px": [0, 0, valid_width, 1024]},
        "transforms": {
            "display_pt_to_master_px": [SCALE, 0, 0, SCALE, -x, 0],
            "master_px_to_model_px": [0.625, 0, 0, 0.625, 0, 0],
        },
        "master_png": f"master/{tile_id}.png", "master_sha256": "b" * 64,
        "model_png": f"model640/{tile_id}.png", "model_sha256": "c" * 64,
    }


def sample_label(annotation_id: str, box_pixels: list[float],
                 kind: str = "POSITIVE_CANDIDATE") -> dict:
    return {
        "annotation_id": annotation_id, "file_id": "F0001", "object_id": "OBJ-TEST",
        "document_stage": "PD", "page_number": 1, "source_sha256": "a" * 64,
        "kind": kind, "class_id": "RADIATOR" if kind == "POSITIVE_CANDIDATE" else None,
        "status": "AI_PROPOSED", "bbox_display_pt": [pt(value) for value in box_pixels],
        "page_display_size_pt": [720, pt(1024)],
    }


class MapDrawingSymbolProposalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manifest = self.root / "manifest.jsonl"
        self.tiles = self.root / "tiles.jsonl"
        self.labels = self.root / "labels.jsonl"
        write_jsonl(self.manifest, [{
            "file_id": "F0001", "object_id": "OBJ-TEST", "stage": "PD",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "sha256": "a" * 64, "pdf_pages": 1,
        }])
        write_jsonl(self.tiles, [sample_tile("tile-a", 0), sample_tile("tile-b", 896),
                                 sample_tile("tile-c", 1792, 208)])

    def test_offset_edge_crossing_and_tie_break(self) -> None:
        write_jsonl(self.labels, [
            sample_label("offset", [1050, 200, 1100, 300]),
            sample_label("edge", [1900, 200, 2000, 300]),
            sample_label("crossing", [800, 200, 1150, 300]),
            sample_label("tie", [950, 200, 970, 300], "HARD_NEGATIVE_CANDIDATE"),
        ])
        mapped = {row["annotation_id"]: row for row in
                  mapper.map_proposals(self.manifest, self.tiles, [self.labels])}
        self.assertEqual(mapped["offset"]["tile_id"], "tile-b")
        self.assertAlmostEqual(mapped["offset"]["bbox_master_px"][0], 154)
        self.assertAlmostEqual(mapped["offset"]["bbox_model_px"][0], 96.25)
        self.assertEqual(mapped["edge"]["tile_id"], "tile-c")
        self.assertAlmostEqual(mapped["edge"]["min_valid_margin_master_px"], 0)
        self.assertIsNone(mapped["crossing"]["tile_id"])
        self.assertTrue(mapped["crossing"]["needs_object_centered_tile"])
        self.assertIsNone(mapped["crossing"]["bbox_model_px"])
        self.assertEqual(mapped["tie"]["tile_id"], "tile-a")
        self.assertEqual(mapped["tie"]["kind"], "HARD_NEGATIVE_CANDIDATE")
        for row in mapped.values():
            self.assertEqual(row["status"], "AI_PROPOSED")
            self.assertFalse(row["training_label_created"])

    def test_rejects_hidden_or_mismatched_source(self) -> None:
        write_jsonl(self.labels, [sample_label("one", [100, 100, 200, 200])])
        manifest_row = next(mapper.read_jsonl(self.manifest))
        manifest_row["split"] = "TEST_HIDDEN"
        write_jsonl(self.manifest, [manifest_row])
        with self.assertRaisesRegex(mapper.MappingError, "TRAIN_PUBLIC"):
            mapper.map_proposals(self.manifest, self.tiles, [self.labels])
        manifest_row["split"] = "TRAIN_PUBLIC"
        write_jsonl(self.manifest, [manifest_row])
        label = next(mapper.read_jsonl(self.labels))
        label["source_sha256"] = "b" * 64
        write_jsonl(self.labels, [label])
        with self.assertRaisesRegex(mapper.MappingError, "source SHA"):
            mapper.map_proposals(self.manifest, self.tiles, [self.labels])

    def test_existing_output_must_match_exactly(self) -> None:
        write_jsonl(self.labels, [sample_label("one", [100, 100, 200, 200])])
        mapped = mapper.map_proposals(self.manifest, self.tiles, [self.labels])
        output = self.root / "candidate_tile_map.jsonl"
        mapper.write_jsonl(output, mapped, [self.manifest, self.tiles, self.labels])
        mapper.write_jsonl(output, mapped, [self.manifest, self.tiles, self.labels])
        output.write_text("changed\n", encoding="utf-8")
        with self.assertRaisesRegex(mapper.MappingError, "output differs"):
            mapper.write_jsonl(output, mapped, [self.manifest, self.tiles, self.labels])


if __name__ == "__main__":
    unittest.main()
