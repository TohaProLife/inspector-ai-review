#!/usr/bin/env python3
"""Offline, read-only TRAIN_PUBLIC IOS4-077 radiator specification probe."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.ocr_pilot import recognize_pdf_page, validate_local_url  # noqa: E402
from inspector_worker.radiator_spec import (  # noqa: E402
    build_public_observation_slice,
    build_report,
    extract_pd_rows,
    extract_rd_rows,
    verify_public_sources,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path, help="participant document_manifest.jsonl")
    parser.add_argument("--pd-source", required=True, type=Path, help="F0171 source PDF")
    parser.add_argument("--rd-source", required=True, type=Path, help="F0202 mixed RD/ID source PDF")
    parser.add_argument("--pd-page", action="append", type=int, required=True,
                        help="explicit PD specification PDF page (repeatable)")
    parser.add_argument("--rd-page", action="append", type=int, required=True,
                        help="explicit mixed-source specification PDF page (repeatable)")
    parser.add_argument("--document-url", default="http://127.0.0.1:18084",
                        help="local document-ai URL; remote providers forbidden")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--observation-slice", action="store_true",
                        help="emit bounded CLARIFICATION_REQUIRED observations; no comparison or finding")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if len(args.pd_page) != len(set(args.pd_page)) or len(args.rd_page) != len(set(args.rd_page)):
        parser.error("page lists must be unique")
    if args.output.resolve() in {args.manifest.resolve(), args.pd_source.resolve(), args.rd_source.resolve()}:
        parser.error("output must not overwrite an input source")
    url = validate_local_url(args.document_url)
    paths = {"F0171": args.pd_source, "F0202": args.rd_source}
    manifest = verify_public_sources(args.manifest, paths)
    for source_id, pages in (("F0171", args.pd_page), ("F0202", args.rd_page)):
        if any(not 1 <= page <= manifest[source_id]["pdf_pages"] for page in pages):
            parser.error(f"{source_id} page outside verified PDF")
    pd_rows = extract_pd_rows(args.pd_source, manifest["F0171"]["sha256"], args.pd_page)
    artifacts = []
    for page in args.rd_page:
        print(f"OCR F0202 PDF page {page}", file=sys.stderr, flush=True)
        artifacts.append(recognize_pdf_page(
            args.rd_source, "F0202", manifest["F0202"]["sha256"],
            page, manifest["F0202"]["pdf_pages"], base_url=url, dpi=args.dpi,
        ))
    if args.observation_slice:
        report = build_public_observation_slice(
            args.manifest, args.pd_source, args.rd_source,
            pd_pages=args.pd_page, mixed_pages=args.rd_page, ocr_artifacts=artifacts,
        )
    else:
        rd_rows = extract_rd_rows(artifacts, manifest["F0202"]["sha256"])
        report = build_report(manifest, pd_rows, rd_rows,
                              pd_pages=args.pd_page, rd_pages=args.rd_page)
    payload = (json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(json.dumps({"report": str(args.output), "fileSha256": hashlib.sha256(payload).hexdigest(),
                      "contentHash": report["contentHash"], "pdRows": len(report["pdRows"]),
                      "mixedRdIdRows": len(report["mixedRdIdRows"]),
                      "observedModelTokenOverlap": len(report["observedModelTokenOverlap"]),
                      "comparisonDisposition": report["comparisonDisposition"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
