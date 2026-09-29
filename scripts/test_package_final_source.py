"""Source handoff invariants; no commits, credentials or remote services required."""

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("package_final_source", Path(__file__).with_name("package-final-source.py"))
packager = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = packager
SPEC.loader.exec_module(packager)


class SourcePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inspector-source-packager-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.commit = "a" * 40
        self.tree = "b" * 40
        # Preserve CRLF and arbitrary UTF-8 source bytes, including data manifests.
        self.sources = {
            "README.md": (b"# Committed source\r\n", "100644"),
            "datasets/public/manifest.jsonl": ('{"title":"Документ"}\r\n'.encode(), "100644"),
            "scripts/run.sh": (b"#!/bin/sh\nexit 0\n", "100755"),
            "docs/assets/mobbin/reference.jpg": (b"excluded reference", "100644"),
            "output/slides/slide.png": (b"excluded slide", "100644"),
        }
        self.blobs = {}
        self.records = []
        for name, (data, mode) in self.sources.items():
            object_id = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            self.blobs[object_id] = data
            self.records.append(f"{mode} blob {object_id}\t{name}".encode())

    def fake_git(self, *args):
        if args[0] == "ls-tree":
            return b"\0".join(self.records) + b"\0"
        if args == ("rev-parse", "--show-object-format"):
            return b"sha1\n"
        if args == ("rev-parse", f"{self.commit}^{{tree}}"):
            return (self.tree + "\n").encode()
        if args[0] == "rev-parse":
            return (self.commit + "\n").encode()
        raise AssertionError(args)

    def build(self, name="source.zip", reader=None):
        output = self.directory / name
        with (patch.object(packager, "git", self.fake_git),
              patch.object(packager, "committed_blobs", lambda: nullcontext(reader or self.blobs.__getitem__))):
            summary = packager.package("HEAD", output)
        return output, summary

    def test_exclusion_policy_keeps_code_docs_templates_and_public_fixtures(self):
        for name in [".env.example", "infra/laptop.env.example", "docs/README.md",
                     "apps/api/src/identity.ts", "apps/api/test/fixtures/encrypted.pdf",
                     "fixtures/public-review/F0101.pdf", "datasets/public/manifest.jsonl"]:
            self.assertIsNone(packager.exclusion_reason(name), name)
        for name in ["docs/assets/mobbin/a.jpg", "design-research/a.mp4", ".tmp/file",
                     "var/local-config.json", "output/results.json", "runtime/state",
                     "apps/web/node_modules/library.js", "infra/.env.server",
                     "infra/.review-user", "secrets/local.json", "key.pem", "slides/final.pdf",
                     "final-presentation.pdf", "project.pptx"]:
            self.assertIsNotNone(packager.exclusion_reason(name), name)

    def test_exact_bytes_modes_omissions_and_external_hashes(self):
        output, summary = self.build()
        with zipfile.ZipFile(output) as archive:
            for name in ["README.md", "datasets/public/manifest.jsonl", "scripts/run.sh"]:
                self.assertEqual(archive.read(name), self.sources[name][0])
            self.assertEqual((archive.getinfo("scripts/run.sh").external_attr >> 16) & 0o777, 0o755)
            self.assertTrue(all(info.date_time == packager.ZIP_TIMESTAMP for info in archive.infolist()))
            self.assertNotIn("docs/assets/mobbin/reference.jpg", archive.namelist())
            self.assertIn("docs/assets/mobbin/reference.jpg", archive.read("SOURCE_REVISION.txt").decode())
            self.assertEqual(summary["source_files"], 3)
            self.assertEqual(len(summary["omitted_files"]), 2)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        self.assertEqual(summary["archive_sha256"], digest)
        self.assertEqual(Path(str(output) + ".sha256").read_text(), f"{digest}  source.zip\n")
        self.assertEqual(json.loads(Path(str(output) + ".summary.json").read_text())["commit"], self.commit)

    def test_reproducible_across_output_names(self):
        first, _ = self.build("first.zip")
        second, _ = self.build("second.zip")
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_existing_output_and_sidecar_never_overwritten(self):
        for suffix in ["", ".summary.json", ".sha256"]:
            with self.subTest(suffix=suffix):
                filename = f"occupied-{len(suffix)}.zip"
                occupied = Path(str(self.directory / filename) + suffix)
                occupied.write_bytes(b"existing user content")
                with self.assertRaises(packager.PackageError):
                    self.build(filename)
                self.assertEqual(occupied.read_bytes(), b"existing user content")
                if suffix:
                    self.assertFalse((self.directory / filename).exists())

    def test_wrong_committed_blob_fails_and_removes_only_new_outputs(self):
        unrelated = self.directory / "keep.txt"
        unrelated.write_text("keep")
        with self.assertRaises(packager.PackageError):
            self.build(reader=lambda _: b"wrong blob")
        self.assertEqual(sorted(path.name for path in self.directory.iterdir()), ["keep.txt"])

    def test_checksum_verification_rejects_valid_zip_with_changed_payload(self):
        output, _ = self.build()
        with zipfile.ZipFile(output) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        expected = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items() if name != "SHA256SUMS"}
        contents["README.md"] = b"changed after packaging"
        altered = self.directory / "altered.zip"
        with zipfile.ZipFile(altered, "w") as archive:
            for name, data in contents.items():
                packager.write_member(archive, name, data)
        with self.assertRaises(packager.PackageError):
            packager.verify_archive(altered, expected)

    def test_unsafe_paths_are_rejected(self):
        for name in ["../README.md", "/absolute", "C:/absolute", "bad\\path", "two\nlines",
                     "con.txt", "folder/name.", "folder/what?.txt"]:
            with self.subTest(name=name), self.assertRaises(packager.PackageError):
                packager.validate_path(name)


if __name__ == "__main__":
    unittest.main()
