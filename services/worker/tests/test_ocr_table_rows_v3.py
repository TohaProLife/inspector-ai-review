"""Opt-in wrapped OCR labels stay page-local, uncoded review observations."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.ocr_table_rows import (PROFILE_ID_V2, PROFILE_ID_V3,
                                             extract_ocr_table_rows)


_STAGE_PATH = (Path(__file__).resolve().parents[3] / "output" /
               "public-index-20260927" / "f0202-v5-ocr-stage-20260928.json")
_STAGE_SHA = "abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a"
_V1_HASH = "f906275fafb6cafc9db989ea477fd860e95ca1c2f9cd072530b5a192225b6eae"
_V2_HASH = "ca61459b63740c1b9e0ed8b2689ff83744174b44a54314b261335187d4500fee"


def _stage() -> dict:
    if not _STAGE_PATH.is_file():
        raise unittest.SkipTest(f"Recorded public OCR stage unavailable: {_STAGE_PATH}")
    body = _STAGE_PATH.read_bytes()
    assert hashlib.sha256(body).hexdigest() == _STAGE_SHA
    return json.loads(body)


def _page(stage: dict, number: int) -> dict:
    return next(page for page in stage["analysis"]["sources"][0]["pages"]
                if page["pageNumber"] == number)


def _rehash_page(page: dict) -> None:
    page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                           if key != "contentHash"})


def _extract(stage: dict) -> dict:
    return extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage),
                                  profile_id=PROFILE_ID_V3)


def _row(result: dict, page: int, value_line: int) -> dict | None:
    return next((item for item in result["proposals"]
                 if item["pageNumber"] == page
                 and item["valueEvidence"]["lineIndex"] == value_line), None)


class OcrTableRowsV3Tests(unittest.TestCase):
    def test_original_public_stage_has_two_line_label_with_explicit_evidence(self) -> None:
        stage = _stage()
        v1 = extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA)
        v2 = extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA,
                                    profile_id=PROFILE_ID_V2)
        v3 = extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA,
                                    profile_id=PROFILE_ID_V3)
        self.assertEqual(v1["contentHash"], _V1_HASH)
        self.assertEqual(v2["contentHash"], _V2_HASH)
        self.assertEqual(v3["schemaVersion"], "ocr-table-row-proposals-v3")
        self.assertEqual(v3["profileId"], PROFILE_ID_V3)
        self.assertEqual((len(v3["proposals"]), len(v3["abstentions"])), (17, 3))
        row = _row(v3, 7, 44)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["labelEvidence"]["lineIndex"], 42)
        self.assertEqual([line["lineIndex"] for line in row["labelContinuationEvidence"]], [45])
        self.assertEqual(row["labelContinuationEvidence"][0]["text"], "26°")
        self.assertEqual(row["labelContinuationEvidence"][0]["role"], "rowLabelContinuation")
        self.assertEqual(row["valueEvidence"]["lineIndex"], 44)
        self.assertEqual(v3["findingCount"], 0)
        self.assertEqual(v3["contentHash"], canonical_hash({
            key: value for key, value in v3.items() if key != "contentHash"}))

    def test_ambiguous_continuation_abstains_instead_of_selecting_one(self) -> None:
        stage = copy.deepcopy(_stage())
        page = _page(stage, 7)
        page["lines"].append({"text": "-25°", "bboxPx": [207, 713, 253, 740],
                              "score": .97})
        _rehash_page(page)
        result = _extract(stage)
        self.assertIsNone(_row(result, 7, 44))
        self.assertIn("ROW_LABEL_CONTINUATION_AMBIGUOUS",
                      {item["reasonCode"] for item in result["abstentions"]
                       if item["pageNumber"] == 7 and item["lineIndex"] == 44})

    def test_low_score_continuation_abstains(self) -> None:
        stage = copy.deepcopy(_stage())
        page = _page(stage, 7)
        page["lines"][45]["score"] = .79
        _rehash_page(page)
        result = _extract(stage)
        self.assertIsNone(_row(result, 7, 44))
        self.assertIn("OCR_SCORE_TOO_LOW",
                      {item["reasonCode"] for item in result["abstentions"]
                       if item["pageNumber"] == 7 and item["lineIndex"] == 44})

    def test_off_row_and_duplicate_value_continuation_do_not_pair(self) -> None:
        stage = copy.deepcopy(_stage())
        page = _page(stage, 7)
        page["lines"][45]["bboxPx"] = [270, 711, 318, 739]
        _rehash_page(page)
        result = _extract(stage)
        row = _row(result, 7, 44)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["labelContinuationEvidence"], [])

        stage = copy.deepcopy(_stage())
        page = _page(stage, 7)
        page["lines"].append({"text": "999", "bboxPx": [700, 716, 745, 741],
                              "score": .96})
        _rehash_page(page)
        result = _extract(stage)
        self.assertIsNone(_row(result, 7, 44))

    def test_stale_page_or_stage_hash_is_rejected(self) -> None:
        stage = _stage()
        with self.assertRaisesRegex(ValueError, "stage SHA-256 mismatch"):
            extract_ocr_table_rows(stage, stage_sha256="f" * 64,
                                   profile_id=PROFILE_ID_V3)
        stage = copy.deepcopy(stage)
        _page(stage, 7)["lines"][45]["text"] = "-26°"
        with self.assertRaisesRegex(ValueError, "contentHash"):
            _extract(stage)


if __name__ == "__main__":
    unittest.main()
