#!/usr/bin/env python3
"""Read-only smoke for the opt-in OCR transcription review endpoint."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4


def request(opener: urllib.request.OpenerDirector, url: str, body: dict | None = None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = {} if payload is None else {"Content-Type": "application/json"}
    req = urllib.request.Request(url, payload, headers=headers)
    with opener.open(req, timeout=20) as response:
        return response.status, json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--credentials-file", type=Path, required=True)
    parser.add_argument("--check-id", required=True)
    parser.add_argument("--object-id")
    parser.add_argument("--expected-candidates", type=int)
    parser.add_argument("--test-invalid-post", action="store_true")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    endpoint = f"{base}/api/checks/{args.check_id}/ocr-row-reviews"
    anonymous = urllib.request.build_opener()
    try:
        request(anonymous, endpoint)
        raise RuntimeError("anonymous OCR review GET unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError(f"anonymous GET returned {error.code}, expected 401") from error

    credentials = dict(line.strip().split("=", 1) for line in
                       args.credentials_file.read_text().splitlines() if "=" in line)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    status, _ = request(opener, f"{base}/api/auth/login", {
        "login": credentials["login"], "password": credentials["password"]})
    if status != 200:
        raise RuntimeError(f"login returned {status}")
    status, result = request(opener, endpoint)
    candidates = result.get("candidates")
    items = result.get("items")
    stage_sha = result.get("ocrStageSha256")
    if (status != 200 or not isinstance(candidates, list)
        or not isinstance(items, list) or not isinstance(stage_sha, str)
        or len(stage_sha) != 64):
        raise RuntimeError("malformed OCR review GET")
    if args.expected_candidates is not None and len(candidates) != args.expected_candidates:
        raise RuntimeError(f"candidate count {len(candidates)} != {args.expected_candidates}")
    preview_status = None
    if args.object_id and candidates:
        first = candidates[0]["proposal"]
        preview = (f"{base}/api/objects/{urllib.parse.quote(args.object_id, safe='')}/files/"
                   f"{urllib.parse.quote(first['sourceFileId'], safe='')}/pages/"
                   f"{first['pageNumber']}/preview")
        with opener.open(preview, timeout=20) as response:
            preview_status = response.status
            if (preview_status != 200 or not response.headers.get("Content-Type", "").startswith("image/")
                or not response.read(16)):
                raise RuntimeError("source-page preview did not return an image")
    invalid_post_status = None
    if args.test_invalid_post:
        csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                     if cookie.name == "inspector_csrf"), None)
        if not csrf or not candidates:
            raise RuntimeError("CSRF cookie or OCR candidates missing")
        candidate = candidates[0]
        invalid = {"schemaVersion": "ocr-row-transcription-review-v1",
                   "ocrStageSha256": stage_sha, "rowFingerprint": "0" * 64,
                   "decision": "REJECTED", "reviewedLabel": None,
                   "reviewedValue": None, "reviewedUnit": None,
                   "basis": "Smoke: intentionally invalid row fingerprint."}
        if candidate.get("rowFingerprint") == invalid["rowFingerprint"]:
            raise RuntimeError("invalid fingerprint collides with a candidate")
        req = urllib.request.Request(endpoint, json.dumps(invalid).encode("utf-8"),
                                     headers={"Content-Type": "application/json",
                                              "X-CSRF-Token": csrf,
                                              "Idempotency-Key": str(uuid4())})
        try:
            opener.open(req, timeout=20)
            raise RuntimeError("invalid OCR row POST unexpectedly succeeded")
        except urllib.error.HTTPError as error:
            invalid_post_status = error.code
            if error.code != 409:
                raise RuntimeError(f"invalid POST returned {error.code}, expected 409") from error
        _, after = request(opener, endpoint)
        if len(after.get("items", [])) != len(items):
            raise RuntimeError("invalid POST changed OCR review count")
    print(json.dumps({"checkId": args.check_id, "anonymousStatus": 401,
                      "authenticatedStatus": status, "candidateCount": len(candidates),
                      "reviewCount": len(items), "ocrStageSha256": stage_sha,
                      "canReview": result.get("canReview"),
                      "invalidPostStatus": invalid_post_status,
                      "previewStatus": preview_status}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
