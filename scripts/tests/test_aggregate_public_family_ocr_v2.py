from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path
from recorded_artifact_support import require_recorded_artifacts


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "aggregate_public_family_ocr_v2", ROOT / "scripts/aggregate-public-family-ocr-v2.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class V2OcrReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        folder = ROOT / "output/public-index-20260927"
        require_recorded_artifacts(
            *(folder / name for name in (
                "public-family-ocr-queue-v2-20260927.json",
                "public-family-ocr-selection-20260927.json",
                "public-family-ocr-batch-triage-20260927.json",
                "public-family-ocr-v2-context-review-20260927.json",
                "public-family-ocr-v2-selection-cache-check-20260927.json",
                "public-family-ocr-v2-cache-check-20260927.json")),
            *(folder / f"public-family-ocr-v2-{kind}-{part}-20260927.json"
              for kind in ("selection", "batch") for part in ("a", "b", "c")),
            ROOT / "output/kr-decrease-ocr-20260927/triage.json",
        )
        cls.queue = MODULE._load(folder / "public-family-ocr-queue-v2-20260927.json")
        cls.prior_selection = MODULE._load(folder / "public-family-ocr-selection-20260927.json")
        cls.kr_triage = MODULE._load(ROOT / "output/kr-decrease-ocr-20260927/triage.json")
        cls.previous = MODULE._load(folder / "public-family-ocr-batch-triage-20260927.json")
        cls.packets = [
            (*MODULE._load(folder / f"public-family-ocr-v2-selection-{part}-20260927.json"),
             *MODULE._load(folder / f"public-family-ocr-v2-batch-{part}-20260927.json"))
            for part in ("a", "b", "c")
        ]
        cls.review = MODULE._load(folder / "public-family-ocr-v2-context-review-20260927.json")
        cls.cache_selection = MODULE._load(
            folder / "public-family-ocr-v2-selection-cache-check-20260927.json")
        cls.cache_check = MODULE._load(folder / "public-family-ocr-v2-cache-check-20260927.json")

    def _aggregate(self, *, packets=None, review=None):
        return MODULE.aggregate(*self.queue, *self.prior_selection,
                                *self.kr_triage, *self.previous,
                                self.packets if packets is None else packets,
                                *(self.review if review is None else review),
                                *self.cache_selection, *self.cache_check)

    def test_receipt_accounts_for_all_selected_pages_without_coverage_claim(self) -> None:
        report = self._aggregate()
        self.assertEqual(report["summary"]["v2SelectedUniquePages"], 48)
        self.assertEqual(report["summary"]["newlyProbedPages"], 33)
        self.assertEqual(report["summary"]["recoveredRenderLimitFailures"], 2)
        self.assertEqual(report["summary"]["unprocessedSelectedQueuePages"], 0)
        self.assertEqual(report["summary"]["priorKrPagesNotReprobedAgainst47Codes"], 3)
        self.assertEqual(report["summary"]["separateCacheHitVerificationPages"], 2)
        self.assertIsNone(report["parameterCoverage"])
        self.assertFalse(report["absenceProof"])

    def test_page_hash_drift_rejected(self) -> None:
        packets = copy.deepcopy(self.packets)
        packets[0][2]["items"][0]["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "provenance"):
            self._aggregate(packets=packets)

    def test_unreviewed_lead_rejected(self) -> None:
        review = copy.deepcopy(self.review)
        review[0]["items"].pop()
        with self.assertRaisesRegex(ValueError, "exactly the new OCR lead pages"):
            self._aggregate(review=review)


if __name__ == "__main__":
    unittest.main()
