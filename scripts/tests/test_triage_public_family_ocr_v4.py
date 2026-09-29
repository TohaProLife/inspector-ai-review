from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from recorded_artifact_support import require_recorded_artifacts


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "triage_public_family_ocr_v4", ROOT / "scripts" / "triage-public-family-ocr-v4.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DATA = ROOT / "output" / "public-index-20260927"
REPORT = DATA / "family-ocr-v4-max200-report-20260928.json"
AUDIT = DATA / "family-ocr-v4-max200-audit-20260928.json"
RECEIPTS = DATA / "family-ocr-v4-max200-pages"


class PublicFamilyOcrTriageTests(unittest.TestCase):
    def setUp(self) -> None:
        require_recorded_artifacts(REPORT, AUDIT)
        audit = json.loads(AUDIT.read_bytes())
        require_recorded_artifacts(
            *(RECEIPTS / f"{key}.json" for key in audit["receiptSha256"]))

    def test_real_audited_batch_separates_feature_from_scope(self) -> None:
        result = MODULE.triage(REPORT, AUDIT, RECEIPTS)
        self.assertEqual(result["pageCount"], 105)
        self.assertEqual(result["lexicalLeadCount"], 42)
        self.assertEqual(result["rawLeadCountsByRole"], {"FEATURE": 7, "SCOPE": 35})
        self.assertEqual(result["uniqueLineCountsByRole"], {"FEATURE": 4, "SCOPE": 29})
        self.assertEqual({row["sourceFileId"] for row in result["featureLinesForVisualReview"]},
                         {"F0151", "F0178"})
        self.assertTrue(all(row["reviewStatus"] == "UNREVIEWED"
                            for row in result["featureLinesForVisualReview"]))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])

    def test_tampered_receipt_cannot_enter_review_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory)
            for path in RECEIPTS.glob("*.json"):
                shutil.copyfile(path, copied / path.name)
            path = copied / "F0178-p14.json"
            value = json.loads(path.read_text())
            value["leads"][0]["literalLabel"] = "подменённая строка"
            path.write_text(json.dumps(value, ensure_ascii=False))
            with self.assertRaisesRegex(ValueError, "receipt SHA differs"):
                MODULE.triage(REPORT, AUDIT, copied)


if __name__ == "__main__":
    unittest.main()
