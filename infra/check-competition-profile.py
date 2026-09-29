#!/usr/bin/env python3
"""Fail-closed check of the resolved one-GPU H100 competition profile.

This command never prints the env file, Compose output, or subprocess stderr:
those can contain deployment credentials.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
REQUIRED_PROFILES = {
    "INSPECTOR_ANALYSIS_PROFILE": "PILOT_PZ002_PZ017",
    "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE": "v4",
    "INSPECTOR_VISUAL_PROFILE": "V6",
    "INSPECTOR_OCR_HEAT_ROW_PROFILE": "v1",
    "INSPECTOR_FACT_FAMILY_PROFILE": "v1",
    "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE": "v1",
    "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE": "v1",
}
VLM_ENDPOINT = "http://vlm:8000/v1"
VLM_MODEL = "inspector-qwen3-vl-8b-fp8"
VLM_DIRECTORY = "/models/qwen3-vl-8b-instruct-fp8"
SERVER_LOCK_SHA256 = "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879"
GPU_SERVICES = {
    "gpu-admission-server",
    "document-model-init-server",
    "document-ai-server",
    "qwen-vlm-server",
}
RUNNING_GPU_SERVICES = ("document-ai-server", "qwen-vlm-server")


class ProfileError(Exception):
    pass


def fail(check: str) -> None:
    raise ProfileError(check)


def parse_env(text: str) -> dict[str, str]:
    """Read only the launch selectors; all other values are deliberately ignored."""
    wanted = set(REQUIRED_PROFILES) | {"SERVER_GPU_DEVICE"}
    found: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if key not in wanted:
            continue
        if not separator or key in found:
            fail(f"env selector {key} is malformed or duplicated")
        # The generated env file uses literal KEY=value syntax. Quotes or
        # interpolation obscure what is actually selected for a release.
        found[key] = value.strip()
    for key, expected in REQUIRED_PROFILES.items():
        if found.get(key) != expected:
            fail(f"env selector {key} must be explicitly set to {expected}")
    selected = found.get("SERVER_GPU_DEVICE", "")
    if not re.fullmatch(r"(?:[0-9]+|GPU-[A-Za-z0-9-]+)", selected):
        fail("SERVER_GPU_DEVICE must identify exactly one GPU")
    return found


def environment(service: dict, service_name: str) -> dict:
    values = service.get("environment")
    if not isinstance(values, dict):
        fail(f"{service_name} environment is missing")
    return values


def expect_field(values: dict, key: str, expected: str, service_name: str) -> None:
    if values.get(key) != expected:
        fail(f"{service_name}.{key} does not match competition profile")


def command_option(command: object, option: str) -> str | None:
    if not isinstance(command, list):
        return None
    positions = [index for index, value in enumerate(command) if value == option]
    if len(positions) != 1 or positions[0] + 1 >= len(command):
        return None
    return str(command[positions[0] + 1])


def require_cache_volume(service: dict, service_name: str, source: str, target: str) -> None:
    volumes = service.get("volumes")
    if (not isinstance(volumes, list)
            or sum(1 for item in volumes if isinstance(item, dict)
                   and item.get("type") == "volume"
                   and item.get("source") == source
                   and item.get("target") == target) != 1):
        fail(f"{service_name} cache volume does not match competition profile")


def validate_config(config: dict, selectors: dict[str, str]) -> None:
    if not isinstance(config, dict):
        fail("Docker Compose config is malformed")
    services = config.get("services")
    if not isinstance(services, dict):
        fail("Compose services are missing")
    for name in {"api", "worker", "document-worker", "extract-worker",
                 "qwen-vlm-server", "hf-model-init-server"} | GPU_SERVICES:
        if name not in services or not isinstance(services[name], dict):
            fail(f"Compose service {name} is missing")

    api = environment(services["api"], "api")
    for key, expected in REQUIRED_PROFILES.items():
        expect_field(api, key, expected, "api")

    extract = services["extract-worker"]
    worker_env = environment(extract, "extract-worker")
    for key in ("VLM_BASE_URL", "VISUAL_VLM_BASE_URL"):
        expect_field(worker_env, key, VLM_ENDPOINT, "extract-worker")
    expect_field(worker_env, "VLM_MODEL", VLM_MODEL, "extract-worker")
    expect_field(worker_env, "OCR_LAYOUT_PROFILE_ID", "ocr-paddle-3.7.0-ru-en-server-v1", "extract-worker")
    expect_field(worker_env, "INSPECTOR_DURABLE_OCR_CACHE_ROOT", "/ocr-page-cache", "extract-worker")
    require_cache_volume(extract, "extract-worker", "ocr-page-cache", "/ocr-page-cache")
    for name, source, target, key in (
        ("document-worker", "text-layer-cache", "/text-layer-cache", "INSPECTOR_DURABLE_TEXT_CACHE_ROOT"),
        ("worker", "ocr-page-cache", "/ocr-page-cache", "INSPECTOR_DURABLE_OCR_CACHE_ROOT"),
    ):
        expect_field(environment(services[name], name), key, target, name)
        require_cache_volume(services[name], name, source, target)
    expect_field(environment(services["worker"], "worker"), "OCR_LAYOUT_PROFILE_ID",
                 "ocr-paddle-3.7.0-ru-en-server-v1", "worker")

    qwen = services["qwen-vlm-server"]
    for option, expected in (
        ("--model", VLM_DIRECTORY),
        ("--served-model-name", VLM_MODEL),
        ("--tensor-parallel-size", "1"),
        ("--port", "8000"),
    ):
        if command_option(qwen.get("command"), option) != expected:
            fail(f"qwen-vlm-server {option} does not match competition profile")
    qwen_networks = qwen.get("networks")
    worker_network = extract.get("networks", {})
    if not isinstance(qwen_networks, dict) or not isinstance(worker_network, dict):
        fail("VLM provider-runtime routing does not match competition profile")
    qwen_network = qwen_networks.get("provider-runtime")
    aliases = qwen_network.get("aliases") if isinstance(qwen_network, dict) else None
    if not isinstance(aliases, list) or "vlm" not in aliases or "provider-runtime" not in worker_network:
        fail("VLM provider-runtime routing does not match competition profile")
    model_init = environment(services["hf-model-init-server"], "hf-model-init-server")
    expect_field(model_init, "MODEL_STORE_LOCK", "/opt/model-store/locks/server.json", "hf-model-init-server")

    selected_gpu = selectors["SERVER_GPU_DEVICE"]
    actual_gpu_services: set[str] = set()
    for name, service in services.items():
        if not isinstance(service, dict):
            fail("Docker Compose service is malformed")
        deploy = service.get("deploy") or {}
        if not isinstance(deploy, dict):
            fail("Docker Compose GPU reservation is malformed")
        resources = deploy.get("resources") or {}
        if not isinstance(resources, dict):
            fail("Docker Compose GPU reservation is malformed")
        reservations = resources.get("reservations") or {}
        if not isinstance(reservations, dict):
            fail("Docker Compose GPU reservation is malformed")
        deploy_devices = reservations.get("devices") or []
        if service.get("runtime") == "nvidia" or service.get("gpus") or deploy_devices:
            actual_gpu_services.add(name)
            if service.get("runtime") != "nvidia" or service.get("gpus") or deploy_devices:
                fail(f"{name} GPU allocation is not the expected single-device runtime")
            gpu_env = environment(service, name)
            expect_field(gpu_env, "NVIDIA_VISIBLE_DEVICES", selected_gpu, name)
            if name != "gpu-admission-server":
                expect_field(gpu_env, "CUDA_VISIBLE_DEVICES", "0", name)
    if actual_gpu_services != GPU_SERVICES:
        fail("Compose GPU service set does not match competition profile")
    admission = environment(services["gpu-admission-server"], "gpu-admission-server")
    expect_field(admission, "GPU_DEVICE", selected_gpu, "gpu-admission-server")


def validate_lock(lock_path: Path) -> None:
    try:
        digest = hashlib.sha256(lock_path.read_bytes()).hexdigest()
    except OSError:
        fail("server model lock is unavailable")
    if digest != SERVER_LOCK_SHA256:
        fail("server model lock hash differs from the V6 release")


def compose_prefix(env_file: Path) -> list[str]:
    return [
        "docker", "compose",
        "--env-file", str(env_file),
        "--project-name", "inspector-ai-server",
        "-f", str(ROOT / "infra/docker-compose.yml"),
        "-f", str(ROOT / "infra/docker-compose.server.yml"),
        "--profile", "server",
    ]


def run_checked(command: list[str], *, timeout: int) -> str:
    try:
        completed = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        fail("Docker Compose command is unavailable or timed out")
    if completed.returncode:
        fail("Docker Compose command failed; inspect Docker locally without sharing secrets")
    return completed.stdout


def validate_visible_gpus(output: str, service: str) -> None:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) != 1 or not re.fullmatch(r"GPU-[A-Za-z0-9-]+", lines[0]):
        fail(f"{service} does not see exactly one NVIDIA GPU at runtime")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(os.environ.get("INSPECTOR_ENV_FILE", ROOT / "infra/.env.server")))
    parser.add_argument("--running", action="store_true", help="also query visible GPUs inside running GPU providers")
    args = parser.parse_args(argv)
    try:
        env_file = args.env_file.resolve()
        if not env_file.is_file():
            fail("server env file is missing; run ./infra/stack.sh server init first")
        selectors = parse_env(env_file.read_text(encoding="utf-8"))
        validate_lock(ROOT / "services/model-store/locks/server.json")
        compose = compose_prefix(env_file)
        try:
            config = json.loads(run_checked(compose + ["config", "--format", "json"], timeout=30))
        except (json.JSONDecodeError, UnicodeError):
            fail("Docker Compose returned invalid config JSON")
        validate_config(config, selectors)
        if args.running:
            for service in RUNNING_GPU_SERVICES:
                output = run_checked(
                    compose + ["exec", "-T", service, "nvidia-smi", "--query-gpu=uuid", "--format=csv,noheader"],
                    timeout=30,
                )
                validate_visible_gpus(output, service)
    except (OSError, UnicodeError):
        print("competition profile: FAIL: env file is unreadable", file=sys.stderr)
        return 1
    except ProfileError as error:
        print(f"competition profile: FAIL: {error}", file=sys.stderr)
        return 1
    print("competition profile: PASS (resolved server profiles, VLM routing/model, cache routing, single-GPU selection"
          + (", runtime visibility" if args.running else "") + ")")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
