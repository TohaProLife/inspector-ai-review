from __future__ import annotations

import hashlib
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

from inspector_worker.durable_ocr_cache import cached_durable_ocr_page
from inspector_worker.ocr_pilot import canonical_hash


@requires_posix_storage
class DurableOcrCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.pdf = self.root / "source.pdf"
        self.pdf.write_bytes(b"verified-pdf-source-bytes")
        self.digest = hashlib.sha256(self.pdf.read_bytes()).hexdigest()

    def artifact(self, page: int = 1, provider: str = "ocr-profile-a") -> dict:
        value = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "SRC-1",
            "inputSha256": self.digest, "pageNumber": page,
            "render": {"sha256": "a" * 64, "widthPx": 100, "heightPx": 200,
                       "dpi": 120, "rendererProfileId": "renderer-v1"},
            "provider": {"profileId": provider, "script": "eslav"},
            "lines": [{"text": "Толщина 250 мм", "score": 0.9,
                       "bboxPx": [1, 2, 90, 20]}],
        }
        value["contentHash"] = canonical_hash(value)
        return value

    def request(self, recognize, *, page: int = 1, provider: str = "ocr-profile-a"):
        return cached_durable_ocr_page(
            cache_root=self.root / "cache", source_path=self.pdf,
            source_file_id="SRC-1", source_sha256=self.digest,
            page_number=page, page_count=2, dpi=120, script="eslav",
            renderer_profile_id="renderer-v1", provider_profile_id=provider,
            recognize=recognize,
        )

    def test_exact_hit_skips_inference_and_new_page_or_profile_misses(self) -> None:
        calls = []

        def recognize(page=1, provider="ocr-profile-a"):
            calls.append((page, provider))
            return self.artifact(page, provider)

        first, first_status = self.request(lambda: recognize())
        second, second_status = self.request(lambda: self.fail("cache hit called inference"))
        self.assertEqual((first_status, second_status), ("MISS_WRITTEN", "HIT"))
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.request(lambda: recognize(page=2), page=2)[1], "MISS_WRITTEN")
        self.assertEqual(self.request(lambda: recognize(provider="ocr-profile-b"),
                                      provider="ocr-profile-b")[1], "MISS_WRITTEN")
        self.assertEqual(len(calls), 3)

    def test_corrupt_entry_and_changed_source_fail_closed(self) -> None:
        self.request(lambda: self.artifact())
        entry = next((self.root / "cache").rglob("*.json"))
        entry.write_text('{"schemaVersion":"tampered"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "content hash mismatch"):
            self.request(lambda: self.fail("corrupt cache ran inference"))
        entry.unlink()
        self.pdf.write_bytes(b"changed-pdf-source-bytes")
        with self.assertRaisesRegex(ValueError, "source PDF SHA-256 mismatch"):
            self.request(lambda: self.fail("changed source ran inference"))

    def test_malformed_inference_result_is_not_cached(self) -> None:
        broken = self.artifact()
        broken["lines"][0]["bboxPx"] = [2, 2, 1, 20]
        with self.assertRaisesRegex(ValueError, "geometry"):
            self.request(lambda: broken)
        self.assertEqual(list((self.root / "cache").rglob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
