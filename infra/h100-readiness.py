#!/usr/bin/env python3
"""H100-only checks. Never starts containers, downloads models or publishes jobs."""
from __future__ import annotations

import argparse
import ast
import base64
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import socket
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("competition_guard", ROOT / "infra/check-competition-profile.py")
guard = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(guard)
PROFILE = "ocr-paddle-3.7.0-ru-en-server-v1"
EMBEDDING = "inspector-qwen3-embedding-0.6b"
PROVIDERS = ("document-ai-server", "qwen-vlm-server", "embedding-server")
QUEUES = {"rules.evaluate", "documents.render", "documents.extract", "documents.link"}


class ReadinessError(Exception):
    pass


def require(condition: bool, check: str) -> None:
    if not condition:
        raise ReadinessError(check)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str], *, stdin: str | None = None, timeout: int = 30) -> str:
    try:
        result = subprocess.run(command, input=stdin, capture_output=True, text=True,
                                timeout=timeout, check=False, cwd=ROOT)
    except (OSError, subprocess.TimeoutExpired):
        raise ReadinessError("local command unavailable or timed out") from None
    require(result.returncode == 0, "local command failed; inspect locally without sharing credentials")
    return result.stdout


def identity(hostname: str | None, gpu_uuid: str | None, manifest_sha: str | None) -> None:
    require(bool(hostname) and hostname == socket.gethostname(), "expected hostname is required and must match this host")
    require(bool(gpu_uuid and re.fullmatch(r"GPU-[A-Za-z0-9-]+", gpu_uuid)), "exact assigned GPU UUID is required")
    require(bool(manifest_sha and re.fullmatch(r"[a-f0-9]{64}", manifest_sha)), "approved Paddle manifest SHA256 is required")


def nvidia(output: str, expected_uuid: str) -> dict:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    require(len(lines) == 1, "GPU provider must see exactly one physical GPU")
    fields = [part.strip() for part in lines[0].split(",")]
    require(len(fields) == 4, "NVIDIA identity response malformed")
    name, uuid, memory, compute = fields
    require(bool(re.fullmatch(r"NVIDIA H100(?: .*)?", name)), "assigned GPU must be NVIDIA H100")
    require(uuid == expected_uuid, "provider GPU UUID differs from assigned GPU")
    try:
        require(int(memory) >= 78000, "H100 must expose at least 78000 MiB")
    except ValueError:
        raise ReadinessError("GPU memory response malformed") from None
    require(compute == "9.0", "H100 compute capability must be 9.0")
    return {"name": name, "uuid": uuid, "memoryMiB": int(memory), "computeCapability": compute}


def torch_result(data: dict) -> None:
    require(data.get("available") is True and data.get("count") == 1, "torch CUDA must expose exactly one device")
    require(bool(re.fullmatch(r"NVIDIA H100(?: .*)?", str(data.get("name")))), "torch device must be H100")
    require(data.get("capability") == [9, 0], "torch compute capability must be 9.0")
    require(data.get("kernelValue") == 16.0, "torch BF16 CUDA matrix multiply failed")


