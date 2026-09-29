#!/usr/bin/env python3
"""Bounded smoke of the separate OCR applicability journal, without positive decisions."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import uuid4


def get(opener: urllib.request.OpenerDirector, url: str):
    with opener.open(url, timeout=20) as response:
        return response.status, json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--credentials-file", type=Path, required=True)
    parser.add_argument("--check-id", required=True)
    parser.add_argument("--expected-candidates", type=int, default=0)
    parser.add_argument("--expected-typed-facts", type=int, default=0)
    args = parser.parse_args()
    endpoint = (args.base_url.rstrip("/") + "/api/checks/"
                + urllib.parse.quote(args.check_id, safe="")
                + "/ocr-row-applicability-reviews")
    try:
        get(urllib.request.build_opener(), endpoint)
        raise RuntimeError("anonymous GET unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError(f"anonymous GET returned {error.code}") from error

    credentials = dict(line.strip().split("=", 1) for line in
                       args.credentials_file.read_text().splitlines() if "=" in line)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login = urllib.request.Request(
        args.base_url.rstrip("/") + "/api/auth/login",
        json.dumps({"login": credentials["login"],
                    "password": credentials["password"]}).encode(),
        {"Content-Type": "application/json"},
    )
    with opener.open(login, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"login returned {response.status}")
    status, result = get(opener, endpoint)
    if status != 200 or not isinstance(result.get("items"), list) \
            or not isinstance(result.get("candidates"), list):
        raise RuntimeError("malformed authenticated response")
    if len(result["candidates"]) != args.expected_candidates:
        raise RuntimeError("unexpected candidate count")
    typed = (args.base_url.rstrip("/") + "/api/checks/"
             + urllib.parse.quote(args.check_id, safe="")
             + "/ocr-typed-facts?profile=ocr-typed-fact-candidates-v1")
    try:
        get(urllib.request.build_opener(), typed)
        raise RuntimeError("anonymous typed fact GET unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError(f"anonymous typed fact GET returned {error.code}") from error
    try:
        get(opener, typed.replace("ocr-typed-fact-candidates-v1", "unknown"))
        raise RuntimeError("wrong profile unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 400:
            raise RuntimeError(f"wrong profile returned {error.code}") from error
    typed_status, typed_result = get(opener, typed)
    if typed_status != 200 or typed_result.get("schemaVersion") != "ocr-typed-fact-candidates-v1" \
            or not isinstance(typed_result.get("items"), list) \
            or len(typed_result["items"]) != args.expected_typed_facts \
            or typed_result.get("findingCount") != 0 \
            or typed_result.get("coverageCount") != 0:
        raise RuntimeError("malformed or unexpected typed fact review aid")
    before = len(result["items"])
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("CSRF cookie absent")
    bogus = {
        "schemaVersion": "ocr-row-applicability-review-v1", "decision": "UNSURE",
        "targetCheckId": args.check_id, "sourceFileId": "FILE-NONEXISTENT",
        "sourceSha256": "0" * 64, "pageNumber": 1,
        "renderSha256": "0" * 64, "ocrStageSha256": "0" * 64,
        "rowFingerprint": "0" * 64, "transcriptionDecisionId": "missing",
        "transcriptionDecisionHash": "0" * 64,
        "sourceReviewDecisionId": "missing", "sourceReviewDecisionHash": "0" * 64,
        "parameterCode": "PZ-002", "attribute": "BUILDING_TOTAL_AREA",
        "stage": "PD", "entityKey": "smoke", "context": "Synthetic invalid scope",
        "basis": "Intentionally missing immutable snapshot",
    }
    post = urllib.request.Request(endpoint, json.dumps(bogus).encode(),
                                  {"Content-Type": "application/json",
                                   "X-CSRF-Token": csrf,
                                   "Idempotency-Key": str(uuid4())})
    try:
        opener.open(post, timeout=20)
        raise RuntimeError("bogus POST unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise RuntimeError(f"bogus POST returned {error.code}") from error
    _, after = get(opener, endpoint)
    if len(after.get("items", [])) != before:
        raise RuntimeError("bogus POST changed decision count")
    print(json.dumps({"checkId": args.check_id, "anonymousStatus": 401,
                      "authenticatedStatus": status,
                      "candidateCount": len(result["candidates"]),
                      "decisionCount": before, "bogusPostStatus": 409,
                      "typedFactCount": len(typed_result["items"]),
                      "typedFactStatus": typed_status, "wrongTypedProfileStatus": 400},
                     sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
