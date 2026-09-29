from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]


class TextRuntimeSourceTest(unittest.TestCase):
    def test_sigmoid_formula_is_stable(self) -> None:
        source = (ROOT / "app.py").read_text()
        namespace = {"math": math}
        start = source.index("def stable_sigmoid")
        end = source.index("\n\nruntime =", start)
        exec(source[start:end], namespace)
        sigmoid = namespace["stable_sigmoid"]
        self.assertAlmostEqual(sigmoid(0.0), 0.5)
        self.assertGreater(sigmoid(1000.0), 0.999)
        self.assertLess(sigmoid(-1000.0), 0.001)

    def test_runtime_is_offline_and_dimension_bounded(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text()
        source = (ROOT / "app.py").read_text()
        self.assertIn("HF_HUB_OFFLINE=1", dockerfile)
        self.assertIn("TRANSFORMERS_OFFLINE=1", dockerfile)
        self.assertIn("dimensions must equal", source)
        self.assertIn("values[:, :OUTPUT_DIMENSIONS]", source)
        self.assertIn("set_per_process_memory_fraction", source)


if __name__ == "__main__":
    unittest.main()
