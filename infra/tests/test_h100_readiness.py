import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


INFRA = Path(__file__).resolve().parents[1]
h100 = load("h100_readiness", INFRA / "h100-readiness.py")
legacy = load("legacy_guard_tests", INFRA / "tests/test_check_competition_profile.py")
UUID = "GPU-12345678-abcd-1234-abcd-123456789abc"


def config():
    data = legacy.synthetic_config()
    data["networks"] = {"provider-runtime": {"internal": True}}
    for name in h100.PROVIDERS:
        service = data["services"].setdefault(name, {})
        service["networks"] = {"provider-runtime": {"aliases": ["vlm"] if name == "qwen-vlm-server" else []}}
        service["volumes"] = [{"target": "/models", "type": "volume", "source": "models", "read_only": True}]
        service.setdefault("environment", {}).update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    data["services"]["embedding-server"]["environment"]["TEXT_RUNTIME_DEVICE"] = "cpu"
    for name in ("worker", "document-worker", "extract-worker"):
        data["services"][name]["environment"]["DOCUMENT_PROVIDER_BASE_URL"] = "http://document-ai:8080"
    data["services"]["link-worker"] = {"environment": {"EMBEDDING_BASE_URL": "http://embedding:8080/v1"}}
    data["services"]["qwen-vlm-server"]["command"] += ["--max-model-len", "8192", "--max-num-seqs", "2", "--gpu-memory-utilization", "0.35"]
    data["services"]["api"]["environment"].update(INSPECTOR_ANALYSIS_PROFILE="MATRIX_V1", INSPECTOR_MATRIX_CONCRETE_WALLS_V13="1",
        INSPECTOR_VISUAL_PROFILE="V9_SAMPLE", INSPECTOR_MATRIX_VISUAL_PROPOSALS="1", INSPECTOR_MATRIX_OCR_LAYOUT="1")
    return data


