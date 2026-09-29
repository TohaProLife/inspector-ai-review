#!/usr/bin/env python3
"""Read red circled subroom labels on one SHA-bound TRAIN_PUBLIC PDF page."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import runpy

import fitz


HERE = Path(__file__).resolve().parent
SUBROOM = runpy.run_path(str(HERE / "probe-drawing-subroom-link-public.py"))
ROOM = runpy.run_path(str(HERE / "probe-drawing-room-link-public.py"))
CALLOUT = runpy.run_path(str(HERE / "link-drawing-vector-callouts-public.py"))
SCALE = 12
PAD = 6
INTEGER_ROOM = re.compile(r"\d{2,3}")


def crop_without_circle(page: fitz.Page, circle: fitz.Rect) -> tuple[fitz.Rect, bytes, bytes]:
    import cv2
    import numpy as np

    clip = (circle + (-PAD, -PAD, PAD, PAD)) & page.rect
    pixmap = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), clip=clip, alpha=False)
    if pixmap.n != 3:
        raise ValueError("unexpected PDF render channels")
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, 3).copy()
    center = (round(((circle.x0 + circle.x1) / 2 - clip.x0) * SCALE),
              round(((circle.y0 + circle.y1) / 2 - clip.y0) * SCALE))
    radius = (round(circle.width / 2 * SCALE), round(circle.height / 2 * SCALE))
    cv2.ellipse(image, center, radius, 0, 0, 360, (255, 255, 255), 5)
    ok, cleaned = cv2.imencode(".png", cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError("cannot encode cleaned circle crop")
    return clip, pixmap.tobytes("png"), cleaned.tobytes()


def recognize(response: dict, clip: fitz.Rect, circle: fitz.Rect,
              number_kind: str = "decimal") -> dict:
    import math

    lines = CALLOUT["ocr_lines"](response, clip, SCALE)
    pattern = SUBROOM["SUBROOM"] if number_kind == "decimal" else INTEGER_ROOM
    accepted_status = ("RED_SUBROOM_LABEL_REVIEW_REQUIRED" if number_kind == "decimal"
                       else "RED_ROOM_LABEL_REVIEW_REQUIRED")
    abstain_status = ("ABSTAIN_RED_SUBROOM_OCR" if number_kind == "decimal"
                      else "ABSTAIN_RED_ROOM_OCR")
    options = []
    for line in lines:
        number = line["text"].strip(" ()")
        center = (fitz.Rect(line["bbox_display_pt"]).tl
                  + fitz.Rect(line["bbox_display_pt"]).br) / 2
        if (pattern.fullmatch(number) and line["score"] >= .9
                and math.hypot(center.x - (circle.x0 + circle.x1) / 2,
                               center.y - (circle.y0 + circle.y1) / 2) <= 4):
            options.append({"number": number, "ocr_score": line["score"],
                            "text_bbox_display_pt": line["bbox_display_pt"]})
    if len(options) == 1:
        return {"label_status": accepted_status,
                "proposed_label": options[0], "ocr_options": lines}
    return {"label_status": abstain_status, "ocr_options": lines}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--page-number", type=int, required=True)
    parser.add_argument("--number-kind", choices=("decimal", "integer"), default="decimal")
    parser.add_argument("--ocr-url", type=CALLOUT["local_url"],
                        default="http://127.0.0.1:18084")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    digest = ROOM["digest"]
    locator = json.loads(args.locator_report.read_text(encoding="utf-8"))
    source = ROOM["manifest_source"](args.manifest, locator["target_file_id"])
    library = json.loads(args.template_library.read_text(encoding="utf-8"))
    templates = [entry for entry in library.get("templates", [])
                 if entry.get("template_id") == locator.get("template_id")]
    if (args.source_pdf.stat().st_size != source["size_bytes"]
            or digest(args.source_pdf) != source["sha256"]
            or locator.get("schema_version") != "drawing-vector-public-locator-v1"
            or locator.get("status") != "EXPLORATORY_ONLY"
            or locator.get("target_pdf_sha256") != source["sha256"]
            or locator.get("cross_object_eval", False) is not False
            or args.page_number not in locator.get("target_pages", [])
            or digest(args.template_library) != locator.get("template_library_sha256")
            or library.get("manifest_sha256") != digest(args.manifest)
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or len(templates) != 1
            or templates[0].get("source_object_id") != source["object_id"]):
        parser.error("source, locator or library provenance mismatch")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with fitz.open(args.source_pdf) as document:
        if not 1 <= args.page_number <= len(document):
            parser.error("page outside PDF")
        page = document[args.page_number - 1]
        circles = sorted(SUBROOM["red_circles"](page.get_drawings()), key=lambda rect: (rect.y0, rect.x0))
        rows = []
        for index, circle in enumerate(circles, 1):
            clip, original, cleaned = crop_without_circle(page, circle)
            response = CALLOUT["request_ocr"](cleaned, args.ocr_url)
            ocr_bytes = json.dumps(response, ensure_ascii=False, sort_keys=True).encode("utf-8")
            prefix = f"red-circle-{index:03d}"
            (args.output_dir / f"{prefix}-original.png").write_bytes(original)
            (args.output_dir / f"{prefix}-cleaned.png").write_bytes(cleaned)
            (args.output_dir / f"{prefix}-ocr.json").write_bytes(ocr_bytes)
            rows.append({"circle_index": index,
                         "circle_bbox_display_pt": [round(value, 3) for value in circle],
                         "crop_display_pt": [round(value, 3) for value in clip],
                         "original_sha256": CALLOUT["digest_bytes"](original),
                         "cleaned_sha256": CALLOUT["digest_bytes"](cleaned),
                         "ocr_sha256": CALLOUT["digest_bytes"](ocr_bytes),
                         "domain_decision": "NOT_ACCEPTED_PROBE_ONLY",
                         **recognize(response, clip, circle, args.number_kind)})
    report = {"schema_version": "drawing-red-circle-ocr-public-v1",
              "status": "EXPLORATORY_ONLY", "source_file_id": source["file_id"],
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(args.manifest),
              "locator_report_sha256": digest(args.locator_report),
              "page_number": args.page_number,
              "number_kind": args.number_kind,
              "method": "red_vector_circle_ellipse_removed_then_local_ocr_v1",
              "limitation": "One page and one drawing style; all labels require review.",
              "results": rows}
    (args.output_dir / "summary.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"circles": len(rows), "statuses": [r["label_status"] for r in rows],
                      "labels": [r.get("proposed_label", {}).get("number") for r in rows]},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
