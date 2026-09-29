#!/usr/bin/env python3
"""Exercise the isolated core stack without claiming ML quality."""

from __future__ import annotations

import argparse
import hashlib
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
    parser.add_argument("--credentials-file", type=Path,
                        help="legacy password-based deployment only")
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--pdf-stage", choices=("PD", "RD", "ID"), default="PD")
    parser.add_argument("--rd-pdf", type=Path, help="optional RD document for the same object")
    parser.add_argument("--expected-profile", choices=("SCAFFOLD", "PILOT_PZ002", "PILOT_PZ002_PZ017", "FACT_FAMILY_V1", "FACT_FAMILY_CANDIDATE_PREVIEW_V1", "FACT_FAMILY_CANDIDATE_OBSERVATIONS_V1"), default="SCAFFOLD")
    parser.add_argument("--expected-observations", type=int)
    parser.add_argument("--public-manifest", type=Path)
    parser.add_argument("--pdf-source-id")
    parser.add_argument("--rd-source-id")
    parser.add_argument("--mixed-stage", action="store_true",
                        help="associate the verified RD_ID_MIXED source with both RD and ID before the run")
    parser.add_argument("--expected-review-candidates", type=int)
    parser.add_argument("--existing-object-id",
                        help="reuse an isolated smoke object after verifying its registered PDF SHA")
    parser.add_argument("--existing-check-id",
                        help="audit an already completed immutable run without creating another")
    parser.add_argument("--wait-seconds", type=int, default=300)
    parser.add_argument("--request-timeout", type=int, default=180)
    parser.add_argument("--receipt", type=Path, help="write the verified smoke receipt as JSON")
    args = parser.parse_args()
    if args.request_timeout < 1:
        parser.error("--request-timeout must be positive")
    family_profile = args.expected_profile in {"FACT_FAMILY_V1", "FACT_FAMILY_CANDIDATE_PREVIEW_V1", "FACT_FAMILY_CANDIDATE_OBSERVATIONS_V1"}
    if args.expected_observations is not None and args.expected_observations < 0:
        parser.error("--expected-observations must be non-negative")
    if family_profile and (not args.public_manifest or not args.pdf_source_id):
        parser.error("fact-family public smoke requires manifest and source IDs")
    if args.mixed_stage and not args.public_manifest:
        parser.error("mixed-stage smoke requires a public manifest")
    if args.existing_check_id and not args.existing_object_id:
        parser.error("an existing check requires its existing object ID")
    manifest = {}
    if args.public_manifest or args.pdf_source_id or args.rd_source_id:
        if not args.public_manifest or not args.pdf_source_id or (args.rd_pdf and not args.rd_source_id):
            parser.error("public manifest and source IDs must be supplied together")
        manifest = {entry["file_id"]: entry for entry in (
            json.loads(line) for line in args.public_manifest.read_text(encoding="utf-8").splitlines()
        )}
        selected = []
        mixed_sources = []
        for source_id, path, upload_stage in ((args.pdf_source_id, args.pdf, args.pdf_stage),
                                               (args.rd_source_id, args.rd_pdf, "RD")):
            if path is None:
                continue
            entry = manifest.get(source_id)
            if (not entry or entry.get("split") != "TRAIN_PUBLIC"
                    or entry.get("distribution_status") != "INCLUDE"
                    or entry.get("label_visibility") != "PUBLIC_TRAIN"):
                parser.error(f"{source_id} is not an included TRAIN_PUBLIC source")
            if (path.stat().st_size != entry["size_bytes"]
                    or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]):
                parser.error(f"{source_id} does not match public manifest bytes")
            selected.append(entry)
            if entry.get("stage") == "RD_ID_MIXED" and upload_stage == "RD":
                mixed_sources.append(source_id)
            if family_profile and entry.get("stage") != upload_stage and not (
                    args.mixed_stage and source_id in mixed_sources):
                parser.error(f"{source_id} stage differs from public manifest")
        if args.mixed_stage and not mixed_sources:
            parser.error("mixed-stage smoke requires a public RD_ID_MIXED source uploaded as RD")
        if family_profile and len({entry.get("object_id") for entry in selected}) != 1:
            parser.error("fact-family public smoke requires one object")

    def is_mixed_source(source_id: str | None) -> bool:
        return bool(args.mixed_stage and source_id and
                    manifest[source_id].get("stage") == "RD_ID_MIXED")

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base_url = args.base_url.rstrip("/")

    def request(method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        req = urllib.request.Request(base_url + path, data=body, method=method, headers=headers or {})
        try:
            with opener.open(req, timeout=args.request_timeout) as response:
                data = response.read()
                return response.status, json.loads(data) if data and response.headers.get_content_type() == "application/json" else data
        except urllib.error.HTTPError as error:
            detail = error.read(500).decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {detail}") from error

    status, _ = request("GET", "/api/health")
    assert status == 200
    if args.credentials_file:
        credentials = dict(line.split("=", 1) for line in args.credentials_file.read_text().splitlines()
                           if "=" in line)
        if not credentials.get("login") or not credentials.get("password"):
            raise SystemExit("credentials file needs login and password")
        status, _ = request("POST", "/api/auth/login", json.dumps(credentials).encode(),
                            {"Content-Type": "application/json"})
    else:
        status, _ = request("POST", "/api/auth/open-workspace")
    assert status == 200
    csrf = next((urllib.parse.unquote(cookie.value) for cookie in jar if cookie.name == "inspector_csrf"), None)
    if not csrf:
        raise RuntimeError("workspace did not set CSRF cookie")

    def command_headers(content_type: str | None = None) -> dict[str, str]:
        headers = {"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid4())}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    if args.existing_object_id:
        object_id = args.existing_object_id
        _, registered = request("GET", f"/api/objects/{object_id}/files")
        for source_id, path in ((args.pdf_source_id, args.pdf),
                                (args.rd_source_id, args.rd_pdf)):
            if path is None:
                continue
            expected_sha = hashlib.sha256(path.read_bytes()).hexdigest()
            matching = [item for item in registered["items"]
                        if item["sha256"] == expected_sha]
            expected_stages = {"RD", "ID"} if is_mixed_source(source_id) \
                else {args.pdf_stage if source_id == args.pdf_source_id else "RD"}
            if len(matching) != 1 or set(matching[0]["stages"]) != expected_stages:
                raise RuntimeError("existing smoke object PDF SHA or stages differ")
    else:
        status, obj = request(
            "POST", "/api/objects",
            json.dumps({"name": f"Homeserver smoke {uuid4().hex[:8]}", "address": "Тестовый объект"}).encode(),
            command_headers("application/json"),
        )
        assert status == 201
        object_id = obj["id"]

    uploads = []
    for stage, path, source_id in ((args.pdf_stage, args.pdf, args.pdf_source_id),
                                   ("RD", args.rd_pdf, args.rd_source_id)):
        if path is None or args.existing_object_id:
            continue
        pdf_bytes = path.read_bytes()
        if not pdf_bytes.startswith(b"%PDF-"):
            raise SystemExit(f"smoke input is not a PDF: {path}")
        boundary = "inspector-smoke-" + uuid4().hex
        multipart = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{stage.lower()}-smoke.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode() + pdf_bytes + f"\r\n--{boundary}--\r\n".encode()
        status, upload = request(
            "POST", f"/api/objects/{object_id}/files?stage={stage}", multipart,
            command_headers(f"multipart/form-data; boundary={boundary}"),
        )
        assert status == 201
        uploads.append({
            "stage": stage, "id": upload["id"], "sourceFileId": source_id,
            "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
            "sizeBytes": len(pdf_bytes),
            "publicManifestVerified": args.public_manifest is not None and source_id is not None,
        })
        if is_mixed_source(source_id):
            status, associated = request(
                "POST", f"/api/objects/{object_id}/files?stage=ID", multipart,
                command_headers(f"multipart/form-data; boundary={boundary}"),
            )
            if status not in (200, 201) or not associated.get("id"):
                raise RuntimeError("mixed-stage association was not accepted")
            _, registered = request("GET", f"/api/objects/{object_id}/files")
            matching = [item for item in registered["items"]
                        if item["sha256"] == uploads[-1]["sha256"]]
            if len(matching) != 1 or set(matching[0]["stages"]) != {"RD", "ID"}:
                raise RuntimeError("mixed-stage association did not preserve one source")
            uploads[-1]["registeredFileId"] = matching[0]["id"]
            uploads[-1]["stages"] = ["RD", "ID"]
    if args.existing_check_id:
        check_id = args.existing_check_id
    else:
        status, check = request(
            "POST", f"/api/objects/{object_id}/checks", None, command_headers(),
        )
        assert status == 201
        check_id = check["id"]

    deadline = time.monotonic() + args.wait_seconds
    while time.monotonic() < deadline:
        _, check = request("GET", f"/api/checks/{check_id}")
        if check["status"] in ("PARTIAL", "FAILED", "COMPLETED"):
            break
        time.sleep(2)
    else:
        raise RuntimeError(f"check {check_id} did not finish in {args.wait_seconds} seconds")
    if check["status"] != "PARTIAL":
        raise RuntimeError(f"expected PARTIAL, got {check['status']}")
    _, coverage = request("GET", f"/api/checks/{check_id}/coverage")
    rows = coverage["items"]
    counts: dict[str, int] = {}
    for row in rows:
        status = row["executionStatus"]
        counts[status] = counts.get(status, 0) + 1
    expected = ({"UNSUPPORTED": 132} if args.expected_profile == "SCAFFOLD"
                else {"UNSUPPORTED": 125, "PARTIAL": 7} if family_profile
                else {"UNSUPPORTED": 130, "PARTIAL": 2} if args.expected_profile == "PILOT_PZ002_PZ017"
                else {"UNSUPPORTED": 131, "PARTIAL": 1})
    if len(rows) != 132 or counts != expected:
        raise RuntimeError(f"unexpected coverage for {args.expected_profile}: {counts}")
    if args.expected_profile in {"PILOT_PZ002", "PILOT_PZ002_PZ017"} and not any(
        row.get("parameterCode") == "PZ-002" and row["executionStatus"] == "PARTIAL"
        for row in rows
    ):
        raise RuntimeError("pilot has no PZ-002 partial coverage row")
    if args.expected_profile == "PILOT_PZ002_PZ017" and not any(
        row.get("parameterCode") == "PZ-017" and row["executionStatus"] == "PARTIAL"
        for row in rows
    ):
        raise RuntimeError("pilot has no PZ-017 partial coverage row")
    _, findings = request("GET", f"/api/checks/{check_id}/findings")
    if family_profile and findings["items"]:
        raise RuntimeError("fact-family review-only profile emitted a finding")
    family_summary = None
    candidate_summary = None
    observation_summary = None
    review_candidate_summary = None
    if family_profile:
        _, pilot = request("GET", f"/api/checks/{check_id}/pilot-results")
        family = pilot.get("factFamily")
        if (pilot.get("status") != "READY" or not isinstance(family, dict)
                or family.get("schemaVersion") != "fact-family-proposals-v1"
                or family.get("findingCount") != 0
                or not isinstance(family.get("facts"), list)
                or not isinstance(family.get("comparisons"), list)
                or len(family["comparisons"]) != 5
                or any(row.get("status") != "ABSTAIN" for row in family["comparisons"])):
            raise RuntimeError("fact-family result missing or malformed")
        family_summary = {"factCount": len(family["facts"]),
                          "comparisons": [{"parameterCode": row.get("parameterCode"),
                                           "status": row.get("status"),
                                           "reasonCodes": row.get("reasonCodes")}
                                          for row in family["comparisons"]],
                          "contentHash": family.get("contentHash")}
        if args.expected_profile in {"FACT_FAMILY_CANDIDATE_PREVIEW_V1", "FACT_FAMILY_CANDIDATE_OBSERVATIONS_V1"}:
            preview = pilot.get("candidateFamilyPreview")
            if (not isinstance(preview, dict)
                    or preview.get("schemaVersion") != "candidate-family-preview-v1"
                    or preview.get("scope") != "RUN_COMMITTED_SOURCES"
                    or preview.get("purpose") != "REVIEW_ONLY"
                    or preview.get("inputManifestHash") != family.get("inputManifestHash")
                    or preview.get("objectId") != family.get("objectId")
                    or preview.get("findingCount") is not None
                    or preview.get("parameterCoverage") is not None
                    or preview.get("outputCount") != 47
                    or not isinstance(preview.get("codeRows"), list)
                    or len(preview["codeRows"]) != 47
                    or len({row.get("parameterCode") for row in preview["codeRows"]
                            if isinstance(row, dict)}) != 47
                    or any(not isinstance(row, dict) or row.get("status") != "ABSTAIN"
                           or not isinstance(row.get("reasonCodes"), list)
                           or not isinstance(row.get("candidateLeads"), list)
                           or row.get("leadCount") != len(row["candidateLeads"])
                           for row in preview["codeRows"])):
                raise RuntimeError("47-code candidate preview missing or malformed")
            candidate_summary = {
                "codeCount": len(preview["codeRows"]),
                "leadCount": sum(row["leadCount"] for row in preview["codeRows"]),
                "contentHash": preview.get("contentHash"),
            }
        if args.expected_profile == "FACT_FAMILY_CANDIDATE_OBSERVATIONS_V1":
            observations = pilot.get("candidateFamilyObservations")
            if (not isinstance(observations, dict)
                    or observations.get("schemaVersion") != "candidate-family-observations-v1"
                    or observations.get("purpose") != "REVIEW_ONLY"
                    or observations.get("inputManifestHash") != family.get("inputManifestHash")
                    or observations.get("objectId") != family.get("objectId")
                    or observations.get("findingCount") is not None
                    or observations.get("parameterCoverage") is not None
                    or not isinstance(observations.get("codeRows"), list)
                    or len(observations["codeRows"]) != 47
                    or any(not isinstance(row, dict) or row.get("status") != "REVIEW_ONLY"
                           for row in observations["codeRows"])
                    or not isinstance(observations.get("observations"), list)
                    or observations.get("outputCount") != len(observations["observations"])
                    or observations.get("candidateRulePackSha256") != preview.get("candidateRulePackSha256")):
                raise RuntimeError("47-code candidate observations missing or malformed")
            if (args.expected_observations is not None
                    and observations["outputCount"] != args.expected_observations):
                raise RuntimeError("unexpected candidate observation count")
            observation_summary = {
                "codeCount": len(observations["codeRows"]),
                "observationCount": observations["outputCount"],
                "contentHash": observations.get("contentHash"),
            }
            review_candidates = pilot.get("reviewCandidates")
            if (not isinstance(review_candidates, dict)
                    or review_candidates.get("schemaVersion") != "review-candidates-v1"
                    or review_candidates.get("resultType") != "REVIEW_CANDIDATE"
                    or review_candidates.get("findingCount") is not None
                    or review_candidates.get("parameterCoverage") is not None
                    or review_candidates.get("candidateCount") != len(
                        review_candidates.get("candidates", []))):
                raise RuntimeError("review candidate artifact missing or malformed")
            if (args.expected_review_candidates is not None
                    and review_candidates["candidateCount"] != args.expected_review_candidates):
                raise RuntimeError("unexpected review candidate count")
            review_candidate_summary = {
                "candidateCount": review_candidates["candidateCount"],
                "contentHash": review_candidates["contentHash"],
                "candidates": [{key: item[key] for key in (
                    "candidateId", "parameterCode", "kind", "sourceFileId",
                    "sourceSha256", "pageNumber", "lineText", "locator")}
                    for item in review_candidates["candidates"]],
            }

    receipt = {
        "objectId": object_id,
        "reusedExistingObject": bool(args.existing_object_id),
        "uploads": uploads,
        "publicManifestSha256": (hashlib.sha256(args.public_manifest.read_bytes()).hexdigest()
                                 if args.public_manifest else None),
        "checkId": check_id,
        "status": check["status"],
        "coverage": counts,
        "findingCount": len(findings["items"]),
        "factFamily": family_summary,
        "candidateFamilyPreview": candidate_summary,
        "candidateFamilyObservations": observation_summary,
        "reviewCandidates": review_candidate_summary,
    }
    serialized = json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        temp = args.receipt.with_name(args.receipt.name + ".tmp")
        temp.write_text(serialized, encoding="utf-8")
        temp.replace(args.receipt)
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    main()
