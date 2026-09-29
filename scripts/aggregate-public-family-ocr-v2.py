#!/usr/bin/env python3
"""Combine bounded public OCR packets into one provenance-checked v2 receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


def _load(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name}: expected JSON object")
    return value, hashlib.sha256(raw).hexdigest()


def _key(value: dict[str, Any]) -> tuple[str, int]:
    return value["sourceFileId"], value["pageNumber"]


def _same_page(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    if (_key(actual) != _key(expected)
            or actual["sourceSha256"] != expected["sourceSha256"]
            or actual["pageArtifactSha256"] != expected["pageArtifactSha256"]):
        raise ValueError("OCR page provenance differs from v2 queue")


def aggregate(
    queue: dict[str, Any], queue_sha: str,
    prior_selection: dict[str, Any], prior_selection_sha: str,
    kr_triage: dict[str, Any], kr_triage_sha: str,
    previous: dict[str, Any], previous_sha: str,
    packets: list[tuple[dict[str, Any], str, dict[str, Any], str]],
    context_review: dict[str, Any], context_review_sha: str,
    cache_selection: dict[str, Any], cache_selection_sha: str,
    cache_check: dict[str, Any], cache_check_sha: str,
) -> dict[str, Any]:
    if (queue.get("schemaVersion") != "public-family-ocr-queue-v2"
            or queue.get("disposition") != "OCR_REVIEW_QUEUE_ONLY_ABSTAIN"
            or queue.get("inputEnumerationComplete") is not True
            or queue.get("sourceInventory", {}).get("metadataOnlySourceId") != "F0194"
            or queue.get("totals", {}).get("candidateCodeCount") != 47):
        raise ValueError("v2 queue inventory or scope invalid")
    by_key = {_key(item): item for item in queue["uniqueSelectedPages"]}
    if len(by_key) != len(queue["uniqueSelectedPages"]):
        raise ValueError("duplicate v2 queue page")
    roles = {_key(item): (item["manifestStage"], item["manifestSection"])
             for family in queue["families"] for item in family["queue"]}
    if (prior_selection.get("schemaVersion") != "public-family-ocr-batch-selection-v1"
            or prior_selection.get("priorKrTriageSha256") != kr_triage_sha
            or previous.get("selectionSha256") != prior_selection_sha
            or previous.get("queueSha256") != prior_selection["sourceQueueSha256"]
            or previous.get("disposition") != "REVIEW_ONLY_ABSTAIN"):
        raise ValueError("prior OCR receipts do not chain")
    prior_kr_keys = {_key(item) for item in prior_selection["excludedPreviouslyReviewedKrPages"]}
    if len(prior_kr_keys) != 14:
        raise ValueError("prior KR exclusion inventory changed")
    prior_kr_keys &= set(by_key)
    kr_by_key = {_key(item): item for item in kr_triage["items"]}
    if len(kr_by_key) != len(kr_triage["items"]):
        raise ValueError("duplicate prior KR triage page")
    prior_kr: dict[tuple[str, int], dict[str, Any]] = {}
    for key in prior_kr_keys:
        row = kr_by_key.get(key)
        if row is None or not row.get("cachedOcr") or row.get("reviewStatus") != "ABSTAIN":
            raise ValueError("prior KR page lacks reviewed OCR provenance")
        _same_page(row, by_key[key])
        prior_kr[key] = {
            "sourceFileId": key[0], "pageNumber": key[1],
            "sourceSha256": row["sourceSha256"],
            "pageArtifactSha256": row["pageArtifactSha256"],
            "ocrArtifactContentHash": row["cachedOcr"]["artifactContentHash"],
            "ocrLineCount": row["cachedOcr"]["ocrLineCount"],
            "cacheFileSha256": row["cachedOcr"]["cacheFileSha256"],
            "manifestStage": row["stage"], "manifestSection": row["section"],
            "sourceRoleContextTriage": "PRIOR_KR_REVIEW_ABSTAIN_47_CODE_PROBE_NOT_REPEATED",
            "origin": "PRIOR_KR_REVIEW", "labelProbe47Codes": False,
        }
    prior_pages: dict[tuple[str, int], dict[str, Any]] = {}
    if (previous.get("summary", {}).get("completedSelectedPages") != 12
            or previous.get("summary", {}).get("failedSelectedPages") != 0):
        raise ValueError("previous 12-page OCR packet incomplete")
    for row in previous["items"]:
        key = _key(row)
        if key in by_key:
            if row.get("status") not in {"OCR_PROBED", "OCR_EMPTY_UNINFORMATIVE"}:
                raise ValueError("previous OCR page incomplete")
            _same_page(row, by_key[key])
            prior_pages[key] = {**row, "origin": "PRIOR_12_PAGE_PACKET",
                                "labelProbe47Codes": True,
                                "sourceRoleContextTriage": "PRIOR_PACKET_REVIEW_ONLY"}
    current: dict[tuple[str, int], dict[str, Any]] = {}
    initial_errors: list[dict[str, Any]] = []
    packet_receipts = []
    for selection, selection_sha, report, report_sha in packets:
        if (selection.get("sourceQueueSha256") != queue_sha
                or selection.get("previousCompletedBatchSha256") != previous_sha
                or selection.get("priorKrTriageSha256") != kr_triage_sha
                or report.get("queueSha256") != queue_sha
                or report.get("selectionSha256") != selection_sha
                or report.get("auditSha256") != queue["auditSha256"]
                or report.get("sourceMatrixSha256") != queue["sourceMatrixSha256"]
                or report.get("manifestSha256") != queue["manifestSha256"]
                or report.get("disposition") != "REVIEW_ONLY_ABSTAIN"
                or len(selection["selectedPages"]) != len(report["items"])):
            raise ValueError("v2 OCR packet linkage or completeness invalid")
        packet_receipts.append({"selectionSha256": selection_sha,
                                "reportSha256": report_sha,
                                "pageCount": len(report["items"])})
        for selected, row in zip(selection["selectedPages"], report["items"], strict=True):
            key = _key(selected)
            if key not in by_key or key in prior_kr or key in prior_pages or key in current:
                raise ValueError("v2 OCR packet includes excluded or duplicate page")
            _same_page(selected, by_key[key])
            _same_page(row, by_key[key])
            if row.get("status") == "ERROR":
                initial_errors.append({
                    "sourceFileId": key[0], "pageNumber": key[1],
                    "sourceSha256": row["sourceSha256"],
                    "pageArtifactSha256": row["pageArtifactSha256"],
                    "errorType": row["errorType"], "error": row["error"],
                    "selectionSha256": selection_sha, "reportSha256": report_sha,
                })
                continue
            if (row.get("status") not in {"OCR_PROBED", "OCR_EMPTY_UNINFORMATIVE"}
                    or row.get("cacheStatus") not in {"HIT", "MISS_WRITTEN"}):
                raise ValueError("v2 OCR packet page status invalid")
            if (row.get("manifestStage"), row.get("manifestSection")) != roles[key]:
                raise ValueError("OCR page source role differs from v2 family queue")
            current[key] = {**row, "origin": "V2_FOLLOWUP_PACKET",
                            "labelProbe47Codes": True}
    if set(prior_kr) | set(prior_pages) | set(current) != set(by_key):
        raise ValueError("v2 selected OCR page inventory not complete")
    if len(current) != 33 or len(prior_pages) != 12 or len(prior_kr) != 3:
        raise ValueError("v2 33-page followup partition differs from pinned plan")
    if ({_key(item) for item in initial_errors} != {("F0193", 55), ("F0193", 56)}
            or len(initial_errors) != 2
            or any(item["errorType"] != "ValueError" or
                   item["error"] != "renderer output does not match source page request"
                   for item in initial_errors)
            or any(current[_key(item)].get("ocrDpi") != 115 for item in initial_errors)):
        raise ValueError("oversized render failures or 115 DPI recovery differ from receipt")
    if (context_review.get("schemaVersion") != "public-family-ocr-v2-context-review-v1"
            or context_review.get("queueSha256") != queue_sha
            or context_review.get("disposition") != "PROPOSAL_REVIEW_ONLY"):
        raise ValueError("context review receipt invalid")
    reviewed = {_key(item): item for item in context_review["items"]}
    lead_keys = {key for key, item in current.items() if item["leadCount"]}
    if set(reviewed) != lead_keys or len(reviewed) != len(context_review["items"]):
        raise ValueError("context review does not cover exactly the new OCR lead pages")
    for key, row in current.items():
        if key in reviewed:
            review = reviewed[key]
            if (sorted(review["leadCodes"]) != row["labelLeadCodes"]
                    or review["manifestStage"] != row["manifestStage"]
                    or review["manifestSection"] != row["manifestSection"]
                    or review["sourceSha256"] != row["sourceSha256"]
                    or review["pageArtifactSha256"] != row["pageArtifactSha256"]
                    or review["ocrArtifactContentHash"] != row["ocrArtifactContentHash"]
                    or not isinstance(review.get("reason"), str)
                    or len(review["reason"].strip()) < 20
                    or review["reviewStatus"] not in {
                        "SOURCE_ROLE_OR_ENTITY_UNRESOLVED", "NON_MATCHING_CONTEXT"}):
                raise ValueError("OCR lead review differs from page roles or labels")
            row["sourceRoleContextTriage"] = review
        else:
            row["sourceRoleContextTriage"] = "NO_LITERAL_LABEL_LEAD_NOT_ABSENCE_PROOF"
    cache_keys = {("F0178", 14), ("F0193", 55)}
    if (cache_selection.get("sourceQueueSha256") != queue_sha
            or cache_check.get("queueSha256") != queue_sha
            or cache_check.get("selectionSha256") != cache_selection_sha
            or cache_check.get("summary", {}).get("completedSelectedPages") != 2
            or {_key(item) for item in cache_selection["selectedPages"]} != cache_keys
            or {_key(item) for item in cache_check["items"]} != cache_keys):
        raise ValueError("cache HIT verification receipt invalid")
    for row in cache_check["items"]:
        original = current[_key(row)]
        if (row.get("cacheStatus") != "HIT"
                or row.get("status") != "OCR_PROBED"
                or row.get("ocrDpi") != original.get("ocrDpi", 120)
                or row.get("ocrArtifactContentHash") != original["ocrArtifactContentHash"]
                or row.get("cacheFileSha256") != original["cacheFileSha256"]
                or row.get("leadCount") != original["leadCount"]):
            raise ValueError("cache HIT differs from original OCR artifact")
    items = [({**(prior_kr.get(key) or prior_pages.get(key) or current[key]),
               "familiesInQueue": by_key[key]["families"]}) for key in sorted(by_key)]
    newly_probed = [row for row in items if row["origin"] == "V2_FOLLOWUP_PACKET"]
    all_47 = [row for row in items if row["labelProbe47Codes"]]
    return {
        "schemaVersion": "public-family-ocr-v2-completed-batch-v1",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "disposition": "REVIEW_ONLY_ABSTAIN",
        "findingCount": None, "parameterCoverage": None, "absenceProof": False,
        "queueSha256": queue_sha, "priorKrTriageSha256": kr_triage_sha,
        "previous12PageTriageSha256": previous_sha,
        "contextReviewSha256": context_review_sha,
        "cacheHitVerification": {
            "selectionSha256": cache_selection_sha,
            "reportSha256": cache_check_sha,
            "verifiedPages": 2,
        },
        "packetReceipts": packet_receipts,
        "recoveredInitialErrors": initial_errors,
        "items": items,
        "summary": {
            "v2SelectedUniquePages": len(by_key),
            "priorKrReviewedPages": len(prior_kr),
            "prior12PagePacketPages": len(prior_pages),
            "newlyProbedPages": len(newly_probed),
            "unprocessedSelectedQueuePages": 0,
            "newCacheHits": sum(row["cacheStatus"] == "HIT" for row in newly_probed),
            "newCacheMissesWritten": sum(row["cacheStatus"] == "MISS_WRITTEN" for row in newly_probed),
            "separateCacheHitVerificationPages": 2,
            "newLexicalLeads": sum(row["leadCount"] for row in newly_probed),
            "newPagesWithLexicalLeads": sum(row["leadCount"] > 0 for row in newly_probed),
            "newLeadPagesContextReviewed": len(reviewed),
            "recoveredRenderLimitFailures": len(initial_errors),
            "finalFailedSelectedQueuePages": 0,
            "pagesProbedAgainst47Codes": len(all_47),
            "priorKrPagesNotReprobedAgainst47Codes": len(prior_kr),
            "ocrRequiredPagesOutsideSelectedV2Queue": (
                queue["totals"]["ocrRequiredPagesInIndex"] - len(by_key)),
            "queueCapped": queue["queueCapped"],
        },
    }


def _write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".tmp",
                                     delete=False) as target:
        temporary = Path(target.name)
        target.write(content)
        target.flush()
        os.fsync(target.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("queue", "prior-selection", "kr-triage", "previous", "selection-a",
                 "batch-a", "selection-b", "batch-b", "selection-c", "batch-c",
                 "context-review", "cache-selection", "cache-check", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    inputs = {name: _load(getattr(args, name.replace("-", "_")))
              for name in ("queue", "prior-selection", "kr-triage", "previous",
                           "selection-a", "batch-a", "selection-b", "batch-b",
                           "selection-c", "batch-c", "context-review",
                           "cache-selection", "cache-check")}
    report = aggregate(*inputs["queue"], *inputs["prior-selection"],
                       *inputs["kr-triage"], *inputs["previous"],
                       [(inputs["selection-a"][0], inputs["selection-a"][1],
                         inputs["batch-a"][0], inputs["batch-a"][1]),
                        (inputs["selection-b"][0], inputs["selection-b"][1],
                         inputs["batch-b"][0], inputs["batch-b"][1]),
                        (inputs["selection-c"][0], inputs["selection-c"][1],
                         inputs["batch-c"][0], inputs["batch-c"][1])],
                       *inputs["context-review"],
                       *inputs["cache-selection"], *inputs["cache-check"])
    _write(args.output, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
