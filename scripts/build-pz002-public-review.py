#!/usr/bin/env python3
"""Build a source-verified PZ-002 review packet without making a finding."""

from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess


VALUE = r"(?P<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)"
AREA_PATTERNS = (
    re.compile(r"общая[ \t]+площадь[ \t]+здания[ \t]*,[ \t]*в[ \t]+т\.?[ \t]*ч\.?:?"
               r"[ \t\r\n]*(?P<unit>м[ \t]*[²2]|кв\.?[ \t]*м\.?)"
               r"[ \t\r\n]{1,40}" + VALUE, re.IGNORECASE),
    re.compile(r"общая[ \t]+площадь[ \t]+здания[ \t]+S[ \t]*=[ \t]*" + VALUE
               + r"[ \t\r\n]*(?P<unit>м[ \t]*[²2]|кв\.?[ \t]*м\.?)", re.IGNORECASE),
    re.compile(r"общая[ \t]+площадь[ \t]+здания[ \t\r\n:;=—–-]{1,24}" + VALUE
               + r"[ \t\r\n]*(?P<unit>м[ \t]*[²2]|кв\.?[ \t]*м\.?)", re.IGNORECASE),
)


def area_matches(pages: list[str]) -> list[dict[str, object]]:
    found = []
    for page_number, page in enumerate(pages, 1):
        for pattern in AREA_PATTERNS:
            for match in pattern.finditer(page):
                found.append({
                    "pageNumber": page_number,
                    "rawValue": match.group("value"),
                    "rawUnit": match.group("unit"),
                    "textExcerpt": " ".join(match.group().split()),
                })
    return found


def verified_source(manifest: dict[str, dict], entry: str) -> tuple[dict, Path]:
    source_id, separator, raw_path = entry.partition("=")
    if not separator or not source_id or not raw_path:
        raise ValueError("source must be FILE_ID=PATH")
    row = manifest.get(source_id)
    if (row is None or row.get("split") != "TRAIN_PUBLIC"
            or row.get("distribution_status") != "INCLUDE"
            or row.get("label_visibility") != "PUBLIC_TRAIN"):
        raise ValueError(f"{source_id} is not an included public training source")
    path = Path(raw_path)
    data = path.read_bytes()
    if len(data) != row["size_bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError(f"{source_id} bytes do not match document_manifest.jsonl")
    if not data.startswith(b"%PDF-"):
        raise ValueError(f"{source_id} is not a PDF")
    return row, path


def source_observation(row: dict, path: Path, output_dir: Path) -> dict:
    text = subprocess.run(["pdftotext", "-layout", str(path), "-"],
                          check=True, capture_output=True).stdout.decode("utf-8", "replace")
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    if len(pages) != row["pdf_pages"]:
        raise ValueError(f"{row['file_id']} page count differs from public manifest")
    matches = area_matches(pages)
    if len(matches) != 1:
        raise ValueError(f"{row['file_id']} has {len(matches)} building-area text matches; manual scope required")
    match = matches[0]
    image_name = f"{row['file_id']}-p{match['pageNumber']}.png"
    prefix = output_dir / image_name.removesuffix(".png")
    subprocess.run(["pdftoppm", "-f", str(match["pageNumber"]), "-l", str(match["pageNumber"]),
                    "-r", "150", "-png", "-singlefile", str(path), str(prefix)],
                   check=True, capture_output=True)
    image_path = output_dir / image_name
    return {
        "sourceFileId": row["file_id"], "sourceSha256": row["sha256"],
        "sourceSizeBytes": row["size_bytes"], "manifestStage": row["stage"],
        "pdfPageNumber": match["pageNumber"], "rawValue": match["rawValue"],
        "rawUnit": match["rawUnit"], "textExcerpt": match["textExcerpt"],
        "renderedImage": image_name,
        "renderedImageSha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "evidenceStatus": "PAGE_LEVEL_REVIEW_REQUIRED",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--pd", required=True, help="FILE_ID=PATH")
    parser.add_argument("--rd", required=True, help="FILE_ID=PATH")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = {row["file_id"]: row for row in (
        json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines()
    )}
    pd_row, pd_path = verified_source(manifest, args.pd)
    rd_row, rd_path = verified_source(manifest, args.rd)
    if (pd_row["object_id"] != rd_row["object_id"] or pd_row["stage"] != "PD"
            or rd_row["stage"] not in {"RD", "RD_ID_MIXED"}):
        raise ValueError("sources must be PD and RD of the same object")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    expected = source_observation(pd_row, pd_path, args.output_dir)
    actual = source_observation(rd_row, rd_path, args.output_dir)
    pd_value = Decimal(str(expected["rawValue"]).replace(" ", "").replace("\u00a0", "").replace(",", "."))
    rd_value = Decimal(str(actual["rawValue"]).replace(" ", "").replace("\u00a0", "").replace(",", "."))
    if pd_value <= 0:
        raise ValueError("expected area must be positive")
    delta = abs(rd_value - pd_value) / pd_value
    report = {
        "schemaVersion": "pz002-public-review-packet-v1",
        "split": "TRAIN_PUBLIC", "objectId": pd_row["object_id"],
        "disposition": "MEASUREMENT_PREVIEW_ONLY",
        "comparison": {"expectedM2": str(pd_value), "actualM2": str(rd_value),
                       "absoluteDifferenceM2": str(abs(rd_value - pd_value)),
                       "relativeDifference": str(delta), "thresholdExceeded": delta > Decimal("0.01")},
        "sources": [expected, actual],
        "requiredBeforeFinding": ["SOURCE_REVISION_REVIEW", "SOURCE_APPROVAL_REVIEW",
                                  "PD_RD_LINK_REVIEW", "MIXED_STAGE_PAGE_REVIEW",
                                  "INDEPENDENT_TABLE_CELL_VERIFICATION"],
    }
    (args.output_dir / "review.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"disposition": report["disposition"], "comparison": report["comparison"],
                      "outputDir": str(args.output_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
