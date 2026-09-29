"""Bounded, source-independent Poppler page evidence for human navigation.

This module reads original PDF bytes and records the complete Poppler word list
on explicitly selected pages. It does not decide source authority, classify
sections, associate table rows, produce typed facts, or infer absence.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import selectors
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "poppler-page-evidence-v1"
POPPLER_VERSION = "25.12.0"
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_PDF_PAGES = 10_000
MAX_SELECTED_PAGES = 4
MAX_XML_BYTES = 16 * 1024 * 1024
MAX_WORDS_PER_PAGE = 5_000
MAX_EVIDENCE_BYTES = 32 * 1024 * 1024
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_COORDINATE = re.compile(r"(?:0|[1-9]\d*)(?:\.\d{1,6})?\Z")


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return _sha(payload)


def _run(program: str, arguments: list[str], max_bytes: int) -> tuple[bytes, bytes]:
    try:
        process = subprocess.Popen(
            [program, *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={"LC_ALL": "C", "PATH": "/usr/bin:/bin"},
        )
    except OSError as error:
        raise ValueError(f"Poppler {program} unavailable or failed") from error
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + 15
    try:
        with selectors.DefaultSelector() as selector:
            assert process.stdout is not None and process.stderr is not None
            selector.register(process.stdout, selectors.EVENT_READ, (stdout, max_bytes))
            selector.register(process.stderr, selectors.EVENT_READ, (stderr, 4096))
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError(f"Poppler {program} timed out")
                for key, _ in selector.select(remaining):
                    target, limit = key.data
                    chunk = os.read(key.fd, min(64 * 1024, limit + 1 - len(target)))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    elif len(target) + len(chunk) > limit:
                        raise ValueError("Poppler output outside bounds")
                    else:
                        target.extend(chunk)
        remaining = deadline - time.monotonic()
        if remaining <= 0 or process.wait(timeout=remaining) != 0:
            raise ValueError(f"Poppler {program} unavailable or failed")
        return bytes(stdout), bytes(stderr)
    except subprocess.TimeoutExpired as error:
        raise ValueError(f"Poppler {program} timed out") from error
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def _version(program: str) -> str:
    stdout, stderr = _run(program, ["-v"], 4096)
    lines = (stdout + stderr).decode("utf-8").splitlines()
    match = re.fullmatch(rf"{re.escape(program)} version (\d+\.\d+\.\d+)",
                         lines[0]) if lines else None
    if match is None or match.group(1) != POPPLER_VERSION:
        raise ValueError(f"page evidence requires {program} {POPPLER_VERSION}")
    if any(not line.startswith("Copyright ") for line in lines[1:] if line):
        raise ValueError("unexpected Poppler version output")
    return match.group(1)


def _one(text: str, pattern: str, field: str) -> str:
    matches = re.findall(pattern, text, re.M)
    if len(matches) != 1:
        raise ValueError(f"ambiguous Poppler {field}")
    return matches[0]


def _milli_points(value: str) -> int:
    if _COORDINATE.fullmatch(value) is None:
        raise ValueError("invalid Poppler coordinate")
    number = float(value)
    if not math.isfinite(number) or number > 100_000:
        raise ValueError("Poppler coordinate outside bounds")
    return math.floor(number * 1000 + 0.5)


def _parse_words(xml: bytes) -> tuple[int, int, list[dict[str, Any]]]:
    if not xml or len(xml) > MAX_XML_BYTES:
        raise ValueError("Poppler XML outside bounds")
    if re.search(rb"<!ENTITY\b", xml, re.I):
        raise ValueError("Poppler XML entity declaration rejected")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ValueError("invalid Poppler XML") from error
    pages = [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "page"]
    if len(pages) != 1:
        raise ValueError("Poppler XML must contain one page")
    page = pages[0]
    if sum(node.tag.rsplit("}", 1)[-1] == "word" for node in root.iter()) != sum(
        node.tag.rsplit("}", 1)[-1] == "word" for node in page.iter()
    ):
        raise ValueError("Poppler word outside selected page")
    width = _milli_points(page.attrib.get("width", ""))
    height = _milli_points(page.attrib.get("height", ""))
    if not width or not height:
        raise ValueError("empty Poppler page geometry")
    words: list[dict[str, Any]] = []
    for node in page.iter():
        if node.tag.rsplit("}", 1)[-1] != "word":
            continue
        if len(words) >= MAX_WORDS_PER_PAGE or not node.text or list(node):
            raise ValueError("empty, nested, or excessive Poppler words")
        box = [_milli_points(node.attrib.get(key, ""))
               for key in ("xMin", "yMin", "xMax", "yMax")]
        if box[0] > box[2] or box[2] > width or box[1] > box[3] or box[3] > height:
            raise ValueError("Poppler word outside page")
        words.append({"wordIndex": len(words), "rawText": node.text,
                      "bboxMilliPointsTopLeft": box})
    if not words:
        raise ValueError("missing Poppler page words")
    return width, height, words


def extract_poppler_page_evidence(
    pdf_path: Path,
    *,
    expected_sha256: str,
    expected_byte_size: int,
    expected_page_count: int,
    page_numbers: list[int],
) -> dict[str, Any]:
    """Extract complete words from at most four explicitly selected pages.

    Caller must separately authenticate dataset permission and source review.
    The result is navigation evidence only, even when selected pages contain
    plausible values. Every byte inspected by Poppler comes from the verified
    private copy, not the caller's potentially changing path.
    """
    if (not isinstance(expected_sha256, str) or _SHA256.fullmatch(expected_sha256) is None
            or type(expected_byte_size) is not int
            or not 5 <= expected_byte_size <= MAX_PDF_BYTES
            or type(expected_page_count) is not int
            or not 1 <= expected_page_count <= MAX_PDF_PAGES
            or type(page_numbers) is not list
            or not 1 <= len(page_numbers) <= MAX_SELECTED_PAGES
            or any(type(page) is not int or not 1 <= page <= expected_page_count
                   for page in page_numbers)
            or page_numbers != sorted(set(page_numbers))):
        raise ValueError("page evidence source or page scope outside bounds")
    path = Path(pdf_path)
    if path.stat().st_size != expected_byte_size:
        raise ValueError("page evidence PDF size mismatch")
    with path.open("rb") as stream:
        pdf_bytes = stream.read(MAX_PDF_BYTES + 1)
    if (len(pdf_bytes) != expected_byte_size or not pdf_bytes.startswith(b"%PDF-")
            or _sha(pdf_bytes) != expected_sha256):
        raise ValueError("page evidence PDF SHA or byte size mismatch")
    # Both programs are pinned before they can parse caller-controlled PDF.
    _version("pdftotext")
    _version("pdfinfo")
    pages: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="inspector-poppler-page-evidence-") as directory:
        verified = Path(directory) / "source.pdf"
        with verified.open("xb") as stream:
            stream.write(pdf_bytes)
        info, info_error = _run("pdfinfo", [str(verified)], 128 * 1024)
        if info_error:
            raise ValueError("Poppler reported PDF warning")
        info_text = info.decode("utf-8")
        count = int(_one(info_text, r"^Pages:\s*(\d+)\s*$", "page count"))
        encrypted = _one(info_text,
                         r"^Encrypted:\s*(yes|no)(?:\s+.*)?$", "PDF encryption")
        if count != expected_page_count or encrypted != "no":
            raise ValueError("Poppler page count or encryption mismatch")
        for number in page_numbers:
            selected = ["-f", str(number), "-l", str(number)]
            xml, xml_error = _run(
                "pdftotext", [*selected, "-bbox-layout", "-enc", "UTF-8",
                              str(verified), "-"], MAX_XML_BYTES,
            )
            plain, plain_error = _run(
                "pdftotext", [*selected, "-raw", "-enc", "UTF-8",
                              str(verified), "-"], MAX_XML_BYTES,
            )
            if xml_error or plain_error:
                raise ValueError("Poppler reported extraction warning")
            width, height, words = _parse_words(xml)
            body = {"providerId": f"worker-poppler-pdftotext-bbox-layout-v1@{POPPLER_VERSION}",
                    "sourceSha256": expected_sha256, "pdfPageCount": expected_page_count,
                    "pageNumber": number, "pageWidthMilliPoints": width,
                    "pageHeightMilliPoints": height, "xmlSha256": _sha(xml),
                    "plainTextSha256": _sha(plain), "pageText": plain.decode("utf-8"),
                    "words": words, "wordArtifactSha256": _canonical_hash(words)}
            pages.append({**body, "inspectionSha256": _canonical_hash(body)})
    result = {"schemaVersion": SCHEMA_VERSION, "purpose": "REVIEW_ONLY",
              "sourceSha256": expected_sha256, "sourceByteSize": expected_byte_size,
              "pdfPageCount": expected_page_count, "selectedPageNumbers": page_numbers,
              "pageEvidence": pages, "absenceConclusion": "NOT_AVAILABLE",
              "typedFacts": None, "findings": None, "parameterCoverage": None}
    result["contentHash"] = _canonical_hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_EVIDENCE_BYTES:
        raise ValueError("page evidence output exceeds bound")
    return result
