#!/usr/bin/env python3
"""Bounded authenticated smoke of the separate OCR_ROW pair journal."""

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
    parser.add_argument("--expected-candidates", type=int, required=True)
    parser.add_argument("--expected-decisions", type=int, required=True)
    parser.add_argument("--expected-snapshots", type=int)
    args = parser.parse_args()
    endpoint = (args.base_url.rstrip("/") + "/api/checks/"
                + urllib.parse.quote(args.check_id, safe="")
                + "/ocr-fact-pair-reviews")
    try:
        get(urllib.request.build_opener(), endpoint)
        raise RuntimeError("anonymous pair GET unexpectedly succeeded")
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
    candidates = result.get("candidates")
    decisions = result.get("items")
    if status != 200 or not isinstance(candidates, list) or not isinstance(decisions, list):
        raise RuntimeError("malformed pair review response")
    if len(candidates) != args.expected_candidates or len(decisions) != args.expected_decisions:
        raise RuntimeError("unexpected pair candidate/decision count")
    snapshot_count = None
    if args.expected_snapshots is not None:
        snapshot_endpoint = endpoint.replace("/ocr-fact-pair-reviews", "/ocr-fact-pair-snapshots")
        try:
            get(urllib.request.build_opener(), snapshot_endpoint)
            raise RuntimeError("anonymous pair snapshot GET unexpectedly succeeded")
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise RuntimeError(f"anonymous snapshot GET returned {error.code}") from error
        snapshot_status, snapshot_result = get(opener, snapshot_endpoint)
        snapshots = snapshot_result.get("items")
        if snapshot_status != 200 or not isinstance(snapshots, list) \
                or len(snapshots) != args.expected_snapshots:
            raise RuntimeError("unexpected pair snapshot response")
        snapshot_count = len(snapshots)

    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("CSRF cookie absent")
    forged = {
        "schemaVersion": "ocr-fact-pair-review-v1", "decision": "PAIR_CONFIRMED",
        "targetCheckId": args.check_id, "inputManifestHash": "0" * 64,
        "objectId": "OBJ-NONEXISTENT", "parameterCode": "PZ-002",
        "attribute": "BUILDING_TOTAL_AREA", "pdFactId": "1" * 64,
        "pdLocatorHash": "2" * 64, "rdFactId": "3" * 64,
        "rdLocatorHash": "4" * 64, "entityKey": "forged", "context": "forged",
        "linkGroupId": "forged", "basis": "Smoke: deliberately nonexistent pair",
    }
    post = urllib.request.Request(endpoint, json.dumps(forged).encode(),
                                  {"Content-Type": "application/json",
                                   "X-CSRF-Token": csrf,
                                   "Idempotency-Key": str(uuid4())})
    try:
        opener.open(post, timeout=20)
        raise RuntimeError("forged pair POST unexpectedly succeeded")
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise RuntimeError(f"forged POST returned {error.code}") from error
    _, after = get(opener, endpoint)
    if len(after.get("items", [])) != len(decisions):
        raise RuntimeError("forged POST changed decision count")
    print(json.dumps({"checkId": args.check_id, "anonymousStatus": 401,
                      "authenticatedStatus": status, "candidateCount": len(candidates),
                      "decisionCount": len(decisions), "snapshotCount": snapshot_count,
                      "forgedPostStatus": 409},
                     sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
