from __future__ import annotations

import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

from inspector_worker.durable_ocr_layout import PROFILE_V2, _validate_bounded_artifact
from inspector_worker.text_layer import extract_pdf_text_artifact


def pdf_page(*, rotation: int = 0, crop: bool = True,
             origin: tuple[int, int] = (0, 0), hidden_text: bool = False,
             empty: bool = False) -> bytes:
    """Independent PDF fixture: 200x160 MediaBox, 160x140 visible CropBox."""
    ox, oy = origin
    content = b""
    if not empty:
        content = f"BT /F1 10 Tf 1 0 0 1 {ox + 45} {oy + 65} Tm (INSIDE) Tj ET\n".encode()
        if hidden_text:
            # Z is outside the visible crop; Q straddles its right edge.
            content += (f"BT /F1 10 Tf 1 0 0 1 {ox + 5} {oy + 5} Tm (Z) Tj ET\n"
                        f"BT /F1 10 Tf 1 0 0 1 {ox + 178} {oy + 95} Tm (Q) Tj ET\n").encode()
    crop_entry = f"/CropBox [{ox + 20} {oy + 10} {ox + 180} {oy + 150}]" if crop else ""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               (f"<< /Type /Page /Parent 2 0 R /MediaBox [{ox} {oy} {ox + 200} {oy + 160}] "
                f"{crop_entry} /Rotate {rotation} /Resources << /Font << /F1 4 0 R >> >> "
                "/Contents 5 0 R >>").encode(),
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"endstream"]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend((f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
                   f"startxref\n{xref}\n%%EOF\n").encode())
    return bytes(result)


def extract(payload: bytes) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "source.pdf"
        path.write_bytes(payload)
        return extract_pdf_text_artifact(path, "SYNTHETIC", hashlib.sha256(payload).hexdigest())


def union_box(page: dict) -> list[int]:
    boxes = [block["bboxMilliPoints"] for block in page["blocks"]]
    return [min(box[0] for box in boxes), min(box[1] for box in boxes),
            max(box[2] for box in boxes), max(box[3] for box in boxes)]


class TextLayerVisibleGeometryTests(unittest.TestCase):
    def test_cropbox_and_rotations_define_visible_page_dimensions(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                artifact = extract(pdf_page(rotation=rotation, empty=True))
                page = artifact["pages"][0]
                expected = (160_000, 140_000) if rotation in (0, 180) else (140_000, 160_000)
                self.assertEqual((page["widthMilliPoints"], page["heightMilliPoints"]), expected)
                self.assertEqual(page["blocks"], [])
                self.assertEqual(page["quality"]["disposition"], "OCR_REQUIRED")
                self.assertEqual(artifact["schemaVersion"], "document-text-v2")
                self.assertEqual(artifact["coordinateSystem"], "PDF_BOTTOM_LEFT_MILLI_POINTS")

    def test_visible_text_and_line_boxes_rebase_once_after_rotation(self) -> None:
        # Derive glyph extents from an uncropped PDF, independently of CropBox
        # conversion; compare against the PDF rotation equations below.
        media_box = union_box(extract(pdf_page(crop=False))["pages"][0])
        x0, y0, x1, y1 = (media_box[0] - 20_000, media_box[1] - 10_000,
                          media_box[2] - 20_000, media_box[3] - 10_000)
        expected = {
            0: [x0, y0, x1, y1],
            90: [y0, 160_000 - x1, y1, 160_000 - x0],
            180: [160_000 - x1, 140_000 - y1, 160_000 - x0, 140_000 - y0],
            270: [140_000 - y1, x0, 140_000 - y0, x1],
        }
        for rotation in expected:
            with self.subTest(rotation=rotation):
                page = extract(pdf_page(rotation=rotation, hidden_text=True))["pages"][0]
                text = "".join(block["text"] for block in page["blocks"])
                self.assertNotIn("Z", text)
                self.assertNotIn("Q", text)
                self.assertEqual(sorted("".join(text.split())), sorted("INSIDE"))
                for actual, wanted in zip(union_box(page), expected[rotation]):
                    self.assertLessEqual(abs(actual - wanted), 1)
                for block in page["blocks"]:
                    self.assertEqual(len(block["lineBboxesMilliPoints"]), len(block["text"].splitlines()))
                    for box in block["lineBboxesMilliPoints"]:
                        self.assertGreaterEqual(box[0], 0)
                        self.assertGreaterEqual(box[1], 0)
                        self.assertLessEqual(box[2], page["widthMilliPoints"])
                        self.assertLessEqual(box[3], page["heightMilliPoints"])

    def test_nonzero_media_origin_does_not_shift_visible_text(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                ordinary = extract(pdf_page(rotation=rotation, hidden_text=True))["pages"][0]
                shifted = extract(pdf_page(rotation=rotation, origin=(-50, 30), hidden_text=True))["pages"][0]
                self.assertEqual(ordinary, shifted)

    def test_no_cropbox_preserves_media_dimensions_and_text(self) -> None:
        page = extract(pdf_page(crop=False))["pages"][0]
        self.assertEqual((page["widthMilliPoints"], page["heightMilliPoints"]), (200_000, 160_000))
        self.assertEqual(page["blocks"][0]["text"], "INSIDE")
        self.assertEqual(page["blocks"][0]["bboxMilliPoints"], [45_000, 62_930, 78_340, 72_930])
        self.assertEqual(page["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")

    def test_unsupported_rotation_and_invalid_crop_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported PDF page rotation"):
            extract(pdf_page(rotation=45))
        invalid = pdf_page().replace(b"/CropBox [20 10 180 150]", b"/CropBox [-1 10 180 150]")
        with self.assertRaisesRegex(ValueError, "invalid PDF CropBox"):
            extract(invalid)

    @unittest.skipUnless(importlib.util.find_spec("pypdfium2"), "PDFium only installed in renderer runtime")
    def test_actual_pdfium_render_passes_existing_strict_v2_gate(self) -> None:
        import pypdfium2 as pdfium

        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                payload = pdf_page(rotation=rotation, empty=True)
                text_page = extract(payload)["pages"][0]
                document = pdfium.PdfDocument(payload)
                try:
                    page = document[0]
                    try:
                        bitmap = page.render(scale=PROFILE_V2["dpi"] / 72)
                        try:
                            width, height = bitmap.width, bitmap.height
                        finally:
                            bitmap.close()
                    finally:
                        page.close()
                finally:
                    document.close()
                self.assertEqual((width, height), (267, 234) if rotation in (0, 180) else (234, 267))
                _validate_bounded_artifact({
                    "render": {"widthPx": width, "heightPx": height,
                               "rendererProfileId": PROFILE_V2["rendererProfileId"]},
                    "provider": {"profileId": PROFILE_V2["ocrProviderProfileIds"][0]},
                }, text_page, PROFILE_V2)
                # A committed legacy MediaBox artifact still fails closed.
                with self.assertRaisesRegex(ValueError, "render geometry differs"):
                    _validate_bounded_artifact({
                        "render": {"widthPx": width, "heightPx": height,
                                   "rendererProfileId": PROFILE_V2["rendererProfileId"]},
                        "provider": {"profileId": PROFILE_V2["ocrProviderProfileIds"][0]},
                    }, {"widthMilliPoints": 200_000, "heightMilliPoints": 160_000}, PROFILE_V2)


if __name__ == "__main__":
    unittest.main()
