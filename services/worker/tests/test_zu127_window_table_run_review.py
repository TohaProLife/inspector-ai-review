"""Synthetic lease gates for the unregistered ZU-127 worker sidecar."""

from __future__ import annotations

import copy
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.zu127_window_table_poppler_v2 import (
    PROFILE_ID, PUBLIC_OBJECT_ID, PUBLIC_SHA, PUBLIC_SIZE, SCHEMA_VERSION,
)
from inspector_worker.zu127_window_table_run_review import (
    POPPLER_VERSION, _hash, _version, evaluate_reviewed_zu127_window_table,
)


MANIFEST = "a" * 64
SOURCE_ID = "uploaded-source-1"
FAKE_PDF = Path("/not-read/by-gates.pdf")


def lease() -> dict:
    return {"inputManifestHash": MANIFEST, "objectId": PUBLIC_OBJECT_ID,
            "release": {"lifecycle": "DRAFT", "externalNetworkAllowed": False,
                        "providerSlot": {"stageJobType": "RULE_EVALUATION",
                                         "providerKind": "RULE_ENGINE",
                                         "status": "CONFIGURED", "profileId": PROFILE_ID}},
            "inputs": {"sourceFiles": [{"sourceFileId": SOURCE_ID,
                                        "sha256": PUBLIC_SHA, "byteSize": PUBLIC_SIZE,
                                        "mediaType": "application/pdf", "stages": ["PD"],
                                        "sectionCode": None}],
                       "sourceDecisions": {}}}


def approved(current: dict) -> dict:
    current = copy.deepcopy(current)
    current["inputs"]["sourceFiles"][0]["sectionCode"] = "ZU"
    current["inputs"]["sourceDecisions"][SOURCE_ID] = {
        "sourceSha256": PUBLIC_SHA, "revisionStatus": "CURRENT",
        "approvalStatus": "APPROVED", "sectionCode": "ZU",
        "pageStages": {}, "basis": {"reference": "synthetic-test-only"}}
    return current


def pure_review() -> dict:
    review = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
            "purpose": "REVIEW_ONLY", "sourceFileId": "F0152",
            "sourceObjectId": PUBLIC_OBJECT_ID, "sourceSha256": PUBLIC_SHA,
            "selectedPageNumbers": [49, 51],
            "pageReceipts": [{"pageNumber": number,
                              "providerId": f"poppler-pdftotext-bbox-layout-v2@{POPPLER_VERSION}"}
                             for number in (49, 51)],
            "codeRows": [{"parameterCode": "ZU-127", "status": "ABSTAIN",
                          "typedFact": None, "absenceConclusion": "NOT_AVAILABLE",
                          "proposals": [{"typedValues": None,
                                         "rowAssociationStatus": "UNVERIFIED"}]}],
            "findings": None, "findingCount": None,
            "parameterCoverage": None, "typedFacts": None}
    review["contentHash"] = _hash(review)
    return review


