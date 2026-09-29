"""Poppler v2 ZU-127 stays SHA-bound navigation with explicit abstention."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from inspector_worker.zu127_window_table_poppler_v2 import (
    PUBLIC_SHA, _page_proposals, _parse_page, evaluate_zu127_window_table_poppler_v2,
)


_MANIFEST = (Path(__file__).parents[3] / "datasets/reference_methodology/"
             "hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


def _source() -> dict[str, object]:
    return next(json.loads(line) for line in _MANIFEST.read_text().splitlines()
                if json.loads(line)["file_id"] == "F0152")


class Zu127PopplerV2Tests(unittest.TestCase):
    def test_parser_keeps_full_word_order_boxes_and_split_marker(self) -> None:
        xml = (b'<html><body><page width="595.320000" height="841.920000">'
               b'<word xMin="450.220000" yMin="147.297320" '
               b'xMax="467.800000" yMax="156.261320">0,65</word>'
               b'<word xMin="467.860000" yMin="146.194160" '
               b'xMax="471.100000" yMax="152.026160">*</word>'
               b'</page></body></html>')
        page = _parse_page(xml, 49)
        self.assertEqual([word["rawText"] for word in page["words"]], ["0,65", "*"])
        self.assertEqual([word["wordIndex"] for word in page["words"]], [0, 1])
        self.assertEqual(page["words"][0]["bboxMilliPointsTopLeft"],
                         [450220, 147297, 467800, 156261])
        self.assertEqual(page["words"][1]["wordTextSha256"], hashlib.sha256(b"*").hexdigest())

    def test_parser_rejects_partial_multiple_or_outside_page_words(self) -> None:
        for xml in (
            b'<page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="101" yMax="1">x</word></page>',
            b'<page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="1" yMax="1"></word></page>',
            b'<root><page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="1" yMax="1">x</word></page><page width="100" height="100"/></root>',
        ):
            with self.subTest(xml=xml):
                with self.assertRaises(ValueError):
                    _parse_page(xml, 49)

    def test_ambiguous_or_u_heading_fails_closed(self) -> None:
        label = lambda i, text, x, y: {"wordIndex": i, "rawText": text,
                                     "bboxMilliPointsTopLeft": [x, y, x + 20_000, y + 10_000]}
        words = [label(0, "Окна", 300_000, 115_000),
                 label(1, "Витражи", 300_000, 175_000),
                 label(2, "0,65", 450_000, 145_000),
                 label(3, "*", 470_000, 145_000),
                 label(4, "0,85", 450_000, 205_000),
                 label(5, "**", 470_000, 205_000)]
        page = {"words": words, "pageText": "сопротивление теплопередаче",
                "pageWidthMilliPoints": 595_320}
        proposals, reasons = _page_proposals(page, 49)
        self.assertEqual((len(proposals), reasons), (2, []))
        self.assertEqual([p["rawCellTexts"] for p in proposals], [
            {"resistance": "0,65", "footnoteMarker": "*"},
            {"resistance": "0,85", "footnoteMarker": "**"},
        ])
        page["words"] = words + [label(6, "0,70", 450_000, 145_000)]
        proposals, reasons = _page_proposals(page, 49)
        self.assertEqual([p["productKind"] for p in proposals], ["VITRAGE"])
        self.assertIn("PRODUCT_ROW_ADJACENCY_AMBIGUOUS", reasons)
        page["pageText"] = "коэффициент теплопередаче"
        self.assertEqual(_page_proposals(page, 49),
                         ([], ["R_HEADING_NOT_UNAMBIGUOUS"]))

    def test_wrong_scope_pdf_or_pages_cannot_run(self) -> None:
        source = _source()
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "fake.pdf"
            pdf.write_bytes(b"%PDF-fake")
            for altered in ({**source, "split": "TEST_HIDDEN"},
                            {**source, "sha256": "0" * 64},
                            {**source, "file_id": "F0153"},
                            {**source, "object_id": "other-object"}):
                with self.assertRaisesRegex(ValueError, "requires audited public"):
                    evaluate_zu127_window_table_poppler_v2(pdf, altered, [49, 51])
            for pages in ([49], [51, 49], [49, 49], [49, 51, 52]):
                with self.assertRaisesRegex(ValueError, "requires pages"):
                    evaluate_zu127_window_table_poppler_v2(pdf, source, pages)
            with self.assertRaisesRegex(ValueError, "size/SHA mismatch"):
                evaluate_zu127_window_table_poppler_v2(pdf, source, [49, 51])

    @unittest.skipUnless(os.environ.get("INSPECTOR_PUBLIC_F0152_PDF"),
                         "original public F0152 PDF path not supplied")
    def test_original_sha_verified_public_pages_49_and_51(self) -> None:
        path = Path(os.environ["INSPECTOR_PUBLIC_F0152_PDF"])
        source = _source()
        self.assertEqual(source["sha256"], PUBLIC_SHA)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), PUBLIC_SHA)
        result = evaluate_zu127_window_table_poppler_v2(path, source, [49, 51])
        row = result["codeRows"][0]
        self.assertEqual([r["wordCount"] for r in result["pageReceipts"]], [135, 173])
        self.assertEqual([r["proposalCount"] for r in result["pageReceipts"]], [2, 2])
        self.assertEqual((row["status"], row["proposalCount"], row["absenceConclusion"]),
                         ("ABSTAIN", 4, "NOT_AVAILABLE"))
        self.assertEqual([(p["productKind"], p["rawCellTexts"]) for p in row["proposals"]], [
            ("WINDOW", {"resistance": "0,65", "footnoteMarker": "*"}),
            ("VITRAGE", {"resistance": "0,85", "footnoteMarker": "**"}),
            ("WINDOW", {"required": "0,50", "calculated": "0,65"}),
            ("VITRAGE", {"required": "0,50", "calculated": "0,85"}),
        ])
        for key in ("findings", "findingCount", "parameterCoverage", "typedFacts"):
            self.assertIsNone(result[key])
        self.assertIsNone(row["typedFact"])
        for proposal in row["proposals"]:
            self.assertIsNone(proposal["typedValues"])
            self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
            for role in proposal["roles"].values():
                self.assertEqual(len(role["wordTextSha256"]), 64)
                self.assertIn(role["pageNumber"], [49, 51])
        self.assertEqual(result["selectedPageNumbers"], [49, 51])


if __name__ == "__main__":
    unittest.main()
