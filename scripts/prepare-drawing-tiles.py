#!/usr/bin/env python3
"""Render explicitly selected TRAIN_PUBLIC PDF pages into unlabeled drawing tiles.

All PDF sources are checked against the participant document manifest before any
PDF is opened. Coordinates in tiles.jsonl refer to the visible, rotated page
(``page.rect``), with the origin at its top left. No labels are inferred.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

import fitz
from PIL import Image


SCHEMA_VERSION = "1.0"
FILE_ID_RE = re.compile(r"F\d{4,}")


class PreparationError(ValueError):
    """Input or an existing output does not satisfy the dataset contract."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def as_list(rect: fitz.Rect | fitz.IRect) -> list[float] | list[int]:
    return [rect.x0, rect.y0, rect.x1, rect.y1]


def matrix_list(matrix: fitz.Matrix) -> list[float]:
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]


def parse_source(raw: str) -> tuple[str, Path]:
    file_id, separator, path = raw.partition("=")
    if not separator or not FILE_ID_RE.fullmatch(file_id) or not path:
        raise PreparationError(f"invalid --source, expected F0001=/path/to/original.pdf: {raw}")
    return file_id, Path(path).expanduser().resolve()


def parse_page(raw: str) -> tuple[str, int]:
    file_id, separator, number = raw.partition(":")
    if not separator or not FILE_ID_RE.fullmatch(file_id) or not number.isdecimal() or int(number) < 1:
        raise PreparationError(f"invalid --page, expected F0001:1: {raw}")
    return file_id, int(number)


def load_selected_manifest(manifest: Path, file_ids: set[str]) -> dict[str, dict]:
    if not manifest.is_file():
        raise PreparationError(f"manifest does not exist: {manifest}")
    selected: dict[str, dict] = {}
    with manifest.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                raise PreparationError(f"invalid manifest JSON at line {line_number}") from exc
            file_id = entry.get("file_id")
            if file_id not in file_ids:
                continue
            if file_id in selected:
                raise PreparationError(f"duplicate manifest file_id: {file_id}")
            if (entry.get("split") != "TRAIN_PUBLIC"
                    or entry.get("distribution_status") != "INCLUDE"
                    or entry.get("label_visibility") != "PUBLIC_TRAIN"
                    or entry.get("extension", "").lower() != ".pdf"):
                raise PreparationError(f"source is not included TRAIN_PUBLIC PDF: {file_id}")
            if (not isinstance(entry.get("size_bytes"), int) or entry["size_bytes"] < 1
                    or not isinstance(entry.get("pdf_pages"), int) or entry["pdf_pages"] < 1
                    or not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", "")))
                    or not entry.get("object_id") or not entry.get("stage")):
                raise PreparationError(f"invalid manifest source metadata: {file_id}")
            selected[file_id] = entry
    missing = file_ids - selected.keys()
    if missing:
        raise PreparationError(f"file_id missing from manifest: {', '.join(sorted(missing))}")
    return selected


def tile_starts(length: int, size: int, stride: int) -> list[int]:
    if length < 1:
        raise PreparationError("rendered page has zero raster extent")
    starts = [0]
    while starts[-1] + size < length:
        starts.append(starts[-1] + stride)
    return starts


def page_geometry(page: fitz.Page) -> dict:
    return {
        "rect_pt": as_list(page.rect),
        "display_size_pt": [page.rect.width, page.rect.height],
        "cropbox_pt": as_list(page.cropbox),
        "mediabox_pt": as_list(page.mediabox),
        "rotation_degrees": page.rotation,
        "transformation_matrix": matrix_list(page.transformation_matrix),
        "rotation_matrix": matrix_list(page.rotation_matrix),
        "derotation_matrix": matrix_list(page.derotation_matrix),
    }


