from __future__ import annotations

import json
from pathlib import Path
import runpy
import tempfile
import unittest

import fitz


PACKET = runpy.run_path(str(Path(__file__).resolve().parents[1]
                          / "build-drawing-vector-review-packet.py"))


class DrawingVectorReviewPacketTests(unittest.TestCase):
    def test_packet_renders_only_verified_public_source_and_leaves_review_open(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            pdf_path = base / "source.pdf"
            document = fitz.open()
            page = document.new_page(width=200, height=200)
            page.draw_rect(fitz.Rect(70, 80, 77, 130), color=(1, 0, 0))
            document.save(pdf_path)
            document.close()
            pdf_hash = PACKET["digest"](pdf_path)
            manifest = base / "manifest.jsonl"
            manifest.write_text(json.dumps({"file_id": "F0001", "split": "TRAIN_PUBLIC",
                                            "distribution_status": "INCLUDE", "sha256": pdf_hash,
                                            "size_bytes": pdf_path.stat().st_size}) + "\n")
            report_path = base / "report.json"
            report = {"schema_version": "drawing-vector-public-locator-v1",
                      "status": "EXPLORATORY_ONLY", "target_file_id": "F0001",
                      "target_pdf_sha256": pdf_hash, "target_pages": [1],
                      "template_id": "sample", "candidate_count": 1,
                      "candidates": [{"file_id": "F0001", "source_sha256": pdf_hash,
                                      "page_number": 1, "bbox_display_pt": [70, 80, 77, 130],
                                      "template_id": "sample",
                                      "method": "red_vector_panel_with_blue_contact_v1",
                                      "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"}]}
            report_path.write_text(json.dumps(report))
            output = base / "packet"
            packet = PACKET["build_packet"](manifest, pdf_path, report_path, output)
            self.assertEqual(packet["candidate_count"], 1)
            self.assertEqual(packet["candidates"][0]["review_status"], "UNREVIEWED")
            self.assertEqual(packet["sheets"][0]["sha256"],
                             PACKET["digest"](output / "contact-001.png"))
            self.assertTrue((output / "review-index.json").is_file())
            report["candidates"][0]["bbox_display_pt"] = [270, 80, 277, 130]
            report_path.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, "outside source page"):
                PACKET["build_packet"](manifest, pdf_path, report_path, output)
            report["candidates"][0]["bbox_display_pt"] = [70, 80, 77, 130]
            report_path.write_text(json.dumps(report))
            manifest.write_text(json.dumps({"file_id": "F0001", "split": "TEST_HIDDEN",
                                            "distribution_status": "INCLUDE", "sha256": pdf_hash,
                                            "size_bytes": pdf_path.stat().st_size}) + "\n")
            with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
                PACKET["build_packet"](manifest, pdf_path, report_path, output)
            manifest.write_text(json.dumps({"file_id": "F0001", "split": "TRAIN_PUBLIC",
                                            "distribution_status": "INCLUDE", "sha256": "0" * 64,
                                            "size_bytes": pdf_path.stat().st_size}) + "\n")
            with self.assertRaisesRegex(ValueError, "PDF size or SHA-256"):
                PACKET["build_packet"](manifest, pdf_path, report_path, output)


if __name__ == "__main__":
    unittest.main()
