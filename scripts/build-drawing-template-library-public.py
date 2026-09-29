#!/usr/bin/env python3
"""Freeze experimental TRAIN_PUBLIC symbol crops without copying evaluation labels."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re

import cv2


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--tile-map", type=Path, required=True)
    parser.add_argument("--tile-base", type=Path, required=True)
    parser.add_argument("--template", action="append", required=True,
                        help="annotation_id:signal, signal = red|red_blue|dark")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest = {row["file_id"]: row for row in rows(args.manifest)}
    annotations = {row["annotation_id"]: row for row in rows(args.annotations)}
    tile_map = {row["annotation_id"]: row for row in rows(args.tile_map)}
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        parser.error("output directory must be empty")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    seen = set()
    for spec in args.template:
        try:
            annotation_id, signal = spec.rsplit(":", 1)
        except ValueError:
            parser.error("template must be annotation_id:signal")
        if (not re.fullmatch(r"[A-Za-z0-9_-]+", annotation_id)
                or signal not in {"red", "red_blue", "dark"} or annotation_id in seen):
            parser.error("invalid or duplicate template")
        seen.add(annotation_id)
        annotation = annotations[annotation_id]
        mapping = tile_map[annotation_id]
        source = manifest[annotation["file_id"]]
        if (annotation["status"] != "AI_CROSSCHECKED"
                or annotation["kind"] != "POSITIVE_CANDIDATE"
                or annotation["class_id"] not in {"RADIATOR", "HEATING_LOOP"}
                or source["split"] != "TRAIN_PUBLIC"
                or source["distribution_status"] != "INCLUDE"
                or annotation["source_sha256"] != source["sha256"]
                or mapping["source_sha256"] != source["sha256"]
                or mapping["master_sha256"] != digest(args.tile_base / mapping["master_png"])):
            parser.error(f"unverified template: {annotation_id}")
        image = cv2.imread(str(args.tile_base / mapping["master_png"]), cv2.IMREAD_COLOR)
        if image is None:
            parser.error(f"undecodable source tile: {annotation_id}")
        x0, y0, x1, y1 = mapping["bbox_master_px"]
        left, top = max(0, math.floor(x0)), max(0, math.floor(y0))
        right, bottom = min(image.shape[1], math.ceil(x1)), min(image.shape[0], math.ceil(y1))
        if left >= right or top >= bottom:
            parser.error(f"invalid crop: {annotation_id}")
        name = f"{annotation_id}.png"
        png = args.output_dir / name
        if not cv2.imwrite(str(png), image[top:bottom, left:right]):
            parser.error(f"cannot write crop: {annotation_id}")
        entries.append({
            "template_id": annotation_id, "class_id": annotation["class_id"],
            "signal": signal, "image": name, "image_sha256": digest(png),
            "symbol_bbox_in_image_px": [x0 - left, y0 - top, x1 - left, y1 - top],
            "source_file_id": annotation["file_id"], "source_page_number": annotation["page_number"],
            "source_pdf_sha256": source["sha256"], "source_object_id": source["object_id"],
            "source_bbox_display_pt": annotation["bbox_display_pt"],
            "source_tile_id": mapping["tile_id"], "source_tile_sha256": mapping["master_sha256"],
            "source_annotation_status": annotation["status"],
            "human_review_required": True,
        })
    library = {
        "schema_version": "drawing-template-library-v1",
        "release_status": "EXPERIMENTAL_REVIEW_REQUIRED",
        "manifest_sha256": digest(args.manifest),
        "tile_index_sha256": digest(args.tile_base / "tiles.jsonl"),
        "templates": entries,
    }
    library_path = args.output_dir / "library.json"
    library_path.write_text(json.dumps(library, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"library": str(library_path), "sha256": digest(library_path),
                      "templates": [entry["template_id"] for entry in entries]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
