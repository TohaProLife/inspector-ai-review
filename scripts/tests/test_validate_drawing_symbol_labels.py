"""Focused tests for TRAIN_PUBLIC proposed symbol-label validation."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "validate-drawing-symbol-labels.py"
SPEC = importlib.util.spec_from_file_location("drawing_label_validator", SCRIPT)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


class LabelValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest_path = self.root / "manifest.jsonl"
        self.labels_path = self.root / "labels.jsonl"
        self.evidence_path = self.root / "evidence.png"
        self.evidence_path.write_bytes(b"PNG evidence placeholder")
        self.manifest = {
            "file_id": "F0001", "object_id": "OBJ-ONE", "sha256": "a" * 64,
            "stage": "PD", "pdf_pages": 2, "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE",
        }
        write_jsonl(self.manifest_path, [self.manifest])
        self.label = {
            "annotation_id": "L001", "kind": "POSITIVE_CANDIDATE", "file_id": "F0001",
            "page_number": 1, "source_sha256": "a" * 64, "object_id": "OBJ-ONE",
            "document_stage": "PD", "sheet_stage_if_verified": "PD",
            "class_id": "HEATING_LOOP", "bbox_display_pt": [10, 20, 30, 40],
            "page_display_size_pt": [100, 100], "room_id": "314",
            "room_relation": "INSIDE", "status": "AI_PROPOSED", "render_dpi": 200,
            "evidence_image_path": "evidence.png", "notes": "Visible loop candidate",
        }

    def validate(self, rows: list[dict], tiles: Path | None = None) -> dict:
        write_jsonl(self.labels_path, rows)
        return validator.validate(self.manifest_path, [self.labels_path], tiles)

    def codes(self, report: dict) -> set[str]:
        return {error["code"] for error in report["errors"]}

    def test_positive_proposal_is_valid_but_never_exported_for_training(self) -> None:
        report = self.validate([self.label])
        self.assertTrue(report["ok"])
        self.assertEqual(report["counts"]["class"], {"HEATING_LOOP": 1})
        self.assertEqual(report["counts"]["object"], {"OBJ-ONE": 1})
        self.assertFalse(report["training_data_written"])
        self.assertIn("never training labels", report["review_gate"])

    def test_bad_geometry_missing_evidence_and_malformed_json_fail(self) -> None:
        label = {**self.label, "bbox_display_pt": [10, 20, float("inf"), 40],
                 "evidence_image_path": "missing.png"}
        write_jsonl(self.labels_path, [label])
        with self.labels_path.open("a", encoding="utf-8") as stream:
            stream.write("{broken\n")
        report = validator.validate(self.manifest_path, [self.labels_path])
        self.assertFalse(report["ok"])
        self.assertTrue({"GEOMETRY_TYPE", "EVIDENCE_NOT_FOUND", "INVALID_JSON"} <= self.codes(report))

    def test_malformed_field_types_report_errors_without_crash(self) -> None:
        invalid = {**self.label, "file_id": [], "kind": [], "status": {},
                   "room_relation": [], "document_stage": []}
        report = self.validate([invalid])
        self.assertFalse(report["ok"])
        self.assertTrue({"UNKNOWN_FILE", "INVALID_KIND", "INVALID_STATUS",
                         "INVALID_ROOM_RELATION"} <= self.codes(report))

    def test_cli_reports_json_and_nonzero_exit_on_error(self) -> None:
        write_jsonl(self.labels_path, [{**self.label, "source_sha256": "b" * 64}])
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--manifest", str(self.manifest_path),
             "--labels-jsonl", str(self.labels_path)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("MANIFEST_MISMATCH", self.codes(json.loads(result.stdout)))

    def test_boundary_crossing_and_degenerate_box_fail(self) -> None:
        for box in ([0, 0, 101, 1], [10, 10, 10, 30], [-1, 0, 10, 10]):
            with self.subTest(box=box):
                report = self.validate([{**self.label, "bbox_display_pt": box}])
                self.assertIn("BOX_OUTSIDE_PAGE", self.codes(report))

    def test_hidden_source_and_hash_mismatch_fail(self) -> None:
        hidden = {**self.manifest, "file_id": "F0002", "sha256": "b" * 64,
                  "split": "TEST_HIDDEN", "object_id": "OBJ-HIDDEN"}
        write_jsonl(self.manifest_path, [self.manifest, hidden])
        hidden_label = {**self.label, "annotation_id": "L002", "file_id": "F0002",
                        "source_sha256": "b" * 64, "object_id": "OBJ-HIDDEN"}
        report = self.validate([self.label, hidden_label])
        self.assertIn("FORBIDDEN_SOURCE", self.codes(report))
        report = self.validate([{**self.label, "source_sha256": "b" * 64}])
        self.assertIn("MANIFEST_MISMATCH", self.codes(report))

    def test_duplicate_id_across_proposal_files_fails(self) -> None:
        write_jsonl(self.labels_path, [self.label])
        second = self.root / "more.jsonl"
        write_jsonl(second, [{**self.label, "class_id": "RADIATOR"}])
        report = validator.validate(self.manifest_path, [self.labels_path, second])
        self.assertIn("DUPLICATE_ID", self.codes(report))

    def test_identical_content_with_different_ids_fails(self) -> None:
        report = self.validate([self.label, {**self.label, "annotation_id": "L002"}])
        self.assertIn("DUPLICATE_LABEL", self.codes(report))

    def test_negative_region_has_no_class_and_does_not_clear_tile(self) -> None:
        negative = {**self.label, "kind": "HARD_NEGATIVE_CANDIDATE",
                    "class_id": None, "room_id": None, "room_relation": "UNKNOWN",
                    "status": "AI_CROSSCHECKED"}
        report = self.validate([negative])
        self.assertTrue(report["ok"])
        self.assertEqual(report["counts"]["kind"], {"HARD_NEGATIVE_CANDIDATE": 1})
        self.assertIn("never makes an entire tile negative", report["review_gate"])
        report = self.validate([{**negative, "class_id": "RADIATOR"}])
        self.assertIn("NEGATIVE_CLASS", self.codes(report))

    def test_manifest_object_stage_page_and_room_mismatch_fail(self) -> None:
        invalid = {**self.label, "object_id": "OBJ-OTHER", "document_stage": "RD",
                   "sheet_stage_if_verified": "RD", "page_number": 3,
                   "room_id": "314", "room_relation": "UNKNOWN"}
        report = self.validate([invalid])
        self.assertTrue({"MANIFEST_MISMATCH", "PAGE_RANGE", "UNVERIFIED_ROOM"} <= self.codes(report))

    def test_tile_hash_and_coverage(self) -> None:
        master = self.root / "master.png"
        model = self.root / "model.png"
        master.write_bytes(b"master")
        model.write_bytes(b"model")
        tile = {
            "tile_id": "F0001-p00001-x000000-y000000", "file_id": "F0001",
            "object_id": "OBJ-ONE", "stage": "PD", "page_number": 1,
            "source_sha256": "a" * 64, "label_status": "UNLABELED",
            "page_geometry": {"rect_pt": [0, 0, 100, 100]},
            "render": {"dpi": 200},
            "tile": {"origin_px": [0, 0], "valid_rect_px": [0, 0, 200, 200], "size_px": 1024},
            "transforms": {"display_pt_to_master_px": [2, 0, 0, 2, 0, 0],
                           "master_px_to_display_pt": [0.5, 0, 0, 0.5, 0, 0]},
            "master_png": "master.png", "model_png": "model.png",
            "master_sha256": hashlib.sha256(master.read_bytes()).hexdigest(),
            "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        }
        tiles_path = self.root / "tiles.jsonl"
        write_jsonl(tiles_path, [tile])
        self.assertTrue(self.validate([self.label], tiles_path)["ok"])
        write_jsonl(tiles_path, [{**tile, "master_sha256": "0" * 64}])
        self.assertIn("TILE_ARTIFACT_HASH", self.codes(self.validate([self.label], tiles_path)))
        write_jsonl(tiles_path, [{**tile, "tile": {"origin_px": [0, 0],
                                                  "valid_rect_px": [0, 0, 50, 50], "size_px": 1024}}])
        self.assertIn("BOX_NOT_TILED", self.codes(self.validate([self.label], tiles_path)))

    def test_box_spanning_two_valid_tiles_is_covered(self) -> None:
        master = self.root / "master.png"
        model = self.root / "model.png"
        master.write_bytes(b"master")
        model.write_bytes(b"model")
        base = {
            "file_id": "F0001", "object_id": "OBJ-ONE", "stage": "PD",
            "page_number": 1, "source_sha256": "a" * 64,
            "label_status": "UNLABELED", "page_geometry": {"rect_pt": [0, 0, 100, 100]},
            "render": {"dpi": 200},
            "transforms": {"display_pt_to_master_px": [2, 0, 0, 2, 0, 0],
                           "master_px_to_display_pt": [0.5, 0, 0, 0.5, 0, 0]},
            "master_png": "master.png", "model_png": "model.png",
            "master_sha256": hashlib.sha256(master.read_bytes()).hexdigest(),
            "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        }
        left = {**base, "tile_id": "left",
                "tile": {"origin_px": [0, 0], "valid_rect_px": [0, 0, 40, 100], "size_px": 1024}}
        right = {**base, "tile_id": "right",
                 "tile": {"origin_px": [40, 0], "valid_rect_px": [0, 0, 40, 100], "size_px": 1024},
                 "transforms": {"display_pt_to_master_px": [2, 0, 0, 2, -40, 0],
                                "master_px_to_display_pt": [0.5, 0, 0, 0.5, 20, 0]}}
        tiles_path = self.root / "tiles.jsonl"
        write_jsonl(tiles_path, [left, right])
        self.assertTrue(self.validate([self.label], tiles_path)["ok"])
        second_only = {**self.label, "bbox_display_pt": [25, 20, 30, 40]}
        self.assertTrue(self.validate([second_only], tiles_path)["ok"])
        write_jsonl(tiles_path, [left])
        self.assertIn("BOX_NOT_TILED", self.codes(self.validate([self.label], tiles_path)))
        self.assertIn("BOX_NOT_TILED", self.codes(self.validate([second_only], tiles_path)))


if __name__ == "__main__":
    unittest.main()
