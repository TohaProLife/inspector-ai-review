"""Opt-in v3 release must call the v3 extractor and reject cross-version data."""

from __future__ import annotations

import copy
import unittest

from inspector_worker.durable_ocr_layout import PROFILE_HASH_V5, PROFILE_ID_V5
from inspector_worker.ocr_table_rows import PROFILE_ID_V3, SCHEMA_VERSION_V3
from inspector_worker.pilot_rule_adapter import OCR_TABLE_ROWS_PROFILE_V3
from test_pilot_rule_adapter_ocr_table import STAGE_SHA, definitions, lease_for
from test_pilot_rule_adapter_ocr_table_v2 import OcrTableV2ReleaseTests


class OcrTableV3ReleaseTests(unittest.TestCase):
    def _lease(self) -> dict:
        defs = copy.deepcopy(definitions())
        defs["ocrTableRows"].update(version="3", extractionProfile=PROFILE_ID_V3)
        return lease_for(defs, profile=OCR_TABLE_ROWS_PROFILE_V3,
                         ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)

    def test_v3_selects_separate_extraction_profile(self) -> None:
        result, extract, stage = OcrTableV2ReleaseTests()._execute(
            self._lease(), row_profile=PROFILE_ID_V3, row_schema=SCHEMA_VERSION_V3)
        self.assertEqual(result["providerProfileId"], OCR_TABLE_ROWS_PROFILE_V3)
        self.assertEqual(result["outputCount"], 8)
        self.assertEqual(result["ocrTableRows"]["findingCount"], 0)
        extract.assert_called_once_with(stage, stage_sha256=STAGE_SHA,
                                        profile_id=PROFILE_ID_V3)

    def test_v3_rejects_older_definition_and_result(self) -> None:
        old = lease_for(definitions(), profile=OCR_TABLE_ROWS_PROFILE_V3,
                        ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)
        with self.assertRaisesRegex(ValueError, "OCR table rows release rule definition"):
            OcrTableV2ReleaseTests()._execute(old, row_profile=PROFILE_ID_V3,
                                               row_schema=SCHEMA_VERSION_V3)
        with self.assertRaisesRegex(ValueError, "OCR table rows v3 extraction profile mismatch"):
            OcrTableV2ReleaseTests()._execute(self._lease(), row_profile="conservative-ocr-table-rows-v2",
                                               row_schema=SCHEMA_VERSION_V3)


if __name__ == "__main__":
    unittest.main()
