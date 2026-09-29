"""The v2 OCR table-row review path is opt-in and keeps v1 immutable."""

from __future__ import annotations

from contextlib import ExitStack
import copy
import unittest
from unittest.mock import patch

from inspector_worker.durable_ocr_layout import PROFILE_HASH_V5, PROFILE_ID_V5
from inspector_worker.ocr_table_rows import PROFILE_ID_V2, SCHEMA_VERSION_V2
from inspector_worker.pilot_rule_adapter import (
    OCR_TABLE_ROWS_PROFILE, OCR_TABLE_ROWS_PROFILE_V2, PilotPz002RuleAdapter,
)
from test_pilot_rule_adapter_ocr_table import MANIFEST_SHA, STAGE_SHA, definitions, lease_for


class OcrTableV2ReleaseTests(unittest.TestCase):
    def _execute(self, lease: dict, *, row_manifest: str = MANIFEST_SHA,
                 row_profile: str = PROFILE_ID_V2,
                 row_schema: str = SCHEMA_VERSION_V2):
        stage = {"providerProfileId": PROFILE_ID_V5}
        review_aids = {key: {"inputManifestHash": MANIFEST_SHA}
                       for key in ("candidateFamilyPreview", "candidateFamilyObservations",
                                   "candidateFamilyOcrObservations", "reviewCandidates")}
        with ExitStack() as stack:
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                                      return_value={"selectedManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                                      return_value={"selectedManifestHash": MANIFEST_SHA}))
            stack.enter_context(patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                                      return_value={"content_json": stage,
                                                    "content_hash": STAGE_SHA}))
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
                              "schemaVersion": row_schema,
                              "profileId": row_profile, "findingCount": 0}))
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, extract, stage

    def test_v2_selects_separate_extraction_profile_without_findings(self) -> None:
        defs = definitions()
        defs["ocrTableRows"].update(version="2", extractionProfile=PROFILE_ID_V2)
        lease = lease_for(defs, profile=OCR_TABLE_ROWS_PROFILE_V2,
                          ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)
        result, extract, stage = self._execute(lease)
        self.assertEqual(result["providerProfileId"], OCR_TABLE_ROWS_PROFILE_V2)
        self.assertEqual(result["outputCount"], 8)
        self.assertEqual(result["ocrTableRows"]["findingCount"], 0)
        extract.assert_called_once_with(stage, stage_sha256=STAGE_SHA, profile_id=PROFILE_ID_V2)

    def test_v1_selection_stays_v1(self) -> None:
        lease = lease_for(definitions(), profile=OCR_TABLE_ROWS_PROFILE,
                          ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)
        result, extract, stage = self._execute(lease)
        self.assertEqual(result["providerProfileId"], OCR_TABLE_ROWS_PROFILE)
        extract.assert_called_once_with(stage, stage_sha256=STAGE_SHA)

    def test_v2_rejects_v1_definition_and_wrong_manifest(self) -> None:
        lease = lease_for(definitions(), profile=OCR_TABLE_ROWS_PROFILE_V2,
                          ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)
        with self.assertRaisesRegex(ValueError, "OCR table rows release rule definition"):
            self._execute(lease)
        defs = copy.deepcopy(definitions())
        defs["ocrTableRows"].update(version="2", extractionProfile=PROFILE_ID_V2)
        lease = lease_for(defs, profile=OCR_TABLE_ROWS_PROFILE_V2,
                          ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)
        with self.assertRaisesRegex(ValueError, "OCR table rows manifest hash mismatch"):
            self._execute(lease, row_manifest="e" * 64)
        with self.assertRaisesRegex(ValueError, "OCR table rows v2 extraction profile mismatch"):
            self._execute(lease, row_profile="conservative-ocr-table-rows-v1")


if __name__ == "__main__":
    unittest.main()
