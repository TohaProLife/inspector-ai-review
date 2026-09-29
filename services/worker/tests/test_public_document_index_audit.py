from __future__ import annotations

import hashlib
import gzip
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.public_document_index import build_public_index


SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_document_index_audit", SCRIPT)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


@requires_posix_storage
class PublicDocumentIndexAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.output = self.root / "index"
        self.manifest = self.root / "manifest.jsonl"
        self.pdf = self.materials / "plan.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text((70, 70), "Section 5 Structural plan", fontsize=12)
        page.insert_text((70, 95), "Apartment count   92   18", fontsize=12)
        document.new_page()
        document.save(self.pdf)
        document.close()
        self.txt = self.materials / "answers.txt"
        self.txt.write_text("Do not read closed answers", encoding="utf-8")
        self.rows = [self._row("F0001", self.pdf, pages=2),
                     self._row("F0194", self.txt, pages=None, annotation="GROUND_TRUTH_INDEX")]
        self._manifest(self.rows)

    def _row(self, source_id: str, path: Path, *, pages: int | None,
             annotation: str = "UNLABELED") -> dict:
        return {"file_id": source_id, "object_id": "OBJ-1", "stage": "PD", "section": "KR",
                "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                "label_visibility": "PUBLIC_TRAIN", "relative_path": path.name,
                "extension": path.suffix, "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pdf_pages": pages, "annotation_status": annotation}

    def _manifest(self, rows: list[dict]) -> None:
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

    def _build(self, source_ids: set[str] | None = None) -> None:
        result = build_public_index(self.manifest, self.output, materials_root=self.materials,
                                    source_ids=source_ids)
        self.assertEqual(result["failedSources"], [])

    def _audit(self, max_errors: int = 200) -> dict:
        return AUDIT.audit_public_document_index(self.manifest, self.output,
                                                 max_errors=max_errors)

    def test_complete_index_checks_public_pages_and_txt_inventory_without_txt_body(self) -> None:
        self._build()
        self.txt.unlink()
        report = self._audit()
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["expected"], {"sourceCount": 2, "pdfSources": 1,
                                               "pdfPages": 2, "txtInventorySources": 1})
        self.assertEqual(report["actual"]["indexedPages"], 2)
        self.assertEqual(report["actual"]["ftsRows"], 2)
        self.assertEqual(report["actual"]["ftsMapRows"], 2)
        self.assertEqual(report["actual"]["dispositions"],
                         {"OCR_REQUIRED": 1, "TEXT_LAYER_CANDIDATE": 1})
        self.assertGreaterEqual(report["actual"]["tableRowCandidates"], 1)
        self.assertGreaterEqual(report["actual"]["sectionCandidates"], 1)
        self.assertEqual(report["sources"][1]["sourceId"], "F0194")
        self.assertEqual(report["sources"][1]["indexedPages"], 0)

    def test_missing_public_source_is_incomplete_not_pass(self) -> None:
        second = self.materials / "plan2.pdf"
        second.write_bytes(self.pdf.read_bytes())
        self.rows.append(self._row("F0002", second, pages=2))
        self._manifest(self.rows)
        self._build({"F0001", "F0194"})
        report = self._audit()
        self.assertEqual(report["status"], "INCOMPLETE")
        self.assertIn("SOURCE_MISSING", {finding["code"] for finding in report["findings"]})
        self.assertEqual(report["actual"]["completePdfSources"], 1)

    def test_corrupt_page_and_duplicate_fts_are_detected_with_bounded_findings(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1"
            ).fetchone()
            connection.execute("INSERT INTO page_fts(source_id,page_number,text) VALUES('F0001',1,'wrong')")
        (self.output / relative).write_bytes(b"corrupt")
        report = self._audit(max_errors=1)
        self.assertEqual(report["status"], "FAILED")
        self.assertGreater(report["findingCount"], 1)
        self.assertEqual(len(report["findings"]), 1)
        self.assertGreater(report["findingsTruncated"], 0)

    def test_manifest_metadata_and_parser_provenance_mismatch_are_detected(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(pages)")}
            if "parser_provenance" not in columns:
                connection.execute("ALTER TABLE pages ADD COLUMN parser_provenance TEXT NOT NULL DEFAULT 'PDFMINER'")
            connection.execute("UPDATE pages SET parser_provenance='PYMUPDF' WHERE source_id='F0001' AND page_number=1")
            connection.execute("UPDATE sources SET stage='RD' WHERE source_id='F0001'")
        report = self._audit()
        codes = {finding["code"] for finding in report["findings"]}
        self.assertEqual(report["status"], "FAILED")
        self.assertIn("SOURCE_MANIFEST_MISMATCH", codes)
        self.assertIn("PAGE_PARSER_PROVENANCE_MISMATCH", codes)

    def test_repaired_page_parser_provenance_is_counted(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1"
            ).fetchone()
            artifact = self.output / relative
            page = json.loads(gzip.decompress(artifact.read_bytes()))
            page["parserProvenance"] = "PYMUPDF"
            page["parserVersion"] = "1.27.2.2"
            payload = gzip.compress(json.dumps(page, sort_keys=True, ensure_ascii=False,
                                               separators=(",", ":")).encode(), mtime=0)
            artifact.write_bytes(payload)
            connection.execute("""UPDATE pages SET parser_provenance='PYMUPDF',artifact_sha256=?
                WHERE source_id='F0001' AND page_number=1""", (hashlib.sha256(payload).hexdigest(),))
        report = self._audit()
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["actual"]["parserProvenance"], {"PDFMINER": 1, "PYMUPDF": 1})

    def test_hidden_source_in_sqlite_is_rejected(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            connection.execute("""INSERT INTO sources(source_id,object_id,stage,section,relative_path,
                source_sha256,byte_size,expected_pages,status) VALUES(?,?,?,?,?,?,?,?,?)""",
                ("F9999", "OBJ-HIDDEN", "PD", "KR", "hidden.pdf", "0" * 64, 1, 1, "COMPLETE"))
            connection.execute("INSERT INTO page_fts(source_id,page_number,text) VALUES('F9999',1,?)",
                               (sqlite3.Binary(b"\xff\xfe"),))
        report = self._audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertIn("SOURCE_OUTSIDE_PUBLIC_ALLOWLIST",
                      {finding["code"] for finding in report["findings"]})

    def test_missing_fts_mapping_is_detected(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            connection.execute("DELETE FROM page_fts_map WHERE source_id='F0001' AND page_number=1")
        codes = {finding["code"] for finding in self._audit()["findings"]}
        self.assertIn("PAGE_WITHOUT_FTS_MAP", codes)
        self.assertIn("FTS_ROW_WITHOUT_MAP", codes)

    def test_duplicate_fts_mapping_is_detected_even_if_constraints_are_damaged(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            mappings = list(connection.execute("SELECT source_id,page_number,fts_rowid FROM page_fts_map"))
            connection.execute("DROP TABLE page_fts_map")
            connection.execute("CREATE TABLE page_fts_map(source_id TEXT,page_number INTEGER,fts_rowid INTEGER)")
            connection.executemany("INSERT INTO page_fts_map VALUES(?,?,?)", mappings + [mappings[0]])
        codes = {finding["code"] for finding in self._audit()["findings"]}
        self.assertIn("DUPLICATE_FTS_MAP_PAGE", codes)
        self.assertIn("DUPLICATE_FTS_MAP_ROWID", codes)

    def test_orphan_fts_mapping_is_detected(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            rowid = connection.execute("""INSERT INTO page_fts(source_id,page_number,text)
                VALUES('F9999',1,'hidden')""").lastrowid
            connection.execute("INSERT INTO page_fts_map VALUES('F9999',1,?)", (rowid,))
        codes = {finding["code"] for finding in self._audit()["findings"]}
        self.assertIn("FTS_MAP_ORPHAN_PAGE", codes)
        self.assertIn("FTS_ROW_WITHOUT_VALID_PAGE", codes)

    def test_wrong_fts_mapping_address_is_detected(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            first, second = (row[0] for row in connection.execute("""SELECT fts_rowid
                FROM page_fts_map WHERE source_id='F0001' ORDER BY page_number"""))
            connection.execute("UPDATE page_fts_map SET fts_rowid=-1 WHERE source_id='F0001' AND page_number=1")
            connection.execute("UPDATE page_fts_map SET fts_rowid=? WHERE source_id='F0001' AND page_number=2",
                               (first,))
            connection.execute("UPDATE page_fts_map SET fts_rowid=? WHERE source_id='F0001' AND page_number=1",
                               (second,))
        report = self._audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertEqual(sum(item["code"] == "FTS_MAP_ADDRESS_MISMATCH"
                             for item in report["findings"]), 2)

    def test_missing_fts_map_table_is_explicit_failure(self) -> None:
        self._build()
        with sqlite3.connect(self.output / "index.sqlite3") as connection:
            connection.execute("DROP TABLE page_fts_map")
        report = self._audit()
        self.assertEqual(report["status"], "FAILED")
        self.assertIn("FTS_MAP_MISSING", {finding["code"] for finding in report["findings"]})


if __name__ == "__main__":
    unittest.main()
