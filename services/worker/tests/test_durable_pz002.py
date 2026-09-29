from __future__ import annotations

import json
import hashlib
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

from inspector_worker.durable_pz002 import execute_durable_pz002
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.text_layer import qualify_page_text


RULES = Path(__file__).resolve().parents[1] / "rules"
NAVIGATION = json.loads((RULES / "pilot-pz-002-navigation-v1.json").read_text(encoding="utf-8"))
NUMERIC = json.loads((RULES / "pilot-pz-002-numeric-v1.json").read_text(encoding="utf-8"))
ATTEMPT = {"attemptId": "attempt-1", "fencingToken": 1}


def source(source_id: str, stage: str, digest: str) -> dict[str, object]:
    return {
        "sourceFileId": source_id,
        "sha256": digest,
        "stages": [stage],
        "sectionCode": "PZ",
        "byteSize": 100,
        "mediaType": "application/pdf",
        "downloadPath": f"/api/internal/v1/jobs/job-1/inputs/{source_id}",
    }


def text_artifact(source_id: str, digest: str, area: str) -> dict[str, object]:
    content = f"Общая площадь здания {area} м²"
    return {
        "schemaVersion": "document-text-v2",
        "sourceFileId": source_id,
        "inputSha256": digest,
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": 1,
        "textPageCount": 1,
        "qualityPolicyVersion": "text-layer-quality-v1",
        "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
        "pages": [{
            "pageNumber": 1,
            "widthMilliPoints": 100_000,
            "heightMilliPoints": 100_000,
            "blocks": [{"bboxMilliPoints": [0, 0, 1000, 1000], "text": content}],
            "quality": qualify_page_text([content]),
        }],
    }


