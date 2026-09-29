from __future__ import annotations

import hashlib
import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from inspector_worker.durable_text import TextArtifactLeaseLost, download_text_artifact
from inspector_worker.text_layer import InputDownloadError, qualify_page_text


SOURCE_HASH = "a" * 64
LEASE = {"jobId": "job-1"}
SOURCE = {"sourceFileId": "source-1", "sha256": SOURCE_HASH}
ATTEMPT = {"attemptId": "attempt-1", "fencingToken": 2}


def artifact() -> dict[str, object]:
    return {
        "schemaVersion": "document-text-v2",
        "sourceFileId": "source-1",
        "inputSha256": SOURCE_HASH,
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": 1,
        "textPageCount": 1,
        "qualityPolicyVersion": "text-layer-quality-v1",
        "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
        "pages": [{
            "pageNumber": 1,
            "widthMilliPoints": 100_000,
            "heightMilliPoints": 100_000,
            "blocks": [{"bboxMilliPoints": [0, 0, 1000, 1000], "text": "Общая площадь 100 м²"}],
            "quality": qualify_page_text(["Общая площадь 100 м²"]),
        }],
    }


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, input_hash: str = SOURCE_HASH) -> None:
        super().__init__(body)
        self.headers = {
            "Content-Length": str(len(body)),
            "X-Content-SHA256": hashlib.sha256(body).hexdigest(),
            "X-Input-SHA256": input_hash,
            "X-Artifact-Schema-Version": "document-text-v2",
        }


class DurableTextTests(unittest.TestCase):
    def test_download_checks_fence_url_hashes_and_artifact_schema(self) -> None:
        body = json.dumps(artifact(), ensure_ascii=False).encode("utf-8")
        with patch.dict("os.environ", {
            "INSPECTOR_API_INTERNAL_URL": "http://api:4100/api/internal/v1",
            "INTERNAL_WORKER_TOKEN": "test-worker-token",
        }), patch("urllib.request.urlopen", return_value=FakeResponse(body)) as open_url:
            self.assertEqual(download_text_artifact(LEASE, SOURCE, ATTEMPT), artifact())
        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, (
            "http://api:4100/api/internal/v1/jobs/job-1/text-artifacts/source-1"
            "?attemptId=attempt-1&fencingToken=2"
        ))
        self.assertEqual(request.get_header("X-worker-token"), "test-worker-token")

    def test_rejects_hash_and_manifest_mismatch(self) -> None:
        body = json.dumps(artifact(), ensure_ascii=False).encode("utf-8")
        with patch.dict("os.environ", {
            "INSPECTOR_API_INTERNAL_URL": "http://api:4100/api/internal/v1",
            "INTERNAL_WORKER_TOKEN": "test-worker-token",
        }):
            tampered = FakeResponse(body)
            tampered.headers["X-Content-SHA256"] = "b" * 64
            with patch("urllib.request.urlopen", return_value=tampered):
                with self.assertRaisesRegex(InputDownloadError, "hash and size"):
                    download_text_artifact(LEASE, SOURCE, ATTEMPT)
            with patch("urllib.request.urlopen", return_value=FakeResponse(body, "b" * 64)):
                with self.assertRaisesRegex(InputDownloadError, "differs from manifest"):
                    download_text_artifact(LEASE, SOURCE, ATTEMPT)

    def test_stale_lease_is_not_treated_as_storage_retry(self) -> None:
        with patch.dict("os.environ", {
            "INSPECTOR_API_INTERNAL_URL": "http://api:4100/api/internal/v1",
            "INTERNAL_WORKER_TOKEN": "test-worker-token",
        }), patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError(
            "http://api", 409, "Conflict", {}, None,
        )):
            with self.assertRaises(TextArtifactLeaseLost):
                download_text_artifact(LEASE, SOURCE, ATTEMPT)


if __name__ == "__main__":
    unittest.main()
