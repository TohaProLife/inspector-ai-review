#!/usr/bin/env python3
"""Run read-only nine-code AR batch against pinned public document index."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.ar_unresolved_batch import build_ar_unresolved_batch  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
    parser.add_argument("--index-root", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--strategy", type=Path, default=ROOT / "docs/operations/unresolved-parameter-strategy-v1.json")
    parser.add_argument("--catalog", type=Path, default=ROOT / "services/worker/rules/parameter_catalog_132.jsonl")
    parser.add_argument("--registry", type=Path, default=ROOT / "services/worker/rules/parameter-family-registry-v1.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-leads-per-code", type=int, default=500)
    parser.add_argument("--max-ocr-queue", type=int, default=24)
    args = parser.parse_args()
    report = build_ar_unresolved_batch(
        args.manifest, args.index_root, args.audit, args.strategy,
        args.catalog, args.registry,
        max_leads_per_code=args.max_leads_per_code,
        max_ocr_queue=args.max_ocr_queue,
    )
    payload = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2,
                          allow_nan=False) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(payload)
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps({
        "output": str(args.output), "sha256": hashlib.sha256(payload).hexdigest(),
        "status": report["status"], "codes": len(report["codes"]),
        "sameObjectExactPdRdArPairCount": report["sameObjectExactPdRdArPairCount"],
        "matchedLines": sum(code["scanCounts"].get("matchedLines", 0) for code in report["codes"]),
        "ocrQueued": report["targetedOcrQueue"]["displayCount"],
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
