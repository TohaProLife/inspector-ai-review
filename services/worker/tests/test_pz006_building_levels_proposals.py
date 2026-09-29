"""PZ-006 table navigation remains untyped and review-only."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.pz006_building_levels_proposals import (
    _proposal, evaluate_pz006_building_levels_proposals,
)

MANIFEST = Path("datasets/reference_methodology/hackathon_gold_20260811/"
                "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
PDF = Path("/tmp/inspector-pz006-F0101-public.pdf")
EXPECTED_SHA = "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54"


def _manifest() -> dict:
    return next(json.loads(line) for line in MANIFEST.read_text().splitlines()
                if json.loads(line).get("file_id") == "F0101")


def _word(index: int, text: str, x: int) -> dict:
    return {"wordIndex": index, "text": text,
            "textSha256": hashlib.sha256(text.encode()).hexdigest(),
            "bboxMilliPoints": [x, 100000, x + 20000, 110000]}


class Pz006BuildingLevelsProposalsTests(unittest.TestCase):
    def test_ambiguous_synthetic_corpus_row_keeps_all_word_boxes(self) -> None:
        line = [_word(0, "Корпус", 330000), _word(1, "2", 375000),
                _word(2, "м", 405000), _word(3, "16", 520000),
                _word(4, "19", 545000)]
        proposal = _proposal("CORPUS_FLOOR_COUNT", line, 595000, "2")
        self.assertEqual(proposal["rawValue"], "16 19")
        self.assertEqual(proposal["corpusLabelRaw"], "2")
        self.assertIn("MULTIPLE_VALUE_CELLS_AMBIGUOUS", proposal["reasonCodes"])
        self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
        self.assertIsNone(proposal["typedFact"])
        self.assertEqual(proposal["wordLocators"], line)

    @unittest.skipUnless(MANIFEST.is_file() and PDF.is_file(),
                         "original permitted F0101 PDF unavailable")
    def test_original_public_sha_page_and_unit_conflict(self) -> None:
        record = _manifest()
        data = PDF.read_bytes()
        self.assertEqual((record["split"], record["distribution_status"],
                          record["label_visibility"], record["stage"], record["section"]),
                         ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", "PD", "OTHER"))
        self.assertEqual(record["sha256"], EXPECTED_SHA)
        self.assertEqual(hashlib.sha256(data).hexdigest(), EXPECTED_SHA)
        result = evaluate_pz006_building_levels_proposals(data, record, 9)
        self.assertEqual(result["sourceSha256"], EXPECTED_SHA)
        self.assertEqual((result["status"], result["findingCount"],
                          result["parameterCoverage"], result["typedFact"]),
                         ("ABSTAIN", None, None, None))
        self.assertEqual(result["proposalCount"], 7)
        by_kind = {item["proposalKind"]: item for item in result["proposals"]
                   if item["proposalKind"] != "CORPUS_FLOOR_COUNT"}
        corps = [item for item in result["proposals"]
                 if item["proposalKind"] == "CORPUS_FLOOR_COUNT"]
        self.assertEqual([(item["corpusLabelRaw"], item["rawValue"], item["rawUnit"])
                          for item in corps], [("1", "19", "м"), ("2", "16", "м")])
        self.assertEqual(by_kind["FLOOR_COUNT_HEADER"]["rawValue"], "1-16-19 +")
        self.assertEqual(by_kind["FLOOR_COUNT_CONTINUATION"]["rawValue"], "3 подз.")
        self.assertEqual((by_kind["VOLUME_TOTAL"]["rawValue"],
                          by_kind["VOLUME_TOTAL"]["rawUnit"]), ("69 201,0", "кв. м."))
        self.assertEqual((by_kind["VOLUME_UNDERGROUND_PART"]["rawValue"],
                          by_kind["VOLUME_UNDERGROUND_PART"]["rawUnit"]),
                         ("16 454,6", "куб. м"))
        self.assertEqual((by_kind["VOLUME_ABOVEGROUND_PART"]["rawValue"],
                          by_kind["VOLUME_ABOVEGROUND_PART"]["rawUnit"]),
                         ("52 731,4", "куб. м"))
        self.assertIn("VOLUME_UNIT_CONFLICT", result["reasonCodes"])
        self.assertIn("TOTAL_VS_PART_UNIT_CONFLICT", result["reasonCodes"])
        self.assertIn("PZ006_CATALOG_TITLE_TRIGGER_CONFLICT", result["reasonCodes"])
        self.assertTrue(all(item["rowAssociationStatus"] == "UNVERIFIED"
                            and item["typedFact"] is None for item in result["proposals"]))
        self.assertTrue(all(item["wordLocators"] for item in result["proposals"]))

    @unittest.skipUnless(MANIFEST.is_file() and PDF.is_file(),
                         "original permitted F0101 PDF unavailable")
    def test_tamper_and_hidden_source_rejected(self) -> None:
        record = _manifest()
        data = PDF.read_bytes()
        with self.assertRaisesRegex(ValueError, "SHA mismatch"):
            evaluate_pz006_building_levels_proposals(data + b"x", record, 9)
        hidden = copy.deepcopy(record)
        hidden["split"] = "TEST_HIDDEN"
        with self.assertRaisesRegex(ValueError, "not permitted public"):
            evaluate_pz006_building_levels_proposals(data, hidden, 9)
        with self.assertRaisesRegex(ValueError, "page count mismatch"):
            evaluate_pz006_building_levels_proposals(data, record, 14)


if __name__ == "__main__":
    unittest.main()
