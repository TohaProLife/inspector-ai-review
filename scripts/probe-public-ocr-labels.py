#!/usr/bin/env python3
"""Probe 47 pinned candidate labels on one explicitly selected cached OCR page."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.ocr_label_probe import OcrLabelProbeError, probe_cached_ocr_labels  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--index-root", required=True, type=Path)
    parser.add_argument("--cache-root", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--page", required=True, type=int)
    parser.add_argument("--object-id", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--section", required=True)
    parser.add_argument("--lines", required=True,
                        help="comma-separated original OCR line indices, up to 128")
    parser.add_argument("--dpi", default=120, type=int)
    parser.add_argument("--script", default="eslav", choices=("eslav", "latin"))
    parser.add_argument("--renderer-profile-id", required=True)
    parser.add_argument("--provider-profile-id", required=True)
    parser.add_argument("--out", type=Path,
                        help="optional JSON report path; stdout otherwise")
    args = parser.parse_args()
    try:
        line_indices = [int(value) for value in args.lines.split(",")]
        report = probe_cached_ocr_labels(
            args.manifest, args.index_root, args.cache_root, args.source_id, args.page,
            expected_object_id=args.object_id, expected_stage=args.stage,
            expected_section=args.section, line_indices=line_indices,
            dpi=args.dpi, script=args.script,
            renderer_profile_id=args.renderer_profile_id,
            provider_profile_id=args.provider_profile_id)
    except (OcrLabelProbeError, ValueError, OSError) as error:
        parser.exit(2, f"OCR label probe rejected: {error}\n")
    encoded = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.out is None:
        sys.stdout.write(encoded)
    else:
        args.out.write_text(encoded, encoding="utf-8")
        print(json.dumps({"status": report["status"], "leadCount": report["leadCount"],
                          "reportSha256": report["reportSha256"],
                          "path": str(args.out)}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
