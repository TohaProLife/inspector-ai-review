#!/usr/bin/env python3
"""Make an offline, proposal-free full-sheet annotation workspace for TRAIN_PUBLIC.

This tool cannot approve reviews. Browser exports stay UNREVIEWED, even when the
operator has drawn boxes or checked the entire sheet. Approval is a separate
authenticated human process outside this utility.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any

import fitz


FILE_ID = re.compile(r"F[0-9]{4,}\Z")
CLASS_ID = re.compile(r"[A-Z][A-Z0-9_]*\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
REVIEW_KEYS = frozenset({
    "schema_version", "file_id", "source_sha256", "object_id", "page_number",
    "class_id", "coverage", "review_status", "reviewer_id", "annotation_origin",
    "created_without_proposals", "coordinate_system", "page_display_size_pt", "instances",
})


class PreparationError(ValueError):
    """Source is ineligible, invalid, or unsafe to render as requested."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_entry(manifest: Path, file_id: str) -> dict[str, Any]:
    if not manifest.is_file():
        raise PreparationError("manifest does not exist")
    selected: list[dict[str, Any]] = []
    with manifest.open(encoding="utf-8") as source:
        for number, line in enumerate(source, 1):
            if not line.strip():
                raise PreparationError(f"blank manifest row at line {number}")
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise PreparationError(f"invalid manifest JSON at line {number}") from error
            if not isinstance(row, dict):
                raise PreparationError(f"manifest row must be an object at line {number}")
            if row.get("file_id") == file_id:
                selected.append(row)
    if len(selected) != 1:
        raise PreparationError("file_id must occur exactly once in manifest")
    entry = selected[0]
    if (entry.get("split") != "TRAIN_PUBLIC"
            or entry.get("distribution_status") != "INCLUDE"
            or entry.get("label_visibility") != "PUBLIC_TRAIN"
            or entry.get("extension", ".pdf").lower() != ".pdf"):
        raise PreparationError("only included TRAIN_PUBLIC/PUBLIC_TRAIN PDF is allowed")
    if (not isinstance(entry.get("sha256"), str)
            or not SHA256.fullmatch(entry["sha256"])
            or type(entry.get("size_bytes")) is not int or entry["size_bytes"] <= 0
            or type(entry.get("pdf_pages")) is not int or entry["pdf_pages"] <= 0
            or not isinstance(entry.get("object_id"), str) or not entry["object_id"]):
        raise PreparationError("manifest source identity is incomplete")
    return entry


def render_scale(width_pt: float, height_pt: float, dpi: int,
                 max_edge: int, max_pixels: int) -> float:
    if (not all(math.isfinite(value) and value > 0 for value in (width_pt, height_pt))
            or not 72 <= dpi <= 300 or not 512 <= max_edge <= 16384
            or not 1_000_000 <= max_pixels <= 64_000_000):
        raise PreparationError("invalid page geometry or render limits")
    scale = min(dpi / 72, max_edge / max(width_pt, height_pt),
                math.sqrt(max_pixels / (width_pt * height_pt)))
    if scale * min(width_pt, height_pt) < 128:
        raise PreparationError("page too large for bounded full-sheet render")
    return scale


def pixel_box_to_display_points(box: list[float], image_size: list[int],
                                page_size: list[float]) -> list[float]:
    if (len(box) != 4 or len(image_size) != 2 or len(page_size) != 2
            or any(not math.isfinite(v) for v in box)
            or not (0 <= box[0] < box[2] <= image_size[0]
                    and 0 <= box[1] < box[3] <= image_size[1])):
        raise PreparationError("invalid pixel rectangle")
    return [box[0] * page_size[0] / image_size[0],
            box[1] * page_size[1] / image_size[1],
            box[2] * page_size[0] / image_size[0],
            box[3] * page_size[1] / image_size[1]]


def draft_review(entry: dict[str, Any], page_number: int, class_id: str,
                 page_size: list[float]) -> dict[str, Any]:
    row = {
        "schema_version": "visual-full-sheet-review-v1",
        "file_id": entry["file_id"],
        "source_sha256": entry["sha256"],
        "object_id": entry["object_id"],
        "page_number": page_number,
        "class_id": class_id,
        "coverage": "UNREVIEWED",
        "review_status": "UNREVIEWED",
        "reviewer_id": "",
        "annotation_origin": "UNVERIFIED_DRAFT",
        "created_without_proposals": False,
        "coordinate_system": "DISPLAY_POINT_TOP_LEFT",
        "page_display_size_pt": page_size,
        "instances": [],
    }
    assert frozenset(row) == REVIEW_KEYS
    return row


