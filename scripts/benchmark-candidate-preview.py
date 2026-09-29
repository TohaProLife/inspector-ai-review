#!/usr/bin/env python3
"""Bounded local-only capacity probe for the 47-code run preview.

Uses synthetic document-text-v2 artifacts. Does not read public material,
connect to the API, homeserver, OCR, Docker, or a GPU.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.candidate_family_rules import load_candidate_family_pack  # noqa: E402
from inspector_worker.class_family_candidates import load_class_family_labels  # noqa: E402
from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402
from inspector_worker.presence_family_candidates import load_presence_family_labels  # noqa: E402
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview  # noqa: E402
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text  # noqa: E402


MIB = 1024 * 1024
OBJECT = "BENCHMARK-OBJECT"
MANIFEST = "a" * 64
NEUTRAL_TEXT = "Техническое описание проекта и инженерных систем"


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def process_memory_kib(field: str) -> int:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith(f"{field}:"):
            return int(line.split()[1])
    raise RuntimeError(f"Linux {field} unavailable")


def make_source(index: int, section: str, stage: str) -> dict[str, Any]:
    source_id = f"BENCH-{index:04d}"
    return {
        "sourceFileId": source_id,
        "sha256": hashlib.sha256(source_id.encode()).hexdigest(),
        "objectId": OBJECT, "stages": [stage], "sectionCode": section,
        "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "pageStages": {},
    }


def make_artifact(source: dict[str, Any], page_texts: list[str], blocks_per_page: int) -> dict[str, Any]:
    pages = []
    candidate_pages = 0
    for page_number, line in enumerate(page_texts, 1):
        blocks = [{
            "text": line,
            "bboxMilliPoints": [1000, 1000 + block_index * 4000,
                                 300000, 3000 + block_index * 4000],
        } for block_index in range(blocks_per_page)]
        quality = qualify_page_text([block["text"] for block in blocks])
        candidate_pages += quality["disposition"] == "TEXT_LAYER_CANDIDATE"
        pages.append({
            "pageNumber": page_number, "widthMilliPoints": 600000,
            "heightMilliPoints": 800000, "blocks": blocks, "quality": quality,
        })
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source["sourceFileId"],
        "inputSha256": source["sha256"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages), "textPageCount": len(pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {
            "textLayerCandidatePageCount": candidate_pages,
            "ocrRequiredPageCount": len(pages) - candidate_pages,
        },
        "pages": pages,
    }


def candidate_line(code: str, label_packs: dict[str, dict[str, Any]]) -> str:
    if code in label_packs["numeric"]:
        attr = label_packs["numeric"][code]["attributes"][0]
        return f'{attr["labels"][0]}: 42 {attr["unitAliases"][0]}'
    if code in label_packs["class"]:
        entry = label_packs["class"][code]
        return f'{entry["labels"][0]}: {entry["values"][0]}'
    entry = label_packs["presence"][code]
    feature = entry["features"][0]
    scopes = [group["labels"][0] + (" 1" if group["requireId"] else "")
              for group in entry["scopeGroups"]]
    return " ".join([feature["labels"][0], *scopes])


def corpus_fixture(source_count: int, page_count: int, blocks_per_page: int) -> tuple[list, list]:
    sources, artifacts = [], []
    base, remainder = divmod(page_count, source_count)
    for index in range(source_count):
        page_total = base + (index < remainder)
        if page_total == 0:
            continue
        source = make_source(index + 1, "AR", "RD")
        sources.append(source)
        artifacts.append(make_artifact(source, [NEUTRAL_TEXT] * page_total,
                                       blocks_per_page))
    return sources, artifacts


def saturation_fixture(line_width: int) -> tuple[list, list]:
    rules = load_candidate_family_pack()["rules"]
    label_packs = {
        "numeric": {entry["parameterCode"]: entry for entry in load_numeric_family_labels()["entries"]},
        "class": {entry["parameterCode"]: entry for entry in load_class_family_labels()["entries"]},
        "presence": {entry["parameterCode"]: entry for entry in load_presence_family_labels()["entries"]},
    }
    sources, artifacts = [], []
    for index, rule in enumerate(rules, 1):
        source = make_source(index, rule["requiredExpectedDrawingSections"][0], "PD")
        line = candidate_line(rule["parameterCode"], label_packs)
        if len(line) > line_width:
            raise ValueError(f"line width {line_width} is too short for {rule['parameterCode']}")
        line += " " * (line_width - len(line))
        sources.append(source)
        artifacts.append(make_artifact(source, [line] * 16, 1))
    return sources, artifacts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=("corpus", "saturation"), default="corpus")
    parser.add_argument("--sources", type=int, default=202,
                        help="Synthetic PDF sources for corpus scenario (1..202)")
    parser.add_argument("--pages", type=int, default=10142,
                        help="Synthetic pages for corpus scenario (1..10142)")
    parser.add_argument("--blocks-per-page", type=int, default=1,
                        help="Neutral text blocks per corpus page (1..4)")
    parser.add_argument("--line-width", type=int, default=480,
                        help="Character count for saturation lines (80..500)")
    args = parser.parse_args()
    if not 1 <= args.sources <= 202 or not args.sources <= args.pages <= 10142:
        parser.error("corpus sources/pages must satisfy 1 <= sources <= pages <= 10142")
    if not 1 <= args.blocks_per_page <= 4 or not 80 <= args.line_width <= 500:
        parser.error("blocks-per-page must be 1..4 and line-width 80..500")

    imported_rss = process_memory_kib("VmRSS")
    build_start = time.perf_counter()
    if args.scenario == "corpus":
        sources, artifacts = corpus_fixture(args.sources, args.pages, args.blocks_per_page)
    else:
        sources, artifacts = saturation_fixture(args.line_width)
    build_seconds = time.perf_counter() - build_start
    built_rss = process_memory_kib("VmRSS")
    artifact_bytes = [len(canonical_bytes(artifact)) for artifact in artifacts]
    document_text_stage_bytes = len(canonical_bytes({
        "disposition": "DOCUMENT_TEXT_LAYER_COMPLETED",
        "sources": [{
            "sourceFileId": source["sourceFileId"],
            "inputSha256": source["sha256"],
            "status": "EXTRACTED", "artifact": artifact,
        } for source, artifact in zip(sources, artifacts, strict=True)],
        "workerId": "benchmark",
    }))
    scan_start = time.perf_counter()
    result = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
    scan_seconds = time.perf_counter() - scan_start
    evaluated_rss = process_memory_kib("VmRSS")
    preview_bytes = len(canonical_bytes(result))
    output = {
        "schemaVersion": "candidate-preview-capacity-benchmark-v1",
        "scenario": args.scenario,
        "syntheticOnly": True,
        "sourceCount": len(sources),
        "pageCount": sum(artifact["pageCount"] for artifact in artifacts),
        "blockCount": sum(len(page["blocks"]) for artifact in artifacts
                          for page in artifact["pages"]),
        "artifactTotalBytes": sum(artifact_bytes),
        "artifactMaxSourceBytes": max(artifact_bytes),
        "artifactTotalWithin8MiB": sum(artifact_bytes) <= 8 * MIB,
        "artifactEachWithin8MiB": max(artifact_bytes) <= 8 * MIB,
        "documentTextStageBytes": document_text_stage_bytes,
        "documentTextStageWithin8MiB": document_text_stage_bytes <= 8 * MIB,
        "previewBytes": preview_bytes,
        "previewWithinApi1MiB": preview_bytes <= MIB,
        "previewWithinWorker6MiB": preview_bytes <= 6 * MIB,
        "previewLeadCount": sum(row["leadCount"] for row in result["codeRows"]),
        "previewCodeRows": result["outputCount"],
        "buildSeconds": round(build_seconds, 4),
        "evaluateSeconds": round(scan_seconds, 4),
        "peakProcessRssKiB": process_memory_kib("VmHWM"),
        "rssAfterImportsKiB": imported_rss,
        "rssAfterFixtureKiB": built_rss,
        "rssAfterEvaluateKiB": evaluated_rss,
        "pythonVersion": sys.version.split()[0],
    }
    print(json.dumps(output, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
