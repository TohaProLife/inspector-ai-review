#!/usr/bin/env python3
"""Build/query resumable index of allowed TRAIN_PUBLIC PDF text pages."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from inspector_worker.public_document_index import (  # noqa: E402
    build_public_index, repair_failed_public_index, finish_incomplete_public_index,
    get_indexed_page, search_index,
)

DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="verify public sources and index PDF pages")
    build.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    build.add_argument("--output", type=Path, required=True)
    origin = build.add_mutually_exclusive_group(required=True)
    origin.add_argument("--archive", type=Path, help="participant ZIP with CP866 filenames")
    origin.add_argument("--materials-root", type=Path, help="root containing manifest relative paths")
    build.add_argument("--override-map", type=Path, help="JSON map FILE_ID to absolute PDF path; directory mode only")
    build.add_argument("--source-id", action="append", help="index only selected public file ID; repeatable")
    build.add_argument("--workers", type=int, default=1, help="parallel PDF documents, 1..16")
    repair = sub.add_parser("repair-failed", help="repair only FAILED PDFs in existing v3 index with PyMuPDF")
    repair.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    repair.add_argument("--output", type=Path, required=True)
    repair_origin = repair.add_mutually_exclusive_group(required=True)
    repair_origin.add_argument("--archive", type=Path)
    repair_origin.add_argument("--materials-root", type=Path)
    repair.add_argument("--override-map", type=Path)
    repair.add_argument("--source-id", action="append")
    repair.add_argument("--workers", type=int, default=1)
    finish = sub.add_parser("finish-incomplete", help="finish absent/INDEXING/FAILED PDFs after main writer stops")
    finish.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    finish.add_argument("--output", type=Path, required=True)
    finish_origin = finish.add_mutually_exclusive_group(required=True)
    finish_origin.add_argument("--archive", type=Path)
    finish_origin.add_argument("--materials-root", type=Path)
    finish.add_argument("--override-map", type=Path)
    finish.add_argument("--source-id", action="append")
    finish.add_argument("--main-service-stopped", action="store_true",
                        help="operator verified main index service exited; required before writing")
    page = sub.add_parser("page", help="read SHA-checked indexed page")
    page.add_argument("--output", type=Path, required=True)
    page.add_argument("--source-id", required=True)
    page.add_argument("--page-number", type=int, required=True)
    search = sub.add_parser("search", help="FTS search with source scope filters")
    search.add_argument("--output", type=Path, required=True)
    search.add_argument("--query", required=True)
    search.add_argument("--object-id")
    search.add_argument("--stage")
    search.add_argument("--section")
    search.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()
    try:
        if args.command in ("build", "repair-failed", "finish-incomplete"):
            overrides = json.loads(args.override_map.read_text(encoding="utf-8")) if args.override_map else None
            if overrides is not None and (not isinstance(overrides, dict)
                                           or any(not isinstance(key, str) or not isinstance(value, str)
                                                  for key,value in overrides.items())):
                raise ValueError("override map must be JSON object of FILE_ID to path")
            if args.command == "finish-incomplete":
                result = finish_incomplete_public_index(
                    args.manifest, args.output, archive=args.archive,
                    materials_root=args.materials_root, override_map=overrides,
                    source_ids=set(args.source_id) if args.source_id else None,
                    operator_confirms_main_stopped=args.main_service_stopped)
            else:
                operation = build_public_index if args.command == "build" else repair_failed_public_index
                result = operation(args.manifest, args.output, archive=args.archive,
                                   materials_root=args.materials_root, override_map=overrides,
                                   source_ids=set(args.source_id) if args.source_id else None,
                                   workers=args.workers)
            return 1 if result["failedSources"] else 0
        if args.command == "page":
            result = get_indexed_page(args.output, args.source_id, args.page_number)
        else:
            result = search_index(args.output, args.query, object_id=args.object_id,
                                  stage=args.stage, section=args.section, limit=args.limit)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
