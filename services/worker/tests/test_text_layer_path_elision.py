from __future__ import annotations

import hashlib
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch

from pdfminer import converter, layout
from pdfminer.converter import PDFPageAggregator

from inspector_worker.text_layer import _visible_pdf_layouts, extract_pdf_text_artifact


_ORIGINAL_PAINT_PATH = PDFPageAggregator.paint_path


def _encode_pdf(objects: list[bytes]) -> bytes:
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend((f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
                 f"startxref\n{xref}\n%%EOF\n").encode())
    return bytes(data)


def _mixed_pdf(*, rotation: int = 0, crop: bool = True,
               origin: tuple[int, int] = (0, 0), hidden: bool = False,
               kind: str = "mixed") -> bytes:
    """Independent PDF operators: no renderer or extraction output as an oracle."""
    ox, oy = origin
    content = f"q 1 0 0 1 {ox} {oy} cm\n".encode()
    if kind in {"mixed", "vectors"}:
        content += (b"0 0 0 RG 1 w 0 0 m 200 160 l S\n"
                    b"20 20 30 40 re f\n"
                    b"1 1 m 2 3 4 5 6 7 c 8 9 l h B\n"
                    b"10 10 m 20 20 l 30 30 m 40 40 l S\n")
    if kind == "mixed":
        content += b"BT /F1 10 Tf 1 0 0 1 45 65 Tm (DIRECT TEXT) Tj ET\n"
        if hidden:
            # With CropBox, Z is wholly outside and Q crosses its right edge.
            content += (b"BT /F1 10 Tf 1 0 0 1 5 5 Tm (Z) Tj ET\n"
                        b"BT /F1 10 Tf 1 0 0 1 178 95 Tm (Q) Tj ET\n")
    if kind in {"mixed", "form"}:
        content += b"q 1 0.2 0.1 1 30 40 cm /Form1 Do Q\n"
    if kind in {"mixed", "image"}:
        content += b"q 10 0 0 10 100 100 cm /Im1 Do Q\n"
    content += b"Q\n"
    form = (b"q 1 0 0 1 4 5 cm 0 0 20 10 re S\n"
            b"BT /F1 8 Tf 1 0 0 1 1 3 Tm (FORM TEXT) Tj ET Q")
    crop_entry = f"/CropBox [{ox + 20} {oy + 10} {ox + 180} {oy + 150}]" if crop else ""
    return _encode_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [{ox} {oy} {ox + 200} {oy + 160}] "
         f"{crop_entry} /Rotate {rotation} /Resources << /Font << /F1 4 0 R >> "
         "/XObject << /Form1 6 0 R /Im1 7 0 R >> >> /Contents 5 0 R >>").encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"endstream",
        (f"<< /Type /XObject /Subtype /Form /BBox [0 0 40 20] "
         f"/Matrix [0.9 0.1 -0.1 1.1 2 3] /Resources << /Font << /F1 4 0 R >> >> "
         f"/Length {len(form)} >>\nstream\n").encode() + form + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB "
        b"/BitsPerComponent 8 /Length 3 >>\nstream\n\xff\x00\x00\nendstream",
    ])


@contextmanager
def _original_vector_aggregator():
    """Keep the production subclass's CropBox CTM but restore original painting.

    __init_subclass__ runs after VisiblePageAggregator's class body is created,
    so its eventual no-op cannot accidentally make both sides the candidate.
    """
    class OriginalVectorAggregator(PDFPageAggregator):
        def __init_subclass__(cls, **kwargs):
            super().__init_subclass__(**kwargs)
            cls.paint_path = _ORIGINAL_PAINT_PATH

    with patch.object(converter, "PDFPageAggregator", OriginalVectorAggregator):
        yield


def _extract(path: Path, *, original: bool = False) -> dict:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if original:
        with _original_vector_aggregator():
            return extract_pdf_text_artifact(path, "SYNTHETIC-PATHS", digest)
    return extract_pdf_text_artifact(path, "SYNTHETIC-PATHS", digest)


@contextmanager
def _allocation_counts(*, original: bool = False):
    counts = {"nonemptyPaths": 0, "LTLine": 0, "LTRect": 0, "LTCurve": 0,
              "begin_figure": 0, "end_figure": 0, "render_image": 0}

    # Wrap actual constructors, retaining real classes for isinstance/super().
    def count_call(name, method):
        def counted(self, *args, **kwargs):
            counts[name] += 1
            return method(self, *args, **kwargs)
        return counted

    class InstrumentedAggregator(PDFPageAggregator):
        def __init_subclass__(cls, **kwargs):
            super().__init_subclass__(**kwargs)
            implementation = _ORIGINAL_PAINT_PATH if original else cls.paint_path

            def paint_path(self, gstate, stroke, fill, evenodd, path):
                if path:
                    counts["nonemptyPaths"] += 1
                return implementation(self, gstate, stroke, fill, evenodd, path)

            cls.paint_path = paint_path

    with ExitStack() as stack:
        for name in ("LTLine", "LTRect", "LTCurve"):
            cls = getattr(layout, name)
            stack.enter_context(patch.object(cls, "__init__", count_call(name, cls.__init__)))
        for name in ("begin_figure", "end_figure", "render_image"):
            method = getattr(converter.PDFLayoutAnalyzer, name)
            stack.enter_context(patch.object(converter.PDFLayoutAnalyzer, name, count_call(name, method)))
        stack.enter_context(patch.object(converter, "PDFPageAggregator", InstrumentedAggregator))
        yield counts


