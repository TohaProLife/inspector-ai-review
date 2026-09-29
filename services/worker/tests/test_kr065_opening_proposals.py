"""KR-065 proposals are navigation, not verified opening facts."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.kr065_opening_proposals import (
    MAX_PROPOSALS, _page_proposals, evaluate_kr065_opening_proposals,
    execute_durable_kr065_opening_proposals,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-KR065-SYNTHETIC"
MANIFEST_HASH = "a" * 64
PUBLIC_MANIFEST = Path("datasets/reference_methodology/hackathon_gold_20260811/"
                       "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
PUBLIC_PDFS = Path("/tmp/inspector-kr065-public")
EXPECTED_SHA = {
    "F0141": "421a34429325f424d3e29086810b1283e805d9bb3c75646508e5434b248e5d5f",
    "F0142": "43b1595f8cf21e5d5e5af5d31aa42314c3c889e873a67a549d343597d74ab6cb",
    "F0143": "c3236288c713f044637feba3b5331087e5b549ee5886e15381ec904fc1579663",
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def box(text: str, y: int = 100) -> dict:
    return {"text": text, "bboxMilliPoints": [100, y, 600, y + 20]}


def page(number: int, blocks: list[dict]) -> dict:
    return {"pageNumber": number, "widthMilliPoints": 1000,
            "heightMilliPoints": 1000, "blocks": blocks,
            "quality": qualify_page_text([block["text"] for block in blocks])}


def source(source_id: str, *, section: str = "KR", stages: list[str] | None = None,
           revision: str = "CURRENT", approval: str = "APPROVED") -> dict:
    return {"sourceFileId": source_id, "sha256": digest(source_id),
            "objectId": OBJECT, "stages": stages or ["RD"],
            "sectionCode": section, "revisionStatus": revision,
            "approvalStatus": approval, "pageStages": {}}


def artifact(src: dict, pages: list[dict]) -> dict:
    candidate = sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for p in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": sum(bool(p["blocks"]) for p in pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidate,
                               "ocrRequiredPageCount": len(pages) - candidate},
            "pages": pages}


def _real_page(path: Path, number: int) -> dict:
    # Same block normalization and order as document-text-v2 extraction.
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer

    layout = next(iter(extract_pages(str(path), page_numbers=[number - 1])))
    blocks = []
    for element in layout:
        if not isinstance(element, LTTextContainer):
            continue
        text = element.get_text().replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
        if text:
            blocks.append({"text": text, "bboxMilliPoints": [
                round(element.x0 * 1000), round(element.y0 * 1000),
                round(element.x1 * 1000), round(element.y1 * 1000)]})
    blocks.sort(key=lambda block: (-block["bboxMilliPoints"][3],
                                   block["bboxMilliPoints"][0],
                                   block["bboxMilliPoints"][1], block["text"]))
    return {"pageNumber": number, "widthMilliPoints": round(layout.width * 1000),
            "heightMilliPoints": round(layout.height * 1000), "blocks": blocks,
            "quality": qualify_page_text([block["text"] for block in blocks])}


class Kr065OpeningProposalsTests(unittest.TestCase):
    def test_distinct_labels_and_heading_never_become_contour_or_finding(self) -> None:
        left, right = source("F-LEFT"), source("F-RIGHT")
        left_page = page(1, [box("Деталь 3", 150),
                             box('(обрамление отверстия "№7" 750х750мм - 1шт.)', 100)])
        right_page = page(1, [box("Деталь 3", 150),
                              box('(обрамление отверстия "№5" 1400х950(h) мм - 1шт.)', 100)])
        result = evaluate_kr065_opening_proposals(
            OBJECT, MANIFEST_HASH, [left, right],
            [artifact(left, [left_page]), artifact(right, [right_page])])
        row = result["codeRows"][0]
        self.assertEqual((row["status"], result["findingCount"], result["parameterCoverage"]),
                         ("ABSTAIN", None, None))
        labels = [p for p in row["proposals"]
                  if p["proposalKind"] == "OPENING_LABEL_DIMENSION_NAVIGATION"]
        self.assertEqual({(p["sourceFileId"], p["rawOpeningNumber"], p["rawDimensionsText"])
                          for p in labels},
                         {("F-LEFT", "7", "750х750мм"),
                          ("F-RIGHT", "5", "1400х950(h) мм")})
        for proposal in row["proposals"]:
            self.assertEqual(proposal["drawingContourAssociation"], "UNVERIFIED")
            self.assertEqual(proposal["detailAssociation"], "UNVERIFIED")
            self.assertEqual(proposal["sameElementAssociation"], "UNVERIFIED")
            self.assertEqual(proposal["reinforcementStatus"], "NOT_ESTABLISHED")
            self.assertEqual(proposal["unauthorizedFillStatus"], "NOT_ESTABLISHED")
            self.assertIsNone(proposal["rawAxes"])
            self.assertIsNone(proposal["rawLevel"])
            self.assertEqual(proposal["pageSha256"],
                             digest(left_page if proposal["sourceFileId"] == "F-LEFT"
                                    else right_page))
            anchor = proposal["anchor"]
            self.assertEqual(anchor["lineTextSha256"],
                             hashlib.sha256(anchor["lineText"].encode()).hexdigest())
            self.assertEqual(anchor["bboxMilliPoints"], [100, 150, 600, 170]
                             if anchor["lineText"] == "Деталь 3" else [100, 100, 600, 120])

    def test_designed_closure_is_not_unauthorized_fill(self) -> None:
        src = source("F-CLOSURE")
        text = "Деталь заделки монтажного проема в осях 1.Е / 2.1\nНижнее армирование"
        result = evaluate_kr065_opening_proposals(
            OBJECT, MANIFEST_HASH, [src], [artifact(src, [page(1, [box(text)])])])
        proposal = result["codeRows"][0]["proposals"][0]
        self.assertEqual(proposal["proposalKind"], "DESIGNED_CLOSURE_HEADING_NAVIGATION")
        self.assertEqual(proposal["anchor"]["lineIndex"], 0)
        self.assertIsNone(proposal["rawOpeningNumber"])
        self.assertEqual(proposal["unauthorizedFillStatus"], "NOT_ESTABLISHED")

    def test_source_quality_duplicate_ambiguity_and_cap_fail_closed(self) -> None:
        reviewed = source("F-OK")
        unresolved = source("F-UNKNOWN", approval="UNKNOWN")
        wrong = source("F-SECTION", section="AR")
        pd = source("F-PD", stages=["PD"])
        text = '(обрамление отверстия "№7" 750х750мм - 1шт.)'
        blocks = [box(text, 100), box(text, 130),
                  box('отверстие №7 750х750мм и 800х800мм', 160),
                  box("отверстие №7 " + "a" * 200, 190)]
        docs = [(s, artifact(s, [page(1, blocks)]))
                for s in (reviewed, unresolved, wrong, pd)]
        ocr = page(1, [box("\ufffd")])
        reviewed_art = artifact(reviewed, [page(1, blocks), ocr])
        ocr["pageNumber"] = 2
        result = evaluate_kr065_opening_proposals(
            OBJECT, MANIFEST_HASH, [d[0] for d in docs],
            [reviewed_art, *[d[1] for d in docs[1:]]])
        row = result["codeRows"][0]
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"]), (1, 1, 1))
        self.assertEqual((row["proposalCount"], row["duplicateAnchorCount"],
                          row["oversizeAnchorLineCount"], row["abstentionCount"]),
                         (1, 1, 1, 2))
        self.assertIn("SOURCE_REVIEW_REQUIRED", row["reasonCodes"])
        self.assertIn("SOURCE_ROLE_NOT_ALLOWED", row["reasonCodes"])
        self.assertIn("SOURCE_STAGE_UNRESOLVED", row["reasonCodes"])
        self.assertIn("OCR_REQUIRED_DEFERRED", row["reasonCodes"])
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
        many = [box(f'(обрамление отверстия "№{n}" 750х750мм - 1шт.)', n * 20)
                for n in range(MAX_PROPOSALS + 3)]
        capped = evaluate_kr065_opening_proposals(
            OBJECT, MANIFEST_HASH, [reviewed], [artifact(reviewed, [page(1, many)])])
        cap_row = capped["codeRows"][0]
        self.assertEqual(cap_row["proposalCount"], MAX_PROPOSALS + 3)
        self.assertEqual(cap_row["truncatedProposalCount"], 3)
        self.assertEqual(len(cap_row["proposals"]), MAX_PROPOSALS)

    def test_provenance_tamper_and_fenced_loader(self) -> None:
        src = source("F-OK")
        art = artifact(src, [page(1, [box('отверстие "№7" 750х750мм')])])
        bad = copy.deepcopy(art)
        bad["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_kr065_opening_proposals(OBJECT, MANIFEST_HASH, [src], [bad])
        bad = copy.deepcopy(art)
        bad["pages"][0]["blocks"][0]["text"] += " tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_kr065_opening_proposals(OBJECT, MANIFEST_HASH, [src], [bad])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_kr065_opening_proposals(OBJECT, MANIFEST_HASH, [src, src], [art])
        lease, attempt = ({"objectId": OBJECT, "inputManifestHash": MANIFEST_HASH},
                          {"attemptId": "ATT-SYNTHETIC"})
        with patch("inspector_worker.kr065_opening_proposals.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_kr065_opening_proposals(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")

    @unittest.skipUnless(PUBLIC_MANIFEST.is_file()
                         and all((PUBLIC_PDFS / f"{file_id}.pdf").is_file()
                                 for file_id in EXPECTED_SHA),
                         "original permitted public PDFs unavailable")
    def test_original_public_pdf_manifest_sha_and_three_pages(self) -> None:
        rows = {row["file_id"]: row for row in
                map(json.loads, PUBLIC_MANIFEST.read_text().splitlines())
                if row.get("file_id") in EXPECTED_SHA}
        self.assertEqual(set(rows), set(EXPECTED_SHA))
        for file_id, expected in EXPECTED_SHA.items():
            row = rows[file_id]
            self.assertEqual((row["split"], row["distribution_status"],
                              row["label_visibility"], row["stage"], row["section"]),
                             ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", "RD", "KR"))
            path = PUBLIC_PDFS / f"{file_id}.pdf"
            self.assertEqual(path.stat().st_size, row["size_bytes"])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected)
            self.assertEqual(expected, row["sha256"])
        expectations = {"F0141": (23, {("7", "750х750мм"),
                                         ("8", "1400х950(h) мм"),
                                         ("14", "800х650(h) мм")}),
                        "F0143": (21, {("5", "1400х950(h) мм")})}
        for file_id, (number, wanted) in expectations.items():
            real_page = _real_page(PUBLIC_PDFS / f"{file_id}.pdf", number)
            self.assertEqual(real_page["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
            proposals, abstentions, oversize, duplicates = _page_proposals(real_page)
            labels = {(p["rawOpeningNumber"], p["rawDimensionsText"]) for p in proposals
                      if p["proposalKind"] == "OPENING_LABEL_DIMENSION_NAVIGATION"}
            self.assertEqual(labels, wanted)
            self.assertEqual((abstentions, oversize, duplicates), ([], 0, 0))
        closure_page = _real_page(PUBLIC_PDFS / "F0142.pdf", 12)
        proposals, abstentions, _, duplicates = _page_proposals(closure_page)
        closures = [p for p in proposals
                    if p["proposalKind"] == "DESIGNED_CLOSURE_HEADING_NAVIGATION"]
        self.assertEqual(len(closures), 2)
        self.assertEqual(duplicates, 1)
        self.assertIn("DUPLICATE_HEADING_CONTEXT_UNVERIFIED",
                      [item["reasonCode"] for item in abstentions])
        self.assertTrue(all(p["unauthorizedFillStatus"] == "NOT_ESTABLISHED"
                            for p in closures))


if __name__ == "__main__":
    unittest.main()
