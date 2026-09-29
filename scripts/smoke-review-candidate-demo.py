#!/usr/bin/env python3
"""Exercise a saved public review candidate through source preview and decision."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:24100")
    parser.add_argument("--credentials-file", type=Path,
                        help="legacy password-based deployment only")
    parser.add_argument("--run-receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidate-code")
    parser.add_argument("--page-number", type=int)
    parser.add_argument("--decision", choices=("ACCEPT_FOR_REVIEW", "REJECT"),
                        default="ACCEPT_FOR_REVIEW")
    parser.add_argument("--expect-replay", action="store_true")
    args = parser.parse_args()
    run_receipt = json.loads(args.run_receipt.read_text())
    check_id, object_id = run_receipt["checkId"], run_receipt["objectId"]
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(method: str, path: str, body: object | None = None,
                headers: dict[str, str] | None = None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(args.base_url.rstrip("/") + path, data=data,
                                     method=method, headers=headers or {})
        try:
            with opener.open(req, timeout=180) as response:
                payload = response.read()
                return (response.status, json.loads(payload)
                        if response.headers.get_content_type() == "application/json" else payload)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: "
                               f"{error.read(300).decode(errors='replace')}") from error

    if args.credentials_file:
        credentials = dict(line.split("=", 1) for line in
                           args.credentials_file.read_text().splitlines() if "=" in line)
        status, _ = request("POST", "/api/auth/login", credentials,
                            {"Content-Type": "application/json"})
    else:
        status, _ = request("POST", "/api/auth/open-workspace")
    if status != 200:
        raise RuntimeError("workspace admission failed")
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("CSRF cookie missing")
    _, pilot = request("GET", f"/api/checks/{check_id}/pilot-results")
    artifact = pilot["reviewCandidates"]
    candidates = artifact["candidates"]
    if not candidates or artifact["contentHash"] != run_receipt["reviewCandidates"]["contentHash"]:
        raise RuntimeError("run candidate artifact changed")
    candidate = next((item for item in candidates
                      if (args.candidate_code is None
                          or item["parameterCode"] == args.candidate_code)
                      and (args.page_number is None
                           or item["pageNumber"] == args.page_number)), None)
    if candidate is None:
        raise RuntimeError("requested candidate is not in the saved run")
    _, source_files = request("GET", f"/api/objects/{object_id}/files")
    source = next((item for item in source_files["items"]
                   if item["id"] == candidate["sourceFileId"]), None)
    if not source or source["sha256"] != candidate["sourceSha256"]:
        raise RuntimeError("candidate source does not match registered PDF")
    base = (f"/api/objects/{object_id}/files/{candidate['sourceFileId']}"
            f"/pages/{candidate['pageNumber']}/preview")
    status, page = request("GET", base)
    if status != 200 or not page.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("source page preview is not PNG")
    x0, y0, x1, y1 = candidate["locator"]["bboxMilliPoints"]
    width, height = candidate["pageWidthMilliPoints"], candidate["pageHeightMilliPoints"]
    crop = (x0 / width, 1 - y1 / height, x1 / width, 1 - y0 / height)
    if not (0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1):
        raise RuntimeError("candidate crop is outside source page")
    query = ",".join(f"{value:.6f}" for value in crop)
    status, fragment = request("GET", base + "?crop=" + query)
    if status != 200 or not fragment.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("source fragment preview is not PNG")
    _, decisions_before = request("GET", f"/api/checks/{check_id}/review-candidate-decisions")
    if not decisions_before["canReview"]:
        raise RuntimeError("smoke actor lacks review permission")
    note = ("Заголовок листа виден, но сам по себе не подтверждает расхождение."
            if args.decision == "REJECT" else
            "Строка видна на исходном листе; связь документов и элемента требует проверки.")
    decision_input = {"schemaVersion": "review-candidate-decision-v1",
                      "candidateId": candidate["candidateId"],
                      "artifactHash": artifact["contentHash"],
                      "decision": args.decision, "note": note}
    existing = next((item for item in decisions_before["items"]
                     if item["candidateId"] == candidate["candidateId"]
                     and item["decision"] == args.decision and item["note"] == note), None)
    if args.expect_replay and existing is None:
        raise RuntimeError("expected review decision is not already saved")
    status, recorded = request("POST", f"/api/checks/{check_id}/review-candidate-decisions",
                               decision_input, {"Content-Type": "application/json",
                                                "X-CSRF-Token": csrf,
                                                "Idempotency-Key": str(uuid4())})
    if status != 201 or recorded["candidateId"] != candidate["candidateId"]:
        raise RuntimeError("review decision was not recorded")
    _, decisions_after = request("GET", f"/api/checks/{check_id}/review-candidate-decisions")
    expected_count = len(decisions_before["items"]) + (0 if args.expect_replay else 1)
    if len(decisions_after["items"]) != expected_count \
            or not any(item["id"] == recorded["id"] for item in decisions_after["items"]):
        raise RuntimeError("review decision did not survive API read")
    if args.expect_replay and recorded["id"] != existing["id"]:
        raise RuntimeError("duplicate decision created another journal row")
    _, findings = request("GET", f"/api/checks/{check_id}/findings")
    _, protocols = request("GET", f"/api/checks/{check_id}/protocols")
    if findings["items"]:
        raise RuntimeError("review decision changed official findings")
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "source-page.png").write_bytes(page)
    (args.output / "source-fragment.png").write_bytes(fragment)
    export = {"schemaVersion": "review-candidate-export-v1", "checkId": check_id,
              "objectId": object_id, "artifact": artifact,
              "decisions": decisions_after["items"], "officialFindingsIncluded": False}
    (args.output / "review-export.json").write_text(
        json.dumps(export, ensure_ascii=False, indent=2) + "\n")
    result = {"objectId": object_id, "checkId": check_id,
              "candidateId": candidate["candidateId"],
              "sourceFileId": candidate["sourceFileId"],
              "sourceSha256": candidate["sourceSha256"],
              "pageNumber": candidate["pageNumber"],
              "pagePngSha256": hashlib.sha256(page).hexdigest(),
              "fragmentPngSha256": hashlib.sha256(fragment).hexdigest(),
              "decisionId": recorded["id"], "decisionHash": recorded["decisionHash"],
              "decision": recorded["decision"],
              "replayedExistingDecision": args.expect_replay,
              "decisionCount": len(decisions_after["items"]),
              "officialFindingCount": len(findings["items"]),
              "protocolCount": len(protocols["items"])}
    (args.output / "demo-receipt.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
