#!/usr/bin/env python3
"""OCR one explicit region of one allowlisted public PDF page into a SHA cache."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "worker"))

from inspector_worker.public_region_ocr import cached_public_ocr_region  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--clip-norm-10000", type=int, nargs=4, required=True,
                        metavar=("X0", "Y0", "X1", "Y1"))
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-pdf", type=Path)
    source.add_argument("--archive", type=Path)
    parser.add_argument("--index", type=Path)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084")
    parser.add_argument("--provider-profile-id", required=True)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--script", choices=("eslav", "latin"), default="eslav")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = cached_public_ocr_region(
        manifest_path=args.manifest, source_id=args.source_id, page_number=args.page,
        clip_norm_10000=tuple(args.clip_norm_10000), provider_profile_id=args.provider_profile_id,
        base_url=args.ocr_url, pdf_path=args.source_pdf, archive_path=args.archive,
        index_path=args.index, cache_root=args.cache_root, dpi=args.dpi, script=args.script,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in (
        "sourceFileId", "pageNumber", "clipNorm10000", "indexDisposition",
        "cacheStatus", "cacheKey", "artifactContentHash", "lineCount", "interpretation",
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
