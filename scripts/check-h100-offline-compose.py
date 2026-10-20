#!/usr/bin/env python3
"""Resolve actual Compose without starting Docker resources or exposing secrets."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1]/"output/h100-offline-compose")
args = parser.parse_args()
ROOT = args.root.resolve()
OUT = args.output_dir.resolve(); OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("competition_guard", ROOT/"infra/check-competition-profile.py")
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)
original = (ROOT/"infra/server.env.example").read_text()
results = []
source_audit_resources = []
def verify_source_audit_overlay(compose, env, resolved, label):
    merged = json.loads(subprocess.check_output(compose + ["-f", str(ROOT/"infra/docker-compose.source-audit-v4.yml"), "config", "--format", "json"], cwd=ROOT, env=env, text=True, stderr=subprocess.DEVNULL))
    assert int(merged["services"]["api"]["mem_limit"]) == 2 * 1024**3
    assert merged["services"]["api"]["environment"]["NODE_OPTIONS"] == "--max-old-space-size=768"
    assert int(merged["services"]["document-worker"]["mem_limit"]) == 3 * 1024**3
    # All routing, profiles, providers and unrelated services remain exact.
    for service, field in (("api", "mem_limit"), ("document-worker", "mem_limit")):
        if field in resolved["services"][service]:
            merged["services"][service][field] = resolved["services"][service][field]
        else:
            merged["services"][service].pop(field, None)
    old_env = resolved["services"]["api"].get("environment", {})
    if "NODE_OPTIONS" in old_env:
        merged["services"]["api"]["environment"]["NODE_OPTIONS"] = old_env["NODE_OPTIONS"]
    else:
        merged["services"]["api"]["environment"].pop("NODE_OPTIONS", None)
    assert merged == resolved, "Unexpected non-resource change in V4 overlay: " + label
    source_audit_resources.append({"case":label,"status":"PASS","apiMemoryBytes":2*1024**3,"apiNodeHeapMiB":768,"documentWorkerMemoryBytes":3*1024**3,"otherConfigByteSemanticExact":True})
for mode, analysis, visual, expected in (("SAMPLE", "MATRIX_V1", "V9_SAMPLE", 0),
                                        ("FULL", "MATRIX_V1", "V9_FULL", 0),
                                        ("SAMPLE", "SCAFFOLD", "V9_SAMPLE", 1),
                                        ("SAMPLE", "MATRIX_V1", "V6", 1),
                                        ("FULL", "MATRIX_V1", "V9_SAMPLE", 1)):
    required = guard.REQUIRED_PROFILES | {"SERVER_GPU_DEVICE": "0", "INSPECTOR_ANALYSIS_PROFILE": analysis, "INSPECTOR_VISUAL_PROFILE": visual}
    lines = [line for line in original.splitlines() if line.partition("=")[0] not in required]
    lines.extend(f"{k}={v}" for k, v in required.items())
    label = f"{analysis.lower()}-{visual.lower()}-{mode.lower()}"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".h100-offline.env", delete=False) as temporary:
        temporary.write("\n".join(lines)+"\n"); env_path = Path(temporary.name)
    try:
        os.chmod(env_path, 0o600)
        child_env = {k: v for k, v in os.environ.items() if k not in required}
        command = ["python3", "infra/h100-readiness.py", "--matrix-v13", "--visual-mode", mode, "--env-file", str(env_path),
                   "--receipt", str(OUT/f"config-{label}.json")]
        result = subprocess.run(command, cwd=ROOT, env=child_env, text=True, capture_output=True, timeout=40)
        (OUT/f"config-{label}.log").write_text(result.stdout+result.stderr)
        assert result.returncode == expected, label
        receipt = json.loads((OUT/f"config-{label}.json").read_text())
        assert receipt["runtimeExecuted"] is False
        results.append({"case": label, "exitCode": result.returncode, "expectedExitCode": expected, "status": "PASS"})
        if expected == 0:
            compose = guard.compose_prefix(env_path) + ["-f", str(ROOT/"infra/docker-compose.matrix-v13.yml"), "-f", str(ROOT/"infra/docker-compose.h100-feedback.yml")]
            resolved = json.loads(subprocess.check_output(compose+["config", "--format", "json"], cwd=ROOT, env=child_env, text=True, stderr=subprocess.DEVNULL))
            health=resolved["services"]["rabbitmq"]["healthcheck"]
            assert health["test"] == ["CMD", "su-exec", "rabbitmq", "rabbitmq-diagnostics", "-q", "ping"], health
            assert health["timeout"] == "15s" and health["interval"] == "10s" and health["start_period"] == "20s" and health["retries"] == 10, health
            verify_source_audit_overlay(compose, child_env, resolved, "h100-" + mode.lower())
            # Do not retain the full config: it contains interpolated credentials.
            (OUT/f"resolved-resources-{mode.lower()}.json").write_text(json.dumps({name: {
                "build": service.get("build"), "mem_limit": service.get("mem_limit"), "shm_size": service.get("shm_size"),
                "runtime": service.get("runtime"), "ports": service.get("ports"), "networkNames": list(service.get("networks", {})),
                "depends_on": service.get("depends_on"), "healthcheck": service.get("healthcheck")}
                for name, service in resolved["services"].items()}, indent=2)+"\n")
    finally:
        env_path.unlink()
with tempfile.NamedTemporaryFile(mode="w", suffix=".cpu-offline.env") as temporary:
    temporary.write((ROOT/"infra/laptop.env.example").read_text()); temporary.flush()
    os.chmod(temporary.name, 0o600)
    compose = ["docker", "compose", "--project-name", "inspector-source-v4-offline", "--env-file", temporary.name,
        "-f", str(ROOT/"infra/docker-compose.yml"), "-f", str(ROOT/"infra/docker-compose.core-smoke.yml"), "-f", str(ROOT/"infra/docker-compose.matrix-v13.yml")]
    cpu_env = {k:v for k,v in os.environ.items() if k not in guard.REQUIRED_PROFILES and not k.startswith(("INSPECTOR_", "SERVER_", "LAPTOP_"))}
    resolved = json.loads(subprocess.check_output(compose+["config", "--format", "json"], cwd=ROOT, env=cpu_env, text=True, stderr=subprocess.DEVNULL))
    verify_source_audit_overlay(compose, cpu_env, resolved, "cpu-v13")
(OUT/"offline-compose-summary.json").write_text(json.dumps({"status": "PASS", "runtimeExecuted": False, "cases": results,"sourceAuditResourceOverlays":source_audit_resources}, indent=2)+"\n")
print(json.dumps({"status": "PASS", "cases": len(results), "sourceAuditResourceCases":len(source_audit_resources),"runtimeExecuted": False}))
