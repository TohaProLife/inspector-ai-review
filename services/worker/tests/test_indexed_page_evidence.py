from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.indexed_page_evidence import (
    IndexedPageEvidenceError, IndexedPageNeedsOcr, load_indexed_page_evidence,
)
from inspector_worker.public_document_index import build_public_index


@requires_posix_storage
class IndexedPageEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.pdf = self.materials / "plan.pdf"
        document = fitz.open()
        first = document.new_page()
        first.insert_text((70, 70), "Section 1 Structural plan", fontsize=12)
        first.insert_text((70, 100), "Slab thickness   220 mm   floor 2", fontsize=12)
        document.new_page()  # No text layer; never treat as missing value.
        document.save(self.pdf)
        document.close()
        self.row = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
            "extension": ".pdf", "size_bytes": self.pdf.stat().st_size,
            "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(), "pdf_pages": 2,
            "annotation_status": "UNLABELED",
        }
        self.manifest = self.root / "document_manifest.jsonl"
        self.manifest.write_text(json.dumps(self.row, ensure_ascii=False) + "\n", encoding="utf-8")
        self.index = self.root / "index"
        summary = build_public_index(self.manifest, self.index, materials_root=self.materials)
        self.assertEqual(summary["completeSources"], 1)

    def read(self, page: int = 1, indices: list[int] | None = None, **scope: str) -> dict:
        return load_indexed_page_evidence(
            self.manifest, self.index, "F0001", page,
            expected_object_id=scope.get("object", "OBJ-1"),
            expected_stage=scope.get("stage", "PD"),
            expected_section=scope.get("section", "KR"),
            block_indices=indices if indices is not None else [0],
        )

    def execute(self, sql: str, values: tuple = ()) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            connection.execute(sql, values)

    def test_selected_original_blocks_lines_provenance_and_stable_hash(self) -> None:
        one = self.read()
        two = self.read()
        self.assertEqual(one, two)
        self.assertEqual(one["candidateStatus"], "CANDIDATE")
        self.assertEqual(one["sourceSha256"], self.row["sha256"])
        self.assertEqual(one["sourceFileId"], "F0001")
        self.assertEqual((one["objectId"], one["stage"], one["section"]), ("OBJ-1", "PD", "KR"))
        self.assertEqual(one["pageNumber"], 1)
        self.assertEqual(one["parserProvenance"], "PDFMINER")
        self.assertEqual(one["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
        self.assertEqual(one["selectedBlockIndices"], [0])
        self.assertEqual(one["blocks"][0]["blockIndex"], 0)
        self.assertTrue(one["lines"])
        self.assertTrue(all(line["blockIndex"] == 0 for line in one["lines"]))
        self.assertEqual(len(one["pageArtifactSha256"]), 64)
        self.assertEqual(len(one["evidenceSha256"]), 64)
        second_block = self.read(indices=[1])
        self.assertEqual(second_block["blocks"][0]["blockIndex"], 1)
        self.assertTrue(any("Slab thickness" in line["text"] for line in second_block["lines"]))
        self.assertTrue(second_block["tableRowCandidates"])

    def test_wrong_object_stage_section_and_hidden_manifest_refused(self) -> None:
        for scope in ({"object": "OBJ-2"}, {"stage": "RD"}, {"section": "AR"}):
            with self.subTest(scope=scope), self.assertRaisesRegex(IndexedPageEvidenceError, "scope|manifest"):
                self.read(**scope)
        self.manifest.write_text(json.dumps({**self.row, "split": "TEST_HIDDEN"}) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "allowlist"):
            self.read()

    def test_incomplete_source_and_page_count_refused(self) -> None:
        self.execute("UPDATE sources SET status='INDEXING' WHERE source_id='F0001'")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "COMPLETE"):
            self.read()
        self.execute("UPDATE sources SET status='COMPLETE', observed_pages=1 WHERE source_id='F0001'")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "page count"):
            self.read()
        self.execute("UPDATE sources SET observed_pages=2 WHERE source_id='F0001'")
        self.execute("DELETE FROM pages WHERE source_id='F0001' AND page_number=2")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "incomplete"):
            self.read()

    def test_wrong_source_page_and_artifact_sha_refused(self) -> None:
        self.execute("UPDATE sources SET source_sha256=? WHERE source_id='F0001'", ("0" * 64,))
        with self.assertRaisesRegex(IndexedPageEvidenceError, "metadata"):
            self.read()
        self.execute("UPDATE sources SET source_sha256=? WHERE source_id='F0001'", (self.row["sha256"],))
        self.execute("UPDATE pages SET source_sha256=? WHERE source_id='F0001' AND page_number=1", ("0" * 64,))
        with self.assertRaisesRegex(IndexedPageEvidenceError, "SHA metadata"):
            self.read()
        self.execute("UPDATE pages SET source_sha256=? WHERE source_id='F0001' AND page_number=1", (self.row["sha256"],))
        self.execute("UPDATE pages SET artifact_sha256=? WHERE source_id='F0001' AND page_number=1", ("0" * 64,))
        with self.assertRaisesRegex(IndexedPageEvidenceError, "artifact hash"):
            self.read()

    def test_modified_gzip_file_refused_without_repair_or_write(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            relative, = connection.execute("SELECT artifact_path FROM pages "
                                           "WHERE source_id='F0001' AND page_number=1").fetchone()
        artifact = self.index / relative
        artifact.write_bytes(b"tampered")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "artifact hash"):
            self.read()
        self.assertEqual(artifact.read_bytes(), b"tampered")

    def test_parser_and_page_disposition_mismatch_refused(self) -> None:
        self.execute("UPDATE pages SET parser_provenance='PYMUPDF' WHERE source_id='F0001' AND page_number=1")
        with self.assertRaisesRegex(IndexedPageEvidenceError, "artifact hash"):
            self.read()
        self.execute("UPDATE pages SET parser_provenance='PDFMINER',disposition='OCR_REQUIRED' "
                     "WHERE source_id='F0001' AND page_number=1")
        with self.assertRaises(IndexedPageEvidenceError):
            self.read()

    def test_ocr_required_refused_with_explicit_signal(self) -> None:
        with self.assertRaisesRegex(IndexedPageNeedsOcr, "targeted OCR"):
            self.read(page=2)

    def test_selection_is_explicit_bounded_and_non_truncating(self) -> None:
        for indices in ([], [0, 0], [-1], [True], [999], list(range(65))):
            with self.subTest(indices=indices[:4]), self.assertRaises(IndexedPageEvidenceError):
                self.read(indices=indices)
        with self.assertRaises(IndexedPageEvidenceError):
            self.read(page=3)


if __name__ == "__main__":
    unittest.main()