class H100ReadinessTests(unittest.TestCase):
    def test_gpu_requires_exact_h100_uuid_memory_and_compute(self):
        valid = f"NVIDIA H100 80GB HBM3, {UUID}, 81559, 9.0\n"
        self.assertEqual(h100.nvidia(valid, UUID)["computeCapability"], "9.0")
        for bad in (valid.replace("H100", "A100"), valid.replace("H100", "H200"), valid.replace("81559", "40000"),
                    valid.replace("9.0", "8.0"), valid.replace(UUID, "GPU-other"), valid + valid, ""):
            with self.subTest(bad=bad), self.assertRaises(h100.ReadinessError):
                h100.nvidia(bad, UUID)

    def test_torch_requires_actual_cuda_kernel_and_one_device(self):
        good = {"available": True, "count": 1, "name": "NVIDIA H100 PCIe", "capability": [9, 0], "kernelValue": 16.0}
        h100.torch_result(good)
        for field, value in (("available", False), ("count", 2), ("name", "NVIDIA A100"), ("capability", [8, 0]), ("kernelValue", 0)):
            with self.subTest(field=field), self.assertRaises(h100.ReadinessError):
                h100.torch_result(good | {field: value})

    def test_runtime_identity_fails_before_docker_or_http(self):
        with mock.patch.object(h100, "run") as command, mock.patch.object(h100, "http") as request, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(h100.main(["--mode", "runtime"]), 1)
            command.assert_not_called(); request.assert_not_called()
        with mock.patch.object(h100.socket, "gethostname", return_value="assigned-host"):
            h100.identity("assigned-host", UUID, "a" * 64)
            for host, gpu, manifest in (("homeserver", UUID, "a"*64), ("assigned-host", "0", "a"*64), ("assigned-host", UUID, None)):
                with self.assertRaises(h100.ReadinessError):
                    h100.identity(host, gpu, manifest)

    def test_config_requires_explicit_feedback_and_local_offline_readonly_models(self):
        h100.validate_config(config(), legacy.SELECTORS, True)
        mutations = [
            lambda s: s["api"]["environment"].update(INSPECTOR_ANALYSIS_PROFILE="SCAFFOLD"),
            lambda s: s["api"]["environment"].update(INSPECTOR_VISUAL_PROFILE="V6"),
            lambda s: s["qwen-vlm-server"]["environment"].update(HF_HUB_OFFLINE="0"),
            lambda s: s["qwen-vlm-server"]["volumes"][0].update(read_only=False),
            lambda s: s["embedding-server"]["environment"].update(TEXT_RUNTIME_DEVICE="cuda"),
            lambda s: s["extract-worker"]["environment"].update(DOCUMENT_PROVIDER_BASE_URL="https://external.example"),
            lambda s: s["qwen-vlm-server"]["networks"].update(external={}),
        ]
        for mutate in mutations:
            data = config(); mutate(data["services"])
            with self.subTest(mutate=mutate), self.assertRaises((h100.ReadinessError, h100.guard.ProfileError)):
                h100.validate_config(data, legacy.SELECTORS, True)
        data = config(); data["networks"]["provider-runtime"]["internal"] = False
        with self.assertRaises(h100.ReadinessError):
            h100.validate_config(data, legacy.SELECTORS, True)

    def test_queue_presence_is_not_enough_without_consumer(self):
        good = [{"name": q, "consumers": 1, "messages": 0} for q in h100.QUEUES]
        h100.validate_queues(good)
        with self.assertRaises(h100.ReadinessError): h100.validate_queues(good[:-1])
        good[0]["consumers"] = 0
        with self.assertRaises(h100.ReadinessError): h100.validate_queues(good)

    def test_response_model_and_finite_embedding_are_required(self):
        vlm = {"model": h100.guard.VLM_MODEL, "choices": [{"message": {"content": "SMOKE 123"}}]}
        embed = {"model": h100.EMBEDDING, "data": [{"embedding": [0.1]*1024}]}
        h100.validate_inference(vlm, embed)
        for changed_vlm, changed_embed in ((vlm | {"model": "wrong"}, embed), (vlm, embed | {"model": "wrong"}),
            (vlm, {"model": h100.EMBEDDING, "data": [{"embedding": [float("nan")]*1024}]})):
            with self.assertRaises(h100.ReadinessError): h100.validate_inference(changed_vlm, changed_embed)

    def test_subprocess_errors_do_not_expose_secrets(self):
        result = h100.subprocess.CompletedProcess([], 1, "TOP_SECRET", "TOP_SECRET")
        with mock.patch.object(h100.subprocess, "run", return_value=result), self.assertRaises(h100.ReadinessError) as raised:
            h100.run(["docker", "inspect"])
        self.assertNotIn("TOP_SECRET", str(raised.exception))

    def test_config_cli_has_no_runtime_actions(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = Path(temporary) / "server.env"
            text = "\n".join(f"{k}={v}" for k, v in legacy.SELECTORS.items())
            env.write_text(text.replace("PILOT_PZ002_PZ017", "MATRIX_V1").replace("=V6", "=V9_SAMPLE"))
            out = io.StringIO()
            with mock.patch.object(h100, "run", return_value=json.dumps(config())) as command, mock.patch.object(h100, "profile_contract", return_value={}), mock.patch.object(h100, "runtime") as runtime, contextlib.redirect_stdout(out):
                self.assertEqual(h100.main(["--matrix-v13", "--env-file", str(env)]), 0)
                runtime.assert_not_called()
                self.assertEqual(command.call_count, 1)
                self.assertEqual(command.call_args.args[0][-3:], ["config", "--format", "json"])
            self.assertFalse(json.loads(out.getvalue())["runtimeExecuted"])

    def test_source_contract_rejects_existing_4b_v8_on_8b_server(self):
        for mode in ("SAMPLE", "FULL"):
            with self.subTest(mode=mode), self.assertRaisesRegex(h100.ReadinessError, "pins 4B provider"):
                h100.profile_contract("V8_" + mode)

    def test_full_mode_is_explicit_and_cannot_silently_use_sample(self):
        with self.assertRaises(h100.ReadinessError):
            h100.validate_config(config(), legacy.SELECTORS, True, "FULL")
        full = config(); full["services"]["api"]["environment"]["INSPECTOR_VISUAL_PROFILE"] = "V9_FULL"
        h100.validate_config(full, legacy.SELECTORS, True, "FULL")

    def test_new_v9_contract_uses_server_pins_without_changing_v8(self):
        for mode in ("SAMPLE", "FULL"):
            profile = h100.profile_contract("V9_" + mode)
            self.assertEqual(profile["vlmModelId"], h100.guard.VLM_MODEL)
            self.assertEqual(profile["analysisMode"], mode)


if __name__ == "__main__":
    unittest.main()
