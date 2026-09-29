"""Release-gated OCR v6 review sidecar; no legacy OCR consumers."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.durable_ocr_layout import PROFILE_HASH_V6, PROFILE_ID_V6
from inspector_worker.pilot_rule_adapter import (
    PilotPz002RuleAdapter, UNRESOLVED_OCR_REVIEW_PROFILE,
)
from inspector_worker.run_candidate_family_preview import _hash
from test_unresolved_family_ocr_review import OBJECT, MANIFEST, fixture


RULES = Path(__file__).resolve().parents[1] / "rules"
BASE_DEFINITIONS = {
    "navigation": json.loads((RULES / "pilot-pz-002-navigation-v1.json").read_text(encoding="utf-8")),
    "numeric": json.loads((RULES / "pilot-pz-002-numeric-v1.json").read_text(encoding="utf-8")),
    "heat": {"ruleId": "pilot-pz-017-heat", "version": "1", "parameterCode": "PZ-017",
             "extractionProfile": "pz-017-heat-components-v1"},
    "unresolvedFamilyOcrReview": {
        "ruleId": "pilot-unresolved-family-ocr-review", "version": "1",
        "extractionProfile": "unresolved-family-ocr-review-v1",
        "codeCount": 3, "disposition": "REVIEW_AID_ONLY",
    },
}


def lease_for(sources: list[dict], decisions: dict) -> dict:
    definitions = copy.deepcopy(BASE_DEFINITIONS)
    config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode("utf-8")).hexdigest()
    return {
        "objectId": OBJECT, "inputManifestHash": MANIFEST, "jobType": "RULE_EVALUATION",
        "inputs": {"sourceFiles": sources, "sourceDecisions": decisions},
        "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                    "definitions": definitions},
                    "providerSlot": {"stageJobType": "RULE_EVALUATION",
                                     "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                                     "profileId": UNRESOLVED_OCR_REVIEW_PROFILE,
                                     "configHash": config_hash},
                    "ocrLayoutSlot": {"profileId": PROFILE_ID_V6,
                                      "configHash": PROFILE_HASH_V6}},
    }


class PilotOcrV6ReviewTests(unittest.TestCase):
    def execute_fixture(self, *, unreviewed: bool = False, stale_stage: bool = False) -> dict:
        sources, decisions, texts, stage = fixture(unreviewed=unreviewed)
        lease = lease_for(sources, decisions)
        stage_hash = _hash(stage)
        if stale_stage:
            stage["analysis"]["sources"][0]["status"] = "SCANNED_WRONG"
        text_by_source = {item["sourceFileId"]: item for item in texts}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                      return_value={"selectedManifestHash": MANIFEST}), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value={"content_json": stage, "content_hash": stage_hash,
                                    "provider_profile_id": PROFILE_ID_V6,
                                    "provider_config_hash": PROFILE_HASH_V6}), \
                patch("inspector_worker.pilot_rule_adapter.download_text_artifact",
                      side_effect=lambda _lease, source, _attempt:
                          text_by_source[source["sourceFileId"]]) as download_text, \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      side_effect=AssertionError("legacy OCR heat consumer ran")), \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_table_rows",
                      side_effect=AssertionError("legacy OCR table consumer ran")), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                      side_effect=AssertionError("legacy fact consumer ran")), \
                patch("inspector_worker.pilot_rule_adapter."
                      "execute_durable_candidate_family_ocr_observations",
                      side_effect=AssertionError("legacy candidate consumer ran")):
            if stale_stage:
                with self.assertRaisesRegex(ValueError, "stage SHA mismatch"):
                    PilotPz002RuleAdapter().execute(lease, {})
                return {}
            result = PilotPz002RuleAdapter().execute(lease, {})
        self.assertEqual(download_text.call_count, 2)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(set(result), {
            "schemaVersion", "jobType", "inputManifestHash", "disposition",
            "providerKind", "providerProfileId", "providerConfigHash", "outputCount",
            "analysis", "heatLoad", "unresolvedFamilyOcrReview",
        })
        self.assertEqual(result["unresolvedFamilyOcrReview"]["ocrStageSha256"], stage_hash)
        self.assertIsNone(result["unresolvedFamilyOcrReview"]["findingCount"])
        self.assertIsNone(result["unresolvedFamilyOcrReview"]["parameterCoverage"])
        return result

    def test_reviewed_synthetic_lines_are_abstaining_leads(self) -> None:
        result = self.execute_fixture()
        rows = result["unresolvedFamilyOcrReview"]["codeRows"]
        self.assertEqual([row["parameterCode"] for row in rows],
                         ["AR-042", "IOS2-072", "IOS3-075"])
        self.assertEqual([len(row["leads"]) for row in rows], [1, 1, 1])
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in rows))

    def test_unreviewed_source_stays_deferred(self) -> None:
        result = self.execute_fixture(unreviewed=True)
        rows = result["unresolvedFamilyOcrReview"]["codeRows"]
        self.assertEqual([len(row["leads"]) for row in rows], [0, 1, 1])
        self.assertIn("SOURCE_REVIEW_REQUIRED", rows[0]["reasonCodes"])

    def test_stale_stage_fails_closed(self) -> None:
        self.execute_fixture(stale_stage=True)

    def test_rule_definition_hash_and_v6_release_are_required(self) -> None:
        sources, decisions, _, _ = fixture()
        lease = lease_for(sources, decisions)
        lease["release"]["rules"]["definitions"]["unresolvedFamilyOcrReview"]["codeCount"] = 2
        with self.assertRaisesRegex(ValueError, "unresolved family OCR release rule definition"):
            PilotPz002RuleAdapter().execute(lease, {})
        lease = lease_for(sources, decisions)
        lease["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            PilotPz002RuleAdapter().execute(lease, {})
        lease = lease_for(sources, decisions)
        lease["release"]["ocrLayoutSlot"]["configHash"] = "0" * 64
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                      return_value={"selectedManifestHash": MANIFEST}):
            with self.assertRaisesRegex(ValueError, "immutable OCR v6 release selection"):
                PilotPz002RuleAdapter().execute(lease, {})


if __name__ == "__main__":
    unittest.main()
