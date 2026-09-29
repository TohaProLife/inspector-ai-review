"""The actual Python result must survive independent TypeScript re-derivation."""

from __future__ import annotations

from pathlib import Path
import runpy
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "check-ocr-heat-worker-api-contract.py"


class OcrHeatCrossLanguageContractTests(unittest.TestCase):
    def test_worker_result_matches_api_and_tampering_is_rejected(self) -> None:
        report = runpy.run_path(str(SCRIPT))["run_contract"]()
        self.assertEqual(report["singleStageProposalCount"], 2)
        self.assertEqual(report["mixedStageAbstentionCount"], 2)
        self.assertEqual(sum(report["checks"].values()), 3)


if __name__ == "__main__":
    unittest.main()
