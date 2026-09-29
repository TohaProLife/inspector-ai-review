#!/usr/bin/env python3
"""Read-only indexed PDF triage for 20 unresolved PZ/SPZU codes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.pz_spzu_unresolved_batch import evaluate_pz_spzu_unresolved_batch  # noqa: E402

DATA = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
        / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DATA / "document_manifest.jsonl")
    parser.add_argument("--catalog", type=Path, default=DATA / "parameter_catalog_132.jsonl")
    parser.add_argument("--registry", type=Path,
                        default=ROOT / "services/worker/rules/parameter-family-registry-v1.json")
    parser.add_argument("--strategy", type=Path,
                        default=ROOT / "docs/operations/unresolved-parameter-strategy-v1.json")
    parser.add_argument("--strategy-report", type=Path,
                        default=ROOT / "output/unresolved-parameter-strategy-20260927/report.json")
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--max-pages-per-code", type=int, default=16)
    parser.add_argument("--max-lines-per-page", type=int, default=3)
    parser.add_argument("--max-ocr-queue", type=int, default=80)
    parser.add_argument("--output", type=Path, required=True,
                        help="new JSON report, never overwrite an existing file")
    args = parser.parse_args()
    try:
        report = evaluate_pz_spzu_unresolved_batch(
            args.manifest, args.index, args.audit, args.strategy_report,
            args.catalog, args.registry, args.strategy,
            max_pages_per_code=args.max_pages_per_code,
            max_lines_per_page=args.max_lines_per_page,
            max_ocr_queue=args.max_ocr_queue,
        )
        if not args.output.parent.is_dir() or args.output.exists():
            raise ValueError("output parent must exist and output must be new")
        payload = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        with args.output.open("x", encoding="utf-8") as destination:
            destination.write(payload)
        print(json.dumps({"status": "WRITTEN", "output": str(args.output),
                          "codes": len(report["codeReports"]),
                          "sourceCount": report["sourceCount"],
                          "ocrRequiredPagesInCorpus": report["ocrRequiredPagesInCorpus"],
                          "overallStatus": report["overallStatus"]}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
