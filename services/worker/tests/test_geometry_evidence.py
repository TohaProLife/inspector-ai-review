from __future__ import annotations

import copy
import hashlib
import unittest

import fitz

from inspector_worker.geometry_evidence import (
    _source_page, expected_frame, transform, validate_geometry_proposal_v1,
    vector_item_sha256,
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def synthetic(rotation: int = 0) -> tuple[dict, bytes, bytes]:
    with fitz.open() as document:
        page = document.new_page(width=200, height=100)
        page.set_cropbox(fitz.Rect(20, 10, 180, 80))
        page.set_rotation(rotation)
        page.draw_rect(fitz.Rect(30, 20, 70, 60))
        page.draw_line(fitz.Point(80, 20), fitz.Point(100, 50))
        source = document.tobytes()
    with fitz.open(stream=source, filetype="pdf") as document:
        render = document[0].get_pixmap(dpi=72, alpha=False).tobytes("png")
    media, crop, actual_rotation = _source_page(source, 1)
    width, height = (160, 70) if rotation in (0, 180) else (70, 160)
    frame = expected_frame(crop, actual_rotation, width, height)
    record = {
        "schemaVersion": "geometry-proposal-v1", "status": "ABSTAIN",
        "reasonCode": "NO_REGISTERED_GEOMETRY",
        "source": {"sourceFileId": "SYNTHETIC", "sourceSha256": digest(source),
                   "byteSize": len(source), "pdfPageNumber": 1},
        "pageFrame": {"mediaBox": list(media), "cropBox": list(crop),
                      "rotate": rotation, "visibleSizePt": frame["visibleSizePt"],
                      "nativeToVisible": frame["nativeToVisible"],
                      "visibleToNative": frame["visibleToNative"]},
        "render": {"rendererProfileId": "pymupdf-72dpi-test", "dpi": 72,
                   "renderSha256": digest(render), "byteSize": len(render),
                   "widthPx": width, "heightPx": height,
                   "visibleToPixel": frame["visibleToPixel"],
                   "pixelToVisible": frame["pixelToVisible"]},
        "candidates": [],
    }
    return record, source, render


class GeometryEvidenceTests(unittest.TestCase):
    def test_crop_and_each_pdf_rotation_round_trip(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                record, source, render = synthetic(rotation)
                validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)
                box = record["pageFrame"]["cropBox"]
                native = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
                visible = transform(record["pageFrame"]["nativeToVisible"], native)
                self.assertEqual(visible, tuple(size / 2 for size in record["pageFrame"]["visibleSizePt"]))
                self.assertEqual(transform(record["pageFrame"]["visibleToNative"], visible), native)

    def test_valid_unclassified_vector_polygon_and_point(self) -> None:
        record, source, render = synthetic()
        record["status"], record["reasonCode"] = "PROPOSAL", None
        record["candidates"] = [
            {"ordinal": 0, "geometry": {"kind": "POLYGON", "coordinates": [
                [0.1, 0.1], [0.3, 0.1], [0.3, 0.4], [0.1, 0.4]]},
             "provenance": {"kind": "PDF_VECTOR_PATH", "drawingIndex": 0,
                            "itemIndex": 0, "pathSha256": vector_item_sha256(source, 1, 0, 0)}},
            {"ordinal": 1, "geometry": {"kind": "POINT", "coordinates": [0.5, 0.6]},
             "provenance": {"kind": "PDF_VECTOR_PATH", "drawingIndex": 1,
                            "itemIndex": 0, "pathSha256": vector_item_sha256(source, 1, 1, 0)}},
        ]
        validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)
        record["candidates"][0]["provenance"]["pathSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "path SHA-256"):
            validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)

    def test_rejects_forged_source_render_and_page(self) -> None:
        record, source, render = synthetic()
        for path, value in ((["source", "sourceSha256"], "0" * 64),
                            (["source", "byteSize"], len(source) + 1),
                            (["source", "pdfPageNumber"], 2),
                            (["render", "renderSha256"], "0" * 64),
                            (["render", "widthPx"], 1)):
            with self.subTest(path=path):
                changed = copy.deepcopy(record)
                changed[path[0]][path[1]] = value
                with self.assertRaises(ValueError):
                    validate_geometry_proposal_v1(changed, source_bytes=source, render_bytes=render)

    def test_rejects_mirror_crop_rotation_and_noninvertible_matrices(self) -> None:
        record, source, render = synthetic(90)
        changes = [
            ("pageFrame", "nativeToVisible", [0, -1, 90, 1, 0, -20]),
            ("pageFrame", "cropBox", [0, 0, 200, 100]),
            ("pageFrame", "rotate", 270),
            ("pageFrame", "nativeToVisible", [1, 0, 0, 0, 0, 0]),
            ("render", "visibleToPixel", [float("nan"), 0, 0, 0, 1, 0]),
        ]
        for section, key, value in changes:
            with self.subTest(key=key, value=value):
                changed = copy.deepcopy(record)
                changed[section][key] = value
                with self.assertRaises(ValueError):
                    validate_geometry_proposal_v1(changed, source_bytes=source, render_bytes=render)

    def test_rejects_invalid_rotation_and_crop_in_source_pdf(self) -> None:
        base, _, render = synthetic()
        for key, value in (("Rotate", "45"), ("CropBox", "[-10 0 180 80]")):
            with self.subTest(pdf_key=key), fitz.open() as document:
                page = document.new_page(width=200, height=100)
                document.xref_set_key(page.xref, key, value)
                modified_source = document.tobytes()
            record = copy.deepcopy(base)
            record["source"]["sourceSha256"] = digest(modified_source)
            record["source"]["byteSize"] = len(modified_source)
            with self.assertRaises(ValueError):
                validate_geometry_proposal_v1(record, source_bytes=modified_source,
                                              render_bytes=render)

    def test_rejects_outside_and_self_intersecting_geometry(self) -> None:
        record, source, render = synthetic()
        record["status"], record["reasonCode"] = "PROPOSAL", None
        record["candidates"] = [{"ordinal": 0,
            "geometry": {"kind": "POINT", "coordinates": [1.01, 0.5]},
            "provenance": {"kind": "PDF_VECTOR_PATH", "drawingIndex": 0,
                           "itemIndex": 0, "pathSha256": vector_item_sha256(source, 1, 0, 0)}}]
        with self.assertRaisesRegex(ValueError, "outside"):
            validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)
        record["candidates"][0]["geometry"] = {"kind": "POLYGON", "coordinates": [
            [0.1, 0.1], [0.9, 0.8], [0.1, 0.8], [0.9, 0.1]]}
        with self.assertRaisesRegex(ValueError, "polygon"):
            validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)

    def test_rejects_world_facts_and_unverified_mask(self) -> None:
        record, source, render = synthetic()
        record["worldCrs"] = "EPSG:3857"
        with self.assertRaisesRegex(ValueError, "exact fields"):
            validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)
        del record["worldCrs"]
        record["status"], record["reasonCode"] = "PROPOSAL", None
        record["candidates"] = [{"ordinal": 0,
            "geometry": {"kind": "POINT", "coordinates": [0.5, 0.5]},
            "provenance": {"kind": "RASTER_MASK", "maskSha256": digest(render),
                           "renderSha256": digest(render), "widthPx": 160, "heightPx": 70}}]
        with self.assertRaisesRegex(ValueError, "mask provenance"):
            validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render)
        validate_geometry_proposal_v1(record, source_bytes=source, render_bytes=render,
                                      mask_bytes_by_sha={digest(render): render})


if __name__ == "__main__":
    unittest.main()
