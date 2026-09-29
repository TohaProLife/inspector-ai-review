#!/usr/bin/env python3
"""Repeat one local OCR request and verify durable SHA/page cache reuse."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.durable_ocr_cache import cached_durable_ocr_page  # noqa: E402
from inspector_worker.ocr_pilot import recognize_pdf_page  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--page-count", type=int, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--provider-url", required=True)
    parser.add_argument("--provider-profile-id", required=True)
    parser.add_argument("--renderer-profile-id", required=True)
    parser.add_argument("--dpi", type=int, default=120)
    parser.add_argument("--script", default="eslav")
    args = parser.parse_args()

    def recognize() -> dict:
        return recognize_pdf_page(
            args.pdf, args.source_id, args.source_sha256, args.page,
            args.page_count, base_url=args.provider_url, dpi=args.dpi,
            script=args.script,
        )

    statuses = []
    hashes = []
    lines = []
    for _ in range(2):
        artifact, status = cached_durable_ocr_page(
            cache_root=args.cache_root, source_path=args.pdf,
            source_file_id=args.source_id, source_sha256=args.source_sha256,
            page_number=args.page, page_count=args.page_count, dpi=args.dpi,
            script=args.script, renderer_profile_id=args.renderer_profile_id,
            provider_profile_id=args.provider_profile_id, recognize=recognize,
        )
        statuses.append(status)
        hashes.append(artifact["contentHash"])
        lines.append(len(artifact["lines"]))
    if statuses != ["MISS_WRITTEN", "HIT"] or hashes[0] != hashes[1]:
        raise RuntimeError("durable OCR cache did not give exact repeat hit")
    print(json.dumps({"sourceFileId": args.source_id, "sourceSha256": args.source_sha256,
                      "pageNumber": args.page, "cacheStatuses": statuses,
                      "artifactContentHash": hashes[0], "lineCount": lines[0],
                      "interpretation": "OCR_CACHE_VERIFIED_LINES_REVIEW_REQUIRED"},
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
