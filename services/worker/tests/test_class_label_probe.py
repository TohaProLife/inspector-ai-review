from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.class_label_probe import (
    ClassLabelProbeError, _source_eligibility, probe_public_class_labels,
)
from inspector_worker.public_document_index import build_public_index


SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_document_index_audit_for_class_probe", SCRIPT)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class ClassLabelProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.pdf = self.materials / "plan.pdf"
        self.txt = self.materials / "answers.txt"
        self.txt.write_text("Energy efficiency class: G; closed answer body")
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit_path = self.root / "audit.json"
        self.policy = load_class_family_labels()
        # Keep production pack pinning covered by test_class_family_candidates.
        # ASCII fixture changes only lexical label, so PDF needs no host font.
        entry = next(item for item in self.policy["entries"] if item["parameterCode"] == "PZ-021")
        entry["labels"] = ["Energy efficiency class"]

    def _build(self, lines: list[str], *, blank_pages: int = 1,
               stage: str = "RD", section: str = "AR") -> None:
        document = fitz.open()
        page = document.new_page()
        for number, text in enumerate(lines):
            page.insert_text((60, 70 + number * 26), text)
        for _ in range(blank_pages):
            document.new_page()
        document.save(self.pdf)
        document.close()
        pdf_pages = blank_pages + 1
        rows = [
            {"file_id": "F0001", "object_id": "OBJ-1", "stage": stage, "section": section,
             "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
             "extension": ".pdf", "size_bytes": self.pdf.stat().st_size,
             "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
             "pdf_pages": pdf_pages, "annotation_status": "UNLABELED"},
            {"file_id": "F0194", "object_id": "OBJ-1", "stage": "PD", "section": "AR",
             "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "label_visibility": "PUBLIC_TRAIN", "relative_path": "answers.txt",
             "extension": ".txt", "size_bytes": self.txt.stat().st_size,
             "sha256": hashlib.sha256(self.txt.read_bytes()).hexdigest(),
             "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX"},
        ]
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in rows))
        result = build_public_index(self.manifest, self.index, materials_root=self.materials)
        self.assertEqual(result["failedSources"], [])
        receipt = AUDIT.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(receipt["status"], "PASS")
        self.audit_path.write_text(json.dumps(receipt))

    def _probe(self, *, limit: int = 20, queue: int = 2000) -> dict:
        with patch("inspector_worker.class_label_probe.load_class_family_labels",
                   return_value=self.policy):
            return probe_public_class_labels(
                self.manifest, self.index, self.audit_path,
                required_inventory=(2, 1, len(fitz.open(self.pdf))),
                max_examples_per_code=limit, max_ocr_queue=queue)

    @requires_posix_storage
    def test_full_page_census_exact_near_and_ocr_queue_skips_txt_body(self) -> None:
        self._build(["Energy efficiency class: A", "Energy efficiency class: A++",
                     "Electrical section reference 12 mm", "Drawing sheet overview"])
        self.txt.unlink()  # No body read: F0194 stays metadata only.
        result = self._probe()
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["inventory"]["pdfPages"], 2)
        self.assertEqual(result["inventory"]["ocrRequiredPages"], 1)
        self.assertEqual(len(result["ocrQueue"]), 1)
        self.assertEqual(result["ocrQueue"][0]["pageNumber"], 2)
        code = result["codes"]["PZ-021"]
        self.assertEqual(code["exactLineMatches"], 1)
        self.assertEqual(code["matchedPages"], 1)
        self.assertEqual(code["nearMissLines"], 1)
        self.assertEqual(code["nearMissPages"], 1)
        self.assertEqual(code["exactExamples"][0]["rawValue"], "A")
        self.assertEqual(code["exactExamples"][0]["sourceEligibility"],
                         "MANIFEST_CATEGORY_MATCH_REVIEW_ONLY")
        self.assertRegex(code["exactExamples"][0]["pageArtifactSha256"], r"^[a-f0-9]{64}$")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])

    @requires_posix_storage
    def test_ambiguous_lines_and_bounded_examples(self) -> None:
        self._build(["Energy efficiency class: A", "Energy efficiency class: B",
                     "Energy efficiency class: A++", "Energy efficiency class: B or C"])
        result = self._probe(limit=1)
        code = result["codes"]["PZ-021"]
        self.assertEqual(code["exactLineMatches"], 2)
        self.assertEqual(code["ambiguousPages"], 1)
        self.assertEqual(code["nearMissLines"], 2)
        self.assertEqual(len(code["exactExamples"]), 1)
        self.assertEqual(code["exactExamplesTruncated"], 1)
        self.assertEqual(code["nearMissExamplesTruncated"], 1)
        self.assertTrue(code["exactExamples"][0]["ambiguousSameCodeOnPage"])

    @requires_posix_storage
    def test_ocr_queue_truncation_visible(self) -> None:
        self._build(["Energy efficiency class: A", "Other page metadata"], blank_pages=2)
        result = self._probe(queue=1)
        self.assertEqual(result["inventory"]["ocrRequiredPages"], 2)
        self.assertEqual(len(result["ocrQueue"]), 1)
        self.assertEqual(result["ocrQueueTruncated"], 1)

    @requires_posix_storage
    def test_failed_stale_or_short_audit_rejected(self) -> None:
        self._build(["Energy efficiency class: A", "Other page metadata"])
        original = json.loads(self.audit_path.read_text())
        for mutation in (lambda receipt: receipt.update(status="INCOMPLETE"),
                         lambda receipt: receipt.update(manifestSha256="0" * 64),
                         lambda receipt: receipt["actual"].update(verifiedPageArtifacts=1),
                         lambda receipt: receipt["sources"].pop()):
            changed = json.loads(json.dumps(original))
            mutation(changed)
            self.audit_path.write_text(json.dumps(changed))
            with self.assertRaises(ClassLabelProbeError):
                self._probe()
        self.audit_path.write_text(json.dumps(original))
        self.assertEqual(self._probe()["status"], "COMPLETE")

    @requires_posix_storage
    def test_page_artifact_modified_after_pass_audit_rejected(self) -> None:
        self._build(["Energy efficiency class: A", "Other page metadata"])
        with closing(sqlite3.connect(self.index / "index.sqlite3")) as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1"
            ).fetchone()
        artifact = self.index / relative
        page = json.loads(gzip.decompress(artifact.read_bytes()))
        page["lines"][0]["text"] = "Energy efficiency class: G"
        artifact.write_bytes(gzip.compress(json.dumps(page).encode()))
        with self.assertRaisesRegex(ClassLabelProbeError, "artifact/FTS verification failed"):
            self._probe()

    @requires_posix_storage
    def test_default_inventory_rejects_fixture_scale(self) -> None:
        self._build(["Energy efficiency class: A", "Other page metadata"])
        with self.assertRaisesRegex(ClassLabelProbeError, "required"):
            probe_public_class_labels(self.manifest, self.index, self.audit_path)

    @requires_posix_storage
    def test_pd_other_section_remains_unresolved_despite_exact_line(self) -> None:
        self._build(["Energy efficiency class: A", "Project description section 9"],
                    stage="PD", section="PB")
        result = self._probe()
        example = result["codes"]["PZ-021"]["exactExamples"][0]
        self.assertEqual(example["stage"], "PD")
        self.assertEqual(example["manifestSection"], "PB")
        self.assertEqual(example["sourceEligibility"],
                         "DRAWING_SECTION_RESOLUTION_REQUIRED")
        self.assertEqual(result["codes"]["PZ-021"]["sourceEligibilityCounts"],
                         {"DRAWING_SECTION_RESOLUTION_REQUIRED": 1})
        self.assertIsNone(result["findingCount"])

    def test_three_real_public_hit_sources_require_pz_section_review(self) -> None:
        # Public manifest: F0118 is PD/OTHER with IOS2.1 title; F0193 is
        # PD/PB with a section 9 fire-safety title. Neither proves PD/PZ.
        for code, source_id, section in (
            ("PZ-015", "F0118", "OTHER"),
            ("PZ-022", "F0193", "PB"),
            ("PZ-023", "F0193", "PB"),
        ):
            with self.subTest(code=code):
                row = {"file_id": source_id, "stage": "PD", "section": section}
                self.assertEqual(
                    _source_eligibility(self.policy["rules"][code], row),
                    "DRAWING_SECTION_RESOLUTION_REQUIRED")


if __name__ == "__main__":
    unittest.main()
