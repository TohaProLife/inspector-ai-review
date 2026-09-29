from __future__ import annotations

import unittest
from unittest.mock import patch

from inspector_worker.durable_candidate_family_ocr_observations import (
    execute_durable_candidate_family_ocr_observations,
)


class DurableCandidateFamilyOcrObservationsTests(unittest.TestCase):
    def test_single_fenced_text_snapshot_is_reused_for_all_review_aids(self) -> None:
        manifest = "f" * 64
        lease = {"objectId": "OBJ-1", "inputManifestHash": manifest}
        attempt = {"attemptId": "ATT-1", "fencingToken": 1}
        sources, artifacts, stage = [{"sourceFileId": "FIL-1"}], [{"content": "text"}], {"analysis": {}}
        preview = {"inputManifestHash": manifest}
        observations = {"inputManifestHash": manifest, "findingCount": None,
                        "parameterCoverage": None}
        ocr = {"inputManifestHash": manifest, "findingCount": None,
               "parameterCoverage": None, "codeRows": [{"status": "ABSTAIN"}]}
        candidates = {"inputManifestHash": manifest, "candidateCount": 0}
        with patch("inspector_worker.durable_candidate_family_ocr_observations."
                   "load_durable_candidate_family_inputs",
                   return_value=(sources, artifacts)) as load, \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "evaluate_run_candidate_family_preview", return_value=preview) as evaluate, \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "_fit_combined_budget", return_value=(preview, observations)) as fit, \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "evaluate_run_candidate_family_ocr_observations", return_value=ocr) as evaluate_ocr, \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "evaluate_review_candidates", return_value=candidates) as evaluate_review:
            result = execute_durable_candidate_family_ocr_observations(lease, attempt, stage)
        load.assert_called_once_with(lease, attempt)
        evaluate.assert_called_once_with("OBJ-1", manifest, sources, artifacts)
        fit.assert_called_once_with(preview, sources, artifacts)
        evaluate_ocr.assert_called_once_with("OBJ-1", manifest, sources, artifacts, stage)
        evaluate_review.assert_called_once_with("OBJ-1", manifest, sources, artifacts)
        self.assertEqual(set(result), {"candidateFamilyPreview", "candidateFamilyObservations",
                                       "candidateFamilyOcrObservations", "reviewCandidates"})
        self.assertIs(result["candidateFamilyOcrObservations"], ocr)
        self.assertIs(result["reviewCandidates"], candidates)

    def test_mismatched_manifest_fails_closed(self) -> None:
        lease = {"objectId": "OBJ-1", "inputManifestHash": "f" * 64}
        with patch("inspector_worker.durable_candidate_family_ocr_observations."
                   "load_durable_candidate_family_inputs", return_value=([], [])), \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "evaluate_run_candidate_family_preview",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "_fit_combined_budget",
                      return_value=({"inputManifestHash": "f" * 64},
                                    {"inputManifestHash": "f" * 64})), \
                patch("inspector_worker.durable_candidate_family_ocr_observations."
                      "evaluate_run_candidate_family_ocr_observations",
                      return_value={"inputManifestHash": "0" * 64}):
            with self.assertRaisesRegex(ValueError, "manifest hash mismatch"):
                execute_durable_candidate_family_ocr_observations(lease, {}, {})


if __name__ == "__main__":
    unittest.main()
