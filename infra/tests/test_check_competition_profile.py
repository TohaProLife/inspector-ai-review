import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "check-competition-profile.py"
spec = importlib.util.spec_from_file_location("check_competition_profile", SCRIPT)
guard = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(guard)


SELECTORS = {
    "INSPECTOR_ANALYSIS_PROFILE": "PILOT_PZ002_PZ017",
    "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE": "v4",
    "INSPECTOR_VISUAL_PROFILE": "V6",
    "INSPECTOR_OCR_HEAT_ROW_PROFILE": "v1",
    "INSPECTOR_FACT_FAMILY_PROFILE": "v1",
    "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE": "v1",
    "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE": "v1",
    "SERVER_GPU_DEVICE": "0",
}


def synthetic_config():
    gpu_env = {"NVIDIA_VISIBLE_DEVICES": "0", "CUDA_VISIBLE_DEVICES": "0"}
    return {
        "services": {
            "api": {"environment": {key: value for key, value in SELECTORS.items() if key != "SERVER_GPU_DEVICE"}},
            "extract-worker": {
                "environment": {
                    "VLM_BASE_URL": guard.VLM_ENDPOINT,
                    "VISUAL_VLM_BASE_URL": guard.VLM_ENDPOINT,
                    "VLM_MODEL": guard.VLM_MODEL,
                    "OCR_LAYOUT_PROFILE_ID": "ocr-paddle-3.7.0-ru-en-server-v1",
                    "INSPECTOR_DURABLE_OCR_CACHE_ROOT": "/ocr-page-cache",
                },
                "volumes": [{"type": "volume", "source": "ocr-page-cache", "target": "/ocr-page-cache"}],
                "networks": {"provider-runtime": None},
            },
            "document-worker": {
                "environment": {"INSPECTOR_DURABLE_TEXT_CACHE_ROOT": "/text-layer-cache"},
                "volumes": [{"type": "volume", "source": "text-layer-cache", "target": "/text-layer-cache"}],
            },
            "worker": {
                "environment": {"INSPECTOR_DURABLE_OCR_CACHE_ROOT": "/ocr-page-cache",
                                "OCR_LAYOUT_PROFILE_ID": "ocr-paddle-3.7.0-ru-en-server-v1"},
                "volumes": [{"type": "volume", "source": "ocr-page-cache", "target": "/ocr-page-cache"}],
            },
            "hf-model-init-server": {"environment": {"MODEL_STORE_LOCK": "/opt/model-store/locks/server.json"}},
            "gpu-admission-server": {
                "runtime": "nvidia",
                "environment": {"NVIDIA_VISIBLE_DEVICES": "0", "GPU_DEVICE": "0"},
            },
            "document-model-init-server": {"runtime": "nvidia", "environment": gpu_env.copy()},
            "document-ai-server": {"runtime": "nvidia", "environment": gpu_env.copy()},
            "qwen-vlm-server": {
                "runtime": "nvidia",
                "environment": gpu_env.copy(),
                "command": [
                    "--model", guard.VLM_DIRECTORY,
                    "--served-model-name", guard.VLM_MODEL,
                    "--tensor-parallel-size", "1",
                    "--port", "8000",
                ],
                "networks": {"provider-runtime": {"aliases": ["vlm"]}},
            },
        }
    }


