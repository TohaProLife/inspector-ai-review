"""Review-only OCR of an explicitly selected region of an allowed public PDF page.

Coordinates are integer fractions of the displayed page (0..10000). The cache
is bound to the source SHA, physical page, region, renderer and OCR profiles.
It never promotes OCR text to a verified source role or comparison fact.
"""

from __future__ import annotations

from .platform_support import require_posix_file_locks
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import fitz

from .ocr_pilot import _post_file, canonical_hash, validate_local_url
from .public_ocr_cache import (
    DEFAULT_CACHE_ROOT, PublicOcrCacheError, _load_json,
    index_page_disposition, public_manifest_entry, verified_public_pdf,
)


SCHEMA_VERSION = "public-ocr-region-v1"
RENDERER_PROFILE = f"renderer-pymupdf-{fitz.VersionBind}-region-v1"
MAX_PIXELS = 25_000_000
MAX_SIDE = 8192
MAX_PNG_BYTES = 32_000_000
MAX_CACHE_BYTES = 16_000_000
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _request(row: dict[str, Any], page_number: int, clip: tuple[int, int, int, int],
             dpi: int, script: str, provider_profile_id: str) -> dict[str, Any]:
    if (type(page_number) is not int or not 1 <= page_number <= row["pdf_pages"]
            or not isinstance(clip, tuple) or len(clip) != 4
            or any(type(value) is not int or not 0 <= value <= 10000 for value in clip)
            or clip[0] >= clip[2] or clip[1] >= clip[3]
            or type(dpi) is not int or not 72 <= dpi <= 600
            or script not in {"eslav", "latin"}
            or not isinstance(provider_profile_id, str) or not provider_profile_id.strip()):
        raise PublicOcrCacheError("invalid public OCR region request")
    return {
        "schemaVersion": SCHEMA_VERSION, "sourceFileId": row["file_id"],
        "sourceSha256": row["sha256"], "pageNumber": page_number,
        "clipNorm10000": list(clip), "dpi": dpi, "script": script,
        "rendererProfileId": RENDERER_PROFILE, "providerProfileId": provider_profile_id,
    }


def _geometry(source_path: Path, request: dict[str, Any]) -> tuple[fitz.Rect, fitz.Rect]:
    with fitz.open(source_path) as document:
        if len(document) < request["pageNumber"]:
            raise PublicOcrCacheError("source page count changed")
        page_rect = document[request["pageNumber"] - 1].rect
    x0, y0, x1, y1 = request["clipNorm10000"]
    clip = fitz.Rect(
        page_rect.x0 + page_rect.width * x0 / 10000,
        page_rect.y0 + page_rect.height * y0 / 10000,
        page_rect.x0 + page_rect.width * x1 / 10000,
        page_rect.y0 + page_rect.height * y1 / 10000,
    )
    return page_rect, clip


def _render(source_path: Path, request: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    page_rect, clip = _geometry(source_path, request)
    with fitz.open(source_path) as document:
        page = document[request["pageNumber"] - 1]
        scale = request["dpi"] / 72
        if (clip.is_empty or math.ceil(clip.width * scale) > MAX_SIDE
                or math.ceil(clip.height * scale) > MAX_SIDE
                or math.ceil(clip.width * scale) * math.ceil(clip.height * scale) > MAX_PIXELS):
            raise PublicOcrCacheError("selected OCR region exceeds pixel limit")
        pixels = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip,
                                 colorspace=fitz.csRGB, alpha=False)
        if (pixels.width < 1 or pixels.height < 1 or pixels.width > MAX_SIDE
                or pixels.height > MAX_SIDE or pixels.width * pixels.height > MAX_PIXELS):
            raise PublicOcrCacheError("rendered OCR region exceeds pixel limit")
        png = pixels.tobytes("png")
        if len(png) > MAX_PNG_BYTES:
            raise PublicOcrCacheError("rendered OCR region exceeds byte limit")
        render = {
            "sha256": hashlib.sha256(png).hexdigest(), "widthPx": pixels.width,
            "heightPx": pixels.height, "dpi": request["dpi"],
            "rendererProfileId": RENDERER_PROFILE,
            "pageRectPdfPt": [round(value, 4) for value in page_rect],
            "clipRectPdfPt": [round(value, 4) for value in clip],
        }
        return png, render


