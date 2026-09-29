#!/usr/bin/env python3
"""Cross-check source-only PZ-002 review values against local OCR page reports.

This creates review evidence, never an inspection finding or source decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


LABEL = re.compile(r"общая\s+площадь\s+здания", re.IGNORECASE)


def _number(value: str) -> str:
    return value.replace("\u00a0", "").replace(" ", "").replace(",", ".")


def crosscheck(source: dict, report_path: Path) -> dict:
    raw = report_path.read_bytes()
    report = json.loads(raw)
    origin = report.get("source")
    if (report.get("schemaVersion") != "document-public-smoke-v1"
            or not isinstance(origin, dict)
            or origin.get("sha256") != source["sourceSha256"]
            or origin.get("page") != source["pdfPageNumber"]):
        raise ValueError("OCR report does not match reviewed source/page")
    render = report.get("render")
    if (not isinstance(render, dict) or render.get("sourcePageCount", 0) < origin["page"]
            or not re.fullmatch(r"[0-9a-f]{64}", str(render.get("sha256", "")))):
        raise ValueError("OCR render metadata invalid")
    ocr = report.get("ocr")
    if not isinstance(ocr, dict) or ocr.get("schemaVersion") != "document-ai-ocr-response-v1":
        raise ValueError("OCR response schema invalid")
    results = ocr.get("results")
    if not isinstance(results, list) or len(results) != 1:
        raise ValueError("OCR must contain one page result")
    page = results[0].get("overall_ocr_res")
    if not isinstance(page, dict):
        raise ValueError("OCR page result missing")
    lines, boxes, scores = (page.get(key) for key in ("rec_texts", "rec_boxes", "rec_scores"))
    if (not isinstance(lines, list) or not isinstance(boxes, list) or not isinstance(scores, list)
            or len(lines) != len(boxes) or len(lines) != len(scores)):
        raise ValueError("OCR line arrays invalid")
    labels = [i for i, line in enumerate(lines) if isinstance(line, str) and LABEL.search(line)]
    values = [i for i, line in enumerate(lines) if isinstance(line, str)
              and re.search(r"(?<!\d)" + re.escape(source["rawValue"]) + r"(?!\d)", line)]
    pairs = []
    for label_index in labels:
        label_box = boxes[label_index]
        if not isinstance(label_box, list) or len(label_box) != 4:
            raise ValueError("OCR label geometry invalid")
        for value_index in values:
            value_box = boxes[value_index]
            if not isinstance(value_box, list) or len(value_box) != 4:
                raise ValueError("OCR value geometry invalid")
            if label_index != value_index:
                overlap = min(label_box[3], value_box[3]) - max(label_box[1], value_box[1])
                if overlap <= 0 or value_box[0] < label_box[2]:
                    continue
            if _number(source["rawValue"]) not in _number(lines[value_index]):
                continue
            pairs.append((label_index, value_index))
    if len(pairs) != 1:
        raise ValueError(f"OCR has {len(pairs)} same-row building-area pairs")
    label_index, value_index = pairs[0]
    if any(not isinstance(scores[i], (float, int)) or not 0 <= scores[i] <= 1
           for i in {label_index, value_index}):
        raise ValueError("OCR confidence invalid")
    return {
        "sourceFileId": source["sourceFileId"],
        "sourceSha256": source["sourceSha256"],
        "pdfPageNumber": source["pdfPageNumber"],
        "reportFile": report_path.name,
        "reportSha256": hashlib.sha256(raw).hexdigest(),
        "renderSha256": render["sha256"],
        "providerProfileId": ocr.get("profileId"),
        "label": {"index": label_index, "text": lines[label_index],
                  "bboxPx": boxes[label_index], "score": scores[label_index]},
        "value": {"index": value_index, "text": lines[value_index],
                  "bboxPx": boxes[value_index], "score": scores[value_index]},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--ocr", required=True, action="append", help="FILE_ID=REPORT_JSON")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    review = json.loads(args.review.read_text(encoding="utf-8"))
    if (review.get("schemaVersion") != "pz002-public-review-packet-v1"
            or review.get("split") != "TRAIN_PUBLIC"
            or review.get("disposition") != "MEASUREMENT_PREVIEW_ONLY"):
        raise ValueError("source review packet is not eligible")
    sources = {source["sourceFileId"]: source for source in review["sources"]}
    reports: dict[str, Path] = {}
    for entry in args.ocr:
        source_id, separator, path = entry.partition("=")
        if not separator or source_id not in sources or source_id in reports or not path:
            parser.error("--ocr must be a unique reviewed FILE_ID=REPORT_JSON")
        reports[source_id] = Path(path)
    if reports.keys() != sources.keys():
        parser.error("one OCR report is required for each reviewed source")
    matches = [crosscheck(source, reports[source_id]) for source_id, source in sources.items()]
    output = {"schemaVersion": "pz002-ocr-crosscheck-v1", "disposition": "OCR_CROSSCHECK_ONLY",
              "sourceReviewRequired": True, "matches": matches}
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                           encoding="utf-8")
    print(json.dumps({"disposition": output["disposition"], "matchedSources": len(matches),
                      "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
