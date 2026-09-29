"""Fenced, source-independent ZU-127 v3 stage tests (synthetic review only)."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path

from inspector_worker.text_layer import qualify_page_text
from inspector_worker.zu127_generic_stage_v3 import (
    PROFILE_CONFIG_HASH, PROFILE_ID, evaluate_fenced_zu127_generic_stage_v3,
)
from services.worker.tests.test_zu127_page_selection_v3 import fixture


PDF = b"%PDF-1.7 synthetic ZU document bytes"
SHA = hashlib.sha256(PDF).hexdigest()
ATTEMPT = {"attemptId": "attempt-synthetic", "fencingToken": 7}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def setup() -> tuple[dict, dict]:
    sources, decisions, receipts = fixture()
    artifact = receipts[0]["artifact"]
    source = sources[0]
    source.update(sha256=SHA, byteSize=len(PDF), sectionCode="ZU",
                  downloadPath="/api/internal/v1/jobs/job-synthetic/inputs/S1")
    decisions["S1"]["sourceSha256"] = SHA
    artifact["inputSha256"] = SHA
    lease = {"jobId": "job-synthetic", "jobType": "RULE_EVALUATION",
             "runId": "run-synthetic", "releaseId": "release-synthetic",
             "objectId": "OBJECT-1", "inputManifestHash": "b" * 64,
             "attemptId": ATTEMPT["attemptId"],
             "fencingToken": ATTEMPT["fencingToken"],
             "release": {"manifestHash": "c" * 64, "lifecycle": "DRAFT",
                         "externalNetworkAllowed": False,
                         "providerSlot": {"stageJobType": "RULE_EVALUATION",
                                          "providerKind": "RULE_ENGINE",
                                          "status": "CONFIGURED",
                                          "profileId": PROFILE_ID,
                                          "configHash": PROFILE_CONFIG_HASH}},
             "inputs": {"sourceFiles": [source], "sourceDecisions": decisions}}
    return lease, artifact


def fake_evidence(_path: Path, **scope: object) -> dict:
    pages = []
    for number in scope["page_numbers"]:
        body = {"sourceSha256": scope["expected_sha256"],
                "pdfPageCount": scope["expected_page_count"],
                "pageNumber": number, "words": [],
                "wordArtifactSha256": digest([])}
        pages.append({**body, "inspectionSha256": digest(body)})
    result = {"schemaVersion": "poppler-page-evidence-v1",
              "purpose": "REVIEW_ONLY", "sourceSha256": scope["expected_sha256"],
              "sourceByteSize": scope["expected_byte_size"],
              "pdfPageCount": scope["expected_page_count"],
              "selectedPageNumbers": scope["page_numbers"],
              "pageEvidence": pages, "typedFacts": None,
              "findings": None, "parameterCoverage": None}
    return {**result, "contentHash": digest(result)}


class Zu127GenericStageV3Tests(unittest.TestCase):
    def evaluate(self, lease=None, artifact=None, *, data=PDF, calls=None, extract=fake_evidence):
        if lease is None or artifact is None:
            lease, artifact = setup()
        calls = calls if calls is not None else []

        def text_download(_lease, source, attempt):
            calls.append(("text", source["sourceFileId"], attempt["fencingToken"]))
            return copy.deepcopy(artifact)

        def source_download(path, target, sha, size, attempt):
            calls.append(("pdf", path, sha, size, attempt["fencingToken"]))
            target.write_bytes(data)

        def page_extract(path, **scope):
            calls.append(("poppler", tuple(scope["page_numbers"])))
            return extract(path, **scope)

        return evaluate_fenced_zu127_generic_stage_v3(
            lease, ATTEMPT, download_text=text_download,
            download_source=source_download, extract_pages=page_extract)

    def test_fenced_synthetic_review_reads_only_selected_pages(self) -> None:
        lease, artifact = setup()
        calls = []
        result = self.evaluate(lease, artifact, calls=calls)
        self.assertEqual(result["schemaVersion"], "zu127-generic-stage-v3")
        self.assertEqual(result["status"], "ABSTAIN")
        self.assertEqual(result["selectedPageCount"], 4)
        self.assertEqual(result["selection"]["sourceRows"][0]["selectedPageNumbers"],
                         [1, 4, 5, 6])
        self.assertEqual(result["pageReceipts"][0]["pageEvidence"]["selectedPageNumbers"],
                         [1, 4, 5, 6])
        self.assertEqual([call[0] for call in calls], ["text", "pdf", "poppler"])
        self.assertIsNone(result["findings"])
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["typedFacts"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual(result["contentHash"],
                         digest({key: value for key, value in result.items()
                                 if key != "contentHash"}))

    def test_missing_or_non_current_review_never_opens_pdf(self) -> None:
        for state in ("missing", "unknown", "wrong-section"):
            with self.subTest(state=state):
                lease, artifact = setup()
                if state == "missing":
                    lease["inputs"]["sourceDecisions"] = {}
                    lease["inputs"]["sourceFiles"][0]["sectionCode"] = None
                elif state == "unknown":
                    lease["inputs"]["sourceDecisions"]["S1"]["approvalStatus"] = "UNKNOWN"
                else:
                    lease["inputs"]["sourceDecisions"]["S1"]["sectionCode"] = "OTHER"
                    lease["inputs"]["sourceFiles"][0]["sectionCode"] = "OTHER"
                calls = []
                result = self.evaluate(lease, artifact, calls=calls)
                self.assertEqual(result["status"], "ABSTAIN")
                self.assertEqual(result["selectedPageCount"], 0)
                self.assertEqual(result["pageReceipts"], [])
                self.assertEqual([call[0] for call in calls], ["text"])

    def test_pdf_bytes_tamper_rejected_before_poppler(self) -> None:
        lease, artifact = setup()
        calls = []
        with self.assertRaisesRegex(ValueError, "downloaded PDF SHA or size mismatch"):
            self.evaluate(lease, artifact, data=PDF + b"tamper", calls=calls)
        self.assertEqual([call[0] for call in calls], ["text", "pdf"])

    def test_approved_source_without_lexical_page_never_opens_pdf(self) -> None:
        lease, artifact = setup()
        artifact["pages"][0]["blocks"][0]["text"] = "Коэффициент теплопередачи окон."
        artifact["pages"][3]["blocks"][0]["text"] = "Коэффициент теплопередачи окон."
        artifact["pages"][4]["blocks"][0]["text"] = "Коэффициент теплопередачи окон."
        artifact["pages"][5]["blocks"][0]["text"] = "Коэффициент теплопередачи окон."
        for page in artifact["pages"]:
            page["quality"] = qualify_page_text(
                [block["text"] for block in page["blocks"]],
                policy_version=artifact["qualityPolicyVersion"])
        calls = []
        result = self.evaluate(lease, artifact, calls=calls)
        self.assertEqual(result["selectedPageCount"], 0)
        self.assertEqual([call[0] for call in calls], ["text"])
        self.assertIn("NO_TEXT_LAYER_CANDIDATE",
                      result["selection"]["sourceRows"][0]["reasonCodes"])

    def test_lease_release_and_source_tamper_fail_closed(self) -> None:
        for state in ("fence", "profile", "config", "manifest", "download-path",
                      "section-snapshot", "text-sha", "page-count", "decision-sha"):
            with self.subTest(state=state):
                lease, artifact = setup()
                if state == "fence":
                    lease["fencingToken"] = 8
                elif state == "profile":
                    lease["release"]["providerSlot"]["profileId"] = "legacy"
                elif state == "config":
                    lease["release"]["providerSlot"]["configHash"] = "0" * 64
                elif state == "manifest":
                    lease["release"]["manifestHash"] = "bad"
                elif state == "download-path":
                    lease["inputs"]["sourceFiles"][0]["downloadPath"] = "https://bad"
                elif state == "section-snapshot":
                    lease["inputs"]["sourceFiles"][0]["sectionCode"] = "OTHER"
                elif state == "text-sha":
                    artifact["inputSha256"] = "0" * 64
                elif state == "page-count":
                    lease["inputs"]["sourceFiles"][0]["pageCount"] = 77
                else:
                    lease["inputs"]["sourceDecisions"]["S1"]["sourceSha256"] = "0" * 64
                calls = []
                with self.assertRaises(ValueError):
                    self.evaluate(lease, artifact, calls=calls)
                self.assertNotIn("pdf", [call[0] for call in calls])

    def test_poppler_receipt_tamper_rejected(self) -> None:
        lease, artifact = setup()

        def bad(path, **scope):
            result = fake_evidence(path, **scope)
            result["pageEvidence"][0]["pageNumber"] = 2
            result["contentHash"] = digest({key: value for key, value in result.items()
                                            if key != "contentHash"})
            return result

        with self.assertRaisesRegex(ValueError, "Poppler page receipt invalid"):
            self.evaluate(lease, artifact, extract=bad)


if __name__ == "__main__":
    unittest.main()
