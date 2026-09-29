from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import fitz

from inspector_worker.geometry_page_frame_v2 import (
    BOX_STEP_PT, PARSER_PRECISION_PROFILE, RENDERER_PROFILE_PREFIX,
    build_geometry_page_frame_v2,
)


F0126_SHA256 = "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088"


def synthetic_pdf(rotation: int) -> bytes:
    with fitz.open() as document:
        page = document.new_page(width=200, height=100)
        page.set_cropbox(fitz.Rect(20, 10, 180, 80))
        page.set_rotation(rotation)
        page.draw_rect(fitz.Rect(30, 20, 70, 60))
        return document.tobytes()


@unittest.skipUnless(shutil.which("pdftoppm"), "Poppler pdftoppm unavailable")
class GeometryPageFrameV2Tests(unittest.TestCase):
    def test_four_rotations_and_cropbox_remain_abstain_only(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                source = synthetic_pdf(rotation)
                packet, png = build_geometry_page_frame_v2(
                    source, source_file_id="SYNTHETIC", pdf_page_number=1)
                self.assertEqual(packet["schemaVersion"], "geometry-page-frame-v2")
                self.assertEqual(packet["status"], "ABSTAIN")
                self.assertEqual(packet["reasonCode"], "PAGE_FRAME_PRECISION_UNRESOLVED")
                self.assertEqual(packet["candidates"], [])
                self.assertEqual(packet["source"], {
                    "sourceFileId": "SYNTHETIC", "sourceSha256": hashlib.sha256(source).hexdigest(),
                    "byteSize": len(source), "pdfPageNumber": 1})
                self.assertEqual(packet["workerFrame"]["rotate"], rotation)
                self.assertEqual(packet["workerFrame"]["cropBox"], [20.0, 20.0, 180.0, 90.0])
                self.assertEqual(packet["parserPrecision"], {
                    "profileId": PARSER_PRECISION_PROFILE, "boxStepPt": BOX_STEP_PT})
                self.assertTrue(packet["render"]["rendererProfileId"].startswith(RENDERER_PROFILE_PREFIX))
                self.assertEqual(packet["render"]["renderSha256"], hashlib.sha256(png).hexdigest())
                self.assertEqual(packet["render"]["byteSize"], len(png))
                self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
                expected_dimensions = (160, 70) if rotation in (0, 180) else (70, 160)
                self.assertEqual((packet["render"]["widthPx"], packet["render"]["heightPx"]),
                                 expected_dimensions)

    def test_retains_worker_raw_box_instead_of_poppler_rounded_box(self) -> None:
        with fitz.open() as document:
            page = document.new_page(width=124, height=100)
            document.xref_set_key(page.xref, "MediaBox", "[0 0 123.456789 100]")
            source = document.tobytes()
        packet, _ = build_geometry_page_frame_v2(
            source, source_file_id="SYNTHETIC_DECIMAL", pdf_page_number=1)
        raw = packet["workerFrame"]["mediaBox"][2]
        self.assertGreater(raw, 123.45)
        self.assertLess(raw, 123.46)
        self.assertNotEqual(raw, 123.46)
        self.assertEqual(packet["parserPrecision"]["boxStepPt"], 0.01)

    def test_emitted_png_matches_independent_fixed_poppler_command(self) -> None:
        source = synthetic_pdf(90)
        packet, png = build_geometry_page_frame_v2(
            source, source_file_id="SYNTHETIC", pdf_page_number=1)
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "source.pdf"
            pdf.write_bytes(source)
            prefix = Path(directory) / "independent"
            subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-r", "72", "-cropbox",
                            "-png", "-singlefile", str(pdf), str(prefix)], check=True,
                           capture_output=True, timeout=30)
            self.assertEqual(png, prefix.with_suffix(".png").read_bytes())
            self.assertEqual(packet["render"]["renderSha256"], hashlib.sha256(png).hexdigest())

    def test_rejects_bad_pdf_page_and_source_identity(self) -> None:
        source = synthetic_pdf(0)
        for content, identifier, page in (
            (b"not a PDF", "SYNTHETIC", 1),
            (source, "", 1),
            (source, " SYNTHETIC", 1),
            (source, "SYNTHETIC", 0),
            (source, "SYNTHETIC", 2),
        ):
            with self.subTest(identifier=identifier, page=page, content=content[:5]):
                with self.assertRaises(ValueError):
                    build_geometry_page_frame_v2(content, source_file_id=identifier,
                                                 pdf_page_number=page)

    def test_public_f0126_page17_when_original_pdf_is_supplied(self) -> None:
        public_path = os.environ.get("INSPECTOR_PUBLIC_F0126_PDF")
        if not public_path:
            self.skipTest("set INSPECTOR_PUBLIC_F0126_PDF to original permitted public PDF")
        source = Path(public_path).read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), F0126_SHA256)
        packet, png = build_geometry_page_frame_v2(
            source, source_file_id="F0126", pdf_page_number=17)
        self.assertEqual(packet["source"]["sourceSha256"], F0126_SHA256)
        self.assertEqual(packet["workerFrame"]["rotate"], 0)
        self.assertEqual(packet["status"], "ABSTAIN")
        self.assertEqual(packet["candidates"], [])
        self.assertEqual(packet["render"]["renderSha256"], hashlib.sha256(png).hexdigest())


if __name__ == "__main__":
    unittest.main()
