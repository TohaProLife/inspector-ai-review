from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "download_model.py"
SERVICE_DIR = MODULE_PATH.parent
SPEC = importlib.util.spec_from_file_location("bonsai_download_model", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
download_model = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(download_model)


class BonsaiModelProvisionerTests(unittest.TestCase):
    def make_lock(self, directory: Path, filename: str, payload: bytes) -> Path:
        lock = {
            "schemaVersion": "bonsai-artifact-lock-v1",
            "modelId": "fixture/model",
            "revision": "a" * 40,
            "sourceBaseUrl": "https://invalid.example.test/model",
            "artifacts": [
                {
                    "filename": filename,
                    "role": "fixture",
                    "size": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            ],
        }
        path = directory / "lock.json"
        path.write_text(json.dumps(lock), encoding="utf-8")
        return path

    def test_imports_and_reuses_verified_artifact_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            payload = b"verified-model-fixture"
            (source / "model.gguf").write_bytes(payload)
            lock = self.make_lock(root, "model.gguf", payload)

            first = download_model.materialize_lock(
                lock, destination, source_dir=source, safety_bytes=0
            )
            self.assertEqual((destination / "model.gguf").read_bytes(), payload)
            source.rename(root / "source-removed")
            second = download_model.materialize_lock(
                lock, destination, source_dir=source, safety_bytes=0
            )

            self.assertEqual(first["lockSha256"], second["lockSha256"])
            self.assertTrue((destination / ".bonsai-model-ready.json").is_file())

    def test_replaces_corrupt_existing_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            destination.mkdir()
            payload = b"correct"
            (source / "model.gguf").write_bytes(payload)
            (destination / "model.gguf").write_bytes(b"corrupt")
            (destination / "model.gguf").chmod(0o444)
            lock = self.make_lock(root, "model.gguf", payload)

            download_model.materialize_lock(
                lock, destination, source_dir=source, safety_bytes=0
            )

            self.assertEqual((destination / "model.gguf").read_bytes(), payload)

    def test_rejects_checksum_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            expected = b"expected"
            (source / "model.gguf").write_bytes(b"different")
            lock = self.make_lock(root, "model.gguf", expected)

            with self.assertRaisesRegex(download_model.ArtifactError, "size|sha256"):
                download_model.materialize_lock(
                    lock, destination, source_dir=source, safety_bytes=0
                )

    def test_rejects_oversized_offline_artifact_before_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            expected = b"expected"
            (source / "model.gguf").write_bytes(expected + b"extra")
            lock = self.make_lock(root, "model.gguf", expected)

            with self.assertRaisesRegex(download_model.ArtifactError, "size mismatch"):
                download_model.materialize_lock(
                    lock, destination, source_dir=source, safety_bytes=0
                )

    def test_rejects_network_response_above_locked_size(self) -> None:
        class Response(BytesIO):
            status = 200

            def getcode(self) -> int:
                return self.status

            def __enter__(self):
                return self

            def __exit__(self, *_: object) -> None:
                self.close()

        with tempfile.TemporaryDirectory() as temporary:
            partial = Path(temporary) / "artifact.partial"
            with patch.object(download_model, "urlopen", return_value=Response(b"abcd")):
                with self.assertRaisesRegex(download_model.ArtifactError, "exceeds locked size"):
                    download_model.download_to_partial(
                        "https://example.invalid/artifact", partial, 3
                    )
            self.assertFalse(partial.exists())

    def test_rejects_unlocked_file_in_model_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            destination = root / "destination"
            source.mkdir()
            destination.mkdir()
            payload = b"fixture"
            (source / "model.gguf").write_bytes(payload)
            (destination / "unlocked.bin").write_bytes(b"unlocked")
            lock = self.make_lock(root, "model.gguf", payload)
            with self.assertRaisesRegex(download_model.ArtifactError, "inventory mismatch"):
                download_model.materialize_lock(
                    lock, destination, source_dir=source, safety_bytes=0
                )

    def test_rejects_unsafe_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.make_lock(root, "model.gguf", b"fixture")
            data = json.loads(lock.read_text(encoding="utf-8"))
            data["artifacts"][0]["filename"] = "../model.gguf"
            lock.write_text(json.dumps(data), encoding="utf-8")

            with self.assertRaisesRegex(download_model.ArtifactError, "safe basename"):
                download_model.load_lock(lock)

    def test_rejects_duplicate_artifact_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = self.make_lock(root, "model.gguf", b"fixture")
            data = json.loads(lock.read_text(encoding="utf-8"))
            data["artifacts"].append(dict(data["artifacts"][0]))
            lock.write_text(json.dumps(data), encoding="utf-8")

            with self.assertRaisesRegex(download_model.ArtifactError, "duplicate"):
                download_model.load_lock(lock)

    def test_checked_in_profile_and_entrypoint_match_artifact_lock(self) -> None:
        lock_path = SERVICE_DIR / "artifacts.lock.json"
        lock_bytes = lock_path.read_bytes()
        lock = json.loads(lock_bytes)
        profile = json.loads((SERVICE_DIR / "runtime-profile.json").read_text())
        entrypoint = (SERVICE_DIR / "entrypoint.sh").read_text()

        self.assertEqual(
            profile["artifactLockSha256"], hashlib.sha256(lock_bytes).hexdigest()
        )
        runtime_artifacts = {
            artifact["role"]: artifact
            for artifact in lock["artifacts"]
            if artifact["role"] in {"language_model", "vision_projector"}
        }
        self.assertEqual(set(runtime_artifacts), {"language_model", "vision_projector"})
        for artifact in runtime_artifacts.values():
            self.assertIn(artifact["filename"], entrypoint)
            self.assertIn(str(artifact["size"]), entrypoint)
            self.assertIn(artifact["sha256"], entrypoint)


if __name__ == "__main__":
    unittest.main()
