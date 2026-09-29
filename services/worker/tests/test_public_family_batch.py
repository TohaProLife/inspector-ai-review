from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.public_document_index import build_public_index
from inspector_worker.public_family_batch import (
    PublicFamilyBatchError, discover_public_family_batch,
)


@requires_posix_storage
class PublicFamilyBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.rows = []
        self._pdf("F0001", "PD", "pd.pdf", [
            ["Load bearing wall thickness 220 mm on second floor.",
             "Wall detail and reinforcement plan for building block A."],
            [],
            ["Wall thickness 200 mm at third floor."],
            ["Wall thickness 200 mm at fourth floor."],
            ["Wall thickness 200 mm at fifth floor."],
        ])
        self._pdf("F0002", "RD", "rd.pdf", [
            ["Monolithic wall thickness 180 mm on second floor.",
             "Concrete column diameter 400 mm in structural zone A."],
        ])
        self.manifest = self.root / "document_manifest.jsonl"
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in self.rows), encoding="utf-8")
        self.index = self.root / "index"
        summary = build_public_index(self.manifest, self.index, materials_root=self.materials)
        self.assertEqual(summary["completeSources"], 2)

    def _pdf(self, source_id: str, stage: str, name: str,
             pages: list[list[str]]) -> None:
        path = self.materials / name
        document = fitz.open()
        for texts in pages:
            page = document.new_page()
            for line_number, text in enumerate(texts):
                page.insert_text((70, 70 + 45 * line_number), text, fontsize=12)
        document.save(path)
        document.close()
        self.rows.append({
            "file_id": source_id, "object_id": "OBJ-1", "stage": stage, "section": "KR",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "relative_path": name,
            "extension": ".pdf", "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pdf_pages": len(pages),
            "annotation_status": "UNLABELED",
        })

    def run_batch(self, **kwargs: object) -> dict:
        return discover_public_family_batch(
            self.manifest, self.index, family="DECREASE",
            source_ids=["F0001", "F0002"], terms=["wall*", "thickness*"],
            **kwargs,
        )

    def test_bounded_fts_hits_exact_block_evidence_and_ocr_queue(self) -> None:
        report = self.run_batch()
        self.assertEqual(report["purpose"], "REVIEW_CANDIDATES_ONLY")
        self.assertEqual(report["scope"], "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY")
        self.assertEqual({item["sourceFileId"] for item in report["candidates"]},
                         {"F0001", "F0002"})
        self.assertEqual(report["findingCount"], None)
        self.assertEqual(report["parameterCoverage"], None)
        self.assertEqual(len(report["ocrQueue"]), 1)
        self.assertEqual(report["ocrQueue"][0]["status"], "TARGETED_OCR_REQUIRED")
        self.assertEqual(report["ocrQueue"][0]["pageNumber"], 2)
        self.assertEqual(report["ocrQueue"][0]["quality"]["disposition"], "OCR_REQUIRED")
        self.assertEqual(len(report["reviewQueue"]), len(report["candidates"]))
        for candidate in report["candidates"]:
            evidence = candidate["evidence"]
            self.assertEqual(candidate["reviewStatus"], "NEEDS_HUMAN_REVIEW")
            self.assertEqual(evidence["candidateStatus"], "CANDIDATE")
            self.assertEqual(evidence["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
            self.assertEqual(evidence["sourceFileId"], candidate["sourceFileId"])
            self.assertEqual(evidence["parserProvenance"], "PDFMINER")
            self.assertEqual(len(evidence["sourceSha256"]), 64)
            self.assertEqual(len(evidence["evidenceSha256"]), 64)
            self.assertEqual(evidence["selectedBlockIndices"],
                             [block["blockIndex"] for block in candidate["matchedTermsByBlock"]])
            self.assertTrue(all(block["terms"] for block in candidate["matchedTermsByBlock"]))

    def test_pagination_and_block_truncation_are_explicit(self) -> None:
        page_limited = self.run_batch(max_pages=1)
        self.assertEqual(len(page_limited["candidates"]), 1)
        self.assertTrue(page_limited["truncated"]["textPages"])
        balanced = self.run_batch(max_pages=2)
        self.assertEqual({item["sourceFileId"] for item in balanced["candidates"]},
                         {"F0001", "F0002"})
        self.assertEqual(balanced["sourceSelection"], [
            {"sourceFileId": "F0001", "stage": "PD", "matchedTextPages": 4,
             "selectedTextPages": 1, "omittedTextPages": 3, "ocrRequiredPages": 1},
            {"sourceFileId": "F0002", "stage": "RD", "matchedTextPages": 1,
             "selectedTextPages": 1, "omittedTextPages": 0, "ocrRequiredPages": 0},
        ])
        block_limited = self.run_batch(max_blocks_per_page=1)
        self.assertTrue(any(item["blocksTruncated"] for item in block_limited["candidates"]))

    def test_hidden_and_metadata_txt_source_refused_before_fts(self) -> None:
        for source_id in ("F0194", "F0999"):
            with self.subTest(source_id=source_id), self.assertRaisesRegex(
                    PublicFamilyBatchError, "outside public PDF allowlist"):
                discover_public_family_batch(self.manifest, self.index, family="DECREASE",
                                             source_ids=[source_id], terms=["wall*"])
        hidden = {**self.rows[0], "file_id": "F0003", "relative_path": "hidden.pdf",
                  "split": "TEST_HIDDEN"}
        self.manifest.write_text(self.manifest.read_text(encoding="utf-8")
                                 + json.dumps(hidden) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(PublicFamilyBatchError, "outside public PDF allowlist"):
            discover_public_family_batch(self.manifest, self.index, family="DECREASE",
                                         source_ids=["F0003"], terms=["wall*"])

    def test_incomplete_and_corrupt_source_fail_closed(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute("UPDATE sources SET status='INDEXING' WHERE source_id='F0001'")
        with self.assertRaisesRegex(PublicFamilyBatchError, "not COMPLETE"):
            self.run_batch()
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute("UPDATE sources SET status='COMPLETE', source_sha256=? "
                               "WHERE source_id='F0001'", ("0" * 64,))
        with self.assertRaisesRegex(PublicFamilyBatchError, "metadata"):
            self.run_batch()

    def test_tampered_page_artifact_refused(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            artifact, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        (self.index / artifact).write_bytes(b"corrupted cache")
        with self.assertRaisesRegex(ValueError, "hash/schema validation"):
            self.run_batch()

    def test_missing_matching_fts_row_refused_before_search(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute(
                "DELETE FROM page_fts WHERE source_id='F0002' AND page_number=1")
        with self.assertRaisesRegex(PublicFamilyBatchError, "missing, duplicate or extra FTS"):
            self.run_batch()

    def test_duplicate_fts_row_refused(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute(
                "INSERT INTO page_fts(source_id,page_number,text) VALUES('F0002',1,'wall')")
        with self.assertRaisesRegex(PublicFamilyBatchError, "missing, duplicate or extra FTS"):
            self.run_batch()

    def test_extra_fts_row_refused(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute(
                "INSERT INTO page_fts(source_id,page_number,text) VALUES('F0002',99,'wall')")
        with self.assertRaisesRegex(PublicFamilyBatchError, "missing, duplicate or extra FTS"):
            self.run_batch()

    def test_zero_fts_hits_does_not_claim_absence(self) -> None:
        result = discover_public_family_batch(
            self.manifest, self.index, family="DECREASE",
            source_ids=["F0001", "F0002"], terms=["seismology*"],
        )
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["reviewQueue"], [])
        self.assertEqual(len(result["ocrQueue"]), 1)
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])

    def test_invalid_search_scope_and_terms_refused(self) -> None:
        with self.assertRaisesRegex(PublicFamilyBatchError, "together"):
            discover_public_family_batch(self.manifest, self.index, source_ids=["F0001"])
        with self.assertRaisesRegex(PublicFamilyBatchError, "requires source"):
            discover_public_family_batch(self.manifest, self.index, family="RELATIVE_DELTA")
        for term in ("wall OR hidden", "'wall'", "*wall", "1", "w" * 41):
            with self.subTest(term=term), self.assertRaises(PublicFamilyBatchError):
                discover_public_family_batch(self.manifest, self.index, family="DECREASE",
                                             source_ids=["F0001"], terms=[term])
        with self.assertRaises(PublicFamilyBatchError):
            self.run_batch(max_pages=101)


if __name__ == "__main__":
    unittest.main()
