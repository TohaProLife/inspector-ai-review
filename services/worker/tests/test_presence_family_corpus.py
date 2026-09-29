from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.presence_family_corpus import (
    PresenceCorpusProbeError, _index_read_uri, _source_issue,
    probe_public_presence_corpus,
)
from inspector_worker.presence_family_candidates import (
    LABEL_PACK_PATH, load_presence_family_labels,
)
from inspector_worker.public_document_index import build_public_index


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "public_document_index_audit_for_presence",
    ROOT / "scripts" / "audit-public-document-index.py",
)
assert SPEC and SPEC.loader
AUDIT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT_MODULE)


@requires_posix_storage
class PresenceCorpusProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        materials = self.root / "materials"
        materials.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit_path = self.root / "audit.json"
        self.policy_path = self.root / "labels.json"
        labels = json.loads(LABEL_PACK_PATH.read_text(encoding="utf-8"))
        ar = next(entry for entry in labels["entries"]
                  if entry["parameterCode"] == "AR-053")
        ar["features"][0]["labels"] = ["Damping tape"]
        ar["features"][1]["labels"] = ["Sound gasket"]
        ar["scopeGroups"][0]["labels"] = ["Partition joint"]
        self.policy_path.write_text(json.dumps(labels, ensure_ascii=False), encoding="utf-8")
        pdf_path = materials / "F0001.pdf"
        document = fitz.open()
        for line in ("Partition joint J1: damping tape.",
                     "Damping tape.",
                     "Partition joint J1: damping tape?"):
            page = document.new_page()
            page.insert_text((60, 90), line)
            if line.startswith("Partition joint J1: damping tape."):
                page.insert_text((60, 400), "Damping tape.")
        document.new_page()  # OCR_REQUIRED: no text layer.
        document.save(pdf_path)
        document.close()
        inventory = materials / "answers.txt"
        inventory.write_text("Metadata only; never open in this probe.", encoding="utf-8")
        self.rows = [
            {"file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "AR",
             "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "label_visibility": "PUBLIC_TRAIN", "relative_path": pdf_path.name,
             "extension": ".pdf", "size_bytes": pdf_path.stat().st_size,
             "sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
             "pdf_pages": 4, "annotation_status": "UNLABELED"},
            {"file_id": "F0194", "object_id": "OBJ-1", "stage": "OTHER",
             "section": "OTHER", "split": "TRAIN_PUBLIC",
             "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
             "relative_path": inventory.name, "extension": ".txt",
             "size_bytes": inventory.stat().st_size,
             "sha256": hashlib.sha256(inventory.read_bytes()).hexdigest(),
             "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX"},
        ]
        self._write_manifest()
        build_public_index(self.manifest, self.index, materials_root=materials)
        audit = AUDIT_MODULE.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(audit["status"], "PASS")
        self.audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")

    def _write_manifest(self) -> None:
        self.manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n"
                                         for row in self.rows), encoding="utf-8")

    def _probe(self, **kwargs: object) -> dict:
        with patch("inspector_worker.presence_family_corpus.FTS_STEMS", ("damp",)):
            return probe_public_presence_corpus(
                self.manifest, self.index, self.audit_path,
                label_pack_path=self.policy_path,
                _expected_counts={"sourceCount": 2, "pdfSources": 1,
                                  "pdfPages": 4, "txtInventorySources": 1},
                _expected_manifest_sha256=hashlib.sha256(
                    self.manifest.read_bytes()).hexdigest(), **kwargs,
            )

    def test_audited_fts_positive_near_misses_and_ocr_queue(self) -> None:
        report = self._probe()
        self.assertEqual(report["scanStatus"], "FTS_HITS_SCANNED")
        self.assertEqual(report["ftsHitPages"], 3)
        self.assertEqual(report["selectedHitPages"], 3)
        self.assertEqual(report["ocrRequiredPages"], 1)
        self.assertEqual(report["ocrQueue"][0]["pageNumber"], 4)
        self.assertEqual(report["ocrQueue"][0]["sourceSha256"], self.rows[0]["sha256"])
        ar = report["codeReports"]["AR-053"]
        self.assertEqual(ar["labelHitLines"], 4)
        self.assertEqual(ar["candidateMentions"], 1)
        self.assertEqual(ar["nearMissCounts"], {
            "CONTEXT_UNCERTAIN": 1, "SCOPE_UNRESOLVED": 2,
        })
        candidate = ar["examples"][0]
        self.assertEqual(candidate["lineText"], "Partition joint J1: damping tape.")
        self.assertEqual(candidate["sourceSha256"], self.rows[0]["sha256"])
        self.assertEqual(len(candidate["pageArtifactSha256"]), 64)
        self.assertEqual(len(candidate["pageEvidenceSha256"]), 64)
        self.assertEqual(report["searchCompleteness"], "NOT_ESTABLISHED")
        self.assertEqual(report["absenceInference"], "PROHIBITED")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])

    def test_truncated_scan_is_explicit_and_examples_bounded(self) -> None:
        report = self._probe(max_pages=1, max_examples_per_code=1,
                             max_ocr_queue=1)
        self.assertEqual(report["scanStatus"], "PARTIAL")
        self.assertTrue(report["truncated"]["hitPages"])
        self.assertLessEqual(len(report["codeReports"]["AR-053"]["examples"]), 1)

    def test_small_read_chunks_still_cover_all_anchor_blocks(self) -> None:
        report = self._probe(blocks_per_read=1)
        self.assertEqual(report["codeReports"]["AR-053"]["labelHitLines"], 4)
        self.assertEqual(report["codeReports"]["AR-053"]["candidateMentions"], 1)
        self.assertEqual(report["anchorBlocksRead"], 4)
        self.assertEqual(report["evidenceChunks"], 4)
        self.assertEqual(report["scanStatus"], "FTS_HITS_SCANNED")

    def test_audit_tamper_and_public_manifest_change_rejected(self) -> None:
        original = json.loads(self.audit_path.read_text(encoding="utf-8"))
        for mutation in (lambda row: row.update(status="INCOMPLETE"),
                         lambda row: row["actual"].update(indexedPages=3)):
            audit = json.loads(json.dumps(original))
            mutation(audit)
            self.audit_path.write_text(json.dumps(audit), encoding="utf-8")
            with self.assertRaises(PresenceCorpusProbeError):
                self._probe()
        self.audit_path.write_text(json.dumps(original), encoding="utf-8")
        self.rows[0]["sha256"] = "0" * 64
        self._write_manifest()
        with self.assertRaisesRegex(PresenceCorpusProbeError, "SHA"):
            self._probe()

    def test_default_production_inventory_cannot_use_tiny_index(self) -> None:
        with patch("inspector_worker.presence_family_corpus.FTS_STEMS", ("damp",)):
            with self.assertRaisesRegex(PresenceCorpusProbeError, "SHA"):
                probe_public_presence_corpus(
                    self.manifest, self.index, self.audit_path,
                    label_pack_path=self.policy_path)

    def test_unresolved_drawing_section_stays_near_miss(self) -> None:
        policy = load_presence_family_labels()
        entry = next(row for row in policy["entries"]
                     if row["parameterCode"] == "SPZU-039")
        rule = policy["rules"]["SPZU-039"]
        self.assertEqual(_source_issue("Зона дренажа З1: открытый лоток.",
                                       entry, rule, "PD", "OTHER"),
                         "SECTION_PROOF_REQUIRED")
        self.assertEqual(_source_issue("Зона дренажа З1: открытый лоток.",
                                       entry, rule, "UNKNOWN", "OTHER"),
                         "STAGE_UNRESOLVED")

    def test_immutable_read_only_when_wal_is_empty(self) -> None:
        database = self.index / "index.sqlite3"
        self.assertIn("immutable=1", _index_read_uri(database))
        wal = self.index / "index.sqlite3-wal"
        wal.write_bytes(b"pending WAL")
        self.assertTrue(_index_read_uri(database).endswith("?mode=ro"))


if __name__ == "__main__":
    unittest.main()
