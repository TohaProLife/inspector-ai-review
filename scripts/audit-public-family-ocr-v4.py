#!/usr/bin/env python3
"""Read-only integrity audit of the bounded public OCR review batch."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_ocr_cache import (  # noqa: E402
    _cache_request, _load_json, _validate_cache, public_manifest_entry,
)
from inspector_worker.ocr_pilot import canonical_hash  # noqa: E402
from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check(args: argparse.Namespace) -> dict:
    report_bytes = args.report.read_bytes()
    report = json.loads(report_bytes)
    queue_bytes = args.queue.read_bytes()
    queue = json.loads(queue_bytes)
    labels = load_numeric_family_labels(args.label_pack)
    if (report.get("schemaVersion") != "public-family-ocr-v4-batch-v1"
            or report.get("disposition") != "REVIEW_ONLY_ABSTAIN"
            or report.get("findingCount") is not None
            or report.get("parameterCoverage") is not None
            or report.get("manifestSha256") != digest(args.manifest.read_bytes())
            or report.get("auditSha256") != digest(args.index_audit.read_bytes())
            or report.get("queueSha256") != digest(queue_bytes)
            or labels.get("schemaVersion") != "numeric-family-labels-v2"
            or report.get("numericLabelPackSha256") != labels["labelPackSha256"]):
        raise ValueError("OCR batch report provenance or review-only status differs")
    if (queue.get("indexVersionHash") != "7d7dfa2f3e0279a91095"
            or queue.get("auditSha256") != report["auditSha256"]
            or queue.get("manifestSha256") != report["manifestSha256"]):
        raise ValueError("OCR queue is outside audited v4 index")
    selected_rows = queue["uniqueSelectedPages"]
    page_rows = report["pages"]
    selected = {(item["sourceFileId"], item["pageNumber"]): item
                for item in selected_rows}
    pages = {(item["sourceFileId"], item["pageNumber"]): item
             for item in page_rows}
    count = queue.get("totals", {}).get("selectedUniqueOcrPages")
    if (type(count) is not int or not 0 < count <= 1800
            or len(selected_rows) != count or len(page_rows) != count
            or len(selected) != count or len(pages) != count
            or set(selected) != set(pages)
            or report.get("selectedPageCount") != count
            or report.get("processedPageCount") != count
            or len(list(args.progress.glob("*.json"))) != count):
        raise ValueError("OCR selected page set is incomplete or duplicated")
    receipt_hashes = {}
    cache_hashes = {}
    lead_codes: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    line_count = lead_count = 0
    for source_id, page_number in sorted(selected):
        queued = selected[(source_id, page_number)]
        summary = pages[(source_id, page_number)]
        row = public_manifest_entry(args.manifest, source_id)
        path = args.progress / f"{source_id}-p{page_number}.json"
        raw = path.read_bytes()
        receipt = _load_json(raw)
        if (receipt.get("schemaVersion") != "public-family-ocr-v4-page-v1"
                or receipt.get("disposition") != "REVIEW_ONLY_ABSTAIN"
                or receipt.get("findingCount") is not None
                or receipt.get("parameterCoverage") is not None
                or {key: value for key, value in receipt.items() if key != "leads"} != summary
                or receipt["sourceSha256"] != row["sha256"]
                or receipt["sourceSha256"] != queued["sourceSha256"]
                or receipt["pageArtifactSha256"] != queued["pageArtifactSha256"]
                or receipt["families"] != queued["families"]):
            raise ValueError(f"OCR page receipt mismatch: {source_id} p{page_number}")
        dpi = receipt["renderDpi"]
        request = _cache_request(row, page_number, dpi, "eslav",
                                 "renderer-pdfium-5.12.1-linux-x86_64-v1",
                                 "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1")
        cache_key = canonical_hash(request)
        cache_path = args.cache / cache_key[:2] / cache_key[2:4] / f"{cache_key}.json"
        if cache_path.is_symlink() or not cache_path.is_file():
            raise ValueError(f"OCR cache path invalid: {source_id} p{page_number}")
        cache_bytes = cache_path.read_bytes()
        artifact = _validate_cache(_load_json(cache_bytes), request)
        if (receipt["cacheKey"] != cache_key
                or receipt["ocrArtifactContentHash"] != artifact["contentHash"]
                or receipt["ocrLineCount"] != len(artifact["lines"])):
            raise ValueError(f"OCR cache evidence mismatch: {source_id} p{page_number}")
        leads = receipt["leads"]
        if (receipt["leadCount"] != len(leads)
                or receipt["leadCodes"] != sorted({lead["parameterCode"] for lead in leads})
                or receipt["cacheStatus"] not in {"HIT", "MISS_WRITTEN"}):
            raise ValueError(f"OCR lead summary mismatch: {source_id} p{page_number}")
        for lead in leads:
            if (not isinstance(lead.get("locators"), list)
                    or not lead["locators"]):
                raise ValueError(f"OCR lead locators missing: {source_id} p{page_number}")
            for locator in lead["locators"]:
                index = locator["lineIndex"]
                if (type(index) is not int or not 0 <= index < len(artifact["lines"])
                        or locator != {"lineIndex": index, **artifact["lines"][index]}):
                    raise ValueError(f"OCR lead locator mismatch: {source_id} p{page_number}")
            lead_codes[lead["parameterCode"]] += 1
        key = f"{source_id}-p{page_number}"
        receipt_hashes[key] = digest(raw)
        cache_hashes[key] = digest(cache_bytes)
        statuses[receipt["cacheStatus"]] += 1
        line_count += len(artifact["lines"])
        lead_count += len(leads)
    if (line_count != report["ocrLineCount"]
            or lead_count != report["lexicalLeadCount"]
            or statuses["HIT"] != report["cacheHits"]
            or statuses["MISS_WRITTEN"] != report["cacheMissesWritten"]):
        raise ValueError("OCR batch totals differ from receipts or cache")
    return {"schemaVersion": "public-family-ocr-v4-audit-v1", "status": "PASS",
            "purpose": "REVIEW_ONLY", "reportSha256": digest(report_bytes),
            "queueSha256": digest(queue_bytes), "pageCount": len(pages),
            "ocrLineCount": line_count, "lexicalLeadCount": lead_count,
            "leadCountsByCode": dict(sorted(lead_codes.items())),
            "cacheHitsInFinalPass": statuses["HIT"],
            "cacheMissesInFinalPass": statuses["MISS_WRITTEN"],
            "receiptSha256": receipt_hashes, "cacheFileSha256": cache_hashes,
            "findingCount": None, "parameterCoverage": None}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "index-audit", "queue", "report", "progress", "label-pack",
                 "cache", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("audit output already exists")
    try:
        result = check(args)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                         dir=args.output.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, args.output)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"public OCR v4 audit failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({key: result[key] for key in
                      ("status", "pageCount", "ocrLineCount", "lexicalLeadCount",
                       "leadCountsByCode")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