def validate_config(config: dict, selectors: dict, matrix: bool, visual_mode: str = "SAMPLE") -> None:
    # The existing guard owns routing/cache/single-GPU gates for the legacy PILOT.
    # Check MATRIX selection independently before applying those same routing gates.
    api = config.get("services", {}).get("api", {}).get("environment", {})
    expected = "MATRIX_V1" if matrix else "PILOT_PZ002_PZ017"
    require(api.get("INSPECTOR_ANALYSIS_PROFILE") == expected, "resolved analysis profile differs from explicit selection")
    if matrix:
        require(api.get("INSPECTOR_MATRIX_CONCRETE_WALLS_V13") == "1", "MATRIX V13 release flag must be explicit")
        require(api.get("INSPECTOR_VISUAL_PROFILE") == f"V9_{visual_mode}", "H100 feedback profile must explicitly select requested SAMPLE/FULL mode")
        for key in ("INSPECTOR_MATRIX_VISUAL_PROPOSALS", "INSPECTOR_MATRIX_OCR_LAYOUT"):
            require(api.get(key) == "1", "H100 feedback visual/OCR execution must be explicit")
    routing = copy.deepcopy(config)
    routing["services"]["api"]["environment"]["INSPECTOR_ANALYSIS_PROFILE"] = "PILOT_PZ002_PZ017"
    routing["services"]["api"]["environment"]["INSPECTOR_VISUAL_PROFILE"] = "V6"
    guard.validate_config(routing, selectors)
    services = config["services"]
    require(config.get("networks", {}).get("provider-runtime", {}).get("internal") is True,
            "provider-runtime network must be internal")
    for name in PROVIDERS:
        service = services.get(name, {})
        require(set(service.get("networks", {})) == {"provider-runtime"}, "inference provider must have only internal runtime network")
        model_mounts = [v for v in service.get("volumes", []) if v.get("target") == "/models"]
        require(len(model_mounts) == 1 and model_mounts[0].get("read_only") is True,
                "inference model cache must be mounted read-only")
    for name in ("qwen-vlm-server", "embedding-server"):
        env = services[name].get("environment", {})
        require(env.get("HF_HUB_OFFLINE") == "1" and env.get("TRANSFORMERS_OFFLINE") == "1",
                "inference model access must remain offline")
    require(services["embedding-server"].get("environment", {}).get("TEXT_RUNTIME_DEVICE") == "cpu",
            "embedding provider must use CPU in the one-H100 profile")
    for name in ("worker", "document-worker", "extract-worker"):
        require(services[name].get("environment", {}).get("DOCUMENT_PROVIDER_BASE_URL") == "http://document-ai:8080",
                "document provider endpoint must remain internal")
    link = services.get("link-worker", {}).get("environment", {})
    require(link.get("EMBEDDING_BASE_URL") == "http://embedding:8080/v1", "embedding endpoint must remain internal")
    for option, value in (("--max-model-len", "8192"), ("--max-num-seqs", "2"), ("--gpu-memory-utilization", "0.35")):
        require(guard.command_option(services["qwen-vlm-server"].get("command"), option) == value,
                "VLM H100 memory/context budget differs from reviewed profile")


def profile_contract(selector: str) -> dict:
    """Read literal immutable profiles without importing PDF/model runtimes."""
    # Prompt digest is computed, but irrelevant to this static model/scope gate.
    constants = {"PROMPT_SHA256": None}
    def literal(node):
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.Name): return constants[node.id]
        if isinstance(node, (ast.List, ast.Tuple)): return [literal(v) for v in node.elts]
        if isinstance(node, ast.Dict):
            result = {}
            for key, value in zip(node.keys, node.values):
                if key is None: result.update(literal(value))
                else: result[literal(key)] = literal(value)
            return result
        raise ValueError("nonliteral")
    for name in ("visual_vlm.py", "visual_proposal_adapter.py"):
        tree = ast.parse((ROOT / "services/worker/inspector_worker" / name).read_text())
        for node in tree.body:
            if isinstance(node, ast.Assign):
                try: value = literal(node.value)
                except (ValueError, KeyError): continue
                for target in node.targets:
                    if isinstance(target, ast.Name): constants[target.id] = value
    profile = constants.get("PROFILE_" + selector)
    require(isinstance(profile, dict), "selected immutable visual profile is missing from worker source")
    require(profile.get("vlmModelId") == guard.VLM_MODEL,
            "selected immutable visual profile pins 4B provider; H100 serves pinned 8B provider (new server feedback release required)")
    require(profile.get("vlmCropMaxEdgePx") == 2048 and profile.get("contextMethodId") == "metadata-outline-page-signals-v2",
            "H100 feedback release must preserve 2048px crops and all-page context v2")
    mode = selector.rsplit("_", 1)[-1]
    require(profile.get("schemaVersion") == "visual-proposal-profile-v9" and profile.get("analysisMode") == mode and
            profile.get("vlmCropMethodId") == "normalized-display-square-v2" and
            profile.get("vlmModelLockSha256") == guard.SERVER_LOCK_SHA256 and
            profile.get("vlmModelRevision") == "9cdc6310a8cb770ce18efaf4e9935334512aee45",
            "H100 visual model/crop release pins differ from reviewed V9 contract")
    require(profile.get("vlmMethodId") == ("all-saved-proposals-server-nonnegative-v1" if mode == "FULL" else "spread-two-saved-proposals-server-nonnegative-v1"),
            "H100 visual method must preserve server nonnegative semantics")
    return profile


def validate_queues(data: list) -> None:
    require(isinstance(data, list), "queue diagnostics malformed")
    rows = {row.get("name"): row for row in data if isinstance(row, dict)}
    require(QUEUES <= set(rows), "required worker queues missing")
    require(all(isinstance(rows[q].get("consumers"), int) and rows[q]["consumers"] >= 1 for q in QUEUES),
            "required queue has no consumer")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ReadinessError("local health/inference endpoint redirected")


