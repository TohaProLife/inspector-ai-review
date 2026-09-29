"""Receipt integrity checks for completed bounded OCR triage."""

from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path
from unittest import mock
from recorded_artifact_support import require_recorded_artifacts

SCRIPT = Path(__file__).resolve().parents[1] / "summarize-unresolved-targeted-ocr.py"
SPEC = importlib.util.spec_from_file_location("unresolved_ocr_summary", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompletedReceiptTest(unittest.TestCase):
    def setUp(self) -> None:
        require_recorded_artifacts(
            *(MODULE.DIR / name for name in (
                "queue-v2.json", "batch-v2.json", "pattern-policy.json", "first-attempt.json")),
            MODULE.ROOT / "output/unresolved-public-summary-20260927/summary.json",
        )

    def test_actual_receipt_has_no_promoted_results(self) -> None:
        result = MODULE.summarize()
        self.assertEqual(result["summary"]["completedPages"], 64)
        self.assertEqual(result["summary"]["finalErrors"], 0)
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertFalse(result["absenceProof"])

    def test_page_source_sha_drift_rejected(self) -> None:
        actual = {name: MODULE.load(name) for name in (
            "queue-v2.json", "batch-v2.json", "pattern-policy.json", "first-attempt.json")}
        changed = copy.deepcopy(actual["batch-v2.json"][0])
        changed["items"][0]["sourceSha256"] = "0" * 64
        actual["batch-v2.json"] = changed, actual["batch-v2.json"][1]
        with mock.patch.object(MODULE, "load", side_effect=actual.__getitem__):
            with self.assertRaisesRegex(ValueError, "page OCR, source SHA"):
                MODULE.summarize()


if __name__ == "__main__":
    unittest.main()