class DurablePz002Tests(unittest.TestCase):
    def test_approved_linked_text_sources_produce_candidate(self) -> None:
        files = [source("PD-1", "PD", "a" * 64), source("RD-1", "RD", "b" * 64)]
        lease = {
            "jobId": "job-1", "objectId": "OBJECT-1", "inputManifestHash": "f" * 64,
            "inputs": {
                "sourceFiles": files,
                "sourceDecisions": {
                    item["sourceFileId"]: {
                        "sourceSha256": item["sha256"], "revisionStatus": "CURRENT",
                        "approvalStatus": "APPROVED", "linkGroupId": "building-1",
                        "pageStages": {}, "basis": {"reference": "Проверенная согласованная версия"},
                    }
                    for item in files
                },
            },
        }
        artifacts = {
            "PD-1": text_artifact("PD-1", "a" * 64, "100"),
            "RD-1": text_artifact("RD-1", "b" * 64, "102"),
        }
        with patch("inspector_worker.durable_pz002.download_text_artifact",
                   side_effect=lambda _lease, item, _attempt: artifacts[item["sourceFileId"]]):
            output = execute_durable_pz002(lease, ATTEMPT, NAVIGATION, NUMERIC)
        self.assertEqual(output["evaluation"]["machineStatus"], "CANDIDATE")
        self.assertEqual(output["evaluation"]["normalizedExpected"], "100")
        self.assertEqual(output["evaluation"]["normalizedActual"], "102")
        self.assertEqual(len(output["evaluation"]["evidence"]), 2)

    def test_unknown_source_decisions_abstain_without_public_labels(self) -> None:
        lease = {
            "jobId": "job-1", "objectId": "OBJECT-1", "inputManifestHash": "f" * 64,
            "inputs": {"sourceFiles": [source("PD-1", "PD", "a" * 64), source("RD-1", "RD", "b" * 64)]},
        }
        artifacts = {
            "PD-1": text_artifact("PD-1", "a" * 64, "100"),
            "RD-1": text_artifact("RD-1", "b" * 64, "102"),
        }
        with patch("inspector_worker.durable_pz002.download_text_artifact",
                   side_effect=lambda _lease, item, _attempt: artifacts[item["sourceFileId"]]):
            output = execute_durable_pz002(lease, ATTEMPT, NAVIGATION, NUMERIC)
        self.assertEqual(output["schemaVersion"], "pz-002-analysis-v1")
        self.assertEqual(output["selectedManifestHash"], "f" * 64)
        self.assertNotIn("datasetSplit", output)
        self.assertNotEqual(output["evaluation"]["machineStatus"], "CANDIDATE")
        self.assertEqual(output["ocrRequiredPageCount"], 0)

    def test_decisions_must_match_source_hash_and_have_review_basis(self) -> None:
        lease = {
            "jobId": "job-1", "objectId": "OBJECT-1", "inputManifestHash": "f" * 64,
            "inputs": {
                "sourceFiles": [source("PD-1", "PD", "a" * 64)],
                "sourceDecisions": {
                    "PD-1": {"sourceSha256": "b" * 64, "revisionStatus": "CURRENT"},
                },
            },
        }
        with self.assertRaisesRegex(ValueError, "does not match immutable manifest"):
            execute_durable_pz002(lease, ATTEMPT, NAVIGATION, NUMERIC)
        lease["inputs"]["sourceDecisions"]["PD-1"]["sourceSha256"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "requires a reference"):
            execute_durable_pz002(lease, ATTEMPT, NAVIGATION, NUMERIC)

    @requires_posix_storage
    def test_durable_pz002_reuses_same_ocr_page_for_both_reads(self) -> None:
        source_bytes = b"verified PDF bytes"
        digest = hashlib.sha256(source_bytes).hexdigest()
        item = source("PD-1", "PD", digest)
        item["byteSize"] = len(source_bytes)
        lease = {"jobId": "job-1", "objectId": "OBJECT-1",
                 "inputManifestHash": "f" * 64,
                 "inputs": {"sourceFiles": [item]}}
        ocr = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "PD-1",
            "inputSha256": digest, "pageNumber": 1,
            "render": {"sha256": "a" * 64, "widthPx": 100, "heightPx": 200,
                       "dpi": 120,
                       "rendererProfileId": "renderer-pdfium-5.12.1-linux-x86_64-v1"},
            "provider": {"profileId": "ocr-paddle-3.7.0-ru-en-mobile-v1",
                         "script": "eslav"},
            "lines": [{"text": "Общая площадь здания 120 м²", "score": 0.9,
                       "bboxPx": [1, 2, 90, 20]}],
        }
        ocr["contentHash"] = canonical_hash(ocr)

        def download(_path: str, destination: Path, _hash: str,
                     _size: int, _attempt: dict[str, object]) -> None:
            destination.write_bytes(source_bytes)

        def analyze(_bundle, _navigation, _numeric, **kwargs):
            read = kwargs["recognize_page"]
            first = read("PD-1", 1, 1, "http://document-ai:8080")
            second = read("PD-1", 1, 1, "http://document-ai:8080")
            self.assertEqual(first, second)
            return {"cacheObserved": True}

        with tempfile.TemporaryDirectory() as directory:
            with (patch.dict("os.environ", {
                      "INSPECTOR_DURABLE_OCR_CACHE_ROOT": directory,
                      "OCR_LAYOUT_PROFILE_ID": "ocr-paddle-3.7.0-ru-en-mobile-v1",
                  }), patch("inspector_worker.durable_pz002.download_text_artifact",
                            return_value=text_artifact("PD-1", digest, "120")),
                  patch("inspector_worker.durable_pz002._download_source",
                        side_effect=download) as fetch,
                  patch("inspector_worker.durable_pz002.recognize_pdf_page",
                        return_value=ocr) as recognize,
                  patch("inspector_worker.durable_pz002.analyze_pz002_bundle",
                        side_effect=analyze)):
                self.assertEqual(execute_durable_pz002(
                    lease, ATTEMPT, NAVIGATION, NUMERIC), {"cacheObserved": True})
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(recognize.call_count, 1)


if __name__ == "__main__":
    unittest.main()
