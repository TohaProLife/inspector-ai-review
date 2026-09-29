"""Conservative offline fire-safety extraction and provenance gates."""

import gzip
import hashlib
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from inspector_worker.fire_safety_review import (
    FireReviewError, classify_line, evaluate_fire_review, sha,
)


class FireSafetyReviewTest(unittest.TestCase):
    def test_context_is_never_fact(self):
        self.assertEqual(classify_line("PPM-102", "Площадь пожарного отсека 200 м²", "", table_row=False),
                         ("TEXT_WITH_DETAIL", 3))
        self.assertEqual(classify_line("PPM-113", "ВПВ", "расход 5 л/с", table_row=False),
                         ("NEARBY_DETAIL_UNLINKED", 2))
        self.assertEqual(classify_line("PPM-113", "ВПВ", "", table_row=True), ("TERM_ONLY", 1))
        self.assertIsNone(classify_line("PPM-102", "пожарный кран", "пожарный отсек", table_row=False))

    def make_fixture(self, root: Path):
        manifest = root / "manifest.jsonl"
        index = root / "index"
        index.mkdir()
        archive = root / "public.zip"
        original = b"%PDF-1.4\npublic synthetic fixture\n"
        row = {
            "file_id": "F0117", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "object_id": "OBJ-NOVOSLOBODSKAYA",
            "stage": "PD", "section": "OTHER", "extension": ".pdf", "pdf_pages": 2,
            "relative_path": "open/fire.pdf", "size_bytes": len(original), "sha256": sha(original),
        }
        other = [{**row, "file_id": f"X{i:04d}", "relative_path": f"open/x{i:04d}.pdf"}
                 for i in range(202)]
        manifest.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in [row, *other]))
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("prefix/open/fire.pdf", original)
        audit = root / "audit.json"
        pins = {"manifest": sha(manifest.read_bytes()), "index": "test-index", "audit": ""}
        audit.write_text(json.dumps({"status": "PASS", "manifestSha256": pins["manifest"],
                                     "indexVersionHash": pins["index"], "findingCount": 0,
                                     "fatalFindingCount": 0, "actual": {"verifiedPageArtifacts": 10142}}))
        pins["audit"] = sha(audit.read_bytes())
        db = sqlite3.connect(index / "index.sqlite3")
        db.execute("CREATE TABLE meta(key TEXT,value TEXT)")
        db.executemany("INSERT INTO meta VALUES(?,?)", [("schemaVersion", "public-document-index-v1"),
                                                       ("versionHash", pins["index"])])
        db.execute("CREATE TABLE sources(source_id TEXT,source_sha256 TEXT,byte_size INT,expected_pages INT,object_id TEXT,stage TEXT,section TEXT,relative_path TEXT,status TEXT)")
        db.execute("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)", ("F0117", row["sha256"], len(original),
                   2, row["object_id"], row["stage"], row["section"], row["relative_path"], "COMPLETE"))
        db.execute("CREATE TABLE pages(source_id TEXT,page_number INT,source_sha256 TEXT,disposition TEXT,artifact_path TEXT,artifact_sha256 TEXT,table_candidate_count INT,section_candidate_count INT)")
        lines = [{"blockIndex": 0, "lineIndex": 0, "text": "Площадь пожарного отсека 200 м2",
                  "bboxMilliPoints": [0, 0, 100, 100]},
                 {"blockIndex": 0, "lineIndex": 1, "text": "ВПВ расход 5 л/с",
                  "bboxMilliPoints": [0, 100, 100, 200]}]
        for number, disposition, page_lines in ((1, "TEXT_LAYER_CANDIDATE", lines), (2, "OCR_REQUIRED", [])):
            page = {"indexVersionHash": pins["index"], "inputSha256": row["sha256"],
                    "pageNumber": number, "quality": {"disposition": disposition}, "lines": page_lines,
                    "tableRowCandidates": [], "sectionCandidates": []}
            path = index / f"p{number}.json.gz"
            path.write_bytes(gzip.compress(json.dumps(page, ensure_ascii=False).encode()))
            db.execute("INSERT INTO pages VALUES(?,?,?,?,?,?,?,?)", ("F0117", number, row["sha256"],
                       disposition, path.name, sha(path.read_bytes()), 0, 0))
        db.commit()
        db.close()
        return manifest, index, audit, archive, pins

    def test_report_and_original_tamper(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest, index, audit, archive, pins = self.make_fixture(Path(folder))
            report = evaluate_fire_review(manifest, index, audit, archive,
                                          source_ids=("F0117",), pins=pins)
            self.assertEqual([code["totalLineMatches"] for code in report["codes"]], [1, 1])
            self.assertEqual(report["sources"][0]["ocrRequiredUnknownPages"], 1)
            self.assertIsNone(report["findingCount"])
            self.assertTrue(all(c["reviewStatus"] == "REVIEW_ONLY_ABSTAIN" for c in report["codes"]))
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("prefix/open/fire.pdf", b"different original")
            with self.assertRaisesRegex(FireReviewError, "original PDF size mismatch"):
                evaluate_fire_review(manifest, index, audit, archive, source_ids=("F0117",), pins=pins)

    def test_page_tamper(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest, index, audit, archive, pins = self.make_fixture(Path(folder))
            with (index / "p1.json.gz").open("ab") as stream:
                stream.write(b"tamper")
            with self.assertRaisesRegex(FireReviewError, "page artifact SHA mismatch"):
                evaluate_fire_review(manifest, index, audit, archive, source_ids=("F0117",), pins=pins)


if __name__ == "__main__":
    unittest.main()
