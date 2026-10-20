#!/usr/bin/env python3
"""Package the current reviewable workspace and bounded acceptance evidence, without local auth/runtime data."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("source_policy", ROOT / "scripts/package-final-source.py")
assert spec and spec.loader
policy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = policy
spec.loader.exec_module(policy)
PUBLIC = "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/"
PUBLIC_FILES = {PUBLIC + name for name in ("document_manifest.jsonl", "parameter_catalog_132.jsonl", "submission_schema.json", "public_train_checks.jsonl")}
ROOTS = {"apps", "services", "packages", "scripts", "migrations", "infra", "docs"}
ROOT_FILES = {"package.json", "package-lock.json", "tsconfig.base.json", "README.md", ".gitignore", ".dockerignore", ".env.example"}
APPLICATION_ROOTS = {"apps", "services", "packages", "migrations"}


def mapped_sources(source_map: Path) -> tuple[dict[str, bytes], dict]:
    """Read exact reviewed overlays; never silently package stale checkout files."""
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate source-map key")
            result[key] = value
        return result

    if not source_map.is_file() or source_map.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Source map exceeds 8 MiB")
    raw = source_map.read_bytes()
    document = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(document, dict):
        raise ValueError("Source map must be an object")
    files, locations = document.get("files"), document.get("sourceLocations")
    if (not isinstance(files, dict) or not isinstance(locations, dict)
            or not 1 <= len(files) <= 10000 or set(files) != set(locations)):
        raise ValueError("Source map needs matching files/sourceLocations inventories")
    members, omitted, executable, total = {}, [], [], 0
    for target, digest in sorted(files.items()):
        policy.validate_path(target)
        pin = locations[target]
        if (not isinstance(digest, str) or len(digest) != 64
                or any(c not in "0123456789abcdef" for c in digest)
                or not isinstance(pin, dict) or pin.get("sha256") != digest
                or not isinstance(pin.get("source"), str)):
            raise ValueError(f"Invalid source-map pin: {target}")
        policy.validate_path(pin["source"])
        source = ROOT / pin["source"]
        # resolve also rejects a parent-directory symlink escaping the workspace.
        if not source.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError(f"Source leaves workspace: {target}")
        info = source.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 64 * 1024 * 1024:
            raise ValueError(f"Source is not a bounded regular file: {target}")
        total += info.st_size
        if total > 512 * 1024 * 1024:
            raise ValueError("Mapped sources exceed 512 MiB")
        payload = source.read_bytes()
        if len(payload) != info.st_size or hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError(f"Source-map checksum mismatch: {target}")
        reason = policy.exclusion_reason(target)
        if reason:
            omitted.append({"path": target, "reason": reason})
        else:
            members["source/" + target] = payload
            if info.st_mode & 0o111:
                executable.append("source/" + target)
    return members, {"sha256": hashlib.sha256(raw).hexdigest(), "mappedFiles": len(files),
                     "includedMappedFiles": len(members), "omittedMappedFiles": omitted,
                     "executableMappedFiles": executable}


def package(output: Path, evidence: Path, source_map: Path | None = None) -> dict:
    sidecar = output.with_suffix(output.suffix + ".sha256")
    if os.path.lexists(output) or os.path.lexists(sidecar):
        raise ValueError("Output or checksum exists; choose a fresh path")
    overlay, map_note = mapped_sources(source_map) if source_map else ({}, None)
    listed = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    names = {value.decode("utf-8") for value in listed.split(b"\0") if value}
    names |= {name for name in PUBLIC_FILES if (ROOT / name).is_file()}
    members: dict[str, bytes] = {}
    for name in sorted(names):
        path = Path(name)
        if not (name in ROOT_FILES or path.parts[0] in ROOTS or name in PUBLIC_FILES):
            continue
        if source_map and path.parts[0] in APPLICATION_ROOTS:
            continue
        if policy.exclusion_reason(name) or path.name.startswith("homeserver"):
            continue
        policy.validate_path(name)
        source = ROOT / name
        if source.is_symlink():
            raise ValueError(f"Symlink is not packaged: {name}")
        if source.is_file():
            members["source/" + name] = source.read_bytes()
    members.update(overlay)
    for path in sorted(evidence.iterdir()):
        if not path.is_file() or path.is_symlink():
            continue
        if not (path.name.endswith(("-execution.json", "-machine.json", "-schema-validation.json", "-browser.json", "-desktop.png", "-375.png", "-768.png", "-local-registration.png", "-source-context.png"))
                or path.name in {"persistence-check.json", "persistence-t07-check.json", "acceptance.json"}):
            continue
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError(f"Evidence exceeds bound: {path.name}")
        members["evidence/" + path.name] = path.read_bytes()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    members["REVIEW_SNAPSHOT.json"] = (json.dumps({"schemaVersion": "matrix-review-handoff-v1", "baseCommit": head,
        "contentOrigin": "REVIEWED_APPLICATION_SOURCE_MAP_WITH_WORKSPACE_OPERATIONS" if source_map else "CURRENT_WORKSPACE_WITH_UNCOMMITTED_CHANGES",
        "applicationSourceMap": map_note, "sourceFiles": sum(name.startswith("source/") for name in members),
        "evidenceFiles": sum(name.startswith("evidence/") for name in members),
        "limitations": ["Review snapshot, not an official final submission", "No model weights, private environment, cookies, runtime volumes or original PDF archives",
            "Only four explicit participant data files are included; organizer closed answers are excluded", "See source/docs/operations/MATRIX_ACCEPTANCE_20261017.md"]}, ensure_ascii=False, indent=2) + "\n").encode()
    checksums = {name: hashlib.sha256(data).hexdigest() for name, data in members.items()}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream, zipfile.ZipFile(stream, "w") as archive:
        os.chmod(output, 0o600)
        for name, data in sorted(members.items()):
            mode = 0o755 if name.startswith("source/") and (ROOT / name.removeprefix("source/")).exists() and (ROOT / name.removeprefix("source/")).stat().st_mode & 0o111 else 0o644
            if name in overlay:
                mode = 0o755 if name in map_note["executableMappedFiles"] else 0o644
            policy.write_member(archive, name, data, mode)
        policy.write_member(archive, "SHA256SUMS", "".join(f"{digest}  {name}\n" for name, digest in sorted(checksums.items())).encode())
    policy.verify_archive(output, checksums)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    with sidecar.open("x") as stream:
        os.chmod(sidecar, 0o600)
        stream.write(f"{digest}  {output.name}\n")
    return {"status": "PASS", "members": len(members) + 1, "bytes": output.stat().st_size, "sha256": digest}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/matrix-delivery-20261017/inspector-matrix-review.zip")
    parser.add_argument("--evidence", type=Path, default=ROOT / "output/matrix-20261017")
    parser.add_argument("--source-map", type=Path, help="Exact files/sourceLocations application map; workspace infra/scripts/docs stay included")
    args = parser.parse_args()
    print(json.dumps(package(args.output.resolve(), args.evidence.resolve(), args.source_map.resolve() if args.source_map else None), ensure_ascii=False, indent=2))
