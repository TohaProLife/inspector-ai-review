from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.indexed_numeric_rows import extract_labeled_numeric_rows
from inspector_worker.indexed_page_evidence import load_indexed_page_evidence
from inspector_worker.public_document_index import build_public_index


@requires_posix_storage
class IndexedNumericRowTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        materials = self.root / "materials"
        materials.mkdir()
        pdf = materials / "plan.pdf"
        document = fitz.open()
        page = document.new_page()
        for line_number, line in enumerate((
            "Slab thickness: 220 mm",
            "Slab thickness: 220 mm, 250 mm",
            "Wall thickness: 200 mm",
            "Slab thickness: 220 cm",
        )):
            page.insert_text((60, 70 + 30 * line_number), line)
        document.save(pdf)
        document.close()
        self.manifest = self.root / "manifest.jsonl"
        row = {"file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
               "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
               "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
               "extension": ".pdf", "size_bytes": pdf.stat().st_size,
               "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pdf_pages": 1}
        self.manifest.write_text(json.dumps(row) + "\n")
        self.index = self.root / "index"
        build_public_index(self.manifest, self.index, materials_root=materials)
        self.evidence = load_indexed_page_evidence(
            self.manifest, self.index, "F0001", 1, expected_object_id="OBJ-1",
            expected_stage="PD", expected_section="KR", block_indices=[0, 1, 2, 3])
        self.definitions = {"SLAB_THICKNESS": {"label": "Slab thickness", "unitAliases": ["mm"]}}

    def test_exact_line_candidate_retains_page_provenance(self) -> None:
        result = extract_labeled_numeric_rows(self.evidence, self.definitions)
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["rawValue"], result[0]["rawUnit"]), ("220", "mm"))
        self.assertEqual(result[0]["sourceFileId"], "F0001")
        self.assertEqual(result[0]["stage"], "PD")
        self.assertEqual(result[0]["pageEvidenceSha256"], self.evidence["evidenceSha256"])
        locator = result[0]["locator"]
        self.assertEqual(result[0]["lineText"][locator["valueStart"]:locator["valueEnd"]], "220")

    def test_rejects_extra_values_wrong_label_and_wrong_unit(self) -> None:
        self.assertEqual(len(extract_labeled_numeric_rows(self.evidence, self.definitions)), 1)
        wrong = {"SLAB_THICKNESS": {"label": "Ceiling thickness", "unitAliases": ["mm"]}}
        self.assertEqual(extract_labeled_numeric_rows(self.evidence, wrong), [])

    def test_tampered_evidence_and_ambiguous_definition_refused(self) -> None:
        altered = {**self.evidence, "lines": [{**line, "text": "Slab thickness: 100 mm"}
                                               for line in self.evidence["lines"]]}
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            extract_labeled_numeric_rows(altered, self.definitions)
        ambiguous = {**self.definitions, "ALSO_SLAB": dict(self.definitions["SLAB_THICKNESS"])}
        self.assertEqual(extract_labeled_numeric_rows(self.evidence, ambiguous), [])

    def test_requires_text_layer_and_bounded_literal_policy(self) -> None:
        with self.assertRaisesRegex(ValueError, "verified"):
            extract_labeled_numeric_rows({"schemaVersion": "not-indexed"}, self.definitions)
        with self.assertRaisesRegex(ValueError, "units"):
            extract_labeled_numeric_rows(self.evidence, {"SLAB_THICKNESS": {
                "label": "Slab thickness", "unitAliases": "mm"}})


if __name__ == "__main__":
    unittest.main()
