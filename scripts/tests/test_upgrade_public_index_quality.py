"""Quality upgrade must preserve old policy proof and flag CID placeholders."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
from inspector_worker.text_layer import qualify_page_text


MODULE_PATH = Path(__file__).resolve().parents[1] / "upgrade-public-index-quality.py"
SPEC = importlib.util.spec_from_file_location("quality_upgrade", MODULE_PATH)
assert SPEC and SPEC.loader
upgrade = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upgrade)


class PublicIndexQualityUpgradeTests(unittest.TestCase):
    def test_cid_page_becomes_ocr_required_without_rewriting_blocks(self) -> None:
        text = "Раздел 10. (cid:584)(cid:603)щ(cid:607)"
        old_quality = qualify_page_text([text], policy_version="text-layer-quality-v1")
        page = {"schemaVersion": "public-document-index-v1",
                "indexVersionHash": upgrade.PARENT_VERSION_HASH,
                "qualityPolicyVersion": "text-layer-quality-v1", "inputSha256": "a" * 64,
                "pageNumber": 1, "blocks": [{"text": text}], "quality": old_quality}
        upgraded = upgrade.upgrade_page(page, source_id="F0001",
                                        source_sha="a" * 64, page_number=1)
        self.assertEqual(upgraded["blocks"], page["blocks"])
        self.assertEqual(page["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
        self.assertEqual(upgraded["quality"]["disposition"], "OCR_REQUIRED")
        self.assertEqual(upgraded["quality"]["reasonCodes"], ["TEXT_DECODING_ANOMALY"])

    def test_parent_quality_and_sha_must_match(self) -> None:
        page = {"schemaVersion": "public-document-index-v1",
                "indexVersionHash": upgrade.PARENT_VERSION_HASH,
                "qualityPolicyVersion": "text-layer-quality-v1", "inputSha256": "a" * 64,
                "pageNumber": 1, "blocks": [{"text": "ordinary"}], "quality": {}}
        with self.assertRaisesRegex(ValueError, "legacy quality"):
            upgrade.upgrade_page(page, source_id="F0001", source_sha="a" * 64,
                                 page_number=1)
        with self.assertRaisesRegex(ValueError, "identity"):
            upgrade.upgrade_page(page, source_id="F0001", source_sha="b" * 64,
                                 page_number=1)


if __name__ == "__main__":
    unittest.main()
