#!/usr/bin/env python3
"""Summarize a bounded 80/47-code OCR batch without promoting lexical leads."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "output/unresolved-ocr-20260927"


def load(name: str) -> tuple[dict, str]:
    raw = (DIR / name).read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def summarize() -> dict:
    queue, queue_sha = load("queue-v2.json")
    batch, batch_sha = load("batch-v2.json")
    policy, policy_sha = load("pattern-policy.json")
    first, first_sha = load("first-attempt.json")
    expected_codes = {row["parameterCode"] for row in json.loads(
        (ROOT / "output/unresolved-public-summary-20260927/summary.json").read_bytes())["parameters"]}
    if (queue["schemaVersion"] != "unresolved-targeted-ocr-queue-v2"
            or batch["schemaVersion"] != "unresolved-targeted-ocr-batch-v1"
            or batch["queueSha256"] != queue_sha
            or queue["patternPolicySha256"] != policy_sha
            or set(policy["patterns"]) != expected_codes
            or len(expected_codes) != 80 or len(queue["pages"]) != 64
            or batch["summary"]["completedPages"] != 64
            or batch["summary"]["failedPages"] != 0
            or first["items"][-1]["errorType"] != "TimeoutError"):
        raise ValueError("bounded OCR receipt or 80-code inventory invalid")
    selected = {(item["sourceFileId"], item["pageNumber"]): item for item in queue["pages"]}
    if len(selected) != 64 or len(batch["items"]) != 64:
        raise ValueError("selected OCR page duplicate or missing")
    all80 = Counter()
    aligned80 = Counter()
    gates47 = Counter()
    codes47 = Counter()
    role_counts = Counter()
    batch_counts = Counter()
    page_summaries = []
    for item in batch["items"]:
        key = item["sourceFileId"], item["pageNumber"]
        source = selected.pop(key, None)
        if (source is None or item["status"] != "OCR_PROBED"
                or item["sourceSha256"] != source["sourceSha256"]
                or item["pageArtifactSha256"] != source["pageArtifactSha256"]
                or item["ocrDpi"] != source["dpi"]
                or item["candidate47"]["probedCodeCount"] != 47
                or item["unresolved80"]["probedCodeCount"] != 80
                or item["candidate47"]["sampleLeadsTruncated"]
                or item["unresolved80"]["sampleLeadsTruncated"]):
            raise ValueError("page OCR, source SHA, DPI, or lexical receipt invalid")
        role_counts[item["manifestRoleGate"]] += 1
        for name in item["sourceBatches"]:
            batch_counts[name] += 1
        own = {}
        for code, count in item["unresolved80"]["leadCountByCode"].items():
            if code not in expected_codes:
                raise ValueError("non-unresolved code in 80-code probe")
            all80[code] += count
            if set(policy["codeSources"][code]) & set(item["sourceBatches"]):
                aligned80[code] += count
                own[code] = count
        for lead in item["candidate47"]["sampleLeads"]:
            gates47[lead["sourceGate"]] += 1
            codes47[lead["parameterCode"]] += 1
        page_summaries.append({
            "sourceFileId": key[0], "pageNumber": key[1],
            "manifestStage": item["manifestStage"],
            "manifestSection": item["manifestSection"],
            "manifestRoleGate": item["manifestRoleGate"],
            "sourceBatches": item["sourceBatches"],
            "sourceSha256": item["sourceSha256"],
            "pageArtifactSha256": item["pageArtifactSha256"],
            "ocrArtifactContentHash": item["ocrArtifactContentHash"],
            "ocrDpi": item["ocrDpi"], "cacheStatus": item["cacheStatus"],
            "ocrLineCount": item["ocrLineCount"],
            "unresolved80LeadCount": item["unresolved80"]["lexicalLeadCount"],
            "proposalBatchAligned80LeadCount": sum(own.values()),
            "proposalBatchAligned80Codes": own,
            "candidate47LeadCount": item["candidate47"]["lexicalLeadCount"],
            "candidate47Codes": item["candidate47"]["codesWithLeads"],
            "disposition": "LEXICAL_REVIEW_ONLY_UNKNOWN",
        })
    if selected or sum(all80.values()) != batch["summary"]["unresolved80LexicalLeads"] or sum(
            codes47.values()) != batch["summary"]["candidate47LexicalLeads"]:
        raise ValueError("page aggregate differs from bounded OCR report")
    if len(batch["cacheVerification"]) != 3 or any(
            row["cacheStatus"] != "HIT" for row in batch["cacheVerification"]):
        raise ValueError("repeat cache HIT verification incomplete")
    return {
        "schemaVersion": "unresolved-targeted-ocr-triage-v1",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "disposition": "REVIEW_ONLY_ABSTAIN",
        "findingCount": None, "parameterCoverage": None, "absenceProof": False,
        "queueSha256": queue_sha, "batchSha256": batch_sha,
        "patternPolicySha256": policy_sha, "firstAttemptSha256": first_sha,
        "summary": {
            "queuedUniquePages": 64, "completedPages": 64, "finalErrors": 0,
            "initialRenderOrProviderTimeouts": 1,
            "cacheHits": batch["summary"]["cacheHits"],
            "cacheMissesWritten": batch["summary"]["cacheMissesWritten"],
            "repeatCacheHits": 3,
            "totalOcrLines": sum(item["ocrLineCount"] for item in batch["items"]),
            "unresolved80CodesProbedPerPage": 80,
            "candidate47CodesProbedPerPage": 47,
            "unresolved80LexicalLeads": sum(all80.values()),
            "unresolved80ProposalBatchAlignedLeads": sum(aligned80.values()),
            "unresolved80OtherBatchLeads": sum(all80.values()) - sum(aligned80.values()),
            "unresolved80CodesWithLeads": len(all80),
            "candidate47LexicalLeads": sum(codes47.values()),
            "candidate47CodesWithLeads": len(codes47),
            "candidate47SourceGates": dict(sorted(gates47.items())),
            "selectedPagesByManifestRoleGate": dict(sorted(role_counts.items())),
            "selectedPageParticipationsByBatch": dict(sorted(batch_counts.items())),
            "ocrRequiredPagesOutsideThisQueueUnknown": 1474 - 64,
        },
        "unresolved80LeadCountByCode": dict(sorted(all80.items())),
        "unresolved80ProposalBatchAlignedLeadCountByCode": dict(sorted(aligned80.items())),
        "candidate47LeadCountByCode": dict(sorted(codes47.items())),
        "pages": page_summaries,
        "interpretation": "PROPOSAL_BATCH_ALIGNMENT_IS_NOT_SOURCE_ROLE_OR_ENGINEERING_FACT",
    }


def main() -> None:
    path = DIR / "triage.json"
    if path.exists():
        raise ValueError("triage receipt already exists")
    raw = (json.dumps(summarize(), ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    path.write_bytes(raw)
    print(json.dumps({"triageSha256": hashlib.sha256(raw).hexdigest(),
                      "bytes": len(raw)}, sort_keys=True))


if __name__ == "__main__":
    main()
