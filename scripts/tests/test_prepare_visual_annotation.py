from __future__ import annotations

import hashlib
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

import fitz


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-visual-annotation.py"
MODULE = runpy.run_path(str(SCRIPT))
EVALUATOR = runpy.run_path(str(SCRIPT.with_name("evaluate-visual-proposals.py")))
prepare = MODULE["prepare"]
PreparationError = MODULE["PreparationError"]
pixel_box_to_display_points = MODULE["pixel_box_to_display_points"]


class VisualAnnotationPreparationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "source.pdf"
        with fitz.open() as document:
            page = document.new_page(width=200, height=100)
            page.draw_rect(fitz.Rect(20, 10, 60, 30), color=(0, 0, 0), fill=(0, 0, 0))
            page.set_rotation(90)
            document.save(self.pdf)
        self.entry = {
            "file_id": "F0001", "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "extension": ".pdf", "size_bytes": self.pdf.stat().st_size,
            "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
            "pdf_pages": 1,
        }
        self.manifest = self.root / "manifest.jsonl"
        self.write_manifest()
        self.out = self.root / "workspace"

    def write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.entry) + "\n", encoding="utf-8")

    def test_rotated_full_page_and_draft_identity(self) -> None:
        metadata = prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR",
                           self.out, dpi=144, max_edge=4096, max_pixels=4_000_000)
        self.assertEqual(metadata["page_display_size_pt"], [100, 200])
        self.assertEqual(metadata["pdf_rotation_degrees"], 90)
        self.assertEqual(metadata["image_size_px"], [200, 400])
        self.assertEqual(metadata["pixel_to_display_pt"], [.5, .5])
        self.assertTrue(metadata["render_is_complete_page"])
        self.assertFalse(metadata["model_proposals_included"])
        self.assertEqual(metadata["image_sha256"], hashlib.sha256(
            (self.out / "page.png").read_bytes()).hexdigest())

        with fitz.open(self.pdf) as document:
            expected = fitz.Rect(20, 10, 60, 30) * document[0].rotation_matrix
        display_box = pixel_box_to_display_points(
            [expected.x0 * 2, expected.y0 * 2, expected.x1 * 2, expected.y1 * 2],
            metadata["image_size_px"], metadata["page_display_size_pt"])
        self.assertEqual(display_box, [expected.x0, expected.y0, expected.x1, expected.y1])
        pixmap = fitz.Pixmap(str(self.out / "page.png"))
        x = int((expected.x0 + expected.x1) / 2 * 2)
        y = int((expected.y0 + expected.y1) / 2 * 2)
        self.assertEqual(pixmap.pixel(x, y)[:3], (0, 0, 0))

        draft = json.loads((self.out / "draft.jsonl").read_text())
        self.assertEqual(set(draft), MODULE["REVIEW_KEYS"])
        self.assertEqual(draft["review_status"], "UNREVIEWED")
        self.assertEqual(draft["coverage"], "UNREVIEWED")
        self.assertEqual(draft["annotation_origin"], "UNVERIFIED_DRAFT")
        self.assertFalse(draft["created_without_proposals"])
        self.assertEqual(draft["instances"], [])
        self.assertEqual(draft["page_display_size_pt"], [100, 200])
        artifact = {
            "schemaVersion": "visual-proposal-analysis-v3", "objectId": "OBJ-1",
            "inputManifestHash": "a" * 64, "status": "PROPOSAL_ONLY_UNVERIFIED",
            "contentHash": "b" * 64,
            "profile": {
                "schemaVersion": "visual-proposal-profile-v3",
                "methodId": "red-vector-panel-blue-contact-v1",
                "maxPagesPerSource": 1024, "maxProposalsPerSource": 500,
                "coordinateSystem": "NORMALIZED_TOP_LEFT",
            },
            "sources": [{
                "sourceFileId": "FIL-1", "sourceSha256": self.entry["sha256"],
                "pageCount": 1, "scannedPageCount": 1, "status": "SCANNED",
                "scannedPageNumbers": [1], "skippedPageCount": 0,
                "proposalLimitReached": False, "unretainedProposalCount": 0,
                "proposals": [],
            }],
        }
        report = EVALUATOR["evaluate"](
            [self.entry], artifact, [draft], self.pdf, "F0001", [1], ["RADIATOR"], .5,
            manifest_sha256="m" * 64, artifact_sha256="a" * 64,
            reviews_sha256="r" * 64)
        self.assertEqual(report["status"], "NOT_ESTIMABLE")
        self.assertEqual(report["reason_code"], "FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING")
        self.assertIsNone(report["metrics"])
        html = (self.out / "index.html").read_text()
        self.assertIn("src=\"page.png\"", html)
        self.assertNotIn("bboxNormalized", html)
        self.assertNotIn("HUMAN_APPROVED", html)
        self.assertIn("JSON.stringify(row) + '\\n'", html)
        if shutil.which("node"):
            script = html.split("<script>", 1)[1].split("</script>", 1)[0]
            result = subprocess.run(["node", "--check"], input=script, text=True,
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_hidden_or_nonpublic_source_is_rejected_before_output(self) -> None:
        for changes in ({"split": "TEST_HIDDEN"}, {"distribution_status": "EXCLUDE"},
                        {"label_visibility": "CLOSED"}):
            with self.subTest(changes=changes):
                self.entry.update(changes)
                self.write_manifest()
                with self.assertRaisesRegex(PreparationError, "TRAIN_PUBLIC"):
                    prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
                self.assertFalse(self.out.exists())
                self.entry.update({"split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                                   "label_visibility": "PUBLIC_TRAIN"})

    def test_pdf_hash_page_count_and_duplicate_manifest_fail_closed(self) -> None:
        self.entry["sha256"] = "0" * 64
        self.write_manifest()
        with self.assertRaisesRegex(PreparationError, "SHA-256"):
            prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
        self.entry["sha256"] = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.entry["pdf_pages"] = 2
        self.write_manifest()
        with self.assertRaisesRegex(PreparationError, "page count"):
            prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
        self.entry["pdf_pages"] = 1
        self.write_manifest()
        with self.manifest.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(self.entry) + "\n")
        with self.assertRaisesRegex(PreparationError, "exactly once"):
            prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
        self.assertFalse(self.out.exists())

    def test_no_overwrite_or_out_of_bounds_boxes(self) -> None:
        prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
        with self.assertRaisesRegex(PreparationError, "already exists"):
            prepare(self.manifest, self.pdf, "F0001", 1, "RADIATOR", self.out)
        with self.assertRaisesRegex(PreparationError, "pixel rectangle"):
            pixel_box_to_display_points([0, 0, 201, 40], [200, 400], [100, 200])

    def test_cli_publishes_complete_workspace(self) -> None:
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--manifest", str(self.manifest),
            "--source-pdf", str(self.pdf), "--file-id", "F0001",
            "--page", "1", "--class", "RADIATOR", "--output-dir", str(self.out),
        ], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["review_status"], "UNREVIEWED")
        self.assertEqual({path.name for path in self.out.iterdir()},
                         {"page.png", "index.html", "metadata.json", "draft.jsonl"})


if __name__ == "__main__":
    unittest.main()
