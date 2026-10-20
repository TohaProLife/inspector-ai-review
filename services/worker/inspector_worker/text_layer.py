from __future__ import annotations

import hashlib
import json
import math
import os
import re
import socket
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterator


MAX_TEXT_ARTIFACT_BYTES = 8 * 1024 * 1024
LEGACY_TEXT_QUALITY_POLICY_VERSION = "text-layer-quality-v1"
TEXT_QUALITY_POLICY_VERSION = "text-layer-quality-v2"
_CID_PLACEHOLDER = re.compile(r"\(cid:[0-9]+\)")


class InputDownloadError(RuntimeError):
    pass


def _source_metadata(source: object) -> tuple[str, str, int, str, str]:
    if not isinstance(source, dict):
        raise ValueError("document sourceFile must be an object")
    source_file_id = source.get("sourceFileId")
    sha256 = source.get("sha256")
    byte_size = source.get("byteSize")
    media_type = source.get("mediaType")
    download_path = source.get("downloadPath")
    if not isinstance(source_file_id, str) or not source_file_id:
        raise ValueError("document sourceFileId is required")
    if not isinstance(sha256, str) or re.fullmatch(r"[a-f0-9]{64}", sha256) is None:
        raise ValueError("document source sha256 is invalid")
    if not isinstance(byte_size, int) or byte_size < 1:
        raise ValueError("document source byteSize is invalid")
    if not isinstance(media_type, str) or not media_type:
        raise ValueError("document source mediaType is required")
    if not isinstance(download_path, str) or not download_path.startswith("/api/internal/v1/jobs/"):
        raise ValueError("document source downloadPath is invalid")
    return source_file_id, sha256, byte_size, media_type, download_path


def _download_source(
    download_path: str,
    destination: Path,
    expected_sha256: str,
    expected_size: int,
    attempt: dict[str, object],
) -> None:
    base_url = os.environ["INSPECTOR_API_INTERNAL_URL"].rstrip("/")
    split = urllib.parse.urlsplit(base_url)
    origin = f"{split.scheme}://{split.netloc}"
    query = urllib.parse.urlencode({
        "attemptId": attempt["attemptId"],
        "fencingToken": attempt["fencingToken"],
    })
    url = urllib.parse.urljoin(f"{origin}/", download_path.lstrip("/")) + f"?{query}"
    request = urllib.request.Request(
        url,
        headers={"X-Worker-Token": os.environ["INTERNAL_WORKER_TOKEN"]},
        method="GET",
    )
    digest = hashlib.sha256()
    written = 0
    try:
        with urllib.request.urlopen(request, timeout=30) as response, destination.open("wb") as output:
            content_length = response.headers.get("Content-Length")
            if content_length is not None and int(content_length) != expected_size:
                raise InputDownloadError("job input Content-Length does not match immutable manifest")
            response_hash = response.headers.get("X-Content-SHA256")
            if response_hash is not None and response_hash != expected_sha256:
                raise InputDownloadError("job input hash header does not match immutable manifest")
            while chunk := response.read(1024 * 1024):
                written += len(chunk)
                if written > expected_size:
                    raise InputDownloadError("job input exceeds immutable manifest byteSize")
                digest.update(chunk)
                output.write(chunk)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise InputDownloadError(f"job input returned {error.code}: {body[:300]}") from error
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as error:
        raise InputDownloadError(f"job input unavailable: {error}") from error
    if written != expected_size:
        raise InputDownloadError("job input byteSize does not match immutable manifest")
    if digest.hexdigest() != expected_sha256:
        raise InputDownloadError("job input sha256 does not match immutable manifest")


def _milli_points(value: float, origin: float, limit: int) -> int:
    return max(0, min(limit, round((value - origin) * 1000)))


