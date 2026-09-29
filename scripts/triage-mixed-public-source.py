#!/usr/bin/env python3
"""Build a bounded, read-only text-layer review queue for a public mixed PDF.

The queue is a navigation aid. It never assigns a source stage or approves a sheet.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


RD_MARKER = re.compile(
    r"РАБОЧАЯ\s+ДОКУМЕНТАЦИЯ|РАБОЧИХ?\s+ЧЕРТЕЖ|РАБОЧИМ\s+ЧЕРТЕЖ|"
    r"[А-ЯA-Z0-9/.-]+-РД-[А-ЯA-Z0-9/.-]*",
    re.IGNORECASE,
)
ID_MARKER = re.compile(r"ИСПОЛНИТЕЛЬН\w*\s+(?:ДОКУМЕНТАЦИЯ|СХЕМА)", re.IGNORECASE)
VENDOR_MARKER = re.compile(r"\bKORF\b|\bКОРФ\b", re.IGNORECASE)
COMMERCIAL_MARKER = re.compile(
    r"КОММЕРЧЕСКОЕ\s+ПРЕДЛОЖЕНИЕ|СЧ[ЕЁ]Т\s+НА\s+ОПЛАТУ|ПРАЙС[ -]ЛИСТ",
    re.IGNORECASE,
)
NEAR_EMPTY_CHARS = 20
MAX_PAGES = 3000
GROUP_ORDER = (
    "conflicting_stage_markers", "explicit_id_text", "explicit_rd_text",
    "near_empty_text", "commercial_text", "vendor_text", "other_text",
)


def public_manifest_row(manifest: Path, source_id: str) -> tuple[dict[str, Any], str]:
    digest = hashlib.sha256()
    matches: list[dict[str, Any]] = []
    with manifest.open("rb") as stream:
        for line in stream:
            digest.update(line)
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("file_id") == source_id:
                matches.append(row)
    if len(matches) != 1:
        raise ValueError(f"Expected one manifest row for {source_id}; found {len(matches)}")
    row = matches[0]
    if (row.get("split"), row.get("distribution_status"), row.get("label_visibility"),
            row.get("stage")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", "RD_ID_MIXED"):
        raise ValueError("Source is not an included TRAIN_PUBLIC RD_ID_MIXED PDF")
    return row, digest.hexdigest()


def verified_pdf(pdf: Path, row: dict[str, Any]) -> tuple[int, str]:
    size = pdf.stat().st_size
    if size != row.get("size_bytes"):
        raise ValueError("PDF size differs from public manifest")
    digest = hashlib.sha256()
    with pdf.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("PDF signature differs from expected PDF")
        stream.seek(0)
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    sha = digest.hexdigest()
    if sha != row.get("sha256"):
        raise ValueError("PDF SHA-256 differs from public manifest")
    return size, sha


def extract_page_text(pdf: Path, expected_pages: int) -> list[str]:
    if not 1 <= expected_pages <= MAX_PAGES:
        raise ValueError("PDF page count outside triage bound")
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, check=True,
                          timeout=60, text=True).stdout
    match = re.search(r"^Pages:\s*(\d+)\s*$", info, re.MULTILINE)
    if match is None or int(match[1]) != expected_pages:
        raise ValueError("PDF page count differs from public manifest")
    raw = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True,
                         check=True, timeout=300).stdout
    pages = raw.decode("utf-8", "replace").split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    if len(pages) != expected_pages:
        raise ValueError("Text-layer page count differs from PDF page count")
    return pages


def bounded_page_ids(page_ids: list[int], limit: int) -> dict[str, Any]:
    return {"count": len(page_ids), "pageIds": page_ids[:limit],
            "omittedPageCount": max(0, len(page_ids) - limit)}


def build_triage(pages: list[str], *, source_id: str, source_sha256: str,
                 source_size_bytes: int, manifest_sha256: str,
                 list_limit: int = 50) -> dict[str, Any]:
    if not 1 <= list_limit <= 200:
        raise ValueError("list_limit must be between 1 and 200")
    if not 1 <= len(pages) <= MAX_PAGES:
        raise ValueError("PDF page count outside triage bound")
    cues: dict[str, list[int]] = {
        "explicit_rd_text": [], "explicit_id_text": [], "near_empty_text": [],
        "vendor_text": [], "commercial_text": [], "conflicting_stage_markers": [],
    }
    queue: dict[str, list[int]] = {name: [] for name in GROUP_ORDER}
    for number, text in enumerate(pages, 1):
        rd = bool(RD_MARKER.search(text))
        id_ = bool(ID_MARKER.search(text))
        empty = len(text.strip()) < NEAR_EMPTY_CHARS
        vendor = bool(VENDOR_MARKER.search(text))
        commercial = bool(COMMERCIAL_MARKER.search(text))
        for cue, present in (("explicit_rd_text", rd), ("explicit_id_text", id_),
                             ("near_empty_text", empty), ("vendor_text", vendor),
                             ("commercial_text", commercial),
                             ("conflicting_stage_markers", rd and id_)):
            if present:
                cues[cue].append(number)
        if rd and id_:
            group = "conflicting_stage_markers"
        elif id_:
            group = "explicit_id_text"
        elif rd:
            group = "explicit_rd_text"
        elif empty:
            group = "near_empty_text"
        elif commercial:
            group = "commercial_text"
        elif vendor:
            group = "vendor_text"
        else:
            group = "other_text"
        queue[group].append(number)
    return {
        "schemaVersion": "mixed-public-source-triage-v1",
        "status": "REVIEW_QUEUE_ONLY",
        "source": {
            "fileId": source_id, "split": "TRAIN_PUBLIC", "distributionStatus": "INCLUDE",
            "labelVisibility": "PUBLIC_TRAIN", "manifestSha256": manifest_sha256,
            "pdfSha256": source_sha256, "pdfSizeBytes": source_size_bytes,
            "pageCount": len(pages),
        },
        "method": {"textLayerTool": "pdftotext -layout", "pageCountTool": "pdfinfo",
                   "nearEmptyThresholdCharacters": NEAR_EMPTY_CHARS,
                   "listedPageLimitPerGroup": list_limit,
                   "queuePriority": list(GROUP_ORDER)},
        "textCues": {name: bounded_page_ids(page_ids, list_limit)
                     for name, page_ids in cues.items()},
        "reviewQueue": {name: bounded_page_ids(queue[name], list_limit)
                        for name in GROUP_ORDER},
        "stageAssignments": None,
        "unresolvedWithinThisReport": bounded_page_ids(list(range(1, len(pages) + 1)), list_limit),
        "limitations": [
            "Text cues select pages for human review; they do not classify RD or ID stages.",
            "Near-empty text can contain drawings or scanned ID that text extraction cannot read.",
            "No revision, approval, link, compliance or finding decision is made.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--list-limit", type=int, default=50)
    args = parser.parse_args()
    if args.output.resolve() in (args.pdf.resolve(), args.manifest.resolve()):
        raise ValueError("Output path must differ from source PDF and manifest")
    row, manifest_sha = public_manifest_row(args.manifest, args.source_id)
    size, pdf_sha = verified_pdf(args.pdf, row)
    pages = extract_page_text(args.pdf, row["pdf_pages"])
    report = build_triage(pages, source_id=args.source_id, source_sha256=pdf_sha,
                          source_size_bytes=size, manifest_sha256=manifest_sha,
                          list_limit=args.list_limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True,
                                      indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceId": args.source_id, "pageCount": len(pages),
                      "reviewQueueCounts": {key: value["count"] for key, value
                                            in report["reviewQueue"].items()},
                      "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
