#!/usr/bin/env python3
"""Run bounded public POD/OOS family triage; emit only abstained leads."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.pod_oos_unresolved_batch import build_pod_oos_unresolved_report  # noqa: E402

DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DATA / "document_manifest.jsonl")
    parser.add_argument("--catalog", type=Path, default=DATA / "parameter_catalog_132.jsonl")
    parser.add_argument("--strategy-report", type=Path,
                        default=ROOT / "output/unresolved-parameter-strategy-20260927/report.json")
    parser.add_argument("--audit-report", type=Path,
                        default=ROOT / "output/public-index-20260927/index-audit.json")
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or not args.output.parent.is_dir():
            raise ValueError("new output path inside existing directory required")
        report = build_pod_oos_unresolved_report(
            args.manifest, args.index, args.audit_report, args.strategy_report, args.catalog)
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": report["status"],
                          "uniqueShaVerifiedSelectedPages": report["uniqueShaVerifiedSelectedPages"],
                          "codes": {item["parameterCode"]: {
                              "matched": item["ftsMatchedPageAddresses"],
                              "selected": item["selectedPageAddresses"],
                              "omitted": item["pagesOmittedByCap"]}
                              for item in report["codes"]},
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
