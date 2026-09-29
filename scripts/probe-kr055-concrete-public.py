#!/usr/bin/env python3
"""Offline KR-055 TRAIN_PUBLIC concrete-class observation probe; no verdict."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.kr055_concrete_observations import build_public_observation_slice  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path,
                        help="participant document_manifest.jsonl, without answer files")
    for file_id in ("f0106", "f0139", "f0140", "f0141"):
        parser.add_argument(f"--{file_id}", required=True, type=Path,
                            help=f"original {file_id.upper()} PDF")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    paths = {file_id: getattr(args, file_id.lower())
             for file_id in ("F0106", "F0139", "F0140", "F0141")}
    if args.output.resolve() in {args.manifest.resolve(), *(path.resolve() for path in paths.values())}:
        parser.error("output must not overwrite an input")
    report = build_public_observation_slice(args.manifest, paths)
    payload = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(json.dumps({"report": str(args.output), "fileSha256": hashlib.sha256(payload).hexdigest(),
                      "contentHash": report["contentHash"],
                      "observations": len(report["observations"]),
                      "comparisonDisposition": report["evaluation"]["comparisonDisposition"]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
