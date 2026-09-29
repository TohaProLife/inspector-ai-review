"""Specialist queue boundary and fenced exact-source adapter tests."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.zu127_specialist_consumer import (
    SPECIALIST_QUEUE,
    evaluate_f0152_fixture_lease,
    main,
    fixture_claim_payload,
    verify_runtime,
)
from test_zu127_window_table_run_review import approved, lease


def specialist_lease() -> dict:
    current = lease()
    current["jobId"] = "job-1"
    current["jobType"] = "RULE_EVALUATION"
    current["inputs"]["sourceFiles"][0]["downloadPath"] = (
        "/api/internal/v1/jobs/job-1/inputs/uploaded-source-1"
    )
    return current


ATTEMPT = {"attemptId": "attempt-1", "fencingToken": 4}


class Zu127SpecialistConsumerTests(unittest.TestCase):
    def test_queue_is_fixed_and_default_start_refuses_durable_work(self) -> None:
        with patch.object(sys, "argv", ["zu127-specialist", "--queue", "rules.evaluate"]), \
             patch("inspector_worker.zu127_specialist_consumer.verify_runtime") as version:
            with self.assertRaises(SystemExit):
                main()
            version.assert_not_called()
        with patch.object(sys, "argv", ["zu127-specialist"]), \
             patch("inspector_worker.zu127_specialist_consumer.verify_runtime") as version:
            with self.assertRaisesRegex(SystemExit, "F0152 fixture has no durable API contract"):
                main()
            version.assert_called_once_with()
        self.assertEqual(SPECIALIST_QUEUE, "rules.evaluate.zu127.poppler-v2")
        self.assertEqual(fixture_claim_payload("worker-1"), {
            "workerId": "worker-1", "capabilities": ["RULE_EVALUATION"],
            "queueName": SPECIALIST_QUEUE,
        })

    def test_runtime_checks_both_exact_poppler_programs(self) -> None:
        with patch("inspector_worker.zu127_specialist_consumer._version") as version:
            verify_runtime()
            self.assertEqual(version.call_count, 2)
            self.assertEqual([call.args[0] for call in version.call_args_list],
                             ["pdftotext", "pdfinfo"])

    def test_missing_review_abstains_without_download_or_poppler(self) -> None:
        current = specialist_lease()
        with patch("inspector_worker.zu127_specialist_consumer.verify_runtime") as version:
            result = evaluate_f0152_fixture_lease(
                current, ATTEMPT, download=lambda *_: self.fail("download occurred"),
            )
            version.assert_not_called()
        self.assertEqual(result["codeRows"][0]["reasonCodes"],
                         ["SOURCE_REVIEW_REQUIRED"])
        self.assertIsNone(result["findings"])

    def test_invalid_fence_profile_or_source_fails_before_download(self) -> None:
        for mutation in ("fence", "job", "object", "profile", "sha", "path"):
            current = specialist_lease()
            attempt = copy.deepcopy(ATTEMPT)
            if mutation == "fence":
                attempt["fencingToken"] = True
            elif mutation == "job":
                current["jobType"] = "DOCUMENT_RENDER"
            elif mutation == "object":
                current["objectId"] = "other-object"
            elif mutation == "profile":
                current["release"]["providerSlot"]["profileId"] = "wrong"
            elif mutation == "sha":
                current["inputs"]["sourceFiles"][0]["sha256"] = "0" * 64
            else:
                current["inputs"]["sourceFiles"][0]["downloadPath"] = "https://bad"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                evaluate_f0152_fixture_lease(current, attempt,
                                       download=lambda *_: self.fail("download occurred"))

    def test_eligible_synthetic_lease_downloads_into_ephemeral_file(self) -> None:
        current = approved(specialist_lease())
        observed = []

        def download(_path: str, target: Path, _sha: str, _size: int,
                     _attempt: dict[str, object]) -> None:
            observed.append(target)
            target.write_bytes(b"synthetic test only")

        with patch("inspector_worker.zu127_specialist_consumer.verify_runtime"), \
             patch("inspector_worker.zu127_specialist_consumer."
                   "evaluate_reviewed_zu127_window_table",
                   return_value={"purpose": "REVIEW_ONLY", "findings": None}) as evaluate:
            result = evaluate_f0152_fixture_lease(current, ATTEMPT, download=download)
            self.assertEqual(result["purpose"], "REVIEW_ONLY")
            evaluate.assert_called_once_with(current, observed[0])
        self.assertFalse(observed[0].exists())

    def test_bad_approved_decision_does_not_download(self) -> None:
        current = approved(specialist_lease())
        current["inputs"]["sourceDecisions"]["uploaded-source-1"]["basis"]["reference"] = "bad"
        with self.assertRaisesRegex(ValueError, "authenticated source review"):
            evaluate_f0152_fixture_lease(current, ATTEMPT,
                                   download=lambda *_: self.fail("download occurred"))


if __name__ == "__main__":
    unittest.main()
