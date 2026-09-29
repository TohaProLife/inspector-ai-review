"""ZU-127 cell adjacency stays review-only, including public original smoke."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import fitz

from inspector_worker.zu127_window_table_proposals import (
    _page_proposals, evaluate_zu127_window_table_proposals,
)

_PUBLIC_MANIFEST = Path(__file__).parents[3] / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
_REAL_SHA = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af"


class FakePage:
    def __init__(self, *, u_heading: bool = False, duplicate_window: bool = False) -> None:
        heading = "Коэффициент" if u_heading else "сопротивление"
        entries = [(300, 30, heading), (380, 30, "теплопередаче"),
                   (250, 90, "Требуемое"), (440, 90, "Расчётное"),
                   (100, 150, "Окна"), (270, 150, "0,50"), (460, 150, "0,65"),
                   (100, 180, "Витражи"), (270, 180, "0,50"), (460, 180, "0,85")]
        if duplicate_window:
            entries.append((290, 150, "0,70"))
        self.words = [(x, y, x + max(20, len(word) * 6), y + 10, word, 0, index, 0)
                      for index, (x, y, word) in enumerate(entries)]

    def get_text(self, kind: str, *, sort: bool = False) -> object:
        if kind == "words":
            return self.words
        if kind == "text":
            return " ".join(word[4] for word in self.words)
        raise AssertionError(kind)


class Zu127WindowTableProposalsTests(unittest.TestCase):
    def test_synthetic_r_summary_keeps_window_and_vitrage_separate(self) -> None:
        proposals, reasons, word_sha = _page_proposals(FakePage(), 1)  # type: ignore[arg-type]
        self.assertEqual(reasons, [])
        self.assertEqual(len(word_sha), 64)
        self.assertEqual([(p["productKind"], p["rawCellTexts"]) for p in proposals], [
            ("WINDOW", {"required": "0,50", "calculated": "0,65"}),
            ("VITRAGE", {"required": "0,50", "calculated": "0,85"}),
        ])
        for proposal in proposals:
            self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
            self.assertIsNone(proposal["typedValues"])
            for role in proposal["roles"].values():
                self.assertEqual(role["pageNumber"], 1)
                self.assertEqual(len(role["wordTextSha256"]), 64)
                self.assertEqual(len(role["bboxMilliPointsTopLeft"]), 4)

    def test_coefficient_u_heading_cannot_produce_r_proposal(self) -> None:
        proposals, reasons, _ = _page_proposals(FakePage(u_heading=True), 1)  # type: ignore[arg-type]
        self.assertEqual(proposals, [])
        self.assertIn("R_HEADING_NOT_UNAMBIGUOUS", reasons)

    def test_ambiguous_window_cell_does_not_borrow_vitrage_value(self) -> None:
        proposals, reasons, _ = _page_proposals(FakePage(duplicate_window=True), 1)  # type: ignore[arg-type]
        self.assertEqual([p["productKind"] for p in proposals], ["VITRAGE"])
        self.assertIn("SUMMARY_ROW_ADJACENCY_AMBIGUOUS", reasons)

    def test_pdf_tamper_hidden_scope_and_false_zero_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "blank.pdf"
            document = fitz.open()
            document.new_page()
            document.save(path)
            document.close()
            payload = path.read_bytes()
            source = {"file_id": "F0152", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                      "label_visibility": "PUBLIC_TRAIN", "object_id": "synthetic-object",
                      "sha256": hashlib.sha256(payload).hexdigest(), "size_bytes": len(payload),
                      "pdf_pages": 1}
            result = evaluate_zu127_window_table_proposals(path, source, [1])
            row = result["codeRows"][0]
            self.assertEqual((row["status"], row["proposalCount"], row["absenceConclusion"]),
                             ("ABSTAIN", 0, "NOT_AVAILABLE"))
            self.assertIsNone(result["findingCount"])
            self.assertIsNone(result["parameterCoverage"])
            for pages in ([], [1, 1], [0], [2]):
                with self.assertRaises(ValueError):
                    evaluate_zu127_window_table_proposals(path, source, pages)
            with self.assertRaisesRegex(ValueError, "not permitted"):
                evaluate_zu127_window_table_proposals(path, {**source, "split": "TEST_HIDDEN"}, [1])
            path.write_bytes(payload + b"tamper")
            with self.assertRaisesRegex(ValueError, "size/SHA mismatch"):
                evaluate_zu127_window_table_proposals(path, source, [1])

    @unittest.skipUnless(os.environ.get("INSPECTOR_PUBLIC_F0152_PDF"),
                         "SHA-verified public F0152 PDF supplied only for original-source test")
    def test_original_public_f0152_pages_49_and_51(self) -> None:
        path = Path(os.environ["INSPECTOR_PUBLIC_F0152_PDF"])
        source = next(json.loads(line) for line in _PUBLIC_MANIFEST.read_text().splitlines()
                      if json.loads(line)["file_id"] == "F0152")
        self.assertEqual(source["sha256"], _REAL_SHA)
        result = evaluate_zu127_window_table_proposals(path, source, [49, 51])
        row = result["codeRows"][0]
        self.assertEqual((row["status"], row["proposalCount"]), ("ABSTAIN", 4))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual([(p["productKind"], p["rawCellTexts"]) for p in row["proposals"]], [
            ("WINDOW", {"resistance": "0,65*"}),
            ("VITRAGE", {"resistance": "0,85**"}),
            ("WINDOW", {"required": "0,50", "calculated": "0,65"}),
            ("VITRAGE", {"required": "0,50", "calculated": "0,85"}),
        ])
        self.assertTrue(all(p["rowAssociationStatus"] == "UNVERIFIED" for p in row["proposals"]))
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")


if __name__ == "__main__":
    unittest.main()
