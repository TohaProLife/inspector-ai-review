from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

from inspector_worker.durable_text_cache import cached_durable_text_layer
from inspector_worker.text_layer import (LEGACY_TEXT_QUALITY_POLICY_VERSION,
                                         TEXT_QUALITY_POLICY_VERSION,
                                         process_document_text_layer, qualify_page_text)


def artifact(source_id: str, source_hash: str, *,
             policy_version: str = TEXT_QUALITY_POLICY_VERSION) -> dict[str, object]:
    content = "Общая площадь здания 120 м²"
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source_id,
        "inputSha256": source_hash, "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": 1, "textPageCount": 1,
        "qualityPolicyVersion": policy_version,
        "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
        "pages": [{"pageNumber": 1, "widthMilliPoints": 100_000,
                   "heightMilliPoints": 100_000,
                   "blocks": [{"bboxMilliPoints": [0, 0, 1000, 1000], "text": content}],
                   "quality": qualify_page_text([content], policy_version=policy_version)}],
    }


@requires_posix_storage
class DurableTextCacheTests(unittest.TestCase):
    def test_hit_is_scoped_to_pdf_id_and_extractor_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"pdf bytes")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            calls = 0

            def extract() -> dict[str, object]:
                nonlocal calls
                calls += 1
                return artifact("file-1", source_hash)

            args = {"cache_root": root / "cache", "source_path": source,
                    "source_file_id": "file-1", "source_sha256": source_hash,
                    "extract": extract}
            first, status = cached_durable_text_layer(**args)
            second, status2 = cached_durable_text_layer(**args)
            self.assertEqual((status, status2, calls), ("MISS_WRITTEN", "HIT", 1))
            self.assertEqual(first, second)
            with patch("inspector_worker.durable_text_cache._profile", return_value={
                "extractorSha256": "0" * 64, "pdfminerVersion": "changed",
                "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            }):
                self.assertEqual(cached_durable_text_layer(**args)[1], "MISS_WRITTEN")

    def test_changed_source_or_corrupt_entry_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"pdf bytes")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            args = {"cache_root": root / "cache", "source_path": source,
                    "source_file_id": "file-1", "source_sha256": source_hash,
                    "extract": lambda: artifact("file-1", source_hash)}
            cached_durable_text_layer(**args)
            path = next((root / "cache").rglob("*.json"))
            payload = json.loads(path.read_text())
            payload["artifact"]["pages"][0]["blocks"][0]["text"] = "wrong"
            path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "content hash mismatch"):
                cached_durable_text_layer(**args)
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "source PDF SHA-256 mismatch"):
                cached_durable_text_layer(**args)

    def test_cache_separates_legacy_and_current_release_policies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"pdf bytes")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            for policy in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
                args = {"cache_root": root / "cache", "source_path": source,
                        "source_file_id": "file-1", "source_sha256": source_hash,
                        "policy_version": policy,
                        "extract": lambda policy=policy: artifact(
                            "file-1", source_hash, policy_version=policy)}
                self.assertEqual(cached_durable_text_layer(**args)[1], "MISS_WRITTEN")
                self.assertEqual(cached_durable_text_layer(**args)[1], "HIT")
            self.assertEqual(len(list((root / "cache").rglob("*.json"))), 2)

    def test_invalid_extraction_is_not_cached(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            source.write_bytes(b"pdf bytes")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            invalid = artifact("file-1", source_hash)
            invalid["qualitySummary"] = {"textLayerCandidatePageCount": 0,
                                         "ocrRequiredPageCount": 1}
            with self.assertRaises(ValueError):
                cached_durable_text_layer(cache_root=root / "cache", source_path=source,
                                          source_file_id="file-1", source_sha256=source_hash,
                                          extract=lambda: invalid)
            self.assertEqual(list((root / "cache").rglob("*.json")), [])

    def test_document_text_job_reuses_verified_extraction_across_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source_bytes = b"same immutable PDF bytes"
            source_hash = hashlib.sha256(source_bytes).hexdigest()
            lease = {"release": {"textLayer": {
                "artifactSchemaVersion": "document-text-v2",
                "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            }}, "inputs": {"sourceFiles": [{
                "sourceFileId": "file-1", "sha256": source_hash,
                "byteSize": len(source_bytes), "mediaType": "application/pdf",
                "downloadPath": "/api/internal/v1/jobs/job-1/input/file-1",
            }]}}

            def download(_path: str, destination: Path, _hash: str,
                         _size: int, _attempt: dict[str, object]) -> None:
                destination.write_bytes(source_bytes)

            with (patch.dict("os.environ", {"INSPECTOR_DURABLE_TEXT_CACHE_ROOT": directory}),
                  patch("inspector_worker.text_layer._download_source", side_effect=download) as fetch,
                  patch("inspector_worker.text_layer.extract_pdf_text_artifact",
                        return_value=artifact("file-1", source_hash)) as extract):
                first = process_document_text_layer(lease, {}, "worker")
                second = process_document_text_layer(lease, {}, "worker")
            self.assertEqual(first, second)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(extract.call_count, 1)
            self.assertEqual(extract.call_args.kwargs,
                             {"policy_version": TEXT_QUALITY_POLICY_VERSION})


if __name__ == "__main__":
    unittest.main()
