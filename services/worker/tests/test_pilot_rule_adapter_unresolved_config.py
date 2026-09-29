"""An independent opt-in profile exposes only pinned unresolved navigation."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, UNRESOLVED_CONFIG_REVIEW_PROFILE,
)
from inspector_worker.unresolved_config_review import CODES, CONFIG_SHA256
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)


RULE = {"ruleId": "pilot-unresolved-config-review", "version": "1",
        "extractionProfile": "unresolved-review-config-v1",
        "configSha256": CONFIG_SHA256, "codeCount": 19,
        "disposition": "REVIEW_AID_ONLY"}


def lease_for(profile: str = UNRESOLVED_CONFIG_REVIEW_PROFILE) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["unresolvedConfigReview"] = copy.deepcopy(RULE)
    return tep_lease_for(profile=profile, definitions=definitions)


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "unresolved-config-run-review-v1",
            "profileId": "unresolved-review-config-v1", "purpose": "REVIEW_ONLY",
            "configSha256": CONFIG_SHA256, "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN", "leads": []}
                         for code in CODES],
            "findingCount": None, "parameterCoverage": None}


class UnresolvedConfigAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_config_review",
                   return_value=output() if review is None else review) as unresolved, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("config profile has no OCR dependency")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, unresolved

    def test_opt_in_has_nineteen_abstain_rows_as_third_output(self) -> None:
        lease = lease_for()
        result, unresolved = self.execute(lease)
        self.assertEqual(result["providerProfileId"], UNRESOLVED_CONFIG_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["unresolvedConfigReview"], output())
        self.assertNotIn("siteTepAreaReview", result)
        unresolved.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_definition_hash_old_profile_and_unsafe_output_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["unresolvedConfigReview"]["codeCount"] = 18
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        bad = lease_for()
        bad["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad)
        definitions = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        definitions.pop("unresolvedConfigReview")
        old = tep_lease_for(profile="typed-pz002-pz017-v1", definitions=definitions)
        result, unresolved = self.execute(old)
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("unresolvedConfigReview", result)
        unresolved.assert_not_called()
        for change in ({"inputManifestHash": "a" * 64}, {"findingCount": 0},
                       {"parameterCoverage": 0}, {"purpose": "FACT"},
                       {"codeRows": []}, {"configSha256": "0" * 64}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**output(), **change})
        wrong = output()
        wrong["codeRows"][4]["status"] = "CANDIDATE"
        with self.assertRaisesRegex(ValueError, "review-only output"):
            self.execute(lease_for(), wrong)
        for lead_change in ({"elementAssociationStatus": "VERIFIED"},
                            {"value": 1}, {"rawValue": "1"}, {"elementId": "E-1"}):
            with self.subTest(lead_change=lead_change):
                wrong = output()
                wrong["codeRows"][4]["leads"] = [{"locatorType": "TEXT_LINE_BBOX_ONLY",
                                                    "elementAssociationStatus": "UNVERIFIED",
                                                    **lead_change}]
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), wrong)


if __name__ == "__main__":
    unittest.main()
