from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.ocr_family_evidence import (
    OcrFamilyEvidenceError, load_ocr_family_evidence,
)
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_document_index import build_public_index
from inspector_worker.public_ocr_cache import _cache_request


@requires_posix_storage
class OcrFamilyEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.pdf = self.materials / "plan.pdf"
        with fitz.open() as document:
            document.new_page().insert_text((72, 72), "synthetic text layer")
            document.new_page()
            document.save(self.pdf)
        self.row = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "extension": ".pdf",
            "relative_path": "plan.pdf", "size_bytes": self.pdf.stat().st_size,
            "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(), "pdf_pages": 2,
        }
        self.manifest = self.root / "document_manifest.jsonl"
        self.write_manifest()
        self.index = self.root / "index"
        self.assertEqual(build_public_index(
            self.manifest, self.index, materials_root=self.materials)["completeSources"], 1)
        self.cache = self.root / "cache"
        self.request = _cache_request(self.row, 2, 120, "eslav", "renderer-test-v1", "ocr-test-v1")
        self.cache_key = canonical_hash(self.request)
        self.cache_path = self.cache / self.cache_key[:2] / self.cache_key[2:4] / f"{self.cache_key}.json"
        self.cache_path.parent.mkdir(parents=True)
        self.artifact = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "F0001",
            "inputSha256": self.row["sha256"], "pageNumber": 2,
            "render": {"sha256": "a" * 64, "widthPx": 100, "heightPx": 200,
                       "dpi": 120, "rendererProfileId": "renderer-test-v1"},
            "provider": {"profileId": "ocr-test-v1", "script": "eslav"},
            "lines": [
                {"text": "Стена МС-1", "score": 0.95, "bboxPx": [1, 2, 45, 21]},
                {"text": "толщина 220 мм", "score": 0.9, "bboxPx": [2, 30, 80, 51]},
            ],
        }
        self.write_cache()

    def write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.row, ensure_ascii=False) + "\n", encoding="utf-8")

    def write_cache(self) -> None:
        self.artifact["contentHash"] = canonical_hash({
            key: value for key, value in self.artifact.items() if key != "contentHash"})
        payload = {"schemaVersion": "public-ocr-page-cache-v1",
                   "request": self.request, "artifact": self.artifact}
        payload["contentHash"] = canonical_hash(payload)
        self.cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def read(self, **overrides) -> dict:
        options = {
            "expected_object_id": "OBJ-1", "expected_stage": "PD",
            "expected_section": "KR", "line_indices": [1, 0],
            "dpi": 120, "script": "eslav",
            "renderer_profile_id": "renderer-test-v1", "provider_profile_id": "ocr-test-v1",
        }
        options.update(overrides)
        return load_ocr_family_evidence(
            self.manifest, self.index, self.cache, "F0001", 2, **options)

    def test_selected_lines_preserve_distinct_ocr_provenance_without_writing(self) -> None:
        before = self.cache_path.read_bytes()
        first = self.read()
        self.assertEqual(first, self.read())
        self.assertEqual(self.cache_path.read_bytes(), before)
        self.assertEqual(first["schemaVersion"], "ocr-page-family-evidence-v1")
        self.assertEqual(first["candidateStatus"], "CANDIDATE")
        self.assertEqual(first["evidenceKind"], "OCR")
        self.assertEqual(first["indexDisposition"], "OCR_REQUIRED")
        self.assertEqual(first["coordinateSystem"], "IMAGE_TOP_LEFT_PIXELS")
        self.assertEqual(first["sourceSha256"], self.row["sha256"])
        self.assertEqual(first["pageNumber"], 2)
        self.assertEqual(first["render"], self.artifact["render"])
        self.assertEqual(first["provider"], self.artifact["provider"])
        self.assertEqual(first["selectedLineIndices"], [0, 1])
        self.assertEqual(first["cachedLineCount"], 2)
        self.assertEqual(first["lines"][0]["bboxPx"], [1, 2, 45, 21])
        self.assertEqual(first["lines"][1]["lineIndex"], 1)
        self.assertEqual(first["artifactContentHash"], self.artifact["contentHash"])
        self.assertEqual(first["evidenceSha256"], canonical_hash({
            key: value for key, value in first.items() if key != "evidenceSha256"}))
        self.assertNotIn("facts", first)
        self.assertNotIn("findings", first)
        self.assertNotIn("coverage", first)

    def test_hidden_or_wrong_manifest_scope_rejected(self) -> None:
        for field, forbidden in (("split", "TEST_HIDDEN"),
                                 ("distribution_status", "EXCLUDE"),
                                 ("label_visibility", "HIDDEN"), ("extension", ".txt")):
            with self.subTest(field=field):
                original = self.row[field]
                self.row[field] = forbidden
                self.write_manifest()
                with self.assertRaises(OcrFamilyEvidenceError):
                    self.read()
                self.row[field] = original
        self.write_manifest()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "object/stage/section"):
            self.read(expected_stage="RD")

    def test_wrong_source_sha_and_page_refused(self) -> None:
        self.row["sha256"] = "0" * 64
        self.write_manifest()
        with self.assertRaises(OcrFamilyEvidenceError):
            self.read()
        self.row["sha256"] = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.write_manifest()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "not OCR_REQUIRED"):
            load_ocr_family_evidence(
                self.manifest, self.index, self.cache, "F0001", 1,
                expected_object_id="OBJ-1", expected_stage="PD", expected_section="KR",
                line_indices=[0], dpi=120, script="eslav",
                renderer_profile_id="renderer-test-v1", provider_profile_id="ocr-test-v1")
        with self.assertRaises(OcrFamilyEvidenceError):
            load_ocr_family_evidence(
                self.manifest, self.index, self.cache, "F0001", 3,
                expected_object_id="OBJ-1", expected_stage="PD", expected_section="KR",
                line_indices=[0], dpi=120, script="eslav",
                renderer_profile_id="renderer-test-v1", provider_profile_id="ocr-test-v1")

    def test_tampered_text_and_profile_fail_closed(self) -> None:
        payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        payload["artifact"]["lines"][0]["text"] = "forged"
        self.cache_path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "integrity"):
            self.read()
        self.artifact["provider"]["profileId"] = "wrong-profile"
        self.write_cache()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "integrity"):
            self.read()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "missing or unsafe"):
            self.read(provider_profile_id="different-request")

    def test_cached_artifact_wrong_sha_or_page_fails_even_with_recomputed_hashes(self) -> None:
        for key, value in (("inputSha256", "0" * 64), ("pageNumber", 1)):
            with self.subTest(key=key):
                original = self.artifact[key]
                self.artifact[key] = value
                self.write_cache()
                with self.assertRaisesRegex(OcrFamilyEvidenceError, "integrity"):
                    self.read()
                self.artifact[key] = original
        self.write_cache()

    def test_invalid_ocr_geometry_rejected_even_when_hashes_recomputed(self) -> None:
        self.artifact["lines"][0]["bboxPx"] = [1, 2, 101, 21]
        self.write_cache()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "integrity"):
            self.read()

    def test_explicit_bounded_line_selection(self) -> None:
        for indices in ([], [0, 0], [-1], [True], [2], list(range(129))):
            with self.subTest(indices=indices[:4]), self.assertRaises(OcrFamilyEvidenceError):
                self.read(line_indices=indices)
        self.cache_path.unlink()
        with self.assertRaisesRegex(OcrFamilyEvidenceError, "missing or unsafe"):
            self.read()


if __name__ == "__main__":
    unittest.main()
