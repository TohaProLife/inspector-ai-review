#!/usr/bin/env python3
"""Locate source-shaped vector panels in an original TRAIN_PUBLIC PDF.

Output is a geometric proposal. Device identity and room linkage remain unknown.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import time

import fitz


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def red(color: object) -> bool:
    return color is not None and color[0] > 0.8 and color[1] < 0.2 and color[2] < 0.2


def blue(color: object) -> bool:
    return color is not None and color[2] > 0.8 and color[0] < 0.2 and color[1] < 0.2


def source_panel(page: fitz.Page, box: list[float]) -> fitz.Rect:
    x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    panels = [drawing["rect"] for drawing in page.get_drawings()
              if red(drawing.get("color")) and 2 < drawing["rect"].width < 25
              and 15 < drawing["rect"].height < 120
              and abs((drawing["rect"].x0 + drawing["rect"].x1) / 2 - x) < 5
              and abs((drawing["rect"].y0 + drawing["rect"].y1) / 2 - y) < 10]
    if len(panels) != 1:
        raise ValueError("template source must contain exactly one red panel")
    return panels[0]


def panels_with_blue_contact(page: fitz.Page, source: fitz.Rect) -> list[fitz.Rect]:
    red_panels = []
    blue_endpoints = []
    for drawing in page.get_drawings():
        color = drawing.get("color")
        if red(color):
            rect = drawing["rect"]
            if (source.width * 0.6 < rect.width < source.width * 1.8
                    and source.height * 0.3 < rect.height < source.height * 1.4):
                red_panels.append(rect)
        elif blue(color):
            for item in drawing["items"]:
                if item[0] == "l":
                    blue_endpoints.extend((item[1], item[2]))
    selected = [rect for rect in red_panels
                if any(min(abs(point.x - rect.x0), abs(point.x - rect.x1)) < 3
                       and rect.y0 < point.y < rect.y1 for point in blue_endpoints)]
    # Duplicate PDF paths are one proposal, not two devices.
    distinct = []
    for rect in selected:
        if not any(abs(rect.x0 - previous.x0) < 1 and abs(rect.y0 - previous.y0) < 1
                   and abs(rect.x1 - previous.x1) < 1 and abs(rect.y1 - previous.y1) < 1
                   for previous in distinct):
            distinct.append(rect)
    return sorted(distinct, key=lambda rect: (rect.y0, rect.x0))


def validate_training_sources(source: dict, target: dict, source_object_id: str,
                              cross_object_eval: bool) -> None:
    for row in (source, target):
        if row["split"] != "TRAIN_PUBLIC" or row["distribution_status"] != "INCLUDE":
            raise ValueError("only included TRAIN_PUBLIC sources are allowed")
    if source["object_id"] != source_object_id:
        raise ValueError("template source object mismatch")
    objects_differ = source["object_id"] != target["object_id"]
    if objects_differ != cross_object_eval:
        raise ValueError("cross-object evaluation flag must match object scope")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--template-library-sha256", required=True)
    parser.add_argument("--template-id", required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--target-file-id", required=True)
    parser.add_argument("--target-pdf", type=Path, required=True)
    parser.add_argument("--target-pages", type=int, nargs="+", required=True)
    parser.add_argument("--cross-object-eval", action="store_true",
                        help="explicitly evaluate transfer to another included TRAIN_PUBLIC object")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = {row["file_id"]: row for row in rows(args.manifest)}
    if digest(args.template_library) != args.template_library_sha256:
        parser.error("template library SHA-256 mismatch")
    library = json.loads(args.template_library.read_text(encoding="utf-8"))
    if (library.get("schema_version") != "drawing-template-library-v1"
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or library.get("manifest_sha256") != digest(args.manifest)):
        parser.error("unverified library")
    templates = [entry for entry in library["templates"] if entry["template_id"] == args.template_id]
    if len(templates) != 1:
        parser.error("template not found exactly once")
    template = templates[0]
    if template["class_id"] != "RADIATOR" or template["signal"] != "red":
        parser.error("vector panel locator supports red radiator template only")
    if (not isinstance(template.get("image"), str)
            or re.fullmatch(r"[A-Za-z0-9_-]+\.png", template["image"]) is None):
        parser.error("unsafe template image path")
    crop_path = args.template_library.parent / template["image"]
    if crop_path.is_symlink() or digest(crop_path) != template["image_sha256"]:
        parser.error("template crop SHA-256 mismatch")
    source = manifest[template["source_file_id"]]
    target = manifest[args.target_file_id]
    try:
        validate_training_sources(source, target, template["source_object_id"],
                                  args.cross_object_eval)
    except ValueError as error:
        parser.error(str(error))
    if (digest(args.source_pdf) != source["sha256"]
            or source["sha256"] != template["source_pdf_sha256"]
            or digest(args.target_pdf) != target["sha256"]):
        parser.error("source or target PDF SHA-256 mismatch")
    started = time.monotonic()
    with fitz.open(args.source_pdf) as source_pdf:
        shape = source_panel(source_pdf[template["source_page_number"] - 1],
                             template["source_bbox_display_pt"])
    candidates = []
    with fitz.open(args.target_pdf) as target_pdf:
        if len(set(args.target_pages)) != len(args.target_pages) or any(
                page < 1 or page > len(target_pdf) for page in args.target_pages):
            parser.error("invalid target pages")
        for page_number in args.target_pages:
            for rect in panels_with_blue_contact(target_pdf[page_number - 1], shape):
                candidates.append({
                    "file_id": args.target_file_id, "source_sha256": target["sha256"],
                    "page_number": page_number,
                    "bbox_display_pt": [round(rect.x0, 3), round(rect.y0, 3),
                                        round(rect.x1, 3), round(rect.y1, 3)],
                    "template_id": args.template_id,
                    "method": "red_vector_panel_with_blue_contact_v1",
                    "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED",
                })
    report = {
        "schema_version": "drawing-vector-public-locator-v1", "status": "EXPLORATORY_ONLY",
        "template_library_sha256": digest(args.template_library),
        "template_id": args.template_id, "target_file_id": args.target_file_id,
        "source_object_id": source["object_id"], "target_object_id": target["object_id"],
        "cross_object_eval": args.cross_object_eval,
        "target_pdf_sha256": target["sha256"], "target_pages": args.target_pages,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "candidate_count": len(candidates), "candidates": candidates,
        "limitation": "Geometric proposals do not establish symbol class, room, or full-sheet recall.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"target": args.target_file_id, "pages": args.target_pages,
                      "candidate_count": len(candidates), "elapsed_seconds": report["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
