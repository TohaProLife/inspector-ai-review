from __future__ import annotations

from pathlib import Path
import runpy
import unittest


PROBE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "probe-template-vision-public.py"))


class VisionGuardTests(unittest.TestCase):
    def test_unsupported_vector_context_abstains_even_when_vlm_says_radiator(self) -> None:
        candidate = {"vector_context": "NO_GEOMETRIC_SUPPORT", "score": 0.969727}
        answer = {"class": "RADIATOR", "visibleLabel": "EI W-30", "reason": "shape"}
        self.assertEqual(PROBE["review_gate"](candidate, answer),
                         "ABSTAIN_CONTEXT_UNVERIFIED")

    def test_two_supporting_signals_still_require_review(self) -> None:
        candidate = {"vector_context": "GEOMETRIC_SUPPORT"}
        self.assertEqual(PROBE["review_gate"](candidate, {
            "class": "RADIATOR", "visibleLabel": "PRADO Universal", "reason": "callout"}),
                         "REVIEW_REQUIRED_GEOMETRIC_AND_VISUAL_SUPPORT")
        self.assertEqual(PROBE["review_gate"](candidate, {
            "class": "UNCERTAIN", "visibleLabel": None, "reason": "unclear"}),
                         "ABSTAIN_CONTEXT_UNVERIFIED")

    def test_literal_null_is_invalid_model_output(self) -> None:
        candidate = {"vector_context": "GEOMETRIC_SUPPORT"}
        answer = {"class": "RADIATOR", "visibleLabel": "null", "reason": "shape"}
        self.assertEqual(PROBE["review_gate"](candidate, answer),
                         "ABSTAIN_INVALID_MODEL_OUTPUT")

    def test_cross_object_style_abstains_even_when_geometry_and_vlm_agree(self) -> None:
        candidate = {"vector_context": "GEOMETRIC_SUPPORT", "cross_object_eval": True}
        answer = {"class": "RADIATOR", "visibleLabel": None, "reason": "shape"}
        self.assertEqual(PROBE["review_gate"](candidate, answer),
                         "ABSTAIN_CROSS_OBJECT_STYLE_UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
