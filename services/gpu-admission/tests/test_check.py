from __future__ import annotations

from decimal import Decimal
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check import AdmissionError, admitted, parse_budgets, query_gpu  # noqa: E402


class GpuAdmissionTest(unittest.TestCase):
    def test_accepts_budget_below_cap(self) -> None:
        cap = admitted(
            81559,
            Decimal("0.85"),
            {"vlm": 30720, "document": 10240},
            256,
        )
        self.assertEqual(cap, 69325)

    def test_rejects_shared_gpu_when_other_processes_use_budget(self) -> None:
        with self.assertRaisesRegex(AdmissionError, "GPU is not empty enough"):
            admitted(
                81559,
                Decimal("0.85"),
                {"vlm": 30720, "document": 10240},
                30000,
            )

    def test_rejects_budget_above_cap(self) -> None:
        with self.assertRaisesRegex(AdmissionError, "exceed admission cap"):
            admitted(100, Decimal("0.85"), {"a": 50, "b": 50})

    def test_rejects_boolean_budget(self) -> None:
        with self.assertRaisesRegex(AdmissionError, "positive integer"):
            parse_budgets('{"vlm": true}')

    @patch("check.subprocess.check_output", return_value="81559, 256\n")
    def test_queries_single_visible_gpu(self, check_output) -> None:
        self.assertEqual(query_gpu("0"), (81559, 256))
        self.assertNotIn("--id=0", check_output.call_args.args[0])

    @patch("check.subprocess.check_output", return_value="81559, 256\n81559, 1024\n")
    def test_rejects_two_visible_gpus(self, _check_output) -> None:
        with self.assertRaisesRegex(AdmissionError, "exactly one visible GPU"):
            query_gpu("0")


if __name__ == "__main__":
    unittest.main()
