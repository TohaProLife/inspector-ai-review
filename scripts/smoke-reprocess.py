#!/usr/bin/env python3
"""Reprocess an existing isolated NORMAL check and inspect durable coverage."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:14100")
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--check-id", required=True)
    parser.add_argument("--poll-check-id", help="Poll a run already created by reprocess")
    parser.add_argument("--expected-profile", choices=("PILOT_PZ002", "PILOT_PZ002_PZ017", "FACT_FAMILY_V1"),
                        default="PILOT_PZ002")
    parser.add_argument("--pilot-output", type=Path, help="save verified pilot-results JSON")
    parser.add_argument("--expect-candidate-family", action="store_true",
                        help="require 47 review-only preview and observation code rows")
    parser.add_argument("--expect-candidate-ocr", action="store_true",
                        help="require committed OCR review-only rows for all 47 candidate codes")
    parser.add_argument("--expect-ocr-table-rows", action="store_true",
                        help="require uncoded review-only rows from committed bounded OCR")
    parser.add_argument("--expect-ocr-table-profile", choices=("v1", "v2", "v3"), default="v1",
                        help="expected opt-in OCR table row profile")
    parser.add_argument("--expect-ocr-table-proposals", type=int,
                        help="expected complete uncoded row count for a selected public fixture")
    parser.add_argument("--expected-ocr-continuations", type=int,
                        help="expected count of explicit OCR label continuation lines")
    parser.add_argument("--wait-seconds", type=int, default=900)
    args = parser.parse_args()
    if args.expect_candidate_family and args.expected_profile != "FACT_FAMILY_V1":
        parser.error("--expect-candidate-family requires FACT_FAMILY_V1")
    if args.expect_candidate_ocr and not args.expect_candidate_family:
        parser.error("--expect-candidate-ocr requires --expect-candidate-family")
    if args.expect_ocr_table_rows and not args.expect_candidate_ocr:
        parser.error("--expect-ocr-table-rows requires --expect-candidate-ocr")
    if args.expect_ocr_table_proposals is not None and (
            not args.expect_ocr_table_rows or args.expect_ocr_table_proposals < 0):
        parser.error("--expect-ocr-table-proposals requires --expect-ocr-table-rows and nonnegative count")
    if args.expected_ocr_continuations is not None and (
            args.expect_ocr_table_profile != "v3" or not args.expect_ocr_table_rows
            or args.expected_ocr_continuations < 0):
        parser.error("--expected-ocr-continuations requires OCR table v3 and nonnegative count")
    credentials = dict(line.split("=", 1) for line in args.credentials_file.read_text().splitlines()
                       if "=" in line)
    if not credentials.get("login") or not credentials.get("password"):
        parser.error("credentials file needs login and password")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(method: str, path: str, body: bytes | None = None,
                headers: dict[str, str] | None = None) -> dict:
        req = urllib.request.Request(args.base_url.rstrip("/") + path, body, method=method,
                                     headers=headers or {})
        try:
            with opener.open(req, timeout=180) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {error.read(300)!r}") from error

    request("POST", "/api/auth/login",
            json.dumps({"login": credentials["login"], "password": credentials["password"]}).encode(),
            {"Content-Type": "application/json"})
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar
                 if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("login did not set CSRF cookie")
    if args.poll_check_id:
        run_id = args.poll_check_id
    else:
        check = request("POST", f"/api/checks/{args.check_id}/reprocess", None,
                        {"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid4())})
        run_id = check.get("id")
        if not run_id or run_id == args.check_id:
            raise RuntimeError("reprocess did not create a new run")
        print(json.dumps({"reprocessedFrom": args.check_id, "newCheckId": run_id}), flush=True)
    deadline = time.monotonic() + args.wait_seconds
    while time.monotonic() < deadline:
        check = request("GET", f"/api/checks/{run_id}")
        if check["status"] in ("PARTIAL", "FAILED", "COMPLETED"):
            break
        time.sleep(3)
    else:
        raise RuntimeError("reprocessed check did not finish before deadline")
    coverage = request("GET", f"/api/checks/{run_id}/coverage")["items"]
    findings = request("GET", f"/api/checks/{run_id}/findings")["items"]
    counts: dict[str, int] = {}
    for row in coverage:
        counts[row["executionStatus"]] = counts.get(row["executionStatus"], 0) + 1
    expected = ({"PARTIAL": 7, "UNSUPPORTED": 125}
                if args.expected_profile == "FACT_FAMILY_V1"
                else {"PARTIAL": 2, "UNSUPPORTED": 130}
                if args.expected_profile == "PILOT_PZ002_PZ017"
                else {"PARTIAL": 1, "UNSUPPORTED": 131})
    if check["status"] != "PARTIAL" or counts != expected:
        raise RuntimeError(f"unexpected pilot result: {check['status']} {counts}")
    family_summary = None
    candidate_summary = None
    candidate_ocr_summary = None
    ocr_table_summary = None
    if args.expected_profile == "FACT_FAMILY_V1":
        if findings:
            raise RuntimeError("fact-family review-only profile emitted a finding")
        pilot = request("GET", f"/api/checks/{run_id}/pilot-results")
        family = pilot.get("factFamily")
        if (pilot.get("status") != "READY" or not isinstance(family, dict)
                or family.get("schemaVersion") != "fact-family-proposals-v1"
                or family.get("findingCount") != 0
                or not isinstance(family.get("facts"), list)
                or not isinstance(family.get("comparisons"), list)
                or len(family["comparisons"]) != 5):
            raise RuntimeError("persisted fact-family result missing or malformed")
        if args.pilot_output:
            args.pilot_output.parent.mkdir(parents=True, exist_ok=True)
            args.pilot_output.write_text(json.dumps(pilot, ensure_ascii=False, indent=2), encoding="utf-8")
        family_summary = {"factCount": len(family["facts"]),
                          "statusCounts": {status: sum(row.get("status") == status
                                                       for row in family["comparisons"])
                                           for status in {row.get("status") for row in family["comparisons"]}},
                          "contentHash": family.get("contentHash")}
        if args.expect_candidate_family:
            preview = pilot.get("candidateFamilyPreview")
            observations = pilot.get("candidateFamilyObservations")
            if (not isinstance(preview, dict) or not isinstance(observations, dict)
                    or preview.get("schemaVersion") != "candidate-family-preview-v1"
                    or observations.get("schemaVersion") != "candidate-family-observations-v1"
                    or preview.get("purpose") != "REVIEW_ONLY"
                    or observations.get("purpose") != "REVIEW_ONLY"
                    or preview.get("outputCount") != 47
                    or not isinstance(preview.get("codeRows"), list)
                    or len(preview["codeRows"]) != 47
                    or not isinstance(observations.get("codeRows"), list)
                    or len(observations["codeRows"]) != 47
                    or not isinstance(observations.get("observations"), list)
                    or observations.get("outputCount") != len(observations["observations"])
                    or preview.get("findingCount") is not None
                    or observations.get("findingCount") is not None
                    or preview.get("parameterCoverage") is not None
                    or observations.get("parameterCoverage") is not None
                    or {row.get("parameterCode") for row in preview["codeRows"]}
                       != {row.get("parameterCode") for row in observations["codeRows"]}
                    or len({row.get("parameterCode") for row in preview["codeRows"]}) != 47
                    or any(not isinstance(row.get("parameterCode"), str)
                           or not row["parameterCode"] for row in preview["codeRows"])
                    or any(row.get("status") != "ABSTAIN" for row in preview["codeRows"])
                    or any(row.get("status") != "REVIEW_ONLY" for row in observations["codeRows"])):
                raise RuntimeError("candidate family preview/observations missing or malformed")
            candidate_summary = {
                "codeCount": 47,
                "leadCount": sum(row.get("leadCount", 0) for row in preview["codeRows"]),
                "observationCount": len(observations["observations"]),
                "previewContentHash": preview.get("contentHash"),
                "observationsContentHash": observations.get("contentHash"),
            }
            if args.expect_candidate_ocr:
                ocr = pilot.get("candidateFamilyOcrObservations")
                rows = ocr.get("codeRows") if isinstance(ocr, dict) else None
                if (not isinstance(ocr, dict) or not isinstance(rows, list)
                        or ocr.get("schemaVersion") != "candidate-family-ocr-observations-v1"
                        or ocr.get("scope") != "RUN_COMMITTED_OCR"
                        or ocr.get("purpose") != "REVIEW_ONLY"
                        or ocr.get("inputManifestHash") != preview.get("inputManifestHash")
                        or not isinstance(ocr.get("ocrArtifactSha256"), str)
                        or len(ocr["ocrArtifactSha256"]) != 64
                        or ocr.get("outputCount") != 47 or len(rows) != 47
                        or ocr.get("findingCount") is not None
                        or ocr.get("parameterCoverage") is not None
                        or {row.get("parameterCode") for row in rows}
                           != {row.get("parameterCode") for row in preview["codeRows"]}
                        or any(row.get("status") != "ABSTAIN"
                               or row.get("leadCount") != len(row.get("candidateLeads", []))
                               for row in rows)):
                    raise RuntimeError("candidate OCR review aid missing or malformed")
                candidate_ocr_summary = {
                    "codeCount": 47,
                    "leadCount": sum(row["leadCount"] for row in rows),
                    "processedPagesAcrossCodes": sum(row["ocrProcessedPageCount"] for row in rows),
                    "deferredPagesAcrossCodes": sum(row["ocrDeferredPageCount"] for row in rows),
                    "ocrArtifactSha256": ocr["ocrArtifactSha256"],
                    "contentHash": ocr.get("contentHash"),
                }
                if args.expect_ocr_table_rows:
                    table = pilot.get("ocrTableRows")
                    proposals = table.get("proposals") if isinstance(table, dict) else None
                    abstentions = table.get("abstentions") if isinstance(table, dict) else None
                    if (not isinstance(table, dict)
                            or table.get("profileId") !=
                               f"conservative-ocr-table-rows-{args.expect_ocr_table_profile}"
                            or table.get("inputManifestHash") != preview.get("inputManifestHash")
                            or table.get("findingCount") != 0
                            or not isinstance(proposals, list)
                            or not isinstance(abstentions, list)
                            or not isinstance(table.get("proposalCount"), int)
                            or not isinstance(table.get("abstentionCount"), int)
                            or not isinstance(table.get("truncated"), bool)
                            or table["proposalCount"] < len(proposals)
                            or table["abstentionCount"] < len(abstentions)
                            or any(not isinstance(row, dict)
                                   or "parameterCode" in row or "normalizedValue" in row
                                   or not isinstance(row.get("sourceFileId"), str)
                                   or not isinstance(row.get("inputSha256"), str)
                                   or not isinstance(row.get("pageNumber"), int)
                                   or not isinstance(row.get("renderSha256"), str)
                                   or not isinstance(row.get("labelEvidence"), dict)
                                   or not isinstance(row.get("valueEvidence"), dict)
                                   for row in proposals)):
                        raise RuntimeError("committed OCR table review aid missing or malformed")
                    if (args.expect_ocr_table_proposals is not None
                            and (table["proposalCount"] != args.expect_ocr_table_proposals
                                 or table["truncated"])):
                        raise RuntimeError("committed OCR table row count changed")
                    if args.expect_ocr_table_profile == "v3":
                        continuations = [item for row in proposals
                                         for item in row.get("labelContinuationEvidence", [])]
                        if (any(not isinstance(row.get("labelContinuationEvidence"), list)
                                or len(row["labelContinuationEvidence"]) > 1
                                for row in proposals)
                                or any(not isinstance(item, dict)
                                       or item.get("role") != "rowLabelContinuation"
                                       or not isinstance(item.get("lineIndex"), int)
                                       for item in continuations)
                                or (args.expected_ocr_continuations is not None
                                    and len(continuations) != args.expected_ocr_continuations)):
                            raise RuntimeError("committed OCR label continuation changed")
                    ocr_table_summary = {
                        "proposalCount": table["proposalCount"],
                        "abstentionCount": table["abstentionCount"],
                        "truncated": table["truncated"],
                        **({"continuationCount": len(continuations)}
                           if args.expect_ocr_table_profile == "v3" else {}),
                    }
    print(json.dumps({"checkId": check["id"], "status": check["status"],
                      "coverage": counts, "findingCount": len(findings),
                      "factFamily": family_summary,
                      "candidateFamily": candidate_summary,
                      "candidateFamilyOcr": candidate_ocr_summary,
                      "ocrTableRows": ocr_table_summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
