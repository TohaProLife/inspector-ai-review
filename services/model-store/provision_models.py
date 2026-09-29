#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


CHUNK_SIZE = 8 * 1024 * 1024
DEFAULT_SAFETY_BYTES = 1024 * 1024 * 1024
REVISION_RE = re.compile(r"[a-f0-9]{40}")
SHA256_RE = re.compile(r"[a-f0-9]{64}")


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


def safe_relative_path(value: object) -> Path:
    if not isinstance(value, str) or not value:
        raise ArtifactError("artifact filename must be a non-empty string")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ArtifactError(f"unsafe artifact filename: {value}")
    return Path(*path.parts)


def load_lock(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    try:
        lock = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ArtifactError(f"invalid model lock JSON: {error}") from error
    if lock.get("schemaVersion") != "inspector-model-lock-v1":
        raise ArtifactError("unsupported model lock schema")
    if not isinstance(lock.get("profileId"), str) or not lock["profileId"]:
        raise ArtifactError("model lock profileId is required")
    models = lock.get("models")
    if not isinstance(models, list) or not models:
        raise ArtifactError("model lock must contain models")
    local_directories: set[str] = set()
    for model in models:
        validate_model(model)
        local_directory = model["localDirectory"]
        if local_directory in local_directories:
            raise ArtifactError(f"duplicate model localDirectory: {local_directory}")
        local_directories.add(local_directory)
    lock["lockSha256"] = hashlib.sha256(raw).hexdigest()
    return lock


def validate_model(model: object) -> None:
    if not isinstance(model, dict):
        raise ArtifactError("model entry must be an object")
    model_id = model.get("modelId")
    if not isinstance(model_id, str) or model_id.count("/") != 1:
        raise ArtifactError("modelId must use owner/repository form")
    revision = model.get("revision")
    if not isinstance(revision, str) or REVISION_RE.fullmatch(revision) is None:
        raise ArtifactError(f"model revision must be a full commit SHA: {model_id}")
    local_directory = safe_relative_path(model.get("localDirectory"))
    if len(local_directory.parts) != 1:
        raise ArtifactError("model localDirectory must be one safe path segment")
    if not isinstance(model.get("licenseId"), str) or not model["licenseId"]:
        raise ArtifactError(f"licenseId is required for {model_id}")
    artifacts = model.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ArtifactError(f"artifacts are required for {model_id}")
    filenames: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ArtifactError("artifact entry must be an object")
        filename = artifact.get("filename")
        relative = safe_relative_path(filename)
        normalized = relative.as_posix()
        if normalized in filenames:
            raise ArtifactError(f"duplicate artifact filename: {model_id}/{normalized}")
        filenames.add(normalized)
        size = artifact.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ArtifactError(f"invalid artifact size: {model_id}/{normalized}")
        sha256 = artifact.get("sha256")
        if not isinstance(sha256, str) or SHA256_RE.fullmatch(sha256) is None:
            raise ArtifactError(f"invalid artifact sha256: {model_id}/{normalized}")


def verify_artifact(path: Path, size: int, sha256: str) -> bool:
    return (
        path.is_file()
        and not path.is_symlink()
        and path.stat().st_size == size
        and sha256_file(path) == sha256
    )


def verify_model_inventory(model_root: Path, expected: set[str]) -> None:
    actual = {
        path.relative_to(model_root).as_posix()
        for path in model_root.rglob("*")
        if path.is_file() or path.is_symlink()
    }
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ArtifactError(f"model inventory mismatch; missing={missing}; extra={extra}")


def copy_import(source: Path, partial: Path, expected_size: int) -> None:
    if not source.is_file() or source.is_symlink():
        raise ArtifactError(f"import artifact is missing: {source}")
    if source.stat().st_size != expected_size:
        raise ArtifactError(
            f"import artifact size mismatch: {source}: {source.stat().st_size} != {expected_size}"
        )
    with source.open("rb") as input_file, partial.open("wb") as output_file:
        remaining = expected_size
        while remaining:
            chunk = input_file.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                raise ArtifactError(f"import artifact ended early: {source}")
            output_file.write(chunk)
            remaining -= len(chunk)
        if input_file.read(1):
            raise ArtifactError(f"import artifact exceeds locked size: {source}")
        output_file.flush()
        os.fsync(output_file.fileno())


def download(url: str, partial: Path, expected_size: int) -> None:
    for attempt in range(1, 6):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > expected_size:
            partial.unlink()
            offset = 0
        elif offset == expected_size:
            return
        headers = {"User-Agent": "inspector-ai-model-provisioner/1"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=120) as response:
                status = getattr(response, "status", None)
                if offset and status != 206:
                    partial.unlink(missing_ok=True)
                    offset = 0
                    continue
                mode = "ab" if offset else "wb"
                with partial.open(mode) as output:
                    downloaded = offset
                    while downloaded < expected_size:
                        remaining = expected_size - downloaded
                        chunk = response.read(min(CHUNK_SIZE, remaining + 1))
                        if not chunk:
                            raise OSError(
                                f"response ended at {downloaded} of {expected_size} bytes"
                            )
                        if len(chunk) > remaining:
                            raise ArtifactError(f"download exceeds locked size: {url}")
                        output.write(chunk)
                        downloaded += len(chunk)
                    if response.read(1):
                        raise ArtifactError(f"download exceeds locked size: {url}")
                    output.flush()
                    os.fsync(output.fileno())
            return
        except ArtifactError:
            # Close the output handle before removing rejected bytes on Windows.
            remove_file(partial)
            raise
        except (HTTPError, OSError) as error:
            if isinstance(error, HTTPError) and error.code == 416:
                partial.unlink(missing_ok=True)
            if attempt == 5:
                raise ArtifactError(f"download failed after 5 attempts: {url}: {error}") from error
            time.sleep(min(2**attempt, 16))


def provision(
    lock_path: Path,
    destination: Path,
    import_root: Path | None = None,
    base_url: str | None = None,
    safety_bytes: int = DEFAULT_SAFETY_BYTES,
) -> dict[str, Any]:
    lock = load_lock(lock_path)
    destination.mkdir(parents=True, exist_ok=True)
    missing_bytes = 0
    verified: set[tuple[str, str]] = set()
    for model in lock["models"]:
        model_root = destination / model["localDirectory"]
        for artifact in model["artifacts"]:
            target = model_root / safe_relative_path(artifact["filename"])
            if verify_artifact(target, artifact["size"], artifact["sha256"]):
                verified.add((model["localDirectory"], artifact["filename"]))
            else:
                missing_bytes += artifact["size"]
    if missing_bytes:
        free_bytes = shutil.disk_usage(destination).free
        if free_bytes < missing_bytes + safety_bytes:
            raise ArtifactError(
                "not enough free space for model artifacts: "
                f"need {missing_bytes + safety_bytes} bytes, have {free_bytes}"
            )

    for model in lock["models"]:
        model_root = destination / model["localDirectory"]
        model_root.mkdir(parents=True, exist_ok=True)
        expected_inventory = {
            safe_relative_path(artifact["filename"]).as_posix()
            for artifact in model["artifacts"]
        }
        for artifact in model["artifacts"]:
            relative = safe_relative_path(artifact["filename"])
            target = model_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if (model["localDirectory"], artifact["filename"]) in verified:
                continue
            remove_file(target)
            partial = target.with_name(f"{target.name}.part")
            if import_root is not None:
                partial.unlink(missing_ok=True)
                copy_import(
                    import_root / model["localDirectory"] / relative,
                    partial,
                    artifact["size"],
                )
            else:
                source = (base_url or lock.get("sourceBaseUrl") or "https://huggingface.co").rstrip("/")
                filename = quote(relative.as_posix(), safe="/")
                model_id = quote(model["modelId"], safe="/")
                url = f"{source}/{model_id}/resolve/{model['revision']}/{filename}?download=true"
                download(url, partial, artifact["size"])
            if not verify_artifact(partial, artifact["size"], artifact["sha256"]):
                partial.unlink(missing_ok=True)
                raise ArtifactError(f"artifact verification failed: {model['modelId']}/{relative}")
            partial.replace(target)
            target.chmod(0o444)
        verify_model_inventory(model_root, expected_inventory)

    ready = {
        "schemaVersion": "inspector-model-ready-v1",
        "profileId": lock["profileId"],
        "lockSha256": lock["lockSha256"],
        "models": [
            {
                "modelId": model["modelId"],
                "revision": model["revision"],
                "localDirectory": model["localDirectory"],
                "artifactCount": len(model["artifacts"]),
            }
            for model in lock["models"]
        ],
    }
    ready_path = destination / f".ready-{lock['profileId']}.json"
    ready_partial = ready_path.with_name(f"{ready_path.name}.part")
    remove_file(ready_partial)
    ready_partial.write_text(json.dumps(ready, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    replace_file(ready_partial, ready_path)
    ready_path.chmod(0o444)
    return ready


def verify_snapshot(lock_path: Path, destination: Path) -> dict[str, Any]:
    """Validate an already provisioned snapshot without writing to its mount."""
    lock = load_lock(lock_path)
    if not destination.is_dir():
        raise ArtifactError(f"model destination is missing: {destination}")
    for model in lock["models"]:
        model_root = destination / model["localDirectory"]
        expected = {safe_relative_path(item["filename"]).as_posix() for item in model["artifacts"]}
        verify_model_inventory(model_root, expected)
        for item in model["artifacts"]:
            path = model_root / safe_relative_path(item["filename"])
            if not verify_artifact(path, item["size"], item["sha256"]):
                raise ArtifactError(f"artifact verification failed: {model['modelId']}/{item['filename']}")
    ready_path = destination / f".ready-{lock['profileId']}.json"
    try:
        ready = json.loads(ready_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactError(f"model ready manifest is missing or invalid: {ready_path}") from error
    if (ready.get("schemaVersion") != "inspector-model-ready-v1"
            or ready.get("profileId") != lock["profileId"]
            or ready.get("lockSha256") != lock["lockSha256"]
            or ready.get("models") != [
                {"modelId": model["modelId"], "revision": model["revision"],
                 "localDirectory": model["localDirectory"], "artifactCount": len(model["artifacts"])}
                for model in lock["models"]
            ]):
        raise ArtifactError("model ready manifest does not match the lock")
    return ready


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Provision checksum-locked model snapshots")
    parser.add_argument("--lock", default=os.getenv("MODEL_STORE_LOCK"), required=False)
    parser.add_argument("--destination", default=os.getenv("MODEL_STORE_ROOT", "/models"))
    parser.add_argument("--import-root", default=os.getenv("MODEL_STORE_IMPORT_ROOT"))
    parser.add_argument("--base-url", default=os.getenv("MODEL_STORE_BASE_URL"))
    parser.add_argument("--verify-only", action="store_true", help="check a read-only provisioned snapshot")
    parser.add_argument(
        "--safety-bytes",
        type=int,
        default=int(os.getenv("MODEL_STORE_SAFETY_BYTES", str(DEFAULT_SAFETY_BYTES))),
    )
    args = parser.parse_args()
    if not args.lock:
        parser.error("--lock or MODEL_STORE_LOCK is required")
    if args.safety_bytes < 0:
        parser.error("--safety-bytes must be non-negative")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.verify_only:
            ready = verify_snapshot(Path(args.lock), Path(args.destination))
        else:
            ready = provision(
                Path(args.lock),
                Path(args.destination),
                Path(args.import_root) if args.import_root else None,
                args.base_url,
                args.safety_bytes,
            )
    except (ArtifactError, OSError, ValueError) as error:
        print(f"model provisioner error: {error}", file=sys.stderr)
        return 1
    print(
        f"Model profile {ready['profileId']} ready; lock sha256={ready['lockSha256']}; "
        f"models={len(ready['models'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
