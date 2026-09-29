#!/usr/bin/env python3
"""Render SHA-bound room proposal overlays for human review on TRAIN_PUBLIC."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import fitz
import numpy as np


CARD_WIDTH = 800
CARD_HEIGHT = 640
CARDS_PER_SHEET = 6


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def source_from_manifest(manifest: Path, file_id: str) -> dict:
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    matches = [row for row in rows if row.get("file_id") == file_id]
    if len(matches) != 1:
        raise ValueError("source must occur exactly once in manifest")
    source = matches[0]
    if source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
        raise ValueError("only included TRAIN_PUBLIC source is allowed")
    return source


def checked_proposals(report: dict, source: dict, document: fitz.Document) -> list[dict]:
    if (report.get("schema_version") != "drawing-room-link-public-probe-v1"
            or report.get("status") != "EXPLORATORY_ONLY"
            or report.get("source_file_id") != source["file_id"]
            or report.get("source_pdf_sha256") != source["sha256"]):
        raise ValueError("room report provenance mismatch")
    proposals = []
    seen = set()
    for item in report.get("results", []):
        index = item.get("candidate_index")
        if type(index) is not int or index in seen:
            raise ValueError("duplicate or invalid candidate index")
        seen.add(index)
        if item.get("room_status") != "ROOM_GROUP_CANDIDATE_REVIEW_REQUIRED":
            continue
        candidate = item.get("candidate", {})
        room = item.get("proposed_room_group", {})
        page_number = candidate.get("page_number")
        if (candidate.get("file_id") != source["file_id"]
                or candidate.get("source_sha256") != source["sha256"]
                or item.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY"
                or type(page_number) is not int or not 1 <= page_number <= len(document)
                or not isinstance(room.get("number"), str)
                or not room["number"].isdigit()):
            raise ValueError("room proposal source or status mismatch")
        panel = fitz.Rect(candidate["bbox_display_pt"])
        circle = fitz.Rect(room["circle_bbox_display_pt"])
        if (panel.is_empty or circle.is_empty
                or not document[page_number - 1].rect.contains(panel)
                or not document[page_number - 1].rect.contains(circle)):
            raise ValueError("proposal outside PDF page")
        proposals.append(item)
    return proposals


def card(page: fitz.Page, item: dict) -> np.ndarray:
    import cv2

    panel = fitz.Rect(item["candidate"]["bbox_display_pt"])
    circle = fitz.Rect(item["proposed_room_group"]["circle_bbox_display_pt"])
    clip = (panel | circle) + (-60, -75, 60, 75)
    clip &= page.rect
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
    if pixmap.n != 3:
        raise ValueError("unexpected PDF render channels")
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, 3).copy()
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

    def pixels(rect: fitz.Rect) -> tuple[int, int, int, int]:
        return (round((rect.x0 - clip.x0) * 2), round((rect.y0 - clip.y0) * 2),
                round((rect.x1 - clip.x0) * 2), round((rect.y1 - clip.y0) * 2))

    p = pixels(panel)
    r = pixels(circle)
    cv2.rectangle(image, p[:2], p[2:], (0, 0, 255), 3)
    cv2.rectangle(image, r[:2], r[2:], (0, 170, 0), 3)
    scale = min((CARD_WIDTH - 20) / image.shape[1],
                (CARD_HEIGHT - 50) / image.shape[0])
    resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    output = np.full((CARD_HEIGHT, CARD_WIDTH, 3), 255, dtype=np.uint8)
    output[43:43 + resized.shape[0], 10:10 + resized.shape[1]] = resized
    title = (f"{item['candidate']['file_id']} p{item['candidate']['page_number']} "
             f"V{item['candidate_index']} group {item['proposed_room_group']['number']}")
    cv2.putText(output, title, (12, 30), cv2.FONT_HERSHEY_SIMPLEX,
                .75, (0, 0, 0), 2)
    return output


def build(manifest: Path, source_pdf: Path, room_report: Path, output_dir: Path) -> dict:
    import cv2

    report = json.loads(room_report.read_text(encoding="utf-8"))
    source = source_from_manifest(manifest, report["source_file_id"])
    if (source_pdf.stat().st_size != source["size_bytes"]
            or digest(source_pdf) != source["sha256"]
            or report.get("manifest_sha256") != digest(manifest)):
        raise ValueError("PDF or manifest SHA-256 mismatch")
    with fitz.open(source_pdf) as document:
        proposals = checked_proposals(report, source, document)
        output_dir.mkdir(parents=True, exist_ok=True)
        entries = []
        sheets = []
        for offset in range(0, len(proposals), CARDS_PER_SHEET):
            sheet = np.full((CARD_HEIGHT * 3, CARD_WIDTH * 2, 3), 235, dtype=np.uint8)
            for local_index, item in enumerate(proposals[offset:offset + CARDS_PER_SHEET]):
                index = offset + local_index
                picture = card(document[item["candidate"]["page_number"] - 1], item)
                card_name = f"card-{index + 1:03d}.png"
                card_path = output_dir / card_name
                if not cv2.imwrite(str(card_path), picture):
                    raise ValueError("cannot write review card")
                row, column = divmod(local_index, 2)
                sheet[row * CARD_HEIGHT:(row + 1) * CARD_HEIGHT,
                      column * CARD_WIDTH:(column + 1) * CARD_WIDTH] = picture
                entries.append({"candidate_index": item["candidate_index"],
                                "page_number": item["candidate"]["page_number"],
                                "proposed_room_group": item["proposed_room_group"]["number"],
                                "image": card_name, "sha256": digest(card_path),
                                "review_status": "UNREVIEWED"})
            sheet_name = f"contact-{offset // CARDS_PER_SHEET + 1:03d}.png"
            sheet_path = output_dir / sheet_name
            if not cv2.imwrite(str(sheet_path), sheet):
                raise ValueError("cannot write review sheet")
            sheets.append({"image": sheet_name, "sha256": digest(sheet_path)})
    packet = {"schema_version": "drawing-room-review-packet-v1",
              "status": "REVIEW_PENDING", "source_file_id": source["file_id"],
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(manifest),
              "room_report_sha256": digest(room_report),
              "entries": entries, "sheets": sheets}
    (output_dir / "review-index.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return packet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--room-report", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    packet = build(args.manifest, args.source_pdf, args.room_report, args.output_dir)
    print(json.dumps({"proposals": len(packet["entries"]),
                      "sheets": len(packet["sheets"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
