#!/usr/bin/env python3
"""Fail-closed structural gate for proposed TRAIN_PUBLIC drawing-symbol labels.

This command validates metadata and image geometry; it never creates training data
or promotes an AI proposal to HUMAN_APPROVED. Visual and human review remain separate.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any


REQUIRED = frozenset({
    "annotation_id", "kind", "file_id", "page_number", "source_sha256",
    "object_id", "document_stage", "sheet_stage_if_verified", "class_id",
    "bbox_display_pt", "page_display_size_pt", "room_id", "room_relation",
    "status", "render_dpi", "evidence_image_path", "notes",
})
KINDS = {"POSITIVE_CANDIDATE", "HARD_NEGATIVE_CANDIDATE"}
CLASSES = {"HEATING_LOOP", "RADIATOR", "VENT_UNIT"}
STATUSES = {"AI_PROPOSED", "AI_CROSSCHECKED", "HUMAN_APPROVED"}
RELATIONS = {"INSIDE", "NEAR", "UNKNOWN"}
STAGES = {"PD", "RD", "ID", "RD_ID_MIXED", "UNKNOWN"}
DEFAULT_MANIFEST = (
    Path(__file__).resolve().parents[1]
    / "datasets/reference_methodology/hackathon_gold_20260811"
    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
)


def issue(errors: list[dict[str, str]], location: str, code: str, message: str) -> None:
    errors.append({"location": location, "code": code, "message": message})


def read_jsonl(path: Path, errors: list[dict[str, str]], role: str):
    try:
        with path.open(encoding="utf-8") as stream:
            for line_number, raw in enumerate(stream, 1):
                if not raw.strip():
                    issue(errors, f"{path}:{line_number}", "BLANK_LINE", f"Blank {role} row")
                    continue
                try:
                    value = json.loads(raw)
                except json.JSONDecodeError as exc:
                    issue(errors, f"{path}:{line_number}", "INVALID_JSON", str(exc))
                    continue
                if not isinstance(value, dict):
                    issue(errors, f"{path}:{line_number}", "NOT_OBJECT", f"{role} row must be an object")
                    continue
                yield f"{path}:{line_number}", value
    except OSError as exc:
        issue(errors, str(path), "READ_ERROR", str(exc))


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def numeric_vector(value: Any, length: int) -> bool:
    return isinstance(value, list) and len(value) == length and all(number(item) for item in value)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_artifact(path: str, base: Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else base / candidate


def load_manifest(path: Path, errors: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    for location, row in read_jsonl(path, errors, "manifest"):
        file_id = row.get("file_id")
        if not nonempty_string(file_id):
            issue(errors, location, "MANIFEST_FILE_ID", "Missing file_id")
        elif file_id in manifest:
            issue(errors, location, "DUPLICATE_MANIFEST_FILE", f"Duplicate {file_id}")
        else:
            manifest[file_id] = row
    if not manifest:
        issue(errors, str(path), "EMPTY_MANIFEST", "No usable manifest rows")
    return manifest


def check_source(row: dict[str, Any], source: dict[str, Any] | None,
                 location: str, errors: list[dict[str, str]]) -> None:
    if source is None:
        issue(errors, location, "UNKNOWN_FILE", f"file_id {row.get('file_id')!r} absent from manifest")
        return
    if source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
        issue(errors, location, "FORBIDDEN_SOURCE", "Source is not included TRAIN_PUBLIC")
    if row.get("split", "TRAIN_PUBLIC") != "TRAIN_PUBLIC":
        issue(errors, location, "FORBIDDEN_SPLIT", "Proposal split must be TRAIN_PUBLIC")
    if row.get("distribution_status", "INCLUDE") != "INCLUDE":
        issue(errors, location, "FORBIDDEN_DISTRIBUTION", "Proposal distribution_status must be INCLUDE")
    for field, source_field in (("source_sha256", "sha256"),
                                ("object_id", "object_id"), ("document_stage", "stage")):
        if row.get(field) != source.get(source_field):
            issue(errors, location, "MANIFEST_MISMATCH", f"{field} disagrees with manifest {source_field}")
    page_number = row.get("page_number")
    page_count = source.get("pdf_pages")
    if not (isinstance(page_number, int) and not isinstance(page_number, bool)
            and isinstance(page_count, int) and 1 <= page_number <= page_count):
        issue(errors, location, "PAGE_RANGE", f"page_number must be in 1..{page_count}")


def check_box(row: dict[str, Any], location: str, errors: list[dict[str, str]]) -> bool:
    box, size = row.get("bbox_display_pt"), row.get("page_display_size_pt")
    if not numeric_vector(box, 4) or not numeric_vector(size, 2):
        issue(errors, location, "GEOMETRY_TYPE", "bbox_display_pt and page_display_size_pt need finite numbers")
        return False
    x0, y0, x1, y1 = box
    width, height = size
    if not (width > 0 and height > 0 and 0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
        issue(errors, location, "BOX_OUTSIDE_PAGE", "Positive-area display box must fit visible page")
        return False
    return True


def check_label(row: dict[str, Any], source: dict[str, Any] | None,
                location: str, base: Path, errors: list[dict[str, str]]) -> bool:
    before = len(errors)
    missing = sorted(REQUIRED - row.keys())
    if missing:
        issue(errors, location, "MISSING_FIELDS", ", ".join(missing))
    for field in ("annotation_id", "file_id", "source_sha256", "object_id", "document_stage"):
        if not nonempty_string(row.get(field)):
            issue(errors, location, "INVALID_FIELD", f"{field} must be a nonempty string")
    check_source(row, source, location, errors)
    kind, class_id, status = row.get("kind"), row.get("class_id"), row.get("status")
    if not isinstance(kind, str) or kind not in KINDS:
        issue(errors, location, "INVALID_KIND", f"kind must be one of {sorted(KINDS)}")
    if not isinstance(status, str) or status not in STATUSES:
        issue(errors, location, "INVALID_STATUS", f"status must be one of {sorted(STATUSES)}")
    if kind == "POSITIVE_CANDIDATE" and (not isinstance(class_id, str) or class_id not in CLASSES):
        issue(errors, location, "INVALID_CLASS", f"Positive class_id must be one of {sorted(CLASSES)}")
    if kind == "HARD_NEGATIVE_CANDIDATE" and class_id is not None:
        issue(errors, location, "NEGATIVE_CLASS", "Hard-negative region must have class_id=null")
    relation = row.get("room_relation")
    if not isinstance(relation, str) or relation not in RELATIONS:
        issue(errors, location, "INVALID_ROOM_RELATION", f"room_relation must be one of {sorted(RELATIONS)}")
    room_id = row.get("room_id")
    if room_id is not None and not nonempty_string(room_id):
        issue(errors, location, "INVALID_ROOM", "room_id must be null or nonempty string")
    if relation == "UNKNOWN" and room_id is not None:
        issue(errors, location, "UNVERIFIED_ROOM", "UNKNOWN room relation requires room_id=null")
    if isinstance(relation, str) and relation in {"INSIDE", "NEAR"} and not nonempty_string(room_id):
        issue(errors, location, "MISSING_ROOM", "INSIDE/NEAR needs a verified room_id")
    sheet_stage = row.get("sheet_stage_if_verified")
    document_stage = row.get("document_stage")
    if sheet_stage is not None and (not isinstance(sheet_stage, str) or sheet_stage not in {"PD", "RD", "ID"}):
        issue(errors, location, "INVALID_SHEET_STAGE", "sheet_stage_if_verified must be PD/RD/ID/null")
    if isinstance(document_stage, str) and document_stage in {"PD", "RD", "ID"} and sheet_stage not in (None, document_stage):
        issue(errors, location, "SHEET_STAGE_MISMATCH", "Sheet stage contradicts manifest stage")
    if not isinstance(document_stage, str) or document_stage not in STAGES:
        issue(errors, location, "INVALID_DOCUMENT_STAGE", "document_stage unknown")
    if not number(row.get("render_dpi")) or row["render_dpi"] != 200:
        issue(errors, location, "RENDER_DPI", "Protocol requires render_dpi=200")
    if not isinstance(row.get("notes"), str):
        issue(errors, location, "INVALID_NOTES", "notes must be string (may be empty)")
    check_box(row, location, errors)
    evidence = row.get("evidence_image_path")
    if not nonempty_string(evidence):
        issue(errors, location, "MISSING_EVIDENCE", "evidence_image_path required")
    else:
        path = resolve_artifact(evidence, base)
        if not path.is_file():
            issue(errors, location, "EVIDENCE_NOT_FOUND", f"Evidence image absent: {path}")
    return len(errors) == before


def apply_affine(point: tuple[float, float], matrix: list[float]) -> tuple[float, float]:
    x, y = point
    a, b, c, d, e, f = matrix
    return a * x + c * y + e, b * x + d * y + f


def tile_valid_rect(tile: dict[str, Any]) -> tuple[float, float, float, float] | None:
    geometry = tile.get("tile")
    if not isinstance(geometry, dict):
        return None
    origin, valid = geometry.get("origin_px"), geometry.get("valid_rect_px")
    size_px = geometry.get("size_px")
    if not numeric_vector(origin, 2) or not numeric_vector(valid, 4) or not number(size_px):
        return None
    x, y = origin
    x0, y0, x1, y1 = valid
    if not (size_px == 1024 and x >= 0 and y >= 0
            and 0 <= x0 < x1 <= size_px and 0 <= y0 < y1 <= size_px):
        return None
    # This rectangle is in tile-local master pixels. origin_px locates the tile
    # on the page raster; the affine transform already includes that offset.
    return x0, y0, x1, y1


def check_tile_artifacts(tile: dict[str, Any], location: str, base: Path,
                         errors: list[dict[str, str]], sha_cache: dict[Path, str]) -> None:
    for path_key, sha_key in (("master_png", "master_sha256"), ("model_png", "model_sha256")):
        file_name, expected = tile.get(path_key), tile.get(sha_key)
        if not nonempty_string(file_name) or not nonempty_string(expected):
            issue(errors, location, "TILE_ARTIFACT_FIELD", f"{path_key}/{sha_key} missing")
            continue
        path = resolve_artifact(file_name, base)
        if not path.is_file():
            issue(errors, location, "TILE_ARTIFACT_NOT_FOUND", f"{path_key}: {path}")
            continue
        try:
            if path not in sha_cache:
                sha_cache[path] = sha256_file(path)
            actual = sha_cache[path]
        except OSError as exc:
            issue(errors, location, "TILE_ARTIFACT_READ", str(exc))
            continue
        if expected != actual:
            issue(errors, location, "TILE_ARTIFACT_HASH", f"{sha_key} does not match {path}")


def load_tiles(path: Path, manifest: dict[str, dict[str, Any]],
               errors: list[dict[str, str]]) -> dict[tuple[str, int, str], list[dict[str, Any]]]:
    by_page: dict[tuple[str, int, str], list[dict[str, Any]]] = defaultdict(list)
    seen: set[str] = set()
    sha_cache: dict[Path, str] = {}
    for location, row in read_jsonl(path, errors, "tile"):
        before = len(errors)
        tile_id = row.get("tile_id")
        if not nonempty_string(tile_id):
            issue(errors, location, "TILE_ID", "tile_id missing")
        elif tile_id in seen:
            issue(errors, location, "DUPLICATE_TILE_ID", f"Duplicate {tile_id}")
        else:
            seen.add(tile_id)
        file_id = row.get("file_id")
        check_source({"file_id": file_id, "page_number": row.get("page_number"),
                      "source_sha256": row.get("source_sha256"), "object_id": row.get("object_id"),
                      "document_stage": row.get("stage")}, manifest.get(file_id) if isinstance(file_id, str) else None,
                     location, errors)
        transforms = row.get("transforms")
        matrix = transforms.get("display_pt_to_master_px") if isinstance(transforms, dict) else None
        inverse = transforms.get("master_px_to_display_pt") if isinstance(transforms, dict) else None
        if not numeric_vector(matrix, 6):
            issue(errors, location, "TILE_TRANSFORM", "display_pt_to_master_px needs six finite numbers")
        elif not (matrix[0] > 0 and matrix[3] > 0
                  and abs(matrix[1]) < 1e-8 and abs(matrix[2]) < 1e-8):
            issue(errors, location, "TILE_TRANSFORM", "Tile display transform must be axis-aligned with positive scale")
        if not numeric_vector(inverse, 6):
            issue(errors, location, "TILE_INVERSE", "master_px_to_display_pt needs six finite numbers")
        if numeric_vector(matrix, 6) and numeric_vector(inverse, 6):
            for sample in ((0.0, 0.0), (100.0, 0.0), (0.0, 100.0), (100.0, 100.0)):
                restored = apply_affine(apply_affine(sample, matrix), inverse)
                if max(abs(restored[0] - sample[0]), abs(restored[1] - sample[1])) > 0.01:
                    issue(errors, location, "TILE_NONINVERTIBLE", "Coordinate roundtrip exceeds 0.01 pt")
                    break
        rect = tile_valid_rect(row)
        if rect is None:
            issue(errors, location, "TILE_VALID_RECT", "Invalid origin_px/valid_rect_px")
        geometry = row.get("page_geometry")
        page_rect = geometry.get("rect_pt") if isinstance(geometry, dict) else None
        if not numeric_vector(page_rect, 4) or not page_rect[0] < page_rect[2] or not page_rect[1] < page_rect[3]:
            issue(errors, location, "TILE_PAGE_RECT", "Invalid page_geometry.rect_pt")
        render = row.get("render")
        if not isinstance(render, dict) or render.get("dpi") != 200:
            issue(errors, location, "TILE_RENDER_DPI", "Tile render.dpi must be 200")
        if row.get("label_status") != "UNLABELED":
            issue(errors, location, "TILE_LABEL_STATUS", "Preparation tiles must remain UNLABELED")
        check_tile_artifacts(row, location, path.parent, errors, sha_cache)
        if len(errors) == before:
            key = (row["file_id"], row["page_number"], row["source_sha256"])
            prior = by_page[key]
            if prior:
                old = prior[0]
                old_rect = old["page_geometry"]["rect_pt"]
                old_matrix = old["transforms"]["display_pt_to_master_px"]
                if (any(abs(a - b) > 0.01 for a, b in zip(old_rect, page_rect))
                        or any(abs(a - b) > 0.01 for a, b in zip(old_matrix[:4], matrix[:4]))):
                    issue(errors, location, "TILE_PAGE_INCONSISTENT",
                          "Tiles of same source page disagree on display geometry/scale")
                    continue
            prior.append(row)
    if not by_page:
        issue(errors, str(path), "NO_USABLE_TILES", "No valid tiles")
    return by_page


def label_covered(row: dict[str, Any], tiles: list[dict[str, Any]]) -> bool:
    """Check union of valid tile rectangles in page-display points covers bbox."""
    box = row.get("bbox_display_pt")
    size = row.get("page_display_size_pt")
    if not numeric_vector(box, 4) or not numeric_vector(size, 2):
        return False
    x0, y0, x1, y1 = box
    intersections: list[tuple[float, float, float, float]] = []
    for tile in tiles:
        page_rect = tile["page_geometry"]["rect_pt"]
        if abs(page_rect[2] - page_rect[0] - size[0]) > 0.01 or abs(page_rect[3] - page_rect[1] - size[1]) > 0.01:
            continue
        inverse = tile["transforms"]["master_px_to_display_pt"]
        valid = tile_valid_rect(tile)
        assert valid is not None
        tx0, ty0, tx1, ty1 = valid
        # Tile affine maps page-display points to tile-local pixels, not page
        # raster pixels. Map only valid local pixels back to display points.
        corners = [apply_affine(point, inverse) for point in
                   ((tx0, ty0), (tx1, ty0), (tx0, ty1), (tx1, ty1))]
        dx0, dx1 = min(p[0] for p in corners), max(p[0] for p in corners)
        dy0, dy1 = min(p[1] for p in corners), max(p[1] for p in corners)
        if x0 >= dx0 - 0.01 and y0 >= dy0 - 0.01 and x1 <= dx1 + 0.01 and y1 <= dy1 + 0.01:
            return True
        if dx1 > x0 and dy1 > y0 and dx0 < x1 and dy0 < y1:
            intersections.append((max(x0, dx0), max(y0, dy0), min(x1, dx1), min(y1, dy1)))
    # A large object can span tiles. Test every cell of the tile-edge partition.
    if not intersections:
        return False
    xs = sorted({x0, x1, *(x for rect in intersections for x in (rect[0], rect[2]))})
    ys = sorted({y0, y1, *(y for rect in intersections for y in (rect[1], rect[3]))})
    for left, right in zip(xs, xs[1:]):
        for top, bottom in zip(ys, ys[1:]):
            mid_x, mid_y = (left + right) / 2, (top + bottom) / 2
            if not any(rx0 <= mid_x <= rx1 and ry0 <= mid_y <= ry1
                       for rx0, ry0, rx1, ry1 in intersections):
                return False
    return True


def validate(manifest_path: Path, proposal_paths: list[Path],
             tiles_path: Path | None = None) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    manifest = load_manifest(manifest_path, errors)
    tiles = load_tiles(tiles_path, manifest, errors) if tiles_path else None
    counts: dict[str, Counter[str]] = {
        key: Counter() for key in ("class", "kind", "status", "object", "file")
    }
    seen_ids: set[str] = set()
    seen_content: set[str] = set()
    rows = 0
    structurally_valid = 0
    for proposal_path in proposal_paths:
        for location, row in read_jsonl(proposal_path, errors, "proposal"):
            rows += 1
            row_errors_before = len(errors)
            for key, field in (("class", "class_id"), ("kind", "kind"),
                               ("status", "status"), ("object", "object_id"),
                               ("file", "file_id")):
                value = row.get(field)
                counts[key][str(value) if value is not None else "null"] += 1
            annotation_id = row.get("annotation_id")
            if nonempty_string(annotation_id):
                if annotation_id in seen_ids:
                    issue(errors, location, "DUPLICATE_ID", f"Duplicate annotation_id {annotation_id}")
                seen_ids.add(annotation_id)
            fingerprint = json.dumps(
                [row.get(field) for field in ("file_id", "page_number", "source_sha256",
                                               "kind", "class_id", "bbox_display_pt")],
                ensure_ascii=False, sort_keys=True,
            )
            if fingerprint in seen_content:
                issue(errors, location, "DUPLICATE_LABEL", "Same source, kind, class and bbox repeated")
            seen_content.add(fingerprint)
            file_id = row.get("file_id")
            source = manifest.get(file_id) if isinstance(file_id, str) else None
            check_label(row, source, location, proposal_path.parent, errors)
            if len(errors) == row_errors_before:
                structurally_valid += 1
            if (tiles is not None and source is not None and check_box_silent(row)
                    and isinstance(row.get("source_sha256"), str)
                    and isinstance(row.get("page_number"), int)
                    and not isinstance(row.get("page_number"), bool)):
                key = (row.get("file_id"), row.get("page_number"), row.get("source_sha256"))
                page_tiles = tiles.get(key, [])
                if not page_tiles:
                    issue(errors, location, "NO_PAGE_TILES", "No valid tiles for source page")
                elif not label_covered(row, page_tiles):
                    issue(errors, location, "BOX_NOT_TILED", "Valid tile pixels do not cover bbox_display_pt")
    if rows == 0:
        issue(errors, ", ".join(map(str, proposal_paths)), "NO_LABELS", "No proposal rows")
    return {
        "ok": not errors,
        "proposal_rows": rows,
        "structurally_valid_rows": structurally_valid,
        "counts": {key: dict(sorted(counter.items())) for key, counter in counts.items()},
        "training_data_written": False,
        "review_gate": "AI_PROPOSED and AI_CROSSCHECKED are never training labels; HUMAN_APPROVED is a human assertion, not authenticated by this structural validator. A hard-negative region never makes an entire tile negative.",
        "errors": errors,
    }


def check_box_silent(row: dict[str, Any]) -> bool:
    box, size = row.get("bbox_display_pt"), row.get("page_display_size_pt")
    return (numeric_vector(box, 4) and numeric_vector(size, 2)
            and size[0] > 0 and size[1] > 0
            and 0 <= box[0] < box[2] <= size[0]
            and 0 <= box[1] < box[3] <= size[1])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--labels-jsonl", type=Path, action="append", required=True,
                        help="One or more proposal files; repeats allowed")
    parser.add_argument("--tiles-jsonl", type=Path, help="Optional tile geometry and PNG SHA gate")
    parser.add_argument("--report", type=Path, help="Also write JSON report to this path")
    args = parser.parse_args(argv)
    report = validate(args.manifest, args.labels_jsonl, args.tiles_jsonl)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(serialized, encoding="utf-8")
    sys.stdout.write(serialized)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
