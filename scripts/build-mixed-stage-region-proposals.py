#!/usr/bin/env python3
"""Build review-only mixed-stage region hints from SHA-pinned public OCR reports."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.mixed_stage_region_proposals import build_mixed_stage_region_batch  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--report", action="append", required=True,
                        help="SOURCE_ID=PATH=SHA256; pass once per selected OCR report")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reports: dict[str, tuple[Path, str]] = {}
    for item in args.report:
        source_id, separator, rest = item.partition("=")
        path, separator2, sha = rest.rpartition("=")
        if (not separator or not separator2 or not re.fullmatch(r"F[0-9]{4,}", source_id)
                or not re.fullmatch(r"[a-f0-9]{64}", sha) or not path
                or source_id in reports):
            parser.error("each --report must be a unique SOURCE_ID=PATH=SHA256")
        reports[source_id] = (Path(path), sha)
    try:
        result = build_mixed_stage_region_batch(args.manifest, reports)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent,
                                     prefix=args.output.name + ".", suffix=".tmp",
                                     delete=False) as target:
        temporary = Path(target.name)
        target.write(content)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, args.output)
    print(json.dumps({"sourceCount": result["sourceCount"],
                      "localizedSourceCount": result["localizedSourceCount"],
                      "disposition": result["disposition"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
