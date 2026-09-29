#!/usr/bin/env python3
"""Build and verify a reproducible source handoff from a committed Git revision."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
POLICY = "final-source-handoff-v1"
GENERATED = {"SOURCE_REVISION.txt", "SHA256SUMS"}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
LOCAL_DIRECTORIES = {
    ".git", ".tmp", "tmp", "var", "output", "runtime", "downloads",
    "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".ruff_cache", ".vite", ".cache", "coverage", "dist",
}
PRESENTATION_DIRECTORIES = {"presentation", "presentations", "slides", "deck", "decks",
                            "презентация", "презентации"}
SECRET_NAMES = {".npmrc", ".pypirc", ".netrc", ".git-credentials", ".smoke-user",
                ".review-user", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"}
SECRET_EXTENSIONS = {".pem", ".p12", ".pfx", ".key", ".jks", ".keystore"}
PRESENTATION_EXTENSIONS = {".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".odp", ".keynote"}


class PackageError(Exception):
    """An explicit packaging or verification failure."""


@dataclass(frozen=True)
class SourceEntry:
    path: str
    mode: str
    object_id: str


def git(*args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=False)
    if result.returncode:
        # Do not echo arbitrary Git stderr, which can contain local configuration.
        raise PackageError(f"Git {args[0]} failed (exit {result.returncode}).")
    return result.stdout


def exclusion_reason(name: str) -> str | None:
    path = PurePosixPath(name)
    parts = tuple(part.lower() for part in path.parts)
    basename = parts[-1]
    if parts[:3] == ("docs", "assets", "mobbin") or "design-research" in parts[:-1]:
        return "third-party reference material for internal design research"
    if any(part in LOCAL_DIRECTORIES for part in parts[:-1]):
        return "local runtime, dependency, generated output or temporary directory"
    if any(part in {"secret", "secrets", "credential", "credentials"} for part in parts[:-1]):
        return "secret or credential directory"
    if any(part in PRESENTATION_DIRECTORIES for part in parts[:-1]):
        return "presentation material"
    if path.suffix.lower() in PRESENTATION_EXTENSIONS:
        return "presentation file"
    if (path.suffix.lower() in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".html", ".zip"}
            and re.search(r"(?:^|[-_ ])(?:presentation|slides?|deck|презентаци\w*)(?:$|[-_ ])",
                          path.stem.lower())):
        return "presentation artifact"
    # Keep documented configuration templates, including .env.example and laptop.env.example.
    template = basename.endswith((".example", ".sample", ".template"))
    if not template:
        if (basename == ".env" or basename.startswith(".env.")
                or basename.endswith(".env") or ".env." in basename):
            return "local environment configuration"
        if (basename in SECRET_NAMES or path.suffix.lower() in SECRET_EXTENSIONS
                or re.match(r"^\.?credentials?(?:\.|$)", basename)
                or re.match(r"^\.?secrets?(?:\.|$)", basename)):
            return "credential, key or secret file"
    if basename.endswith((".log", ".pyc", ".pyo", ".tsbuildinfo")):
        return "local log or compiler cache"
    return None


def validate_path(name: str) -> None:
    # A source archive should extract consistently on Windows and POSIX.
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                *(f"lpt{i}" for i in range(1, 10))}
    if (not name or PurePosixPath(name).is_absolute() or "\\" in name or ":" in name
            or any(ord(char) < 32 or char in '<>"|?*' for char in name)
            or any(part in {"", ".", ".."} or part.endswith((".", " "))
                   or part.split(".")[0].lower() in reserved for part in name.split("/"))):
        raise PackageError(f"Unsupported archive path: {name!r}")


def source_inventory(commit: str) -> tuple[list[SourceEntry], list[dict[str, str]]]:
    included: list[SourceEntry] = []
    omitted: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in git("ls-tree", "--full-tree", "-r", "-z", commit).split(b"\0"):
        if not record:
            continue
        header, raw_name = record.split(b"\t", 1)
        mode, kind, object_id = header.decode("ascii").split()
        name = raw_name.decode("utf-8")
        validate_path(name)
        reason = exclusion_reason(name)
        if reason:
            omitted.append({"path": name, "reason": reason})
            continue
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise PackageError(f"Unsupported source type/mode for {name}: {kind}/{mode}; nothing omitted silently.")
        if name.casefold() in seen or name.upper() in GENERATED:
            raise PackageError(f"Conflicting archive path: {name}")
        seen.add(name.casefold())
        included.append(SourceEntry(name, mode, object_id))
    return sorted(included, key=lambda item: item.path), sorted(omitted, key=lambda item: item["path"])


def write_member(archive: zipfile.ZipFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = (stat.S_IFREG | mode) << 16
    archive.writestr(info, data)


@contextmanager
def committed_blobs():
    """Read objects through one local Git process, without checkout filters."""
    reader = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL)
    assert reader.stdin is not None and reader.stdout is not None

    def read(object_id: str) -> bytes:
        reader.stdin.write((object_id + "\n").encode("ascii"))
        reader.stdin.flush()
        header = reader.stdout.readline().split()
        if len(header) != 3 or header[0].decode("ascii") != object_id or header[1] != b"blob":
            raise PackageError("Git did not return the requested committed blob.")
        size = int(header[2])
        payload = reader.stdout.read(size)
        if len(payload) != size or reader.stdout.read(1) != b"\n":
            raise PackageError("Git returned an incomplete committed blob.")
        return payload

    try:
        yield read
        reader.stdin.close()
        if reader.wait() != 0:
            raise PackageError("Git cat-file failed while reading committed sources.")
    finally:
        if reader.poll() is None:
            reader.kill()
            reader.wait()
        reader.stdin.close()
        reader.stdout.close()


def revision_note(commit: str, tree: str, object_format: str, source_count: int,
                  omissions: list[dict[str, str]]) -> bytes:
    lines = [
        "Inspector AI: committed source handoff",
        f"Commit: {commit}", f"Tree: {tree}", f"Git object format: {object_format}",
        f"Packaging policy: {POLICY}", f"Committed source files included: {source_count}",
        "Every included source file contains the exact committed blob bytes and executable mode.",
        "Working-tree/index changes, export-ignore and export-subst attributes are not applied.",
        "Generated handoff metadata: SOURCE_REVISION.txt and SHA256SUMS only.",
        "SHA256SUMS covers every archive member except SHA256SUMS itself.",
        "ZIP uses sorted source/metadata paths, then SHA256SUMS, fixed 1980-01-01 timestamps and uncompressed entries.",
        "No dataset/fixture/manifest content is filtered or rewritten.",
        "Filename exclusions are not a substitute for a secret or licensing review.",
        "This source snapshot does not include a full evidence/results handoff.",
        "", f"Documented omissions ({len(omissions)}):",
    ]
    lines.extend(f"- {item['path']}: {item['reason']}" for item in omissions)
    if not omissions:
        lines.append("- None")
    return ("\n".join(lines) + "\n").encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path, expected: dict[str, str]) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected) | {"SHA256SUMS"}:
            raise PackageError("ZIP inventory does not match the committed source inventory.")
        if archive.testzip() is not None:
            raise PackageError("ZIP CRC verification failed.")
        checksums: dict[str, str] = {}
        for line in archive.read("SHA256SUMS").decode("utf-8").splitlines():
            digest, name = line.split("  ", 1)
            if not re.fullmatch(r"[0-9a-f]{64}", digest) or name in checksums:
                raise PackageError("Invalid or duplicate SHA256SUMS entry.")
            checksums[name] = digest
        if checksums != expected:
            raise PackageError("SHA256SUMS does not match the expected committed source checksums.")
        for name, digest in checksums.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != digest:
                raise PackageError(f"SHA-256 verification failed for {name}.")


def package(revision: str, output: Path) -> dict:
    commit = git("rev-parse", "--verify", "--end-of-options", f"{revision}^{{commit}}").decode().strip()
    tree = git("rev-parse", f"{commit}^{{tree}}").decode().strip()
    object_format = git("rev-parse", "--show-object-format").decode().strip()
    if object_format not in {"sha1", "sha256"}:
        raise PackageError(f"Unsupported Git object format: {object_format}")
    entries, omissions = source_inventory(commit)
    output = output.expanduser().absolute()
    if output.suffix.lower() != ".zip" or any(char in output.name for char in "\r\n"):
        raise PackageError("--output must name a .zip file without line breaks.")
    summary_path = Path(str(output) + ".summary.json")
    checksum_path = Path(str(output) + ".sha256")
    targets = [output, summary_path, checksum_path]
    if any(os.path.lexists(path) for path in targets):
        raise PackageError("Output or sidecar already exists; choose a new --output path. Nothing overwritten.")
    output.parent.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []
    handles = []
    expected: dict[str, str] = {}
    source_bytes = 0
    try:
        # Exclusive creation reserves all destinations before writing; a collision never overwrites.
        for target in targets:
            handles.append(target.open("xb"))
            created.append(target)
        note = revision_note(commit, tree, object_format, len(entries), omissions)
        with (zipfile.ZipFile(handles[0], "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive,
              committed_blobs() as read_blob):
            source_by_path = {entry.path: entry for entry in entries}
            for name in sorted([*source_by_path, "SOURCE_REVISION.txt"]):
                entry = source_by_path.get(name)
                if entry is None:
                    data, mode = note, 0o644
                else:
                    data = read_blob(entry.object_id)
                    object_digest = hashlib.new(object_format, b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                    if object_digest != entry.object_id:
                        raise PackageError(f"Committed blob verification failed for {name}.")
                    source_bytes += len(data)
                    mode = 0o755 if entry.mode == "100755" else 0o644
                write_member(archive, name, data, mode)
                expected[name] = hashlib.sha256(data).hexdigest()
            sums = "".join(f"{expected[name]}  {name}\n" for name in sorted(expected)).encode("utf-8")
            write_member(archive, "SHA256SUMS", sums)
        handles[0].close()
        verify_archive(output, expected)
        archive_hash = sha256_file(output)
        summary = {
            "schema": POLICY, "commit": commit, "tree": tree, "git_object_format": object_format,
            "archive": output.name, "archive_bytes": output.stat().st_size, "archive_sha256": archive_hash,
            "source_files": len(entries), "source_bytes": source_bytes,
            "generated_files": sorted(GENERATED), "omitted_files": omissions,
            "verification": {"committed_blob_hashes": True, "zip_crc": True, "sha256sums": True},
            "zip": {"compression": "STORED", "timestamp": "1980-01-01T00:00:00",
                    "order": "source and revision note by path; SHA256SUMS last"},
        }
        handles[1].write((json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        handles[2].write(f"{archive_hash}  {output.name}\n".encode("utf-8"))
        for handle in handles:
            handle.close()
        if json.loads(summary_path.read_text(encoding="utf-8"))["archive_sha256"] != sha256_file(output):
            raise PackageError("External summary hash verification failed.")
        if checksum_path.read_text(encoding="utf-8") != f"{archive_hash}  {output.name}\n":
            raise PackageError("External SHA-256 sidecar verification failed.")
        return summary
    except BaseException:
        for handle in handles:
            handle.close()
        # Only files exclusively created by this invocation are removed on a failed package.
        for path in created:
            path.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog=("Example: python scripts/package-final-source.py --revision HEAD "
                "--output var/handoff/inspector-source.zip\n"
                "Uses committed blobs only; commit intended changes first. Excludes reference captures, "
                "presentations, runtime/build/dependency directories and secret-named files; every omission "
                "is listed inside SOURCE_REVISION.txt and the external summary. Existing outputs are never "
                "overwritten. Writes ZIP, ZIP.summary.json and ZIP.sha256; verifies blob hashes, ZIP CRC "
                "and all SHA256SUMS. Symlinks, submodules and paths incompatible with Windows fail explicitly. "
                "This is source delivery, not an evidence/results package."),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--revision", default="HEAD", help="Committed Git revision (default: HEAD).")
    parser.add_argument("--output", type=Path, required=True, help="New ZIP path; sidecars are created next to it.")
    args = parser.parse_args()
    try:
        summary = package(args.revision, args.output)
    except (PackageError, OSError, UnicodeError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
    print(json.dumps({key: summary[key] for key in ("commit", "archive", "archive_bytes", "archive_sha256", "source_files")}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
