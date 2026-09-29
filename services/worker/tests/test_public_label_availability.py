from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "evaluate-public-label-availability.py"
SPEC = importlib.util.spec_from_file_location("public_label_availability", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicLabelAvailabilityTests(unittest.TestCase):
    def test_mixed_stage_needs_page_proof(self) -> None:
        self.assertEqual(MODULE.evidence_role_status("RD", "RD_ID_MIXED"),
                         "PAGE_STAGE_PROOF_REQUIRED")
        self.assertEqual(MODULE.evidence_role_status("PD", "PD"),
                         "MANIFEST_STAGE_EXACT")
        self.assertEqual(MODULE.evidence_role_status("RD", "PD"),
                         "STAGE_CONFLICT")

    def test_abstain_receipt_does_not_create_negative_or_metric(self) -> None:
        preview = {"status": "PARTIAL", "findingCount": 0,
                   "checkId": "CHK-TEST", "objectId": "OBJ-RUNTIME",
                   "coverage": {"UNSUPPORTED": 125, "PARTIAL": 7},
                   "factFamily": {"comparisons": [
                       {"parameterCode": code, "status": "ABSTAIN"}
                       for code in sorted(MODULE.PILOT_CODES)]},
                   "candidateFamilyPreview": {"codeCount": 47, "leadCount": 0}}
        result = MODULE.preview_evaluation_status(
            preview, labeled_objects={"OBJ-LABELED"},
            labeled_codes={"IOS4-078", "IOS4-079"}, smoke_object="OBJ-SMOKE")
        self.assertEqual(result["scoringStatus"],
                         "NOT_ESTIMABLE_NO_SAME_OBJECT_LABELED_PREDICTIONS")
        self.assertEqual(result["pilotComparisonStatusCounts"], {"ABSTAIN": 5})
        self.assertIsNone(result["trueNegativeCount"])
        self.assertIsNone(result["falseNegativeCount"])
        self.assertIsNone(result["precision"])
        self.assertIsNone(result["recall"])

    def test_public_check_outside_allowed_manifest_fails_closed(self) -> None:
        check = {"check_id": "TRAIN-X", "finding_group_id": "G-X",
                 "split": "TRAIN_PUBLIC", "visibility": "PUBLIC_TRAIN_LABEL",
                 "violation_label": "VIOLATION_PRESENT", "parameter_code": "PZ-004",
                 "parameter_id": 4, "matrix_scope": "MATRIX", "score_eligible": True,
                 "object_id": "OBJ-1", "evidence": [{"file_id": "F0999",
                                                         "pdf_page_number": 1,
                                                         "stage": "PD"}]}
        with self.assertRaisesRegex(ValueError, "outside permitted"):
            MODULE._open_labels([check], {"PZ-004": {"parameter_id": 4}}, {})

    def test_actual_public_census_has_no_negative_or_pilot_labels(self) -> None:
        previews = [MODULE.PREVIEWS / name for name in (
            "candidate-preview-core-smoke-fixed-20260927.json",
            "candidate-preview-core-post-reconnect-20260927.json",
        )]
        missing = [str(path) for path in previews if not path.is_file()]
        if missing:
            self.skipTest("Recorded public E2E receipts unavailable: " + ", ".join(missing))
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "report.json"
            with patch("sys.argv", [str(SCRIPT), "--output", str(output)]), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(MODULE.main(), 0)
            report = json.loads(output.read_text())
        self.assertEqual(report["labelSummary"]["positiveCheckCount"], 10)
        self.assertEqual(report["labelSummary"]["negativeCheckCount"], 0)
        self.assertEqual(report["matrixCodesWithPublicPositives"],
                         ["IOS4-078", "IOS4-079"])
        self.assertEqual(report["familyCounts"]["PILOT_REVIEW_ONLY"]["positiveChecks"], 0)
        self.assertEqual(report["familyCounts"]["GENERIC_CANDIDATE"]["positiveChecks"], 0)
        self.assertFalse(report["metrics"]["abstainAsNegative"])
        self.assertIsNone(report["metrics"]["precision"])
        self.assertIsNone(report["metrics"]["recall"])


if __name__ == "__main__":
    unittest.main()
