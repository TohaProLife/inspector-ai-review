from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.ocr_label_probe import OcrLabelProbeError, probe_cached_ocr_labels
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_document_index import build_public_index
from inspector_worker.public_ocr_cache import _cache_request


@requires_posix_storage
class OcrLabelProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.pdf = self.materials / "source.pdf"
        with fitz.open() as document:
            document.new_page()
            document.save(self.pdf)
        self.row = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "PZ",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "extension": ".pdf",
            "relative_path": "source.pdf", "size_bytes": self.pdf.stat().st_size,
            "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(), "pdf_pages": 1,
        }
        self.manifest = self.root / "document_manifest.jsonl"
        self.write_manifest()
        self.index = self.root / "index"
        self.assertEqual(build_public_index(
            self.manifest, self.index, materials_root=self.materials)["completeSources"], 1)
        self.cache = self.root / "cache"
        request = _cache_request(self.row, 1, 120, "eslav", "renderer-test-v1", "ocr-test-v1")
        key = canonical_hash(request)
        self.cache_path = self.cache / key[:2] / key[2:4] / f"{key}.json"
        self.cache_path.parent.mkdir(parents=True)
        self.artifact = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "F0001",
            "inputSha256": self.row["sha256"], "pageNumber": 1,
            "render": {"sha256": "a" * 64, "widthPx": 500, "heightPx": 700,
                       "dpi": 120, "rendererProfileId": "renderer-test-v1"},
            "provider": {"profileId": "ocr-test-v1", "script": "eslav"},
            "lines": [
                {"text": "Общая площадь", "score": 0.95, "bboxPx": [10, 10, 200, 28]},
                {"text": "здания", "score": 0.94, "bboxPx": [10, 30, 120, 48]},
                {"text": "Категория надежности электроснабжения II",
                 "score": 0.91, "bboxPx": [10, 50, 400, 68]},
                {"text": "санузел МГН №1 стационарный поручень",
                 "score": 0.9, "bboxPx": [10, 70, 400, 88]},
            ],
        }
        self.write_cache(request)

    def write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.row, ensure_ascii=False) + "\n",
                                 encoding="utf-8")

    def write_cache(self, request: dict) -> None:
        self.artifact["contentHash"] = canonical_hash({
            key: value for key, value in self.artifact.items() if key != "contentHash"})
        payload = {"schemaVersion": "public-ocr-page-cache-v1",
                   "request": request, "artifact": self.artifact}
        payload["contentHash"] = canonical_hash(payload)
        self.cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def probe(self, **overrides) -> dict:
        options = {
            "expected_object_id": "OBJ-1", "expected_stage": "PD",
            "expected_section": "PZ", "line_indices": [0, 1, 2, 3],
            "dpi": 120, "script": "eslav", "renderer_profile_id": "renderer-test-v1",
            "provider_profile_id": "ocr-test-v1",
        }
        options.update(overrides)
        return probe_cached_ocr_labels(self.manifest, self.index, self.cache,
                                       "F0001", 1, **options)

    def test_three_families_retained_with_uncertain_fragment_and_image_coordinates(self) -> None:
        before = self.cache_path.read_bytes()
        report = self.probe()
        self.assertEqual(report, self.probe())
        self.assertEqual(before, self.cache_path.read_bytes())
        self.assertEqual(report["status"], "ABSTAIN")
        self.assertEqual(report["pinnedCodeCount"], 47)
        self.assertEqual(report["coordinateSystem"], "IMAGE_TOP_LEFT_PIXELS")
        self.assertEqual(report["sourceSha256"], self.row["sha256"])
        self.assertEqual(report["artifactContentHash"], self.artifact["contentHash"])
        self.assertEqual(report["reportSha256"], canonical_hash({
            key: value for key, value in report.items() if key != "reportSha256"}))
        pz = [row for row in report["leads"] if row["parameterCode"] == "PZ-002"
              and row["literalLabel"] == "Общая площадь здания"]
        self.assertEqual(len(pz), 1)
        self.assertEqual(pz[0]["matchKind"], "ADJACENT_OCR_FRAGMENT_UNCERTAIN")
        self.assertEqual([row["lineIndex"] for row in pz[0]["locators"]], [0, 1])
        self.assertEqual(pz[0]["locators"][0]["bboxPx"], [10, 10, 200, 28])
        self.assertTrue(any(row["parameterCode"] == "PZ-015"
                            and row["matchKind"] == "LITERAL_LABEL_IN_SINGLE_OCR_LINE"
                            for row in report["leads"]))
        self.assertTrue(any(row["parameterCode"] == "ODI-120"
                            and row["labelRole"] == "FEATURE"
                            and row["sourceGate"] == "DRAWING_SECTION_RESOLUTION_REQUIRED"
                            for row in report["leads"]))
        self.assertNotIn("facts", report)
        self.assertNotIn("findings", report)
        self.assertNotIn("coverage", report)

    def test_non_adjacent_selected_lines_do_not_form_fragment(self) -> None:
        report = self.probe(line_indices=[0, 2, 3])
        self.assertFalse(any(row["parameterCode"] == "PZ-002"
                             for row in report["leads"]))
        self.assertEqual(report["status"], "ABSTAIN")

    def test_manifest_and_cache_tampering_fail_closed(self) -> None:
        self.row["split"] = "TEST_HIDDEN"
        self.write_manifest()
        with self.assertRaises(OcrLabelProbeError):
            self.probe()
        self.row["split"] = "TRAIN_PUBLIC"
        self.write_manifest()
        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        payload["artifact"]["lines"][2]["text"] = "forged"
        self.cache_path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaises(OcrLabelProbeError):
            self.probe()

    def test_wrong_scope_and_missing_cache_fail_closed(self) -> None:
        with self.assertRaises(OcrLabelProbeError):
            self.probe(expected_stage="RD")
        with self.assertRaises(OcrLabelProbeError):
            self.probe(line_indices=[])
        self.cache_path.unlink()
        with self.assertRaises(OcrLabelProbeError):
            self.probe()


if __name__ == "__main__":
    unittest.main()
