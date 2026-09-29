#!/usr/bin/env python3
"""Install three SHA-checked TRAIN_PUBLIC PDF runs for read-only reviewers."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
EXAMPLES = (
    ("F0101", "Публичный пример 1 · Новослободская · ПД", "г. Москва, ул. Новослободская"),
    ("F0142", "Публичный пример 2 · Новослободская · РД", "г. Москва, ул. Новослободская"),
    ("F0147", "Публичный пример 3 · Тюменская · ПД", "г. Москва, ул. Тюменская, д. 5"),
)


def update_env(path: Path, object_ids: list[str]) -> None:
    if not path.is_file():
        raise RuntimeError(f"environment file does not exist: {path}")
    key = "INSPECTOR_PUBLIC_REVIEW_OBJECT_IDS"
    lines = path.read_text(encoding="utf-8").splitlines()
    if sum(bool(re.match(rf"^\s*{key}=", line)) for line in lines) > 1:
        raise RuntimeError(f"duplicate {key} in {path}")
    lines = [line for line in lines if not re.match(rf"^\s*{key}=", line)]
    lines.append(f"{key}={','.join(object_ids)}")
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:24100")
    parser.add_argument("--credentials-file", type=Path,
                        help="legacy password-based deployment only")
    parser.add_argument("--pdf-dir", type=Path, default=ROOT / "fixtures/public-review")
    parser.add_argument("--env-file", type=Path, help="update only public example IDs after all runs pass")
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--wait-seconds", type=int, default=600)
    args = parser.parse_args()
    if args.wait_seconds < 1:
        parser.error("--wait-seconds must be positive")
    manifest = {row["file_id"]: row for row in
                (json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines())}
    source_bytes = {}
    for file_id, _, _ in EXAMPLES:
        row = manifest[file_id]
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility"),
                row.get("extension")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", ".pdf"):
            raise RuntimeError(f"{file_id} is not an allowed public PDF")
        pdf_path = args.pdf_dir / f"{file_id}.pdf"
        if not pdf_path.is_file():
            raise RuntimeError(
                f"missing {pdf_path}; obtain the approved source PDF separately "
                "and pass its directory with --pdf-dir"
            )
        pdf = pdf_path.read_bytes()
        if len(pdf) != row["size_bytes"] or hashlib.sha256(pdf).hexdigest() != row["sha256"]:
            raise RuntimeError(f"{file_id} original PDF SHA or size mismatch")
        source_bytes[file_id] = pdf
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = args.base_url.rstrip("/")

    def request(method: str, path: str, body: bytes | None = None,
                headers: dict[str, str] | None = None):
        call = urllib.request.Request(base + path, data=body, method=method, headers=headers or {})
        try:
            with opener.open(call, timeout=180) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            detail = error.read(400).decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {detail}") from error

    if args.credentials_file:
        credentials = dict(line.split("=", 1) for line in args.credentials_file.read_text().splitlines()
                           if "=" in line)
        if not credentials.get("login") or not credentials.get("password"):
            raise RuntimeError("credentials file needs login and password")
        request("POST", "/api/auth/login", json.dumps(credentials).encode(),
                {"Content-Type": "application/json"})
    else:
        request("POST", "/api/auth/open-workspace")
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("workspace did not set CSRF cookie")

    def command_headers(content_type: str | None = None) -> dict[str, str]:
        result = {"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid4())}
        if content_type:
            result["Content-Type"] = content_type
        return result

    existing = request("GET", "/api/objects")["items"]
    receipt = []
    for file_id, name, address in EXAMPLES:
        row = manifest[file_id]
        matching = [item for item in existing if item["name"] == name]
        if len(matching) > 1:
            raise RuntimeError(f"duplicate public example name: {name}")
        obj = matching[0] if matching else None
        if obj is None:
            obj = request("POST", "/api/objects",
                          json.dumps({"name": name, "address": address}).encode(),
                          command_headers("application/json"))
        object_id = obj["id"]
        files = request("GET", f"/api/objects/{object_id}/files")["items"]
        if files:
            if len(files) != 1 or files[0]["sha256"] != row["sha256"] \
                    or set(files[0]["stages"]) != {row["stage"]}:
                raise RuntimeError(f"existing {name} has unexpected source PDF")
        else:
            boundary = "inspector-public-" + uuid4().hex
            multipart = (f"--{boundary}\r\n"
                         f'Content-Disposition: form-data; name="file"; filename="{file_id}.pdf"\r\n'
                         "Content-Type: application/pdf\r\n\r\n").encode() \
                        + source_bytes[file_id] + f"\r\n--{boundary}--\r\n".encode()
            request("POST", f"/api/objects/{object_id}/files?stage={row['stage']}",
                    multipart, command_headers(f"multipart/form-data; boundary={boundary}"))
            files = request("GET", f"/api/objects/{object_id}/files")["items"]
            if len(files) != 1 or files[0]["sha256"] != row["sha256"]:
                raise RuntimeError(f"registered {file_id} PDF SHA mismatch")
        check_id = obj.get("activeCheckId")
        if not check_id:
            check = request("POST", f"/api/objects/{object_id}/checks", None, command_headers())
            check_id = check["id"]
        deadline = time.monotonic() + args.wait_seconds
        while time.monotonic() < deadline:
            check = request("GET", f"/api/checks/{check_id}")
            if check["status"] in ("PARTIAL", "COMPLETED", "FAILED", "CANCELLED"):
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{file_id} run did not finish in time")
        if check["status"] not in ("PARTIAL", "COMPLETED"):
            raise RuntimeError(f"{file_id} run finished with {check['status']}")
        pilot = request("GET", f"/api/checks/{check_id}/pilot-results")
        candidates = pilot.get("reviewCandidates") or {}
        if candidates.get("candidateCount", 0) < 1 or not any(
                item.get("sourceSha256") == row["sha256"]
                for item in candidates.get("candidates", [])):
            raise RuntimeError(f"{file_id} has no verified public review candidates")
        receipt.append({"fileId": file_id, "objectId": object_id, "checkId": check_id,
                        "sourceSha256": row["sha256"], "candidateCount": candidates["candidateCount"],
                        "artifactSha256": candidates["contentHash"]})
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps({"schemaVersion": "public-review-examples-v1",
                                        "examples": receipt}, ensure_ascii=False, indent=2) + "\n")
    if args.env_file:
        update_env(args.env_file, [example["objectId"] for example in receipt])
    print(json.dumps({"objectIds": [example["objectId"] for example in receipt],
                      "candidateCounts": [example["candidateCount"] for example in receipt]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
