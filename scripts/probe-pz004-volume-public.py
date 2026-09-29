#!/usr/bin/env python3
"""Read-only PZ-004 volume observations from F0150 p26 and F0201 p14."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.pz004_volume_observations import (  # noqa: E402
    EXPECTED_PUBLIC_MANIFEST_SHA256,
    build_public_observation_slice,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path,
                        help="original participant document_manifest.jsonl")
    parser.add_argument("--pd-source", required=True, type=Path, help="original F0150 PDF")
    parser.add_argument("--mixed-source", required=True, type=Path, help="original F0201 PDF")
    parser.add_argument("--expected-manifest-sha256", default=EXPECTED_PUBLIC_MANIFEST_SHA256,
                        help="independent SHA-256 anchor of participant manifest")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() in {args.manifest.resolve(), args.pd_source.resolve(),
                                 args.mixed_source.resolve()}:
        parser.error("output must not overwrite an input")
    report = build_public_observation_slice(
        args.manifest, args.pd_source, args.mixed_source,
        expected_manifest_sha256=args.expected_manifest_sha256,
    )
    payload = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(json.dumps({
        "report": str(args.output), "fileSha256": hashlib.sha256(payload).hexdigest(),
        "contentHash": report["contentHash"], "observations": len(report["observations"]),
        "literalValueOverlap": report["literalValueOverlap"],
        "comparisonDisposition": report["comparisonDisposition"],
        "machineStatus": report["evaluation"]["machineStatus"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
