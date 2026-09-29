from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
import zipfile
from pathlib import Path
from unittest import mock

import fitz

from inspector_worker.public_document_index import (
    _pymupdf_page_artifact, _writer_lock, build_public_index, finish_incomplete_public_index,
    get_indexed_page, load_public_manifest, initialize_index, repair_failed_public_index,
    readonly_index_uri, search_index,
)


class PublicDocumentIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.output = self.root / "index"
        self.manifest = self.root / "manifest.jsonl"
        self.pdf = self.materials / "drawings" / "plan.pdf"
        self.pdf.parent.mkdir()
        document = fitz.open()
        first = document.new_page()
        first.insert_text((70, 70), "Section 5 Structural plan", fontsize=12)
        first.insert_text((70, 95), "Apartment count   92   18", fontsize=12)
        second = document.new_page()
        second.insert_text((70, 70), "Foundation 600x1500", fontsize=12)
        document.new_page()  # OCR_REQUIRED: empty text layer
        document.save(self.pdf)
        document.close()
        self.row = self._row("F0001", "drawings/plan.pdf", self.pdf, pages=3)
        self.manifest.write_text(json.dumps(self.row) + "\n", encoding="utf-8")

    @staticmethod
    def _row(source_id: str, relative: str, path: Path, pages: int | None) -> dict:
        return {"file_id": source_id, "object_id": "OBJ-1", "stage": "PD", "section": "KR",
                "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                "label_visibility": "PUBLIC_TRAIN", "relative_path": relative,
                "extension": path.suffix, "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pdf_pages": pages,
                "annotation_status": "UNLABELED"}

    def test_readonly_uri_never_hides_pending_wal(self) -> None:
        self.output.mkdir()
        database = self.output / "probe.sqlite3"
        connection = sqlite3.connect(database)
        try:
            self.assertEqual(connection.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            connection.execute("CREATE TABLE probe(value INTEGER)")
            connection.execute("INSERT INTO probe VALUES (7)")
            connection.commit()
            self.assertGreater(Path(str(database) + "-wal").stat().st_size, 0)
            self.assertTrue(readonly_index_uri(database).endswith("?mode=ro"))
        finally:
            connection.close()
        self.assertTrue(readonly_index_uri(database).endswith("?mode=ro&immutable=1"))

    @requires_posix_storage
    def test_build_query_quality_candidates_and_reuse(self) -> None:
        first = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(first["completeSources"], 1)
        self.assertEqual(first["pageCount"], 3)
        self.assertEqual(first["ocrRequiredPages"], 1)
        page = get_indexed_page(self.output, "F0001", 1)
        self.assertEqual(page["page"]["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
        self.assertEqual(page["source"]["stage"], "PD")
        self.assertTrue(any("Apartment count" in block["text"] for block in page["page"]["blocks"]))
        self.assertTrue(any("Apartment count" in line["text"] for line in page["page"]["lines"]))
        self.assertTrue(page["page"]["sectionCandidates"])
        self.assertTrue(page["page"]["tableRowCandidates"])
        self.assertTrue(all(item["status"] == "CANDIDATE" for item in
                            page["page"]["sectionCandidates"] + page["page"]["tableRowCandidates"]))
        self.assertEqual(get_indexed_page(self.output, "F0001", 3)["page"]["quality"]["disposition"], "OCR_REQUIRED")
        matches = search_index(self.output, "Foundation", object_id="OBJ-1", stage="PD", section="KR")
        self.assertEqual([item["page_number"] for item in matches], [2])
        self.assertEqual(search_index(self.output, "Foundation", stage="RD"), [])
        reused = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(reused["reusedSources"], 1)
        self.assertEqual(reused["pageCount"], 3)
        self.assertEqual(reused["ocrRequiredPages"], 1)
        self.assertEqual(len(search_index(self.output, "Foundation")), 1)

    @requires_posix_storage
    def test_cache_corruption_is_reextracted(self) -> None:
        build_public_index(self.manifest, self.output, materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            rel, = connection.execute("SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=2").fetchone()
        (self.output / rel).write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            get_indexed_page(self.output, "F0001", 2)
        resumed = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(resumed["completeSources"], 1)
        self.assertEqual(resumed["reusedSources"], 0)
        self.assertEqual(len(search_index(self.output, "Foundation")), 1)

    @requires_posix_storage
    def test_missing_fts_row_is_refused(self) -> None:
        build_public_index(self.manifest, self.output, materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            connection.execute("DELETE FROM page_fts WHERE source_id='F0001' AND page_number=2")
        with self.assertRaisesRegex(ValueError,"FTS rowid map/page/FTS counts differ"):
            build_public_index(self.manifest, self.output, materials_root=self.materials)

    @requires_posix_storage
    def test_interrupted_document_resumes_page_commits(self) -> None:
        build_public_index(self.manifest, self.output, materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            before = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()[0]
            connection.execute("UPDATE sources SET status='INDEXING',observed_pages=NULL WHERE source_id='F0001'")
            connection.execute("DELETE FROM pages WHERE source_id='F0001' AND page_number=3")
            connection.execute("DELETE FROM page_fts WHERE source_id='F0001' AND page_number=3")
            connection.execute("DELETE FROM page_fts_map WHERE source_id='F0001' AND page_number=3")
        result = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(result["completeSources"], 1)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            after = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()[0]
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pages WHERE source_id='F0001'").fetchone()[0], 3)
        self.assertEqual(before, after)

    @requires_posix_storage
    def test_bad_hash_and_hidden_source_are_not_indexed(self) -> None:
        self.pdf.write_bytes(self.pdf.read_bytes() + b"tamper")
        result = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(result["failedSources"], ["F0001"])
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0], 0)
        hidden = dict(self.row, file_id="F0002", split="TEST_HIDDEN")
        self.manifest.write_text(json.dumps(hidden) + "\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_public_manifest(self.manifest)

    @requires_posix_storage
    def test_ground_truth_txt_inventory_only(self) -> None:
        ground_truth = self.materials / "answers.txt"
        ground_truth.write_text("secret labels", encoding="utf-8")
        row = self._row("F0194", "answers.txt", ground_truth, pages=None)
        row["annotation_status"] = "GROUND_TRUTH_INDEX"
        self.manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
        result = build_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(result["skippedGroundTruthTxt"], 1)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM page_fts").fetchone()[0], 0)

    @requires_posix_storage
    def test_archive_exact_member_and_duplicate_rejection(self) -> None:
        archive = self.root / "data.zip"
        with zipfile.ZipFile(archive, "w") as destination:
            destination.write(self.pdf, "root/drawings/plan.pdf")
        result = build_public_index(self.manifest, self.output, archive=archive)
        self.assertEqual(result["completeSources"], 1)
        duplicate = self.root / "duplicate.zip"
        with zipfile.ZipFile(duplicate, "w") as destination:
            destination.write(self.pdf, "root/drawings/plan.pdf")
            destination.write(self.pdf, "other/drawings/plan.pdf")
        with self.assertRaises(ValueError):
            build_public_index(self.manifest, self.root / "other-index", archive=duplicate)

    @requires_posix_storage
    def test_parallel_sources_have_unique_pages_and_fts_rows(self) -> None:
        second_pdf = self.materials / "drawings" / "plan2.pdf"
        second_pdf.write_bytes(self.pdf.read_bytes())
        second_row = self._row("F0002", "drawings/plan2.pdf", second_pdf, pages=3)
        self.manifest.write_text(json.dumps(self.row) + "\n" + json.dumps(second_row) + "\n",
                                 encoding="utf-8")
        result = build_public_index(self.manifest, self.output, materials_root=self.materials, workers=2)
        self.assertEqual(result["completeSources"], 2)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0], 6)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM page_fts").fetchone()[0], 6)
        self.assertEqual(len(search_index(self.output, "Foundation")), 2)

    def test_manifest_path_traversal_and_duplicate_id(self) -> None:
        bad = dict(self.row, relative_path="../drawings/plan.pdf")
        self.manifest.write_text(json.dumps(bad) + "\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_public_manifest(self.manifest)

    @requires_posix_storage
    def test_failed_only_pymupdf_repair_preserves_complete_source(self) -> None:
        other_pdf = self.materials / "drawings" / "other.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text((80, 80), "Repair source marker 123 456", fontsize=12)
        document.save(other_pdf)
        document.close()
        other = self._row("F0002", "drawings/other.pdf", other_pdf, pages=1)
        self.manifest.write_text(json.dumps(self.row) + "\n" + json.dumps(other) + "\n",
                                 encoding="utf-8")
        build_public_index(self.manifest, self.output, materials_root=self.materials,
                           source_ids={"F0001"})
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            before = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()[0]
        with mock.patch("pdfminer.high_level.extract_pages", side_effect=ValueError("Invalid dictionary construct")):
            failed = build_public_index(self.manifest, self.output, materials_root=self.materials,
                                        source_ids={"F0002"})
        self.assertEqual(failed["failedSources"], ["F0002"])
        with self.assertRaises(ValueError):
            repair_failed_public_index(self.manifest, self.output, materials_root=self.materials,
                                       source_ids={"F0001"})
        result = repair_failed_public_index(self.manifest, self.output, materials_root=self.materials)
        self.assertEqual(result["repairedSources"], 1)
        self.assertEqual(result["repairedPages"], 1)
        self.assertEqual(get_indexed_page(self.output, "F0002", 1)["parserProvenance"], "PYMUPDF")
        self.assertEqual(get_indexed_page(self.output, "F0002", 1)["page"]["parserProvenance"], "PYMUPDF")
        self.assertEqual(get_indexed_page(self.output, "F0001", 1)["parserProvenance"], "PDFMINER")
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            after = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()[0]
        self.assertEqual(before, after)
        self.assertEqual(len(search_index(self.output, "Repair")), 1)
        with mock.patch("pdfminer.high_level.extract_pages", side_effect=AssertionError("should reuse cache")):
            reused = build_public_index(self.manifest, self.output, materials_root=self.materials,
                                        source_ids={"F0002"})
        self.assertEqual(reused["reusedSources"], 1)
        self.assertEqual(repair_failed_public_index(self.manifest, self.output,
                                                   materials_root=self.materials)["selectedFailedSources"], 0)

    def test_additive_parser_column_migrates_existing_v3_index(self) -> None:
        self.output.mkdir()
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            connection.execute("""CREATE TABLE pages (
                source_id TEXT, page_number INTEGER, source_sha256 TEXT,
                disposition TEXT, artifact_path TEXT, artifact_sha256 TEXT,
                block_count INTEGER, section_candidate_count INTEGER,
                table_candidate_count INTEGER, text_chars INTEGER)""")
        initialize_index(self.output)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(pages)")}
            self.assertIn("parser_provenance", columns)

    @requires_posix_storage
    def test_legacy_fts_backfill_uses_rowid_lookup(self) -> None:
        build_public_index(self.manifest,self.output,materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            connection.execute("DROP TABLE page_fts_map")
            connection.execute("DELETE FROM meta WHERE key='ftsRowidMapVersion'")
        initialize_index(self.output)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM page_fts_map").fetchone()[0],3)
            rowid, = connection.execute("SELECT fts_rowid FROM page_fts_map WHERE source_id='F0001' AND page_number=1").fetchone()
            self.assertIsInstance(rowid,int)
            map_plan = connection.execute("EXPLAIN QUERY PLAN SELECT fts_rowid FROM page_fts_map WHERE source_id=? AND page_number=?",
                                          ("F0001",1)).fetchone()[3]
            text_plan = connection.execute("EXPLAIN QUERY PLAN SELECT text FROM page_fts WHERE rowid=?",(rowid,)).fetchone()[3]
            self.assertIn("USING INDEX",map_plan)
            self.assertIn("INDEX 0:=",text_plan)
        self.assertEqual(build_public_index(self.manifest,self.output,
                                            materials_root=self.materials)["reusedSources"],1)

    @requires_posix_storage
    def test_legacy_fts_backfill_refuses_duplicate_and_orphan_rows(self) -> None:
        for orphan in (False,True):
            with self.subTest(orphan=orphan), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "index"
                build_public_index(self.manifest,output,materials_root=self.materials)
                with contextlib.closing(sqlite3.connect(output / "index.sqlite3")) as connection, connection:
                    connection.execute("DROP TABLE page_fts_map")
                    connection.execute("DELETE FROM meta WHERE key='ftsRowidMapVersion'")
                    if orphan:
                        connection.execute("INSERT INTO page_fts(source_id,page_number,text) VALUES('F9999',1,'orphan')")
                    else:
                        connection.execute("INSERT INTO page_fts(source_id,page_number,text) VALUES('F0001',1,'duplicate')")
                with self.assertRaisesRegex(ValueError,"(duplicate legacy FTS|no page artifact)"):
                    initialize_index(output)

    @requires_posix_storage
    def test_tampered_fts_rowid_map_is_refused_on_page_read_and_resume(self) -> None:
        build_public_index(self.manifest,self.output,materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            first, = connection.execute("SELECT fts_rowid FROM page_fts_map WHERE source_id='F0001' AND page_number=1").fetchone()
            second, = connection.execute("SELECT fts_rowid FROM page_fts_map WHERE source_id='F0001' AND page_number=2").fetchone()
            connection.execute("UPDATE page_fts_map SET fts_rowid=-1 WHERE source_id='F0001' AND page_number=1")
            connection.execute("UPDATE page_fts_map SET fts_rowid=? WHERE source_id='F0001' AND page_number=2",(first,))
            connection.execute("UPDATE page_fts_map SET fts_rowid=? WHERE source_id='F0001' AND page_number=1",(second,))
        with self.assertRaisesRegex(ValueError,"FTS rowid map/text mismatch"):
            get_indexed_page(self.output,"F0001",1)
        with self.assertRaisesRegex(ValueError,"corrupt"):
            finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                           operator_confirms_main_stopped=True)

    def test_pymupdf_rotation_and_crop_geometry(self) -> None:
        document = fitz.open()
        page = document.new_page(width=200, height=300)
        page.insert_text((70, 100), "Visible marker")
        page.set_cropbox(fitz.Rect(50, 50, 150, 250))
        page.set_rotation(90)
        artifact = _pymupdf_page_artifact(page, self.row, 1)
        self.assertEqual((artifact["widthMilliPoints"], artifact["heightMilliPoints"]), (300000, 200000))
        self.assertEqual(artifact["parserProvenance"], "PYMUPDF")
        self.assertEqual(artifact["sourcePageRotationDegrees"], 90)
        self.assertTrue(artifact["lines"])
        for block in artifact["blocks"]:
            x0,y0,x1,y1 = block["bboxMilliPoints"]
            self.assertTrue(0 <= x0 <= x1 <= 300000 and 0 <= y0 <= y1 <= 200000)
        document.close()

    @requires_posix_storage
    def test_finish_incomplete_preserves_complete_and_resumes_partial_source(self) -> None:
        second_pdf = self.materials / "drawings" / "second.pdf"
        document = fitz.open()
        for label in ("First partial page", "Second missing page"):
            page = document.new_page()
            page.insert_text((70,70),label)
        document.save(second_pdf)
        document.close()
        second = self._row("F0002","drawings/second.pdf",second_pdf,pages=2)
        self.manifest.write_text(json.dumps(self.row)+"\n"+json.dumps(second)+"\n",encoding="utf-8")
        build_public_index(self.manifest,self.output,materials_root=self.materials,source_ids={"F0001"})
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            original_hash, = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        from pdfminer.high_level import extract_pages
        def partial_extract(path):
            yield next(iter(extract_pages(path)))
            raise ValueError("interrupted parser")
        with mock.patch("pdfminer.high_level.extract_pages",side_effect=partial_extract):
            failed = build_public_index(self.manifest,self.output,materials_root=self.materials,
                                        source_ids={"F0002"})
        self.assertEqual(failed["failedSources"],["F0002"])
        with self.assertRaises(ValueError):
            finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials)
        summary = finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                                 operator_confirms_main_stopped=True)
        self.assertEqual((summary["preservedCompleteSources"],summary["completedSources"]),(1,1))
        self.assertEqual((summary["reusedPages"],summary["generatedPages"]),(1,1))
        self.assertEqual(get_indexed_page(self.output,"F0002",1)["parserProvenance"],"PDFMINER")
        self.assertEqual(get_indexed_page(self.output,"F0002",2)["parserProvenance"],"PYMUPDF")
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            after_hash, = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        self.assertEqual(original_hash,after_hash)
        repeated = finish_incomplete_public_index(self.manifest,self.output,
                                                  materials_root=self.materials,
                                                  operator_confirms_main_stopped=True)
        self.assertEqual(repeated["generatedPages"],0)
        self.assertEqual(repeated["preservedCompleteSources"],2)

    @requires_posix_storage
    def test_finish_incomplete_handles_absent_and_stale_indexing(self) -> None:
        initialize_index(self.output)
        with self.assertRaises(ValueError):
            finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials)
        first = finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                               operator_confirms_main_stopped=True)
        self.assertEqual(first["generatedPages"],3)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            connection.execute("UPDATE sources SET status='INDEXING' WHERE source_id='F0001'")
            connection.execute("DELETE FROM pages WHERE source_id='F0001' AND page_number=3")
            connection.execute("DELETE FROM page_fts WHERE source_id='F0001' AND page_number=3")
            connection.execute("DELETE FROM page_fts_map WHERE source_id='F0001' AND page_number=3")
        resumed = finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                                 operator_confirms_main_stopped=True)
        self.assertEqual((resumed["reusedPages"],resumed["generatedPages"]),(2,1))

    @requires_posix_storage
    def test_finish_incomplete_fails_closed_on_complete_corruption_and_lock(self) -> None:
        build_public_index(self.manifest,self.output,materials_root=self.materials)
        with _writer_lock(self.output):
            with self.assertRaisesRegex(ValueError,"writer holds"):
                finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                               operator_confirms_main_stopped=True)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            rel, = connection.execute("SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        (self.output / rel).write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError,"COMPLETE source has corrupt"):
            finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                           operator_confirms_main_stopped=True)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            status, = connection.execute("SELECT status FROM sources WHERE source_id='F0001'").fetchone()
        self.assertEqual(status,"COMPLETE")

    @requires_posix_storage
    def test_finish_incomplete_replaces_corrupt_page_only_when_source_unfinished(self) -> None:
        build_public_index(self.manifest,self.output,materials_root=self.materials)
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            records = connection.execute("SELECT page_number,artifact_path,artifact_sha256 FROM pages WHERE source_id='F0001' ORDER BY page_number").fetchall()
            connection.execute("UPDATE sources SET status='INDEXING' WHERE source_id='F0001'")
        (self.output / records[1][1]).write_bytes(b"corrupt")
        summary = finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                                 operator_confirms_main_stopped=True)
        self.assertEqual((summary["invalidCachedPagesReplaced"],summary["reusedPages"],summary["generatedPages"]),(1,2,1))
        self.assertEqual(get_indexed_page(self.output,"F0001",2)["parserProvenance"],"PYMUPDF")
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            first_hash, = connection.execute("SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        self.assertEqual(first_hash,records[0][2])

    @requires_posix_storage
    def test_finish_incomplete_rejects_changed_manifest_sha(self) -> None:
        initialize_index(self.output)
        bad = dict(self.row,sha256="0"*64)
        self.manifest.write_text(json.dumps(bad)+"\n",encoding="utf-8")
        summary = finish_incomplete_public_index(self.manifest,self.output,materials_root=self.materials,
                                                 operator_confirms_main_stopped=True)
        self.assertEqual(summary["failedSources"],["F0001"])
        with contextlib.closing(sqlite3.connect(self.output / "index.sqlite3")) as connection, connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0],0)
        self.manifest.write_text(json.dumps(self.row) + "\n" + json.dumps(self.row) + "\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_public_manifest(self.manifest)


if __name__ == "__main__":
    unittest.main()