def _recognize(png: bytes, render: dict[str, Any], request: dict[str, Any],
               base_url: str) -> dict[str, Any]:
    raw, _ = _post_file(base_url + "/v1/ocr", {"script": request["script"]},
                        "region.png", png, "image/png", 360, MAX_CACHE_BYTES)
    response = _load_json(raw)
    if (not isinstance(response, dict)
            or response.get("schemaVersion") != "document-ai-ocr-response-v1"
            or response.get("script") != request["script"]
            or response.get("profileId") != request["providerProfileId"]
            or not isinstance(response.get("results"), list)
            or len(response["results"]) != 1
            or not isinstance(response["results"][0], dict)):
        raise PublicOcrCacheError("OCR provider region response/profile invalid")
    overall = response["results"][0].get("overall_ocr_res")
    if not isinstance(overall, dict):
        raise PublicOcrCacheError("OCR provider region lines missing")
    texts, scores, boxes = (overall.get(key) for key in ("rec_texts", "rec_scores", "rec_boxes"))
    if (not isinstance(texts, list) or not isinstance(scores, list) or not isinstance(boxes, list)
            or len(texts) != len(scores) or len(texts) != len(boxes) or len(texts) > 5000):
        raise PublicOcrCacheError("OCR provider region line arrays invalid")
    lines = []
    for line_text, score, box in zip(texts, scores, boxes):
        if (not isinstance(line_text, str) or type(score) not in {int, float}
                or not math.isfinite(score) or not 0 <= score <= 1
                or not isinstance(box, list) or len(box) != 4
                or any(type(value) not in {int, float} or not math.isfinite(value) for value in box)
                or not (0 <= box[0] < box[2] <= render["widthPx"]
                        and 0 <= box[1] < box[3] <= render["heightPx"])):
            raise PublicOcrCacheError("OCR provider region line geometry invalid")
        lines.append({"text": line_text, "score": score, "bboxCropPx": box})
    artifact = {"schemaVersion": SCHEMA_VERSION, "request": request,
                "render": render, "lines": lines,
                "interpretation": "REVIEW_ONLY_NOT_ABSENCE_PROOF"}
    artifact["contentHash"] = canonical_hash(artifact)
    return artifact


def _validate_cache(payload: Any, request: dict[str, Any]) -> dict[str, Any]:
    if (not isinstance(payload, dict) or set(payload) != {"schemaVersion", "request", "artifact", "contentHash"}
            or payload.get("schemaVersion") != SCHEMA_VERSION or payload.get("request") != request
            or payload.get("contentHash") != canonical_hash({key: value for key, value in payload.items()
                                                               if key != "contentHash"})):
        raise PublicOcrCacheError("region OCR cache envelope invalid")
    artifact = payload["artifact"]
    if (not isinstance(artifact, dict) or set(artifact) != {
            "schemaVersion", "request", "render", "lines", "interpretation", "contentHash"}
            or artifact.get("schemaVersion") != SCHEMA_VERSION
            or artifact.get("request") != request
            or artifact.get("interpretation") != "REVIEW_ONLY_NOT_ABSENCE_PROOF"
            or artifact.get("contentHash") != canonical_hash({key: value for key, value in artifact.items()
                                                               if key != "contentHash"})):
        raise PublicOcrCacheError("region OCR cached artifact invalid")
    render = artifact["render"]
    if (not isinstance(render, dict) or render.get("rendererProfileId") != RENDERER_PROFILE
            or render.get("dpi") != request["dpi"]
            or not isinstance(render.get("sha256"), str) or _SHA256.fullmatch(render["sha256"]) is None
            or type(render.get("widthPx")) is not int or type(render.get("heightPx")) is not int
            or not 1 <= render["widthPx"] <= MAX_SIDE or not 1 <= render["heightPx"] <= MAX_SIDE
            or render["widthPx"] * render["heightPx"] > MAX_PIXELS
            or not isinstance(render.get("clipRectPdfPt"), list)
            or not isinstance(render.get("pageRectPdfPt"), list)
            or len(render["clipRectPdfPt"]) != 4 or len(render["pageRectPdfPt"]) != 4):
        raise PublicOcrCacheError("region OCR cached render invalid")
    lines = artifact["lines"]
    if not isinstance(lines, list) or len(lines) > 5000:
        raise PublicOcrCacheError("region OCR cached lines invalid")
    for line in lines:
        box = line.get("bboxCropPx") if isinstance(line, dict) else None
        score = line.get("score") if isinstance(line, dict) else None
        if (not isinstance(line, dict) or set(line) != {"text", "score", "bboxCropPx"}
                or not isinstance(line["text"], str) or type(score) not in {int, float}
                or not math.isfinite(score) or not 0 <= score <= 1
                or not isinstance(box, list) or len(box) != 4
                or any(type(value) not in {int, float} or not math.isfinite(value) for value in box)
                or not (0 <= box[0] < box[2] <= render["widthPx"]
                        and 0 <= box[1] < box[3] <= render["heightPx"])):
            raise PublicOcrCacheError("region OCR cached line invalid")
    return artifact


