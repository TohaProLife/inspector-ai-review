from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch

from provision_models import ArtifactError, download, load_lock, provision, verify_snapshot


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ModelProvisionerTest(unittest.TestCase):
    def write_lock(self, root: Path, data: bytes, filename: str = "config.json") -> Path:
        lock = {
            "schemaVersion": "inspector-model-lock-v1",
            "profileId": "test-profile-v1",
            "sourceBaseUrl": "https://example.invalid",
            "models": [
                {
                    "modelId": "owner/model",
                    "revision": "1" * 40,
                    "localDirectory": "model",
                    "licenseId": "Apache-2.0",
                    "artifacts": [
                        {
                            "filename": filename,
                            "size": len(data),
                            "sha256": digest(data),
                        }
                    ],
                }
            ],
        }
        path = root / "lock.json"
        path.write_text(json.dumps(lock))
        return path

    def test_imports_and_reuses_verified_artifact(self) -> None:
        data = b'{"model":"fixture"}\n'
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, data)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(data)
            destination = root / "models"

            first = provision(lock, destination, source.parent, safety_bytes=0)
            second = provision(lock, destination, source.parent, safety_bytes=0)

            self.assertEqual(first["lockSha256"], second["lockSha256"])
            self.assertEqual((destination / "model" / "config.json").read_bytes(), data)
            self.assertTrue((destination / ".ready-test-profile-v1.json").is_file())

    def test_rejects_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, b"x", "../escape")
            with self.assertRaisesRegex(ArtifactError, "unsafe artifact filename"):
                load_lock(lock)

    def test_repairs_corrupt_readonly_artifact(self) -> None:
        data = b"expected"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, data)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(data)
            destination = root / "models"
            target = destination / "model" / "config.json"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"corrupt!")
            target.chmod(0o444)

            provision(lock, destination, source.parent, safety_bytes=0)

            self.assertEqual(target.read_bytes(), data)
            self.assertEqual(verify_snapshot(lock, destination)["profileId"], "test-profile-v1")

    def test_rejects_corrupt_import(self) -> None:
        expected = b"expected"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, expected)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(b"corrupt!")
            with self.assertRaisesRegex(ArtifactError, "verification failed"):
                provision(lock, root / "models", source.parent, safety_bytes=0)

    def test_rejects_oversized_import_before_copy(self) -> None:
        expected = b"expected"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, expected)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(expected + b"extra")
            with self.assertRaisesRegex(ArtifactError, "size mismatch"):
                provision(lock, root / "models", source.parent, safety_bytes=0)

    def test_rejects_network_response_above_locked_size(self) -> None:
        class Response(BytesIO):
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_: object) -> None:
                self.close()

        with tempfile.TemporaryDirectory() as temporary:
            partial = Path(temporary) / "artifact.part"
            with patch("provision_models.urlopen", return_value=Response(b"abcd")):
                with self.assertRaisesRegex(ArtifactError, "exceeds locked size"):
                    download("https://example.invalid/artifact", partial, 3)
            self.assertFalse(partial.exists())

    def test_rejects_unlocked_file_in_model_directory(self) -> None:
        data = b"fixture"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, data)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(data)
            destination = root / "models"
            (destination / "model").mkdir(parents=True)
            (destination / "model" / "unlocked.py").write_text("raise SystemExit")
            with self.assertRaisesRegex(ArtifactError, "inventory mismatch"):
                provision(lock, destination, source.parent, safety_bytes=0)

    def test_verify_snapshot_reads_without_writing_and_detects_tampering(self) -> None:
        data = b"fixture"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.write_lock(root, data)
            source = root / "import" / "model"
            source.mkdir(parents=True)
            (source / "config.json").write_bytes(data)
            destination = root / "models"
            provision(lock, destination, source.parent, safety_bytes=0)
            before = sorted(path.relative_to(destination) for path in destination.rglob("*") if path.is_file())
            ready = verify_snapshot(lock, destination)
            after = sorted(path.relative_to(destination) for path in destination.rglob("*") if path.is_file())
            self.assertEqual(before, after)
            self.assertEqual(ready["profileId"], "test-profile-v1")
            artifact = destination / "model" / "config.json"
            artifact.chmod(0o644)
            artifact.write_bytes(b"changed")
            with self.assertRaisesRegex(ArtifactError, "verification failed"):
                verify_snapshot(lock, destination)


if __name__ == "__main__":
    unittest.main()
