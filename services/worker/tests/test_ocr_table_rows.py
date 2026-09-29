"""Committed-stage table rows remain OCR observations for human review."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.ocr_table_rows import extract_ocr_table_rows


_STAGE_PATH = (Path(__file__).resolve().parents[3] / "output" /
               "public-index-20260927" / "f0202-v5-ocr-stage-20260928.json")
_STAGE_SHA = "abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a"
_PAGE_NINE_PAIRS = [(12, 13), (15, 16), (17, 18), (19, 20), (21, 22),
                    (24, 25), (26, 27), (28, 29), (30, 31), (32, 33),
                    (35, 36), (38, 39), (42, 43)]


def _real_stage() -> dict:
    if not _STAGE_PATH.is_file():
        raise unittest.SkipTest(f"Recorded public OCR stage unavailable: {_STAGE_PATH}")
    body = _STAGE_PATH.read_bytes()
    if hashlib.sha256(body).hexdigest() != _STAGE_SHA:
        raise AssertionError("local committed OCR stage fixture changed")
    return json.loads(body)


def _page_nine(stage: dict) -> dict:
    return stage["analysis"]["sources"][0]["pages"][2]


def _rehash_page(page: dict) -> None:
    page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                           if key != "contentHash"})


class OcrTableRowTests(unittest.TestCase):
    def test_real_f0202_page_nine_yields_thirteen_uncoded_rows(self) -> None:
        result = extract_ocr_table_rows(_real_stage(), stage_sha256=_STAGE_SHA)
        rows = [row for row in result["proposals"] if row["pageNumber"] == 9]
        self.assertEqual(len(result["proposals"]), 16)
        self.assertEqual([(row["labelEvidence"]["lineIndex"],
                           row["valueEvidence"]["lineIndex"])
                          for row in result["proposals"] if row["pageNumber"] == 7],
                         [(28, 29), (40, 41), (48, 49)])
        self.assertEqual([(row["labelEvidence"]["lineIndex"],
                           row["valueEvidence"]["lineIndex"]) for row in rows],
                         _PAGE_NINE_PAIRS)
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(result["ocrStageSha256"], _STAGE_SHA)
        self.assertEqual(result["contentHash"], canonical_hash({
            key: value for key, value in result.items() if key != "contentHash"}))
        for row in rows:
            self.assertEqual(row["headerEvidence"][0]["text"], "Наименование")
            self.assertEqual(row["headerEvidence"][1]["text"], "Значение")
            self.assertEqual(row["ocrPageContentHash"], _page_nine(_real_stage())["contentHash"])
            self.assertEqual(row["inputSha256"], _real_stage()["analysis"]["sources"][0]["sourceSha256"])
            self.assertEqual(set(row), {"sourceFileId", "inputSha256", "pageNumber",
                                        "ocrPageContentHash", "renderSha256",
                                        "headerEvidence", "labelEvidence", "valueEvidence"})
            for evidence in [*row["headerEvidence"], row["labelEvidence"], row["valueEvidence"]]:
                self.assertEqual(set(evidence), {"role", "lineIndex", "text", "bboxPx", "score"})
        self.assertEqual(rows[-1]["valueEvidence"]["text"], "+15,800")
        self.assertTrue(all(any(character.isdigit() for character in row["valueEvidence"]["text"])
                            for row in result["proposals"]))

    def test_rejects_wrong_committed_stage_sha_and_stale_page_hash(self) -> None:
        stage = _real_stage()
        with self.assertRaisesRegex(ValueError, "stage SHA-256 mismatch"):
            extract_ocr_table_rows(stage, stage_sha256="f" * 64)
        stage = copy.deepcopy(stage)
        _page_nine(stage)["lines"][13]["text"] = "999"
        with self.assertRaisesRegex(ValueError, "contentHash"):
            extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))

    def test_rejects_wrong_source_sha_or_stage_schema_even_when_rehashed(self) -> None:
        stage = _real_stage()
        stage["analysis"]["sources"][0]["sourceSha256"] = "e" * 64
        with self.assertRaisesRegex(ValueError, "provenance"):
            extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))
        stage = _real_stage()
        stage["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v4"
        with self.assertRaisesRegex(ValueError, "stage schema"):
            extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))

    def test_ambiguous_pair_abstains_instead_of_choosing_label(self) -> None:
        stage = _real_stage()
        page = _page_nine(stage)
        page["lines"].append({"text": "Другое давление", "bboxPx": [260, 272, 500, 297],
                              "score": .97})
        _rehash_page(page)
        result = extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))
        rows = [row for row in result["proposals"] if row["pageNumber"] == 9]
        self.assertEqual(len(rows), 12)
        self.assertNotIn((12, 13), [(row["labelEvidence"]["lineIndex"],
                                    row["valueEvidence"]["lineIndex"]) for row in rows])
        self.assertIn({"sourceFileId": page["sourceFileId"],
                       "inputSha256": page["inputSha256"], "pageNumber": 9,
                       "lineIndex": 13, "reasonCode": "ROW_PAIR_AMBIGUOUS"},
                      result["abstentions"])

    def test_missing_header_and_low_score_fail_closed(self) -> None:
        stage = _real_stage()
        page = _page_nine(stage)
        page["lines"][5]["text"] = "Нименование"
        _rehash_page(page)
        result = extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))
        self.assertEqual([row for row in result["proposals"] if row["pageNumber"] == 9], [])
        self.assertIn("TWO_COLUMN_HEADER_UNRESOLVED",
                      {item["reasonCode"] for item in result["abstentions"]})

        stage = _real_stage()
        page = _page_nine(stage)
        page["lines"][22]["score"] = .79
        _rehash_page(page)
        result = extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage))
        rows = [row for row in result["proposals"] if row["pageNumber"] == 9]
        self.assertEqual(len(rows), 12)
        self.assertIn({"sourceFileId": page["sourceFileId"],
                       "inputSha256": page["inputSha256"], "pageNumber": 9,
                       "lineIndex": 22, "reasonCode": "OCR_SCORE_TOO_LOW"},
                      result["abstentions"])


if __name__ == "__main__":
    unittest.main()