def http(port: int, path: str, payload: bytes | dict | None = None, content_type: str = "application/json") -> bytes:
    require(1 <= port <= 65535 and path.startswith("/") and not path.startswith("//"), "invalid localhost endpoint")
    body = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", body,
                                     {"Content-Type": content_type} if body is not None else {})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=90) as response:
            result = response.read(4 * 1024 * 1024 + 1)
    except ReadinessError:
        raise
    except Exception:
        raise ReadinessError("localhost health/inference request failed") from None
    require(len(result) <= 4 * 1024 * 1024, "localhost response exceeded bounded limit")
    return result


def multipart(fields: dict, filename: str, data: bytes, mime: str) -> tuple[bytes, str]:
    boundary = "inspector-h100-bounded-smoke-v1"
    chunks = []
    for key, value in fields.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def smoke_pdf() -> bytes:
    stream = b"BT /F1 18 Tf 24 45 Td (SMOKE 123) Tj ET\n"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream"]
    out = bytearray(b"%PDF-1.4\n"); offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out)); out.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(out); out.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(out)


def validate_inference(vlm: dict, embedding: dict) -> None:
    require(vlm.get("model") == guard.VLM_MODEL, "VLM response model differs from pinned alias")
    require(bool(vlm.get("choices", [{}])[0].get("message", {}).get("content")), "VLM response has no content")
    require(embedding.get("model") == EMBEDDING, "embedding response model differs from pinned alias")
    vector = embedding.get("data", [{}])[0].get("embedding", [])
    require(len(vector) == 1024 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in vector),
            "embedding must contain 1024 finite numbers")


