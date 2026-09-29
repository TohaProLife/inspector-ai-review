"""Content-addressed reuse for fenced, durable OCR page jobs.

Only exact source bytes, page and provider/renderer profiles may reuse a page.
The cache is optional and never changes OCR selection or rule outcomes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from .ocr_pilot import canonical_hash, validate_ocr_artifact
from .platform_support import require_posix_file_locks


SCHEMA = "durable-ocr-page-cache-v1"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_MAX_BYTES = 16 * 1024 * 1024


def _source_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("durable OCR cache duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"durable OCR cache non-finite JSON constant: {value}")


def _validate(payload: Any, request: dict[str, Any]) -> dict[str, Any]:
    if (not isinstance(payload, dict)
            or set(payload) != {"schemaVersion", "request", "artifact", "contentHash"}
            or payload.get("schemaVersion") != SCHEMA or payload.get("request") != request
            or payload.get("contentHash") != canonical_hash({
                key: value for key, value in payload.items() if key != "contentHash"})):
        raise ValueError("durable OCR cache request or content hash mismatch")
    artifact = payload["artifact"]
    if not isinstance(artifact, dict):
        raise ValueError("durable OCR cache artifact invalid")
    validate_ocr_artifact(artifact, source_id=request["sourceFileId"],
                          source_hash=request["sourceSha256"],
                          page_number=request["pageNumber"])
    render, provider = artifact["render"], artifact["provider"]
    if (render["dpi"] != request["dpi"]
            or render["rendererProfileId"] != request["rendererProfileId"]
            or provider["profileId"] != request["providerProfileId"]
            or provider["script"] != request["script"]):
        raise ValueError("durable OCR cache profile mismatch")
    return artifact


def cached_durable_ocr_page(
    *, cache_root: Path, source_path: Path, source_file_id: str,
    source_sha256: str, page_number: int, page_count: int, dpi: int, script: str,
    renderer_profile_id: str, provider_profile_id: str,
    recognize: Callable[[], dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    """Return validated artifact and HIT/MISS_WRITTEN; fail closed on corruption."""
    if (not source_file_id or not isinstance(source_file_id, str)
            or not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None
            or type(page_number) is not int or type(page_count) is not int
            or not 1 <= page_number <= page_count or type(dpi) is not int
            or not 72 <= dpi <= 600 or script not in {"eslav", "latin"}
            or not isinstance(renderer_profile_id, str) or not renderer_profile_id
            or not isinstance(provider_profile_id, str) or not provider_profile_id):
        raise ValueError("durable OCR cache request invalid")
    if not source_path.is_file() or _source_digest(source_path) != source_sha256:
        raise ValueError("durable OCR cache source PDF SHA-256 mismatch")
    request = {
        "schemaVersion": SCHEMA, "sourceFileId": source_file_id,
        "sourceSha256": source_sha256, "pageNumber": page_number,
        "pageCount": page_count, "dpi": dpi, "script": script,
        "rendererProfileId": renderer_profile_id,
        "providerProfileId": provider_profile_id,
    }
    key = canonical_hash(request)
    parent = cache_root / key[:2] / key[2:4]
    parent.mkdir(parents=True, exist_ok=True)
    cache_path = parent / f"{key}.json"
    lock_path = parent / f"{key}.lock"
    fcntl = require_posix_file_locks()
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        if cache_path.is_symlink():
            raise ValueError("durable OCR cache entry is a symlink")
        if cache_path.exists():
            if not cache_path.is_file() or cache_path.stat().st_size > _MAX_BYTES:
                raise ValueError("durable OCR cache entry exceeds limit or is not a file")
            payload = json.loads(cache_path.read_bytes(), object_pairs_hook=_unique_pairs,
                                 parse_constant=_reject_constant)
            return _validate(payload, request), "HIT"
        artifact = recognize()
        payload = {"schemaVersion": SCHEMA, "request": request,
                   "artifact": artifact}
        payload["contentHash"] = canonical_hash(payload)
        _validate(payload, request)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(raw) > _MAX_BYTES:
            raise ValueError("durable OCR cache artifact exceeds limit")
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=parent, prefix=f".{key}.",
                                             suffix=".tmp", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(raw)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, cache_path)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        return artifact, "MISS_WRITTEN"
    finally:
        os.close(lock_fd)
