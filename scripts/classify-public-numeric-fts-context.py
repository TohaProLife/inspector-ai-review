#!/usr/bin/env python3
"""Apply SHA-pinned manual classifications to all numeric FTS pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_fts_review import classify_numeric_fts_context  # noqa: E402


def _read_json(path: Path, *, max_bytes: int) -> tuple[dict, bytes]:
    content = path.read_bytes()
    if not 0 < len(content) <= max_bytes:
        raise ValueError("numeric review input exceeds size limit")
    value = json.loads(content)
    if not isinstance(value, dict):
        raise ValueError("numeric review input is not an object")
    return value, content


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context-report", type=Path, required=True)
    parser.add_argument("--fts-report", type=Path, required=True)
    parser.add_argument("--policy", type=Path,
                        default=ROOT / "services" / "worker" / "rules"
                        / "numeric-fts-review-v1.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or not args.output.parent.is_dir():
            raise ValueError("new output file in an existing directory required")
        context, context_bytes = _read_json(args.context_report, max_bytes=8 * 1024 * 1024)
        fts, fts_bytes = _read_json(args.fts_report, max_bytes=16 * 1024 * 1024)
        policy, policy_bytes = _read_json(args.policy, max_bytes=128 * 1024)
        if (hashlib.sha256(context_bytes).hexdigest() != policy["contextReportSha256"]
                or hashlib.sha256(fts_bytes).hexdigest() != policy["ftsReportSha256"]
                or fts["status"] != "COMPLETE"
                or fts["ftsMatchedPages"] != context["pageCount"]
                or fts["manifestSha256"] != context["manifestSha256"]):
            raise ValueError("numeric review report SHA, scope, or census mismatch")
        report = classify_numeric_fts_context(context, policy)
        if (args.context_report.read_bytes() != context_bytes
                or args.fts_report.read_bytes() != fts_bytes
                or args.policy.read_bytes() != policy_bytes):
            raise ValueError("numeric review input changed during classification")
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, sort_keys=True, indent=2)
            output.write("\n")
        print(json.dumps({"status": report["status"],
                          "pageCount": report["pageCount"],
                          "withoutExactTableRowPages": report["withoutExactTableRowPages"],
                          "categoryCounts": report["categoryCounts"],
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
