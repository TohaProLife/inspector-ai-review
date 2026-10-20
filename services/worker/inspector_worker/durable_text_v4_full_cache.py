"""Isolated, checked cache for explicit source-audit v4 artifacts only."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import uuid
from pathlib import Path
from typing import Any, Callable

from .document_text_v4 import (_canonical, _native, _sha, _source_id,
                               get_document_text_v4_extractor_profile,
                               read_document_text_v4_full_artifact)
from .platform_support import require_posix_file_locks

CACHE_POLICY_VERSION = "durable-text-layer-v4-full-source-cache-v1"
SCHEMA = CACHE_POLICY_VERSION
MAX_BYTES = 33554432
RESOURCE_POLICY_VERSION = "document-text-v4-full-source-bounds-v1"
SOURCE_AUDIT_PROFILE_VERSION = "SOURCE_AUDIT_V4_FULL_SOURCE_V1"
TRAVERSAL_POLICY_VERSION = "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
_ACCEPTED_TRAVERSALS = (TRAVERSAL_POLICY_VERSION,)


def _bounded_native(value: Any, envelope: str) -> None:
    """Only these three fixed envelope policies; exact builtins before any read."""
    if type(envelope) is not str or envelope not in ("cache", "result", "complete"):
        raise ValueError("INVALID_INPUT")
    max_bytes, max_depth = ((32000000, 67) if envelope == "result" else
                            (33554432, 68 if envelope == "complete" else 65))
    nodes = 0
    active: set[int] = set()
    def walk(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > 1500000 or depth > max_depth:
            raise ValueError("INPUT_LIMIT")
        kind = type(item)
        if kind is str:
            if len(item) > 2000000:
                raise ValueError("INPUT_LIMIT")
            if any(0xD800 <= ord(ch) <= 0xDFFF for ch in item):
                raise ValueError("INVALID_INPUT")
        elif kind is int:
            if abs(item) > 9007199254740991:
                raise ValueError("INVALID_INPUT")
        elif kind is bool or item is None:
            return
        elif kind is dict or kind is list:
            if len(item) > 32768:
                raise ValueError("INPUT_LIMIT")
            identity = id(item)
            if identity in active:
                raise ValueError("INVALID_INPUT")
            active.add(identity)
            if kind is dict:
                for key, child in dict.items(item):
                    if type(key) is not str:
                        raise ValueError("INVALID_INPUT")
                    walk(key, depth + 1)
                    walk(child, depth + 1)
            else:
                for child in item:
                    walk(child, depth + 1)
            active.remove(identity)
        else:
            raise ValueError("INVALID_INPUT")
    walk(value, 0)
    if len(_canonical(value).encode("utf-8")) > max_bytes:
        raise ValueError("INPUT_LIMIT")


def _bytes(value: Any) -> bytes:
    _bounded_native(value, "cache")
    return _canonical(value).encode("utf-8")


def _profile(profile: Any, profile_hash: Any) -> None:
    _native(profile)
    _sha(profile_hash)
    if type(profile) is not dict:
        raise ValueError("EXTRACTOR_PROFILE_MISMATCH")
    traversal = profile.get("traversalPolicyVersion")
    if type(traversal) is not str or traversal not in _ACCEPTED_TRAVERSALS:
        raise ValueError("EXTRACTOR_PROFILE_MISMATCH")
    expected = get_document_text_v4_extractor_profile(traversal_policy_version=traversal)
    if profile != expected or profile_hash != hashlib.sha256(_bytes({
            "hashDomain": "document-text-extractor-profile-v1", "profile": expected})).hexdigest():
        raise ValueError("EXTRACTOR_PROFILE_MISMATCH")


def _artifact(value: Any, request: dict[str, Any]) -> dict:
    admitted = read_document_text_v4_full_artifact(value)
    if admitted["status"] != "VALID":
        raise ValueError(admitted["reasonCode"])
    if (value["sourceFileId"] != request["sourceFileId"]
            or value["inputSha256"] != request["sourceSha256"]
            or value["extractorProfile"] != request["extractorProfile"]
            or value["extractorProfileHash"] != request["extractorProfileHash"]):
        raise ValueError("CACHE_ARTIFACT_MISMATCH")
    return value


def _pairs(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("CACHE_DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def _reject_number(_value: str) -> None:
    raise ValueError("CACHE_INVALID_JSON_NUMBER")


def _integer_token(value: str) -> int:
    digits = value[1:] if value.startswith("-") else value
    if len(digits) > 16 or (len(digits) == 16 and digits > "9007199254740991"):
        raise ValueError("CACHE_INVALID_JSON_NUMBER")
    return int(value)


def _parse(raw: bytes) -> Any:
    if len(raw) > MAX_BYTES:
        raise ValueError("INPUT_LIMIT")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_float=_reject_number, parse_constant=_reject_number,
                          parse_int=_integer_token)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("CACHE_INVALID_JSON") from error


def _validate(payload: Any, request: dict) -> dict:
    _bounded_native(payload, "cache")
    if (type(payload) is not dict or set(payload) != {"schemaVersion", "request", "artifact", "contentHash"}
            or payload["schemaVersion"] != SCHEMA or payload["request"] != request):
        raise ValueError("CACHE_REQUEST_MISMATCH")
    _sha(payload["contentHash"])
    artifact = _artifact(payload["artifact"], request)
    canonical = _bytes({key: payload[key] for key in ("schemaVersion", "request", "artifact")})
    if hashlib.sha256(canonical).hexdigest() != payload["contentHash"]:
        raise ValueError("CACHE_CONTENT_HASH_MISMATCH")
    _bytes(payload)
    return artifact


def _directory(path: Path) -> int:
    """Open/create each component without following directory symlinks."""
    absolute = path.absolute()
    if ".." in absolute.parts:
        raise ValueError("CACHE_UNSAFE_PATH")
    current = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in absolute.parts[1:]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=current)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = child
        return current
    except BaseException:
        os.close(current)
        raise


def _read(parent: int, name: str) -> bytes | None:
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            raise ValueError("CACHE_INVALID_FILE")
        chunks = []
        size = 0
        while chunk := os.read(fd, min(1024 * 1024, MAX_BYTES + 1 - size)):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("INPUT_LIMIT")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(fd)


def cached_durable_text_layer_v4_full(
    *, cache_root: Path, source_path: Path, source_file_id: str,
    source_sha256: str, extractor_profile: dict, extractor_profile_hash: str,
    extract: Callable[[], dict],
) -> tuple[dict, str]:
    """No legacy lookup, stale fallback, source mutation or caller-owned return."""
    _native(source_file_id)
    _source_id(source_file_id)
    _sha(source_sha256)
    _profile(extractor_profile, extractor_profile_hash)
    with Path(source_path).open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != source_sha256:
            raise ValueError("SOURCE_SHA256_MISMATCH")
    request = {"schemaVersion": SCHEMA,
               "sourceAuditProfileVersion": SOURCE_AUDIT_PROFILE_VERSION,
               "resourcePolicyVersion": RESOURCE_POLICY_VERSION,
               "sourceFileId": source_file_id,
               "sourceSha256": source_sha256, "extractorProfile": extractor_profile,
               "extractorProfileHash": extractor_profile_hash}
    # Freeze the validated request before invoking an extraction callback.
    request = _parse(_bytes(request))
    key = hashlib.sha256(_bytes(request)).hexdigest()
    fcntl = require_posix_file_locks()
    parent = lock = None
    temporary = None
    try:
        parent = _directory(Path(cache_root) / SCHEMA / key[:2] / key[2:4])
        lock = os.open(key + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
                       0o600, dir_fd=parent)
        if not stat.S_ISREG(os.fstat(lock).st_mode):
            raise ValueError("CACHE_INVALID_LOCK")
        fcntl.flock(lock, fcntl.LOCK_EX)
        name = key + ".json"
        raw = _read(parent, name)
        if raw is not None:
            return _validate(_parse(raw), request), "HIT"
        artifact = _artifact(extract(), request)
        payload = {"schemaVersion": SCHEMA, "request": request, "artifact": artifact}
        payload["contentHash"] = hashlib.sha256(_bytes(payload)).hexdigest()
        # Serialize and independently validate the immutable snapshot, not the
        # callback's still-mutable object. Hashes never use custom serializers.
        raw = _bytes(payload)
        snapshot = _parse(raw)
        result = _validate(snapshot, request)
        temporary = "." + key + "." + uuid.uuid4().hex + ".tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent)
        try:
            view = memoryview(raw)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError("cache write made no progress")
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
        temporary = None
        os.fsync(parent)
        return result, "MISS_WRITTEN"
    except OSError as error:
        raise ValueError("CACHE_IO_OR_UNSAFE_PATH") from error
    finally:
        if temporary is not None and parent is not None:
            try:
                os.unlink(temporary, dir_fd=parent)
            except FileNotFoundError:
                pass
        if lock is not None:
            os.close(lock)
        if parent is not None:
            os.close(parent)
