#!/usr/bin/env python3
"""Build a provenance-checked contact sheet for vector proposals on TRAIN_PUBLIC.

The packet is a review aid. It never changes proposal status or writes labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import fitz
import numpy as np


CARD_WIDTH = 440
CARD_HEIGHT = 340
CARDS_PER_SHEET = 16


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def manifest_row(path: Path, file_id: str) -> dict:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    matches = [row for row in rows if row.get("file_id") == file_id]
    if len(matches) != 1:
        raise ValueError("target file must occur exactly once in manifest")
    row = matches[0]
    if row.get("split") != "TRAIN_PUBLIC" or row.get("distribution_status") != "INCLUDE":
        raise ValueError("only included TRAIN_PUBLIC PDFs are allowed")
    return row


def checked_candidates(report: dict, source: dict, document: fitz.Document) -> list[dict]:
    if (report.get("schema_version") != "drawing-vector-public-locator-v1"
            or report.get("status") != "EXPLORATORY_ONLY"
            or report.get("target_file_id") != source["file_id"]
            or report.get("target_pdf_sha256") != source["sha256"]):
        raise ValueError("locator report provenance mismatch")
    candidates = report.get("candidates")
    pages = report.get("target_pages")
    if (not isinstance(candidates, list) or len(candidates) > 500
            or report.get("candidate_count") != len(candidates)
            or not isinstance(pages, list) or not pages
            or len(pages) != len(set(pages))):
        raise ValueError("invalid candidate count or page scope")
    if any(not isinstance(page, int) or page < 1 or page > len(document) for page in pages):
        raise ValueError("page outside PDF")
    distinct = set()
    for candidate in candidates:
        if (candidate.get("file_id") != source["file_id"]
                or candidate.get("source_sha256") != source["sha256"]
                or candidate.get("page_number") not in pages
                or candidate.get("template_id") != report.get("template_id")
                or candidate.get("method") != "red_vector_panel_with_blue_contact_v1"
                or candidate.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"):
            raise ValueError("candidate provenance or status mismatch")
        box = candidate.get("bbox_display_pt")
        if (not isinstance(box, list) or len(box) != 4
                or any(not isinstance(value, (int, float)) for value in box)):
            raise ValueError("invalid candidate coordinates")
        rect = fitz.Rect(box)
        if (rect.is_empty or rect.is_infinite
                or not document[candidate["page_number"] - 1].rect.contains(rect)):
            raise ValueError("candidate outside source page")
        identity = (candidate["page_number"], *box)
        if identity in distinct:
            raise ValueError("duplicate candidate")
        distinct.add(identity)
    return candidates


def draw_card(page: fitz.Page, candidate: dict, candidate_id: str) -> np.ndarray:
    x0, y0, x1, y1 = candidate["bbox_display_pt"]
    center_x, center_y = (x0 + x1) / 2, (y0 + y1) / 2
    clip = fitz.Rect(center_x - 80, center_y - 65, center_x + 80, center_y + 65) & page.rect
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n).copy()
    if pixmap.n != 3:
        raise ValueError("unexpected PDF render channel count")
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    left, top = round((x0 - clip.x0) * 2), round((y0 - clip.y0) * 2)
    right, bottom = round((x1 - clip.x0) * 2), round((y1 - clip.y0) * 2)
    cv2.rectangle(image, (left, top), (right, bottom), (0, 170, 0), 2)
    scale = min((CARD_WIDTH - 16) / image.shape[1], (CARD_HEIGHT - 42) / image.shape[0])
    resized = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    card = np.full((CARD_HEIGHT, CARD_WIDTH, 3), 255, dtype=np.uint8)
    card[28:28 + resized.shape[0], 4:4 + resized.shape[1]] = resized
    cv2.putText(card, candidate_id, (8, 21), cv2.FONT_HERSHEY_SIMPLEX,
                0.56, (0, 0, 0), 1, cv2.LINE_AA)
    return card


def build_packet(manifest: Path, source_pdf: Path, locator_report: Path,
                 output_dir: Path) -> dict:
    report = json.loads(locator_report.read_text(encoding="utf-8"))
    file_id = report.get("target_file_id")
    if not isinstance(file_id, str):
        raise ValueError("locator target_file_id missing")
    source = manifest_row(manifest, file_id)
    if source_pdf.stat().st_size != source["size_bytes"] or digest(source_pdf) != source["sha256"]:
        raise ValueError("source PDF size or SHA-256 mismatch")
    with fitz.open(source_pdf) as document:
        candidates = checked_candidates(report, source, document)
        output_dir.mkdir(parents=True, exist_ok=True)
        entries = []
        sheets = []
        for offset in range(0, len(candidates), CARDS_PER_SHEET):
            sheet = np.full((CARD_HEIGHT * 4, CARD_WIDTH * 4, 3), 232, dtype=np.uint8)
            name = f"contact-{offset // CARDS_PER_SHEET + 1:03d}.png"
            for local_index, candidate in enumerate(candidates[offset:offset + CARDS_PER_SHEET]):
                index = offset + local_index
                candidate_id = f"{file_id}-P{candidate['page_number']:05d}-V{index + 1:04d}"
                card = draw_card(document[candidate["page_number"] - 1], candidate, candidate_id)
                row, column = divmod(local_index, 4)
                sheet[row * CARD_HEIGHT:(row + 1) * CARD_HEIGHT,
                      column * CARD_WIDTH:(column + 1) * CARD_WIDTH] = card
                entries.append({"candidate_id": candidate_id, "candidate_index": index,
                                "page_number": candidate["page_number"],
                                "bbox_display_pt": candidate["bbox_display_pt"],
                                "contact_sheet": name, "review_status": "UNREVIEWED"})
            path = output_dir / name
            if not cv2.imwrite(str(path), sheet):
                raise ValueError("cannot write contact sheet")
            sheets.append({"file": name, "sha256": digest(path)})
    packet = {"schema_version": "drawing-vector-review-packet-v1",
              "status": "REVIEW_PENDING", "file_id": file_id,
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(manifest),
              "locator_report_sha256": digest(locator_report),
              "candidate_count": len(entries), "sheets": sheets,
              "candidates": entries}
    (output_dir / "review-index.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return packet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    packet = build_packet(args.manifest, args.source_pdf, args.locator_report, args.output_dir)
    print(json.dumps({"file_id": packet["file_id"],
                      "candidate_count": packet["candidate_count"],
                      "sheet_count": len(packet["sheets"])}))


if __name__ == "__main__":
    main()
