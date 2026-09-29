"""Opt-in release gate for uncoded OCR table-row review observations."""

from __future__ import annotations

from contextlib import ExitStack
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.durable_ocr_layout import (PROFILE_HASH_V4, PROFILE_HASH_V5,
                                                  PROFILE_ID_V4, PROFILE_ID_V5)
from inspector_worker.fact_family_pack import load_fact_family_pack
from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.pilot_rule_adapter import (OCR_TABLE_ROWS_PROFILE,
                                                 PilotPz002RuleAdapter)
from inspector_worker.presence_family_candidates import load_presence_family_labels


RULES = Path(__file__).resolve().parents[1] / "rules"
MANIFEST_SHA = "f" * 64
STAGE_SHA = "a" * 64


def definitions() -> dict:
    fact = load_fact_family_pack()
    candidate = load_candidate_family_pack()
    numeric = load_numeric_family_labels()
    classes = load_class_family_labels()
    presence = load_presence_family_labels()
    policy = {"version": "1", "candidateRulePackSha256": candidate["packSha256"],
              "numericLabelPackSha256": numeric["labelPackSha256"],
              "classLabelPackSha256": classes["labelPackSha256"],
              "presenceLabelPackSha256": presence["labelPackSha256"],
              "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}
    return {
        "navigation": json.loads((RULES / "pilot-pz-002-navigation-v1.json").read_text()),
        "numeric": json.loads((RULES / "pilot-pz-002-numeric-v1.json").read_text()),
        "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                 "parameterCode": "PZ-017", "extractionProfile": "pz-017-heat-components-v1"},
        "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                        "parameterCode": "PZ-017", "extractionProfile": "conservative-ocr-heat-rows-v1",
                        "disposition": "REVIEW_AID_ONLY"},
        "factFamily": {"ruleId": "pilot-fact-family-review", "version": "1",
                       "extractionProfile": "fact-family-pilot-v1",
                       "packSha256": fact["packSha256"], "disposition": "REVIEW_AID_ONLY",
                       "rules": fact["rules"]},
        "candidateFamilyPreview": {**policy, "ruleId": "pilot-candidate-family-preview",
                                   "extractionProfile": "candidate-family-preview-v1"},
        "candidateFamilyObservations": {**policy, "ruleId": "pilot-candidate-family-observations",
                                        "extractionProfile": "candidate-family-observations-v1"},
        "candidateFamilyOcrObservations": {**policy,
                                           "ruleId": "pilot-candidate-family-ocr-observations",
                                           "extractionProfile": "candidate-family-ocr-observations-v1"},
        "ocrTableRows": {"ruleId": "pilot-ocr-table-rows-review", "version": "1",
                         "extractionProfile": "conservative-ocr-table-rows-v1",
                         "disposition": "REVIEW_AID_ONLY"},
    }


def lease_for(defs: dict, profile: str = OCR_TABLE_ROWS_PROFILE,
              ocr_profile: str = PROFILE_ID_V4, ocr_hash: str = PROFILE_HASH_V4) -> dict:
    config_hash = hashlib.sha256(json.dumps(defs, ensure_ascii=False,
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"inputManifestHash": MANIFEST_SHA,
            "inputs": {"sourceDecisions": {}, "sourceFiles": []},
            "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                        "definitions": defs},
                        "providerSlot": {"stageJobType": "RULE_EVALUATION",
                                         "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                                         "profileId": profile, "configHash": config_hash},
                        "ocrLayoutSlot": {"profileId": ocr_profile, "configHash": ocr_hash}}}


class OcrTableReleaseTests(unittest.TestCase):
    def _execute(self, lease: dict, stage: dict, *, stage_sha: str = STAGE_SHA,
                 row_manifest: str = MANIFEST_SHA) -> tuple[dict, object]:
        review_aids = {key: {"inputManifestHash": MANIFEST_SHA}
                       for key in ("candidateFamilyPreview", "candidateFamilyObservations",
                                   "candidateFamilyOcrObservations", "reviewCandidates")}
        with ExitStack() as stack:
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                                      return_value={"selectedManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                                      return_value={"selectedManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                                      return_value={"content_json": stage, "content_hash": stage_sha}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                                      return_value={"inputManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                                      return_value={"inputManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter."
                                      "execute_durable_candidate_family_ocr_observations",
                                      return_value=review_aids))
            extract = stack.enter_context(patch(
                "inspector_worker.pilot_rule_adapter.extract_ocr_table_rows",
                return_value={"inputManifestHash": row_manifest, "proposals": [],
                              "findingCount": 0}))
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, extract

    def test_v4_and_v5_release_emit_eighth_review_aid_from_committed_stage(self) -> None:
        for profile, config_hash in ((PROFILE_ID_V4, PROFILE_HASH_V4),
                                     (PROFILE_ID_V5, PROFILE_HASH_V5)):
            with self.subTest(profile=profile):
                lease = lease_for(definitions(), ocr_profile=profile, ocr_hash=config_hash)
                stage = {"providerProfileId": profile}
                result, extract = self._execute(lease, stage)
                self.assertEqual(result["providerProfileId"], OCR_TABLE_ROWS_PROFILE)
                self.assertEqual(result["outputCount"], 8)
                self.assertEqual(result["ocrTableRows"]["findingCount"], 0)
                extract.assert_called_once_with(stage, stage_sha256=STAGE_SHA)

    def test_rejects_v3_stale_slot_bad_sha_and_wrong_row_manifest(self) -> None:
        defs = definitions()
        lease = lease_for(defs)
        with self.assertRaisesRegex(ValueError, "bounded OCR v4/v5"):
            self._execute(lease, {"providerProfileId": "local-bounded-ocr-layout-v3"})
        bad_slot = copy.deepcopy(lease)
        bad_slot["release"]["ocrLayoutSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "bounded OCR v4/v5"):
            self._execute(bad_slot, {"providerProfileId": PROFILE_ID_V4})
        with self.assertRaisesRegex(ValueError, "committed stage SHA-256"):
            self._execute(lease, {"providerProfileId": PROFILE_ID_V4}, stage_sha="bad")
        with self.assertRaisesRegex(ValueError, "manifest hash mismatch"):
            self._execute(lease, {"providerProfileId": PROFILE_ID_V4}, row_manifest="e" * 64)

    def test_definition_is_opt_in_and_exact(self) -> None:
        defs = definitions()
        defs["ocrTableRows"]["disposition"] = "APPROVED"
        with self.assertRaisesRegex(ValueError, "OCR table rows release rule definition"):
            self._execute(lease_for(defs), {"providerProfileId": PROFILE_ID_V4})
        defs = definitions()
        old_profile = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
        with self.assertRaisesRegex(ValueError, "OCR table rows cannot run under an older release"):
            self._execute(lease_for(defs, profile=old_profile),
                          {"providerProfileId": PROFILE_ID_V4})


if __name__ == "__main__":
    unittest.main()
