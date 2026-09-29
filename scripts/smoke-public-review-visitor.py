#!/usr/bin/env python3
"""Verify anonymous admission and read-only access to exactly three public runs."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
from pathlib import Path
import urllib.error
import urllib.request
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:24100")
    parser.add_argument("--examples-receipt", required=True, type=Path)
    parser.add_argument("--private-object-id")
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    examples = json.loads(args.examples_receipt.read_text(encoding="utf-8"))["examples"]
    expected_ids = {item["objectId"] for item in examples}
    if len(examples) != 3 or len(expected_ids) != 3:
        raise RuntimeError("expected exactly three distinct prepared examples")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = args.base_url.rstrip("/")

    def request(method: str, path: str, body: bytes | None = None,
                headers: dict[str, str] | None = None):
        call = urllib.request.Request(base + path, data=body, method=method, headers=headers or {})
        try:
            with opener.open(call, timeout=120) as response:
                raw = response.read()
                return response.status, response.headers.get_content_type(), raw
        except urllib.error.HTTPError as error:
            return error.code, error.headers.get_content_type(), error.read(300)

    status, _, raw = request("POST", "/api/auth/public-visitor")
    if status != 200:
        raise RuntimeError(f"public visitor admission failed: HTTP {status}")
    user = json.loads(raw)["user"]
    if user["roles"] != ["CURATOR"] or user["capabilities"]:
        raise RuntimeError("visitor has unexpected roles or capabilities")
    status, _, raw = request("GET", "/api/objects")
    if status != 200:
        raise RuntimeError(f"visitor object list failed: HTTP {status}")
    objects = json.loads(raw)["items"]
    if {item["id"] for item in objects} != expected_ids:
        raise RuntimeError("visitor scope differs from three allowlisted examples")
    result = []
    for example in examples:
        check_id = example["checkId"]
        status, _, raw = request("GET", f"/api/checks/{check_id}/pilot-results")
        if status != 200:
            raise RuntimeError(f"visitor cannot read {check_id}: HTTP {status}")
        artifact = json.loads(raw).get("reviewCandidates") or {}
        candidates = artifact.get("candidates") or []
        if artifact.get("contentHash") != example["artifactSha256"] \
                or artifact.get("candidateCount") != example["candidateCount"] or not candidates:
            raise RuntimeError(f"immutable candidate artifact changed for {check_id}")
        candidate = candidates[0]
        if candidate["sourceSha256"] != example["sourceSha256"]:
            raise RuntimeError("candidate source SHA differs from original PDF")
        page = (f"/api/objects/{example['objectId']}/files/{candidate['sourceFileId']}"
                f"/pages/{candidate['pageNumber']}/preview")
        status, media_type, raw = request("GET", page)
        if status != 200 or media_type != "image/png" or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError(f"source page preview failed: HTTP {status}")
        status, _, raw = request("GET", f"/api/checks/{check_id}/review-candidate-decisions")
        if status != 200 or json.loads(raw).get("canReview") is not False:
            raise RuntimeError("visitor unexpectedly has review decision permission")
        result.append({"objectId": example["objectId"], "checkId": check_id,
                       "candidateCount": len(candidates), "sourcePagePng": True})
    status, _, _ = request("POST", "/api/objects", json.dumps({"name": "Forbidden", "address": "Forbidden"}).encode(),
                           {"Content-Type": "application/json", "Idempotency-Key": str(uuid4()),
                            "X-CSRF-Token": next((cookie.value for cookie in jar
                                                  if cookie.name == "inspector_csrf"), "")})
    if status != 403:
        raise RuntimeError(f"visitor create-object permission expected 403, got {status}")
    if args.private_object_id:
        status, _, _ = request("GET", f"/api/objects/{args.private_object_id}")
        if status != 404:
            raise RuntimeError(f"private object expected 404, got {status}")
    payload = {"schemaVersion": "public-review-visitor-smoke-v1",
               "visitorRole": user["roles"], "examples": result,
               "createObjectStatus": 403,
               "privateObjectHidden": bool(args.private_object_id)}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
