from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_ocr_cache import PublicOcrCacheError
from inspector_worker.public_region_ocr import (
    SCHEMA_VERSION, _recognize, cached_public_ocr_region,
)


PROFILE = "ocr-test-region-v1"


class PublicRegionOcrTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "source.pdf"
        with fitz.open() as document:
            page = document.new_page(width=400, height=300)
            page.insert_text((250, 270), "RD stamp")
            document.save(self.pdf)
        self.original = self.pdf.read_bytes()
        self.sha = hashlib.sha256(self.original).hexdigest()
        self.row = {
            "file_id": "F0001", "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "extension": ".pdf", "relative_path": "Object/source.pdf",
            "size_bytes": len(self.original), "sha256": self.sha, "pdf_pages": 1,
        }
        self.manifest = self.root / "document_manifest.jsonl"
        self._write_manifest()
        self.cache = self.root / "cache"

    def _write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.row) + "\n", encoding="utf-8")

    def _run(self, **changes) -> dict:
        options = {
            "manifest_path": self.manifest, "source_id": "F0001", "page_number": 1,
            "clip_norm_10000": (5000, 5000, 10000, 10000),
            "provider_profile_id": PROFILE, "base_url": "http://127.0.0.1:18084",
            "pdf_path": self.pdf, "cache_root": self.cache,
        }
        options.update(changes)
        return cached_public_ocr_region(**options)

    @staticmethod
    def _fake_recognize(_png, render, request, _base_url) -> dict:
        artifact = {"schemaVersion": SCHEMA_VERSION, "request": request,
                    "render": render, "lines": [{"text": "РД", "score": 0.98,
                                                  "bboxCropPx": [1, 2, 20, 22]}],
                    "interpretation": "REVIEW_ONLY_NOT_ABSENCE_PROOF"}
        artifact["contentHash"] = canonical_hash(artifact)
        return artifact

    @requires_posix_storage
    def test_exact_region_hit_and_source_sha_rechecked(self) -> None:
        with patch("inspector_worker.public_region_ocr._recognize", side_effect=self._fake_recognize) as provider:
            first = self._run()
            second = self._run()
        self.assertEqual(provider.call_count, 1)
        self.assertEqual((first["cacheStatus"], second["cacheStatus"]), ("MISS_WRITTEN", "HIT"))
        self.assertEqual(first["artifactContentHash"], second["artifactContentHash"])
        self.assertEqual(first["lineCount"], 1)
        self.assertEqual(second["artifact"]["render"]["clipRectPdfPt"], [200.0, 150.0, 400.0, 300.0])
        self.pdf.write_bytes(self.original[:-1] + b"x")
        with self.assertRaisesRegex(PublicOcrCacheError, "SHA-256 differs"):
            self._run()

    @requires_posix_storage
    def test_region_and_dpi_are_separate_cache_keys(self) -> None:
        with patch("inspector_worker.public_region_ocr._recognize", side_effect=self._fake_recognize) as provider:
            first = self._run()
            second = self._run(clip_norm_10000=(5500, 5000, 10000, 10000))
            third = self._run(dpi=200)
        self.assertEqual(provider.call_count, 3)
        self.assertEqual(len({first["cacheKey"], second["cacheKey"], third["cacheKey"]}), 3)

    @requires_posix_storage
    def test_bad_cache_fails_closed(self) -> None:
        with patch("inspector_worker.public_region_ocr._recognize", side_effect=self._fake_recognize):
            first = self._run()
        path = Path(first["cachePath"])
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["artifact"]["lines"][0]["text"] = "forged"
        path.write_text(json.dumps(payload), encoding="utf-8")
        with patch("inspector_worker.public_region_ocr._recognize") as provider:
            with self.assertRaisesRegex(PublicOcrCacheError, "envelope invalid"):
                self._run()
        provider.assert_not_called()

    @requires_posix_storage
    def test_rehashed_cache_with_wrong_pdf_clip_is_rejected(self) -> None:
        with patch("inspector_worker.public_region_ocr._recognize", side_effect=self._fake_recognize):
            first = self._run()
        path = Path(first["cachePath"])
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["artifact"]["render"]["clipRectPdfPt"][0] += 1
        payload["artifact"]["contentHash"] = canonical_hash({
            key: value for key, value in payload["artifact"].items() if key != "contentHash"
        })
        payload["contentHash"] = canonical_hash({
            key: value for key, value in payload.items() if key != "contentHash"
        })
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(PublicOcrCacheError, "geometry differs"):
            self._run()

    def test_allowlist_region_and_local_provider_guard(self) -> None:
        with self.assertRaisesRegex(PublicOcrCacheError, "invalid public OCR region"):
            self._run(clip_norm_10000=(5000, 5000, 5000, 10000))
        with self.assertRaisesRegex(PublicOcrCacheError, "invalid public OCR region"):
            self._run(clip_norm_10000=(0, 0, 10001, 10000))
        with self.assertRaisesRegex(ValueError, "local HTTP"):
            self._run(base_url="https://remote.example.org")
        self.row["split"] = "TEST_HIDDEN"
        self._write_manifest()
        with self.assertRaisesRegex(PublicOcrCacheError, "allowlist"):
            self._run()

    def test_provider_response_profile_and_line_geometry(self) -> None:
        request = {"script": "eslav", "providerProfileId": PROFILE}
        render = {"widthPx": 100, "heightPx": 100}
        response = {"schemaVersion": "document-ai-ocr-response-v1", "script": "eslav",
                    "profileId": PROFILE,
                    "results": [{"overall_ocr_res": {"rec_texts": ["РД"],
                                                      "rec_scores": [0.99],
                                                      "rec_boxes": [[1, 2, 40, 20]]}}]}
        with patch("inspector_worker.public_region_ocr._post_file",
                   return_value=(json.dumps(response).encode(), {})):
            artifact = _recognize(b"png", render, request, "http://127.0.0.1:18084")
        self.assertEqual(artifact["lines"][0]["text"], "РД")
        response["profileId"] = "wrong"
        with patch("inspector_worker.public_region_ocr._post_file",
                   return_value=(json.dumps(response).encode(), {})):
            with self.assertRaisesRegex(PublicOcrCacheError, "profile invalid"):
                _recognize(b"png", render, request, "http://127.0.0.1:18084")
        response["profileId"] = PROFILE
        response["results"][0]["overall_ocr_res"]["rec_boxes"] = [[1, 2, 101, 20]]
        with patch("inspector_worker.public_region_ocr._post_file",
                   return_value=(json.dumps(response).encode(), {})):
            with self.assertRaisesRegex(PublicOcrCacheError, "geometry invalid"):
                _recognize(b"png", render, request, "http://127.0.0.1:18084")


if __name__ == "__main__":
    unittest.main()