def _non_vector_layout(item):
    """Compare existing figure/image/text transforms while ignoring vector marks."""
    if isinstance(item, layout.LTCurve):
        return None
    value = {"type": type(item).__name__}
    for name in ("bbox", "matrix", "name", "srcsize"):
        if hasattr(item, name):
            value[name] = getattr(item, name)
    if isinstance(item, layout.LTText):
        value["text"] = item.get_text()
    if isinstance(item, layout.LTContainer):
        value["children"] = [child_value for child in item if (child_value := _non_vector_layout(child)) is not None]
    return value


class TextLayerPathElisionTests(unittest.TestCase):
    def test_full_artifact_equals_original_for_all_visible_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "mixed.pdf"
            for rotation in (0, 90, 180, 270):
                for crop in (False, True):
                    for origin in ((0, 0), (-50, 30)):
                        for hidden in (False, True):
                            with self.subTest(rotation=rotation, crop=crop, origin=origin, hidden=hidden):
                                source.write_bytes(_mixed_pdf(rotation=rotation, crop=crop, origin=origin, hidden=hidden))
                                baseline = _extract(source, original=True)
                                candidate = _extract(source)
                                self.assertEqual(candidate, baseline)  # No stripped fields or hash rewriting.
                                page = candidate["pages"][0]
                                dimensions = (160_000, 140_000) if crop else (200_000, 160_000)
                                if rotation in (90, 270):
                                    dimensions = dimensions[::-1]
                                self.assertEqual((page["widthMilliPoints"], page["heightMilliPoints"]), dimensions)
                                self.assertEqual(page["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
                                self.assertGreaterEqual(page["quality"]["metrics"]["alphanumericCharacterCount"], 10)
                                self.assertTrue(all(block["lineBboxesMilliPoints"] for block in page["blocks"]))
                                if crop and hidden:
                                    text = "".join(block["text"] for block in page["blocks"])
                                    self.assertNotIn("Z", text)
                                    self.assertNotIn("Q", text)

    def test_vector_only_and_image_only_remain_ocr_required(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "nontext.pdf"
            for kind in ("vectors", "image"):
                for rotation in (0, 90, 180, 270):
                    with self.subTest(kind=kind, rotation=rotation):
                        source.write_bytes(_mixed_pdf(kind=kind, rotation=rotation, origin=(-50, 30)))
                        candidate = _extract(source)
                        self.assertEqual(candidate, _extract(source, original=True))
                        page = candidate["pages"][0]
                        self.assertEqual(page["blocks"], [])
                        self.assertEqual(page["quality"]["disposition"], "OCR_REQUIRED")
                        self.assertEqual(page["quality"]["reasonCodes"], ["EMPTY_TEXT_LAYER"])
                        self.assertEqual(page["quality"]["metrics"]["nonWhitespaceCharacterCount"], 0)

    def test_transformed_form_and_image_keep_original_layout_behavior(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "forms.pdf"
            for rotation in (0, 90, 180, 270):
                with self.subTest(rotation=rotation):
                    source.write_bytes(_mixed_pdf(rotation=rotation, origin=(-50, 30)))
                    with _original_vector_aggregator():
                        baseline = [(_non_vector_layout(page), bounds) for page, bounds in _visible_pdf_layouts(source)]
                    candidate = [(_non_vector_layout(page), bounds) for page, bounds in _visible_pdf_layouts(source)]
                    self.assertEqual(candidate, baseline)
                    def descendants(node):
                        yield node
                        for child in node.get("children", []):
                            yield from descendants(child)
                    nodes = list(descendants(candidate[0][0]))
                    self.assertTrue(any(node.get("name") == "Form1" for node in nodes))
                    self.assertTrue(any(node["type"] == "LTImage" for node in nodes))
                    form = next(node for node in nodes if node.get("name") == "Form1")
                    self.assertEqual("".join(node.get("text", "") for node in descendants(form)
                                             if node["type"] == "LTChar"), "FORM TEXT")
                    # The existing top-level extractor omits Form text. Preserve
                    # its current output, without presenting Form text as supported.
                    artifact = _extract(source)
                    self.assertEqual(artifact, _extract(source, original=True))
                    text = "".join(block["text"] for page in artifact["pages"] for block in page["blocks"])
                    self.assertNotIn("FORM", text)

    def test_repeated_extraction_is_exact_and_does_not_leak_page_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "repeated.pdf"
            source.write_bytes(_mixed_pdf(rotation=270, origin=(-50, 30), hidden=True))
            baseline = _extract(source, original=True)
            for _ in range(4):
                self.assertEqual(_extract(source), baseline)

    def test_nonempty_paths_allocate_no_vector_objects_but_keep_figures_and_images(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "allocation.pdf"
            source.write_bytes(_mixed_pdf())
            with _allocation_counts(original=True) as baseline:
                expected = _extract(source)
            with _allocation_counts() as candidate:
                actual = _extract(source)
            self.assertEqual(actual, expected)
            self.assertGreater(candidate["nonemptyPaths"], 0, "Painted paths must actually reach the production subclass")
            for name in ("LTLine", "LTRect", "LTCurve"):
                self.assertGreater(baseline[name], 0, f"Baseline fixture must allocate {name}")
                self.assertEqual(candidate[name], 0, f"Production subclass still allocates unused {name}")
            for name in ("begin_figure", "end_figure", "render_image"):
                self.assertGreater(baseline[name], 0)
                self.assertEqual(candidate[name], baseline[name], f"Keep existing {name} behavior")


if __name__ == "__main__":
    unittest.main()
