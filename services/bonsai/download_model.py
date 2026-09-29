#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_LOCK_PATH = Path("/opt/bonsai/artifacts.lock.json")
DEFAULT_DESTINATION = Path("/models")
DEFAULT_SAFETY_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 8 * 1024 * 1024
SHA256_RE = re.compile(r"[a-f0-9]{64}")
REVISION_RE = re.compile(r"[a-f0-9]{40}")


class ArtifactError(RuntimeError):
    pass


def remove_file(path: Path) -> None:
    """Remove an owned artifact, including Windows read-only files."""
    try:
        path.unlink(missing_ok=True)
    except PermissionError:
        if os.name != "nt" or path.is_symlink() or not path.is_file():
            raise
        path.chmod(path.stat().st_mode | stat.S_IWRITE)
        path.unlink()


def replace_file(source: Path, target: Path) -> None:
    """Keep manifest replacement atomic when Windows marks the old one read-only."""
    try:
        os.replace(source, target)
    except PermissionError:
        if os.name != "nt" or target.is_symlink() or not target.is_file():
            raise
        original_mode = target.stat().st_mode
        target.chmod(original_mode | stat.S_IWRITE)
        try:
            os.replace(source, target)
        except BaseException:
            target.chmod(original_mode)
            raise


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_lock(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    try:
        lock = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ArtifactError(f"invalid artifact lock JSON: {error}") from error
    if lock.get("schemaVersion") != "bonsai-artifact-lock-v1":
        raise ArtifactError("unsupported artifact lock schema")
    if not isinstance(lock.get("modelId"), str) or not lock["modelId"]:
        raise ArtifactError("artifact lock modelId is required")
    if not isinstance(lock.get("revision"), str) or REVISION_RE.fullmatch(
        lock["revision"]
    ) is None:
        raise ArtifactError("artifact lock revision must be a full commit SHA")
    if not isinstance(lock.get("sourceBaseUrl"), str) or not lock["sourceBaseUrl"]:
        raise ArtifactError("artifact lock sourceBaseUrl is required")
    artifacts = lock.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ArtifactError("artifact lock must contain artifacts")
    filenames: set[str] = set()
    for artifact in artifacts:
        validate_artifact(artifact)
        filename = artifact["filename"]
        if filename in filenames:
            raise ArtifactError(f"duplicate artifact filename: {filename}")
        filenames.add(filename)
    lock["lockSha256"] = hashlib.sha256(raw).hexdigest()
    return lock


def validate_artifact(artifact: object) -> None:
    if not isinstance(artifact, dict):
        raise ArtifactError("artifact entry must be an object")
    filename = artifact.get("filename")
    if not isinstance(filename, str) or Path(filename).name != filename:
        raise ArtifactError("artifact filename must be a safe basename")
    size = artifact.get("size")
    if not isinstance(size, int) or size <= 0:
        raise ArtifactError(f"artifact {filename} has invalid size")
    sha256 = artifact.get("sha256")
    if not isinstance(sha256, str) or SHA256_RE.fullmatch(sha256) is None:
        raise ArtifactError(f"artifact {filename} has invalid sha256")


def verify_file(path: Path, expected_size: int, expected_sha256: str) -> bool:
    if not path.is_file() or path.is_symlink() or path.stat().st_size != expected_size:
        return False
    return sha256_file(path) == expected_sha256


def verify_inventory(destination: Path, expected: set[str]) -> None:
    ignored = {".bonsai-model-ready.json"}
    actual = {
        path.name
        for path in destination.iterdir()
        if (path.is_file() or path.is_symlink()) and path.name not in ignored
    }
    if actual != expected:
        raise ArtifactError(
            "Bonsai inventory mismatch; "
            f"missing={sorted(expected - actual)}; extra={sorted(actual - expected)}"
        )


def require_capacity(destination: Path, required_bytes: int, safety_bytes: int) -> None:
    available = shutil.disk_usage(destination).free
    minimum = required_bytes + safety_bytes
    if available < minimum:
        raise ArtifactError(
            "insufficient free disk for Bonsai artifacts: "
            f"need at least {minimum} bytes, have {available} bytes"
        )


def copy_from_source(source: Path, partial: Path, expected_size: int) -> None:
    if not source.is_file() or source.is_symlink():
        raise ArtifactError(f"offline artifact is missing: {source}")
    if source.stat().st_size != expected_size:
        raise ArtifactError(
            f"offline artifact size mismatch: {source.stat().st_size} != {expected_size}"
        )
    with source.open("rb") as input_file, partial.open("wb") as output_file:
        remaining = expected_size
        while remaining:
            chunk = input_file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                raise ArtifactError(f"offline artifact ended early: {source}")
            output_file.write(chunk)
            remaining -= len(chunk)
        if input_file.read(1):
            raise ArtifactError(f"offline artifact exceeds locked size: {source}")
        output_file.flush()
        os.fsync(output_file.fileno())


def download_to_partial(url: str, partial: Path, expected_size: int) -> None:
    existing_size = partial.stat().st_size if partial.exists() else 0
    if existing_size > expected_size:
        partial.unlink()
        existing_size = 0
    elif existing_size == expected_size:
        return

    headers = {"User-Agent": "inspector-ai-bonsai-provisioner/1.0"}
    if existing_size:
        headers["Range"] = f"bytes={existing_size}-"

    request = Request(url, headers=headers)
    try:
        response = urlopen(request, timeout=60)
    except HTTPError as error:
        if error.code == 416 and existing_size == expected_size:
            return
        raise ArtifactError(f"download failed for {url}: HTTP {error.code}") from error

    status = getattr(response, "status", response.getcode())
    append = existing_size > 0 and status == 206
    if existing_size and not append:
        existing_size = 0
    mode = "ab" if append else "wb"
    downloaded = existing_size
    next_report = downloaded + 512 * 1024 * 1024

    try:
        with response, partial.open(mode) as output_file:
            while True:
                chunk = response.read(CHUNK_SIZE)
                if not chunk:
                    break
                if downloaded + len(chunk) > expected_size:
                    raise ArtifactError(f"download exceeds locked size for {url}")
                output_file.write(chunk)
                downloaded += len(chunk)
                if downloaded >= next_report:
                    print(f"downloaded {downloaded}/{expected_size} bytes", flush=True)
                    next_report += 512 * 1024 * 1024
            output_file.flush()
            os.fsync(output_file.fileno())
    except ArtifactError:
        # Windows cannot unlink a file while its output handle is still open.
        remove_file(partial)
        raise
    if downloaded != expected_size:
        raise ArtifactError(
            f"download ended at {downloaded} bytes, expected {expected_size} for {url}"
        )


def materialize_artifact(
    artifact: dict[str, Any],
    destination: Path,
    source_base_url: str,
    source_dir: Path | None,
    safety_bytes: int,
) -> None:
    filename = artifact["filename"]
    expected_size = artifact["size"]
    expected_sha256 = artifact["sha256"]
    target = destination / filename
    partial = destination / f".{filename}.partial"

    if verify_file(target, expected_size, expected_sha256):
        print(f"verified existing artifact: {filename}")
        return
    if target.exists():
        print(f"removing invalid artifact: {filename}")
        remove_file(target)

    partial_size = partial.stat().st_size if partial.exists() else 0
    require_capacity(destination, max(0, expected_size - partial_size), safety_bytes)
    if source_dir is not None:
        print(f"importing artifact: {filename}")
        copy_from_source(source_dir / filename, partial, expected_size)
    else:
        url = f"{source_base_url.rstrip('/')}/{quote(filename)}?download=true"
        print(f"downloading artifact: {filename}")
        download_to_partial(url, partial, expected_size)

    actual_size = partial.stat().st_size if partial.exists() else 0
    if actual_size != expected_size:
        raise ArtifactError(
            f"artifact {filename} has size {actual_size}, expected {expected_size}"
        )
    actual_sha256 = sha256_file(partial)
    if actual_sha256 != expected_sha256:
        partial.unlink(missing_ok=True)
        raise ArtifactError(
            f"artifact {filename} sha256 mismatch: {actual_sha256} != {expected_sha256}"
        )
    os.chmod(partial, 0o444)
    os.replace(partial, target)
    print(f"installed verified artifact: {filename}")


def materialize_lock(
    lock_path: Path,
    destination: Path,
    *,
    source_dir: Path | None = None,
    source_base_url: str | None = None,
    safety_bytes: int = DEFAULT_SAFETY_BYTES,
) -> dict[str, Any]:
    lock = load_lock(lock_path)
    destination.mkdir(parents=True, exist_ok=True)
    remove_file(destination / ".bonsai-model-ready.json.partial")
    base_url = source_base_url or lock["sourceBaseUrl"]
    if source_dir is None and not base_url.startswith(("https://", "http://")):
        raise ArtifactError("artifact source URL must use http or https")
    for artifact in lock["artifacts"]:
        materialize_artifact(
            artifact,
            destination,
            base_url,
            source_dir,
            safety_bytes,
        )
    verify_inventory(destination, {artifact["filename"] for artifact in lock["artifacts"]})

    ready = {
        "schemaVersion": "bonsai-model-ready-v1",
        "modelId": lock["modelId"],
        "revision": lock["revision"],
        "lockSha256": lock["lockSha256"],
        "verifiedAtUnix": int(time.time()),
        "artifacts": [
            {
                "filename": artifact["filename"],
                "size": artifact["size"],
                "sha256": artifact["sha256"],
            }
            for artifact in lock["artifacts"]
        ],
    }
    ready_path = destination / ".bonsai-model-ready.json"
    temporary_ready = destination / ".bonsai-model-ready.json.partial"
    temporary_ready.write_text(
        json.dumps(ready, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary_ready, 0o444)
    replace_file(temporary_ready, ready_path)
    return ready


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Provision pinned Bonsai model artifacts")
    parser.add_argument(
        "--lock",
        type=Path,
        default=Path(os.environ.get("BONSAI_ARTIFACT_LOCK", DEFAULT_LOCK_PATH)),
    )
    parser.add_argument(
        "--destination",
        type=Path,
        default=Path(os.environ.get("BONSAI_MODEL_DIR", DEFAULT_DESTINATION)),
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path(os.environ["BONSAI_IMPORT_DIR"])
        if os.environ.get("BONSAI_IMPORT_DIR")
        else None,
    )
    parser.add_argument(
        "--source-base-url",
        default=os.environ.get("BONSAI_MODEL_BASE_URL"),
    )
    parser.add_argument(
        "--safety-bytes",
        type=int,
        default=int(
            os.environ.get("BONSAI_DOWNLOAD_SAFETY_BYTES", str(DEFAULT_SAFETY_BYTES))
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.safety_bytes < 0:
        raise ArtifactError("safety bytes must be non-negative")
    ready = materialize_lock(
        args.lock,
        args.destination,
        source_dir=args.source_dir,
        source_base_url=args.source_base_url,
        safety_bytes=args.safety_bytes,
    )
    print(
        f"Bonsai artifacts ready: {ready['modelId']}@{ready['revision']} "
        f"lock={ready['lockSha256']}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ArtifactError as error:
        print(f"artifact provisioning failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