class Zu127RunReviewTests(unittest.TestCase):
    def test_missing_or_unapproved_review_defers_without_poppler_or_pdf(self) -> None:
        for current, reason in (
            (lease(), "SOURCE_REVIEW_REQUIRED"),
            (approved(lease()), "SOURCE_SECTION_UNRESOLVED"),
        ):
            if reason == "SOURCE_SECTION_UNRESOLVED":
                current["inputs"]["sourceFiles"][0]["sectionCode"] = None
                current["inputs"]["sourceDecisions"][SOURCE_ID]["sectionCode"] = None
            with self.subTest(reason=reason), \
                 patch("inspector_worker.zu127_window_table_run_review._version") as version, \
                 patch("inspector_worker.zu127_window_table_run_review."
                       "evaluate_zu127_window_table_poppler_v2") as compute:
                result = evaluate_reviewed_zu127_window_table(current, FAKE_PDF)
                self.assertEqual(result["codeRows"][0]["reasonCodes"], [reason])
                self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")
                self.assertEqual(result["codeRows"][0]["proposals"], [])
                self.assertIsNone(result["findingCount"])
                version.assert_not_called()
                compute.assert_not_called()
        current = approved(lease())
        current["inputs"]["sourceDecisions"][SOURCE_ID]["approvalStatus"] = "UNKNOWN"
        current["inputs"]["sourceFiles"][0]["sectionCode"] = None
        self.assertEqual(evaluate_reviewed_zu127_window_table(current, FAKE_PDF)
                         ["codeRows"][0]["reasonCodes"],
                         ["SOURCE_REVIEW_NOT_CURRENT_APPROVED"])

    def test_wrong_release_source_identity_or_decision_sha_fails_closed(self) -> None:
        bad = lease()
        bad["release"]["providerSlot"]["profileId"] = "older-profile"
        with self.assertRaisesRegex(ValueError, "explicit immutable release"):
            evaluate_reviewed_zu127_window_table(bad, FAKE_PDF)
        bad = lease()
        bad["inputs"]["sourceFiles"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "one exact F0152 source"):
            evaluate_reviewed_zu127_window_table(bad, FAKE_PDF)
        bad = approved(lease())
        bad["inputs"]["sourceDecisions"][SOURCE_ID]["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "decision SHA mismatch"):
            evaluate_reviewed_zu127_window_table(bad, FAKE_PDF)

    def test_exact_versions_checked_before_pdf_evaluation(self) -> None:
        with patch("inspector_worker.zu127_window_table_run_review._run",
                   return_value=(b"", b"pdftotext version 25.12.0\n"
                                    b"Copyright 2005-2025 The Poppler Developers\n")):
            self.assertEqual(_version("pdftotext"), POPPLER_VERSION)
        with patch("inspector_worker.zu127_window_table_run_review._run",
                   return_value=(b"pdftotext version 25.03.0\n", b"")), \
             patch("inspector_worker.zu127_window_table_run_review."
                   "evaluate_zu127_window_table_poppler_v2") as compute:
            with self.assertRaisesRegex(ValueError, "pdftotext 25.12.0"):
                evaluate_reviewed_zu127_window_table(approved(lease()), FAKE_PDF)
            compute.assert_not_called()
        with patch("inspector_worker.zu127_window_table_run_review._run",
                   side_effect=[(b"", b"pdftotext version 25.12.0\n"),
                                (b"", b"pdfinfo version 25.03.0\n")]), \
             patch("inspector_worker.zu127_window_table_run_review."
                   "evaluate_zu127_window_table_poppler_v2") as compute:
            with self.assertRaisesRegex(ValueError, "pdfinfo 25.12.0"):
                evaluate_reviewed_zu127_window_table(approved(lease()), FAKE_PDF)
            compute.assert_not_called()

    def test_valid_synthetic_output_keeps_abstention_and_receipts(self) -> None:
        with patch("inspector_worker.zu127_window_table_run_review._version",
                   return_value=POPPLER_VERSION) as version, \
             patch("inspector_worker.zu127_window_table_run_review."
                   "evaluate_zu127_window_table_poppler_v2",
                   return_value=pure_review()) as compute:
            result = evaluate_reviewed_zu127_window_table(approved(lease()), FAKE_PDF)
        self.assertEqual(result["inputManifestHash"], MANIFEST)
        self.assertEqual(result["runSourceFileId"], SOURCE_ID)
        self.assertEqual(result["popplerVersion"], POPPLER_VERSION)
        self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")
        self.assertIsNone(result["findings"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual(version.call_count, 2)
        compute.assert_called_once()

    def test_claimed_fact_or_wrong_receipt_rejected(self) -> None:
        for mutation in (
            lambda output: output.update({"findingCount": 0}),
            lambda output: output["codeRows"][0].update({"status": "FACT"}),
            lambda output: output["codeRows"][0]["proposals"][0].update(
                {"typedValues": {"value": 0.65}}),
            lambda output: output["pageReceipts"][0].update(
                {"providerId": "poppler-pdftotext-bbox-layout-v2@25.03.0"}),
        ):
            output = pure_review()
            mutation(output)
            output["contentHash"] = _hash({key: value for key, value in output.items()
                                           if key != "contentHash"})
            with self.subTest(output=output), \
                 patch("inspector_worker.zu127_window_table_run_review._version",
                       return_value=POPPLER_VERSION), \
                 patch("inspector_worker.zu127_window_table_run_review."
                       "evaluate_zu127_window_table_poppler_v2", return_value=output):
                with self.assertRaisesRegex(ValueError, "review-only result invalid"):
                    evaluate_reviewed_zu127_window_table(approved(lease()), FAKE_PDF)


if __name__ == "__main__":
    unittest.main()