def runtime(compose: list[str], args, receipt: dict) -> None:
    def execute(service: str, *command: str, stdin=None, timeout=30):
        return run(compose + ["exec", "-T", service, *command], stdin=stdin, timeout=timeout)
    for name in ("document-ai-server", "qwen-vlm-server"):
        gpu = nvidia(execute(name, "nvidia-smi", "--query-gpu=name,uuid,memory.total,compute_cap", "--format=csv,noheader,nounits"), args.expected_gpu_uuid)
        receipt.setdefault("gpuProviders", {})[name] = gpu
    kernel = '''import json, torch
d={"available":torch.cuda.is_available(),"count":torch.cuda.device_count()}
assert d["available"] and d["count"]==1
d.update(name=torch.cuda.get_device_name(0),capability=list(torch.cuda.get_device_capability(0)))
x=torch.ones((16,16),device="cuda",dtype=torch.bfloat16); y=x@x; torch.cuda.synchronize()
d["kernelValue"]=y[0,0].item(); print(json.dumps(d))'''
    torch_result(json.loads(execute("qwen-vlm-server", "python", "-c", kernel, timeout=60)))
    receipt["torchCudaKernel"] = "PASS"
    paddle_kernel = '''import paddle
assert paddle.is_compiled_with_cuda() and paddle.device.cuda.device_count()==1
paddle.set_device('gpu:0'); x=paddle.ones([16,16],dtype='float32'); y=paddle.matmul(x,x)
assert float(y.numpy()[0,0])==16.0
print('VERIFIED')'''
    require(execute("document-ai-server", "python", "-c", paddle_kernel, timeout=60).strip() == "VERIFIED",
            "Paddle CUDA matrix multiply failed")
    receipt["paddleCudaKernel"] = "PASS"
    # Hash models through existing containers only: no run/up or provision action.
    model_check = '''import hashlib,json,pathlib,sys
lock=json.loads(sys.stdin.read()); root=pathlib.Path('/models')
for model in lock['models']:
 p=root/model['localDirectory']; assert not p.is_symlink()
 expected={a['filename'] for a in model['artifacts']}
 assert {str(f.relative_to(p)) for f in p.rglob('*') if f.is_file()}==expected
 for a in model['artifacts']:
  f=p/a['filename']; assert not any(x.is_symlink() for x in [f,*f.parents]); assert f.stat().st_size==a['size']
  h=hashlib.sha256()
  with f.open('rb') as source:
   for block in iter(lambda:source.read(8*1024*1024),b''): h.update(block)
  assert h.hexdigest()==a['sha256']
print('VERIFIED')'''
    require(execute("qwen-vlm-server", "python", "-c", model_check,
                    stdin=(ROOT / "services/model-store/locks/server.json").read_text(), timeout=600).strip() == "VERIFIED",
            "pinned Qwen cache verification failed")
    paddle_check = '''import hashlib,pathlib,sys
from provision import verify_manifest
p=pathlib.Path('/models/paddlex'); f=p/'.ready-ocr-paddle-3.7.0-ru-en-server-v1.json'
assert hashlib.sha256(f.read_bytes()).hexdigest()==sys.argv[1]
assert verify_manifest(p,pathlib.Path('/opt/document-ai/profiles/server.json'),'ocr-paddle-3.7.0-ru-en-server-v1',f)
print('VERIFIED')'''
    require(execute("document-ai-server", "python", "-c", paddle_check, args.paddle_manifest_sha256, timeout=600).strip() == "VERIFIED",
            "approved Paddle cache verification failed")
    receipt["modelCacheHashes"] = "PASS"
    for name in PROVIDERS:
        cid = run(compose + ["ps", "-q", name]).strip()
        require(bool(re.fullmatch(r"[a-f0-9]{12,64}", cid)), "provider is not running")
        info = json.loads(run(["docker", "inspect", cid]))[0]
        networks = info.get("NetworkSettings", {}).get("Networks", {})
        require(len(networks) == 1, "runtime provider has extra networks")
        net = json.loads(run(["docker", "network", "inspect", next(iter(networks))]))[0]
        require(net.get("Internal") is True, "runtime provider network allows egress")
        mounts = [m for m in info.get("Mounts", []) if m.get("Destination") == "/models"]
        require(len(mounts) == 1 and mounts[0].get("RW") is False, "runtime model cache is writable")
        actual_env = dict(item.split("=", 1) for item in info.get("Config", {}).get("Env", []) if "=" in item)
        if name in ("qwen-vlm-server", "embedding-server"):
            require(actual_env.get("HF_HUB_OFFLINE") == "1" and actual_env.get("TRANSFORMERS_OFFLINE") == "1", "running inference container is not offline")
        if name == "qwen-vlm-server":
            command = info.get("Config", {}).get("Cmd")
            for option, expected in (("--model", guard.VLM_DIRECTORY), ("--served-model-name", guard.VLM_MODEL),
                                     ("--max-model-len", "8192"), ("--max-num-seqs", "2"), ("--gpu-memory-utilization", "0.35")):
                require(guard.command_option(command, option) == expected, "running VLM arguments differ from reviewed profile")
        elif name == "embedding-server":
            require(actual_env.get("TEXT_RUNTIME_MODEL_PATH") == "/models/qwen3-embedding-0.6b" and
                    actual_env.get("TEXT_RUNTIME_MODEL_ALIAS") == EMBEDDING and actual_env.get("TEXT_RUNTIME_DEVICE") == "cpu",
                    "running embedding configuration differs from reviewed profile")
        else:
            require(actual_env.get("DOCUMENT_AI_PROFILE") == "/opt/document-ai/profiles/server.json",
                    "running document profile path differs from reviewed profile")
        receipt.setdefault("providerImageIds", {})[name] = info.get("Image")
    http(args.api_port, "/api/health"); http(args.web_port, "/")
    doc = json.loads(http(args.document_port, "/health"))
    require(doc.get("status") == "ok" and doc.get("profileId") == PROFILE and doc.get("device") == "gpu:0", "document health/profile/device mismatch")
    emb = json.loads(http(args.embedding_port, "/health"))
    require(emb.get("status") == "ok" and emb.get("model") == EMBEDDING and emb.get("loaded") is True and emb.get("device") == "cpu", "embedding health mismatch")
    http(args.vlm_port, "/health")
    models = json.loads(http(args.vlm_port, "/v1/models"))
    require(guard.VLM_MODEL in {v.get("id") for v in models.get("data", [])}, "VLM served model alias missing")
    execute("rabbitmq", "rabbitmq-diagnostics", "-q", "ping")
    validate_queues(json.loads(execute("rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "consumers", "messages", "--formatter=json")))
    receipt["healthAndQueueConsumers"] = "PASS"
    if args.mode != "inference":
        return
    body, kind = multipart({"page": 1, "dpi": 150}, "smoke.pdf", smoke_pdf(), "application/pdf")
    png = http(args.document_port, "/v1/render", body, kind)
    require(png.startswith(b"\x89PNG\r\n\x1a\n") and len(png) > 100, "render did not produce PNG")
    for script in ("eslav", "latin"):
        body, kind = multipart({"script": script}, "smoke.png", png, "image/png")
        ocr = json.loads(http(args.document_port, "/v1/ocr", body, kind))
        require(ocr.get("schemaVersion") == "document-ai-ocr-response-v1" and ocr.get("profileId") == PROFILE and ocr.get("script") == script and bool(ocr.get("results")), "OCR response malformed or empty")
    vlm = json.loads(http(args.vlm_port, "/v1/chat/completions", {"model": guard.VLM_MODEL, "temperature": 0, "max_tokens": 16,
        "messages": [{"role": "user", "content": [{"type": "text", "text": "Read the short text."}, {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}}]}]}))
    embedding = json.loads(http(args.embedding_port, "/v1/embeddings", {"model": EMBEDDING, "input": "health probe", "dimensions": 1024}))
    validate_inference(vlm, embedding)
    receipt["boundedProviderInference"] = "PASS"
    receipt["smokePngSha256"] = hashlib.sha256(png).hexdigest()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=ROOT / "infra/.env.server")
    parser.add_argument("--mode", choices=("config", "runtime", "inference"), default="config")
    parser.add_argument("--matrix-v13", action="store_true", help="add MATRIX V13 and H100 feedback overlays; requires reviewed source package")
    parser.add_argument("--visual-mode", choices=("SAMPLE", "FULL"), default="SAMPLE")
    parser.add_argument("--expected-hostname"); parser.add_argument("--expected-gpu-uuid")
    parser.add_argument("--paddle-manifest-sha256")
    parser.add_argument("--receipt", type=Path)
    for name, port in (("api", 4100), ("web", 8080), ("document", 8090), ("vlm", 8101), ("embedding", 8102)):
        parser.add_argument(f"--{name}-port", type=int, default=port)
    args = parser.parse_args(argv)
    receipt = {"schemaVersion": "h100-readiness-v1", "mode": args.mode, "runtimeExecuted": False,
               "analysisProfile": "MATRIX_V1/V13" if args.matrix_v13 else "PILOT_PZ002_PZ017", "status": "FAIL",
               "visualProfile": f"V9_{args.visual_mode}" if args.matrix_v13 else "V6", "applicationReleaseQualification": "SEPARATE_REVIEW_REQUIRED"}
    try:
        if args.mode != "config":
            identity(args.expected_hostname, args.expected_gpu_uuid, args.paddle_manifest_sha256)
        env = args.env_file.read_text()
        if args.matrix_v13:
            matches = re.findall(r"^INSPECTOR_ANALYSIS_PROFILE=(.*)$", env, re.M)
            require(matches == ["MATRIX_V1"], "MATRIX env selector must be explicitly set once")
            env = re.sub(r"^INSPECTOR_ANALYSIS_PROFILE=MATRIX_V1$", "INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002_PZ017", env, flags=re.M)
            matches = re.findall(r"^INSPECTOR_VISUAL_PROFILE=(.*)$", env, re.M)
            require(matches == [f"V9_{args.visual_mode}"], "H100 visual env selector must explicitly match requested SAMPLE/FULL mode")
            env = re.sub(r"^INSPECTOR_VISUAL_PROFILE=V9_(?:SAMPLE|FULL)$", "INSPECTOR_VISUAL_PROFILE=V6", env, flags=re.M)
        selectors = guard.parse_env(env)
        guard.validate_lock(ROOT / "services/model-store/locks/server.json")
        compose = guard.compose_prefix(args.env_file.resolve())
        if args.matrix_v13:
            compose += ["-f", str(ROOT / "infra/docker-compose.matrix-v13.yml")]
            compose += ["-f", str(ROOT / "infra/docker-compose.h100-feedback.yml")]
        config = json.loads(run(compose + ["config", "--format", "json"]))
        validate_config(config, selectors, args.matrix_v13, args.visual_mode)
        receipt["resolvedConfig"] = "PASS"
        receipt["serverLockSha256"] = sha(ROOT / "services/model-store/locks/server.json")
        if args.matrix_v13:
            profile_contract(f"V9_{args.visual_mode}")
            receipt["applicationProviderContract"] = "PASS"
        if args.mode != "config":
            receipt["runtimeExecuted"] = True
            runtime(compose, args, receipt)
        receipt["status"] = "PASS"
    except (ReadinessError, guard.ProfileError) as error:
        receipt["failure"] = str(error)
    except Exception:
        receipt["failure"] = "input/runtime response unavailable or malformed; inspect locally without sharing credentials"
    if args.receipt:
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