class CompetitionProfileTests(unittest.TestCase):
    def test_accepts_explicit_single_gpu_profile(self):
        text = "\n".join(f"{key}={value}" for key, value in SELECTORS.items())
        self.assertEqual(guard.parse_env(text), SELECTORS)
        guard.validate_config(synthetic_config(), SELECTORS)
        guard.validate_visible_gpus("GPU-3f55a\n", "qwen-vlm-server")

    def test_env_must_explicitly_select_competition_profiles(self):
        for key, bad in (
            ("INSPECTOR_ANALYSIS_PROFILE", "SCAFFOLD"),
            ("INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v1"),
            ("INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v2"),
            ("INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v3"),
            ("INSPECTOR_VISUAL_PROFILE", "V4"),
            ("INSPECTOR_OCR_HEAT_ROW_PROFILE", ""),
            ("INSPECTOR_FACT_FAMILY_PROFILE", ""),
            ("INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE", ""),
            ("INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE", ""),
            ("SERVER_GPU_DEVICE", "0,1"),
            ("SERVER_GPU_DEVICE", "all"),
        ):
            with self.subTest(key=key, bad=bad):
                changed = SELECTORS | {key: bad}
                text = "\n".join(f"{item}={value}" for item, value in changed.items())
                with self.assertRaises(guard.ProfileError):
                    guard.parse_env(text)
        for key in guard.REQUIRED_PROFILES:
            with self.subTest(missing=key):
                text = "\n".join(f"{item}={value}" for item, value in SELECTORS.items() if item != key)
                with self.assertRaises(guard.ProfileError):
                    guard.parse_env(text)
        with self.assertRaisesRegex(guard.ProfileError, "duplicated"):
            guard.parse_env("\n".join(f"{key}={value}" for key, value in SELECTORS.items()) + "\nSERVER_GPU_DEVICE=1")
        with self.assertRaisesRegex(guard.ProfileError, "duplicated"):
            guard.parse_env("\n".join(f"{key}={value}" for key, value in SELECTORS.items())
                            + "\nINSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE=v1")

    def test_resolved_config_catches_shell_override_and_endpoint_model_drift(self):
        for service, key, value in (
            ("api", "INSPECTOR_ANALYSIS_PROFILE", "SCAFFOLD"),
            ("api", "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v1"),
            ("api", "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v2"),
            ("api", "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "v3"),
            ("api", "INSPECTOR_VISUAL_PROFILE", "V5"),
            ("api", "INSPECTOR_OCR_HEAT_ROW_PROFILE", ""),
            ("api", "INSPECTOR_FACT_FAMILY_PROFILE", ""),
            ("api", "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE", ""),
            ("api", "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE", ""),
            ("extract-worker", "VISUAL_VLM_BASE_URL", "https://external.example/v1"),
            ("extract-worker", "VLM_BASE_URL", "http://vlm:8101/v1"),
            ("extract-worker", "VLM_MODEL", "other-model"),
            ("extract-worker", "OCR_LAYOUT_PROFILE_ID", "other-profile"),
            ("document-worker", "INSPECTOR_DURABLE_TEXT_CACHE_ROOT", "/wrong"),
            ("worker", "INSPECTOR_DURABLE_OCR_CACHE_ROOT", "/wrong"),
            ("worker", "OCR_LAYOUT_PROFILE_ID", "other-profile"),
            ("document-ai-server", "NVIDIA_VISIBLE_DEVICES", "0,1"),
            ("qwen-vlm-server", "CUDA_VISIBLE_DEVICES", "0,1"),
        ):
            with self.subTest(service=service, key=key):
                config = synthetic_config()
                config["services"][service]["environment"][key] = value
                with self.assertRaises(guard.ProfileError):
                    guard.validate_config(config, SELECTORS)

    def test_rejects_extra_gpu_and_mismatched_vlm_server(self):
        for mutate in (
            lambda s: s["qwen-vlm-server"].update(gpus="all"),
            lambda s: s["qwen-vlm-server"]["command"].__setitem__(5, "2"),
            lambda s: s["qwen-vlm-server"]["networks"]["provider-runtime"].update(aliases=["other"]),
            lambda s: s.update(extra={"runtime": "nvidia", "environment": {"NVIDIA_VISIBLE_DEVICES": "0"}}),
        ):
            config = synthetic_config()
            mutate(config["services"])
            with self.assertRaises(guard.ProfileError):
                guard.validate_config(config, SELECTORS)
        for name in ("worker", "document-worker", "extract-worker"):
            with self.subTest(missing_cache_volume=name):
                config = synthetic_config()
                config["services"][name]["volumes"] = []
                with self.assertRaisesRegex(guard.ProfileError, "cache volume"):
                    guard.validate_config(config, SELECTORS)
        for output in ("", "GPU-1\nGPU-2\n", "not-a-gpu\n"):
            with self.assertRaises(guard.ProfileError):
                guard.validate_visible_gpus(output, "qwen-vlm-server")

    def test_main_never_exposes_env_or_compose_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = Path(temporary) / ".env.server"
            env.write_text("\n".join(f"{key}={value}" for key, value in SELECTORS.items()) + "\nPOSTGRES_PASSWORD=TOP_SECRET\n")
            stderr = io.StringIO()
            with mock.patch.object(guard, "run_checked", return_value=json.dumps(synthetic_config())), contextlib.redirect_stderr(stderr):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(guard.main(["--env-file", str(env)]), 0)
            self.assertNotIn("TOP_SECRET", stderr.getvalue())
            with mock.patch.object(guard, "run_checked", side_effect=guard.ProfileError("Docker Compose command failed")), contextlib.redirect_stderr(stderr):
                self.assertEqual(guard.main(["--env-file", str(env)]), 1)
            self.assertNotIn("TOP_SECRET", stderr.getvalue())
            env.write_text(env.read_text().replace(
                "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE=v1",
                "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE=TOP_SECRET"))
            with contextlib.redirect_stderr(stderr):
                self.assertEqual(guard.main(["--env-file", str(env)]), 1)
            self.assertNotIn("TOP_SECRET", stderr.getvalue())

    def test_compose_stderr_is_redacted(self):
        completed = subprocess.CompletedProcess(["docker", "compose"], 1, "", "TOP_SECRET")
        with mock.patch.object(guard.subprocess, "run", return_value=completed):
            with self.assertRaises(guard.ProfileError) as caught:
                guard.run_checked(["docker", "compose"], timeout=1)
        self.assertNotIn("TOP_SECRET", str(caught.exception))

    def test_running_mode_requires_one_gpu_in_each_provider(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = Path(temporary) / ".env.server"
            env.write_text("\n".join(f"{key}={value}" for key, value in SELECTORS.items()))
            results = [json.dumps(synthetic_config()), "GPU-111\n", "GPU-222\n"]
            with mock.patch.object(guard, "run_checked", side_effect=results) as run:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(guard.main(["--env-file", str(env), "--running"]), 0)
            self.assertEqual(run.call_count, 3)
            self.assertIn("qwen-vlm-server", run.call_args_list[2].args[0])


if __name__ == "__main__":
    unittest.main()
