#!/usr/bin/env python3
"""Process every bounded v4 OCR queue page against verified public PDF bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402
from inspector_worker.ocr_label_probe import probe_cached_ocr_labels  # noqa: E402
from inspector_worker.public_document_index import load_public_manifest  # noqa: E402
from inspector_worker.public_family_ocr_queue import build_public_family_ocr_queue  # noqa: E402
from inspector_worker.public_ocr_cache import (  # noqa: E402
    cached_public_ocr_page, public_manifest_entry, verified_public_pdf,
)

RENDERER = "renderer-pdfium-5.12.1-linux-x86_64-v1"
PROVIDER = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1"
DPI = 120
MIN_DPI = 72
SAFE_RENDER_PIXEL_BUDGET = 24_000_000
SCRIPT = "eslav"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def write_atomic(path: Path, value: object) -> None:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".tmp",
                                     delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def chunks(size: int) -> list[list[int]]:
    if size < 0:
        raise ValueError("negative OCR line count")
    result = []
    start = 0
    while start < size:
        end = min(start + 128, size)
        result.append(list(range(start, end)))
        if end == size:
            break
        start = end - 1
    return result


def select_page_dpi(width_pt: float, height_pt: float) -> int:
    """Use the highest safe DPI; the OCR adapter rejects renders above 25M px."""
    if (not math.isfinite(width_pt) or not math.isfinite(height_pt)
            or width_pt <= 0 or height_pt <= 0):
        raise ValueError("invalid PDF page geometry for OCR")
    for dpi in range(DPI, MIN_DPI - 1, -1):
        width = math.ceil(width_pt * dpi / 72) + 2
        height = math.ceil(height_pt * dpi / 72) + 2
        if width * height <= SAFE_RENDER_PIXEL_BUDGET:
            return dpi
    raise ValueError("PDF page exceeds bounded OCR render even at minimum DPI")


def verify_queue(queue: dict, manifest: Path, index: Path, audit: Path,
                 matrix: Path) -> int:
    parameters = queue.get("parameters")
    if not isinstance(parameters, dict):
        raise ValueError("OCR queue parameters missing")
    expected = build_public_family_ocr_queue(
        manifest, index, audit, matrix,
        max_per_family=parameters.get("maxPerFamily"),
        neighbor_radius=parameters.get("neighborRadius"), planning_version=2)
    if queue != expected:
        raise ValueError("OCR queue differs from current audited public index")
    selected = queue.get("uniqueSelectedPages")
    totals = queue.get("totals", {})
    if (totals.get("candidateCodeCount") != 47
            or totals.get("candidateFamilyCount") != 9
            or not isinstance(selected, list) or not selected
            or totals.get("selectedUniqueOcrPages") != len(selected)
            or len({(item["sourceFileId"], item["pageNumber"])
                    for item in selected}) != len(selected)):
        raise ValueError("v4 OCR queue selection is incomplete or duplicated")
    return len(selected)


def run(args: argparse.Namespace) -> dict:
    if args.report.exists():
        raise ValueError("final OCR batch report already exists")
    args.scratch.mkdir(parents=True, exist_ok=True)
    queue_bytes = args.queue.read_bytes()
    queue = json.loads(queue_bytes)
    verify_queue(queue, args.manifest, args.index, args.audit, args.matrix)
    labels = load_numeric_family_labels(args.label_pack)
    if (labels["schemaVersion"] != "numeric-family-labels-v2"
            or labels["version"] != "2"):
        raise ValueError("v4 OCR probe requires reverified numeric labels v2")
    rows = {row["file_id"]: row for row in load_public_manifest(args.manifest)}
    by_source = defaultdict(list)
    for page in queue["uniqueSelectedPages"]:
        by_source[page["sourceFileId"]].append(page)
    results = []
    for source_id in sorted(by_source):
        row = public_manifest_entry(args.manifest, source_id)
        if row != rows[source_id]:
            raise ValueError("public source manifest recheck differs")
        with verified_public_pdf(row, pdf_path=None, archive_path=args.archive,
                                 scratch_root=args.scratch) as pdf:
            for page in sorted(by_source[source_id], key=lambda item: item["pageNumber"]):
                number = page["pageNumber"]
                if page["sourceSha256"] != row["sha256"]:
                    raise ValueError("queued source SHA differs from original PDF")
                import fitz

                with fitz.open(pdf) as document:
                    bounds = document[number - 1].rect
                    page_dpi = select_page_dpi(bounds.width, bounds.height)
                result = cached_public_ocr_page(
                    manifest_path=args.manifest, source_id=source_id,
                    page_number=number, pdf_path=pdf, cache_root=args.cache,
                    base_url=args.ocr_url, dpi=page_dpi, script=SCRIPT,
                    renderer_profile_id=RENDERER, provider_profile_id=PROVIDER,
                    index_path=args.index / "index.sqlite3")
                if (result["indexDisposition"] != "OCR_REQUIRED"
                        or result["sourceSha256"] != row["sha256"]):
                    raise ValueError("OCR result lost source or index provenance")
                leads = {}
                segments = []
                for indices in chunks(result["lineCount"]):
                    probe = probe_cached_ocr_labels(
                        args.manifest, args.index, args.cache, source_id, number,
                        expected_object_id=row["object_id"], expected_stage=row["stage"],
                        expected_section=row["section"], line_indices=indices,
                        dpi=page_dpi, script=SCRIPT, renderer_profile_id=RENDERER,
                        provider_profile_id=PROVIDER,
                        numeric_label_pack_path=args.label_pack)
                    if (probe["artifactContentHash"] != result["artifactContentHash"]
                            or probe["labelPackSha256"]["numeric"] != labels["labelPackSha256"]):
                        raise ValueError("lexical probe differs from exact OCR artifact or policy")
                    segments.append(probe["reportSha256"])
                    for lead in probe["leads"]:
                        leads[sha(canonical(lead))] = lead
                receipt = {"schemaVersion": "public-family-ocr-v4-page-v1",
                           "disposition": "REVIEW_ONLY_ABSTAIN",
                           "sourceFileId": source_id, "sourceSha256": row["sha256"],
                           "pageNumber": number,
                           "renderDpi": page_dpi,
                           "pageArtifactSha256": page["pageArtifactSha256"],
                           "families": page["families"],
                           "cacheStatus": result["cacheStatus"],
                           "cacheKey": result["cacheKey"],
                           "ocrArtifactContentHash": result["artifactContentHash"],
                           "ocrLineCount": result["lineCount"],
                           "probeSegmentHashes": segments,
                           "leadCount": len(leads),
                           "leadCodes": sorted({lead["parameterCode"] for lead in leads.values()}),
                           "leads": list(leads.values()),
                           "findingCount": None, "parameterCoverage": None}
                write_atomic(args.progress / f"{source_id}-p{number}.json", receipt)
                results.append(receipt)
                print(json.dumps({"sourceFileId": source_id, "pageNumber": number,
                                  "cacheStatus": result["cacheStatus"],
                                  "lines": result["lineCount"], "leads": len(leads)},
                                 ensure_ascii=False), flush=True)
    report = {"schemaVersion": "public-family-ocr-v4-batch-v1",
              "disposition": "REVIEW_ONLY_ABSTAIN",
              "manifestSha256": sha(args.manifest.read_bytes()),
              "auditSha256": sha(args.audit.read_bytes()),
              "queueSha256": sha(queue_bytes),
              "numericLabelPackSha256": labels["labelPackSha256"],
              "selectedPageCount": len(queue["uniqueSelectedPages"]),
              "processedPageCount": len(results),
              "cacheHits": sum(item["cacheStatus"] == "HIT" for item in results),
              "cacheMissesWritten": sum(item["cacheStatus"] == "MISS_WRITTEN" for item in results),
              "ocrLineCount": sum(item["ocrLineCount"] for item in results),
              "lexicalLeadCount": sum(item["leadCount"] for item in results),
              "pages": [{key: value for key, value in item.items() if key != "leads"}
                        for item in results],
              "findingCount": None, "parameterCoverage": None}
    if report["processedPageCount"] != report["selectedPageCount"]:
        raise ValueError("not all selected OCR pages processed")
    write_atomic(args.report, report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "index", "audit", "matrix", "queue", "archive",
                 "cache", "label-pack", "scratch", "progress", "report"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084")
    args = parser.parse_args()
    try:
        result = run(args)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"public family OCR v4 batch failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({key: result[key] for key in (
        "processedPageCount", "cacheHits", "cacheMissesWritten",
        "ocrLineCount", "lexicalLeadCount")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