def _visible_pdf_layouts(path: Path) -> Iterator[tuple[Any, tuple[float, float, float, float]]]:
    """Keep pdfminer's text layout, with the renderer-visible CropBox in its CTM.

    pdfminer lays out the rotated MediaBox; PDFium renders the rotated CropBox.
    Capture the interpreter's actual CTM rather than applying Rotate twice.
    The durable extraction cache includes this file's SHA, so this correction
    creates new entries without rewriting previously committed artifacts.
    """
    from pdfminer.converter import PDFPageAggregator
    from pdfminer.layout import LAParams
    from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    from pdfminer.pdfpage import PDFPage
    from pdfminer.utils import apply_matrix_pt

    class VisiblePageAggregator(PDFPageAggregator):
        visible_bounds: tuple[float, float, float, float]

        def paint_path(self, gstate: Any, stroke: bool, fill: bool,
                       evenodd: bool, path: Any) -> None:
            # This artifact emits text containers only. Avoid allocating vector
            # marks while preserving the interpreter, figures and text CTM.
            return None

        def begin_page(self, page: Any, ctm: Any) -> None:
            super().begin_page(page, ctm)
            if page.rotate not in (0, 90, 180, 270):
                raise ValueError("unsupported PDF page rotation for visible text geometry")
            media = tuple(float(value) for value in page.mediabox)
            crop = tuple(float(value) for value in page.cropbox)
            if (not all(math.isfinite(value) for value in (*media, *crop))
                    or media[0] >= media[2] or media[1] >= media[3]
                    or crop[0] >= crop[2] or crop[1] >= crop[3]
                    or crop[0] < media[0] or crop[1] < media[1]
                    or crop[2] > media[2] or crop[3] > media[3]):
                raise ValueError("invalid PDF CropBox for visible text geometry")
            corners = [apply_matrix_pt(ctm, point) for point in (
                (crop[0], crop[1]), (crop[0], crop[3]),
                (crop[2], crop[1]), (crop[2], crop[3]),
            )]
            self.visible_bounds = (min(x for x, _ in corners), min(y for _, y in corners),
                                   max(x for x, _ in corners), max(y for _, y in corners))

    with path.open("rb") as source:
        manager = PDFResourceManager(caching=True)
        device = VisiblePageAggregator(manager, laparams=LAParams())
        interpreter = PDFPageInterpreter(manager, device)
        try:
            for page in PDFPage.get_pages(source, caching=True):
                interpreter.process_page(page)
                yield device.get_result(), device.visible_bounds
        finally:
            device.close()


def _inside_visible(item: Any, bounds: tuple[float, float, float, float]) -> bool:
    # Reject partially hidden text rather than clipping its box while retaining
    # invisible characters as a literal observation. Tolerance is float noise,
    # not a render/registration allowance (one millionth of a PDF point).
    epsilon = 1e-6
    return (float(item.x0) >= bounds[0] - epsilon and float(item.y0) >= bounds[1] - epsilon
            and float(item.x1) <= bounds[2] + epsilon and float(item.y1) <= bounds[3] + epsilon)


def _native_text_box(item: Any) -> tuple[float, float, float, float]:
    box = (float(item.x0), float(item.y0), float(item.x1), float(item.y1))
    if (not all(math.isfinite(value) for value in box)
            or box[0] > box[2] or box[1] > box[3]):
        raise ValueError("text geometry has nonfinite or inverted native bounds")
    return box


def _positive_text_box(box: tuple[float, float, float, float]) -> bool:
    return box[0] < box[2] and box[1] < box[3]


def _located_text_box(box: tuple[float, float, float, float],
                      visible: tuple[float, float, float, float],
                      width: int, height: int) -> list[int]:
    converted = [_milli_points(box[0], visible[0], width),
                 _milli_points(box[1], visible[1], height),
                 _milli_points(box[2], visible[0], width),
                 _milli_points(box[3], visible[1], height)]
    if converted[0] >= converted[2] or converted[1] >= converted[3]:
        raise ValueError("positive text geometry collapses at milli-point precision")
    return converted


def _is_policy_whitespace(character: str) -> bool:
    return (
        character in "\t\n\v\f\r\x1c\x1d\x1e\x1f\x85"
        or unicodedata.category(character) in {"Zs", "Zl", "Zp"}
    )


