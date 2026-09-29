"""Bounded page-frame evidence for manual geometry review only.

PyMuPDF keeps its own PDF box values. The independent API reads Poppler's
two-decimal ``pdfinfo`` output and checks those raw values against the explicit
0.01 pt reporting interval. This artifact cannot establish a geometric fact.
"""

from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any

from .geometry_evidence import _png_size, _source_page


SCHEMA_VERSION = "geometry-page-frame-v2"
PARSER_PRECISION_PROFILE = "poppler-pdfinfo-box-2dp-v1"
BOX_STEP_PT = 0.01
REASON_CODE = "PAGE_FRAME_PRECISION_UNRESOLVED"
RENDERER_PROFILE_PREFIX = "poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@"
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_RENDER_BYTES = 128 * 1024 * 1024
MAX_RENDER_PIXELS = 16_000_000
MAX_PAGE_NUMBER = 10_000
_VERSION = re.compile(r"^pdftoppm version (\d+\.\d+\.\d+)\s*$", re.MULTILINE)


def _run(command: list[str], *, timeout: int, cwd: str | None = None) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(command, cwd=cwd, check=True, capture_output=True,
                                timeout=timeout, env={**os.environ, "LC_ALL": "C"})
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise ValueError("Poppler renderer unavailable or failed") from error
    return result


def _renderer_version() -> str:
    result = _run(["pdftoppm", "-v"], timeout=5)
    text = (result.stdout + b"\n" + result.stderr).decode("ascii", errors="replace")
    versions = _VERSION.findall(text)
    if len(versions) != 1:
        raise ValueError("ambiguous Poppler renderer version")
    return versions[0]


def build_geometry_page_frame_v2(
    source_bytes: bytes,
    *,
    source_file_id: str,
    pdf_page_number: int,
) -> tuple[dict[str, Any], bytes]:
    """Create one SHA-bound ABSTAIN packet and exact Poppler PNG for its page.

    Caller stores both atomically. API independently rerenders the same original
    PDF and checks the raw worker boxes against its own rounded Poppler boxes.
    The packet contains no Poppler box claimed by the worker and no candidates.
    """
    if not isinstance(source_bytes, bytes) or not 5 <= len(source_bytes) <= MAX_SOURCE_BYTES \
            or not source_bytes.startswith(b"%PDF-"):
        raise ValueError("source PDF outside bounds")
    if not isinstance(source_file_id, str) or not 1 <= len(source_file_id) <= 256 \
            or source_file_id.strip() != source_file_id:
        raise ValueError("invalid source file ID")
    if type(pdf_page_number) is not int or not 1 <= pdf_page_number <= MAX_PAGE_NUMBER:
        raise ValueError("PDF page outside bounds")

    media, crop, rotation = _source_page(source_bytes, pdf_page_number)
    if any(not math.isfinite(value) or abs(value) > 1_000_000 for value in (*media, *crop)) \
            or media[2] <= media[0] or media[3] <= media[1] \
            or crop[2] <= crop[0] or crop[3] <= crop[1] \
            or any(crop[index] < media[index] - 0.01 for index in (0, 1)) \
            or any(crop[index] > media[index] + 0.01 for index in (2, 3)):
        raise ValueError("invalid PDF page boxes")
    width, height = crop[2] - crop[0], crop[3] - crop[1]
    if math.ceil(width + 1) * math.ceil(height + 1) > MAX_RENDER_PIXELS:
        raise ValueError("PDF render dimensions outside bounds")
    version = _renderer_version()
    with tempfile.TemporaryDirectory(prefix="inspector-geometry-frame-") as temporary:
        source_path = Path(temporary) / "source.pdf"
        source_path.write_bytes(source_bytes)
        output_prefix = Path(temporary) / "page"
        result = _run(["pdftoppm", "-f", str(pdf_page_number), "-l", str(pdf_page_number),
                       "-r", "72", "-cropbox", "-png", "-singlefile", str(source_path),
                       str(output_prefix)], timeout=30)
        if result.stdout.strip() or result.stderr.strip():
            raise ValueError("Poppler renderer emitted unexpected output")
        output_path = output_prefix.with_suffix(".png")
        if not output_path.is_file() or not 45 <= output_path.stat().st_size <= MAX_RENDER_BYTES:
            raise ValueError("Poppler PNG outside bounds")
        render_bytes = output_path.read_bytes()
    width_px, height_px = _png_size(render_bytes)
    if width_px * height_px > MAX_RENDER_PIXELS:
        raise ValueError("Poppler PNG pixels outside bounds")

    source_sha = hashlib.sha256(source_bytes).hexdigest()
    render_sha = hashlib.sha256(render_bytes).hexdigest()
    packet: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "ABSTAIN",
        "reasonCode": REASON_CODE,
        "source": {"sourceFileId": source_file_id, "sourceSha256": source_sha,
                   "byteSize": len(source_bytes), "pdfPageNumber": pdf_page_number},
        "render": {"rendererProfileId": RENDERER_PROFILE_PREFIX + version,
                   "renderSha256": render_sha, "byteSize": len(render_bytes),
                   "widthPx": width_px, "heightPx": height_px},
        "workerFrame": {"mediaBox": list(media), "cropBox": list(crop), "rotate": rotation},
        "parserPrecision": {"profileId": PARSER_PRECISION_PROFILE, "boxStepPt": BOX_STEP_PT},
        "candidates": [],
    }
    return packet, render_bytes
