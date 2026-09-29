#!/usr/bin/env python3
"""Render full TRAIN_PUBLIC sheets with locator proposals for independent review.

The overviews help find locator misses. They are not gold labels, and reviewing
the PNG alone is insufficient: inspect the original PDF at full resolution.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import fitz
import numpy as np


MAX_PIXELS = 12_000_000
MAX_SIDE = 4000


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def build_packet(manifest_path: Path, library_path: Path, report_path: Path,
                 pdf_path: Path, pages: list[int], output_dir: Path) -> dict:
    if not pages or any(type(page) is not int or page < 1 for page in pages) or len(set(pages)) != len(pages):
        raise ValueError("selected pages must be unique and nonempty")
    manifest = {}
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get("file_id"), str):
            raise ValueError("manifest row has no file ID")
        if row["file_id"] in manifest:
            raise ValueError("duplicate file ID in manifest")
        manifest[row["file_id"]] = row
    library = json.loads(library_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))
    source = manifest.get(report.get("target_file_id"))
    if (not source or source.get("split") != "TRAIN_PUBLIC"
            or source.get("distribution_status") != "INCLUDE"
            or pdf_path.stat().st_size != source.get("size_bytes")
            or digest(pdf_path) != source.get("sha256")):
        raise ValueError("source must be a SHA-verified included TRAIN_PUBLIC PDF")
    if (library.get("schema_version") != "drawing-template-library-v1"
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or library.get("manifest_sha256") != digest(manifest_path)
            or report.get("template_library_sha256") != digest(library_path)):
        raise ValueError("template library provenance mismatch")
    if not isinstance(library.get("templates"), list):
        raise ValueError("template library has no templates array")
    templates = [item for item in library["templates"] if isinstance(item, dict)
                 if item.get("template_id") == report.get("template_id")]
    if len(templates) != 1 or templates[0].get("class_id") != "RADIATOR":
        raise ValueError("expected one RADIATOR template")
    template_source = manifest.get(templates[0].get("source_file_id"))
    if (not template_source or template_source.get("split") != "TRAIN_PUBLIC"
            or template_source.get("distribution_status") != "INCLUDE"
            or template_source.get("sha256") != templates[0].get("source_pdf_sha256")
            or template_source.get("object_id") != templates[0].get("source_object_id")):
        raise ValueError("template source is not included TRAIN_PUBLIC")
    if (report.get("schema_version") != "drawing-vector-public-locator-v1"
            or report.get("status") != "EXPLORATORY_ONLY"
            or report.get("target_pdf_sha256") != source["sha256"]
            or report.get("target_object_id") != source["object_id"]
            or report.get("source_object_id") != template_source["object_id"]
            or type(report.get("cross_object_eval")) is not bool
            or report["cross_object_eval"] != (source["object_id"] != template_source["object_id"])
            or not isinstance(report.get("target_pages"), list)
            or any(type(page) is not int for page in report["target_pages"])
            or not set(pages).issubset(report["target_pages"])
            or not isinstance(report.get("candidates"), list)
            or report.get("candidate_count") != len(report["candidates"])):
        raise ValueError("locator report provenance or scope mismatch")

    output_dir.mkdir(parents=True, exist_ok=True)
    page_entries = []
    with fitz.open(pdf_path) as document:
        if len(document) != source["pdf_pages"]:
            raise ValueError("PDF page count differs from manifest")
        grouped: dict[int, list[tuple[str, fitz.Rect]]] = {page: [] for page in pages}
        for index, candidate in enumerate(report["candidates"], 1):
            if not isinstance(candidate, dict):
                raise ValueError(f"candidate {index} is not an object")
            page_number = candidate.get("page_number")
            if (candidate.get("file_id") != source["file_id"]
                    or candidate.get("source_sha256") != source["sha256"]
                    or type(page_number) is not int or page_number not in report["target_pages"]
                    or page_number < 1 or page_number > len(document)
                    or candidate.get("template_id") != report["template_id"]
                    or candidate.get("method") != "red_vector_panel_with_blue_contact_v1"
                    or candidate.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"):
                raise ValueError(f"candidate {index} provenance mismatch")
            bounds = candidate.get("bbox_display_pt")
            if (not isinstance(bounds, list) or len(bounds) != 4
                    or any(type(value) not in {int, float} for value in bounds)):
                raise ValueError(f"candidate {index} geometry invalid")
            rect = fitz.Rect(bounds)
            if rect.is_empty or rect.is_infinite or not document[page_number - 1].rect.contains(rect):
                raise ValueError(f"candidate {index} outside PDF page")
            if page_number in grouped:
                grouped[page_number].append((f"{source['file_id']}-P{page_number:05d}-V{index:04d}", rect))

        for page_number in pages:
            page = document[page_number - 1]
            scale = min(2.0, MAX_SIDE / page.rect.width, MAX_SIDE / page.rect.height,
                        (MAX_PIXELS / (page.rect.width * page.rect.height)) ** 0.5)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n).copy()
            if pixmap.n != 3:
                raise ValueError("unexpected PDF render channel count")
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
            ids = []
            for candidate_id, rect in grouped[page_number]:
                x0, y0, x1, y1 = (round(value * scale) for value in rect)
                cv2.rectangle(image, (x0, y0), (x1, y1), (0, 0, 220), 2)
                cv2.putText(image, candidate_id.rsplit("V", 1)[-1],
                            (max(0, x0 - 20), max(18, y0 - 5)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 160), 1, cv2.LINE_AA)
                ids.append(candidate_id)
            name = f"page-{page_number:05d}-proposals.png"
            image_path = output_dir / name
            if not cv2.imwrite(str(image_path), image):
                raise ValueError("cannot write page overview")
            page_entries.append({"page_number": page_number, "image": name,
                                 "image_sha256": digest(image_path), "render_scale": round(scale, 8),
                                 "candidate_count": len(ids), "candidate_ids": ids,
                                 "review_status": "UNREVIEWED"})
    packet = {"schema_version": "drawing-full-sheet-review-packet-v1",
              "status": "REVIEW_PENDING", "file_id": source["file_id"],
              "object_id": source["object_id"], "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(manifest_path),
              "template_library_sha256": digest(library_path),
              "locator_report_sha256": digest(report_path), "pages": page_entries,
              "limitation": "Review source PDF at full resolution and record all missed symbols before declaring FULL_SHEET."}
    (output_dir / "review-index.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return packet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--page", type=int, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = build_packet(args.manifest, args.template_library, args.locator_report,
                          args.source_pdf, args.page, args.output_dir)
    print(json.dumps({"file_id": result["file_id"], "pages": [page["page_number"] for page in result["pages"]],
                      "candidate_count": sum(page["candidate_count"] for page in result["pages"])}))


if __name__ == "__main__":
    main()
