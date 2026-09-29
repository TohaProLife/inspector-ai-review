#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys

from document_profile import load_profile, pipeline_options


CHUNK_SIZE = 8 * 1024 * 1024
SHA256_RE = re.compile(r"[a-f0-9]{64}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(cache_root: Path, profile_path: Path, profile_id: str) -> dict[str, object]:
    files = []
    for path in sorted(cache_root.rglob("*")):
        if path.parent == cache_root and path.name.startswith(".ready-"):
            continue
        if path.is_symlink():
            raise RuntimeError(f"Paddle cache must not contain symlinks: {path}")
        if not path.is_file():
            continue
        files.append(
            {
                "path": path.relative_to(cache_root).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return {
        "schemaVersion": "document-ai-cache-manifest-v1",
        "profileId": profile_id,
        "profileSha256": sha256_file(profile_path),
        "trustMode": "local-first-download",
        "files": files,
    }


def verify_manifest(
    cache_root: Path,
    profile_path: Path,
    profile_id: str,
    manifest_path: Path,
) -> bool:
    if not manifest_path.is_file():
        return False
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    if manifest.get("schemaVersion") != "document-ai-cache-manifest-v1":
        return False
    if manifest.get("profileId") != profile_id:
        return False
    if manifest.get("profileSha256") != sha256_file(profile_path):
        return False
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        return False
    expected_paths: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            return False
        relative = item.get("path")
        if not isinstance(relative, str):
            return False
        relative_path = PurePosixPath(relative)
        if (
            not relative
            or relative_path.is_absolute()
            or any(part in {"", ".", ".."} for part in relative_path.parts)
            or relative in expected_paths
        ):
            return False
        size = item.get("size")
        checksum = item.get("sha256")
        if (
            not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or not isinstance(checksum, str)
            or SHA256_RE.fullmatch(checksum) is None
        ):
            return False
        expected_paths.add(relative)
        path = cache_root / relative
        if not path.is_file() or path.is_symlink() or path.stat().st_size != size:
            return False
        if sha256_file(path) != checksum:
            return False
    actual_paths = {
        path.relative_to(cache_root).as_posix()
        for path in cache_root.rglob("*")
        if (path.is_file() or path.is_symlink())
        and not (path.parent == cache_root and path.name.startswith(".ready-"))
    }
    return actual_paths == expected_paths


def provision(profile_path: Path, cache_root: Path) -> dict[str, object]:
    profile = load_profile(profile_path)
    cache_root.mkdir(parents=True, exist_ok=True)
    manifest_path = cache_root / f".ready-{profile.profile_id}.json"
    trusted_value = os.getenv("DOCUMENT_AI_TRUSTED_MANIFEST")
    trusted_path = Path(trusted_value) if trusted_value else None
    require_trusted = os.getenv("DOCUMENT_AI_REQUIRE_TRUSTED_MANIFEST", "0") == "1"
    if require_trusted and trusted_path is None:
        raise RuntimeError("DOCUMENT_AI_TRUSTED_MANIFEST is required by this deployment")
    candidate = trusted_path or manifest_path
    if verify_manifest(cache_root, profile_path, profile.profile_id, candidate):
        manifest = json.loads(candidate.read_text())
        if candidate != manifest_path:
            partial = manifest_path.with_name(f"{manifest_path.name}.part")
            partial.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True) + "\n")
            partial.replace(manifest_path)
        return manifest

    from paddleocr import PPStructureV3

    for script in profile.scripts:
        pipeline = PPStructureV3(**pipeline_options(profile, script))
        del pipeline
        gc.collect()
        if profile.device.startswith("gpu"):
            try:
                import paddle

                paddle.device.cuda.empty_cache()
            except Exception:
                pass

    manifest = build_manifest(cache_root, profile_path, profile.profile_id)
    if not manifest["files"]:
        raise RuntimeError("PaddleOCR provisioning produced an empty model cache")
    if trusted_path is not None:
        if not verify_manifest(cache_root, profile_path, profile.profile_id, trusted_path):
            raise RuntimeError("Paddle cache does not match DOCUMENT_AI_TRUSTED_MANIFEST")
        manifest = json.loads(trusted_path.read_text())
    partial = manifest_path.with_name(f"{manifest_path.name}.part")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True) + "\n")
    partial.replace(manifest_path)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Prefetch and record PaddleOCR model cache")
    parser.add_argument("--profile", default=os.getenv("DOCUMENT_AI_PROFILE"), required=False)
    parser.add_argument(
        "--cache-root",
        default=os.getenv("PADDLE_PDX_CACHE_HOME", "/models/paddlex"),
    )
    args = parser.parse_args()
    if not args.profile:
        parser.error("--profile or DOCUMENT_AI_PROFILE is required")
    try:
        manifest = provision(Path(args.profile), Path(args.cache_root))
    except Exception as error:
        print(f"document model provisioner error: {error}", file=sys.stderr)
        return 1
    print(
        f"Document profile {manifest['profileId']} ready; "
        f"files={len(manifest['files'])}; profile sha256={manifest['profileSha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
