#!/usr/bin/env python3
"""Register a second stage for an already uploaded, verified TRAIN_PUBLIC PDF."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.parse
import urllib.request
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:14100")
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--object-id", required=True)
    parser.add_argument("--add-stage", choices=("RD", "ID"), default="ID")
    args = parser.parse_args()

    rows = (json.loads(line) for line in args.manifest.read_text().splitlines() if line.strip())
    source = next((row for row in rows if row.get("file_id") == args.source_id), None)
    if source is None or any((
        source.get("split") != "TRAIN_PUBLIC",
        source.get("distribution_status") != "INCLUDE",
        source.get("label_visibility") != "PUBLIC_TRAIN",
        source.get("stage") != "RD_ID_MIXED",
    )):
        raise RuntimeError("source is not an included TRAIN_PUBLIC RD_ID_MIXED PDF")
    original = args.pdf.read_bytes()
    if not original.startswith(b"%PDF-") or len(original) != source["size_bytes"]:
        raise RuntimeError("PDF signature or size differs from the participant manifest")
    if hashlib.sha256(original).hexdigest() != source["sha256"]:
        raise RuntimeError("PDF SHA-256 differs from the participant manifest")

    credentials = dict(
        line.split("=", 1) for line in args.credentials_file.read_text().splitlines() if "=" in line
    )
    if not credentials.get("login") or not credentials.get("password"):
        parser.error("credentials file needs login and password")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = args.base_url.rstrip("/")

    def json_request(path: str, *, body: bytes | None = None,
                     headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(base + path, body, headers=headers or {},
                                         method="POST" if body is not None else "GET")
        with opener.open(request, timeout=180) as response:
            return json.load(response)

    json_request("/api/auth/login", body=json.dumps({
        "login": credentials["login"], "password": credentials["password"],
    }).encode(), headers={"Content-Type": "application/json"})
    path = f"/api/objects/{urllib.parse.quote(args.object_id, safe='')}/files"
    before = json_request(path)["items"]
    matches = [row for row in before if row["sha256"] == source["sha256"]]
    if len(matches) != 1:
        raise RuntimeError("expected exactly one previously uploaded source with the manifest hash")
    selected = matches[0]
    if args.add_stage in selected["stages"]:
        print(json.dumps({"sourceFileId": selected["id"], "stages": selected["stages"], "changed": False}))
        return
    if not set(selected["stages"]).issubset({"RD", "ID"}):
        raise RuntimeError("existing source has an unexpected stage")
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("login did not set CSRF cookie")
    boundary = "inspector-mixed-stage-" + uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{args.source_id}.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode() + original + f"\r\n--{boundary}--\r\n".encode()
    receipt = json_request(path + f"?stage={args.add_stage}", body=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "X-CSRF-Token": csrf,
        "Idempotency-Key": str(uuid4()),
    })
    after = json_request(path)["items"]
    updated = next((row for row in after if row["id"] == selected["id"]), None)
    if len(after) != len(before) or updated is None or set(updated["stages"]) != {"RD", "ID"}:
        raise RuntimeError("source stage association did not preserve the original file identity")
    print(json.dumps({
        "sourceFileId": selected["id"], "stages": updated["stages"],
        "sourceCount": len(after), "receiptId": receipt["id"], "changed": True,
    }))


if __name__ == "__main__":
    main()
