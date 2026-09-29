from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
import zipfile
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_ocr_cache import (
    CACHE_SCHEMA_VERSION, PublicOcrCacheError, _decoded_member_name,
    cached_public_ocr_page, public_manifest_entry,
)


RENDERER = "renderer-pdfium-test-v1"
PROVIDER = "ocr-paddle-test-v1"


def artifact(source_hash: str, *, source_id: str = "F0001", page_number: int = 1,
             dpi: int = 120, renderer: str = RENDERER, provider: str = PROVIDER) -> dict:
    value = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": source_id,
        "inputSha256": source_hash, "pageNumber": page_number,
        "render": {"sha256": "a" * 64, "widthPx": 100, "heightPx": 100,
                   "dpi": dpi, "rendererProfileId": renderer},
        "provider": {"profileId": provider, "script": "eslav"},
        "lines": [{"text": "условный текст", "score": 0.95,
                   "bboxPx": [1, 2, 40, 20]}],
    }
    value["contentHash"] = canonical_hash(value)
    return value


class PublicOcrCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.pdf = self.root / "original.pdf"
        with fitz.open() as document:
            document.new_page().insert_text((72, 72), "synthetic public PDF")
            document.save(self.pdf)
        self.pdf_bytes = self.pdf.read_bytes()
        self.source_hash = hashlib.sha256(self.pdf_bytes).hexdigest()
        self.row = {
            "file_id": "F0001", "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "extension": ".pdf", "relative_path": "Объект/original.pdf",
            "size_bytes": len(self.pdf_bytes), "sha256": self.source_hash, "pdf_pages": 1,
        }
        self.manifest = self.root / "document_manifest.jsonl"
        self.write_manifest()
        self.cache = self.root / "cache"

    def write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.row, ensure_ascii=False) + "\n", encoding="utf-8")

    def run_ocr(self, **overrides) -> dict:
        options = {
            "manifest_path": self.manifest, "source_id": "F0001", "page_number": 1,
            "pdf_path": self.pdf, "cache_root": self.cache,
            "base_url": "http://127.0.0.1:18084", "renderer_profile_id": RENDERER,
            "provider_profile_id": PROVIDER,
        }
        options.update(overrides)
        return cached_public_ocr_page(**options)

    @requires_posix_storage
    def test_exact_hit_verifies_source_and_never_calls_provider(self) -> None:
        expected = artifact(self.source_hash)
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page", return_value=expected) as provider:
            first = self.run_ocr()
            second = self.run_ocr()
        self.assertEqual(provider.call_count, 1)
        self.assertEqual([first["cacheStatus"], second["cacheStatus"]], ["MISS_WRITTEN", "HIT"])
        self.assertEqual(second["artifact"], expected)
        self.assertEqual(second["interpretation"], "OCR_REVIEW_REQUIRED_NOT_ABSENCE_PROOF")
        self.assertEqual(second["schemaVersion"], CACHE_SCHEMA_VERSION)
        self.assertTrue(Path(second["cachePath"]).is_file())
        self.pdf.write_bytes(self.pdf_bytes + b"tampered")
        with self.assertRaisesRegex(PublicOcrCacheError, "size differs"):
            self.run_ocr()
        self.pdf.write_bytes(self.pdf_bytes[:-1] + b"x")
        with self.assertRaisesRegex(PublicOcrCacheError, "SHA-256 differs"):
            self.run_ocr()

    @requires_posix_storage
    def test_dpi_is_part_of_key_and_produces_distinct_cache_entry(self) -> None:
        def recognize(*args, **kwargs):
            return artifact(self.source_hash, dpi=kwargs["dpi"])

        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page", side_effect=recognize) as provider:
            first = self.run_ocr(dpi=120)
            second = self.run_ocr(dpi=150)
            again = self.run_ocr(dpi=120)
        self.assertEqual(provider.call_count, 2)
        self.assertNotEqual(first["cacheKey"], second["cacheKey"])
        self.assertEqual(again["cacheStatus"], "HIT")

    @requires_posix_storage
    def test_corrupt_or_stale_entry_is_rejected_without_provider_retry(self) -> None:
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page",
                   return_value=artifact(self.source_hash)):
            report = self.run_ocr()
        cache_path = Path(report["cachePath"])
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        payload["artifact"]["lines"][0]["text"] = "forged"
        cache_path.write_text(json.dumps(payload), encoding="utf-8")
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page") as provider:
            with self.assertRaisesRegex(PublicOcrCacheError, "contentHash"):
                self.run_ocr()
        provider.assert_not_called()
        payload["contentHash"] = canonical_hash({key: value for key, value in payload.items()
                                                  if key != "contentHash"})
        cache_path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(PublicOcrCacheError, "artifact invalid"):
            self.run_ocr()
        payload["artifact"]["lines"][0]["text"] = "условный текст"
        payload["request"]["rendererProfileId"] = "different-renderer"
        payload["contentHash"] = canonical_hash({key: value for key, value in payload.items()
                                                  if key != "contentHash"})
        cache_path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(PublicOcrCacheError, "request or schema mismatch"):
            self.run_ocr()

    @requires_posix_storage
    def test_provenance_profiles_and_page_are_exact(self) -> None:
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page",
                   return_value=artifact(self.source_hash, provider="wrong-provider")):
            with self.assertRaisesRegex(PublicOcrCacheError, "profile mismatch"):
                self.run_ocr()
        self.assertEqual(list(self.cache.rglob("*.json")), [])
        with self.assertRaisesRegex(PublicOcrCacheError, "invalid selected page"):
            self.run_ocr(page_number=2)
        with self.assertRaisesRegex(ValueError, "local HTTP"):
            self.run_ocr(base_url="https://external.example.com")

    def test_only_public_manifest_rows_are_accepted(self) -> None:
        for field, forbidden in (("split", "TEST_HIDDEN"), ("distribution_status", "EXCLUDE"),
                                 ("label_visibility", "HIDDEN"), ("extension", ".txt")):
            with self.subTest(field=field):
                original = self.row[field]
                self.row[field] = forbidden
                self.write_manifest()
                with self.assertRaisesRegex(PublicOcrCacheError, "allowlist"):
                    public_manifest_entry(self.manifest, "F0001")
                self.row[field] = original
        self.write_manifest()
        self.manifest.write_text(self.manifest.read_text() * 2)
        with self.assertRaisesRegex(PublicOcrCacheError, "exactly once"):
            public_manifest_entry(self.manifest, "F0001")

    @requires_posix_storage
    def test_archive_selects_only_verified_member_and_rejects_ambiguity(self) -> None:
        archive = self.root / "materials.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("packet/Объект/original.pdf", self.pdf_bytes)
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page",
                   return_value=artifact(self.source_hash)) as provider:
            report = self.run_ocr(pdf_path=None, archive_path=archive)
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(report["cacheStatus"], "MISS_WRITTEN")
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("packet/Объект/original.pdf", self.pdf_bytes)
            output.writestr("other/Объект/original.pdf", self.pdf_bytes)
        with self.assertRaisesRegex(PublicOcrCacheError, "ambiguous"):
            self.run_ocr(pdf_path=None, archive_path=archive)

    def test_cp866_filename_is_decoded_when_zip_utf8_flag_absent(self) -> None:
        name = "ХАКАТОН/Объект/original.pdf"
        info = zipfile.ZipInfo("placeholder")
        info.filename = name.encode("cp866").decode("cp437")
        info.flag_bits = 0
        self.assertEqual(_decoded_member_name(info), name)
        info.flag_bits = 0x800
        self.assertEqual(_decoded_member_name(info), info.filename)

    @requires_posix_storage
    @requires_posix_storage
    def test_optional_index_disposition_is_source_bound(self) -> None:
        index = self.root / "index.sqlite3"
        with contextlib.closing(sqlite3.connect(index)) as connection, connection:
            connection.execute("CREATE TABLE pages (source_id TEXT, page_number INTEGER, "
                               "source_sha256 TEXT, disposition TEXT)")
            connection.execute("INSERT INTO pages VALUES (?, ?, ?, ?)",
                               ("F0001", 1, self.source_hash, "OCR_REQUIRED"))
        with patch("inspector_worker.public_ocr_cache.recognize_pdf_page",
                   return_value=artifact(self.source_hash)):
            report = self.run_ocr(index_path=index)
        self.assertEqual(report["indexDisposition"], "OCR_REQUIRED")
        with contextlib.closing(sqlite3.connect(index)) as connection, connection:
            connection.execute("UPDATE pages SET source_sha256 = ?", ("0" * 64,))
        with self.assertRaisesRegex(PublicOcrCacheError, "provenance"):
            self.run_ocr(index_path=index)


if __name__ == "__main__":
    unittest.main()
