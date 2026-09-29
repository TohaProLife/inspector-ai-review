"""Versioned OCR row tolerance remains a review-only geometric proposal."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.ocr_table_rows import (PROFILE_ID_V2, extract_ocr_table_rows)


_STAGE_PATH = (Path(__file__).resolve().parents[3] / "output" /
               "public-index-20260927" / "f0202-v5-ocr-stage-20260928.json")
_STAGE_SHA = "abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a"
_V1_RESULT_HASH = "f906275fafb6cafc9db989ea477fd860e95ca1c2f9cd072530b5a192225b6eae"
_V2_RESULT_HASH = "ca61459b63740c1b9e0ed8b2689ff83744174b44a54314b261335187d4500fee"


def _stage() -> dict:
    if not _STAGE_PATH.is_file():
        raise unittest.SkipTest(f"Recorded public OCR stage unavailable: {_STAGE_PATH}")
    body = _STAGE_PATH.read_bytes()
    if hashlib.sha256(body).hexdigest() != _STAGE_SHA:
        raise AssertionError("local committed OCR stage fixture changed")
    return json.loads(body)


def _page(stage: dict, number: int) -> dict:
    return next(page for page in stage["analysis"]["sources"][0]["pages"]
                if page["pageNumber"] == number)


def _rehash_page(page: dict) -> None:
    page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                           if key != "contentHash"})


def _pairs(result: dict, number: int) -> list[tuple[int, int]]:
    return [(row["labelEvidence"]["lineIndex"], row["valueEvidence"]["lineIndex"])
            for row in result["proposals"] if row["pageNumber"] == number]


class OcrTableRowsV2Tests(unittest.TestCase):
    def test_versioned_result_on_original_public_stage(self) -> None:
        stage = _stage()
        v1 = extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA)
        v2 = extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA,
                                    profile_id=PROFILE_ID_V2)
        self.assertEqual((v1["schemaVersion"], v1["profileId"], v1["contentHash"]),
                         ("ocr-table-row-proposals-v1", "conservative-ocr-table-rows-v1",
                          _V1_RESULT_HASH))
        self.assertEqual((v2["schemaVersion"], v2["profileId"], v2["contentHash"]),
                         ("ocr-table-row-proposals-v2", PROFILE_ID_V2, _V2_RESULT_HASH))
        self.assertEqual(_pairs(v2, 7), [(28, 29), (40, 41), (42, 44), (48, 49)])
        self.assertEqual(_pairs(v2, 8), [])
        self.assertEqual(_pairs(v2, 9), _pairs(v1, 9))
        self.assertEqual(len(v2["proposals"]), 17)
        self.assertEqual(v2["abstentions"], v1["abstentions"])
        self.assertEqual(len(v2["abstentions"]), 3)
        self.assertEqual(v2["findingCount"], 0)
        self.assertEqual(v2["ocrStageSha256"], _STAGE_SHA)
        self.assertEqual(v2["contentHash"], canonical_hash({
            key: value for key, value in v2.items() if key != "contentHash"}))

    def test_lower_bound_does_not_admit_far_column_text(self) -> None:
        stage = copy.deepcopy(_stage())
        page = _page(stage, 9)
        page["lines"][13]["bboxPx"] = [768, 270, 878, 299]  # right header starts at 833
        _rehash_page(page)
        result = extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage),
                                        profile_id=PROFILE_ID_V2)
        self.assertNotIn((12, 13), _pairs(result, 9))
        self.assertEqual(len(_pairs(result, 9)), 12)

    def test_ambiguous_pair_abstains_instead_of_selecting_label(self) -> None:
        stage = copy.deepcopy(_stage())
        page = _page(stage, 9)
        page["lines"].append({"text": "Другое давление", "bboxPx": [260, 272, 500, 297],
                              "score": .97})
        _rehash_page(page)
        result = extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage),
                                        profile_id=PROFILE_ID_V2)
        self.assertNotIn((12, 13), _pairs(result, 9))
        self.assertIn({"sourceFileId": page["sourceFileId"],
                       "inputSha256": page["inputSha256"], "pageNumber": 9,
                       "lineIndex": 13, "reasonCode": "ROW_PAIR_AMBIGUOUS"},
                      result["abstentions"])

    def test_v2_rejects_stage_sha_mismatch_and_unknown_extraction_profile(self) -> None:
        stage = _stage()
        with self.assertRaisesRegex(ValueError, "stage SHA-256 mismatch"):
            extract_ocr_table_rows(stage, stage_sha256="f" * 64,
                                   profile_id=PROFILE_ID_V2)
        with self.assertRaisesRegex(ValueError, "extraction profile invalid"):
            extract_ocr_table_rows(stage, stage_sha256=_STAGE_SHA,
                                   profile_id="conservative-ocr-table-rows-v4")


if __name__ == "__main__":
    unittest.main()
