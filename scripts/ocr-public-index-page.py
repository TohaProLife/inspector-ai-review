#!/usr/bin/env python3
"""OCR one explicit TRAIN_PUBLIC PDF page; reuse only an exact verified cache hit."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_ocr_cache import (  # noqa: E402
    DEFAULT_CACHE_ROOT, PublicOcrCacheError, cached_public_ocr_page,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True,
                        help="participant document_manifest.jsonl; never answer labels")
    parser.add_argument("--source-id", required=True, help="one included TRAIN_PUBLIC file ID")
    parser.add_argument("--page", type=int, required=True, help="one 1-based PDF page")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pdf", type=Path, help="raw original PDF")
    source.add_argument("--archive", type=Path, help="ZIP containing raw original PDF")
    parser.add_argument("--index", type=Path, help="optional public index.sqlite3 for page disposition")
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE_ROOT)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084",
                        help="local document-ai URL, never public API")
    parser.add_argument("--dpi", type=int, default=120)
    parser.add_argument("--script", choices=("eslav", "latin"), default="eslav")
    parser.add_argument("--renderer-profile-id", required=True,
                        help="exact expected renderer profile")
    parser.add_argument("--provider-profile-id", required=True,
                        help="exact expected OCR provider profile")
    args = parser.parse_args()
    try:
        result = cached_public_ocr_page(
            manifest_path=args.manifest, source_id=args.source_id,
            page_number=args.page, pdf_path=args.pdf, archive_path=args.archive,
            cache_root=args.cache_root, base_url=args.ocr_url, dpi=args.dpi,
            script=args.script, renderer_profile_id=args.renderer_profile_id,
            provider_profile_id=args.provider_profile_id, index_path=args.index,
        )
    except (PublicOcrCacheError, ValueError, OSError) as error:
        parser.exit(2, f"OCR cache request rejected: {error}\n")
    print(json.dumps({key: value for key, value in result.items() if key != "artifact"},
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
