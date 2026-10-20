#!/usr/bin/env python3
"""Disposable homeserver Docker test: API DNS replacement without restarting Nginx."""
from __future__ import annotations

import argparse
import base64
import inspect
import json
from pathlib import Path
import subprocess
import sys


def run_worker(settings: dict) -> None:
    import base64
    import hashlib
    import json
    from pathlib import Path
    import signal
    import subprocess
    import tempfile
    import time
    import urllib.error
    import urllib.request
    import uuid

    owner = "inspector-dns-smoke-" + uuid.uuid4().hex[:12]
    label = "inspector.dns-smoke.owner"
    network, old, new, holder, web = [owner + suffix for suffix in ["-net", "-old", "-new", "-holder", "-web"]]
    names = [web, new, holder, old]
    report = {"schemaVersion": "web-upstream-dns-smoke-v1", "owner": owner,
              "expectation": settings["expectation"], "configSha256": hashlib.sha256(base64.b64decode(settings["config"])).hexdigest(),
              "status": "FAILED", "cleanupComplete": False}
    command_count = 0
    image_ids = {}

    def docker(*args, timeout=12, required=True):
        nonlocal command_count
        command_count += 1
        result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
        if required and result.returncode:
            raise RuntimeError("Docker operation failed: " + " ".join(args[:2]) + " (exit " + str(result.returncode) + ")")
        return result

    def container(name):
        result = docker("inspect", "--format", '{{json .State}}|{{json .NetworkSettings.Networks}}|{{json .Config.Labels}}', name, required=False)
        if result.returncode:
            return None
        state, networks, labels = [json.loads(part) for part in result.stdout.strip().split("|")]
        return {"state": state, "networks": networks, "labels": labels}

    def identity():
        value = container(web)
        if not value or not value["state"]["Running"]:
            raise RuntimeError("Disposable Nginx stopped unexpectedly")
        nginx_pid = docker("exec", web, "cat", "/var/run/nginx.pid").stdout.strip()
        return {"hostPid": value["state"]["Pid"], "startedAt": value["state"]["StartedAt"], "nginxMasterPid": nginx_pid}

    echo = r"""const http=require('node:http'),crypto=require('node:crypto');
const backend=process.argv[1];http.createServer((req,res)=>{const chunks=[];
req.on('data',b=>chunks.push(b));req.on('end',()=>{const body=Buffer.concat(chunks);
res.writeHead(200,{'Content-Type':'application/json','Connection':'close'});
res.end(JSON.stringify({backend,method:req.method,url:req.url,host:req.headers.host,
bodyBytes:body.length,bodySha256:crypto.createHash('sha256').update(body).digest('hex')}));});}).listen(4100,'0.0.0.0');"""
    body = bytes(range(256)) * 19 + "проверка\r\nbinary\x00".encode()
    paths = {"GET": "/api/dns-smoke/echo?x=1&x=2&blank=&utf=%D1%8F&plus=a+b",
             "POST": "/api/dns-smoke/upload?percent=%2F%25&repeat=a&repeat=b&empty="}
    base = ""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(method, backend=None):
        payload = body if method == "POST" else None
        req = urllib.request.Request(base + paths[method], data=payload, method=method,
                                     headers={"Host": "dns-smoke.invalid", "Content-Type": "application/octet-stream"})
        try:
            with opener.open(req, timeout=1) as response:
                status, data = response.status, response.read(16384)
        except urllib.error.HTTPError as error:
            return error.code, False
        except (urllib.error.URLError, TimeoutError, OSError):
            return 0, False
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError):
            return status, False
        expected = {"backend": backend, "method": method, "url": paths[method], "host": "dns-smoke.invalid",
                    "bodyBytes": len(payload or b""), "bodySha256": hashlib.sha256(payload or b"").hexdigest()}
        return status, value == expected

    def launch(name, generation):
        docker("run", "--detach", "--pull=never", "--name", name, "--label", label + "=" + owner,
               "--network", network, "--network-alias", "api", "--memory", "128m", "--cpus", "0.25",
               "--entrypoint", "node", image_ids["apiImage"], "-e", echo, generation)

    temporary = tempfile.TemporaryDirectory(prefix=owner + "-")
    try:
        def interrupt(signum, frame):
            raise RuntimeError("Disposable runner interrupted or exceeded 120-second work budget")
        for signum in [signal.SIGALRM, signal.SIGTERM, signal.SIGHUP]:
            signal.signal(signum, interrupt)
        signal.alarm(120)
        for key in ["apiImage", "webImage"]:
            image_id = docker("image", "inspect", "--format", "{{.Id}}", settings[key]).stdout.strip()
            image_ids[key] = image_id
            report[key + "Id"] = image_id
        config = Path(temporary.name) / "default.conf"
        config.write_bytes(base64.b64decode(settings["config"]))
        docker("network", "create", "--label", label + "=" + owner, network)
        launch(old, "old")
        old_ip = container(old)["networks"][network]["IPAddress"]
        docker("run", "--detach", "--pull=never", "--name", web, "--label", label + "=" + owner,
               "--network", network, "--publish", "127.0.0.1::80", "--memory", "96m", "--cpus", "0.5",
               "--mount", "type=bind,src=" + str(config) + ",dst=/etc/nginx/conf.d/default.conf,readonly",
               image_ids["webImage"])
        binding = docker("port", web, "80/tcp").stdout.strip()
        if not binding.startswith("127.0.0.1:") or not binding[10:].isdigit():
            raise RuntimeError("Unexpected disposable web port binding")
        base = "http://" + binding
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if request("GET", "old") == (200, True):
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("Initial GET semantics unavailable within 20 seconds")
        if request("POST", "old") != (200, True):
            raise RuntimeError("Initial POST byte/query/Host semantics differ")
        initial = identity()
        report["initialMethods"] = ["GET", "POST"]
        report["postBodyBytes"] = len(body)
        report["postBodySha256"] = hashlib.sha256(body).hexdigest()
        report["nginxVersion"] = docker("exec", web, "nginx", "-v").stderr.strip()
        docker("rm", "--force", old)
        # Occupy the former address without a listening server. Docker cannot recycle it for NEW API.
        docker("run", "--detach", "--pull=never", "--name", holder, "--label", label + "=" + owner,
               "--network", network, "--ip", old_ip, "--memory", "64m", "--cpus", "0.1",
               "--entrypoint", "node", image_ids["apiImage"], "-e", "setInterval(()=>{},1000)")
        launch(new, "new")
        new_ip = container(new)["networks"][network]["IPAddress"]
        if not old_ip or not new_ip or old_ip == new_ip:
            raise RuntimeError("Backend replacement did not produce distinct IPs")
        started, statuses, recovered = time.monotonic(), [], None
        deadline = started + 20
        while time.monotonic() < deadline:
            status, valid = request("GET", "new")
            statuses.append(status)
            if valid and status == 200:
                recovered = round(time.monotonic() - started, 3)
                break
            time.sleep(min(0.4, max(0, deadline - time.monotonic())))
        final = identity()
        if initial != final:
            raise RuntimeError("Nginx container/start/master identity changed")
        report.update({"backendIpChanged": True, "oldIp": old_ip, "newIp": new_ip,
                       "nginxIdentityUnchanged": True, "nginxIdentity": final,
                       "observedStatuses": sorted(set(statuses)), "pollCount": len(statuses),
                       "recoverySeconds": recovered, "observationSeconds": round(time.monotonic() - started, 3)})
        if settings["expectation"] == "recovery":
            if recovered is None or recovered > 20:
                raise RuntimeError("Nginx failed to recover within 20 seconds")
            if request("POST", "new") != (200, True):
                raise RuntimeError("Recovered POST byte/query/Host semantics differ")
            report["recoveredMethods"] = ["GET", "POST"]
        elif recovered is not None or 502 not in statuses:
            raise RuntimeError("Expected stale static upstream with HTTP 502 for full observation window")
        report["status"] = "PASS"
    except Exception as error:
        report["error"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        signal.alarm(0)
        cleanup_errors = []
        for name in names:
            try:
                value = container(name)
                if value and value["labels"].get(label) == owner:
                    docker("rm", "--force", name)
            except Exception:
                cleanup_errors.append("container:" + name)
        try:
            result = docker("network", "inspect", "--format", "{{json .Labels}}", network, required=False)
            if result.returncode == 0 and json.loads(result.stdout).get(label) == owner:
                docker("network", "rm", network)
        except Exception:
            cleanup_errors.append("network:" + network)
        try:
            containers_left = docker("ps", "--all", "--filter", "label=" + label + "=" + owner, "--format", "{{.Names}}").stdout.strip()
            networks_left = docker("network", "ls", "--filter", "label=" + label + "=" + owner, "--format", "{{.Name}}").stdout.strip()
            report["cleanupComplete"] = not cleanup_errors and not containers_left and not networks_left
        except Exception:
            report["cleanupComplete"] = False
        temporary.cleanup()
        if not report["cleanupComplete"]:
            report["status"] = "FAILED"
            report["cleanupErrors"] = cleanup_errors or ["Owned Docker resources remain or cleanup verification failed"]
        report["dockerCommandCount"] = command_count
        print(json.dumps(report, sort_keys=True), flush=True)
    raise SystemExit(0 if report["status"] == "PASS" else 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-host", choices=["homeserver"], default="homeserver")
    parser.add_argument("--config", type=Path, required=True, help="Local Nginx conf.d server/upstream config to mount")
    parser.add_argument("--api-image", default="inspector-feedback-20261017-api:latest")
    parser.add_argument("--web-image", default="inspector-feedback-20261017-web:latest")
    expectation = parser.add_mutually_exclusive_group(required=True)
    expectation.add_argument("--expect-recovery", action="store_true")
    expectation.add_argument("--expect-stale", action="store_true")
    args = parser.parse_args()
    raw = args.config.read_bytes()
    if not raw or len(raw) > 131072:
        parser.error("Config must contain 1..131072 bytes")
    settings = {"config": base64.b64encode(raw).decode("ascii"), "apiImage": args.api_image,
                "webImage": args.web_image, "expectation": "recovery" if args.expect_recovery else "stale"}
    remote = inspect.getsource(run_worker) + "\nrun_worker(" + repr(settings) + ")\n"
    try:
        result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=10",
                                 "-o", "ServerAliveCountMax=3", args.ssh_host, "python3", "-"], input=remote,
                                capture_output=True, text=True, timeout=240)
    except (subprocess.TimeoutExpired, OSError) as error:
        print(json.dumps({"status": "FAILED", "error": type(error).__name__, "cleanupComplete": False}))
        raise SystemExit(1)
    try:
        report = json.loads(result.stdout)
    except ValueError:
        print(json.dumps({"status": "FAILED", "error": "Remote runner returned no valid receipt", "cleanupComplete": False}))
        raise SystemExit(1)
    print(json.dumps(report, sort_keys=True))
    raise SystemExit(0 if result.returncode == 0 and report.get("status") == "PASS" else 1)


if __name__ == "__main__":
    main()