def safe_json_for_html(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


HTML = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'">
<title>Независимая разметка листа</title>
<style>
body {font: 16px/1.4 system-ui, sans-serif; margin:0; color:#1d2633; background:#e6eaf0}
header {position:sticky; top:0; z-index:2; background:white; border-bottom:1px solid #b3bdc9; padding:10px 16px}
h1 {font-size:18px; margin:0 0 6px} .warn {font-weight:700; color:#8d341e}
.bar {display:flex; flex-wrap:wrap; gap:8px; align-items:center} button {padding:6px 10px}
.viewer {height:calc(100vh - 185px); min-height:380px; overflow:auto; padding:15px}
.sheet {position:relative; width:max-content; box-shadow:0 3px 15px #8290a0; background:white}
#page {display:block; user-select:none; pointer-events:none}
#overlay {position:absolute; inset:0; touch-action:none; cursor:crosshair; width:100%; height:100%}
rect {fill:#ffdf001f; stroke:#d32f2f; stroke-width:1.2; vector-effect:non-scaling-stroke}
.active {stroke:#1257ab; stroke-dasharray:5 3}
footer {padding:8px 16px; background:white; border-top:1px solid #b3bdc9}
</style></head><body>
<header><h1 id="heading"></h1>
<div class="warn">Только исходный лист. Подсказки модели отсутствуют. Экспорт всегда UNREVIEWED; пустой список не подтверждает отсутствие класса.</div>
<div class="bar"><label>Масштаб <input id="zoom" type="range" min="40" max="400" value="100"><span id="zoom-label">100%</span></label>
<button id="undo" type="button">Отменить рамку</button><button id="clear" type="button">Удалить все рамки</button>
<button id="export" type="button">Скачать черновик JSONL</button><span id="count"></span></div>
</header><main class="viewer"><div class="sheet" id="sheet"><img id="page" src="page.png" alt="Полный исходный PDF-лист без подсказок модели"><svg id="overlay" aria-label="Поле рисования рамок"></svg></div></main>
<footer>Нарисуйте рамку мышью/пальцем. Просмотрите весь лист, включая края и штамп. Для подтверждённого нуля нужен отдельный человеческий шаг после экспорта.</footer>
<script>
const base = __DRAFT_JSON__;
const meta = __META_JSON__;
const img = document.getElementById('page');
const overlay = document.getElementById('overlay');
const sheet = document.getElementById('sheet');
const zoom = document.getElementById('zoom');
const boxes = [];
let origin = null, preview = null;
document.getElementById('heading').textContent = `${base.file_id}, лист ${base.page_number}, класс ${base.class_id}`;
overlay.setAttribute('viewBox', `0 0 ${meta.page_display_size_pt[0]} ${meta.page_display_size_pt[1]}`);
overlay.setAttribute('preserveAspectRatio', 'none');
function resize() {
  const fit = Math.min(window.innerWidth - 50, 1400);
  const width = Math.max(200, fit) * Number(zoom.value) / 100;
  sheet.style.width = `${width}px`;
  img.style.width = `${width}px`;
  img.style.height = `${width * meta.page_display_size_pt[1] / meta.page_display_size_pt[0]}px`;
  document.getElementById('zoom-label').textContent = `${zoom.value}%`;
}
function point(ev) {
  const rect = overlay.getBoundingClientRect();
  return [Math.max(0, Math.min(meta.page_display_size_pt[0], (ev.clientX - rect.left) * meta.page_display_size_pt[0] / rect.width)),
          Math.max(0, Math.min(meta.page_display_size_pt[1], (ev.clientY - rect.top) * meta.page_display_size_pt[1] / rect.height))];
}
function draw() {
  overlay.replaceChildren();
  for (const [box, active] of [...boxes.map(box => [box, false]), ...(preview ? [[preview, true]] : [])]) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    node.setAttribute('x', box[0]); node.setAttribute('y', box[1]);
    node.setAttribute('width', box[2] - box[0]); node.setAttribute('height', box[3] - box[1]);
    if (active) node.setAttribute('class', 'active');
    overlay.append(node);
  }
  document.getElementById('count').textContent = `Рамок: ${boxes.length}`;
}
overlay.addEventListener('pointerdown', ev => { ev.preventDefault(); overlay.setPointerCapture(ev.pointerId); origin = point(ev); });
overlay.addEventListener('pointermove', ev => {
  if (!origin) return;
  const end = point(ev); preview = [Math.min(origin[0], end[0]), Math.min(origin[1], end[1]), Math.max(origin[0], end[0]), Math.max(origin[1], end[1])]; draw();
});
overlay.addEventListener('pointerup', ev => {
  if (!origin) return;
  const end = point(ev); const box = [Math.min(origin[0], end[0]), Math.min(origin[1], end[1]), Math.max(origin[0], end[0]), Math.max(origin[1], end[1])];
  if (box[2] - box[0] >= 0.2 && box[3] - box[1] >= 0.2) boxes.push(box.map(v => Math.round(v * 100) / 100));
  origin = null; preview = null; draw();
});
overlay.addEventListener('pointercancel', () => { origin = null; preview = null; draw(); });
zoom.addEventListener('input', resize); window.addEventListener('resize', resize);
document.getElementById('undo').addEventListener('click', () => { boxes.pop(); draw(); });
document.getElementById('clear').addEventListener('click', () => { if (confirm('Удалить все нарисованные рамки?')) { boxes.length = 0; draw(); } });
document.getElementById('export').addEventListener('click', () => {
  const row = {...base, instances: boxes.map((bbox_display_pt, i) => ({instance_id: `${base.class_id}-${String(i + 1).padStart(4, '0')}`, bbox_display_pt}))};
  const blob = new Blob([JSON.stringify(row) + '\\n'], {type: 'application/x-ndjson'});
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${base.file_id}-p${base.page_number}-${base.class_id}-draft.jsonl`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
resize(); draw();
</script></body></html>
"""


def prepare(manifest: Path, source_pdf: Path, file_id: str, page_number: int,
            class_id: str, output_dir: Path, dpi: int = 180,
            max_edge: int = 8192, max_pixels: int = 48_000_000) -> dict[str, Any]:
    if (not FILE_ID.fullmatch(file_id) or not CLASS_ID.fullmatch(class_id)
            or type(page_number) is not int or page_number < 1):
        raise PreparationError("invalid file ID, class ID or page number")
    entry = load_entry(manifest, file_id)
    if not source_pdf.is_file() or source_pdf.stat().st_size != entry["size_bytes"]:
        raise PreparationError("source PDF missing or byte size differs from manifest")
    if sha256_file(source_pdf) != entry["sha256"]:
        raise PreparationError("source PDF SHA-256 differs from manifest")
    if output_dir.exists():
        raise PreparationError("output directory already exists")
    if page_number > entry["pdf_pages"]:
        raise PreparationError("page outside manifest page count")

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    try:
        with fitz.open(source_pdf) as document:
            if not document.is_pdf or document.needs_pass or len(document) != entry["pdf_pages"]:
                raise PreparationError("PDF type, encryption or page count differs from manifest")
            page = document[page_number - 1]
            width, height = float(page.rect.width), float(page.rect.height)
            scale = render_scale(width, height, dpi, max_edge, max_pixels)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale),
                                     colorspace=fitz.csRGB, alpha=False)
            if (pixmap.n != 3 or pixmap.width > max_edge + 1 or pixmap.height > max_edge + 1
                    or pixmap.width * pixmap.height > max_pixels + max_edge):
                raise PreparationError("render exceeded requested image limits")
            pixmap.save(staging / "page.png")
            page_size = [width, height]
            image_size = [pixmap.width, pixmap.height]
            rotation = page.rotation
        draft = draft_review(entry, page_number, class_id, page_size)
        metadata = {
            "schema_version": "visual-annotation-workspace-v1",
            "file_id": file_id,
            "page_number": page_number,
            "class_id": class_id,
            "source_sha256": entry["sha256"],
            "manifest_sha256": sha256_file(manifest),
            "image_sha256": sha256_file(staging / "page.png"),
            "coordinate_system": "DISPLAY_POINT_TOP_LEFT",
            "page_display_size_pt": page_size,
            "image_size_px": image_size,
            "pdf_rotation_degrees": rotation,
            "pixel_to_display_pt": [width / image_size[0], height / image_size[1]],
            "render_is_complete_page": True,
            "model_proposals_included": False,
            "review_status": "UNREVIEWED",
        }
        (staging / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (staging / "draft.jsonl").write_text(
            json.dumps(draft, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        (staging / "index.html").write_text(
            HTML.replace("__DRAFT_JSON__", safe_json_for_html(draft)).replace(
                "__META_JSON__", safe_json_for_html(metadata)), encoding="utf-8")
        # Atomic directory publication. Existing workspaces are never replaced.
        if output_dir.exists():
            raise PreparationError("output directory already exists")
        os.rename(staging, output_dir)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--file-id", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--class", dest="class_id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--max-edge", type=int, default=8192)
    parser.add_argument("--max-pixels", type=int, default=48_000_000)
    args = parser.parse_args()
    try:
        metadata = prepare(args.manifest, args.source_pdf, args.file_id, args.page,
                           args.class_id, args.output_dir, args.dpi,
                           args.max_edge, args.max_pixels)
    except (PreparationError, OSError, fitz.FileDataError) as error:
        parser.error(str(error))
    print(json.dumps({"workspace": str(args.output_dir),
                      "image_sha256": metadata["image_sha256"],
                      "review_status": "UNREVIEWED"}))


if __name__ == "__main__":
    main()
