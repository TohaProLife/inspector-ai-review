from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.mixed_stage_region_proposals import (
    MixedStageRegionError, build_mixed_stage_region_batch, propose_mixed_stage_region,
)
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_region_ocr import RENDERER_PROFILE, SCHEMA_VERSION, _request


class MixedStageRegionTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.row = {"file_id": "F0001", "object_id": "OBJ-1", "stage": "RD_ID_MIXED",
                    "section": "OV", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                    "label_visibility": "PUBLIC_TRAIN", "extension": ".pdf",
                    "relative_path": "Object/sheet.pdf", "size_bytes": 100,
                    "sha256": "a" * 64, "pdf_pages": 1}
        self.manifest = self.root / "manifest.jsonl"
        self.manifest.write_text(json.dumps(self.row) + "\n", encoding="utf-8")
        self.report = self._report()

    def _report(self) -> dict:
        request = _request(self.row, 1, (7000, 9000, 10000, 10000), 180, "eslav", "ocr-test")
        artifact = {"schemaVersion": SCHEMA_VERSION, "request": request,
                    "render": {"sha256": "b" * 64, "widthPx": 1788, "heightPx": 843,
                               "dpi": 180, "rendererProfileId": RENDERER_PROFILE,
                               "pageRectPdfPt": [0.0, 0.0, 2384.0, 3370.0],
                               "clipRectPdfPt": [1668.8, 3033.0, 2384.0, 3370.0]},
                    "lines": [
                        {"text": "АНО/1-РД-ОВ1", "score": .91, "bboxCropPx": [1100, 400, 1500, 460]},
                        {"text": "ИСПОЛНИТЕЛЬНЫЙ", "score": .99, "bboxCropPx": [200, 590, 460, 630]},
                        {"text": "РД", "score": .67, "bboxCropPx": [1420, 640, 1470, 680]},
                    ], "interpretation": "REVIEW_ONLY_NOT_ABSENCE_PROOF"}
        artifact["contentHash"] = canonical_hash(artifact)
        return {"schemaVersion": SCHEMA_VERSION, "sourceFileId": "F0001",
                "sourceSha256": self.row["sha256"], "pageNumber": 1,
                "indexDisposition": "TEXT_LAYER_CANDIDATE",
                "clipNorm10000": [7000, 9000, 10000, 10000],
                "cacheStatus": "MISS_WRITTEN", "cacheKey": canonical_hash(request),
                "artifactContentHash": artifact["contentHash"], "lineCount": 3,
                "interpretation": "REVIEW_ONLY_NOT_ABSENCE_PROOF", "artifact": artifact}

    def test_distinct_rd_and_execution_marks_are_review_only(self) -> None:
        result = propose_mixed_stage_region(self.report, self.row)
        self.assertEqual(result["status"], "REVIEW_ONLY_ABSTAIN")
        self.assertEqual([item["roleHint"] for item in result["roleHints"]],
                         ["RD_TITLE_MARK", "EXECUTION_MARK"])
        self.assertIsNone(result["findingCount"])
        self.assertEqual(result["roleHints"][1]["locators"][0]["lineIndex"], 1)

    def test_overlapping_marks_abstain_without_hints(self) -> None:
        self.report["artifact"]["lines"][1]["bboxCropPx"] = [1400, 590, 1500, 630]
        self.report["artifact"]["contentHash"] = canonical_hash({
            key: value for key, value in self.report["artifact"].items() if key != "contentHash"
        })
        self.report["artifactContentHash"] = self.report["artifact"]["contentHash"]
        result = propose_mixed_stage_region(self.report, self.row)
        self.assertEqual(result["roleHints"], [])
        self.assertEqual(result["reason"], "MIXED_MARKS_NOT_SAFELY_LOCALIZED")

    def test_wrong_scope_and_provenance_fail_closed(self) -> None:
        with self.assertRaisesRegex(MixedStageRegionError, "source/scope"):
            propose_mixed_stage_region(self.report, dict(self.row, split="TEST_HIDDEN"))
        with self.assertRaisesRegex(MixedStageRegionError, "source/scope"):
            propose_mixed_stage_region(self.report, dict(self.row, stage="PD"))
        with self.assertRaisesRegex(MixedStageRegionError, "source/scope"):
            propose_mixed_stage_region(dict(self.report, sourceSha256="f" * 64), self.row)
        with self.assertRaisesRegex(MixedStageRegionError, "provenance"):
            propose_mixed_stage_region(dict(self.report, cacheKey="f" * 64), self.row)

    def test_batch_requires_report_sha_and_public_manifest(self) -> None:
        path = self.root / "ocr.json"
        raw = json.dumps(self.report).encode()
        path.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        manifest_hash = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        result = build_mixed_stage_region_batch(
            self.manifest, {"F0001": (path, digest)},
            _expected_manifest_sha256=manifest_hash)
        self.assertEqual((result["localizedSourceCount"], result["sourceCount"]), (1, 1))
        with self.assertRaisesRegex(MixedStageRegionError, "SHA-256 differs"):
            build_mixed_stage_region_batch(
                self.manifest, {"F0001": (path, "0" * 64)},
                _expected_manifest_sha256=manifest_hash)
        self.row["split"] = "TEST_HIDDEN"
        self.manifest.write_text(json.dumps(self.row) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "allowlist"):
            build_mixed_stage_region_batch(
                self.manifest, {"F0001": (path, digest)},
                _expected_manifest_sha256=hashlib.sha256(self.manifest.read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
