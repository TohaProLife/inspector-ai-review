#!/usr/bin/env python3
"""Map reviewed TRAIN_PUBLIC proposal coordinates to one valid drawing tile.

This is a geometry map, not a training export. AI_PROPOSED stays AI_PROPOSED;
neither unmatched proposals nor otherwise empty UNLABELED tiles become negatives.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile


SCHEMA_VERSION = "1.0"
EPS = 1e-7
DEFAULT_MANIFEST = (
    Path(__file__).resolve().parents[1]
    / "datasets/reference_methodology/hackathon_gold_20260811"
    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
)


class MappingError(ValueError):
    """Source or tile metadata is invalid for safe coordinate mapping."""


def read_jsonl(path: Path):
    if not path.is_file():
        raise MappingError(f"input missing: {path}")
    with path.open(encoding="utf-8") as source:
        for number, line in enumerate(source, 1):
            if not line.strip():
                raise MappingError(f"blank JSONL row: {path}:{number}")
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise MappingError(f"invalid JSONL row: {path}:{number}") from exc
            if not isinstance(row, dict):
                raise MappingError(f"JSONL row is not an object: {path}:{number}")
            yield row


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def numeric(values: object, count: int) -> bool:
    return (isinstance(values, list) and len(values) == count
            and all(isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) for value in values))


def affine(matrix: list[float], point: tuple[float, float]) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    x, y = point
    return a * x + c * y + e, b * x + d * y + f


def transform_box(matrix: list[float], box: list[float]) -> list[float]:
    x0, y0, x1, y1 = box
    points = [affine(matrix, point) for point in
              ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return [min(point[0] for point in points), min(point[1] for point in points),
            max(point[0] for point in points), max(point[1] for point in points)]


def load_manifest(path: Path) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for entry in read_jsonl(path):
        if entry.get("split") != "TRAIN_PUBLIC":
            continue
        file_id = entry.get("file_id")
        if not isinstance(file_id, str) or file_id in result:
            raise MappingError(f"invalid/duplicate manifest file_id: {file_id}")
        result[file_id] = entry
    return result


def verify_source(row: dict, manifest: dict[str, dict], role: str) -> None:
    file_id = row.get("file_id")
    source = manifest.get(file_id)
    if not source or source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
        raise MappingError(f"{role} is not from included TRAIN_PUBLIC: {file_id}")
    if source.get("label_visibility") != "PUBLIC_TRAIN":
        raise MappingError(f"{role} has non-public label visibility: {file_id}")
    if row.get("source_sha256") != source.get("sha256") or row.get("object_id") != source.get("object_id"):
        raise MappingError(f"{role} source SHA/object mismatch: {file_id}")
    stage = row.get("stage") if role == "tile" else row.get("document_stage")
    if stage != source.get("stage"):
        raise MappingError(f"{role} document stage mismatch: {file_id}")
    page = row.get("page_number")
    if (not isinstance(page, int) or isinstance(page, bool)
            or page < 1 or page > source.get("pdf_pages", 0)):
        raise MappingError(f"{role} page out of manifest range: {file_id}:{page}")


def tile_geometry(tile: dict) -> tuple[list[float], list[float], list[float], list[float]]:
    if not isinstance(tile.get("tile_id"), str) or not tile["tile_id"]:
        raise MappingError("tile_id missing")
    if tile.get("label_status") != "UNLABELED":
        raise MappingError(f"prepared tile is not UNLABELED: {tile['tile_id']}")
    for path_key, hash_key in (("master_png", "master_sha256"),
                               ("model_png", "model_sha256")):
        relative = tile.get(path_key)
        if (not isinstance(relative, str) or not relative
                or Path(relative).is_absolute() or ".." in Path(relative).parts
                or not re.fullmatch(r"[0-9a-f]{64}", str(tile.get(hash_key, "")))):
            raise MappingError(f"tile image provenance missing/unsafe: {tile['tile_id']}")
    geom, render, page, transforms = (tile.get(key) for key in
                                      ("tile", "render", "page_geometry", "transforms"))
    if not all(isinstance(value, dict) for value in (geom, render, page, transforms)):
        raise MappingError(f"tile geometry missing: {tile['tile_id']}")
    valid = geom.get("valid_rect_px")
    rect = page.get("rect_pt")
    to_master = transforms.get("display_pt_to_master_px")
    to_model = transforms.get("master_px_to_model_px")
    if (geom.get("size_px") != 1024 or tile.get("model_size_px") != 640
            or render.get("dpi") != 200
            or not numeric(valid, 4) or not numeric(rect, 4)
            or not numeric(to_master, 6) or not numeric(to_model, 6)):
        raise MappingError(f"tile protocol/affine mismatch: {tile['tile_id']}")
    if not (0 <= valid[0] < valid[2] <= 1024 and 0 <= valid[1] < valid[3] <= 1024
            and rect[0] < rect[2] and rect[1] < rect[3]
            and to_master[0] > 0 and to_master[3] > 0
            and abs(to_master[1]) < EPS and abs(to_master[2]) < EPS
            and abs(to_model[0] - 0.625) < EPS and abs(to_model[3] - 0.625) < EPS
            and all(abs(to_model[index]) < EPS for index in (1, 2, 4, 5))):
        raise MappingError(f"tile rect/affine invalid: {tile['tile_id']}")
    return valid, rect, to_master, to_model


def map_proposals(manifest_path: Path, tiles_path: Path, label_paths: list[Path]) -> list[dict]:
    if not label_paths:
        raise MappingError("at least one --labels-jsonl is required")
    manifest = load_manifest(manifest_path)
    tiles_jsonl_sha256 = sha256_file(tiles_path)
    by_page: dict[tuple[str, int, str], list[dict]] = defaultdict(list)
    seen_tiles: set[str] = set()
    for tile in read_jsonl(tiles_path):
        verify_source(tile, manifest, "tile")
        tile_geometry(tile)
        if tile["tile_id"] in seen_tiles:
            raise MappingError(f"duplicate tile_id: {tile['tile_id']}")
        seen_tiles.add(tile["tile_id"])
        key = (tile["file_id"], tile["page_number"], tile["source_sha256"])
        by_page[key].append(tile)
    if not seen_tiles:
        raise MappingError("tiles.jsonl has no tiles")

    mapped: list[dict] = []
    seen_ids: set[str] = set()
    for path in label_paths:
        for label in read_jsonl(path):
            verify_source(label, manifest, "proposal")
            annotation_id = label.get("annotation_id")
            if not isinstance(annotation_id, str) or not annotation_id or annotation_id in seen_ids:
                raise MappingError(f"missing/duplicate annotation_id: {annotation_id}")
            seen_ids.add(annotation_id)
            kind, status = label.get("kind"), label.get("status")
            if kind not in ("POSITIVE_CANDIDATE", "HARD_NEGATIVE_CANDIDATE"):
                raise MappingError(f"unknown proposal kind: {annotation_id}")
            if status not in ("AI_PROPOSED", "AI_CROSSCHECKED", "HUMAN_APPROVED"):
                raise MappingError(f"unknown proposal status: {annotation_id}")
            if ((kind == "POSITIVE_CANDIDATE" and label.get("class_id") not in
                 ("HEATING_LOOP", "RADIATOR", "VENT_UNIT"))
                    or (kind == "HARD_NEGATIVE_CANDIDATE" and label.get("class_id") is not None)):
                raise MappingError(f"invalid kind/class pair: {annotation_id}")
            box = label.get("bbox_display_pt")
            size = label.get("page_display_size_pt")
            if (not numeric(box, 4) or not numeric(size, 2)
                    or not (size[0] > 0 and size[1] > 0
                            and 0 <= box[0] < box[2] <= size[0]
                            and 0 <= box[1] < box[3] <= size[1])):
                raise MappingError(f"proposal bbox invalid: {annotation_id}")
            key = (label["file_id"], label["page_number"], label["source_sha256"])
            page_tiles = by_page.get(key)
            if not page_tiles:
                raise MappingError(f"no prepared tiles for proposal page: {annotation_id}")
            candidates: list[tuple[float, str, dict, list[float], list[float]]] = []
            for tile in page_tiles:
                valid, page_rect, to_master, to_model = tile_geometry(tile)
                if (abs(page_rect[2] - page_rect[0] - size[0]) > 0.01
                        or abs(page_rect[3] - page_rect[1] - size[1]) > 0.01):
                    raise MappingError(f"proposal/page display dimensions mismatch: {annotation_id}")
                master_box = transform_box(to_master, box)
                margin = min(master_box[0] - valid[0], master_box[1] - valid[1],
                             valid[2] - master_box[2], valid[3] - master_box[3])
                if margin >= -EPS:
                    candidates.append((max(0.0, margin), tile["tile_id"], tile,
                                       master_box, transform_box(to_model, master_box)))
            result = {
                "schema_version": SCHEMA_VERSION,
                "annotation_id": annotation_id,
                "kind": kind,
                "class_id": label.get("class_id"),
                "status": status,
                "file_id": label["file_id"],
                "object_id": label["object_id"],
                "document_stage": label["document_stage"],
                "page_number": label["page_number"],
                "source_sha256": label["source_sha256"],
                "tiles_jsonl_sha256": tiles_jsonl_sha256,
                "tile_images_base_dir": str(tiles_path.resolve().parent),
                "bbox_display_pt": box,
                "page_display_size_pt": size,
                "selection_rule": "MAX_MIN_VALID_MARGIN_THEN_TILE_ID",
                "training_label_created": False,
                "tile_id": None,
                "tile_label_status": None,
                "master_png": None,
                "master_sha256": None,
                "model_png": None,
                "model_sha256": None,
                "bbox_master_px": None,
                "bbox_model_px": None,
                "valid_rect_master_px": None,
                "min_valid_margin_master_px": None,
                "needs_object_centered_tile": not candidates,
            }
            if candidates:
                # Round only the ranking score to remove sub-pixel float noise;
                # retain full-precision output coordinates and margin.
                margin, _, tile, master_box, model_box = sorted(
                    candidates, key=lambda item: (-round(item[0], 6), item[1])
                )[0]
                result.update({
                    "tile_id": tile["tile_id"],
                    "tile_label_status": "UNLABELED",
                    "master_png": tile.get("master_png"),
                    "master_sha256": tile.get("master_sha256"),
                    "model_png": tile.get("model_png"),
                    "model_sha256": tile.get("model_sha256"),
                    "bbox_master_px": master_box,
                    "bbox_model_px": model_box,
                    "valid_rect_master_px": tile["tile"]["valid_rect_px"],
                    "min_valid_margin_master_px": margin,
                })
            mapped.append(result)
    if not mapped:
        raise MappingError("proposal JSONL files contain no labels")
    return sorted(mapped, key=lambda row: row["annotation_id"])


def write_jsonl(path: Path, rows: list[dict], inputs: list[Path]) -> None:
    path = path.expanduser().resolve()
    if path in {item.expanduser().resolve() for item in inputs}:
        raise MappingError("output cannot overwrite any input")
    serialized = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
    if path.exists():
        if not path.is_file():
            raise MappingError(f"output is not a file: {path}")
        if path.read_text(encoding="utf-8") == serialized:
            return
        raise MappingError(f"output differs; choose a new path: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.tmp-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-jsonl", type=Path, required=True)
    parser.add_argument("--labels-jsonl", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        rows = map_proposals(args.manifest, args.tiles_jsonl, args.labels_jsonl)
        write_jsonl(args.output, rows, [args.manifest, args.tiles_jsonl, *args.labels_jsonl])
    except (MappingError, OSError) as exc:
        parser.error(str(exc))
    missing = sum(row["needs_object_centered_tile"] for row in rows)
    print(f"{len(rows)} proposals mapped; {missing} need object-centered tile; no training labels written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
