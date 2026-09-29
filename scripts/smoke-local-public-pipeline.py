#!/usr/bin/env python3
"""Run local retrieval, live OCR and Bonsai on verified public PDFs in one command."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--public-checks", type=Path, required=True)
    parser.add_argument("--case-id", action="append", required=True)
    parser.add_argument("--source", action="append", required=True, metavar="FILE_ID=PDF_PATH")
    parser.add_argument("--embedding-url", default="http://127.0.0.1:18085")
    parser.add_argument("--document-url", default="http://127.0.0.1:18084")
    parser.add_argument("--model-url", default="http://127.0.0.1:18082")
    parser.add_argument("--retrieval-report", type=Path,
                        help="reuse a completed retrieval report instead of ranking again")
    parser.add_argument("--resume", action="store_true",
                        help="reuse bound model reports or previously verified live OCR files")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    script_dir = Path(__file__).resolve().parent
    shared = ["--manifest", str(args.manifest), "--public-checks", str(args.public_checks)]
    for source in args.source:
        shared.extend(("--source", source))
    retrieval_report = args.retrieval_report or args.output_dir / "retrieval.json"
    started = time.monotonic()
    if args.retrieval_report is None:
        command = [sys.executable, str(script_dir / "eval-retrieval-public.py"), *shared,
                   "--embedding-url", args.embedding_url, "--report", str(retrieval_report)]
        for case_id in args.case_id:
            command.extend(("--case-id", case_id))
        subprocess.run(command, check=True)
    if not retrieval_report.is_file():
        parser.error("retrieval report is missing")
    retrieval = json.loads(retrieval_report.read_text(encoding="utf-8"))
    if retrieval.get("schemaVersion") != "local-public-retrieval-v1":
        parser.error("retrieval report schema is invalid")
    retrieval_hash = sha256_file(retrieval_report)
    source_paths = dict(item.split("=", 1) for item in args.source)
    for source in retrieval.get("sources", []):
        path = Path(source_paths.get(source.get("fileId"), ""))
        if not path.is_file() or sha256_file(path) != source.get("sha256"):
            parser.error(f"source does not match retrieval report: {source.get('fileId')}")

    results: list[dict] = []
    for case_id in args.case_id:
        report_path = args.output_dir / f"{case_id}-retrieved-ocr-bonsai.json"
        report = json.loads(report_path.read_text(encoding="utf-8")) if args.resume and report_path.is_file() else None
        if report is not None:
            if (report.get("caseId") != case_id
                    or report.get("mode") not in {"ocr", "ocr-live"}
                    or report.get("retrieval", {}).get("reportSha256") != retrieval_hash
                    or any(item.get("sourceSha256") not in {source["sha256"] for source in retrieval["sources"]}
                           for item in report.get("pages", []))):
                parser.error(f"existing model report is not bound to this retrieval: {case_id}")
        else:
            command = [
                sys.executable, str(script_dir / "eval-local-public.py"), *shared,
                "--case-id", case_id, "--retrieval-report", str(retrieval_report),
                "--document-url", args.document_url, "--model-url", args.model_url,
                "--report", str(report_path),
            ]
            selection = next((item["selection"] for item in retrieval["cases"] if item["caseId"] == case_id), [])
            cached_ocr = [args.output_dir / "ocr" / f"{item['fileId']}-page{item['sourcePage']}-ocr.json"
                          for item in selection]
            if args.resume and len(selection) == 2 and all(path.is_file() for path in cached_ocr):
                command.extend(("--mode", "ocr"))
                for item, path in zip(selection, cached_ocr):
                    command.extend(("--ocr-report", f"{item['fileId']}:{item['sourcePage']}={path}"))
            else:
                command.extend(("--mode", "ocr-live", "--ocr-artifacts-dir", str(args.output_dir / "ocr")))
            subprocess.run(command, check=True)
            report = json.loads(report_path.read_text(encoding="utf-8"))
        citations = report["citations"]
        results.append({
            "caseId": case_id,
            "selectedGoldPages": report["retrieval"]["selectedGoldPages"],
            "goldPageCount": report["retrieval"]["goldPageCount"],
            "verdict": report["verdict"],
            "publicLabel": report["publicLabel"],
            "citationCount": len(citations),
            "verifiedCitations": sum(
                bool(item.get("textLayerVerified") or item.get("ocrLineVerified"))
                for item in citations
            ),
            "modelSeconds": report["modelSeconds"],
            "report": str(report_path),
        })
    summary = {
        "schemaVersion": "local-public-pipeline-smoke-v1",
        "domainDecision": "NOT_ACCEPTED_PROBE_ONLY",
        "retrievalReport": str(retrieval_report),
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "cases": results,
    }
    summary_path = args.output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"elapsedSeconds": summary["elapsedSeconds"], "cases": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
