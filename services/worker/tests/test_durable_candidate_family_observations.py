from __future__ import annotations

from copy import deepcopy
import unittest
from unittest.mock import patch

from inspector_worker.durable_candidate_family_observations import (
    _MAX_COMBINED_BYTES,
    _combined_size,
    _drop_last_leads,
    _fit_combined_budget,
    execute_durable_candidate_family_observations,
)
from inspector_worker.run_candidate_family_preview import (
    _hash,
    evaluate_run_candidate_family_preview,
)
from services.worker.tests.test_run_candidate_family_preview import (
    MANIFEST, OBJECT, artifact, candidate_line, source,
)


class DurableCandidateFamilyObservationsTests(unittest.TestCase):
    def test_one_fenced_input_load_yields_preview_and_review_only_observation(self) -> None:
        selected = source("PZ-002", "PZ")
        text = artifact(selected, [candidate_line("PZ-002")])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1", "fencingToken": 1}
        with patch("inspector_worker.durable_candidate_family_observations."
                   "load_durable_candidate_family_inputs",
                   return_value=([selected], [text])) as load:
            result = execute_durable_candidate_family_observations(lease, attempt)
        load.assert_called_once_with(lease, attempt)
        preview = result["candidateFamilyPreview"]
        observations = result["candidateFamilyObservations"]
        review_candidates = result["reviewCandidates"]
        self.assertEqual(len(preview["codeRows"]), 47)
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in preview["codeRows"]))
        self.assertEqual(observations["schemaVersion"], "candidate-family-observations-v1")
        self.assertEqual(observations["outputCount"], 1)
        self.assertEqual(observations["observations"][0]["parameterCode"], "PZ-002")
        self.assertEqual(observations["observations"][0]["status"], "REVIEW_ONLY")
        self.assertIsNone(observations["findingCount"])
        self.assertIsNone(observations["parameterCoverage"])
        self.assertEqual(review_candidates["resultType"], "REVIEW_CANDIDATE")
        self.assertEqual(review_candidates["candidateCount"], 1)
        self.assertEqual(review_candidates["candidates"][0]["parameterCode"], "PZ-002")
        self.assertLessEqual(_combined_size(preview, observations), _MAX_COMBINED_BYTES)

    def test_dense_preview_trims_latest_leads_deterministically(self) -> None:
        preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [], [])
        for row in preview["codeRows"]:
            row["candidateLeads"] = [{"leadSha256": f'{row["parameterCode"]}-{index}'}
                                     for index in range(16)]
            row["leadCount"] = 16
            row["reasonCodes"] = ["FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED"]
        preview["contentHash"] = _hash({key: value for key, value in preview.items()
                                         if key != "contentHash"})
        original = deepcopy(preview)

        def observations_for(candidate: dict, _sources: list, _artifacts: list) -> dict:
            observations = [{"leadSha256": lead["leadSha256"], "rawText": "x" * 3500}
                            for row in candidate["codeRows"] for lead in row["candidateLeads"]]
            return {"schemaVersion": "candidate-family-observations-v1",
                    "codeRows": [{"parameterCode": row["parameterCode"],
                                  "reasonCodes": row["reasonCodes"]}
                                 for row in candidate["codeRows"]],
                    "observations": observations, "outputCount": len(observations),
                    "findingCount": None, "parameterCoverage": None,
                    "contentHash": _hash(observations)}

        with patch("inspector_worker.durable_candidate_family_observations."
                   "extract_candidate_family_observations", side_effect=observations_for):
            fitted_preview, fitted_observations = _fit_combined_budget(preview, [], [])
            second_preview, second_observations = _fit_combined_budget(preview, [], [])
            removed = 47 * 16 - fitted_observations["outputCount"]
            self.assertGreater(removed, 0)
            self.assertLessEqual(_combined_size(fitted_preview, fitted_observations),
                                 _MAX_COMBINED_BYTES)
            self.assertGreater(_combined_size(
                _drop_last_leads(preview, removed - 1),
                observations_for(_drop_last_leads(preview, removed - 1), [], [])),
                _MAX_COMBINED_BYTES)
        self.assertEqual(preview, original)
        self.assertEqual(fitted_preview, second_preview)
        self.assertEqual(fitted_observations, second_observations)
        self.assertEqual(fitted_preview["contentHash"], _hash({
            key: value for key, value in fitted_preview.items() if key != "contentHash"}))
        self.assertTrue(any("PREVIEW_BYTE_BUDGET_REACHED" in row["reasonCodes"]
                            for row in fitted_preview["codeRows"]))
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in fitted_preview["codeRows"]))

    def test_metadata_over_budget_fails_closed_with_no_leads(self) -> None:
        preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [], [])
        oversized = {"observations": [], "rawText": "x" * _MAX_COMBINED_BYTES}
        with patch("inspector_worker.durable_candidate_family_observations."
                   "extract_candidate_family_observations", return_value=oversized):
            with self.assertRaisesRegex(ValueError, "metadata exceeds 2 MiB budget"):
                _fit_combined_budget(preview, [], [])


if __name__ == "__main__":
    unittest.main()
