#!/usr/bin/env python3
"""Propose room labels for reviewed callout links in one TRAIN_PUBLIC PDF.

Every proposed room remains subject to human review; no domain finding is made.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re

import fitz


ROOM_NUMBER = re.compile(r"\d{2,3}")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def manifest_source(path: Path, file_id: str) -> dict:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    matches = [row for row in rows if row.get("file_id") == file_id]
    if len(matches) != 1:
        raise ValueError("source must occur exactly once in manifest")
    source = matches[0]
    if source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
        raise ValueError("only included TRAIN_PUBLIC source is allowed")
    return source


def circled_room_labels(page: fitz.Page, drawings: list[dict]) -> list[dict]:
    circles = []
    for drawing in drawings:
        color = drawing.get("color")
        rect = drawing["rect"]
        if (color is not None and max(color) < .2
                and 16 <= rect.width <= 24 and 16 <= rect.height <= 24
                and abs(rect.width - rect.height) < 1.5
                and len(drawing["items"]) == 4
                and all(item[0] == "c" for item in drawing["items"])):
            circles.append(rect)
    labels = []
    for word in page.get_text("words"):
        number = word[4].strip("().,;:")
        if not ROOM_NUMBER.fullmatch(number):
            continue
        box = fitz.Rect(word[:4])
        center = (box.tl + box.br) / 2
        matches = [circle for circle in circles
                   if math.hypot((circle.x0 + circle.x1) / 2 - center.x,
                                 (circle.y0 + circle.y1) / 2 - center.y) <= 4]
        if len(matches) != 1:
            continue
        circle = matches[0]
        labels.append({"number": number,
                       "text_bbox_display_pt": [round(value, 3) for value in box],
                       "circle_bbox_display_pt": [round(value, 3) for value in circle],
                       "center": center})
    return labels


def wall_mask(page: fitz.Page):
    import cv2
    import numpy as np

    pixmap = page.get_pixmap(alpha=False)
    if pixmap.n != 3:
        raise ValueError("unexpected PDF render channels")
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, 3)
    black = cv2.inRange(image, (0, 0, 0), (170, 170, 170))
    horizontal = cv2.morphologyEx(
        black, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1)))
    vertical = cv2.morphologyEx(
        black, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15)))
    return cv2.bitwise_or(horizontal, vertical)


def wall_hits(mask, start: fitz.Point, end: fitz.Point) -> int:
    import cv2
    import numpy as np

    distance = math.hypot(end.x - start.x, end.y - start.y)
    if distance < 30:
        return 0
    a = fitz.Point(start.x + (end.x - start.x) * 5 / distance,
                   start.y + (end.y - start.y) * 5 / distance)
    b = fitz.Point(end.x - (end.x - start.x) * 15 / distance,
                   end.y - (end.y - start.y) * 15 / distance)
    left = max(0, math.floor(min(a.x, b.x)) - 2)
    top = max(0, math.floor(min(a.y, b.y)) - 2)
    right = min(mask.shape[1], math.ceil(max(a.x, b.x)) + 3)
    bottom = min(mask.shape[0], math.ceil(max(a.y, b.y)) + 3)
    if left >= right or top >= bottom:
        raise ValueError("room ray outside page raster")
    ray = np.zeros((bottom - top, right - left), dtype=np.uint8)
    cv2.line(ray, (round(a.x) - left, round(a.y) - top),
             (round(b.x) - left, round(b.y) - top), 255, 1)
    return cv2.countNonZero(cv2.bitwise_and(ray, mask[top:bottom, left:right]))


def propose_room(panel: fitz.Rect, leader: list[list[float]], labels: list[dict],
                 hits) -> dict:
    if (not isinstance(leader, list) or len(leader) != 2
            or any(not isinstance(point, list) or len(point) != 2 for point in leader)):
        return {"room_status": "ABSTAIN_CALLOUT_UNLINKED"}
    far = fitz.Point(leader[1])
    center = (panel.tl + panel.br) / 2
    if abs(far.x - center.x) < 15:
        return {"room_status": "ABSTAIN_CALLOUT_DIRECTION_UNKNOWN"}
    side = -1 if far.x > center.x else 1
    interior = fitz.Point(center.x + side * 15, center.y)
    candidates = []
    for label in labels:
        point = label["center"]
        distance = math.hypot(point.x - interior.x, point.y - interior.y)
        if (side * (point.x - center.x) < 25 or distance > 350
                or abs(point.y - center.y) > 300):
            continue
        barrier_hits = hits(interior, point)
        candidates.append({"number": label["number"],
                           "text_bbox_display_pt": label["text_bbox_display_pt"],
                           "circle_bbox_display_pt": label["circle_bbox_display_pt"],
                           "distance_pt": round(distance, 2),
                           "wall_mask_hits": barrier_hits})
    candidates.sort(key=lambda item: item["distance_pt"])
    viable = [item for item in candidates if item["wall_mask_hits"] == 0
              and item["distance_pt"] <= 220]
    evidence = {"interior_side": "LEFT" if side == -1 else "RIGHT",
                "interior_point_display_pt": [round(interior.x, 3), round(interior.y, 3)],
                "room_label_options": candidates[:8]}
    if not viable:
        return {**evidence, "room_status": "ABSTAIN_NO_UNOBSTRUCTED_ROOM_LABEL"}
    if len(viable) > 1 and viable[1]["distance_pt"] < viable[0]["distance_pt"] * 1.45:
        return {**evidence, "room_status": "ABSTAIN_MULTIPLE_ROOM_LABELS"}
    return {**evidence, "room_status": "ROOM_GROUP_CANDIDATE_REVIEW_REQUIRED",
            "proposed_room_group": viable[0]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--callout-report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    locator = json.loads(args.locator_report.read_text(encoding="utf-8"))
    source = manifest_source(args.manifest, locator["target_file_id"])
    if (args.source_pdf.stat().st_size != source["size_bytes"]
            or digest(args.source_pdf) != source["sha256"]):
        parser.error("source PDF size or SHA-256 mismatch")
    library = json.loads(args.template_library.read_text(encoding="utf-8"))
    templates = [entry for entry in library.get("templates", [])
                 if entry.get("template_id") == locator.get("template_id")]
    if (locator.get("schema_version") != "drawing-vector-public-locator-v1"
            or locator.get("status") != "EXPLORATORY_ONLY"
            or locator.get("target_pdf_sha256") != source["sha256"]
            or locator.get("cross_object_eval", False) is not False
            or digest(args.template_library) != locator.get("template_library_sha256")
            or library.get("manifest_sha256") != digest(args.manifest)
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or len(templates) != 1
            or templates[0].get("source_object_id") != source["object_id"]):
        parser.error("locator, library or object scope mismatch")
    candidates = locator.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != locator.get("candidate_count"):
        parser.error("invalid locator candidates")
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
        for result in report.get("results", []):
            index = result.get("candidate_index")
            if (type(index) is not int or not 0 <= index < len(candidates)
                    or index in seen or result.get("candidate") != candidates[index]
                    or result.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY"):
                parser.error("callout candidate mismatch or duplicate")
            seen.add(index)
            selected.append(result)
    if not selected:
        parser.error("no callout results")
    outputs = []
    page_cache = {}
    with fitz.open(args.source_pdf) as document:
        for result in selected:
            index = result["candidate_index"]
            candidate = candidates[index]
            page_number = candidate["page_number"]
            if not 1 <= page_number <= len(document):
                parser.error("candidate page outside PDF")
            panel = fitz.Rect(candidate["bbox_display_pt"])
            if panel.is_empty or not document[page_number - 1].rect.contains(panel):
                parser.error("candidate box outside PDF")
            if result.get("link_status") != "LINKED_LABEL_REVIEW_REQUIRED":
                proposal = {"room_status": "ABSTAIN_CALLOUT_UNLINKED"}
            else:
                if page_number not in page_cache:
                    page = document[page_number - 1]
                    drawings = page.get_drawings()
                    page_cache[page_number] = (circled_room_labels(page, drawings), wall_mask(page))
                labels, mask = page_cache[page_number]
                proposal = propose_room(panel, result.get("leader_display_pt"), labels,
                                        lambda start, end: wall_hits(mask, start, end))
            outputs.append({"candidate_index": index, "candidate": candidate,
                            "callout_status": result["link_status"],
                            "domain_decision": "NOT_ACCEPTED_PROBE_ONLY", **proposal})
    report = {"schema_version": "drawing-room-link-public-probe-v1",
              "status": "EXPLORATORY_ONLY", "source_file_id": source["file_id"],
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(args.manifest),
              "locator_report_sha256": digest(args.locator_report),
              "callout_report_sha256": [digest(path) for path in args.callout_report],
              "method": "circled_pdf_room_group_plus_raster_wall_ray_v1",
              "limitation": "Black circled number may be a parent group; red subroom and exact room remain unresolved. Raster wall rays may miss boundaries or reject annotations.",
              "results": outputs}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(outputs),
                      "statuses": [item["room_status"] for item in outputs]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
