from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.public_document_index import build_public_index
from inspector_worker.public_section_proposals import (
    PublicSectionProposalError, build_public_section_proposals, explicit_designations,
)


ROOT = Path(__file__).resolve().parents[3]
AUDIT_SCRIPT = ROOT / "scripts/audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_index_audit_for_sections", AUDIT_SCRIPT)
assert SPEC and SPEC.loader
AUDIT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT_MODULE)


@requires_posix_storage
class PublicSectionProposalTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit = self.root / "audit.json"
        self.rows = [
            self._pdf("F0105", "PD", "KR", ["Section 4 AR", "Section 5 AR / KR",
                                               "Section 6 CAR"]),
            self._pdf("F0140", "RD", "KR", ["Section 4 KJ"]),
            self._pdf("F0195", "RD_ID_MIXED", "OV", ["Section 4 OV"]),
        ]
        answers = self.materials / "answers.txt"
        answers.write_text("private-answer-sentinel", encoding="utf-8")
        self.rows.append({
            "file_id": "F0194", "object_id": "OBJ-1", "stage": "UNKNOWN",
            "section": "OTHER", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "relative_path": answers.name, "extension": ".txt",
            "size_bytes": answers.stat().st_size,
            "sha256": hashlib.sha256(answers.read_bytes()).hexdigest(),
            "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX",
        })
        self._write_manifest()
        built = build_public_index(self.manifest, self.index,
                                   materials_root=self.materials)
        self.assertEqual(built["completeSources"], 3)
        report = AUDIT_MODULE.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(report["status"], "PASS", report["findings"])
        self.audit.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")

    def _pdf(self, source_id: str, stage: str, section: str,
             texts: list[str]) -> dict:
        path = self.materials / f"{source_id}.pdf"
        document = fitz.open()
        for text in texts:
            page = document.new_page()
            page.insert_text((40, 90), text, fontsize=10)
        document.save(path)
        document.close()
        return {"file_id": source_id, "object_id": "OBJ-1", "stage": stage,
                "section": section, "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": path.name, "extension": ".pdf",
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pdf_pages": len(texts), "annotation_status": "UNLABELED"}

    def _write_manifest(self) -> None:
        self.manifest.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in self.rows),
            encoding="utf-8",
        )

    def _build(self, **options: object) -> dict:
        return build_public_section_proposals(
            self.manifest, self.index, self.audit,
            _expected_counts={"sourceCount": 4, "pdfSources": 3,
                              "pdfPages": 5, "txtInventorySources": 1},
            _expected_manifest_sha256=hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
            **options,
        )

    def test_explicit_tokens_are_bounded_not_substrings(self) -> None:
        self.assertEqual(explicit_designations("Section 4 AR / KR"), ["AR", "KR"])
        self.assertEqual(explicit_designations("Раздел 4 АР / КЖ"), ["AR", "KJ"])
        self.assertEqual(explicit_designations("Section 5 CAR and PARK"), [])
        self.assertEqual(explicit_designations("Кр-10"), [])
        self.assertEqual(explicit_designations("кр-10"), [])
        self.assertEqual(explicit_designations("Раздел 5 СПОЗУ"), ["SPZU"])

    def test_audited_index_proposes_with_sha_bbox_and_ambiguity(self) -> None:
        report = self._build()
        self.assertEqual(report["disposition"], "REVIEW_ONLY_ABSTAIN")
        self.assertEqual(report["targetCodeCount"], 44)
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertEqual(report["totals"]["candidatePagesAvailable"], 5)
        self.assertEqual(report["totals"]["sectionCandidatesWithoutExplicitToken"], 1)
        self.assertEqual(report["totals"]["proposalsReturned"], 4)
        self.assertNotIn("private-answer-sentinel", json.dumps(report))
        self.assertNotIn("F0194", {item["sourceFileId"] for item in report["proposals"]})
        first = next(item for item in report["proposals"]
                     if item["sourceFileId"] == "F0105" and item["pageNumber"] == 1)
        self.assertEqual(first["explicitDrawingDesignations"], ["AR"])
        self.assertIn("MANIFEST_CATEGORY_CONFLICT", first["ambiguityFlags"])
        self.assertTrue(first["possibleParameterCodes"])
        self.assertEqual(len(first["pageArtifactSha256"]), 64)
        self.assertEqual(len(first["sourceSha256"]), 64)
        self.assertEqual(len(first["bboxMilliPoints"]), 4)
        multiple = next(item for item in report["proposals"]
                        if item["sourceFileId"] == "F0105" and item["pageNumber"] == 2)
        self.assertIn("MULTIPLE_EXPLICIT_DESIGNATIONS", multiple["ambiguityFlags"])
        mixed = next(item for item in report["proposals"]
                     if item["sourceFileId"] == "F0195")
        self.assertIn("STAGE_MIXED_UNVERIFIED", mixed["ambiguityFlags"])

    def test_page_and_proposal_limits_expose_truncation(self) -> None:
        limited_pages = self._build(max_pages=1)
        self.assertEqual(limited_pages["totals"]["candidatePagesScanned"], 1)
        self.assertEqual(limited_pages["totals"]["candidatePagesOmitted"], 4)
        self.assertTrue(limited_pages["truncated"])
        limited_proposals = self._build(max_proposals=1)
        self.assertEqual(limited_proposals["totals"]["proposalsReturned"], 1)
        self.assertEqual(limited_proposals["totals"]["proposalsOmittedWithinScannedPages"], 3)
        self.assertTrue(limited_proposals["truncated"])
        for options in ({"max_pages": 0}, {"max_pages": 501},
                        {"max_proposals": 0}, {"max_proposals": 1001}):
            with self.subTest(options=options), self.assertRaises(PublicSectionProposalError):
                self._build(**options)

    def test_stale_or_fabricated_audit_and_manifest_fail_closed(self) -> None:
        original = json.loads(self.audit.read_text(encoding="utf-8"))
        for change in (lambda x: x.update(status="INCOMPLETE"),
                       lambda x: x.update(indexVersionHash="0" * 20),
                       lambda x: x["actual"].update(indexedPages=4),
                       lambda x: x["sources"][0].update(issueCount=1)):
            changed = json.loads(json.dumps(original))
            change(changed)
            self.audit.write_text(json.dumps(changed), encoding="utf-8")
            with self.subTest(change=change), self.assertRaises(PublicSectionProposalError):
                self._build()
        self.audit.write_text(json.dumps(original), encoding="utf-8")
        self.manifest.write_bytes(self.manifest.read_bytes() + b"\n")
        with self.assertRaisesRegex(PublicSectionProposalError, "SHA"):
            self._build()

    def test_tampered_page_artifact_fails(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0105' AND page_number=1"
            ).fetchone()
        path = self.index / relative
        path.write_bytes(path.read_bytes() + b"corruption")
        with self.assertRaisesRegex(PublicSectionProposalError, "artifact"):
            self._build()

    def test_default_production_inventory_gate(self) -> None:
        with self.assertRaisesRegex(PublicSectionProposalError, "allowlist"):
            build_public_section_proposals(self.manifest, self.index, self.audit)


if __name__ == "__main__":
    unittest.main()
