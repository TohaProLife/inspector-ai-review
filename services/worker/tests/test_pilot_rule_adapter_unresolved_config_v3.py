"""The network review batch has its own immutable, abstaining release."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, UNRESOLVED_CONFIG_REVIEW_PROFILE_V3,
)
from inspector_worker.unresolved_config_review_v3 import (
    NETWORK_CODES, V3_CONFIG_SHA256,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)
from services.worker.tests.test_pilot_rule_adapter_unresolved_config_v2 import (
    lease_for as v2_lease_for, output as v2_output,
)


RULE = {"ruleId": "pilot-unresolved-config-review-v3", "version": "1",
        "extractionProfile": "unresolved-review-config-v3",
        "configSha256": V3_CONFIG_SHA256, "codeCount": 7,
        "disposition": "REVIEW_AID_ONLY"}


def lease_for(profile: str = UNRESOLVED_CONFIG_REVIEW_PROFILE_V3) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["unresolvedConfigReviewV3"] = copy.deepcopy(RULE)
    return tep_lease_for(profile=profile, definitions=definitions)


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "unresolved-config-run-review-v3",
            "profileId": "unresolved-review-config-v3", "purpose": "REVIEW_ONLY",
            "configSha256": V3_CONFIG_SHA256, "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN",
                          "absenceConclusion": "NOT_AVAILABLE", "leads": []}
                         for code in NETWORK_CODES],
            "findingCount": None, "parameterCoverage": None}


class UnresolvedConfigV3AdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_config_review_v3",
                   return_value=output() if review is None else review) as unresolved, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("config v3 has no OCR dependency")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, unresolved

    def test_v3_is_independent_three_output_release(self) -> None:
        lease = lease_for()
        result, unresolved = self.execute(lease)
        self.assertEqual(result["providerProfileId"], UNRESOLVED_CONFIG_REVIEW_PROFILE_V3)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["unresolvedConfigReviewV3"], output())
        self.assertNotIn("unresolvedConfigReviewV2", result)
        unresolved.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_definition_and_positive_claim_tampering_rejected(self) -> None:
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["unresolvedConfigReviewV3"]["codeCount"] = 19
        with self.assertRaisesRegex(ValueError, "v3 release rule definition"):
            self.execute(bad)
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad)
        for change in ({"findingCount": 0}, {"parameterCoverage": 0},
                       {"purpose": "FACT"}, {"configSha256": "0" * 64},
                       {"inputManifestHash": "a" * 64}, {"codeRows": []}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "v3 review-only output"):
                    self.execute(lease_for(), {**output(), **change})
        row = output()
        row["codeRows"][0]["absenceConclusion"] = "ABSENT"
        with self.assertRaisesRegex(ValueError, "v3 review-only output"):
            self.execute(lease_for(), row)
        for change in ({"elementAssociationStatus": "VERIFIED"},
                       {"rawValue": "10"}, {"value": 10}, {"finding": True}):
            with self.subTest(change=change):
                row = output()
                row["codeRows"][0]["leads"] = [{"locatorType": "TEXT_LINE_BBOX_ONLY",
                                                "elementAssociationStatus": "UNVERIFIED",
                                                **change}]
                with self.assertRaisesRegex(ValueError, "v3 review-only output"):
                    self.execute(lease_for(), row)

    def test_v2_profile_keeps_its_original_sidecar(self) -> None:
        lease = v2_lease_for()
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_config_review_v2",
                   return_value=v2_output()), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_config_review_v3",
                   side_effect=AssertionError("v3 must stay opt-in")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["unresolvedConfigReviewV2"], v2_output())
        self.assertNotIn("unresolvedConfigReviewV3", result)


if __name__ == "__main__":
    unittest.main()
