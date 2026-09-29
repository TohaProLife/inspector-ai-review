from __future__ import annotations

import hashlib
import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from inspector_worker.durable_ocr_artifact import (
    MAX_OCR_STAGE_BYTES, OcrArtifactLeaseLost, download_ocr_layout_artifact,
)
from inspector_worker.durable_ocr_layout import (PROFILE_HASH_V3, PROFILE_ID_V3, PROFILE_V3,
                                                 PROFILE_HASH_V4, PROFILE_ID_V4, PROFILE_V4,
                                                 PROFILE_HASH_V5, PROFILE_ID_V5, PROFILE_V5)
from inspector_worker.durable_ocr_layout import PROFILE_HASH_V6, PROFILE_ID_V6, PROFILE_V6
from inspector_worker.text_layer import InputDownloadError


MANIFEST_HASH = "a" * 64
LEASE = {"jobId": "job-1", "jobType": "RULE_EVALUATION",
         "inputManifestHash": MANIFEST_HASH, "objectId": "object-1"}
ATTEMPT = {"attemptId": "attempt-1", "fencingToken": 2}
ENV = {"INSPECTOR_API_INTERNAL_URL": "http://api:4100/api/internal/v1",
       "INTERNAL_WORKER_TOKEN": "test-worker-token"}


def stage() -> dict:
    return {
        "schemaVersion": "analysis-stage-result-v2",
        "jobType": "DOCUMENT_OCR_LAYOUT",
        "inputManifestHash": MANIFEST_HASH,
        "disposition": "OCR_LAYOUT_BOUNDED",
        "reasonCode": "BOUNDED_OCR_ONLY",
        "providerKind": "OCR_LAYOUT",
        "providerProfileId": PROFILE_ID_V3,
        "providerConfigHash": PROFILE_HASH_V3,
        "outputCount": 0,
        "analysis": {
            "schemaVersion": "bounded-ocr-layout-analysis-v3",
            "objectId": "object-1", "inputManifestHash": MANIFEST_HASH,
            "profile": PROFILE_V3, "sourceCount": 0,
            "ocrRequiredPageCount": 0, "processedPageCount": 0,
            "deferredPageCount": 0, "skippedOversizePageCount": 0,
            "skippedUnsupportedSourceCount": 0, "skippedRenderPixelPageCount": 0,
            "subjectCandidatePageCount": 0, "sources": [],
        },
    }


def canonical(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes) -> None:
        super().__init__(body)
        self.headers = {
            "Content-Length": str(len(body)),
            "X-Content-SHA256": hashlib.sha256(body).hexdigest(),
            "X-Input-Manifest-SHA256": MANIFEST_HASH,
            "X-Artifact-Schema-Version": "bounded-ocr-layout-analysis-v3",
            "X-Provider-Profile-Id": PROFILE_ID_V3,
            "X-Provider-Config-SHA256": PROFILE_HASH_V3,
        }


