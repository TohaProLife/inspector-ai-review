"""Independent opt-in release gate for the three site TEP review leads."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, SITE_TEP_AREA_REVIEW_PROFILE,
)
from services.worker.tests.test_pilot_rule_adapter import DEFINITIONS


MANIFEST = "f" * 64
RULE = {"ruleId": "pilot-site-tep-area-review", "version": "1",
        "extractionProfile": "site-tep-area-text-review-v1", "codeCount": 3,
        "disposition": "REVIEW_AID_ONLY"}


def lease_for(profile: str = SITE_TEP_AREA_REVIEW_PROFILE,
              definitions: dict | None = None) -> dict:
    definitions = definitions or {**DEFINITIONS,
                                  "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                                           "parameterCode": "PZ-017",
                                           "extractionProfile": "pz-017-heat-components-v1"},
                                  "siteTepAreaReview": copy.deepcopy(RULE)}
    config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False,
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"objectId": "OBJ-TEST", "inputManifestHash": MANIFEST,
            "inputs": {"sourceFiles": [], "sourceDecisions": {}},
            "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                        "definitions": definitions},
                        "providerSlot": {"stageJobType": "RULE_EVALUATION",
                                         "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                                         "profileId": profile, "configHash": config_hash}}}


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "site-tep-area-run-review-v1",
            "profileId": "site-tep-area-text-review-v1", "purpose": "REVIEW_ONLY",
            "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN", "leads": []}
                         for code in ("PZ-001", "SPZU-026", "SPZU-027")],
            "findingCount": None, "parameterCoverage": None}


class SiteTepAreaAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_site_tep_area_run_review",
                   return_value=output() if review is None else review) as site, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("site TEP profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, site

    def test_opt_in_emits_third_review_aid_without_ocr(self) -> None:
        lease = lease_for()
        result, site = self.execute(lease)
        self.assertEqual(result["providerProfileId"], SITE_TEP_AREA_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["siteTepAreaReview"], output())
        site.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_definition_old_release_and_output_fail_closed(self) -> None:
        old = lease_for(profile="typed-pz002-pz017-v1")
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(old)
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["siteTepAreaReview"]["codeCount"] = 4
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        for change in ({"inputManifestHash": "a" * 64},
                       {"findingCount": 0},
                       {"codeRows": [{"parameterCode": "PZ-001", "status": "ABSTAIN"}]},
                       {"purpose": "FACT"}):
            with self.subTest(change=change):
                invalid = {**output(), **change}
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), invalid)

    def test_old_base_profile_without_sidecar_stays_two_outputs(self) -> None:
        defs = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        defs.pop("siteTepAreaReview")
        result, site = self.execute(lease_for(profile="typed-pz002-pz017-v1",
                                              definitions=defs))
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("siteTepAreaReview", result)
        site.assert_not_called()


if __name__ == "__main__":
    unittest.main()
