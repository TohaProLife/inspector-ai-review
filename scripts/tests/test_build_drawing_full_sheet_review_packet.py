from __future__ import annotations

import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

import fitz


PACKET = runpy.run_path(str(Path(__file__).resolve().parents[1]
                       / "build-drawing-full-sheet-review-packet.py"))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FullSheetReviewPacketTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.manifest = base / "manifest.jsonl"
        self.library = base / "library.json"
        self.report = base / "report.json"
        self.pdf = base / "source.pdf"
        self.output = base / "packet"
        with fitz.open() as document:
            document.new_page(width=200, height=100)
            document.save(self.pdf)
        self.pdf_hash = sha(self.pdf)
        self.rows = [
            {"file_id": "F1", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "object_id": "A", "sha256": "a" * 64},
            {"file_id": "F2", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "object_id": "B", "sha256": self.pdf_hash,
             "size_bytes": self.pdf.stat().st_size, "pdf_pages": 1},
        ]
        self.write_manifest()
        self.library_data = {
            "schema_version": "drawing-template-library-v1",
            "release_status": "EXPERIMENTAL_REVIEW_REQUIRED",
            "manifest_sha256": sha(self.manifest),
            "templates": [{"template_id": "T1", "class_id": "RADIATOR",
                           "source_file_id": "F1", "source_pdf_sha256": "a" * 64,
                           "source_object_id": "A"}],
        }
        self.write_library()
        self.report_data = {
            "schema_version": "drawing-vector-public-locator-v1", "status": "EXPLORATORY_ONLY",
            "template_library_sha256": sha(self.library), "template_id": "T1",
            "target_file_id": "F2", "target_pdf_sha256": self.pdf_hash,
            "source_object_id": "A", "target_object_id": "B",
            "cross_object_eval": True, "target_pages": [1], "candidate_count": 1,
            "candidates": [{"file_id": "F2", "source_sha256": self.pdf_hash,
                            "page_number": 1, "bbox_display_pt": [10, 10, 15, 60],
                            "template_id": "T1", "method": "red_vector_panel_with_blue_contact_v1",
                            "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"}],
        }
        self.write_report()

    def write_manifest(self) -> None:
        self.manifest.write_text("\n".join(json.dumps(row) for row in self.rows) + "\n")

    def write_library(self) -> None:
        self.library.write_text(json.dumps(self.library_data))

    def write_report(self) -> None:
        self.report.write_text(json.dumps(self.report_data))

    def build(self) -> dict:
        return PACKET["build_packet"](self.manifest, self.library, self.report,
                                      self.pdf, [1], self.output)

    def test_renders_full_sheet_with_provenance_and_pending_review(self) -> None:
        result = self.build()
        self.assertEqual(result["status"], "REVIEW_PENDING")
        self.assertEqual(result["pages"][0]["candidate_count"], 1)
        self.assertEqual(result["pages"][0]["review_status"], "UNREVIEWED")
        self.assertEqual(result["pages"][0]["candidate_ids"], ["F2-P00001-V0001"])
        overview = self.output / result["pages"][0]["image"]
        self.assertEqual(sha(overview), result["pages"][0]["image_sha256"])

    def test_rejects_hidden_source_and_outside_page_candidate(self) -> None:
        self.rows[1]["split"] = "TEST_HIDDEN"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
            self.build()
        self.rows[1]["split"] = "TRAIN_PUBLIC"
        self.write_manifest()
        self.report_data["candidates"][0]["bbox_display_pt"] = [190, 10, 210, 60]
        self.write_report()
        with self.assertRaisesRegex(ValueError, "outside PDF page"):
            self.build()

    def test_rejects_cross_object_flag_and_pdf_tampering(self) -> None:
        self.report_data["cross_object_eval"] = False
        self.write_report()
        with self.assertRaisesRegex(ValueError, "locator report provenance"):
            self.build()
        self.report_data["cross_object_eval"] = True
        self.write_report()
        self.pdf.write_bytes(self.pdf.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "SHA-verified"):
            self.build()


if __name__ == "__main__":
    unittest.main()
