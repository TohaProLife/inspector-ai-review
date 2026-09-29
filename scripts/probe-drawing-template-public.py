#!/usr/bin/env python3
"""Reproducible, offline raster-template retrieval probe on TRAIN_PUBLIC tiles.

This is a locator experiment, not a symbol classifier or exhaustive evaluation.
The source annotation supplies a template; target annotations are read only after
matching and are used solely for a bounded retrieval audit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import time

import cv2
import numpy as np


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def signal_mask(image: np.ndarray, signal: str) -> np.ndarray:
    blue, green, red = cv2.split(image)
    red_ink = ((red.astype(np.int16) > 115)
               & (red.astype(np.int16) > green.astype(np.int16) + 45)
               & (red.astype(np.int16) > blue.astype(np.int16) + 35))
    blue_ink = ((blue.astype(np.int16) > 115)
                & (blue.astype(np.int16) > green.astype(np.int16) + 45)
                & (blue.astype(np.int16) > red.astype(np.int16) + 35))
    if signal == "red":
        return red_ink.astype(np.uint8) * 255
    if signal == "red_blue":
        return red_ink.astype(np.uint8) * 255 + blue_ink.astype(np.uint8) * 127
    if signal == "dark":
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return (gray < 105).astype(np.uint8) * 255
    raise ValueError(f"unknown signal: {signal}")


def load_verified_tile(base: Path, tile: dict) -> np.ndarray:
    image_path = base / tile["master_png"]
    if sha256(image_path) != tile["master_sha256"]:
        raise ValueError(f"tile SHA-256 mismatch: {tile['tile_id']}")
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"cannot decode tile: {tile['tile_id']}")
    return image


def tile_bbox_to_display(bbox: tuple[float, float, float, float],
                         origin: tuple[int, int], scale: float) -> list[float]:
    if scale <= 0:
        raise ValueError("invalid page scale")
    x0, y0, x1, y1 = bbox
    ox, oy = origin
    return [round((ox + x0) / scale, 3), round((oy + y0) / scale, 3),
            round((ox + x1) / scale, 3), round((oy + y1) / scale, 3)]


def in_known_region(candidate: dict, annotation: dict) -> bool:
    # A locator is useful when its proposed symbol center falls in the marked
    # region. This does not prove symbol class, instance count, or full recall.
    box = annotation["bbox_display_pt"]
    center_x = (candidate["bbox_display_pt"][0] + candidate["bbox_display_pt"][2]) / 2
    center_y = (candidate["bbox_display_pt"][1] + candidate["bbox_display_pt"][3]) / 2
    return box[0] <= center_x <= box[2] and box[1] <= center_y <= box[3]


def red_panel_with_blue_leader_paths(page: object, source_width: float,
                                     source_height: float) -> list[object]:
    """Find red panel-like vector paths touched by a blue leader at either side.

    This is only geometric support. A blue pipe or leader could touch another
    device, so it cannot establish the semantic class on its own.
    """
    drawings = page.get_drawings()
    red_rectangles = []
    blue_endpoints = []
    for drawing in drawings:
        color = drawing.get("color")
        if color is None:
            continue
        if color[0] > 0.8 and color[1] < 0.2 and color[2] < 0.2:
            rect = drawing["rect"]
            if (source_width * 0.6 < rect.width < source_width * 1.8
                    and source_height * 0.3 < rect.height < source_height * 1.4):
                red_rectangles.append(rect)
        elif color[2] > 0.8 and color[0] < 0.2 and color[1] < 0.2:
            for item in drawing["items"]:
                if item[0] == "l":
                    blue_endpoints.extend((item[1], item[2]))
    return [rect for rect in red_rectangles
            if any(min(abs(point.x - rect.x0), abs(point.x - rect.x1)) < 3
                   and rect.y0 < point.y < rect.y1 for point in blue_endpoints)]


def source_panel_geometry(page: object, box: list[float]) -> tuple[float, float]:
    center_x, center_y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    panels = []
    for drawing in page.get_drawings():
        color = drawing.get("color")
        if color is None or not (color[0] > 0.8 and color[1] < 0.2 and color[2] < 0.2):
            continue
        rect = drawing["rect"]
        if (2 < rect.width < 25 and 15 < rect.height < 120
                and abs((rect.x0 + rect.x1) / 2 - center_x) < 5
                and abs((rect.y0 + rect.y1) / 2 - center_y) < 10):
            panels.append(rect)
    if len(panels) != 1:
        raise ValueError("template does not contain exactly one vector red panel")
    return panels[0].width, panels[0].height


def candidate_overlaps_panel(box: list[float], rect: object) -> bool:
    center_x = (box[0] + box[2]) / 2
    overlap_y = max(0.0, min(box[3], rect.y1) - max(box[1], rect.y0))
    return (abs((rect.x0 + rect.x1) / 2 - center_x) < 3
            and overlap_y / min(box[3] - box[1], rect.height) >= 0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--tile-base", type=Path, required=True)
    parser.add_argument("--annotations", type=Path)
    parser.add_argument("--tile-map", type=Path)
    parser.add_argument("--template-library", type=Path,
                        help="inference mode: frozen crops; no annotation access")
    parser.add_argument("--template-library-sha256",
                        help="expected immutable library.json SHA-256 in inference mode")
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--target-file-id", required=True)
    parser.add_argument("--target-pages", type=int, nargs="+", required=True)
    parser.add_argument("--margin", type=int, default=0)
    parser.add_argument("--signal", choices=("red", "red_blue", "dark"), default="red")
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--scales", type=float, nargs="+", default=[0.8, 1.0, 1.2])
    parser.add_argument("--pdf-dir", type=Path)
    parser.add_argument("--vector-context", action="store_true",
                        help="audit red radiator proposals for panel path and blue leader")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.margin < 0 or not 0 < args.threshold <= 1 or any(scale <= 0 for scale in args.scales):
        parser.error("invalid margin, threshold, or scale")
    if args.vector_context and (not args.pdf_dir or args.signal != "red"):
        parser.error("vector context requires --pdf-dir and --signal red")
    manifest = {row["file_id"]: row for row in rows(args.manifest)}
    annotations: list[dict] = []
    source_image: np.ndarray
    if args.template_library:
        if args.annotations or args.tile_map:
            parser.error("library inference must not read annotations or tile maps")
        if (not args.template_library_sha256
                or sha256(args.template_library) != args.template_library_sha256):
            parser.error("template library SHA-256 mismatch")
        library = json.loads(args.template_library.read_text(encoding="utf-8"))
        if (library.get("schema_version") != "drawing-template-library-v1"
                or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
                or library.get("manifest_sha256") != sha256(args.manifest)):
            parser.error("invalid or mismatched template library")
        entries = [row for row in library["templates"] if row["template_id"] == args.source_id]
        if len(entries) != 1:
            parser.error("template not found exactly once")
        entry = entries[0]
        if entry["signal"] != args.signal or entry["human_review_required"] is not True:
            parser.error("template signal or review status mismatch")
        if (not isinstance(entry.get("image"), str)
                or re.fullmatch(r"[A-Za-z0-9_-]+\.png", entry["image"]) is None):
            parser.error("unsafe template image path")
        image_path = args.template_library.parent / entry["image"]
        if image_path.is_symlink() or sha256(image_path) != entry["image_sha256"]:
            parser.error("template crop SHA-256 mismatch")
        source_image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if source_image is None:
            parser.error("cannot decode template crop")
        source = {"status": entry["source_annotation_status"],
                  "kind": "POSITIVE_CANDIDATE", "class_id": entry["class_id"],
                  "file_id": entry["source_file_id"], "object_id": entry["source_object_id"],
                  "page_number": entry["source_page_number"],
                  "bbox_display_pt": entry["source_bbox_display_pt"]}
        source_tile = {"source_sha256": entry["source_pdf_sha256"],
                       "master_sha256": entry["source_tile_sha256"],
                       "bbox_master_px": entry["symbol_bbox_in_image_px"]}
    else:
        if args.template_library_sha256:
            parser.error("library hash requires --template-library")
        if not args.annotations or not args.tile_map:
            parser.error("annotation audit requires --annotations and --tile-map")
        annotations = rows(args.annotations)
        annotation_by_id = {row["annotation_id"]: row for row in annotations}
        tile_map = {row["annotation_id"]: row for row in rows(args.tile_map)}
        source = annotation_by_id[args.source_id]
        source_tile = tile_map[args.source_id]
        source_image = load_verified_tile(args.tile_base, source_tile)
    if source["status"] != "AI_CROSSCHECKED" or source["kind"] != "POSITIVE_CANDIDATE":
        parser.error("source is not a crosschecked positive template")
    target_file = manifest[args.target_file_id]
    for item in (manifest[source["file_id"]], target_file):
        if item["split"] != "TRAIN_PUBLIC" or item["distribution_status"] != "INCLUDE":
            parser.error("only included TRAIN_PUBLIC sources are allowed")
        if item["object_id"] != source["object_id"]:
            parser.error("source and target object mismatch")
        if args.pdf_dir:
            pdf = args.pdf_dir / f"{item['file_id']}_raw.pdf"
            if pdf.stat().st_size != item["size_bytes"] or sha256(pdf) != item["sha256"]:
                parser.error(f"PDF size or SHA-256 mismatch: {item['file_id']}")
    if source_tile["source_sha256"] != manifest[source["file_id"]]["sha256"]:
        parser.error("template source SHA-256 mismatch")
    tiles = [row for row in rows(args.tile_base / "tiles.jsonl")
             if row["file_id"] == args.target_file_id and row["page_number"] in args.target_pages]
    if not tiles:
        parser.error("no target tiles")
    for tile in tiles:
        if tile["source_sha256"] != target_file["sha256"]:
            parser.error("target tile source SHA-256 mismatch")
    bx0, by0, bx1, by1 = source_tile["bbox_master_px"]
    x0, y0 = max(0, math.floor(bx0) - args.margin), max(0, math.floor(by0) - args.margin)
    x1 = min(source_image.shape[1], math.ceil(bx1) + args.margin)
    y1 = min(source_image.shape[0], math.ceil(by1) + args.margin)
    template = signal_mask(source_image[y0:y1, x0:x1], args.signal)
    if np.count_nonzero(template) < 10 or np.count_nonzero(template) == template.size:
        parser.error("template has insufficient signal")
    started = time.monotonic()
    matches: list[dict] = []
    for tile in tiles:
        image = load_verified_tile(args.tile_base, tile)
        target = signal_mask(image, args.signal)
        ox, oy = tile["tile"]["origin_px"]
        scale_to_pt = tile["render"]["scale"]
        valid = tile["tile"]["valid_rect_px"]
        for scale in args.scales:
            pattern = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
            height, width = pattern.shape
            if height > target.shape[0] or width > target.shape[1] or pattern.std() == 0:
                continue
            score_map = cv2.matchTemplate(target, pattern, cv2.TM_CCOEFF_NORMED)
            # Local maxima are enough for retrieval; per-tile cap bounds output.
            for _ in range(12):
                _, score, _, (mx, my) = cv2.minMaxLoc(score_map)
                if score < args.threshold:
                    break
                rx0 = mx + (bx0 - x0) * scale
                ry0 = my + (by0 - y0) * scale
                rx1 = mx + (bx1 - x0) * scale
                ry1 = my + (by1 - y0) * scale
                if valid[0] <= (rx0 + rx1) / 2 < valid[2] and valid[1] <= (ry0 + ry1) / 2 < valid[3]:
                    matches.append({
                        "file_id": tile["file_id"], "page_number": tile["page_number"],
                        "source_sha256": tile["source_sha256"], "tile_id": tile["tile_id"],
                        "tile_sha256": tile["master_sha256"], "template_id": args.source_id,
                        "score_kind": f"{args.signal}_mask_ccoeff_normed_uncalibrated", "score": round(float(score), 6),
                        "scale": scale,
                        "bbox_display_pt": tile_bbox_to_display(
                            (rx0, ry0, rx1, ry1), (ox, oy), scale_to_pt),
                    })
                radius_x, radius_y = max(8, width // 3), max(8, height // 3)
                score_map[max(0, my - radius_y):min(score_map.shape[0], my + radius_y + 1),
                          max(0, mx - radius_x):min(score_map.shape[1], mx + radius_x + 1)] = -1
    matches.sort(key=lambda row: (-row["score"], row["page_number"], row["tile_id"]))
    # Merge duplicate proposals from overlapping tiles and adjacent scales.
    unique: list[dict] = []
    for match in matches:
        cx = (match["bbox_display_pt"][0] + match["bbox_display_pt"][2]) / 2
        cy = (match["bbox_display_pt"][1] + match["bbox_display_pt"][3]) / 2
        if any(previous["page_number"] == match["page_number"]
               and abs((previous["bbox_display_pt"][0] + previous["bbox_display_pt"][2]) / 2 - cx) < 12
               and abs((previous["bbox_display_pt"][1] + previous["bbox_display_pt"][3]) / 2 - cy) < 30
               for previous in unique):
            continue
        unique.append(match)
    if args.vector_context:
        if source["class_id"] != "RADIATOR":
            parser.error("vector context currently supports red radiator templates only")
        import fitz

        with fitz.open(args.pdf_dir / f"{source['file_id']}_raw.pdf") as source_pdf:
            source_width, source_height = source_panel_geometry(
                source_pdf[source["page_number"] - 1], source["bbox_display_pt"])
        with fitz.open(args.pdf_dir / f"{args.target_file_id}_raw.pdf") as target_pdf:
            vector_panels = {
                page: red_panel_with_blue_leader_paths(target_pdf[page - 1],
                                                       source_width, source_height)
                for page in args.target_pages
            }
        for candidate in unique:
            box = candidate["bbox_display_pt"]
            candidate["vector_context"] = "GEOMETRIC_SUPPORT" if any(
                candidate_overlaps_panel(box, rect)
                for rect in vector_panels[candidate["page_number"]]
            ) else "NO_GEOMETRIC_SUPPORT"
    known = [row for row in annotations
             if row["file_id"] == args.target_file_id and row["page_number"] in args.target_pages
             and row["status"] == "AI_CROSSCHECKED"]
    audits = []
    for label in known:
        rank = next((i + 1 for i, match in enumerate(unique)
                     if match["page_number"] == label["page_number"] and in_known_region(match, label)), None)
        audits.append({"annotation_id": label["annotation_id"], "class_id": label["class_id"],
                       "negative_for_class": label.get("negative_for_class"), "rank": rank,
                       "score": unique[rank - 1]["score"] if rank else None,
                       "geometric_support": unique[rank - 1].get("vector_context") if rank else None})
    report = {
        "schema_version": "drawing-template-public-probe-v1", "status": "EXPLORATORY_ONLY",
        "template_id": args.source_id, "template_source_sha256": source_tile["source_sha256"],
        "template_tile_sha256": source_tile["master_sha256"], "target_file_id": args.target_file_id,
        "target_pdf_sha256": target_file["sha256"], "target_pages": args.target_pages,
        "input_hashes": {"script": sha256(Path(__file__)), "manifest": sha256(args.manifest),
                         "tile_index": sha256(args.tile_base / "tiles.jsonl"),
                         "annotations": sha256(args.annotations) if args.annotations else None,
                         "tile_map": sha256(args.tile_map) if args.tile_map else None,
                         "template_library": sha256(args.template_library) if args.template_library else None},
        "dependencies": {"opencv": cv2.__version__, "numpy": np.__version__,
                         "pymupdf": fitz.VersionBind if args.vector_context else None},
        "margin_px": args.margin, "signal": args.signal, "threshold": args.threshold, "scales": args.scales,
        "tiles_checked": len(tiles), "elapsed_seconds": round(time.monotonic() - started, 3),
        "candidate_count": len(unique), "geometric_support_count": sum(
            candidate.get("vector_context") == "GEOMETRIC_SUPPORT" for candidate in unique),
        "known_region_audit": audits, "candidates": unique,
        "limitations": "Annotations are incomplete and from one object; rank is not precision or recall.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("template_id", "target_file_id", "target_pages", "margin_px", "tiles_checked", "elapsed_seconds", "candidate_count", "geometric_support_count", "known_region_audit")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
