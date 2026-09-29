#!/usr/bin/env python3
"""Link selected TRAIN_PUBLIC vector proposals to OCR callouts for review.

This offline probe does not classify a device, resolve a room, or create findings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.request
from urllib.parse import urlparse
import uuid

import fitz


MODEL = re.compile(r"\b(?:11|21|22|33)-\d{3}-\d{3,4}\b")


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def local_url(value: str) -> str:
    parsed = urlparse(value)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError("OCR URL must be loopback HTTP")
    return value.rstrip("/")


def manifest_source(manifest: Path, file_id: str) -> dict:
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()
            if line.strip()]
    matches = [row for row in rows if row.get("file_id") == file_id]
    if len(matches) != 1:
        raise ValueError("source must occur exactly once in manifest")
    source = matches[0]
    if source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
        raise ValueError("only included TRAIN_PUBLIC source is allowed")
    return source


def checked_candidate(report: dict, source: dict, index: int, document: fitz.Document) -> tuple[fitz.Page, fitz.Rect]:
    if (report.get("schema_version") != "drawing-vector-public-locator-v1"
            or report.get("status") != "EXPLORATORY_ONLY"
            or report.get("target_file_id") != source["file_id"]
            or report.get("target_pdf_sha256") != source["sha256"]
            or report.get("target_object_id", source["object_id"]) != source["object_id"]
            or report.get("cross_object_eval", False) is not False
            or report.get("source_object_id", source["object_id"]) != source["object_id"]):
        raise ValueError("locator provenance or object scope mismatch")
    candidates = report.get("candidates")
    if (not isinstance(candidates, list) or report.get("candidate_count") != len(candidates)
            or not 0 <= index < len(candidates)):
        raise ValueError("invalid candidate index or count")
    candidate = candidates[index]
    page_number = candidate.get("page_number")
    if (candidate.get("file_id") != source["file_id"]
            or candidate.get("source_sha256") != source["sha256"]
            or candidate.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
            or candidate.get("method") != "red_vector_panel_with_blue_contact_v1"
            or candidate.get("template_id") != report.get("template_id")
            or type(page_number) is not int or page_number not in report.get("target_pages", [])
            or not 1 <= page_number <= len(document)):
        raise ValueError("candidate provenance mismatch")
    box = candidate.get("bbox_display_pt")
    if (not isinstance(box, list) or len(box) != 4
            or any(type(value) not in (float, int) or not math.isfinite(value) for value in box)):
        raise ValueError("candidate box invalid")
    page = document[page_number - 1]
    rect = fitz.Rect(box)
    if rect.is_empty or rect.is_infinite or not page.rect.contains(rect):
        raise ValueError("candidate outside PDF page")
    return page, rect


def point_rect_distance(point: fitz.Point, rect: fitz.Rect) -> float:
    return math.hypot(max(rect.x0 - point.x, 0, point.x - rect.x1),
                      max(rect.y0 - point.y, 0, point.y - rect.y1))


def blue_leaders(page: fitz.Page, panel: fitz.Rect) -> list[tuple[fitz.Point, fitz.Point]]:
    leaders = []
    seen = set()
    search = fitz.Rect(panel.x0 - 165, panel.y0 - 75, panel.x1 + 165, panel.y1 + 75)
    for drawing in page.get_drawings():
        color = drawing.get("color")
        if (not color or color[2] <= 0.8 or color[0] >= 0.2 or color[1] >= 0.2
                or not drawing["rect"].intersects(search)):
            continue
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            for near, far in ((item[1], item[2]), (item[2], item[1])):
                length = math.hypot(far.x - near.x, far.y - near.y)
                if (not 15 <= length <= 150 or abs(far.y - near.y) < 4
                        or not panel.y0 + panel.height * .1 <= near.y <= panel.y1 - panel.height * .1
                        or min(abs(near.x - panel.x0), abs(near.x - panel.x1)) > 2
                        or point_rect_distance(far, panel) < 8):
                    continue
                identity = tuple(round(v, 1) for v in (near.x, near.y, far.x, far.y))
                if identity not in seen:
                    leaders.append((near, far))
                    seen.add(identity)
    return leaders


def ocr_lines(response: dict, clip: fitz.Rect, scale: float) -> list[dict]:
    if response.get("schemaVersion") != "document-ai-ocr-response-v1" or len(response.get("results", [])) != 1:
        raise ValueError("unexpected OCR response")
    result = response["results"][0].get("overall_ocr_res", {})
    texts, scores, boxes = (result.get(key) for key in ("rec_texts", "rec_scores", "rec_boxes"))
    if not all(isinstance(value, list) for value in (texts, scores, boxes)) or len(texts) != len(scores) or len(texts) != len(boxes):
        raise ValueError("invalid OCR line arrays")
    lines = []
    for text, score, box in zip(texts, scores, boxes):
        if (not isinstance(text, str) or type(score) not in (int, float)
                or not math.isfinite(score) or not 0 <= score <= 1
                or not isinstance(box, list) or len(box) != 4
                or any(type(value) not in (int, float) or not math.isfinite(value) for value in box)):
            raise ValueError("invalid OCR line")
        rect = fitz.Rect(clip.x0 + box[0] / scale, clip.y0 + box[1] / scale,
                         clip.x0 + box[2] / scale, clip.y0 + box[3] / scale)
        if rect.is_empty or not (clip + (-1, -1, 1, 1)).contains(rect):
            raise ValueError("OCR box outside crop")
        lines.append({"text": text.strip(), "score": round(float(score), 4),
                      "bbox_display_pt": [round(v, 3) for v in rect]})
    return lines


def link_callout(leaders: list[tuple[fitz.Point, fitz.Point]], lines: list[dict]) -> dict:
    if not leaders:
        return {"link_status": "ABSTAIN_NO_LEADER"}
    matches = []
    for leader in leaders:
        far = leader[1]
        for label in lines:
            if label["score"] < .9 or not re.search(r"\bPRADO\b", label["text"], re.IGNORECASE):
                continue
            label_rect = fitz.Rect(label["bbox_display_pt"])
            if point_rect_distance(far, label_rect) > 4:
                continue
            models = []
            for line in lines:
                model = MODEL.search(line["text"])
                box = fitz.Rect(line["bbox_display_pt"])
                if (model and line["score"] >= .9
                        and -2 <= box.y0 - label_rect.y1 <= 12
                        and box.x0 < label_rect.x1 - 5 and box.x1 > label_rect.x0 + 5):
                    models.append((line, model.group()))
            if len(models) == 1:
                matches.append((leader, label, models[0]))
    identities = {(tuple(round(v, 2) for point in match[0] for v in (point.x, point.y)),
                   match[1]["text"], match[2][1]) for match in matches}
    if len(identities) != 1:
        return {"link_status": "ABSTAIN_AMBIGUOUS_OR_MISSING_CALLOUT",
                "anchored_callout_count": len(identities)}
    leader, label, (model_line, model) = matches[0]
    return {"link_status": "LINKED_LABEL_REVIEW_REQUIRED",
            "leader_display_pt": [[round(p.x, 3), round(p.y, 3)] for p in leader],
            "label": label, "model_line": model_line, "model_text": model}


def request_ocr(png: bytes, url: str) -> dict:
    boundary = "----inspector" + uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"script\"\r\n\r\neslav\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"crop.png\"\r\n"
            "Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(url + "/v1/ocr", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=120) as response:
        payload = response.read(10_000_001)
    if len(payload) > 10_000_000:
        raise ValueError("OCR response too large")
    return json.loads(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--candidate-index", type=int, action="append", required=True)
    parser.add_argument("--ocr-url", type=local_url, default="http://127.0.0.1:18084")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if len(args.candidate_index) > 16 or len(args.candidate_index) != len(set(args.candidate_index)):
        parser.error("select one to sixteen distinct candidates")
    report = json.loads(args.locator_report.read_text(encoding="utf-8"))
    source = manifest_source(args.manifest, report["target_file_id"])
    library = json.loads(args.template_library.read_text(encoding="utf-8"))
    templates = [entry for entry in library.get("templates", [])
                 if entry.get("template_id") == report.get("template_id")]
    if (digest(args.template_library) != report.get("template_library_sha256")
            or library.get("schema_version") != "drawing-template-library-v1"
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or library.get("manifest_sha256") != digest(args.manifest)
            or len(templates) != 1
            or templates[0].get("source_object_id") != source["object_id"]):
        parser.error("template library or same-object provenance mismatch")
    if args.source_pdf.stat().st_size != source["size_bytes"] or digest(args.source_pdf) != source["sha256"]:
        parser.error("source PDF size or SHA-256 mismatch")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with fitz.open(args.source_pdf) as document:
        for index in args.candidate_index:
            page, panel = checked_candidate(report, source, index, document)
            clip = fitz.Rect(panel.x0 - 155, panel.y0 - 60,
                             panel.x1 + 155, panel.y1 + 60) & page.rect
            png = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=clip, alpha=False).tobytes("png")
            response = request_ocr(png, args.ocr_url)
            ocr = json.dumps(response, ensure_ascii=False, sort_keys=True).encode("utf-8")
            lines = ocr_lines(response, clip, 3)
            leaders = blue_leaders(page, panel)
            link = link_callout(leaders, lines)
            prefix = f"candidate-{index:04d}"
            (args.output_dir / f"{prefix}.png").write_bytes(png)
            (args.output_dir / f"{prefix}-ocr.json").write_bytes(ocr)
            results.append({"candidate_index": index,
                            "candidate": report["candidates"][index],
                            "crop_display_pt": [round(v, 3) for v in clip],
                            "crop_sha256": digest_bytes(png), "ocr_sha256": digest_bytes(ocr),
                            "ocr_profile_id": response["profileId"],
                            "leader_count": len(leaders), **link,
                            "room_status": "UNRESOLVED",
                            "domain_decision": "NOT_ACCEPTED_PROBE_ONLY"})
    summary = {"schema_version": "drawing-vector-callout-probe-v1",
               "status": "EXPLORATORY_ONLY", "source_file_id": source["file_id"],
               "source_pdf_sha256": source["sha256"], "manifest_sha256": digest(args.manifest),
               "locator_report_sha256": digest(args.locator_report),
               "limitation": "OCR and line geometry require human review; room and PD/RD links unresolved.",
               "results": results}
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(results), "statuses": [item["link_status"] for item in results]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
