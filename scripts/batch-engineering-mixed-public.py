#!/usr/bin/env python3
"""Build audit-gated public OV/VK observations for ten unresolved codes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.engineering_mixed_batch import build_engineering_mixed_batch  # noqa: E402

DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--max-pages-per-code", type=int, default=48)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = build_engineering_mixed_batch(
            args.manifest, args.index, args.audit,
            max_pages_per_code=args.max_pages_per_code)
        if not args.output.parent.is_dir() or args.output.exists():
            raise ValueError("output parent must exist and output must be new")
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=False, sort_keys=True, indent=2)
            destination.write("\n")
        print(json.dumps({"status": "WRITTEN", "output": str(args.output),
                          "codes": len(report["codes"]),
                          "matchedTextPages": sum(row["matchedTextPages"] for row in report["codes"]),
                          "selectedTextPages": sum(row["selectedTextPages"] for row in report["codes"]),
                          "ocrProposals": len(report["ocrProposals"])}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
