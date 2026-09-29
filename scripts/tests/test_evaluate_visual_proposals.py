from __future__ import annotations

import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest

import fitz


SCRIPT = Path(__file__).resolve().parents[1] / "evaluate-visual-proposals.py"
EVALUATOR = runpy.run_path(str(SCRIPT))


class VisualProposalEvaluationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "source.pdf"
        with fitz.open() as document:
            document.new_page(width=200, height=100)
            document.new_page(width=200, height=100)
            document.save(self.pdf)
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.manifest = [{
            "file_id": "F0001", "object_id": "DATASET-OBJECT", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "sha256": self.sha, "size_bytes": self.pdf.stat().st_size, "pdf_pages": 2,
        }]
        self.source = {
            "sourceFileId": "FIL-1", "sourceSha256": self.sha, "pageCount": 2,
            "scannedPageCount": 2, "status": "SCANNED", "scannedPageNumbers": [1, 2],
            "skippedPageCount": 0, "proposalLimitReached": False,
            "unretainedProposalCount": 0,
            "proposals": [
                self.proposal(1, [0.1, 0.2, 0.2, 0.4]),
                self.proposal(1, [0.1, 0.2, 0.2, 0.4]),
                self.proposal(2, [0.5, 0.2, 0.6, 0.4]),
            ],
        }
        self.artifact = {
            "schemaVersion": "visual-proposal-analysis-v3",
            "objectId": "INSPECTOR-OBJECT", "inputManifestHash": "a" * 64,
            "status": "PROPOSAL_ONLY_UNVERIFIED", "contentHash": "b" * 64,
            "profile": {
                "schemaVersion": "visual-proposal-profile-v3",
                "methodId": "red-vector-panel-blue-contact-v1",
                "maxPagesPerSource": 1024, "maxProposalsPerSource": 500,
                "coordinateSystem": "NORMALIZED_TOP_LEFT",
            },
            "sources": [self.source],
        }

    @staticmethod
    def proposal(page: int, box: list[float]) -> dict:
        return {"pageNumber": page, "bboxNormalized": box,
                "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"}

    def review(self, page: int, name: str, instances: list[dict], **changes: object) -> dict:
        row = {
            "schema_version": "visual-full-sheet-review-v1", "file_id": "F0001",
            "source_sha256": self.sha, "object_id": "DATASET-OBJECT",
            "page_number": page, "class_id": name, "coverage": "FULL_SHEET",
            "review_status": "HUMAN_APPROVED", "reviewer_id": "independent-human",
            "annotation_origin": "INDEPENDENT_OF_PROPOSALS",
            "created_without_proposals": True,
            "coordinate_system": "DISPLAY_POINT_TOP_LEFT",
            "page_display_size_pt": [200, 100], "instances": instances,
        }
        row.update(changes)
        return row

    @staticmethod
    def instance(identifier: str, box: list[float]) -> dict:
        return {"instance_id": identifier, "bbox_display_pt": box}

    def evaluate(self, reviews: list[dict], *, pages: list[int] | None = None,
                 classes: list[str] | None = None) -> dict:
        return EVALUATOR["evaluate"](
            self.manifest, self.artifact, reviews, self.pdf, "F0001",
            pages if pages is not None else [1, 2],
            classes if classes is not None else ["RADIATOR"], .5,
            manifest_sha256="m" * 64, artifact_sha256="a" * 64,
            reviews_sha256="r" * 64,
        )

    def test_missing_or_partial_ground_truth_never_produces_metrics(self) -> None:
        empty = self.evaluate([])
        self.assertEqual(empty["status"], "NOT_ESTIMABLE")
        self.assertEqual(len(empty["missing_page_classes"]), 2)
        self.assertIsNone(empty["metrics"])
        ai = self.evaluate([self.review(1, "RADIATOR", [], review_status="AI_CROSSCHECKED")])
        self.assertEqual(ai["status"], "NOT_ESTIMABLE")
        self.assertEqual(ai["release_gate"], "NOT_ASSESSED")

    def test_one_to_one_geometry_with_duplicates_and_absent_sheet(self) -> None:
        result = self.evaluate([
            self.review(1, "RADIATOR", [
                self.instance("R1", [20, 20, 40, 40]),
                self.instance("R2", [80, 50, 100, 70]),
            ]),
            self.review(2, "RADIATOR", []),
        ])
        self.assertEqual(result["status"], "MEASURED")
        self.assertIsNone(result["recognition_metrics"])
        metrics = result["metrics"]["RADIATOR"]
        self.assertEqual((metrics["true_positive"], metrics["false_positive"],
                          metrics["false_negative"]), (1, 2, 1))
        self.assertAlmostEqual(metrics["class_conditioned_proposal_precision"], 1 / 3)
        self.assertEqual(metrics["proposal_localization_recall"], .5)
        self.assertEqual(metrics["pages"][0]["matches"][0]["instance_id"], "R1")

    def test_per_class_metrics_remain_separate_not_class_recognition(self) -> None:
        reviews = [
            self.review(1, "RADIATOR", [self.instance("R1", [20, 20, 40, 40])]),
            self.review(2, "RADIATOR", []),
            self.review(1, "VENT_UNIT", []),
            self.review(2, "VENT_UNIT", [self.instance("V1", [100, 20, 120, 40])]),
        ]
        result = self.evaluate(reviews, classes=["RADIATOR", "VENT_UNIT"])
        self.assertEqual(result["status"], "MEASURED")
        self.assertEqual(result["metrics"]["RADIATOR"]["true_positive"], 1)
        self.assertEqual(result["metrics"]["VENT_UNIT"]["true_positive"], 1)
        self.assertEqual(result["metrics"]["VENT_UNIT"]["false_positive"], 2)

    def test_only_selected_pages_are_scored_and_unreviewed_scope_is_explicit(self) -> None:
        result = self.evaluate([self.review(2, "RADIATOR", [])], pages=[2])
        self.assertEqual(result["status"], "MEASURED")
        self.assertEqual(result["other_scanned_pages_not_evaluated"], 1)
        self.assertEqual(result["metrics"]["RADIATOR"]["false_positive"], 1)
        self.assertIsNone(result["metrics"]["RADIATOR"]["proposal_localization_recall"])

    def test_no_predictions_and_reviewed_absence_have_null_denominators(self) -> None:
        self.source["proposals"] = []
        result = self.evaluate([self.review(1, "RADIATOR", [])], pages=[1])
        self.assertEqual(result["status"], "MEASURED")
        score = result["metrics"]["RADIATOR"]
        self.assertEqual((score["true_positive"], score["false_positive"],
                          score["false_negative"]), (0, 0, 0))
        self.assertIsNone(score["class_conditioned_proposal_precision"])
        self.assertIsNone(score["proposal_localization_recall"])

    def test_hidden_source_and_sha_mismatch_fail_closed(self) -> None:
        self.manifest[0]["split"] = "TEST_HIDDEN"
        with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
            self.evaluate([])
        self.manifest[0]["split"] = "TRAIN_PUBLIC"
        self.artifact["sources"][0]["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "exactly one source"):
            self.evaluate([])

    def test_coordinate_ambiguity_and_proposal_derived_reviews_fail_closed(self) -> None:
        reviews = [self.review(1, "RADIATOR", []), self.review(2, "RADIATOR", [])]
        reviews[0]["coordinate_system"] = "PDF_USER_SPACE"
        with self.assertRaisesRegex(ValueError, "coordinate convention"):
            self.evaluate(reviews)
        reviews[0]["coordinate_system"] = "DISPLAY_POINT_TOP_LEFT"
        reviews[0]["page_display_size_pt"] = [100, 200]
        with self.assertRaisesRegex(ValueError, "display size"):
            self.evaluate(reviews)
        reviews[0]["page_display_size_pt"] = [200, 100]
        reviews[0]["proposal_ordinal"] = 0
        with self.assertRaisesRegex(ValueError, "proposal-derived"):
            self.evaluate(reviews)

    def test_proposal_cap_and_unscanned_page_are_not_scored(self) -> None:
        self.source["proposalLimitReached"] = True
        self.source["unretainedProposalCount"] = 2
        limited = self.evaluate([])
        self.assertEqual(limited["status"], "NOT_ESTIMABLE")
        self.assertEqual(limited["reason_code"], "PROPOSAL_LIMIT_REACHED")
        self.source["proposalLimitReached"] = False
        self.source["unretainedProposalCount"] = 0
        with self.assertRaisesRegex(ValueError, "was not scanned"):
            self.evaluate([], pages=[3])

    def test_profile_scope_and_proposal_status_must_match(self) -> None:
        self.artifact["profile"]["coordinateSystem"] = "PDF_USER_SPACE"
        with self.assertRaisesRegex(ValueError, "coordinate convention"):
            self.evaluate([])
        self.artifact["profile"]["coordinateSystem"] = "NORMALIZED_TOP_LEFT"
        self.source["scannedPageNumbers"] = [1]
        with self.assertRaisesRegex(ValueError, "scannedPageNumbers"):
            self.evaluate([])
        self.source["scannedPageNumbers"] = [1, 2]
        self.source["proposals"][0]["status"] = "RADIATOR"
        with self.assertRaisesRegex(ValueError, "status"):
            self.evaluate([])

    def test_v4_context_is_recomputed_from_original_pdf_and_legacy_rejects_it(self) -> None:
        with fitz.open(self.pdf) as document:
            context = EVALUATOR["original_document_context"](document)
        self.artifact["schemaVersion"] = "visual-proposal-analysis-v4"
        self.artifact["profile"].update({
            "schemaVersion": "visual-proposal-profile-v4",
            "contextMethodId": "first-two-pdf-cover-text-pages-v1",
            "maxContextPages": 2,
        })
        self.source["documentContext"] = context
        result = self.evaluate([])
        self.assertEqual(result["status"], "NOT_ESTIMABLE")
        self.assertEqual(result["visual_analysis_schema"], "visual-proposal-analysis-v4")
        self.source["documentContext"]["inspectedPages"][0]["textSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "differs from original PDF"):
            self.evaluate([])
        self.artifact["schemaVersion"] = "visual-proposal-analysis-v3"
        self.artifact["profile"] = {
            "schemaVersion": "visual-proposal-profile-v3",
            "methodId": "red-vector-panel-blue-contact-v1",
            "maxPagesPerSource": 1024,
            "maxProposalsPerSource": 500,
            "coordinateSystem": "NORMALIZED_TOP_LEFT",
        }
        with self.assertRaisesRegex(ValueError, "legacy visual artifact"):
            self.evaluate([])

    def test_v5_v6_observations_are_checked_against_original_crops_without_recognition_metrics(self) -> None:
        self.artifact["schemaVersion"] = "visual-proposal-analysis-v5"
        self.artifact["profile"].update({
            "schemaVersion": "visual-proposal-profile-v5",
            "contextMethodId": "first-two-pdf-cover-text-pages-v1",
            "maxContextPages": 2,
            "vlmMethodId": "spread-two-saved-proposals-v1",
            "vlmModelId": EVALUATOR["VLM_MODEL_ID"],
            "vlmModelWeightsSha256": EVALUATOR["VLM_WEIGHTS_SHA256"],
            "vlmModelProjectorSha256": EVALUATOR["VLM_PROJECTOR_SHA256"],
            "vlmPromptSha256": EVALUATOR["VLM_PROMPT_SHA256"],
            "maxVlmObservationsPerSource": 2,
            "vlmCropMaxEdgePx": 768,
        })
        with fitz.open(self.pdf) as document:
            self.source["documentContext"] = EVALUATOR["original_document_context"](document)
            observations = []
            for ordinal in [0, 2]:
                proposal = self.source["proposals"][ordinal]
                crop = EVALUATOR["original_vlm_crop"](document, proposal)
                observations.append({
                    "proposalOrdinal": ordinal,
                    "sourceSha256": self.sha,
                    "pageNumber": proposal["pageNumber"],
                    "bboxNormalized": proposal["bboxNormalized"],
                    "cropSha256": hashlib.sha256(crop).hexdigest(),
                    "modelId": EVALUATOR["VLM_MODEL_ID"],
                    "modelWeightsSha256": EVALUATOR["VLM_WEIGHTS_SHA256"],
                    "modelProjectorSha256": EVALUATOR["VLM_PROJECTOR_SHA256"],
                    "promptSha256": EVALUATOR["VLM_PROMPT_SHA256"],
                    "decision": "ABSTAIN",
                    "reasonCode": "MODEL_ABSTAIN",
                    "responseSha256": "a" * 64,
                })
        self.source["vlm"] = {
            "schemaVersion": "visual-vlm-observations-v1",
            "methodId": "spread-two-saved-proposals-v1",
            "eligibleProposalCount": 3,
            "selectedOrdinals": [0, 2],
            "omittedProposalCount": 1,
            "observations": observations,
        }
        result = self.evaluate([])
        self.assertEqual(result["status"], "NOT_ESTIMABLE")
        self.assertIsNone(result["recognition_metrics"])
        self.assertEqual(result["vlm_decisions_not_recognition_metrics"], {
            "RADIATOR_HINT": 0, "OTHER_HINT": 0, "ABSTAIN": 2,
        })
        observations[0]["cropSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "VLM crop differs"):
            self.evaluate([])
        with fitz.open(self.pdf) as document:
            observations[0]["cropSha256"] = hashlib.sha256(EVALUATOR["original_vlm_crop"](
                document, self.source["proposals"][0])).hexdigest()
        observations[0]["modelWeightsSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "VLM observation provenance"):
            self.evaluate([])
        for observation in observations:
            observation.pop("modelWeightsSha256")
            observation.pop("modelProjectorSha256")
            observation["modelId"] = EVALUATOR["SERVER_VLM_MODEL_ID"]
            observation["modelRevision"] = EVALUATOR["SERVER_VLM_REVISION"]
            observation["modelLockSha256"] = EVALUATOR["SERVER_VLM_LOCK_SHA256"]
        observations[0]["reasonCode"] = "MODEL_OTHER_UNTRUSTED"
        self.source["vlm"]["methodId"] = "spread-two-saved-proposals-server-nonnegative-v1"
        self.artifact["schemaVersion"] = "visual-proposal-analysis-v6"
        profile = self.artifact["profile"]
        profile["schemaVersion"] = "visual-proposal-profile-v6"
        profile["vlmMethodId"] = "spread-two-saved-proposals-server-nonnegative-v1"
        profile["vlmModelId"] = EVALUATOR["SERVER_VLM_MODEL_ID"]
        profile.pop("vlmModelWeightsSha256")
        profile.pop("vlmModelProjectorSha256")
        profile["vlmModelRevision"] = EVALUATOR["SERVER_VLM_REVISION"]
        profile["vlmModelLockSha256"] = EVALUATOR["SERVER_VLM_LOCK_SHA256"]
        profile["vlmModelShards"] = EVALUATOR["SERVER_VLM_SHARDS"]
        result = self.evaluate([])
        self.assertEqual(result["status"], "NOT_ESTIMABLE")
        self.assertEqual(result["vlm_decisions_not_recognition_metrics"]["ABSTAIN"], 2)
        observations[0]["decision"] = "OTHER_HINT"
        with self.assertRaisesRegex(ValueError, "VLM observation provenance|VLM negative response"):
            self.evaluate([])

    def test_v2_sampled_pages_are_not_treated_as_full_pdf(self) -> None:
        with fitz.open() as document:
            for _ in range(70):
                document.new_page(width=200, height=100)
            document.save(self.pdf, incremental=False)
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.manifest[0].update({"sha256": self.sha, "size_bytes": self.pdf.stat().st_size,
                                 "pdf_pages": 70})
        sampled = list(range(1, 9)) + [
            9 + ((2 * index + 1) * 54) // 96 for index in range(48)
        ] + list(range(63, 71))
        self.artifact["schemaVersion"] = "visual-proposal-analysis-v2"
        self.artifact["profile"].update({"schemaVersion": "visual-proposal-profile-v2",
                                          "maxPagesPerSource": 64})
        self.source.update({
            "sourceSha256": self.sha, "pageCount": 70, "scannedPageCount": 64,
            "status": "PARTIALLY_SCANNED_PAGE_LIMIT", "scannedPageNumbers": sampled,
            "skippedPageCount": 6, "proposals": [],
        })
        unscanned = next(page for page in range(1, 71) if page not in sampled)
        with self.assertRaisesRegex(ValueError, "was not scanned"):
            self.evaluate([], pages=[unscanned])
        result = self.evaluate([], pages=[1])
        self.assertEqual(result["status"], "NOT_ESTIMABLE")
        self.assertEqual(result["skipped_page_count"], 6)

    def test_cardinality_matching_avoids_greedy_miss(self) -> None:
        pairs = EVALUATOR["matches"](
            [(1, 0, 11, 10), (0, 0, 8, 10)],
            [(0, 0, 10, 10), (4, 0, 14, 10)], .5,
        )
        self.assertEqual(pairs, [(0, 1), (1, 0)])

    def test_cli_exits_two_and_writes_not_estimable_report_without_labels(self) -> None:
        manifest = self.root / "manifest.jsonl"
        artifact = self.root / "artifact.json"
        reviews = self.root / "reviews.jsonl"
        output = self.root / "report.json"
        manifest.write_text(json.dumps(self.manifest[0]) + "\n", encoding="utf-8")
        artifact.write_text(json.dumps(self.artifact), encoding="utf-8")
        reviews.write_text("", encoding="utf-8")
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--manifest", str(manifest),
            "--visual-artifact", str(artifact), "--source-pdf", str(self.pdf),
            "--file-id", "F0001", "--reviews", str(reviews),
            "--page", "1", "--class", "RADIATOR", "--output", str(output),
        ], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(json.loads(output.read_text())["status"], "NOT_ESTIMABLE")


if __name__ == "__main__":
    unittest.main()
