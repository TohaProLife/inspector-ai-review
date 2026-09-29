"""Local PDF render/OCR adapter with immutable pixel-coordinate provenance.

OCR output stays separate from the PDF text layer. No OCR text is promoted to a
qualified text-layer block or used to assert absence of a value.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import urllib.request
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .numeric_extraction import building_area_matches


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        raise ValueError("document provider redirect is forbidden")


def canonical_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()


def _json_number(value: Any) -> Any:
    """Keep integral provider floats stable when JSONB/JavaScript parse them as integers."""
    return int(value) if type(value) is float and math.isfinite(value) and value.is_integer() else value


def json_stable_ocr_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    """Copy a verified legacy page into JSON-stable run output without changing its receipt.

    Older cache entries can contain ``1.0`` scores or integral float coordinates.
    Their original hashes remain valid in the cache, but JSONB/JavaScript collapse
    these numbers to integers. Rehash only the returned copy for a new run stage.
    """
    validate_ocr_artifact(artifact, source_id=artifact["sourceFileId"],
                          source_hash=artifact["inputSha256"],
                          page_number=artifact["pageNumber"])
    lines = []
    changed = False
    for line in artifact["lines"]:
        score = _json_number(line["score"])
        box = [_json_number(value) for value in line["bboxPx"]]
        changed |= score is not line["score"] or any(
            value is not original for value, original in zip(box, line["bboxPx"]))
        lines.append({**line, "score": score, "bboxPx": box})
    if not changed:
        return artifact
    normalized = {**artifact, "lines": lines}
    normalized["contentHash"] = canonical_hash({key: value for key, value in normalized.items()
                                                if key != "contentHash"})
    validate_ocr_artifact(normalized, source_id=normalized["sourceFileId"],
                          source_hash=normalized["inputSha256"],
                          page_number=normalized["pageNumber"])
    return normalized


def validate_local_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "document-ai"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise ValueError("document AI URL must be local HTTP loopback or Docker document-ai")
    return base_url.rstrip("/")


def _post_file(url: str, fields: dict[str, str], filename: str, payload: bytes,
               media_type: str, timeout: int, max_response_bytes: int) -> tuple[bytes, dict[str, str]]:
    boundary = f"inspector-{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend((
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(),
            value.encode(), b"\r\n",
        ))
    parts.extend((
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {media_type}\r\n\r\n".encode(),
        payload, b"\r\n", f"--{boundary}--\r\n".encode(),
    ))
    request = urllib.request.Request(url, b"".join(parts),
                                     {"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    # Keep a local-only provider call local even when the shell has proxy variables.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    with opener.open(request, timeout=timeout) as response:
        body = response.read(max_response_bytes + 1)
        if len(body) > max_response_bytes:
            raise ValueError("document provider response exceeds limit")
        return body, {key.lower(): value for key, value in response.headers.items()}


def validate_ocr_artifact(artifact: dict[str, Any], *, source_id: str,
                          source_hash: str, page_number: int) -> None:
    if (not isinstance(artifact, dict) or artifact.get("schemaVersion") != "document-ocr-page-v1"
            or artifact.get("sourceFileId") != source_id or artifact.get("inputSha256") != source_hash
            or artifact.get("pageNumber") != page_number):
        raise ValueError("OCR artifact provenance mismatch")
    render = artifact.get("render")
    provider = artifact.get("provider")
    if (not isinstance(render, dict) or not isinstance(provider, dict)
            or not isinstance(render.get("sha256"), str) or _SHA256.fullmatch(render["sha256"]) is None
            or any(type(render.get(key)) is not int or render[key] < 1
                   for key in ("widthPx", "heightPx", "dpi"))
            or not isinstance(render.get("rendererProfileId"), str) or not render["rendererProfileId"]
            or not isinstance(provider.get("profileId"), str) or not provider["profileId"]
            or provider.get("script") not in {"eslav", "latin"}):
        raise ValueError("OCR artifact render/provider metadata invalid")
    lines = artifact.get("lines")
    if not isinstance(lines, list) or len(lines) > 5000:
        raise ValueError("OCR artifact lines invalid")
    for line in lines:
        if not isinstance(line, dict) or not isinstance(line.get("text"), str):
            raise ValueError("OCR line text invalid")
        score = line.get("score")
        box = line.get("bboxPx")
        if (type(score) not in {int, float} or not math.isfinite(score) or not 0 <= score <= 1
                or not isinstance(box, list) or len(box) != 4
                or any(type(value) not in {int, float} or not math.isfinite(value) for value in box)
                or not (0 <= box[0] < box[2] <= render["widthPx"]
                        and 0 <= box[1] < box[3] <= render["heightPx"])):
            raise ValueError("OCR line geometry or score invalid")
    content = {key: value for key, value in artifact.items() if key != "contentHash"}
    if artifact.get("contentHash") != canonical_hash(content):
        raise ValueError("OCR artifact contentHash mismatch")


def recognize_pdf_page(pdf_path: Path, source_id: str, source_hash: str,
                       page_number: int, page_count: int, *, base_url: str,
                       dpi: int = 120, script: str = "eslav", timeout: int = 360) -> dict[str, Any]:
    base_url = validate_local_url(base_url)
    if (not isinstance(source_hash, str) or _SHA256.fullmatch(source_hash) is None
            or type(page_number) is not int or type(page_count) is not int
            or not 1 <= page_number <= page_count or type(dpi) is not int or not 72 <= dpi <= 600
            or script not in {"eslav", "latin"} or type(timeout) is not int or timeout < 1):
        raise ValueError("invalid OCR source/page/profile request")
    pdf = pdf_path.read_bytes()
    if hashlib.sha256(pdf).hexdigest() != source_hash:
        raise ValueError("source PDF SHA-256 changed before OCR")
    png, headers = _post_file(base_url + "/v1/render", {"page": str(page_number), "dpi": str(dpi)},
                              pdf_path.name, pdf, "application/pdf", timeout, 40_000_000)
    try:
        width = int(headers["x-render-width"])
        height = int(headers["x-render-height"])
        count = int(headers["x-source-page-count"])
        actual_dpi = int(headers["x-render-dpi"])
        renderer = headers["x-renderer-profile"]
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("renderer response metadata invalid") from error
    if (not png.startswith(_PNG_MAGIC) or len(png) < 24 or png[12:16] != b"IHDR"
            or struct.unpack(">II", png[16:24]) != (width, height)
            or len(png) > 40_000_000 or width < 1 or height < 1
            or width * height > 25_000_000 or count != page_count or actual_dpi != dpi or not renderer):
        raise ValueError("renderer output does not match source page request")
    raw, _ = _post_file(base_url + "/v1/ocr", {"script": script},
                        f"page-{page_number}.png", png, "image/png", timeout, 16_000_000)
    if len(raw) > 16_000_000:
        raise ValueError("OCR response exceeds limit")
    response = json.loads(raw)
    if (not isinstance(response, dict) or response.get("schemaVersion") != "document-ai-ocr-response-v1"
            or response.get("script") != script or not isinstance(response.get("profileId"), str)
            or not response["profileId"] or not isinstance(response.get("results"), list)
            or len(response["results"]) != 1 or not isinstance(response["results"][0], dict)):
        raise ValueError("OCR provider response invalid")
    overall = response["results"][0].get("overall_ocr_res")
    if not isinstance(overall, dict):
        raise ValueError("OCR provider has no overall_ocr_res")
    texts, scores, boxes = (overall.get(key) for key in ("rec_texts", "rec_scores", "rec_boxes"))
    if (not isinstance(texts, list) or not isinstance(scores, list) or not isinstance(boxes, list)
            or len(texts) != len(scores) or len(texts) != len(boxes)):
        raise ValueError("OCR provider line arrays mismatch")
    artifact = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": source_id,
        "inputSha256": source_hash, "pageNumber": page_number,
        "render": {"sha256": hashlib.sha256(png).hexdigest(), "widthPx": width,
                   "heightPx": height, "dpi": dpi, "rendererProfileId": renderer},
        "provider": {"profileId": response["profileId"], "script": script},
        "lines": [
            {"text": text, "score": _json_number(score),
             "bboxPx": [_json_number(coordinate) for coordinate in box] if isinstance(box, list) else box}
            for text, score, box in zip(texts, scores, boxes)
        ],
    }
    artifact["contentHash"] = canonical_hash(artifact)
    validate_ocr_artifact(artifact, source_id=source_id, source_hash=source_hash, page_number=page_number)
    return artifact


def extract_pz_002_ocr_facts(artifact: dict[str, Any], *, entity_key: str) -> list[dict[str, Any]]:
    validate_ocr_artifact(artifact, source_id=artifact["sourceFileId"],
                          source_hash=artifact["inputSha256"], page_number=artifact["pageNumber"])
    facts: list[dict[str, Any]] = []
    lines = artifact["lines"]
    for start, line in enumerate(lines):
        if not line["text"].strip():
            continue
        for width in (1, 2, 3):
            selected = lines[start:start + width]
            if len(selected) != width:
                continue
            joined = " ".join(item["text"].strip() for item in selected)
            matches = building_area_matches(joined)
            match = matches[0] if matches else None
            if match is None:
                continue
            facts.append({
                "sourceFileId": artifact["sourceFileId"], "inputSha256": artifact["inputSha256"],
                "pageNumber": artifact["pageNumber"], "entityKey": entity_key,
                "evidenceKind": "OCR", "ocrArtifactHash": artifact["contentHash"],
                "lineIndexes": list(range(start, start + width)),
                "rawValue": match.group("value"), "rawUnit": match.group("unit"),
                "unit": match.group("unit").replace(" ", "").replace("\u00a0", "").rstrip("."),
                "extractionProfile": "pz-002-ocr-label-v1",
            })
            break
    return facts
