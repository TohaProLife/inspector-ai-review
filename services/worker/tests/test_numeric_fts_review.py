from __future__ import annotations

import copy
import hashlib
import unittest

from inspector_worker.numeric_fts_review import classify_numeric_fts_context


class NumericFtsReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        text = "Высота здания до верха, м"
        line = {"blockIndex": 3, "lineIndex": 0,
                "bboxMilliPoints": [1000, 1000, 3000, 2000],
                "text": text, "lineTextSha256": hashlib.sha256(text.encode()).hexdigest(),
                "pageArtifactSha256": "b" * 64}
        self.context = {
            "schemaVersion": "numeric-fts-page-review-v1",
            "status": "CONTEXT_CAPTURED_REVIEW_REQUIRED", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": "a" * 64, "auditReportSha256": "c" * 64,
            "pageCount": 1, "findingCount": None, "parameterCoverage": None,
            "pages": [{"sourceFileId": "F0001", "pageNumber": 1,
                       "sourceSha256": "d" * 64, "pageArtifactSha256": "b" * 64,
                       "stage": "PD", "manifestSection": "OTHER",
                       "labels": [{"parameterCode": "PZ-008", "lineSpans": [[0, 0]],
                                   "contextLinesOmitted": 0, "context": [line]}]}],
        }
        self.policy = {"schemaVersion": "numeric-fts-review-v1",
                       "status": "REVIEW_ONLY_ABSTAIN",
                       "contextReportSha256": "e" * 64, "ftsReportSha256": "f" * 64,
                       "classifications": [{"sourceFileId": "F0001", "pageNumber": 1,
                                            "candidateCodes": ["PZ-008"],
                                            "category": "MULTICELL_MULTIENTITY_TABLE",
                                            "reason": "Table has several values.",
                                            "anchors": [[3, 0]]}]}

    def _classify(self) -> dict:
        return classify_numeric_fts_context(self.context, self.policy, expected_pages=1)

    def test_review_preserves_abstain_and_full_line_locator(self) -> None:
        report = self._classify()
        self.assertEqual(report["status"], "COMPLETE_REVIEW_ONLY_ABSTAIN")
        self.assertEqual(report["withoutExactTableRowPages"], 1)
        self.assertEqual(report["categoryCounts"], {"MULTICELL_MULTIENTITY_TABLE": 1})
        self.assertEqual(report["pages"][0]["anchors"][0]["text"],
                         "Высота здания до верха, м")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])

    def test_omitted_or_unlocalized_context_fails_closed(self) -> None:
        label = self.context["pages"][0]["labels"][0]
        label["contextLinesOmitted"] = 1
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self._classify()
        label["contextLinesOmitted"] = 0
        label["lineSpans"] = []
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self._classify()

    def test_missing_anchor_or_changed_line_sha_fails_closed(self) -> None:
        self.policy["classifications"][0]["anchors"] = [[4, 0]]
        with self.assertRaisesRegex(ValueError, "anchor missing"):
            self._classify()
        self.policy["classifications"][0]["anchors"] = [[3, 0]]
        self.context["pages"][0]["labels"][0]["context"][0]["text"] = "Height changed"
        with self.assertRaisesRegex(ValueError, "line SHA differs"):
            self._classify()

    def test_code_and_page_inventory_fail_closed(self) -> None:
        self.policy["classifications"][0]["candidateCodes"] = ["PZ-002"]
        with self.assertRaisesRegex(ValueError, "candidate codes"):
            self._classify()
        self.policy["classifications"][0]["candidateCodes"] = ["PZ-008"]
        wrong = copy.deepcopy(self.policy["classifications"][0])
        wrong["pageNumber"] = 2
        self.policy["classifications"].append(wrong)
        with self.assertRaisesRegex(ValueError, "complete numeric review policy"):
            self._classify()


if __name__ == "__main__":
    unittest.main()
