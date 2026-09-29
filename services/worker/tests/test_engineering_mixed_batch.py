"""Proof and abstention invariants for public engineering review leads."""

from __future__ import annotations

import hashlib
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inspector_worker.engineering_mixed_batch import (  # noqa: E402
    CODE_SPEC, MAX_QUOTE_CHARS, _balanced_hits, _code_scope, _observations, _ocr_proposals,
    _page_scope,
)
from inspector_worker.public_document_index import load_public_manifest  # noqa: E402


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


class EngineeringMixedBatchTests(unittest.TestCase):
    def test_real_public_source_scope_is_exact(self) -> None:
        rows = _code_scope(load_public_manifest(MANIFEST))
        self.assertEqual(len(rows), 16)
        self.assertEqual({row["stage"] for row in rows}, {"PD", "RD_ID_MIXED"})
        self.assertEqual({row["section"] for row in rows}, {"OV", "VK"})
        self.assertEqual(len(CODE_SPEC), 10)
        self.assertFalse(any(row["stage"] == "RD" for row in rows))

    def test_mixed_rd_title_cue_stays_unverified(self) -> None:
        page = {"lines": [{"text": "РАБОЧАЯ ДОКУМЕНТАЦИЯ. Внутренние сети водоотведения",
                           "blockIndex": 0, "lineIndex": 0,
                           "bboxMilliPoints": [0, 0, 10, 10]}]}
        result = _page_scope(page, "RD_ID_MIXED", "VK")
        self.assertEqual(result["stageStatus"], "MIXED_STAGE_UNRESOLVED")
        self.assertEqual(result["stageCueStatus"], "RD_TITLE_CUE_WITH_MIXED_MANIFEST")
        self.assertIn("RD_TITLE", result["titleCueTypes"])
        self.assertFalse(result["pageStageVerified"])
        self.assertFalse(result["pageSectionVerified"])

    def test_conflicting_page_section_cue_is_review_only(self) -> None:
        page = {"lines": [{"text": "Вентиляция и отопление",
                           "blockIndex": 0, "lineIndex": 0,
                           "bboxMilliPoints": [0, 0, 10, 10]}]}
        result = _page_scope(page, "RD_ID_MIXED", "VK")
        self.assertEqual(result["sectionStatus"], "PAGE_SECTION_CUE_CONFLICT_REVIEW")
        self.assertEqual(result["pageSectionCues"], ["OV"])

    def test_execution_act_split_over_lines_is_review_cue(self) -> None:
        page = {"lines": [
            {"text": "АКТ", "blockIndex": 0, "lineIndex": 0,
             "bboxMilliPoints": [0, 0, 10, 10]},
            {"text": "освидетельствования скрытых работ", "blockIndex": 0,
             "lineIndex": 1, "bboxMilliPoints": [0, 10, 10, 20]},
        ]}
        result = _page_scope(page, "RD_ID_MIXED", "OV")
        self.assertIn("EXECUTION_ACT", result["titleCueTypes"])
        self.assertEqual(result["stageCueStatus"], "EXECUTION_CUE_WITH_MIXED_MANIFEST")
        self.assertFalse(result["pageStageVerified"])

    def test_exact_line_hash_and_table_candidate(self) -> None:
        text = "Радиатор стальной 12 секций, теплоотдача 1360 Вт"
        page = {"lines": [{"text": text, "blockIndex": 4, "lineIndex": 2,
                           "bboxMilliPoints": [1, 2, 30, 40]}],
                "tableRowCandidates": [{"blockIndex": 4, "lineIndex": 2}]}
        rows, count = _observations(page, "IOS4-077")
        self.assertEqual(count, 1)
        self.assertEqual(rows[0]["text"], text)
        self.assertEqual(rows[0]["lineSha256"], hashlib.sha256(text.encode()).hexdigest())
        self.assertTrue(rows[0]["indexedTableRowCandidate"])

    def test_long_line_never_masquerades_as_exact_quote(self) -> None:
        text = "Радиатор " + "модель " * MAX_QUOTE_CHARS
        page = {"lines": [{"text": text, "blockIndex": 0, "lineIndex": 0,
                           "bboxMilliPoints": [1, 2, 30, 40]}],
                "tableRowCandidates": []}
        rows, count = _observations(page, "IOS4-077")
        self.assertEqual(count, 1)
        self.assertEqual(rows[0]["status"], "LONG_LINE_SHA_ONLY")
        self.assertNotIn("text", rows[0])

    def test_table_measurement_outweighs_earlier_generic_lines(self) -> None:
        lines = [
            {"text": "Радиатор предусмотрен", "blockIndex": 0,
             "lineIndex": i, "bboxMilliPoints": [0, i, 20, i + 1]}
            for i in range(3)
        ]
        lines.append({"text": "Радиатор PRADO 12 секций 1360 Вт", "blockIndex": 1,
                      "lineIndex": 0, "bboxMilliPoints": [0, 5, 20, 6]})
        page = {"lines": lines, "tableRowCandidates": [{"blockIndex": 1, "lineIndex": 0}]}
        rows, count = _observations(page, "IOS4-077")
        self.assertEqual(count, 4)
        self.assertEqual(len(rows), 3)
        self.assertTrue(any(row["indexedTableRowCandidate"] and "1360 Вт" in row["text"]
                            for row in rows))

    def test_balanced_selection_does_not_swallow_mixed_source(self) -> None:
        hits = [("F0171", p) for p in range(1, 10)] + [("F0201", 100)]
        self.assertEqual(_balanced_hits(hits, ["F0171", "F0201"], 2),
                         [("F0171", 1), ("F0201", 100)])

    def test_first_mixed_vk_ocr_pages_proposed_without_text_hit(self) -> None:
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE pages(source_id TEXT,page_number INT,"
                           "artifact_sha256 TEXT,disposition TEXT)")
        for number in (6, 7, 8):
            connection.execute("INSERT INTO pages VALUES(?,?,?,?)",
                               ("F0204", number, "a" * 64, "OCR_REQUIRED"))
        proposed, total, eligible = _ocr_proposals(
            connection, ["F0204"], {"F0204"}, set())
        self.assertEqual((total, eligible), (3, 2))
        self.assertEqual([item["pageNumber"] for item in proposed], [6, 7])
        self.assertTrue(all(item["status"] == "OCR_PROPOSAL_ONLY" for item in proposed))


if __name__ == "__main__":
    unittest.main()
