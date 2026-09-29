#!/usr/bin/env python3
"""Probe exact red subroom labels using SHA-bound callout OCR and PDF geometry."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import runpy

import fitz


HERE = Path(__file__).resolve().parent
ROOM = runpy.run_path(str(HERE / "probe-drawing-room-link-public.py"))
CALLOUT = runpy.run_path(str(HERE / "link-drawing-vector-callouts-public.py"))
SUBROOM = re.compile(r"\d{2,3}\.\d{1,2}")


def red_circles(drawings: list[dict]) -> list[fitz.Rect]:
    circles = []
    for drawing in drawings:
        color = drawing.get("color")
        rect = drawing["rect"]
        if (color is not None and color[0] > .8 and color[1] < .2 and color[2] < .2
                and 16 <= rect.width <= 24 and 16 <= rect.height <= 24
                and abs(rect.width - rect.height) < 1.5
                and len(drawing["items"]) == 4
                and all(item[0] == "c" for item in drawing["items"])):
            circles.append(rect)
    return circles


def paired_horizontal_walls(drawings: list[dict]) -> list[tuple[float, float, float]]:
    """Keep paired dark horizontal strokes; isolated annotation lines do not block rooms."""
    segments = []
    for drawing in drawings:
        color = drawing.get("color")
        if not color or max(color) >= .25:
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            a, b = item[1:3]
            if abs(a.y - b.y) <= .15 and abs(a.x - b.x) >= 25:
                segments.append((a.y, min(a.x, b.x), max(a.x, b.x)))
    segments.sort()
    paired = set()
    for index, first in enumerate(segments):
        for other in range(index + 1, len(segments)):
            second = segments[other]
            if second[0] - first[0] > 4:
                break
            overlap = min(first[2], second[2]) - max(first[1], second[1])
            if 1 <= second[0] - first[0] <= 4 and overlap >= 20:
                paired.update((index, other))
    return [segments[index] for index in sorted(paired)]


def vector_wall_hits(segments: list[tuple[float, float, float]],
                     start: fitz.Point, end: fitz.Point) -> int:
    distance = math.hypot(end.x - start.x, end.y - start.y)
    if distance < 30 or abs(end.y - start.y) < .01:
        return 0
    minimum, maximum = 5 / distance, 1 - 15 / distance
    count = 0
    for y, x0, x1 in segments:
        fraction = (y - start.y) / (end.y - start.y)
        if minimum < fraction < maximum:
            x = start.x + fraction * (end.x - start.x)
            if x0 - .5 <= x <= x1 + .5:
                count += 1
    return count


def propose_subroom(panel: fitz.Rect, leader: list[list[float]], lines: list[dict],
                    circles: list[fitz.Rect], hits, vector_hits=None) -> dict:
    if (not isinstance(leader, list) or len(leader) != 2
            or any(not isinstance(point, list) or len(point) != 2 for point in leader)):
        return {"subroom_status": "ABSTAIN_CALLOUT_UNLINKED"}
    center = (panel.tl + panel.br) / 2
    far = fitz.Point(leader[1])
    if abs(far.x - center.x) < 15:
        return {"subroom_status": "ABSTAIN_CALLOUT_DIRECTION_UNKNOWN"}
    side = -1 if far.x > center.x else 1
    interior = fitz.Point(center.x + side * 15, center.y)
    options = []
    for line in lines:
        number = line["text"].strip(" ()")
        if not SUBROOM.fullmatch(number) or line["score"] < .9:
            continue
        text_box = fitz.Rect(line["bbox_display_pt"])
        point = (text_box.tl + text_box.br) / 2
        matched = [circle for circle in circles
                   if math.hypot((circle.x0 + circle.x1) / 2 - point.x,
                                 (circle.y0 + circle.y1) / 2 - point.y) <= 4]
        if len(matched) != 1 or side * (point.x - center.x) < 20:
            continue
        distance = math.hypot(interior.x - point.x, interior.y - point.y)
        if distance > 220 or abs(interior.y - point.y) > 210:
            continue
        count = hits(interior, point)
        vector_count = vector_hits(interior, point) if vector_hits else 0
        options.append({"number": number, "ocr_score": line["score"],
                        "text_bbox_display_pt": line["bbox_display_pt"],
                        "red_circle_bbox_display_pt": [round(v, 3) for v in matched[0]],
                        "distance_pt": round(distance, 2), "wall_mask_hits": count,
                        "paired_vector_wall_hits": vector_count})
    options.sort(key=lambda item: item["distance_pt"])
    viable = [item for item in options if item["wall_mask_hits"] == 0
              and item["paired_vector_wall_hits"] == 0]
    evidence = {"interior_side": "LEFT" if side == -1 else "RIGHT",
                "red_subroom_options": options}
    if len(viable) == 1 or (len(viable) > 1
                            and viable[1]["distance_pt"] >= viable[0]["distance_pt"] * 1.45):
        return {**evidence, "subroom_status": "SUBROOM_CANDIDATE_REVIEW_REQUIRED",
                "proposed_subroom": viable[0]}
    if len(viable) > 1:
        return {**evidence, "subroom_status": "ABSTAIN_MULTIPLE_SUBROOM_LABELS"}
    return {**evidence, "subroom_status": "ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--room-group-report", type=Path, required=True)
    parser.add_argument("--red-circle-report", type=Path, required=True)
    parser.add_argument("--callout-report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    digest = ROOM["digest"]
    locator = json.loads(args.locator_report.read_text(encoding="utf-8"))
    source = ROOM["manifest_source"](args.manifest, locator["target_file_id"])
    if (args.source_pdf.stat().st_size != source["size_bytes"]
            or digest(args.source_pdf) != source["sha256"]):
        parser.error("source PDF size or SHA-256 mismatch")
    library = json.loads(args.template_library.read_text(encoding="utf-8"))
    template = [entry for entry in library.get("templates", [])
                if entry.get("template_id") == locator.get("template_id")]
    if (locator.get("schema_version") != "drawing-vector-public-locator-v1"
            or locator.get("status") != "EXPLORATORY_ONLY"
            or locator.get("target_pdf_sha256") != source["sha256"]
            or locator.get("cross_object_eval", False) is not False
            or digest(args.template_library) != locator.get("template_library_sha256")
            or library.get("manifest_sha256") != digest(args.manifest)
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or len(template) != 1
            or template[0].get("source_object_id") != source["object_id"]):
        parser.error("locator or library provenance mismatch")
    candidates = locator.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != locator.get("candidate_count"):
        parser.error("invalid locator candidates")
    group = json.loads(args.room_group_report.read_text(encoding="utf-8"))
    if (group.get("schema_version") != "drawing-room-link-public-probe-v1"
            or group.get("status") != "EXPLORATORY_ONLY"
            or group.get("source_file_id") != source["file_id"]
            or group.get("source_pdf_sha256") != source["sha256"]
            or group.get("manifest_sha256") != digest(args.manifest)
            or group.get("locator_report_sha256") != digest(args.locator_report)
            or group.get("callout_report_sha256") != [digest(path) for path in args.callout_report]):
        parser.error("room group report provenance mismatch")
    group_by_index = {row["candidate_index"]: row for row in group["results"]}
    if (len(group_by_index) != len(group["results"])
            or any(row.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY"
                   for row in group["results"])):
        parser.error("duplicate group candidate")
    circle_report = json.loads(args.red_circle_report.read_text(encoding="utf-8"))
    if (circle_report.get("schema_version") != "drawing-red-circle-ocr-public-v1"
            or circle_report.get("status") != "EXPLORATORY_ONLY"
            or circle_report.get("source_file_id") != source["file_id"]
            or circle_report.get("source_pdf_sha256") != source["sha256"]
            or circle_report.get("manifest_sha256") != digest(args.manifest)
            or circle_report.get("locator_report_sha256") != digest(args.locator_report)
            or circle_report.get("number_kind") != "decimal"
            or type(circle_report.get("page_number")) is not int):
        parser.error("red circle OCR report provenance mismatch")
    circle_rows = circle_report.get("results")
    if not isinstance(circle_rows, list) or len({row.get("circle_index") for row in circle_rows}) != len(circle_rows):
        parser.error("red circle OCR report rows invalid")
    red_labels = []
    for row in circle_rows:
        if row.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY":
            parser.error("red circle row accepted unexpectedly")
        prefix = f"red-circle-{row['circle_index']:03d}"
        for suffix, field in (("original.png", "original_sha256"),
                              ("cleaned.png", "cleaned_sha256"),
                              ("ocr.json", "ocr_sha256")):
            if digest(args.red_circle_report.parent / f"{prefix}-{suffix}") != row.get(field):
                parser.error("red circle OCR artifact SHA-256 mismatch")
        recorded_ocr = json.loads((args.red_circle_report.parent / f"{prefix}-ocr.json").read_text(
            encoding="utf-8"))
        recorded_lines = CALLOUT["ocr_lines"](
            recorded_ocr, fitz.Rect(row["crop_display_pt"]), 12)
        if row.get("label_status") == "RED_SUBROOM_LABEL_REVIEW_REQUIRED":
            label = row.get("proposed_label", {})
            if (not isinstance(label.get("number"), str)
                    or not SUBROOM.fullmatch(label["number"])
                    or label.get("ocr_score", 0) < .9
                    or not any(line["text"].strip(" ()") == label["number"]
                               and line["score"] == label["ocr_score"]
                               and line["bbox_display_pt"] == label["text_bbox_display_pt"]
                               for line in recorded_lines)):
                parser.error("red circle label invalid")
            red_labels.append({"text": label["number"], "score": label["ocr_score"],
                               "bbox_display_pt": label["text_bbox_display_pt"]})
        elif row.get("label_status") != "ABSTAIN_RED_SUBROOM_OCR":
            parser.error("red circle label status invalid")
    selected = []
    seen = set()
    for path in args.callout_report:
        report = json.loads(path.read_text(encoding="utf-8"))
        if (report.get("schema_version") != "drawing-vector-callout-probe-v1"
                or report.get("status") != "EXPLORATORY_ONLY"
                or report.get("source_file_id") != source["file_id"]
                or report.get("source_pdf_sha256") != source["sha256"]
                or report.get("manifest_sha256") != digest(args.manifest)
                or report.get("locator_report_sha256") != digest(args.locator_report)):
            parser.error("callout report provenance mismatch")
        for row in report.get("results", []):
            index = row.get("candidate_index")
            if (type(index) is not int or not 0 <= index < len(candidates)
                    or index in seen or index not in group_by_index
                    or row.get("candidate") != group_by_index[index]["candidate"]
                    or row.get("candidate") != candidates[index]
                    or row.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY"):
                parser.error("callout or group candidate mismatch")
            seen.add(index)
            selected.append((path.parent, row))
    if seen != set(group_by_index):
        parser.error("callout and group candidate sets differ")
    outputs = []
    page_cache = {}
    with fitz.open(args.source_pdf) as document:
        for directory, row in selected:
            index = row["candidate_index"]
            candidate = row["candidate"]
            page_number = candidate["page_number"]
            if not 1 <= page_number <= len(document):
                parser.error("candidate page outside PDF")
            panel = fitz.Rect(candidate["bbox_display_pt"])
            if panel.is_empty or not document[page_number - 1].rect.contains(panel):
                parser.error("candidate outside PDF")
            if row.get("link_status") != "LINKED_LABEL_REVIEW_REQUIRED":
                proposal = {"subroom_status": "ABSTAIN_CALLOUT_UNLINKED"}
            else:
                if page_number != circle_report["page_number"]:
                    parser.error("candidate page and red circle OCR page differ")
                ocr_path = directory / f"candidate-{index:04d}-ocr.json"
                crop_path = directory / f"candidate-{index:04d}.png"
                if (digest(ocr_path) != row.get("ocr_sha256")
                        or digest(crop_path) != row.get("crop_sha256")):
                    parser.error("OCR or crop SHA-256 mismatch")
                ocr = json.loads(ocr_path.read_text(encoding="utf-8"))
                if page_number not in page_cache:
                    page = document[page_number - 1]
                    drawings = page.get_drawings()
                    page_cache[page_number] = (red_circles(drawings),
                                               ROOM["wall_mask"](page),
                                               paired_horizontal_walls(drawings))
                circles, mask, vector_segments = page_cache[page_number]
                if (len(circles) != len(circle_rows)
                        or {tuple(round(v, 3) for v in rect) for rect in circles}
                        != {tuple(circle_row["circle_bbox_display_pt"]) for circle_row in circle_rows}):
                    parser.error("red circle geometry mismatch")
                CALLOUT["ocr_lines"](ocr, fitz.Rect(row["crop_display_pt"]), 3)
                proposal = propose_subroom(
                    panel, row.get("leader_display_pt"), red_labels, circles,
                    lambda start, end: ROOM["wall_hits"](mask, start, end),
                    lambda start, end: vector_wall_hits(vector_segments, start, end))
            outputs.append({"candidate_index": index, "candidate": candidate,
                            "callout_status": row["link_status"],
                            "room_group_status": group_by_index[index]["room_status"],
                            "domain_decision": "NOT_ACCEPTED_PROBE_ONLY", **proposal})
    report = {"schema_version": "drawing-subroom-link-public-probe-v1",
              "status": "EXPLORATORY_ONLY", "source_file_id": source["file_id"],
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(args.manifest),
              "locator_report_sha256": digest(args.locator_report),
              "room_group_report_sha256": digest(args.room_group_report),
              "red_circle_report_sha256": digest(args.red_circle_report),
              "callout_report_sha256": [digest(path) for path in args.callout_report],
              "method": "red_vector_circle_masked_ocr_with_raster_and_paired_vector_wall_ray_v3",
              "limitation": "Red circle OCR and wall rays require independent review; no room_id or finding is accepted.",
              "results": outputs}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(outputs),
                      "statuses": {status: sum(x["subroom_status"] == status for x in outputs)
                                   for status in sorted({x["subroom_status"] for x in outputs})}},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
