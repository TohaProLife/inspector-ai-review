"""Independent release gate for five GP context review rows."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, SITE_GP_CONTEXT_REVIEW_PROFILE,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)


RULE = {"ruleId": "pilot-site-gp-context-review", "version": "1",
        "extractionProfile": "site-gp-context-text-review-v1", "codeCount": 5,
        "disposition": "REVIEW_AID_ONLY"}
CODES = ("SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036")


def lease_for(profile: str = SITE_GP_CONTEXT_REVIEW_PROFILE) -> dict:
    old = tep_lease_for()
    definitions = copy.deepcopy(old["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["siteGpContextReview"] = copy.deepcopy(RULE)
    return tep_lease_for(profile=profile, definitions=definitions)


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "site-gp-context-run-review-v1",
            "profileId": "site-gp-context-text-review-v1", "purpose": "REVIEW_ONLY",
            "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN", "leads": []}
                         for code in CODES],
            "findingCount": None, "parameterCoverage": None}


class SiteGpContextAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_site_gp_context_run_review",
                   return_value=output() if review is None else review) as site, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("GP context profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, site

    def test_opt_in_emits_five_abstain_rows_as_third_output(self) -> None:
        lease = lease_for()
        result, site = self.execute(lease)
        self.assertEqual(result["providerProfileId"], SITE_GP_CONTEXT_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["siteGpContextReview"], output())
        self.assertNotIn("siteTepAreaReview", result)
        site.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_wrong_definition_legacy_profile_and_non_abstain_fail(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["siteGpContextReview"]["codeCount"] = 4
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        for change in ({"inputManifestHash": "a" * 64},
                       {"findingCount": 0},
                       {"codeRows": [{"parameterCode": "SPZU-029", "status": "ABSTAIN"}]},
                       {"purpose": "FACT"}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**output(), **change})


if __name__ == "__main__":
    unittest.main()