def qualify_page_text(block_texts: list[str], *,
                      policy_version: str = TEXT_QUALITY_POLICY_VERSION) -> dict[str, object]:
    if policy_version not in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("unknown text quality policy version")
    text = "\n".join(block_texts)
    non_whitespace_count = sum(1 for character in text if not _is_policy_whitespace(character))
    alphanumeric_count = sum(1 for character in text if unicodedata.category(character)[0] in {"L", "N"})
    replacement_count = text.count("\ufffd")
    disallowed_control_count = sum(
        1
        for character in text
        if unicodedata.category(character) == "Cc" and character not in "\n\r\t"
    )
    reason_codes: list[str] = []
    if non_whitespace_count == 0:
        reason_codes.append("EMPTY_TEXT_LAYER")
    else:
        if alphanumeric_count == 0:
            reason_codes.append("NO_ALPHANUMERIC_TEXT")
        if (replacement_count > 0 or disallowed_control_count > 0
                or (policy_version == TEXT_QUALITY_POLICY_VERSION
                    and _CID_PLACEHOLDER.search(text) is not None)):
            reason_codes.append("TEXT_DECODING_ANOMALY")
    return {
        "disposition": "OCR_REQUIRED" if reason_codes else "TEXT_LAYER_CANDIDATE",
        "reasonCodes": reason_codes,
        "metrics": {
            "blockCount": len(block_texts),
            "nonWhitespaceCharacterCount": non_whitespace_count,
            "alphanumericCharacterCount": alphanumeric_count,
            "replacementCharacterCount": replacement_count,
            "disallowedControlCharacterCount": disallowed_control_count,
        },
    }