class FakeOpener:
    def __init__(self, response: FakeResponse | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.request = None

    def open(self, request, timeout):
        self.request = request
        if self.error:
            raise self.error
        assert timeout == 30
        assert self.response is not None
        return self.response


class DurableOcrArtifactTests(unittest.TestCase):
    def test_download_checks_fenced_url_headers_canonical_body_and_provenance(self) -> None:
        body = canonical(stage())
        opener = FakeOpener(FakeResponse(body))
        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener", return_value=opener) as build:
            envelope = download_ocr_layout_artifact(LEASE, ATTEMPT)
        self.assertEqual(opener.request.full_url, (
            "http://api:4100/api/internal/v1/jobs/job-1/ocr-layout-artifact"
            "?attemptId=attempt-1&fencingToken=2"
        ))
        self.assertEqual(opener.request.get_header("X-worker-token"), "test-worker-token")
        self.assertEqual(type(build.call_args.args[0]).__name__, "ProxyHandler")
        self.assertEqual(build.call_args.args[0].proxies, {})
        self.assertEqual(type(build.call_args.args[1]).__name__, "_NoRedirect")
        self.assertEqual(envelope, {
            "content_json": stage(), "content_hash": hashlib.sha256(body).hexdigest(),
            "byte_size": len(body), "provider_profile_id": PROFILE_ID_V3,
            "provider_config_hash": PROFILE_HASH_V3, "input_manifest_hash": MANIFEST_HASH,
        })

    def test_rejects_wrong_hash_size_and_oversize(self) -> None:
        body = canonical(stage())
        with patch.dict("os.environ", ENV):
            for header, value, reason in (
                ("X-Content-SHA256", "b" * 64, "hash and size"),
                ("Content-Length", str(len(body) + 1), "hash and size"),
                ("Content-Length", str(MAX_OCR_STAGE_BYTES + 1), "Content-Length"),
            ):
                response = FakeResponse(body)
                response.headers[header] = value
                with self.subTest(header=header, value=value), patch(
                    "urllib.request.build_opener", return_value=FakeOpener(response),
                ):
                    with self.assertRaisesRegex(InputDownloadError, reason):
                        download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_rejects_manifest_and_pinned_profile_headers(self) -> None:
        body = canonical(stage())
        with patch.dict("os.environ", ENV):
            for header, value, reason in (
                ("X-Input-Manifest-SHA256", "b" * 64, "manifest hash"),
                ("X-Artifact-Schema-Version", "bounded-ocr-layout-analysis-v2", "not supported"),
                ("X-Provider-Profile-Id", "local-bounded-ocr-layout-v2", "not supported"),
                ("X-Provider-Config-SHA256", "b" * 64, "not supported"),
            ):
                response = FakeResponse(body)
                response.headers[header] = value
                with self.subTest(header=header), patch(
                    "urllib.request.build_opener", return_value=FakeOpener(response),
                ):
                    with self.assertRaisesRegex(InputDownloadError, reason):
                        download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_download_accepts_immutable_v4_and_rejects_mixed_headers(self) -> None:
        value = stage()
        value["providerProfileId"] = PROFILE_ID_V4
        value["providerConfigHash"] = PROFILE_HASH_V4
        value["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v4"
        value["analysis"]["profile"] = PROFILE_V4
        value["analysis"]["titleRecoveryCandidatePageCount"] = 0
        body = canonical(value)
        response = FakeResponse(body)
        response.headers.update({
            "X-Artifact-Schema-Version": "bounded-ocr-layout-analysis-v4",
            "X-Provider-Profile-Id": PROFILE_ID_V4,
            "X-Provider-Config-SHA256": PROFILE_HASH_V4,
        })
        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(response)):
            envelope = download_ocr_layout_artifact(LEASE, ATTEMPT)
        self.assertEqual(envelope["content_json"], value)
        mixed = FakeResponse(body)
        mixed.headers["X-Provider-Profile-Id"] = PROFILE_ID_V4
        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(mixed)):
            with self.assertRaisesRegex(InputDownloadError, "not supported"):
                download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_download_accepts_immutable_v5_and_rejects_v4_profile_body(self) -> None:
        value = stage()
        value["providerProfileId"] = PROFILE_ID_V5
        value["providerConfigHash"] = PROFILE_HASH_V5
        value["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v5"
        value["analysis"]["profile"] = PROFILE_V5
        value["analysis"]["titleRecoveryCandidatePageCount"] = 0

        def response_for(payload: dict) -> FakeResponse:
            response = FakeResponse(canonical(payload))
            response.headers.update({
                "X-Artifact-Schema-Version": "bounded-ocr-layout-analysis-v5",
                "X-Provider-Profile-Id": PROFILE_ID_V5,
                "X-Provider-Config-SHA256": PROFILE_HASH_V5,
            })
            return response

        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(response_for(value))):
            envelope = download_ocr_layout_artifact(LEASE, ATTEMPT)
        self.assertEqual(envelope["provider_profile_id"], PROFILE_ID_V5)
        self.assertEqual(envelope["provider_config_hash"], PROFILE_HASH_V5)
        value["analysis"]["profile"] = PROFILE_V4
        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(response_for(value))):
            with self.assertRaisesRegex(InputDownloadError, "provenance"):
                download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_v6_requires_exact_rule_release_and_stage_headers(self) -> None:
        value = stage()
        value["providerProfileId"] = PROFILE_ID_V6
        value["providerConfigHash"] = PROFILE_HASH_V6
        value["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v6"
        value["analysis"]["profile"] = PROFILE_V6
        release = {"providerSlot": {
            "profileId": "typed-pz002-pz017-ocr-v6-unresolved-family-review-v1"},
            "ocrLayoutSlot": {"profileId": PROFILE_ID_V6, "configHash": PROFILE_HASH_V6}}
        lease = {**LEASE, "release": release}

        def response_for(payload: dict) -> FakeResponse:
            response = FakeResponse(canonical(payload))
            response.headers.update({
                "X-Artifact-Schema-Version": "bounded-ocr-layout-analysis-v6",
                "X-Provider-Profile-Id": PROFILE_ID_V6,
                "X-Provider-Config-SHA256": PROFILE_HASH_V6,
            })
            return response

        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(response_for(value))):
            envelope = download_ocr_layout_artifact(lease, ATTEMPT)
        self.assertEqual(envelope["provider_profile_id"], PROFILE_ID_V6)
        self.assertEqual(envelope["content_hash"], hashlib.sha256(canonical(value)).hexdigest())

        for changed in (
            {**LEASE},
            {**lease, "release": {**release, "providerSlot": {"profileId": "typed-pz002-pz017-v1"}}},
            {**lease, "release": {**release, "ocrLayoutSlot": {"profileId": PROFILE_ID_V5,
                                                                 "configHash": PROFILE_HASH_V5}}},
        ):
            with self.subTest(changed=changed), patch.dict("os.environ", ENV), patch(
                "urllib.request.build_opener", return_value=FakeOpener(response_for(value))
            ):
                with self.assertRaisesRegex(InputDownloadError, "outside immutable release selection"):
                    download_ocr_layout_artifact(changed, ATTEMPT)

        wrong = {**value, "providerConfigHash": PROFILE_HASH_V5}
        with patch.dict("os.environ", ENV), patch("urllib.request.build_opener",
                                                  return_value=FakeOpener(response_for(wrong))):
            with self.assertRaisesRegex(InputDownloadError, "provenance"):
                download_ocr_layout_artifact(lease, ATTEMPT)

    def test_rejects_valid_hash_over_noncanonical_or_wrong_stage(self) -> None:
        changed = stage()
        changed["analysis"]["objectId"] = "another-object"
        with patch.dict("os.environ", ENV):
            for body, reason in (
                (json.dumps(stage(), ensure_ascii=False).encode("utf-8"), "not canonical"),
                (canonical(changed), "provenance"),
            ):
                with self.subTest(reason=reason), patch(
                    "urllib.request.build_opener", return_value=FakeOpener(FakeResponse(body)),
                ):
                    with self.assertRaisesRegex(InputDownloadError, reason):
                        download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_rejects_invalid_lease_attempt_or_external_api(self) -> None:
        with patch.dict("os.environ", ENV):
            with self.assertRaises(ValueError):
                download_ocr_layout_artifact({**LEASE, "jobType": "DOCUMENT_OCR_LAYOUT"}, ATTEMPT)
            with self.assertRaises(ValueError):
                download_ocr_layout_artifact(LEASE, {**ATTEMPT, "fencingToken": True})
        with patch.dict("os.environ", {**ENV,
                "INSPECTOR_API_INTERNAL_URL": "https://public.example/api/internal/v1"}):
            with self.assertRaisesRegex(ValueError, "local worker API"):
                download_ocr_layout_artifact(LEASE, ATTEMPT)

    def test_stale_attempt_and_missing_artifact_fail_closed(self) -> None:
        with patch.dict("os.environ", ENV):
            for code, exception in ((409, OcrArtifactLeaseLost), (404, InputDownloadError)):
                error = urllib.error.HTTPError("http://api", code, "error", {}, None)
                with self.subTest(code=code), patch(
                    "urllib.request.build_opener", return_value=FakeOpener(error=error),
                ):
                    with self.assertRaises(exception):
                        download_ocr_layout_artifact(LEASE, ATTEMPT)


if __name__ == "__main__":
    unittest.main()
