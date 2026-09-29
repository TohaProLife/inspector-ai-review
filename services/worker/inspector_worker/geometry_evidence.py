"""Pure, fail-closed PDF page-frame and unclassified geometry proposal validator.

Coordinates in ``native`` are PDF user-space points (y up). ``visible`` uses
the cropped, rotated page (top-left origin, y down). Candidate coordinates are
normalized visible coordinates. No world registration or subject facts live in
this v1 artifact.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from typing import Any, Mapping

import fitz


SCHEMA_VERSION = "geometry-proposal-v1"
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_MATRIX_TOLERANCE = 1e-5


def _keys(value: Any, required: set[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError(f"expected exact fields {sorted(required)}")
    return value


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("nonfinite or nonnumeric geometry value")
    return float(value)


def _integer(value: Any, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("integer outside allowed bounds")
    return value


def _sha(value: Any) -> str:
    if not isinstance(value, str) or _SHA.fullmatch(value) is None:
        raise ValueError("invalid SHA-256")
    return value


def _rect(value: Any) -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError("invalid PDF box")
    x0, y0, x1, y1 = map(_number, value)
    if x1 <= x0 or y1 <= y0:
        raise ValueError("empty PDF box")
    return x0, y0, x1, y1


def _matrix(value: Any) -> tuple[float, float, float, float, float, float]:
    if not isinstance(value, list) or len(value) != 6:
        raise ValueError("invalid affine matrix")
    result = tuple(map(_number, value))
    if abs(result[0] * result[4] - result[1] * result[3]) < 1e-12:
        raise ValueError("noninvertible affine matrix")
    return result  # type: ignore[return-value]


def invert_affine(matrix: tuple[float, float, float, float, float, float]) -> list[float]:
    a, b, c, d, e, f = matrix
    determinant = a * e - b * d
    if abs(determinant) < 1e-12:
        raise ValueError("noninvertible affine matrix")
    return [e / determinant, -b / determinant, (b * f - e * c) / determinant,
            -d / determinant, a / determinant, (d * c - a * f) / determinant]


def transform(matrix: tuple[float, float, float, float, float, float] | list[float],
              point: tuple[float, float]) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    x, y = point
    return a * x + b * y + c, d * x + e * y + f


def expected_frame(crop_box: tuple[float, float, float, float], rotation: int,
                   width_px: int, height_px: int) -> dict[str, list[float]]:
    """Expected PDF-native to visible/raster transforms; /Rotate is clockwise."""
    x0, y0, x1, y1 = crop_box
    width, height = x1 - x0, y1 - y0
    if rotation == 0:
        native_to_visible = [1.0, 0.0, -x0, 0.0, -1.0, y1]
        visible_size = [width, height]
    elif rotation == 90:
        native_to_visible = [0.0, 1.0, -y0, 1.0, 0.0, -x0]
        visible_size = [height, width]
    elif rotation == 180:
        native_to_visible = [-1.0, 0.0, x1, 0.0, 1.0, -y0]
        visible_size = [width, height]
    elif rotation == 270:
        native_to_visible = [0.0, -1.0, y1, -1.0, 0.0, x1]
        visible_size = [height, width]
    else:
        raise ValueError("unsupported or ambiguous PDF Rotate")
    visible_to_pixel = [width_px / visible_size[0], 0.0, 0.0,
                        0.0, height_px / visible_size[1], 0.0]
    return {"visibleSizePt": visible_size,
            "nativeToVisible": native_to_visible,
            "visibleToNative": invert_affine(tuple(native_to_visible)),
            "visibleToPixel": visible_to_pixel,
            "pixelToVisible": invert_affine(tuple(visible_to_pixel))}


def _pdf_box(document: fitz.Document, page: fitz.Page, name: str,
             media: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """Read effective raw PDF box, including page-tree inheritance.

    PyMuPDF's public ``cropbox`` is already converted to its top-left frame;
    mixing it with raw MediaBox coordinates would silently shift pages.
    """
    xref = page.xref
    seen: set[int] = set()
    while xref and xref not in seen:
        seen.add(xref)
        kind, raw = document.xref_get_key(xref, name)
        if kind == "array":
            parts = raw.strip("[]").split()
            if len(parts) != 4:
                raise ValueError("ambiguous PDF box")
            return _rect([float(part) for part in parts])
        if kind != "null":
            raise ValueError("unsupported PDF box representation")
        parent_kind, parent = document.xref_get_key(xref, "Parent")
        xref = int(parent.split()[0]) if parent_kind == "xref" else 0
    return media


def _source_page(source_bytes: bytes, page_number: int) -> tuple[tuple[float, ...], tuple[float, ...], int]:
    try:
        with fitz.open(stream=source_bytes, filetype="pdf") as document:
            if not document.is_pdf or document.needs_pass or page_number > len(document):
                raise ValueError("invalid or unavailable source PDF page")
            page = document[page_number - 1]
            media = _rect(list(page.mediabox))
            crop = _pdf_box(document, page, "CropBox", media)
            xref = page.xref
            seen: set[int] = set()
            rotation = 0
            while xref and xref not in seen:
                seen.add(xref)
                kind, raw = document.xref_get_key(xref, "Rotate")
                if kind == "int":
                    rotation = int(raw)
                    break
                if kind != "null":
                    raise ValueError("ambiguous PDF Rotate")
                parent_kind, parent = document.xref_get_key(xref, "Parent")
                xref = int(parent.split()[0]) if parent_kind == "xref" else 0
            if rotation not in (0, 90, 180, 270) or rotation != page.rotation:
                raise ValueError("unsupported or ambiguous PDF Rotate")
            return media, crop, rotation
    except (fitz.FileDataError, fitz.EmptyFileError) as error:
        raise ValueError("invalid source PDF") from error


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or not data.startswith(_PNG_SIGNATURE) or data[12:16] != b"IHDR":
        raise ValueError("render must be PNG")
    width, height = struct.unpack(">II", data[16:24])
    if not 1 <= width <= 100_000 or not 1 <= height <= 100_000 or width * height > 64_000_000:
        raise ValueError("render dimensions outside bounds")
    try:
        pixmap = fitz.Pixmap(data)
        if (pixmap.width, pixmap.height) != (width, height):
            raise ValueError("render PNG dimensions mismatch")
    except (RuntimeError, ValueError) as error:
        raise ValueError("invalid render PNG") from error
    return width, height


def _near(actual: Any, expected: list[float]) -> None:
    if not isinstance(actual, list) or len(actual) != len(expected):
        raise ValueError("missing page transform")
    if any(abs(_number(a) - e) > _MATRIX_TOLERANCE * max(1.0, abs(e))
           for a, e in zip(actual, expected)):
        raise ValueError("page transform does not match PDF frame")


def _point(value: Any) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("invalid canonical point")
    x, y = map(_number, value)
    if not 0 <= x <= 1 or not 0 <= y <= 1:
        raise ValueError("candidate outside visible page")
    return x, y


def _cross(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a: tuple[float, float], b: tuple[float, float], p: tuple[float, float]) -> bool:
    return (abs(_cross(a, b, p)) <= 1e-12 and min(a[0], b[0]) - 1e-12 <= p[0] <= max(a[0], b[0]) + 1e-12
            and min(a[1], b[1]) - 1e-12 <= p[1] <= max(a[1], b[1]) + 1e-12)


def _intersects(a: tuple[float, float], b: tuple[float, float],
                c: tuple[float, float], d: tuple[float, float]) -> bool:
    ab_c, ab_d, cd_a, cd_b = _cross(a, b, c), _cross(a, b, d), _cross(c, d, a), _cross(c, d, b)
    if (ab_c > 0 > ab_d or ab_c < 0 < ab_d) and (cd_a > 0 > cd_b or cd_a < 0 < cd_b):
        return True
    return any((_on_segment(a, b, c), _on_segment(a, b, d),
                _on_segment(c, d, a), _on_segment(c, d, b)))


def _polygon(value: Any) -> None:
    if not isinstance(value, list) or not 3 <= len(value) <= 256:
        raise ValueError("polygon vertex count outside bounds")
    vertices = [_point(item) for item in value]
    if len(set(vertices)) != len(vertices):
        raise ValueError("repeated polygon vertex")
    area2 = sum(vertices[i][0] * vertices[(i + 1) % len(vertices)][1]
                - vertices[(i + 1) % len(vertices)][0] * vertices[i][1]
                for i in range(len(vertices)))
    if abs(area2) <= 1e-12:
        raise ValueError("zero-area polygon")
    for i in range(len(vertices)):
        for j in range(i + 1, len(vertices)):
            if j == i + 1 or (i == 0 and j == len(vertices) - 1):
                continue
            if _intersects(vertices[i], vertices[(i + 1) % len(vertices)],
                           vertices[j], vertices[(j + 1) % len(vertices)]):
                raise ValueError("self-intersecting polygon")


def _drawing_token(value: Any) -> Any:
    if isinstance(value, fitz.Point):
        return ["Point", _number(value.x), _number(value.y)]
    if isinstance(value, fitz.Rect):
        return ["Rect", *map(_number, value)]
    if isinstance(value, (tuple, list)):
        return [_drawing_token(item) for item in value]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _number(value)
    if isinstance(value, str):
        return value
    raise ValueError("unsupported PDF vector item")


def _item_sha256(item: Any) -> str:
    canonical = json.dumps(_drawing_token(item), ensure_ascii=False,
                           separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def vector_item_sha256(source_bytes: bytes, page_number: int,
                       drawing_index: int, item_index: int) -> str:
    """Hash an original PyMuPDF vector item at an explicit physical PDF page."""
    _integer(drawing_index, 0, 1_000_000)
    _integer(item_index, 0, 1_000_000)
    with fitz.open(stream=source_bytes, filetype="pdf") as document:
        if page_number < 1 or page_number > len(document):
            raise ValueError("invalid source PDF page")
        drawings = document[page_number - 1].get_drawings()
        try:
            return _item_sha256(drawings[drawing_index]["items"][item_index])
        except (IndexError, KeyError, TypeError) as error:
            raise ValueError("PDF vector item locator invalid") from error


def validate_geometry_proposal_v1(record: Any, *, source_bytes: bytes,
                                  render_bytes: bytes,
                                  mask_bytes_by_sha: Mapping[str, bytes] | None = None) -> None:
    """Validate one original PDF page; return nothing and make no subject claim."""
    root = _keys(record, {"schemaVersion", "status", "reasonCode", "source", "pageFrame", "render", "candidates"})
    if root["schemaVersion"] != SCHEMA_VERSION or root["status"] not in ("PROPOSAL", "ABSTAIN"):
        raise ValueError("unsupported geometry proposal version or status")
    source = _keys(root["source"], {"sourceFileId", "sourceSha256", "byteSize", "pdfPageNumber"})
    if not isinstance(source["sourceFileId"], str) or not source["sourceFileId"]:
        raise ValueError("sourceFileId required")
    if not isinstance(source_bytes, bytes) or not 1 <= len(source_bytes) <= 512 * 1024 * 1024:
        raise ValueError("source bytes outside bounds")
    if _integer(source["byteSize"], 1, 512 * 1024 * 1024) != len(source_bytes) or _sha(source["sourceSha256"]) != hashlib.sha256(source_bytes).hexdigest():
        raise ValueError("source PDF size/SHA-256 mismatch")
    page_number = _integer(source["pdfPageNumber"], 1, 1_000_000)
    media, crop, rotation = _source_page(source_bytes, page_number)
    if any(c < m - 1e-5 for c, m in zip(crop[:2], media[:2])) or any(c > m + 1e-5 for c, m in zip(crop[2:], media[2:])):
        raise ValueError("CropBox outside MediaBox")

    render = _keys(root["render"], {"rendererProfileId", "dpi", "renderSha256", "byteSize", "widthPx", "heightPx", "visibleToPixel", "pixelToVisible"})
    if not isinstance(render["rendererProfileId"], str) or not render["rendererProfileId"]:
        raise ValueError("rendererProfileId required")
    if not isinstance(render_bytes, bytes) or not 24 <= len(render_bytes) <= 128 * 1024 * 1024:
        raise ValueError("render bytes outside bounds")
    if _integer(render["byteSize"], 24, 128 * 1024 * 1024) != len(render_bytes) or _sha(render["renderSha256"]) != hashlib.sha256(render_bytes).hexdigest():
        raise ValueError("render size/SHA-256 mismatch")
    width, height = _png_size(render_bytes)
    if _integer(render["widthPx"], 1, 100_000) != width or _integer(render["heightPx"], 1, 100_000) != height:
        raise ValueError("render pixel dimensions mismatch")
    dpi = _number(render["dpi"])
    if not 36 <= dpi <= 1200:
        raise ValueError("DPI outside bounds")
    frame = _keys(root["pageFrame"], {"mediaBox", "cropBox", "rotate", "visibleSizePt", "nativeToVisible", "visibleToNative"})
    if _rect(frame["mediaBox"]) != media or _rect(frame["cropBox"]) != crop or frame["rotate"] != rotation or type(frame["rotate"]) is not int:
        raise ValueError("PDF page box/rotation mismatch")
    expected = expected_frame(crop, rotation, width, height)
    for key in ("visibleSizePt", "nativeToVisible", "visibleToNative"):
        _near(frame[key], expected[key])
    for key in ("visibleToPixel", "pixelToVisible"):
        _near(render[key], expected[key])
    for key in ("nativeToVisible", "visibleToNative"):
        _matrix(frame[key])
    for key in ("visibleToPixel", "pixelToVisible"):
        _matrix(render[key])
    for actual_px, size_pt in ((width, expected["visibleSizePt"][0]), (height, expected["visibleSizePt"][1])):
        if abs(actual_px - size_pt * dpi / 72) > 1.01:
            raise ValueError("render dimensions inconsistent with DPI")
    x0, y0, x1, y1 = crop
    for point in ((x0, y0), (x0, y1), (x1, y0), (x1, y1), ((x0 + x1) / 2, (y0 + y1) / 2)):
        visible = transform(frame["nativeToVisible"], point)
        native = transform(frame["visibleToNative"], visible)
        pixels = transform(render["visibleToPixel"], visible)
        restored = transform(render["pixelToVisible"], pixels)
        if any(abs(a - b) > 1e-4 for a, b in zip(point, native)) or any(abs(a - b) > 1e-4 for a, b in zip(visible, restored)):
            raise ValueError("page transform round trip failed")

    candidates = root["candidates"]
    if not isinstance(candidates, list) or len(candidates) > 128:
        raise ValueError("candidate count outside bounds")
    if root["status"] == "PROPOSAL" and (not candidates or root["reasonCode"] is not None):
        raise ValueError("PROPOSAL requires candidates and null reasonCode")
    if root["status"] == "ABSTAIN" and (candidates or not isinstance(root["reasonCode"], str) or not root["reasonCode"]):
        raise ValueError("ABSTAIN requires no candidates and a reasonCode")
    mask_bytes_by_sha = mask_bytes_by_sha or {}
    vector_items: list[dict[str, Any]] | None = None
    for ordinal, candidate in enumerate(candidates):
        item = _keys(candidate, {"ordinal", "geometry", "provenance"})
        if item["ordinal"] != ordinal or type(item["ordinal"]) is not int:
            raise ValueError("candidate ordinal mismatch")
        geometry = _keys(item["geometry"], {"kind", "coordinates"})
        if geometry["kind"] == "POINT":
            _point(geometry["coordinates"])
        elif geometry["kind"] == "POLYGON":
            _polygon(geometry["coordinates"])
        else:
            raise ValueError("unsupported geometry kind")
        provenance = item["provenance"]
        if isinstance(provenance, dict) and provenance.get("kind") == "PDF_VECTOR_PATH":
            path = _keys(provenance, {"kind", "drawingIndex", "itemIndex", "pathSha256"})
            _integer(path["drawingIndex"], 0, 1_000_000)
            _integer(path["itemIndex"], 0, 1_000_000)
            if vector_items is None:
                with fitz.open(stream=source_bytes, filetype="pdf") as document:
                    vector_items = document[page_number - 1].get_drawings()
            try:
                actual_item = vector_items[path["drawingIndex"]]["items"][path["itemIndex"]]
            except (IndexError, KeyError, TypeError) as error:
                raise ValueError("PDF vector item locator invalid") from error
            if _sha(path["pathSha256"]) != _item_sha256(actual_item):
                raise ValueError("PDF vector path SHA-256 mismatch")
        elif isinstance(provenance, dict) and provenance.get("kind") == "RASTER_MASK":
            mask = _keys(provenance, {"kind", "maskSha256", "renderSha256", "widthPx", "heightPx"})
            digest = _sha(mask["maskSha256"])
            data = mask_bytes_by_sha.get(digest)
            if not isinstance(data, bytes) or hashlib.sha256(data).hexdigest() != digest or mask["renderSha256"] != render["renderSha256"] or _png_size(data) != (width, height) or mask["widthPx"] != width or mask["heightPx"] != height:
                raise ValueError("raster mask provenance mismatch")
        else:
            raise ValueError("candidate has no supported path/mask provenance")