def extract_pdf_text_artifact(path: Path, source_file_id: str, input_sha256: str, *,
                              policy_version: str = TEXT_QUALITY_POLICY_VERSION) -> dict[str, object]:
    if policy_version not in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("unknown text quality policy version")
    from pdfminer.layout import LTChar, LTTextContainer, LTTextLine

    pages: list[dict[str, object]] = []
    text_page_count = 0
    for page_number, (layout, visible) in enumerate(_visible_pdf_layouts(path), start=1):
        width = max(1, round((visible[2] - visible[0]) * 1000))
        height = max(1, round((visible[3] - visible[1]) * 1000))
        blocks: list[dict[str, object]] = []
        for element in layout:
            if not isinstance(element, LTTextContainer):
                continue
            box = _native_text_box(element)
            line_items = [child for child in element if isinstance(child, LTTextLine)]
            # A whole zero-area line is unlocated text, not a located literal.
            # Never remove a glyph from a positive line: that would splice a
            # different statement. LTAnno separators have no glyph geometry.
            inspected_lines = line_items if line_items else [element]
            positive_lines = []
            for line in inspected_lines:
                line_positive = _positive_text_box(_native_text_box(line))
                for glyph in line:
                    if not isinstance(glyph, LTChar):
                        continue
                    glyph_positive = _positive_text_box(_native_text_box(glyph))
                    if glyph_positive != line_positive:
                        raise ValueError("text line and glyph have inconsistent degenerate geometry")
                if line_positive:
                    positive_lines.append(line)
            if not _positive_text_box(box):
                if positive_lines:
                    raise ValueError("zero-area text parent contains positive text geometry")
                continue
            removed_line = bool(line_items) and len(positive_lines) != len(line_items)
            if line_items:
                line_items = positive_lines
            raw_text = element.get_text()
            if removed_line or not _inside_visible(element, visible):
                line_items = [child for child in line_items if _inside_visible(child, visible)]
                if not line_items:
                    continue
                raw_text = "".join(child.get_text() for child in line_items)
                box = (min(float(child.x0) for child in line_items),
                       min(float(child.y0) for child in line_items),
                       max(float(child.x1) for child in line_items),
                       max(float(child.y1) for child in line_items))
            text = raw_text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
            if not text:
                continue
            block = {
                "bboxMilliPoints": _located_text_box(box, visible, width, height),
                "text": text,
            }
            # Keep the exact line geometry when pdfminer exposes a one-to-one
            # line mapping. Older document-text-v2 artifacts remain valid.
            text_lines = text.splitlines()
            normalized_lines = [child.get_text().replace("\r\n", "\n")
                                .replace("\r", "\n").replace("\x00", "").strip()
                                for child in line_items]
            if len(line_items) == len(text_lines) and normalized_lines == [
                    line.strip() for line in text_lines]:
                block["lineBboxesMilliPoints"] = [
                    _located_text_box(_native_text_box(child), visible, width, height)
                    for child in line_items]
            blocks.append(block)
        blocks.sort(key=lambda block: (
            -int(block["bboxMilliPoints"][3]),
            int(block["bboxMilliPoints"][0]),
            int(block["bboxMilliPoints"][1]),
            str(block["text"]),
        ))
        if blocks:
            text_page_count += 1
        quality = qualify_page_text([str(block["text"]) for block in blocks],
                                    policy_version=policy_version)
        pages.append({
            "pageNumber": page_number,
            "widthMilliPoints": width,
            "heightMilliPoints": height,
            "blocks": blocks,
            "quality": quality,
        })
    if not pages:
        raise ValueError("PDF contains no pages")
    text_layer_candidate_page_count = sum(
        1 for page in pages if page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
    )
    artifact: dict[str, object] = {
        "schemaVersion": "document-text-v2",
        "sourceFileId": source_file_id,
        "inputSha256": input_sha256,
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages),
        "textPageCount": text_page_count,
        "qualityPolicyVersion": policy_version,
        "qualitySummary": {
            "textLayerCandidatePageCount": text_layer_candidate_page_count,
            "ocrRequiredPageCount": len(pages) - text_layer_candidate_page_count,
        },
        "pages": pages,
    }
    canonical = json.dumps(artifact, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(canonical) > MAX_TEXT_ARTIFACT_BYTES:
        raise ValueError("document text artifact exceeds 8 MiB")
    return artifact


def process_document_text_layer(
    lease: dict[str, object],
    attempt: dict[str, object],
    worker_id: str,
) -> dict[str, object]:
    inputs = lease.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("document lease has no inputs")
    source_files = inputs.get("sourceFiles")
    if not isinstance(source_files, list) or not source_files:
        raise ValueError("document lease has no sourceFiles")
    release = lease.get("release")
    text_layer = release.get("textLayer") if isinstance(release, dict) else None
    if (not isinstance(text_layer, dict)
            or text_layer.get("artifactSchemaVersion") != "document-text-v2"):
        raise ValueError("document lease has no supported text layer release")
    policy_version = text_layer.get("qualityPolicyVersion")
    if policy_version not in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("document lease has unsupported text quality policy")
    results: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="inspector-text-layer-") as directory:
        root = Path(directory)
        for index, source in enumerate(source_files):
            source_file_id, source_hash, byte_size, media_type, download_path = _source_metadata(source)
            if media_type != "application/pdf":
                results.append({
                    "sourceFileId": source_file_id,
                    "inputSha256": source_hash,
                    "status": "SKIPPED_UNSUPPORTED_FORMAT",
                    "reason": f"Text-layer extraction не поддерживает media type {media_type}",
                })
                continue
            destination = root / f"source-{index}.pdf"
            last_error: InputDownloadError | None = None
            for delay in (0.0, 0.25, 1.0):
                if delay:
                    time.sleep(delay)
                try:
                    _download_source(download_path, destination, source_hash, byte_size, attempt)
                    last_error = None
                    break
                except InputDownloadError as error:
                    last_error = error
            if last_error is not None:
                raise last_error
            cache_root = os.environ.get("INSPECTOR_DURABLE_TEXT_CACHE_ROOT")
            if cache_root:
                from .durable_text_cache import cached_durable_text_layer

                artifact, _cache_status = cached_durable_text_layer(
                    cache_root=Path(cache_root), source_path=destination,
                    source_file_id=source_file_id, source_sha256=source_hash,
                    policy_version=policy_version,
                    extract=lambda: extract_pdf_text_artifact(
                        destination, source_file_id, source_hash,
                        policy_version=policy_version),
                )
            else:
                artifact = extract_pdf_text_artifact(destination, source_file_id, source_hash,
                                                     policy_version=policy_version)
            results.append({
                "sourceFileId": source_file_id,
                "inputSha256": source_hash,
                "status": "EXTRACTED",
                "artifact": artifact,
            })
    result = {
        "disposition": "DOCUMENT_TEXT_LAYER_COMPLETED",
        "sources": results,
        "workerId": worker_id,
    }
    canonical = json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(canonical) > MAX_TEXT_ARTIFACT_BYTES:
        raise ValueError("combined document text result exceeds 8 MiB")
    return result
