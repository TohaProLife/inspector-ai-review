#!/usr/bin/env python3
"""Group audited public OCR labels for visual review, without creating facts."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def triage(report_path: Path, audit_path: Path, receipts: Path) -> dict:
    report_raw = report_path.read_bytes()
    report = json.loads(report_raw)
    audit = json.loads(audit_path.read_bytes())
    if (audit.get("status") != "PASS"
            or audit.get("purpose") != "REVIEW_ONLY"
            or audit.get("reportSha256") != digest(report_raw)
            or report.get("disposition") != "REVIEW_ONLY_ABSTAIN"
            or report.get("findingCount") is not None
            or report.get("parameterCoverage") is not None
            or report.get("processedPageCount") != report.get("selectedPageCount")
            or not isinstance(report.get("pages"), list)
            or len(report["pages"]) != audit.get("pageCount")
            or not isinstance(audit.get("receiptSha256"), dict)):
        raise ValueError("public OCR report is not the audited review-only batch")
    pages = report["pages"]
    if set(audit["receiptSha256"]) != {
            f"{page['sourceFileId']}-p{page['pageNumber']}" for page in pages}:
        raise ValueError("public OCR receipt set differs from audit")
    role_counts: Counter[str] = Counter()
    code_counts: Counter[str] = Counter()
    clusters: dict[tuple[str, int, str, str, str, int], dict] = {}
    for summary in pages:
        key = f"{summary['sourceFileId']}-p{summary['pageNumber']}"
        path = receipts / f"{key}.json"
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"public OCR receipt missing or symlinked: {key}")
        raw = path.read_bytes()
        if digest(raw) != audit["receiptSha256"][key]:
            raise ValueError(f"public OCR receipt SHA differs: {key}")
        receipt = json.loads(raw)
        if ({name: value for name, value in receipt.items() if name != "leads"} != summary
                or receipt.get("leadCount") != len(receipt.get("leads", []))
                or receipt.get("findingCount") is not None
                or receipt.get("parameterCoverage") is not None):
            raise ValueError(f"public OCR receipt summary differs: {key}")
        for lead in receipt["leads"]:
            role = lead.get("labelRole")
            if (role not in {"FEATURE", "SCOPE"}
                    or not isinstance(lead.get("parameterCode"), str)
                    or not isinstance(lead.get("featureOrScopeKey"), str)
                    or not isinstance(lead.get("literalLabel"), str)
                    or not isinstance(lead.get("locators"), list)
                    or not lead["locators"]):
                raise ValueError(f"public OCR lead invalid: {key}")
            role_counts[role] += 1
            code_counts[lead["parameterCode"]] += 1
            for locator in lead["locators"]:
                index = locator.get("lineIndex")
                if type(index) is not int or index < 0 or not isinstance(locator.get("text"), str):
                    raise ValueError(f"public OCR locator invalid: {key}")
                cluster_key = (receipt["sourceFileId"], receipt["pageNumber"],
                               lead["parameterCode"], role,
                               lead["featureOrScopeKey"], index)
                cluster = clusters.setdefault(cluster_key, {
                    "sourceFileId": receipt["sourceFileId"],
                    "sourceSha256": receipt["sourceSha256"],
                    "pageNumber": receipt["pageNumber"],
                    "parameterCode": lead["parameterCode"],
                    "labelRole": role,
                    "featureOrScopeKey": lead["featureOrScopeKey"],
                    "lineIndex": index,
                    "lineText": locator["text"],
                    "bboxPx": locator.get("bboxPx"),
                    "score": locator.get("score"),
                    "ocrArtifactContentHash": receipt["ocrArtifactContentHash"],
                    "receiptSha256": digest(raw),
                    "literalLabels": [],
                    "reviewStatus": "UNREVIEWED",
                })
                if (cluster["lineText"] != locator["text"]
                        or cluster["bboxPx"] != locator.get("bboxPx")
                        or cluster["score"] != locator.get("score")):
                    raise ValueError(f"public OCR aliases disagree on locator: {key}")
                if lead["literalLabel"] not in cluster["literalLabels"]:
                    cluster["literalLabels"].append(lead["literalLabel"])
    if (sum(role_counts.values()) != report["lexicalLeadCount"]
            or sum(code_counts.values()) != audit["lexicalLeadCount"]
            or dict(sorted(code_counts.items())) != audit["leadCountsByCode"]):
        raise ValueError("public OCR lead counts differ from audit")
    grouped: dict[str, list[dict]] = defaultdict(list)
    for cluster in clusters.values():
        cluster["literalLabels"].sort()
        grouped[cluster["labelRole"]].append(cluster)
    for rows in grouped.values():
        rows.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                    item["parameterCode"], item["lineIndex"],
                                    item["featureOrScopeKey"]))
    result = {
        "schemaVersion": "public-family-ocr-triage-v1",
        "disposition": "REVIEW_ONLY_ABSTAIN",
        "reportSha256": digest(report_raw),
        "auditSha256": digest(audit_path.read_bytes()),
        "pageCount": audit["pageCount"],
        "lexicalLeadCount": audit["lexicalLeadCount"],
        "rawLeadCountsByRole": dict(sorted(role_counts.items())),
        "uniqueLineCountsByRole": {role: len(grouped[role]) for role in ("FEATURE", "SCOPE")},
        "rawLeadCountsByCode": dict(sorted(code_counts.items())),
        "featureLinesForVisualReview": grouped["FEATURE"],
        "findingCount": None,
        "parameterCoverage": None,
    }
    result["contentHash"] = digest(canonical(result))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("report", "audit", "receipts", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    result = triage(args.report, args.audit, args.receipts)
    if args.output.exists():
        parser.error("output already exists")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical(result) + b"\n")
    print(json.dumps({name: result[name] for name in
                      ("pageCount", "lexicalLeadCount", "rawLeadCountsByRole",
                       "uniqueLineCountsByRole")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