def cached_public_ocr_region(*, manifest_path: Path, source_id: str, page_number: int,
                             clip_norm_10000: tuple[int, int, int, int],
                             provider_profile_id: str, base_url: str,
                             pdf_path: Path | None = None, archive_path: Path | None = None,
                             index_path: Path | None = None,
                             cache_root: Path = DEFAULT_CACHE_ROOT / "regions",
                             dpi: int = 180, script: str = "eslav") -> dict[str, Any]:
    row = public_manifest_entry(manifest_path, source_id)
    request = _request(row, page_number, clip_norm_10000, dpi, script, provider_profile_id)
    validate_local_url(base_url)
    disposition = index_page_disposition(index_path, source_id=source_id,
                                         source_hash=row["sha256"], page_number=page_number)
    key = canonical_hash(request)
    parent = cache_root / key[:2] / key[2:4]
    cache_path = parent / f"{key}.json"
    cache_root.mkdir(parents=True, exist_ok=True)
    with verified_public_pdf(row, pdf_path=pdf_path, archive_path=archive_path,
                             scratch_root=cache_root) as source_path:
        parent.mkdir(parents=True, exist_ok=True)
        fcntl = require_posix_file_locks()
        lock_fd = os.open(parent / f"{key}.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            if cache_path.is_symlink():
                raise PublicOcrCacheError("region OCR cache entry is a symlink")
            if cache_path.exists():
                if cache_path.stat().st_size > MAX_CACHE_BYTES:
                    raise PublicOcrCacheError("region OCR cache entry exceeds byte limit")
                artifact = _validate_cache(_load_json(cache_path.read_bytes()), request)
                page_rect, clip = _geometry(source_path, request)
                if (artifact["render"]["pageRectPdfPt"] != [round(value, 4) for value in page_rect]
                        or artifact["render"]["clipRectPdfPt"] != [round(value, 4) for value in clip]):
                    raise PublicOcrCacheError("region OCR cached geometry differs from selected source")
                status = "HIT"
            else:
                png, render = _render(source_path, request)
                artifact = _recognize(png, render, request, validate_local_url(base_url))
                payload = {"schemaVersion": SCHEMA_VERSION, "request": request, "artifact": artifact}
                payload["contentHash"] = canonical_hash(payload)
                _validate_cache(payload, request)
                raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                 separators=(",", ":"), allow_nan=False).encode("utf-8")
                if len(raw) > MAX_CACHE_BYTES:
                    raise PublicOcrCacheError("region OCR artifact exceeds byte limit")
                temporary: Path | None = None
                try:
                    with tempfile.NamedTemporaryFile(dir=parent, prefix=f".{key}.",
                                                     suffix=".tmp", delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(raw)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary, cache_path)
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
                status = "MISS_WRITTEN"
        finally:
            os.close(lock_fd)
    return {"schemaVersion": SCHEMA_VERSION, "sourceFileId": source_id,
            "sourceSha256": row["sha256"], "pageNumber": page_number,
            "indexDisposition": disposition, "clipNorm10000": list(clip_norm_10000),
            "cacheStatus": status, "cacheKey": key, "cachePath": str(cache_path),
            "artifactContentHash": artifact["contentHash"], "lineCount": len(artifact["lines"]),
            "interpretation": artifact["interpretation"], "artifact": artifact}
