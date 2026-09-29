#!/usr/bin/env python3
"""Sequential local OCR and lexical probe for a bounded public page selection."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.ocr_label_probe import probe_cached_ocr_labels  # noqa: E402
from inspector_worker.public_family_ocr_queue import build_public_family_ocr_queue  # noqa: E402
from inspector_worker.public_ocr_cache import cached_public_ocr_page  # noqa: E402

RENDERER = "renderer-pdfium-5.12.1-linux-x86_64-v1"
PROVIDER = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1"
DPI = 120
SCRIPT = "eslav"


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".tmp",
                                     delete=False) as target:
        temporary = Path(target.name)
        try:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _chunks(line_count: int) -> list[list[int]]:
    if line_count < 0:
        raise ValueError("negative OCR line count")
    chunks = []
    start = 0
    while start < line_count:
        end = min(start + 128, line_count)
        chunks.append(list(range(start, end)))
        if end == line_count:
            break
        start = end - 1  # retain one-line overlap for split labels
    return chunks


def _select(queue: dict[str, Any], selection: dict[str, Any]) -> tuple[list[dict[str, Any]], set[tuple[str, int]]]:
    if (queue.get("schemaVersion") not in {"public-family-ocr-queue-v1",
                                           "public-family-ocr-queue-v2"}
            or queue.get("disposition") != "OCR_REVIEW_QUEUE_ONLY_ABSTAIN"
            or queue.get("inputEnumerationComplete") is not True
            or queue.get("totals", {}).get("candidateCodeCount") != 47
            or queue.get("totals", {}).get("candidateFamilyCount") != 9
            or queue.get("totals", {}).get("selectedUniqueOcrPages") != len(queue.get("uniqueSelectedPages", []))
            or selection.get("schemaVersion") != "public-family-ocr-batch-selection-v1"
            or selection.get("disposition") != "OCR_REVIEW_ONLY_ABSTAIN"):
        raise ValueError("OCR queue or selection schema invalid")
    previous = selection.get("excludedPreviouslyReviewedKrPages")
    title = selection.get("excludedPreviouslyCachedTitlePage")
    selected = selection.get("selectedPages")
    if (not isinstance(previous, list) or len(previous) != 14
            or not isinstance(title, dict) or title != {"sourceFileId": "F0150", "pageNumber": 1}
            or not isinstance(selected, list) or not 1 <= len(selected) <= 20):
        raise ValueError("selected OCR batch or exclusions invalid")
    prior_keys = {(item["sourceFileId"], item["pageNumber"]) for item in previous}
    prior_keys.add(("F0150", 1))
    if len(prior_keys) != 15:
        raise ValueError("duplicate prior OCR page exclusions")
    by_key = {(item["sourceFileId"], item["pageNumber"]): item
              for item in queue["uniqueSelectedPages"]}
    if len(by_key) != len(queue["uniqueSelectedPages"]):
        raise ValueError("duplicate OCR page in queue")
    seen: set[tuple[str, int]] = set()
    normalized = []
    for item in selected:
        required = {"sourceFileId", "pageNumber", "sourceSha256", "pageArtifactSha256",
                    "families", "selectionReason"}
        if (not isinstance(item, dict) or not required <= set(item)
                or set(item) - required not in (set(), {"dpi"})
                or ("dpi" in item and
                    (type(item["dpi"]) is not int or not 72 <= item["dpi"] <= DPI))):
            raise ValueError("selected OCR page fields invalid")
        key = item["sourceFileId"], item["pageNumber"]
        source = by_key.get(key)
        if (source is None or key in prior_keys or key in seen
                or any(item[field] != source[field] for field in
                       ("sourceSha256", "pageArtifactSha256", "families"))
                or not isinstance(item["selectionReason"], str)
                or not item["selectionReason"]):
            raise ValueError("selected page missing, excluded, duplicate, or hash-drifted")
        seen.add(key)
        normalized.append(item)
    return normalized, prior_keys & set(by_key)


def _probe_page(args: argparse.Namespace, page: dict[str, Any],
                result: dict[str, Any], source_info: dict[str, Any]) -> dict[str, Any]:
    artifact = result["artifact"]
    line_count = result["lineCount"]
    dpi = page.get("dpi", DPI)
    leads: list[dict[str, Any]] = []
    probe_hashes: list[str] = []
    if line_count:
        for indices in _chunks(line_count):
            probe = probe_cached_ocr_labels(
                args.manifest, args.index.parent, args.cache,
                page["sourceFileId"], page["pageNumber"],
                expected_object_id=source_info["objectId"],
                expected_stage=source_info["stage"],
                expected_section=source_info["section"],
                line_indices=indices, dpi=dpi, script=SCRIPT,
                renderer_profile_id=RENDERER, provider_profile_id=PROVIDER,
            )
            if (probe["sourceSha256"] != page["sourceSha256"]
                    or probe["pageNumber"] != page["pageNumber"]
                    or probe["cacheKey"] != result["cacheKey"]
                    or probe["artifactContentHash"] != result["artifactContentHash"]
                    or probe["pinnedCodeCount"] != 47):
                raise ValueError("OCR probe differs from selected page provenance")
            probe_hashes.append(probe["reportSha256"])
            leads.extend(probe["leads"])
    unique_leads: dict[str, dict[str, Any]] = {}
    for lead in leads:
        digest = _hash(json.dumps(lead, ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":"), allow_nan=False).encode())
        unique_leads[digest] = lead
    typed = [unique_leads[key] for key in sorted(unique_leads)]
    exact_source = [lead for lead in typed
                    if lead["matchKind"] == "LITERAL_LABEL_IN_SINGLE_OCR_LINE"
                    and lead["sourceGate"] == "PAGE_STAGE_SECTION_AND_ENTITY_REVIEW_REQUIRED"]
    section_unresolved = [lead for lead in typed
                          if lead["matchKind"] == "LITERAL_LABEL_IN_SINGLE_OCR_LINE"
                          and lead["sourceGate"] == "DRAWING_SECTION_RESOLUTION_REQUIRED"]
    cache_bytes = Path(result["cachePath"]).read_bytes()
    cache_payload = json.loads(cache_bytes)
    return {
        "sourceFileId": page["sourceFileId"], "pageNumber": page["pageNumber"],
        "sourceSha256": page["sourceSha256"],
        "pageArtifactSha256": page["pageArtifactSha256"],
        "objectId": source_info["objectId"], "manifestStage": source_info["stage"],
        "manifestSection": source_info["section"],
        "familiesInQueue": page["families"],
        "selectionReason": page["selectionReason"],
        "ocrDpi": dpi,
        "cacheStatus": result["cacheStatus"], "cacheKey": result["cacheKey"],
        "cacheContentHash": cache_payload["contentHash"],
        "cacheFileSha256": _hash(cache_bytes),
        "ocrArtifactContentHash": result["artifactContentHash"],
        "renderArtifactSha256": artifact["render"]["sha256"],
        "ocrLineCount": line_count,
        "probeSegmentHashes": probe_hashes, "leadCount": len(typed),
        "exactSourceLiteralLeadCount": len(exact_source),
        "sectionUnresolvedLiteralLeadCount": len(section_unresolved),
        "labelLeadCodes": sorted({lead["parameterCode"] for lead in typed}),
        "exactSourceLiteralLeadCodes": sorted({lead["parameterCode"] for lead in exact_source}),
        "sectionUnresolvedLiteralLeadCodes": sorted({lead["parameterCode"] for lead in section_unresolved}),
        "leads": typed,
        "status": "OCR_PROBED" if line_count else "OCR_EMPTY_UNINFORMATIVE",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084")
    args = parser.parse_args()

    queue_bytes, selection_bytes = args.queue.read_bytes(), args.selection.read_bytes()
    queue, selection = json.loads(queue_bytes), json.loads(selection_bytes)
    if selection.get("sourceQueueSha256") != _hash(queue_bytes):
        raise ValueError("selection references stale OCR queue")
    if (queue["auditSha256"] != _hash(args.audit.read_bytes())
            or queue["sourceMatrixSha256"] != _hash(args.matrix.read_bytes())):
        raise ValueError("queue audit or source matrix SHA-256 changed")
    selected, already_reviewed = _select(queue, selection)
    recomputed = build_public_family_ocr_queue(
        args.manifest, args.index.parent, args.audit, args.matrix,
        max_per_family=queue["parameters"]["maxPerFamily"],
        neighbor_radius=queue["parameters"]["neighborRadius"],
        planning_version=int(queue["schemaVersion"].rsplit("v", 1)[1]),
    )
    if queue != recomputed:
        raise ValueError("OCR queue differs from current audited public index")
    # Code-role mapping comes from the independently verified family queue.
    by_family_page = {
        (item["sourceFileId"], item["pageNumber"]): item
        for family in queue["families"] for item in family["queue"]
    }
    report: dict[str, Any] = {
        "schemaVersion": "public-family-ocr-batch-triage-v1",
        "disposition": "REVIEW_ONLY_ABSTAIN", "findingCount": None,
        "parameterCoverage": None, "absenceProof": False,
        "queueSha256": _hash(queue_bytes), "selectionSha256": _hash(selection_bytes),
        "auditSha256": queue["auditSha256"],
        "sourceMatrixSha256": queue["sourceMatrixSha256"],
        "manifestSha256": queue["manifestSha256"],
        "profile": {"dpi": DPI, "script": SCRIPT,
                    "rendererProfileId": RENDERER, "providerProfileId": PROVIDER},
        "selectedPageCount": len(selected),
        "priorReviewedQueuePages": sorted(
            [{"sourceFileId": sid, "pageNumber": page}
             for sid, page in already_reviewed],
            key=lambda item: (item["sourceFileId"], item["pageNumber"])),
        "items": [], "summary": {},
    }

    def checkpoint() -> None:
        completed = {(item["sourceFileId"], item["pageNumber"])
                     for item in report["items"]
                     if item["status"] in {"OCR_PROBED", "OCR_EMPTY_UNINFORMATIVE"}}
        failed = sum(item["status"] == "ERROR" for item in report["items"])
        all_keys = {(item["sourceFileId"], item["pageNumber"])
                    for item in queue["uniqueSelectedPages"]}
        remaining = all_keys - already_reviewed - completed
        report["summary"] = {
            "queuedUniquePages": len(all_keys),
            "priorReviewedQueuePages": len(already_reviewed),
            "attemptedSelectedPages": len(report["items"]),
            "completedSelectedPages": len(completed),
            "failedSelectedPages": failed,
            "remainingUnprocessedQueuePages": len(remaining),
            "remainingUnprocessedQueue": [
                {"sourceFileId": sid, "pageNumber": page}
                for sid, page in sorted(remaining)],
            "cacheHits": sum(item.get("cacheStatus") == "HIT" for item in report["items"]),
            "cacheMissesWritten": sum(item.get("cacheStatus") == "MISS_WRITTEN" for item in report["items"]),
            "totalLexicalLeads": sum(item.get("leadCount", 0) for item in report["items"]),
            "pagesWithExactSourceLiteralLead": sum(
                item.get("exactSourceLiteralLeadCount", 0) > 0 for item in report["items"]),
            "pagesWithSectionUnresolvedLiteralLead": sum(
                item.get("sectionUnresolvedLiteralLeadCount", 0) > 0 for item in report["items"]),
            "familiesRepresentedInSelection": sorted(
                {family for item in selected for family in item["families"]}),
        }
        _write_atomic(args.output, report)

    checkpoint()
    for order, page in enumerate(selected, 1):
        key = page["sourceFileId"], page["pageNumber"]
        source_info = by_family_page[key]
        try:
            result = cached_public_ocr_page(
                manifest_path=args.manifest,
                source_id=page["sourceFileId"], page_number=page["pageNumber"],
                archive_path=args.archive, cache_root=args.cache,
                base_url=args.ocr_url, dpi=page.get("dpi", DPI), script=SCRIPT,
                renderer_profile_id=RENDERER, provider_profile_id=PROVIDER,
                index_path=args.index,
            )
            if (result["sourceSha256"] != page["sourceSha256"]
                    or result["indexDisposition"] != "OCR_REQUIRED"):
                raise ValueError("OCR cache result differs from selected public index page")
            item = _probe_page(args, page, result, {
                "objectId": source_info["objectId"],
                "stage": source_info["manifestStage"],
                "section": source_info["manifestSection"],
            })
        except Exception as error:
            item = {"sourceFileId": page["sourceFileId"],
                    "pageNumber": page["pageNumber"],
                    "sourceSha256": page["sourceSha256"],
                    "pageArtifactSha256": page["pageArtifactSha256"],
                    "selectionReason": page["selectionReason"],
                    "status": "ERROR", "errorType": type(error).__name__,
                    "error": str(error)[:300]}
        report["items"].append(item)
        checkpoint()
        print(json.dumps({"order": order, "total": len(selected),
                          "sourceFileId": page["sourceFileId"],
                          "pageNumber": page["pageNumber"],
                          "status": item["status"],
                          "cacheStatus": item.get("cacheStatus"),
                          "leadCount": item.get("leadCount"),
                          "remainingUnprocessedQueuePages": report["summary"]["remainingUnprocessedQueuePages"]},
                         ensure_ascii=False, sort_keys=True), flush=True)
        if sum(value["status"] == "ERROR" for value in report["items"][-3:]) == 3:
            print("three consecutive page errors; stopping bounded OCR packet", file=sys.stderr)
            return 2
    return 0 if not any(item["status"] == "ERROR" for item in report["items"]) else 2


if __name__ == "__main__":
    raise SystemExit(main())
