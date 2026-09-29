#!/usr/bin/env python3
"""Ask a loopback VLM to inspect selected, provenance-bound template proposals."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse

import cv2
import fitz
import numpy as np


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def local_url(value: str) -> str:
    parsed = urlparse(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("model URL must be loopback HTTP")
    return value.rstrip("/")


def review_gate(candidate: dict, parsed_answer: object) -> str:
    if (not isinstance(parsed_answer, dict)
            or set(parsed_answer) != {"class", "visibleLabel", "reason"}
            or parsed_answer.get("class") not in {"RADIATOR", "OTHER", "UNCERTAIN"}
            or (parsed_answer["visibleLabel"] is not None
                and (not isinstance(parsed_answer["visibleLabel"], str)
                     or parsed_answer["visibleLabel"].strip().lower() == "null"))
            or not isinstance(parsed_answer["reason"], str)):
        return "ABSTAIN_INVALID_MODEL_OUTPUT"
    if (candidate.get("vector_context") == "GEOMETRIC_SUPPORT"
            and parsed_answer["class"] == "RADIATOR"):
        if candidate.get("cross_object_eval") is True:
            return "ABSTAIN_CROSS_OBJECT_STYLE_UNVERIFIED"
        return "REVIEW_REQUIRED_GEOMETRIC_AND_VISUAL_SUPPORT"
    return "ABSTAIN_CONTEXT_UNVERIFIED"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--tile-base", type=Path)
    parser.add_argument("--source-pdf", type=Path,
                        help="required for vector locator reports")
    parser.add_argument("--candidate-report", type=Path, required=True)
    parser.add_argument("--candidate-index", type=int, required=True,
                        help="zero-based index into candidates")
    parser.add_argument("--model-url", type=local_url, default="http://127.0.0.1:18086")
    parser.add_argument("--model", default="inspector-qwen3vl4b-eval")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.candidate_report.read_text(encoding="utf-8"))
    report_schema = report.get("schema_version")
    if report_schema not in {"drawing-template-public-probe-v1",
                             "drawing-vector-public-locator-v1"}:
        parser.error("unsupported candidate report")
    candidates = report.get("candidates")
    if (not isinstance(candidates, list) or args.candidate_index < 0
            or args.candidate_index >= len(candidates)):
        parser.error("candidate index out of range")
    candidate = candidates[args.candidate_index]
    manifest = {item["file_id"]: item for item in (
        json.loads(line) for line in args.manifest.read_text(encoding="utf-8").splitlines() if line.strip())}
    source = manifest[candidate["file_id"]]
    if (source["split"] != "TRAIN_PUBLIC" or source["distribution_status"] != "INCLUDE"
            or source["sha256"] != candidate["source_sha256"]):
        parser.error("candidate source is not a verified public PDF")
    gate_candidate = candidate
    if report_schema == "drawing-template-public-probe-v1":
        if args.tile_base is None or args.source_pdf is not None:
            parser.error("raster reports require --tile-base only")
        tiles = {item["tile_id"]: item for item in (
            json.loads(line) for line in (args.tile_base / "tiles.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip())}
        tile = tiles[candidate["tile_id"]]
        if (tile["source_sha256"] != source["sha256"]
                or tile["page_number"] != candidate["page_number"]
                or tile["master_sha256"] != candidate["tile_sha256"]):
            parser.error("candidate tile provenance mismatch")
        image_path = args.tile_base / tile["master_png"]
        if digest(image_path) != tile["master_sha256"]:
            parser.error("tile SHA-256 mismatch")
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            parser.error("tile cannot be decoded")
        transform = tile["transforms"]["display_pt_to_master_px"]
        if transform[1] != 0 or transform[2] != 0 or transform[0] != transform[3]:
            parser.error("unsupported page transform")
        box = candidate["bbox_display_pt"]
        left, top, right, bottom = [round(value) for value in (
            transform[0] * box[0] + transform[4], transform[3] * box[1] + transform[5],
            transform[0] * box[2] + transform[4], transform[3] * box[3] + transform[5])]
        center_x, center_y = (left + right) // 2, (top + bottom) // 2
        crop_left, crop_top = max(0, center_x - 420), max(0, center_y - 420)
        crop_right = min(image.shape[1], center_x + 420)
        crop_bottom = min(image.shape[0], center_y + 420)
        crop = image[crop_top:crop_bottom, crop_left:crop_right].copy()
    else:
        if args.source_pdf is None or args.tile_base is not None:
            parser.error("vector reports require --source-pdf only")
        if (report.get("status") != "EXPLORATORY_ONLY"
                or report.get("target_file_id") != source["file_id"]
                or report.get("target_pdf_sha256") != source["sha256"]
                or report.get("target_object_id") != source["object_id"]
                or report.get("cross_object_eval") is not (
                    report.get("source_object_id") != report.get("target_object_id"))
                or candidate.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
                or candidate.get("method") != "red_vector_panel_with_blue_contact_v1"
                or candidate.get("page_number") not in report.get("target_pages", [])):
            parser.error("vector report provenance mismatch")
        if args.source_pdf.stat().st_size != source["size_bytes"] or digest(args.source_pdf) != source["sha256"]:
            parser.error("source PDF size or SHA-256 mismatch")
        with fitz.open(args.source_pdf) as document:
            if not 1 <= candidate["page_number"] <= len(document):
                parser.error("candidate page outside PDF")
            page = document[candidate["page_number"] - 1]
            rectangle = fitz.Rect(candidate["bbox_display_pt"])
            if rectangle.is_empty or not page.rect.contains(rectangle):
                parser.error("candidate bbox outside page")
            center_x, center_y = (rectangle.x0 + rectangle.x1) / 2, (rectangle.y0 + rectangle.y1) / 2
            clip = fitz.Rect(center_x - 80, center_y - 65,
                             center_x + 80, center_y + 65) & page.rect
            pixmap = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=clip, alpha=False)
            image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
                pixmap.height, pixmap.width, pixmap.n).copy()
            if pixmap.n != 3:
                parser.error("unsupported PDF render channels")
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        left, top, right, bottom = [round(value) for value in (
            (rectangle.x0 - clip.x0) * 3, (rectangle.y0 - clip.y0) * 3,
            (rectangle.x1 - clip.x0) * 3, (rectangle.y1 - clip.y0) * 3)]
        crop_left = crop_top = 0
        crop = image
        gate_candidate = {**candidate, "vector_context": "GEOMETRIC_SUPPORT",
                          "cross_object_eval": report["cross_object_eval"]}
    if crop.size == 0 or not (0 <= left < right <= image.shape[1]
                             and 0 <= top < bottom <= image.shape[0]):
        parser.error("candidate bbox is outside tile")
    cv2.rectangle(crop, (left - crop_left - 4, top - crop_top - 4),
                  (right - crop_left + 4, bottom - crop_top + 4), (0, 180, 0), 3)
    if max(crop.shape[:2]) > 768:
        ratio = 768 / max(crop.shape[:2])
        crop = cv2.resize(crop, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".png", crop)
    if not ok:
        parser.error("cannot encode model crop")
    png = encoded.tobytes()
    prompt = (
        "Посмотри только на объект внутри зелёной рамки на инженерном чертеже. "
        "Это именно радиатор отопления, другой элемент или определить нельзя? "
        "Выноску и подпись учитывай лишь когда видно, что они относятся к объекту. "
        "Ответь одним JSON с полями class (RADIATOR, OTHER или UNCERTAIN), "
        "visibleLabel (прочитанный текст или значение null без кавычек), reason (кратко). "
        "Не делай выводов об остальных элементах листа."
    )
    payload = json.dumps({"model": args.model, "temperature": 0, "max_tokens": 220,
                          "messages": [{"role": "user", "content": [
                              {"type": "text", "text": prompt},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," +
                                                                  base64.b64encode(png).decode("ascii")}},
                          ]}]}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(args.model_url + "/v1/chat/completions", payload,
                                     {"Content-Type": "application/json"}, method="POST")
    started = time.monotonic()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=180) as response:
        body = response.read(2_000_001)
    if len(body) > 2_000_000:
        raise ValueError("model response exceeds limit")
    raw = json.loads(body)
    answer = raw["choices"][0]["message"].get("content") or ""
    try:
        parsed = json.loads(answer)
    except json.JSONDecodeError:
        parsed = None
    result = {
        "schema_version": "drawing-template-vision-public-probe-v1", "status": "EXPLORATORY_ONLY",
        "candidate_report_sha256": digest(args.candidate_report),
        "candidate_index": args.candidate_index, "candidate": candidate,
        "input_image_sha256": hashlib.sha256(png).hexdigest(),
        "model": args.model, "model_seconds": round(time.monotonic() - started, 3),
        "raw_answer": answer, "parsed_answer": parsed,
        "review_gate": review_gate(gate_candidate, parsed),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".png").write_bytes(png)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"candidate_index": args.candidate_index, "parsed_answer": parsed,
                      "model_seconds": result["model_seconds"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
