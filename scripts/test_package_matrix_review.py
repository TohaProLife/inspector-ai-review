"""Hand-authored archive integrity checks; no product/runtime imports."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("matrix_review_package", Path(__file__).with_name("package-matrix-review.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReviewedSourcePackaging(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.override = patch.object(MODULE, "ROOT", self.root)
        self.override.start()
        self.addCleanup(self.override.stop)
        (self.root / "evidence").mkdir()

    def write(self, name, data=b"accepted bytes", mode=0o644):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(mode)
        return path

    def source_map(self, entries):
        locations = {}
        for target, origin in entries.items():
            payload = (self.root / origin).read_bytes()
            locations[target] = {"source": origin, "sha256": hashlib.sha256(payload).hexdigest()}
        document = {"files": {name: pin["sha256"] for name, pin in locations.items()}, "sourceLocations": locations}
        return self.write("map.json", json.dumps(document).encode())

    def test_archive_uses_reviewed_overlay_and_operation_files(self):
        self.write("apps/api/src/version.ts", b"stale checkout")
        self.write("apps/api/src/removed.ts", b"must not leak into selected version")
        self.write("output/selected/version.ts", b"accepted overlay", 0o755)
        self.write("infra/ordinary.yml", b"services: {}")
        source_map = self.source_map({"apps/api/src/version.ts": "output/selected/version.ts"})
        listed = b"apps/api/src/version.ts\0apps/api/src/removed.ts\0infra/ordinary.yml\0"
        output = self.root / "review.zip"
        with patch.object(MODULE.subprocess, "check_output", side_effect=[listed, b"a" * 40]):
            result = MODULE.package(output, self.root / "evidence", source_map)
        self.assertEqual(result["status"], "PASS")
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read("source/apps/api/src/version.ts"), b"accepted overlay")
            self.assertEqual(archive.read("source/infra/ordinary.yml"), b"services: {}")
            self.assertNotIn("source/apps/api/src/removed.ts", archive.namelist())
            self.assertEqual(archive.getinfo("source/apps/api/src/version.ts").external_attr >> 16 & 0o777, 0o755)
            note = json.loads(archive.read("REVIEW_SNAPSHOT.json"))
            self.assertEqual(note["applicationSourceMap"]["includedMappedFiles"], 1)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(output.with_suffix(".zip.sha256").stat().st_mode & 0o777, 0o600)

    def test_checksum_drift_refused(self):
        self.write("origin.ts")
        source_map = self.source_map({"apps/a.ts": "origin.ts"})
        self.write("origin.ts", b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            MODULE.mapped_sources(source_map)

    def test_duplicate_keys_refused(self):
        source_map = self.write("map.json", b'{"files":{},"files":{},"sourceLocations":{}}')
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            MODULE.mapped_sources(source_map)

    def test_target_traversal_refused(self):
        self.write("origin.ts")
        source_map = self.source_map({"../escape.ts": "origin.ts"})
        with self.assertRaises(MODULE.policy.PackageError):
            MODULE.mapped_sources(source_map)

    def test_mismatched_inventory_refused(self):
        source_map = self.write("map.json", b'{"files":{"a":"b"},"sourceLocations":{}}')
        with self.assertRaisesRegex(ValueError, "matching"):
            MODULE.mapped_sources(source_map)

    def test_symlink_escape_refused(self):
        self.write("origin.ts")
        source_map = self.source_map({"apps/a.ts": "origin.ts"})
        with tempfile.TemporaryDirectory() as elsewhere:
            outside = Path(elsewhere) / "outside.ts"
            outside.write_bytes(b"accepted bytes")
            (self.root / "origin.ts").unlink()
            os.symlink(outside, self.root / "origin.ts")
            with self.assertRaisesRegex(ValueError, "leaves workspace"):
                MODULE.mapped_sources(source_map)

    def test_runtime_and_secret_files_omitted_even_when_pinned(self):
        self.write("runtime.pdf")
        self.write("credentials.txt")
        source_map = self.source_map({"apps/api/runtime/original.pdf": "runtime.pdf", "apps/api/.env": "credentials.txt"})
        members, note = MODULE.mapped_sources(source_map)
        self.assertEqual(members, {})
        self.assertEqual(len(note["omittedMappedFiles"]), 2)

    def test_existing_archive_is_preserved(self):
        output = self.write("review.zip", b"keep")
        with self.assertRaisesRegex(ValueError, "exists"):
            MODULE.package(output, self.root / "evidence")
        self.assertEqual(output.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
