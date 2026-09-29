#!/usr/bin/env python3
"""Store an evidence-limited source review in an isolated smoke object."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18081")
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--proposal", required=True, type=Path)
    parser.add_argument("--object-id", required=True)
    parser.add_argument("--source-file-id", required=True)
    args = parser.parse_args()

    report = json.loads(args.proposal.read_text())
    decision = report["sourceReviewProposal"]
    if (report.get("split") != "TRAIN_PUBLIC"
            or decision.get("revisionStatus") != "UNKNOWN"
            or decision.get("approvalStatus") != "UNKNOWN"
            or decision.get("linkGroupId") is not None
            or decision.get("sourceSha256") != report.get("sourceSha256")):
        raise ValueError("Only a verified public, unresolved proposal can be applied")
    stages = decision.get("pageStages")
    if (not isinstance(stages, dict) or len(stages) != report["pageCount"]
            or any(stages.get(str(number)) not in {"RD", "UNRESOLVED"}
                   for number in range(1, report["pageCount"] + 1))
            or "UNRESOLVED" not in stages.values()):
        raise ValueError("Proposal must map every page and keep unresolved pages explicit")
    credentials = dict(line.split("=", 1) for line in args.credentials_file.read_text().splitlines()
                       if "=" in line)
    if not credentials.get("login") or not credentials.get("password"):
        parser.error("credentials file needs login and password")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = args.base_url.rstrip("/")

    def request(method: str, path: str, data: dict | None = None,
                headers: dict[str, str] | None = None) -> tuple[int, dict]:
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(base + path, body, method=method, headers={
            **({"Content-Type": "application/json"} if body is not None else {}),
            **(headers or {}),
        })
        try:
            with opener.open(req, timeout=180) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return error.code, {}
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {error.read(300)!r}") from error

    status, _ = request("POST", "/api/auth/login", {
        "login": credentials["login"], "password": credentials["password"],
    })
    if status != 200:
        raise RuntimeError("Login failed")
    path = f"/api/objects/{urllib.parse.quote(args.object_id, safe='')}/files"
    status, listing = request("GET", path)
    if status != 200:
        raise RuntimeError("Source list is not readable")
    source = next((item for item in listing["items"] if item["id"] == args.source_file_id), None)
    if (source is None or source["sha256"] != report["sourceSha256"]
            or source["pageCount"] != report["pageCount"]
            or set(source["stages"]) != {"RD", "ID"} or not listing["permissions"]["review"]):
        raise RuntimeError("Object, source hash, page count, stages or review permission differs")
    review_path = path + f"/{urllib.parse.quote(args.source_file_id, safe='')}/source-review"
    status, _ = request("GET", review_path)
    if status != 404:
        raise RuntimeError("Source already has a decision; refusing to replace it")
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("Login did not set CSRF cookie")
    status, saved = request("POST", review_path, decision, {
        "X-CSRF-Token": csrf, "Idempotency-Key": str(uuid4()),
    })
    if status != 201 or saved.get("pageStages") != decision["pageStages"]:
        raise RuntimeError("Review was not saved exactly")
    status, current = request("GET", review_path)
    if status != 200 or current.get("contentHash") != saved.get("contentHash"):
        raise RuntimeError("Saved review was not read back exactly")
    print(json.dumps({"objectId": args.object_id, "sourceFileId": args.source_file_id,
                      "decisionId": saved["id"], "contentHash": saved["contentHash"],
                      "rdPageCount": sum(stage == "RD" for stage in stages.values()),
                      "unresolvedPageCount": sum(stage == "UNRESOLVED" for stage in stages.values()),
                      "revisionStatus": saved["revisionStatus"],
                      "approvalStatus": saved["approvalStatus"]}))


if __name__ == "__main__":
    main()