def render_page(
    page: fitz.Page,
    entry: dict,
    page_number: int,
    output: Path,
    dpi: int,
    tile_size: int,
    overlap: int,
    model_size: int,
) -> list[dict]:
    scale = dpi / 72.0
    matrix = fitz.Matrix(scale, scale)
    # Same integer bounding rectangle used by PyMuPDF for an unclipped page.
    raster_irect = (page.rect * matrix).irect
    width, height = raster_irect.width, raster_irect.height
    stride = tile_size - overlap
    geometry = page_geometry(page)
    records: list[dict] = []
    (output / "master").mkdir(parents=True, exist_ok=True)
    (output / f"model{model_size}").mkdir(parents=True, exist_ok=True)

    for y in tile_starts(height, tile_size, stride):
        for x in tile_starts(width, tile_size, stride):
            valid_width = min(tile_size, width - x)
            valid_height = min(tile_size, height - y)
            absolute_x = raster_irect.x0 + x
            absolute_y = raster_irect.y0 + y
            clip = fitz.Rect(
                absolute_x / scale,
                absolute_y / scale,
                (absolute_x + valid_width) / scale,
                (absolute_y + valid_height) / scale,
            )
            pixmap = page.get_pixmap(matrix=matrix, clip=clip, colorspace=fitz.csRGB, alpha=False)
            if pixmap.n != 3:
                raise PreparationError("PyMuPDF did not render RGB pixels")
            # White padding is explicit; the valid rect never includes it.
            master = Image.new("RGB", (tile_size, tile_size), (255, 255, 255))
            rendered = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
            paste_x = pixmap.x - absolute_x
            paste_y = pixmap.y - absolute_y
            if (paste_x != 0 or paste_y != 0
                    or pixmap.width != valid_width or pixmap.height != valid_height):
                raise PreparationError(
                    f"unexpected PDF clip geometry for {entry['file_id']}:{page_number} "
                    f"tile ({x},{y}): {pixmap.irect}"
                )
            master.paste(rendered, (paste_x, paste_y))
            model = master.resize((model_size, model_size), Image.Resampling.LANCZOS)
            tile_id = f"{entry['file_id']}-p{page_number:05d}-x{x:06d}-y{y:06d}"
            master_rel = f"master/{tile_id}.png"
            model_rel = f"model{model_size}/{tile_id}.png"
            master_path = output / master_rel
            model_path = output / model_rel
            master.save(master_path, format="PNG")
            model.save(model_path, format="PNG")
            # Label coordinates start at (0, 0) of the visible page, even if
            # PyMuPDF ever exposes a page.rect with a nonzero origin.
            display_to_master = [scale, 0.0, 0.0, scale,
                                 page.rect.x0 * scale - absolute_x,
                                 page.rect.y0 * scale - absolute_y]
            master_to_display = [1 / scale, 0.0, 0.0, 1 / scale,
                                 absolute_x / scale - page.rect.x0,
                                 absolute_y / scale - page.rect.y0]
            master_to_model_scale = model_size / tile_size
            records.append({
                "schema_version": SCHEMA_VERSION,
                "tile_id": tile_id,
                "file_id": entry["file_id"],
                "object_id": entry["object_id"],
                "stage": entry["stage"],
                "page_number": page_number,
                "source_sha256": entry["sha256"],
                "label_status": "UNLABELED",
                "page_geometry": geometry,
                "render": {
                    "dpi": dpi,
                    "scale": scale,
                    "raster_width_px": width,
                    "raster_height_px": height,
                    "raster_irect_px": as_list(raster_irect),
                },
                "tile": {
                    "origin_px": [x, y],
                    "valid_rect_px": [0, 0, valid_width, valid_height],
                    "size_px": tile_size,
                    "overlap_px": overlap,
                    "stride_px": stride,
                },
                "model_size_px": model_size,
                "transforms": {
                    "display_pt_to_master_px": display_to_master,
                    "master_px_to_display_pt": master_to_display,
                    "master_px_to_model_px": [master_to_model_scale, 0, 0, master_to_model_scale, 0, 0],
                    "model_px_to_master_px": [1 / master_to_model_scale, 0, 0,
                                              1 / master_to_model_scale, 0, 0],
                },
                "master_png": master_rel,
                "master_sha256": sha256_file(master_path),
                "model_png": model_rel,
                "model_sha256": sha256_file(model_path),
            })
    return records


