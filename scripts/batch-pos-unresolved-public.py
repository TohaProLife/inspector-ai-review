#!/usr/bin/env python3
"""Run SHA-gated, review-only six-code POS batch on the public index."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.pos_unresolved_batch import build_pos_unresolved_report  # noqa: E402

DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DATA / "document_manifest.jsonl")
    parser.add_argument("--catalog", type=Path, default=DATA / "parameter_catalog_132.jsonl")
    parser.add_argument("--strategy", type=Path,
                        default=ROOT / "docs/operations/unresolved-parameter-strategy-v1.json")
    parser.add_argument("--audit-report", type=Path,
                        default=ROOT / "output/public-index-20260927/index-audit.json")
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or not args.output.parent.is_dir():
            raise ValueError("output parent must exist and report path must be new")
        report = build_pos_unresolved_report(args.manifest, args.index, args.audit_report,
                                             args.strategy, args.catalog)
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"],
                          "pdPosSources": len(report["pdPosSourceIds"]),
                          "indexedPosPages": report["indexedPosPages"],
                          "ocrRequiredPages": report["ocrRequiredPages"],
                          "exactPairObjects": report["sourceRoles"]["exactPairObjectCount"],
                          "codeLeadCounts": {row["parameterCode"]: row["leadCount"]
                                             for row in report["codes"]},
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
