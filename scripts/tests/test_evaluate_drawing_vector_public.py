from __future__ import annotations

import hashlib
from pathlib import Path
import runpy
import tempfile
import unittest


EVALUATOR = runpy.run_path(str(Path(__file__).resolve().parents[1]
                            / "evaluate-drawing-vector-public.py"))


class DrawingVectorEvaluationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.pdf = Path(self.directory.name) / "target.pdf"
        self.pdf.write_bytes(b"synthetic public PDF bytes")
        self.pdf_hash = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.source_hash = "a" * 64
        self.locator_hash = "d" * 64
        self.manifest = [
            {"file_id": "SOURCE", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "object_id": "OBJECT_A", "sha256": self.source_hash},
            {"file_id": "TARGET", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "object_id": "OBJECT_B", "sha256": self.pdf_hash,
             "size_bytes": self.pdf.stat().st_size, "pdf_pages": 2},
        ]
        self.library = {
            "schema_version": "drawing-template-library-v1",
            "release_status": "EXPERIMENTAL_REVIEW_REQUIRED",
            "manifest_sha256": "b" * 64,
            "templates": [{"template_id": "template-1", "class_id": "RADIATOR",
                           "source_file_id": "SOURCE", "source_pdf_sha256": self.source_hash,
                           "source_object_id": "OBJECT_A"}],
        }
        self.report = {
            "schema_version": "drawing-vector-public-locator-v1", "status": "EXPLORATORY_ONLY",
            "template_library_sha256": "c" * 64, "template_id": "template-1",
            "target_file_id": "TARGET", "target_pdf_sha256": self.pdf_hash,
            "source_object_id": "OBJECT_A", "target_object_id": "OBJECT_B",
            "cross_object_eval": True, "target_pages": [1, 2],
            "candidate_count": 3,
            "candidates": [self.candidate(1, [0, 0, 10, 10]),
                           self.candidate(1, [0, 0, 10, 10]),
                           self.candidate(2, [20, 20, 30, 30])],
        }

    def candidate(self, page: int, bounds: list[int]) -> dict:
        return {"file_id": "TARGET", "source_sha256": self.pdf_hash,
                "page_number": page, "bbox_display_pt": bounds,
                "template_id": "template-1", "method": "red_vector_panel_with_blue_contact_v1",
                "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"}

    def review(self, page: int, instances: list[dict], status: str = "HUMAN_APPROVED") -> dict:
        return {"schema_version": "drawing-sheet-review-v1", "file_id": "TARGET",
                "source_sha256": self.pdf_hash, "object_id": "OBJECT_B",
                "page_number": page, "class_id": "RADIATOR", "coverage": "FULL_SHEET",
                "review_status": status, "reviewer_id": "independent-human",
                "locator_report_sha256": self.locator_hash,
                "instances": instances}

    def evaluate(self, reviews: list[dict], pages: list[int] | None = None) -> dict:
        return EVALUATOR["evaluate"](
            self.manifest, self.report, reviews, self.pdf, pages or [1, 2], 0.5,
            self.library, "c" * 64, "b" * 64, self.locator_hash,
        )

    def test_partial_or_ai_only_labels_never_produce_metrics(self) -> None:
        result = self.evaluate([self.review(1, [], "AI_CROSSCHECKED")])
        self.assertEqual(result["status"], "NOT_ESTIMABLE")
        self.assertEqual(result["unreviewed_pages"], [1, 2])
        self.assertIsNone(result["metrics"])
        self.assertEqual(result["release_gate"], "NOT_ASSESSED")

    def test_one_to_one_matching_counts_duplicates_false_positives_and_misses(self) -> None:
        result = self.evaluate([
            self.review(1, [{"instance_id": "R1", "bbox_display_pt": [0, 0, 10, 10]},
                            {"instance_id": "R2", "bbox_display_pt": [50, 50, 60, 60]}]),
            self.review(2, []),
        ])
        self.assertEqual(result["status"], "MEASURED")
        self.assertEqual(result["metrics"], {
            "true_positive": 1, "false_positive": 2, "false_negative": 1,
            "precision": 1 / 3, "recall": 0.5,
        })
        self.assertEqual(result["pages"][0]["matches"][0]["instance_id"], "R1")
        self.assertEqual(result["release_gate"], "NOT_ASSESSED")

    def test_matching_maximizes_count_before_overlap(self) -> None:
        matches = EVALUATOR["one_to_one_matches"](
            [(1, 0, 11, 10), (0, 0, 8, 10)],
            [(0, 0, 10, 10), (4, 0, 14, 10)],
            0.5,
        )
        self.assertEqual([(proposal, truth) for proposal, truth, _ in matches],
                         [(0, 1), (1, 0)])

    def test_only_selected_fully_reviewed_page_is_scored(self) -> None:
        result = self.evaluate([self.review(2, [])], pages=[2])
        self.assertEqual(result["metrics"]["false_positive"], 1)
        self.assertIsNone(result["metrics"]["recall"])
        self.assertEqual(result["selected_pages"], [2])

    def test_hidden_source_and_cross_object_mismatch_fail_closed(self) -> None:
        self.manifest[1]["split"] = "TEST_HIDDEN"
        with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
            self.evaluate([])
        self.manifest[1]["split"] = "TRAIN_PUBLIC"
        self.report["cross_object_eval"] = False
        with self.assertRaisesRegex(ValueError, "cross-object"):
            self.evaluate([])

    def test_forged_candidate_and_duplicate_review_page_fail_closed(self) -> None:
        self.report["candidates"][0]["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "locator candidate"):
            self.evaluate([])
        self.report["candidates"][0]["source_sha256"] = self.pdf_hash
        with self.assertRaisesRegex(ValueError, "duplicated"):
            self.evaluate([self.review(1, []), self.review(1, [])])

    def test_review_of_different_locator_cannot_certify_current_report(self) -> None:
        review = self.review(1, [])
        review["locator_report_sha256"] = "e" * 64
        with self.assertRaisesRegex(ValueError, "locator report SHA-256"):
            self.evaluate([review])


if __name__ == "__main__":
    unittest.main()
