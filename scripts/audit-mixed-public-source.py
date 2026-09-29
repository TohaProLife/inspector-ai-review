#!/usr/bin/env python3
"""Prepare an evidence-limited page-stage proposal from a public mixed PDF."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


RD_MARKER = re.compile(
    r"РАБОЧАЯ\s+ДОКУМЕНТАЦИЯ|РАБОЧИХ?\s+ЧЕРТЕЖ|РАБОЧИМ\s+ЧЕРТЕЖ|"
    r"АНО/150321/1-РД-",
    re.IGNORECASE,
)
ID_MARKER = re.compile(r"ИСПОЛНИТЕЛЬН\w*\s+(?:ДОКУМЕНТАЦИЯ|СХЕМА)", re.IGNORECASE)


def expand_pages(specification: str) -> list[int]:
    pages: set[int] = set()
    for part in specification.split(","):
        match = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", part)
        if not match:
            raise ValueError(f"Invalid page range: {part}")
        start, end = int(match[1]), int(match[2] or match[1])
        if start < 1 or end < start:
            raise ValueError(f"Invalid page range: {part}")
        pages.update(range(start, end + 1))
    return sorted(pages)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--rd-pages", required=True, help="Page numbers checked against explicit RD markers")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    row = None
    for line in args.manifest.read_text().splitlines():
        if not line.strip():
            continue
        candidate = json.loads(line)
        if candidate.get("file_id") == args.source_id:
            row = candidate
            break
    if row is None or any((row.get("split") != "TRAIN_PUBLIC",
                           row.get("distribution_status") != "INCLUDE",
                           row.get("label_visibility") != "PUBLIC_TRAIN",
                           row.get("stage") != "RD_ID_MIXED")):
        raise ValueError("Source is not an included TRAIN_PUBLIC RD_ID_MIXED PDF")
    data = args.pdf.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if not data.startswith(b"%PDF-") or len(data) != row["size_bytes"] or digest != row["sha256"]:
        raise ValueError("PDF signature, size or SHA-256 differs from public manifest")
    raw = subprocess.check_output(["pdftotext", "-layout", str(args.pdf), "-"], timeout=180)
    pages = raw.decode("utf-8", "replace").split("\f")
    if not pages[-1].strip():
        pages.pop()
    rd_pages = expand_pages(args.rd_pages)
    if any(page > len(pages) for page in rd_pages):
        raise ValueError("RD page exceeds PDF page count")
    evidence = []
    for number in rd_pages:
        match = RD_MARKER.search(pages[number - 1])
        if not match:
            raise ValueError(f"Page {number} has no explicit RD marker in text layer")
        evidence.append({"page": number, "marker": " ".join(match.group().split())})
    explicit_id_pages = [index + 1 for index, text in enumerate(pages) if ID_MARKER.search(text)]
    page_stages = {str(index + 1): "UNRESOLVED" for index in range(len(pages))}
    page_stages.update({str(number): "RD" for number in rd_pages})
    report = {
        "sourceId": args.source_id,
        "split": row["split"],
        "sourceSha256": digest,
        "pageCount": len(pages),
        "explicitRdEvidence": evidence,
        "explicitIdTextPages": explicit_id_pages,
        "nearEmptyTextPageCount": sum(len(text.strip()) < 20 for text in pages),
        "limitations": [
            "Text-layer markers do not prove that every page has been visually classified.",
            "Missing ID text does not prove that no ID page exists in scanned pages.",
            "A signature on one sheet does not establish global revision or approval status.",
        ],
        "sourceReviewProposal": {
            "sourceSha256": digest,
            "revisionStatus": "UNKNOWN",
            "approvalStatus": "UNKNOWN",
            "linkGroupId": None,
            "pageStages": page_stages,
            "basis": {"reference": (
                f"TRAIN_PUBLIC {args.source_id} SHA-256 {digest[:16]}; explicit RD markers on pages "
                f"{args.rd_pages}; other pages UNRESOLVED. No verified ID page or global "
                "revision/approval evidence in source audit."
            )},
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"sourceId": args.source_id, "pageCount": len(pages),
                      "rdPages": rd_pages, "unresolvedPages": len(pages) - len(rd_pages),
                      "explicitIdTextPages": explicit_id_pages,
                      "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
