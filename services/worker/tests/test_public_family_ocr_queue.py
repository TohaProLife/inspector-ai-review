from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.candidate_source_matrix import build_candidate_source_matrix
from inspector_worker.public_family_ocr_queue import (
    PublicFamilyOcrQueueError, _has_local_family_hint, _neighbor_hints, _rank_family, _source_plans,
    build_public_family_ocr_queue,
)
from inspector_worker.public_document_index import _version_hash, load_public_manifest


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
AUDIT = ROOT / "output/public-index-20260927/index-audit.json"


class FamilyOcrQueueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = build_candidate_source_matrix(MANIFEST)
        cls.manifest = load_public_manifest(MANIFEST)

    def test_source_plans_retain_uncertainty_and_exclude_ground_truth(self) -> None:
        plans = _source_plans(self.matrix, self.manifest)
        self.assertEqual(sum(item["codeCount"] for item in self.matrix["families"]), 47)
        self.assertEqual(len(plans), len(self.matrix["families"]))
        for by_source in plans.values():
            self.assertNotIn("F0194", by_source)
        kr = plans["DECREASE"]["F0105"]
        self.assertIn(("KR-061", "EXPECTED"), kr["codes"])
        self.assertEqual(kr["codes"][("KR-061", "EXPECTED")], "EXACT_CATEGORY")
        self.assertTrue(kr["sameObjectExactPair"])
        pz = plans["RELATIVE_DELTA"]["F0150"]
        self.assertEqual(pz["codes"][("PZ-002", "EXPECTED")], "UNRESOLVED_SECTION")

    def test_rank_is_bounded_deterministic_and_diverse(self) -> None:
        entries = [{"sourceFileId": "F0101", "pageNumber": page, "priority": 50}
                   for page in range(1, 9)]
        entries += [{"sourceFileId": "F0102", "pageNumber": 2, "priority": 40}]
        selected, omitted = _rank_family(entries, 4)
        self.assertEqual(len(selected), 4)
        self.assertEqual(omitted, 5)
        self.assertEqual([item["sourceFileId"] for item in selected[:3]],
                         ["F0101", "F0101", "F0101"])
        self.assertEqual(selected[3]["sourceFileId"], "F0102")
        self.assertEqual(_rank_family(entries, 4), (selected, omitted))

    def test_unpinned_source_needs_page_local_hint(self) -> None:
        unresolved = {
            "codeRoles": [{"sourceCategory": "UNRESOLVED_SECTION"}],
            "neighborHints": [],
        }
        self.assertFalse(_has_local_family_hint(unresolved))
        title_only = copy.deepcopy(unresolved)
        title_only["neighborHints"] = [{"matchedLabelCodes": [], "tocSectionMark": False}]
        self.assertFalse(_has_local_family_hint(title_only))
        title_only["neighborHints"][0]["tocSectionMark"] = True
        self.assertFalse(_has_local_family_hint(title_only))
        title_only["neighborHints"][0]["tocSectionMark"] = False
        title_only["neighborHints"][0]["matchedLabelCodes"] = ["PZ-002"]
        self.assertTrue(_has_local_family_hint(title_only))
        exact = copy.deepcopy(unresolved)
        exact["codeRoles"] = [{"sourceCategory": "EXACT_CATEGORY"}]
        self.assertTrue(_has_local_family_hint(exact))

    def test_neighbor_hints_are_page_local_and_literal(self) -> None:
        row = {"page_number": 5}
        neighbors = [
            {"page_number": 4, "disposition": "TEXT_LAYER_CANDIDATE",
             "text": "Содержание: Раздел 4 КР; толщина стены"},
            {"page_number": 5, "disposition": "OCR_REQUIRED",
             "text": "толщина стены"},
            {"page_number": 6, "disposition": "TEXT_LAYER_CANDIDATE",
             "text": "иная характеристика"},
        ]
        hints, reasons = _neighbor_hints(
            row, neighbors, {("KR-061", "EXPECTED"): "EXACT_CATEGORY"},
            {"KR-061": ("толщина стены",)},
            {("KR-061", "EXPECTED"): {"KR"}},
        )
        self.assertEqual(len(hints), 1)
        self.assertEqual(hints[0]["pageNumber"], 4)
        self.assertEqual(hints[0]["matchedLabelCodes"], ["KR-061"])
        self.assertTrue(hints[0]["tocSectionMark"])
        self.assertEqual(reasons, ["NEIGHBOR_TEXT_LABEL", "NEIGHBOR_TOC_SECTION_MARK"])

    def test_stale_audit_and_truncated_matrix_fail_before_index_read(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            audit = base / "audit.json"
            matrix = base / "matrix.json"
            matrix.write_text(json.dumps(self.matrix, ensure_ascii=False), encoding="utf-8")
            index = base / "index"
            index.mkdir()
            # This synthetic receipt tests gate ordering only. It is never
            # persisted as a real audit of the public index.
            pdfs = [row for row in self.manifest if row["extension"] == ".pdf"]
            pages = sum(row["pdf_pages"] for row in pdfs)
            expected = {"sourceCount": len(self.manifest), "pdfSources": len(pdfs),
                        "pdfPages": pages, "txtInventorySources": len(self.manifest) - len(pdfs)}
            original = {
                "schemaVersion": "public-document-index-audit-v1", "status": "PASS",
                "fixturePurpose": "SYNTHETIC_GATE_ORDER_TEST_ONLY",
                "manifestSha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
                "indexVersionHash": _version_hash(), "findingCount": 0,
                "fatalFindingCount": 0, "findings": [], "findingsTruncated": 0,
                "expected": expected,
                "actual": {"sourceCount": expected["sourceCount"],
                           "completePdfSources": len(pdfs),
                           "txtInventorySources": expected["txtInventorySources"],
                           "indexedPages": pages, "ftsRows": pages, "ftsMapRows": pages,
                           "verifiedPageArtifacts": pages},
                "sources": [{"sourceId": row["file_id"], "objectId": row["object_id"],
                             "stage": row["stage"], "section": row["section"],
                             "status": "COMPLETE" if row["extension"] == ".pdf" else "SKIPPED_GROUND_TRUTH_TXT",
                             "expectedPages": row["pdf_pages"] or 0,
                             "indexedPages": row["pdf_pages"] or 0, "issueCount": 0}
                            for row in self.manifest],
            }
            changed = copy.deepcopy(original)
            changed["findingsTruncated"] = 1
            audit.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyOcrQueueError, "audit"):
                build_public_family_ocr_queue(MANIFEST, index, audit, matrix)
            audit.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")
            truncated = copy.deepcopy(self.matrix)
            truncated["codes"] = truncated["codes"][:-1]
            matrix.write_text(json.dumps(truncated, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyOcrQueueError, "matrix"):
                build_public_family_ocr_queue(MANIFEST, index, audit, matrix)
            matrix.write_text(json.dumps(self.matrix, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyOcrQueueError, "database missing"):
                build_public_family_ocr_queue(MANIFEST, index, audit, matrix)

    def test_manifest_byte_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            manifest = base / "document_manifest.jsonl"
            manifest.write_bytes(MANIFEST.read_bytes() + b"\n")
            with self.assertRaisesRegex(PublicFamilyOcrQueueError, "SHA-256"):
                build_public_family_ocr_queue(
                    manifest, base, AUDIT, base / "matrix.json",
                )
        self.assertEqual(hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
                         self.matrix["manifestSha256"])


if __name__ == "__main__":
    unittest.main()
