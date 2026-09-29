"""Separate opt-in release gate for GP table block adjacency review."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, SITE_GP_TABLE_ROW_REVIEW_PROFILE,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)


RULE = {"ruleId": "pilot-site-gp-table-row-review", "version": "1",
        "extractionProfile": "site-gp-table-row-review-v1", "codeCount": 2,
        "disposition": "REVIEW_AID_ONLY"}
CODES = ("SPZU-029", "SPZU-032")


def lease_for(profile: str = SITE_GP_TABLE_ROW_REVIEW_PROFILE) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["siteGpTableRowReview"] = copy.deepcopy(RULE)
    return tep_lease_for(profile=profile, definitions=definitions)


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "site-gp-table-row-proposals-v1",
            "profileId": "site-gp-table-row-review-v1", "purpose": "REVIEW_ONLY",
            "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN", "proposals": []}
                         for code in CODES],
            "findingCount": None, "parameterCoverage": None}


class SiteGpTableRowAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_site_gp_table_row_proposals",
                   return_value=output() if review is None else review) as table, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("GP table profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, table

    def test_opt_in_emits_two_abstain_rows_as_third_output(self) -> None:
        lease = lease_for()
        result, table = self.execute(lease)
        self.assertEqual(result["providerProfileId"], SITE_GP_TABLE_ROW_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["siteGpTableRowReview"], output())
        self.assertNotIn("siteGpContextReview", result)
        table.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_legacy_and_bad_definition_fail_before_execution(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["siteGpTableRowReview"]["codeCount"] = 3
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        bad_hash = lease_for()
        bad_hash["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad_hash)

    def test_non_abstain_or_asserted_row_value_fails_closed(self) -> None:
        proposal = {"proposalKind": "MAF_POSITION_NAME_ADJACENCY",
                    "rowAssociationStatus": "UNVERIFIED",
                    "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED"],
                    "rawQuantity": None, "quantityStatus": "UNKNOWN"}
        valid = output()
        valid["codeRows"][0]["proposals"] = [proposal]
        result, _ = self.execute(lease_for(), valid)
        self.assertEqual(result["siteGpTableRowReview"], valid)
        for change in ({"inputManifestHash": "b" * 64}, {"findingCount": 0},
                       {"purpose": "FACT"}, {"codeRows": []}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**valid, **change})
        for changed_proposal in (
            {**proposal, "rowAssociationStatus": "VERIFIED"},
            {**proposal, "rawQuantity": 0},
            {**proposal, "quantityStatus": "ZERO"},
            {**proposal, "rawValue": "1"},
            {**proposal, "reasonCodes": []},
        ):
            with self.subTest(proposal=changed_proposal):
                bad = copy.deepcopy(valid)
                bad["codeRows"][0]["proposals"] = [changed_proposal]
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), bad)

    def test_old_profile_without_new_sidecar_keeps_two_outputs(self) -> None:
        definitions = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        definitions.pop("siteGpTableRowReview")
        lease = tep_lease_for(profile="typed-pz002-pz017-v1", definitions=definitions)
        result, table = self.execute(lease)
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("siteGpTableRowReview", result)
        table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
