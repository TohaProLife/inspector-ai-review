from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from inspector_worker.kr_material_review import (
    INDEX_VERSION, MaterialReviewError, _terms, classify_context, evaluate_material_review,
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class MaterialReviewTests(unittest.TestCase):
    def test_exact_terms_do_not_treat_standards_or_partial_numbers_as_materials(self) -> None:
        self.assertEqual(_terms("арматура А400, A500C; сталь С245 и C345"), [
            ("KR-057", "А400", "A400"), ("KR-057", "A500C", "A500C"),
            ("KR-056", "С245", "C245"), ("KR-056", "C345", "C345")])
        self.assertEqual(_terms("A4000, C2450, ГОСТ 34028-2016"), [])
        self.assertEqual(classify_context("F0105", 13,
            "2b269a2bb9f61f36ce9a1c39c510e4345d2ea9e4882321101675b9eba0c160ba"),
            "ELEMENT_PARAGRAPH_HINT")
        self.assertEqual(classify_context("F0105", 13, "0" * 64),
                         "UNCLASSIFIED_TEXT_MENTION")

    def test_verified_review_slice_and_tampered_page_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            index = root / "index"
            index.mkdir()
            manifest = root / "manifest.jsonl"
            audit = root / "audit.json"
            archive = root / "public.zip"
            sources = ["F0105", "F0139", "F0140"]
            rows = []
            originals = {}
            for source_id in sources:
                data = ("original " + source_id).encode()
                originals[source_id] = data
                rows.append({"file_id": source_id, "split": "TRAIN_PUBLIC",
                             "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                             "extension": ".pdf", "object_id": "OBJ-NOVOSLOBODSKAYA",
                             "stage": "PD" if source_id == "F0105" else "RD", "section": "KR",
                             "relative_path": source_id + ".pdf", "pdf_pages": 1,
                             "size_bytes": len(data), "sha256": sha(data)})
            rows += [{"file_id": f"X{i:04}", "extension": ".txt",
                      "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                      "label_visibility": "PUBLIC_TRAIN"} for i in range(200)]
            manifest_bytes = b"".join(json.dumps(row).encode() + b"\n" for row in rows)
            manifest.write_bytes(manifest_bytes)
            with zipfile.ZipFile(archive, "w") as destination:
                for source_id, data in originals.items():
                    destination.writestr("root/" + source_id + ".pdf", data)
            audit_payload = {"status": "PASS", "manifestSha256": sha(manifest_bytes),
                             "indexVersionHash": INDEX_VERSION, "findingCount": 0,
                             "fatalFindingCount": 0,
                             "actual": {"verifiedPageArtifacts": 10142, "ftsMapRows": 10142}}
            audit_bytes = json.dumps(audit_payload).encode()
            audit.write_bytes(audit_bytes)
            database = sqlite3.connect(index / "index.sqlite3")
            database.executescript("""
                CREATE TABLE meta(key TEXT, value TEXT);
                CREATE TABLE sources(source_id TEXT, source_sha256 TEXT, byte_size INTEGER,
                  expected_pages INTEGER, observed_pages INTEGER, object_id TEXT, stage TEXT,
                  section TEXT, relative_path TEXT, status TEXT);
                CREATE TABLE pages(source_id TEXT, page_number INTEGER, source_sha256 TEXT,
                  artifact_path TEXT, artifact_sha256 TEXT, disposition TEXT);
            """)
            database.executemany("INSERT INTO meta VALUES(?,?)", [
                ("schemaVersion", "public-document-index-v1"), ("versionHash", INDEX_VERSION)])
            lines_by_source = {
                "F0105": ["Обвязочная балка", "Арматура А500С и сталь C245"],
                "F0139": ["Прокат марки", "C345"],
                "F0140": ["А400 в общем примечании"],
            }
            artifact_paths = []
            for row in rows[:3]:
                source_id = row["file_id"]
                database.execute("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?,?)", (
                    source_id, row["sha256"], row["size_bytes"], 1, 1, row["object_id"],
                    row["stage"], row["section"], row["relative_path"], "COMPLETE"))
                page = {"indexVersionHash": INDEX_VERSION, "inputSha256": row["sha256"],
                        "pageNumber": 1, "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
                        "lines": [{"text": value, "blockIndex": 0, "lineIndex": i,
                                   "bboxMilliPoints": [0, i * 10, 100, i * 10 + 8]}
                                  for i, value in enumerate(lines_by_source[source_id])]}
                path = index / (source_id + ".json.gz")
                path.write_bytes(gzip.compress(json.dumps(page).encode()))
                artifact_paths.append(path)
                database.execute("INSERT INTO pages VALUES(?,?,?,?,?,?)", (
                    source_id, 1, row["sha256"], path.name, sha(path.read_bytes()),
                    "TEXT_LAYER_CANDIDATE"))
            database.commit()
            database.close()
            pins = {"manifest": sha(manifest_bytes), "audit": sha(audit_bytes),
                    "index": INDEX_VERSION}
            result = evaluate_material_review(manifest, index, audit, archive,
                                              source_ids=tuple(sources), _pins=pins)
            self.assertEqual(result["schemaVersion"], "kr-material-review-v1")
            self.assertEqual(result["evaluation"]["status"], "ABSTAIN")
            self.assertIsNone(result["evaluation"]["parameterCoverage"])
            self.assertEqual([row["term"] for row in result["observations"]],
                             ["A500C", "C245", "C345", "A400"])
            self.assertEqual(result["observations"][0]["nearbyLines"][0]["rawText"],
                             "Обвязочная балка")
            self.assertTrue(all(row["contextClass"] == "UNCLASSIFIED_TEXT_MENTION"
                                for row in result["observations"]))
            with zipfile.ZipFile(archive, "w") as destination:
                for source_id, data in originals.items():
                    destination.writestr("root/" + source_id + ".pdf",
                                         data + b"tamper" if source_id == "F0105" else data)
            with self.assertRaisesRegex(MaterialReviewError, "original PDF size mismatch"):
                evaluate_material_review(manifest, index, audit, archive,
                                         source_ids=tuple(sources), _pins=pins)
            with zipfile.ZipFile(archive, "w") as destination:
                for source_id, data in originals.items():
                    destination.writestr("root/" + source_id + ".pdf", data)
            artifact_paths[0].write_bytes(artifact_paths[0].read_bytes() + b"tamper")
            with self.assertRaisesRegex(MaterialReviewError, "page artifact SHA mismatch"):
                evaluate_material_review(manifest, index, audit, archive,
                                         source_ids=tuple(sources), _pins=pins)


if __name__ == "__main__":
    unittest.main()