def verify_existing(output: Path, signature: str) -> int:
    run_path = output / "run.json"
    tiles_path = output / "tiles.jsonl"
    if not run_path.is_file() or not tiles_path.is_file():
        raise PreparationError(f"output already exists but is incomplete; choose a new directory: {output}")
    try:
        run = json.loads(run_path.read_text(encoding="utf-8"))
        if run["input_signature"] != signature:
            raise PreparationError(f"output inputs/parameters differ; choose a new directory: {output}")
        if sha256_file(tiles_path) != run["tiles_jsonl_sha256"]:
            raise PreparationError(f"existing tiles.jsonl changed: {output}")
        records = [json.loads(line) for line in tiles_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if len(records) != run["tile_count"]:
            raise PreparationError(f"existing tile count changed: {output}")
        expected = {Path("run.json"), Path("tiles.jsonl")}
        for record in records:
            for path_key, hash_key in (("master_png", "master_sha256"), ("model_png", "model_sha256")):
                rel = Path(record[path_key])
                if rel.is_absolute() or ".." in rel.parts:
                    raise PreparationError(f"unsafe existing tile path: {rel}")
                expected.add(rel)
                if not (output / rel).is_file() or sha256_file(output / rel) != record[hash_key]:
                    raise PreparationError(f"existing tile missing or changed: {rel}")
        actual = {path.relative_to(output) for path in output.rglob("*") if path.is_file()}
        if actual != expected:
            raise PreparationError(f"unexpected files in existing output: {output}")
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise PreparationError(f"invalid existing output metadata: {output}") from exc
    return len(records)


def prepare(
    manifest: Path,
    source_args: list[str],
    page_args: list[str],
    output: Path,
    dpi: int = 200,
    tile_size: int = 1024,
    overlap: int = 128,
    model_size: int = 640,
) -> int:
    if dpi < 1 or tile_size < 1 or not 0 <= overlap < tile_size or model_size < 1:
        raise PreparationError("dpi/tile-size/model-size must be positive; overlap must be below tile-size")
    if not source_args or not page_args:
        raise PreparationError("at least one --source and one --page are required")
    sources: dict[str, Path] = {}
    for raw in source_args:
        file_id, path = parse_source(raw)
        if file_id in sources:
            raise PreparationError(f"duplicate --source: {file_id}")
        sources[file_id] = path
    pages = [parse_page(raw) for raw in page_args]
    if len(pages) != len(set(pages)):
        raise PreparationError("duplicate --page")
    file_ids = {file_id for file_id, _ in pages}
    if set(sources) != file_ids:
        raise PreparationError("--source file IDs must match selected --page file IDs exactly")
    selected = load_selected_manifest(manifest, file_ids)
    for file_id, page_number in pages:
        if page_number > selected[file_id]["pdf_pages"]:
            raise PreparationError(f"page outside manifest range: {file_id}:{page_number}")
    for file_id, path in sources.items():
        entry = selected[file_id]
        if (not path.is_file() or path.stat().st_size != entry["size_bytes"]
                or sha256_file(path) != entry["sha256"]):
            raise PreparationError(f"source size/SHA-256 mismatch: {file_id}")
    pages.sort()
    input_description = {
        "schema_version": SCHEMA_VERSION,
        "manifest_sha256": sha256_file(manifest),
        "sources": [{"file_id": file_id, "sha256": selected[file_id]["sha256"],
                     "size_bytes": selected[file_id]["size_bytes"],
                     "pdf_pages": selected[file_id]["pdf_pages"]}
                    for file_id in sorted(file_ids)],
        "pages": [{"file_id": file_id, "page_number": number} for file_id, number in pages],
        "dpi": dpi,
        "tile_size": tile_size,
        "overlap": overlap,
        "model_size": model_size,
        "pymupdf_version": fitz.VersionBind,
        "pillow_version": Image.__version__,
    }
    canonical = json.dumps(input_description, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    signature = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    output = output.expanduser().resolve()
    if output.exists():
        if not output.is_dir():
            raise PreparationError(f"output is not a directory: {output}")
        if any(output.iterdir()):
            return verify_existing(output, signature)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent))
    try:
        records: list[dict] = []
        for file_id in sorted(file_ids):
            entry = selected[file_id]
            with fitz.open(sources[file_id]) as document:
                if document.needs_pass or len(document) != entry["pdf_pages"]:
                    raise PreparationError(f"PDF encryption/page count mismatch: {file_id}")
                for selected_id, page_number in pages:
                    if selected_id == file_id:
                        records.extend(render_page(document[page_number - 1], entry, page_number,
                                                   temporary, dpi, tile_size, overlap, model_size))
        tiles_path = temporary / "tiles.jsonl"
        with tiles_path.open("w", encoding="utf-8") as target:
            for record in records:
                target.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        (temporary / "run.json").write_text(
            json.dumps({"input_signature": signature, "inputs": input_description,
                        "tile_count": len(records), "tiles_jsonl_sha256": sha256_file(tiles_path)},
                       ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8"
        )
        if output.exists():
            if any(output.iterdir()):
                raise PreparationError(f"output changed during preparation: {output}")
            output.rmdir()
        os.replace(temporary, output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return len(records)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source", action="append", required=True, metavar="FID=PDF")
    parser.add_argument("--page", action="append", required=True, metavar="FID:N")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--tile-size", type=int, default=1024)
    parser.add_argument("--overlap", type=int, default=128)
    parser.add_argument("--model-size", type=int, default=640)
    args = parser.parse_args(argv)
    try:
        count = prepare(args.manifest, args.source, args.page, args.output_dir,
                        args.dpi, args.tile_size, args.overlap, args.model_size)
    except (PreparationError, OSError, fitz.FileDataError) as exc:
        parser.error(str(exc))
    print(f"{count} UNLABELED tiles: {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
