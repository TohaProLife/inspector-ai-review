from __future__ import annotations

from pathlib import Path
import unittest

import json
import tempfile

from document_limits import validate_pixel_dimensions
from document_profile import ProfileError, load_profile, pipeline_options
from provision import build_manifest, verify_manifest


ROOT = Path(__file__).resolve().parents[1]


class DocumentProfileTest(unittest.TestCase):
    def test_profiles_are_complete(self) -> None:
        for name, device in (("laptop.json", "cpu"), ("server.json", "gpu:0")):
            profile = load_profile(ROOT / "profiles" / name)
            self.assertEqual(profile.device, device)
            self.assertEqual(profile.scripts, ("eslav", "latin"))
            self.assertEqual(pipeline_options(profile, "eslav")["device"], device)
            self.assertEqual(
                pipeline_options(profile, "latin")["text_recognition_model_name"],
                "latin_PP-OCRv5_mobile_rec",
            )
        self.assertIn("list(runtime.pipeline", (ROOT / "app.py").read_text())
        self.assertIn("PADDLE_PDX_CACHE_HOME", (ROOT / "Dockerfile").read_text())
        self.assertNotIn("PADDLEX_HOME", (ROOT / "Dockerfile").read_text())

    def test_rejects_unknown_script(self) -> None:
        profile = load_profile(ROOT / "profiles" / "laptop.json")
        with self.assertRaisesRegex(ProfileError, "not enabled"):
            pipeline_options(profile, "unknown")

    def test_pixel_limit_rejects_large_or_invalid_images(self) -> None:
        self.assertEqual(
            validate_pixel_dimensions(100.1, 200.1, max_pixels=100000, max_side=1000),
            (101, 201),
        )
        with self.assertRaisesRegex(ValueError, "exceeds"):
            validate_pixel_dimensions(1000, 1000, max_pixels=999999, max_side=2000)
        with self.assertRaisesRegex(ValueError, "positive"):
            validate_pixel_dimensions(0, 100, max_pixels=100000, max_side=1000)

    def test_manifest_validates_schema_profile_and_exact_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "cache"
            cache.mkdir()
            profile_path = ROOT / "profiles" / "laptop.json"
            (cache / "weights.bin").write_bytes(b"weights")
            manifest = build_manifest(cache, profile_path, "profile-v1")
            manifest_path = cache / ".ready-profile-v1.json"
            manifest_path.write_text(json.dumps(manifest))
            self.assertTrue(verify_manifest(cache, profile_path, "profile-v1", manifest_path))

            (cache / "unexpected.bin").write_bytes(b"unexpected")
            self.assertFalse(verify_manifest(cache, profile_path, "profile-v1", manifest_path))
            (cache / "unexpected.bin").unlink()
            manifest["profileId"] = "wrong-profile"
            manifest_path.write_text(json.dumps(manifest))
            self.assertFalse(verify_manifest(cache, profile_path, "profile-v1", manifest_path))


if __name__ == "__main__":
    unittest.main()
