"""Independent opt-in release gate for equipment specification navigation."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    EQUIPMENT_SPEC_REVIEW_PROFILE, PilotPz002RuleAdapter,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)


RULE = {"ruleId": "pilot-equipment-spec-review", "version": "1",
        "extractionProfile": "equipment-spec-text-navigation-v1", "codeCount": 3,
        "disposition": "REVIEW_AID_ONLY"}
CODES = ("IOS4-077", "IOS4-079", "PPM-112")


def lease_for(profile: str = EQUIPMENT_SPEC_REVIEW_PROFILE) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["equipmentSpecReview"] = copy.deepcopy(RULE)
    return tep_lease_for(profile=profile, definitions=definitions)


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "equipment-spec-run-review-v1",
            "profileId": "equipment-spec-text-navigation-v1",
            "purpose": "REVIEW_ONLY", "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN", "leads": []}
                         for code in CODES],
            "findingCount": None, "parameterCoverage": None}


class EquipmentSpecAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_equipment_spec_review",
                   return_value=output() if review is None else review) as equipment, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("equipment spec profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, equipment

    def test_opt_in_emits_three_abstain_rows_as_third_output(self) -> None:
        lease = lease_for()
        result, equipment = self.execute(lease)
        self.assertEqual(result["providerProfileId"], EQUIPMENT_SPEC_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["equipmentSpecReview"], output())
        self.assertNotIn("siteGpTableRowReview", result)
        equipment.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_definition_hash_and_old_profiles_are_isolated(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["equipmentSpecReview"]["codeCount"] = 2
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        bad_hash = lease_for()
        bad_hash["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad_hash)
        definitions = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        definitions.pop("equipmentSpecReview")
        old = tep_lease_for(profile="typed-pz002-pz017-v1", definitions=definitions)
        result, equipment = self.execute(old)
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("equipmentSpecReview", result)
        equipment.assert_not_called()

    def test_asserted_facts_or_non_abstain_are_rejected(self) -> None:
        valid = output()
        valid["codeRows"][0]["leads"] = [{"leadKind": "SCHEDULE_TOKEN",
                                             "rowAssociationStatus": "UNVERIFIED",
                                             "systemAssignmentStatus": "UNVERIFIED"}]
        result, _ = self.execute(lease_for(), valid)
        self.assertEqual(result["equipmentSpecReview"], valid)
        for change in ({"inputManifestHash": "a" * 64},
                       {"findingCount": 0}, {"purpose": "FACT"},
                       {"codeRows": []}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**valid, **change})
        lead = valid["codeRows"][0]["leads"][0]
        for change in ({"rowAssociationStatus": "VERIFIED"},
                       {"systemAssignmentStatus": "VERIFIED"},
                       {"rawValue": "2.5"}, {"quantity": 1}):
            with self.subTest(change=change):
                wrong = copy.deepcopy(valid)
                wrong["codeRows"][0]["leads"] = [{**lead, **change}]
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), wrong)
        wrong = copy.deepcopy(valid)
        wrong["codeRows"][0]["status"] = "CANDIDATE"
        with self.assertRaisesRegex(ValueError, "review-only output"):
            self.execute(lease_for(), wrong)


if __name__ == "__main__":
    unittest.main()
