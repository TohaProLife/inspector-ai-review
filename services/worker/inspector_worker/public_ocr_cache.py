"""Explicit, local OCR of one included public PDF page with verified disk reuse.

This offline cache is not a fact extractor. Empty OCR output never establishes
the absence of a parameter, and cached lines still require source review.
"""

from __future__ import annotations

import contextlib
from .platform_support import require_posix_file_locks
import hashlib
import json
import os
import re
import sqlite3
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

from .ocr_pilot import canonical_hash, recognize_pdf_page, validate_local_url, validate_ocr_artifact
from .public_document_index import readonly_index_uri


CACHE_SCHEMA_VERSION = "public-ocr-page-cache-v1"
DEFAULT_CACHE_ROOT = Path("/mnt/edberries-backup-disk/inspector-ai-dataset-20260924/ocr-page-cache-v1")
_FILE_ID = re.compile(r"F[0-9]{4,}\Z")
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_MAX_CACHE_BYTES = 16 * 1024 * 1024


class PublicOcrCacheError(ValueError):
    """Selected source, index metadata, or cached OCR is not trustworthy."""


def _digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PublicOcrCacheError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _nonfinite(value: str) -> None:
    raise PublicOcrCacheError(f"non-finite JSON value: {value}")


def _load_json(raw: bytes) -> Any:
    try:
        return json.loads(raw, object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublicOcrCacheError("invalid UTF-8 JSON") from error


def public_manifest_entry(manifest_path: Path, source_id: str) -> dict[str, Any]:
    if not isinstance(source_id, str) or _FILE_ID.fullmatch(source_id) is None:
        raise PublicOcrCacheError("invalid source ID")
    selected: list[dict[str, Any]] = []
    with manifest_path.open("rb") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                raise PublicOcrCacheError(f"blank manifest row {line_number}")
            row = _load_json(line)
            if not isinstance(row, dict):
                raise PublicOcrCacheError(f"invalid manifest row {line_number}")
            if row.get("file_id") == source_id:
                selected.append(row)
    if len(selected) != 1:
        raise PublicOcrCacheError("source ID must occur exactly once in manifest")
    row = selected[0]
    if (row.get("split") != "TRAIN_PUBLIC" or row.get("distribution_status") != "INCLUDE"
            or row.get("label_visibility") != "PUBLIC_TRAIN" or row.get("extension") != ".pdf"):
        raise PublicOcrCacheError("source is outside included TRAIN_PUBLIC PDF allowlist")
    relative = row.get("relative_path")
    if (not isinstance(relative, str) or not relative or PurePosixPath(relative).is_absolute()
            or any(part in {"", ".", ".."} for part in relative.split("/"))
            or "\\" in relative):
        raise PublicOcrCacheError("unsafe manifest relative_path")
    if (not isinstance(row.get("sha256"), str) or _SHA256.fullmatch(row["sha256"]) is None
            or type(row.get("size_bytes")) is not int or row["size_bytes"] <= 0
            or type(row.get("pdf_pages")) is not int or row["pdf_pages"] <= 0):
        raise PublicOcrCacheError("manifest PDF identity incomplete")
    return row


def _decoded_member_name(info: zipfile.ZipInfo) -> str:
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("cp866")
    except UnicodeError as error:
        raise PublicOcrCacheError("archive member filename decoding failed") from error


def _archive_member(archive: zipfile.ZipFile, relative_path: str) -> zipfile.ZipInfo:
    matches: list[zipfile.ZipInfo] = []
    for info in archive.infolist():
        name = _decoded_member_name(info)
        parts = name.rstrip("/").split("/") if info.is_dir() else name.split("/")
        if (name.startswith("/") or "\\" in name
                or any(part in {"", ".", ".."} for part in parts)):
            raise PublicOcrCacheError("archive contains unsafe member path")
        if info.is_dir():
            continue
        if name == relative_path or name.endswith("/" + relative_path):
            if stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK:
                raise PublicOcrCacheError("selected archive member is a symlink")
            matches.append(info)
    if len(matches) != 1:
        raise PublicOcrCacheError("public PDF member missing or ambiguous in archive")
    return matches[0]


def _verify_pdf(path: Path, row: dict[str, Any]) -> None:
    if not path.is_file() or path.stat().st_size != row["size_bytes"]:
        raise PublicOcrCacheError("selected PDF size differs from manifest")
    if _digest_file(path) != row["sha256"]:
        raise PublicOcrCacheError("selected PDF SHA-256 differs from manifest")
    try:
        import fitz

        with fitz.open(path) as document:
            actual_pages = len(document)
    except Exception as error:
        raise PublicOcrCacheError("selected PDF cannot be opened") from error
    if actual_pages != row["pdf_pages"]:
        raise PublicOcrCacheError("selected PDF page count differs from manifest")


@contextlib.contextmanager
def verified_public_pdf(row: dict[str, Any], *, pdf_path: Path | None,
                        archive_path: Path | None, scratch_root: Path | None = None) -> Iterator[Path]:
    if (pdf_path is None) == (archive_path is None):
        raise PublicOcrCacheError("select exactly one PDF path or archive path")
    if pdf_path is not None:
        _verify_pdf(pdf_path, row)
        yield pdf_path
        return
    assert archive_path is not None
    with zipfile.ZipFile(archive_path) as archive:
        member = _archive_member(archive, row["relative_path"])
        if member.file_size != row["size_bytes"]:
            raise PublicOcrCacheError("archive PDF size differs from manifest")
        with tempfile.TemporaryDirectory(prefix="public-ocr-source-", dir=scratch_root) as directory:
            path = Path(directory) / f"{row['file_id']}.pdf"
            written = 0
            with archive.open(member) as source, path.open("wb") as destination:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    written += len(chunk)
                    if written > row["size_bytes"]:
                        raise PublicOcrCacheError("archive PDF exceeds manifest size")
                    destination.write(chunk)
            if written != row["size_bytes"]:
                raise PublicOcrCacheError("archive PDF is incomplete")
            _verify_pdf(path, row)
            yield path


def index_page_disposition(index_path: Path | None, *, source_id: str,
                           source_hash: str, page_number: int) -> str | None:
    if index_path is None:
        return None
    if not index_path.is_file():
        raise PublicOcrCacheError("public index missing")
    try:
        with contextlib.closing(sqlite3.connect(readonly_index_uri(index_path), uri=True)) as connection:
            rows = connection.execute(
                "SELECT source_sha256, disposition FROM pages "
                "WHERE source_id = ? AND page_number = ?", (source_id, page_number),
            ).fetchall()
    except sqlite3.DatabaseError as error:
        raise PublicOcrCacheError("public index page metadata invalid") from error
    if len(rows) != 1 or rows[0][0] != source_hash or rows[0][1] not in {
            "OCR_REQUIRED", "TEXT_LAYER_CANDIDATE"}:
        raise PublicOcrCacheError("public index page provenance or disposition mismatch")
    return rows[0][1]


def _cache_request(row: dict[str, Any], page_number: int, dpi: int, script: str,
                   renderer_profile_id: str, provider_profile_id: str) -> dict[str, Any]:
    if (type(page_number) is not int or not 1 <= page_number <= row["pdf_pages"]
            or type(dpi) is not int or not 72 <= dpi <= 600 or script not in {"eslav", "latin"}
            or not isinstance(renderer_profile_id, str) or not renderer_profile_id.strip()
            or not isinstance(provider_profile_id, str) or not provider_profile_id.strip()):
        raise PublicOcrCacheError("invalid selected page or OCR profile")
    return {
        "schemaVersion": CACHE_SCHEMA_VERSION,
        "sourceFileId": row["file_id"], "sourceSha256": row["sha256"],
        "pageNumber": page_number, "dpi": dpi, "script": script,
        "rendererProfileId": renderer_profile_id,
        "providerProfileId": provider_profile_id,
    }


def _validate_cache(payload: Any, request: dict[str, Any]) -> dict[str, Any]:
    if (not isinstance(payload, dict) or set(payload) != {"schemaVersion", "request", "artifact", "contentHash"}
            or payload.get("schemaVersion") != CACHE_SCHEMA_VERSION or payload.get("request") != request):
        raise PublicOcrCacheError("OCR cache request or schema mismatch")
    expected_hash = canonical_hash({key: value for key, value in payload.items() if key != "contentHash"})
    if payload.get("contentHash") != expected_hash:
        raise PublicOcrCacheError("OCR cache contentHash mismatch")
    artifact = payload["artifact"]
    try:
        validate_ocr_artifact(artifact, source_id=request["sourceFileId"],
                              source_hash=request["sourceSha256"], page_number=request["pageNumber"])
    except ValueError as error:
        raise PublicOcrCacheError("cached OCR artifact invalid") from error
    if (artifact["render"]["dpi"] != request["dpi"]
            or artifact["render"]["rendererProfileId"] != request["rendererProfileId"]
            or artifact["provider"]["script"] != request["script"]
            or artifact["provider"]["profileId"] != request["providerProfileId"]):
        raise PublicOcrCacheError("cached OCR render/provider profile mismatch")
    return artifact


def cached_public_ocr_page(*, manifest_path: Path, source_id: str, page_number: int,
                           pdf_path: Path | None = None, archive_path: Path | None = None,
                           cache_root: Path = DEFAULT_CACHE_ROOT,
                           base_url: str, dpi: int = 120, script: str = "eslav",
                           renderer_profile_id: str, provider_profile_id: str,
                           index_path: Path | None = None) -> dict[str, Any]:
    """Return one artifact and metadata; cache is valid only for exact request.

    Always verify selected public source bytes before any cache hit. A corrupt
    existing entry fails closed and is never silently regenerated.
    """
    row = public_manifest_entry(manifest_path, source_id)
    request = _cache_request(row, page_number, dpi, script,
                             renderer_profile_id, provider_profile_id)
    validate_local_url(base_url)
    disposition = index_page_disposition(index_path, source_id=source_id,
                                         source_hash=row["sha256"], page_number=page_number)
    cache_key = canonical_hash(request)
    parent = cache_root / cache_key[:2] / cache_key[2:4]
    cache_path = parent / f"{cache_key}.json"
    cache_root.mkdir(parents=True, exist_ok=True)
    with verified_public_pdf(row, pdf_path=pdf_path, archive_path=archive_path,
                             scratch_root=cache_root) as source_path:
        parent.mkdir(parents=True, exist_ok=True)
        lock_path = parent / f"{cache_key}.lock"
        fcntl = require_posix_file_locks()
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            if cache_path.is_symlink():
                raise PublicOcrCacheError("OCR cache entry is a symlink")
            if cache_path.exists():
                if cache_path.stat().st_size > _MAX_CACHE_BYTES:
                    raise PublicOcrCacheError("OCR cache entry exceeds size limit")
                artifact = _validate_cache(_load_json(cache_path.read_bytes()), request)
                cache_status = "HIT"
            else:
                artifact = recognize_pdf_page(
                    source_path, source_id, row["sha256"], page_number, row["pdf_pages"],
                    base_url=base_url, dpi=dpi, script=script,
                )
                payload = {"schemaVersion": CACHE_SCHEMA_VERSION, "request": request,
                           "artifact": artifact}
                payload["contentHash"] = canonical_hash(payload)
                _validate_cache(payload, request)
                raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                 separators=(",", ":"), allow_nan=False).encode("utf-8")
                if len(raw) > _MAX_CACHE_BYTES:
                    raise PublicOcrCacheError("OCR cache artifact exceeds size limit")
                temporary_path: Path | None = None
                try:
                    with tempfile.NamedTemporaryFile(dir=parent, prefix=f".{cache_key}.",
                                                     suffix=".tmp", delete=False) as temporary:
                        temporary_path = Path(temporary.name)
                        temporary.write(raw)
                        temporary.flush()
                        os.fsync(temporary.fileno())
                    os.replace(temporary_path, cache_path)
                finally:
                    if temporary_path is not None:
                        temporary_path.unlink(missing_ok=True)
                cache_status = "MISS_WRITTEN"
        finally:
            os.close(lock_fd)
    return {
        "schemaVersion": CACHE_SCHEMA_VERSION, "sourceFileId": source_id,
        "sourceSha256": row["sha256"], "pageNumber": page_number,
        "indexDisposition": disposition, "cacheStatus": cache_status,
        "cacheKey": cache_key, "cachePath": str(cache_path),
        "artifactContentHash": artifact["contentHash"], "lineCount": len(artifact["lines"]),
        "interpretation": "OCR_REVIEW_REQUIRED_NOT_ABSENCE_PROOF",
        "artifact": artifact,
    }
