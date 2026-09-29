"""Validated, content-addressed reuse of the durable PDF text layer."""

from __future__ import annotations

from .platform_support import require_posix_file_locks
import hashlib
import importlib.metadata
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable

from .parameter_routing import _validate_artifact
from .text_layer import (LEGACY_TEXT_QUALITY_POLICY_VERSION,
                         MAX_TEXT_ARTIFACT_BYTES, TEXT_QUALITY_POLICY_VERSION)


SCHEMA = "durable-text-layer-cache-v1"


def _digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("durable text cache duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"durable text cache non-finite JSON constant: {value}")


def _profile(policy_version: str) -> dict[str, str]:
    if policy_version not in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("durable text cache quality policy is unsupported")
    return {
        "extractorSha256": _digest(Path(__file__).with_name("text_layer.py")),
        "pdfminerVersion": importlib.metadata.version("pdfminer.six"),
        "qualityPolicyVersion": policy_version,
    }


def _validate(payload: Any, request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"schemaVersion", "request", "artifact", "contentHash"}:
        raise ValueError("durable text cache payload invalid")
    if payload["schemaVersion"] != SCHEMA or payload["request"] != request:
        raise ValueError("durable text cache request mismatch")
    artifact = payload["artifact"]
    if not isinstance(artifact, dict):
        raise ValueError("durable text cache artifact invalid")
    canonical = json.dumps({key: payload[key] for key in ("schemaVersion", "request", "artifact")},
                           ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                           allow_nan=False).encode("utf-8")
    if payload["contentHash"] != hashlib.sha256(canonical).hexdigest():
        raise ValueError("durable text cache content hash mismatch")
    _validate_artifact(artifact, {"sourceFileId": request["sourceFileId"],
                                  "sha256": request["sourceSha256"]})
    if artifact.get("qualityPolicyVersion") != request["qualityPolicyVersion"]:
        raise ValueError("durable text cache artifact policy differs from request")
    return artifact


def cached_durable_text_layer(
    *, cache_root: Path, source_path: Path, source_file_id: str,
    source_sha256: str, extract: Callable[[], dict[str, Any]],
    policy_version: str = TEXT_QUALITY_POLICY_VERSION,
) -> tuple[dict[str, Any], str]:
    """Return checked artifact and HIT/MISS_WRITTEN; never serve stale bytes."""
    if not source_file_id or len(source_sha256) != 64 or _digest(source_path) != source_sha256:
        raise ValueError("durable text cache source PDF SHA-256 mismatch")
    request: dict[str, Any] = {
        "schemaVersion": SCHEMA,
        "sourceFileId": source_file_id,
        "sourceSha256": source_sha256,
        **_profile(policy_version),
    }
    key = hashlib.sha256(json.dumps(request, sort_keys=True,
                                    separators=(",", ":")).encode("utf-8")).hexdigest()
    parent = cache_root / key[:2] / key[2:4]
    parent.mkdir(parents=True, exist_ok=True)
    cache_path = parent / f"{key}.json"
    fcntl = require_posix_file_locks()
    lock_fd = os.open(parent / f"{key}.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        if cache_path.is_symlink():
            raise ValueError("durable text cache entry is a symlink")
        if cache_path.exists():
            if not cache_path.is_file() or cache_path.stat().st_size > MAX_TEXT_ARTIFACT_BYTES:
                raise ValueError("durable text cache entry exceeds limit or is not a file")
            payload = json.loads(cache_path.read_bytes(), object_pairs_hook=_unique_pairs,
                                 parse_constant=_reject_constant)
            return _validate(payload, request), "HIT"
        artifact = extract()
        payload = {"schemaVersion": SCHEMA, "request": request, "artifact": artifact}
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"), allow_nan=False).encode("utf-8")
        payload["contentHash"] = hashlib.sha256(canonical).hexdigest()
        _validate(payload, request)
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(raw) > MAX_TEXT_ARTIFACT_BYTES:
            raise ValueError("durable text cache artifact exceeds limit")
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
