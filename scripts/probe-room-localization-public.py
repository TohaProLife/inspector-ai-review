#!/usr/bin/env python3
"""Build room-centered crops from verified TRAIN_PUBLIC PDFs without answer locators."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image


NS = "{http://www.w3.org/1999/xhtml}"


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def locate(path: Path, page_number: int, room: str) -> dict | None:
    raw = subprocess.run(
        ["pdftotext", "-f", str(page_number), "-l", str(page_number), "-bbox", str(path), "-"],
        check=True, capture_output=True, timeout=60,
    ).stdout
    root = ET.fromstring(raw)
    page = next(root.iter(NS + "page"))
    width, height = float(page.attrib["width"]), float(page.attrib["height"])
    all_words = list(page.iter(NS + "word"))
    found = []
    for index, word in enumerate(all_words):
        if (word.text or "").strip(" ,.;:") != room:
            continue
        box = {key: float(word.attrib[key]) for key in ("xMin", "yMin", "xMax", "yMax")}
        box["text"] = word.text
        box["wordIndex"] = index
        found.append(box)
    # A number occurring only in the bottom title/table area is not a safe room locator.
    in_drawing = [box for box in found if box["yMin"] < height * 0.8]
    if not in_drawing:
        return None
    selected = min(in_drawing, key=lambda box: (box["yMin"], box["xMin"]))
    group = [selected["text"]]
    index = selected["wordIndex"]
    for direction in (-1, 1):
        neighbor_index = index + direction
        if not 0 <= neighbor_index < len(all_words):
            continue
        neighbor = all_words[neighbor_index]
        neighbor_text = neighbor.text or ""
        same_line = abs(float(neighbor.attrib["yMin"]) - selected["yMin"]) < 2
        gap = (selected["xMin"] - float(neighbor.attrib["xMax"])) if direction == -1 else (float(neighbor.attrib["xMin"]) - selected["xMax"])
        linked_by_comma = neighbor_text.endswith(",") if direction == -1 else selected["text"].endswith(",")
        if same_line and 0 <= gap < 10 and linked_by_comma and re.fullmatch(r"\d+,?", neighbor_text):
            if direction == -1:
                group.insert(0, neighbor_text)
            else:
                group.append(neighbor_text)
    return {"pageWidthPt": width, "pageHeightPt": height,
            "roomWord": selected, "roomGroupExact": " ".join(group), "allRoomWords": found,
            "selectionReason": "topmost exact room token above bottom 20 percent"}


def crop(path: Path, page_number: int, location: dict, output: Path, dpi: int, profile: str) -> dict:
    page_width, page_height = location["pageWidthPt"], location["pageHeightPt"]
    word = location["roomWord"]
    center_x = (word["xMin"] + word["xMax"]) / 2
    center_y = (word["yMin"] + word["yMax"]) / 2
    # Neither profile proves a room boundary. Focus preserves source resolution.
    if profile == "focus":
        half_width, above, below = 90, 80, 130
    else:
        half_width = 280 if page_width > page_height else 320
        above = below = 210 if page_width > page_height else 320
    left = max(0, center_x - half_width)
    top = max(0, center_y - above)
    right = min(page_width, center_x + half_width)
    bottom = min(page_height, center_y + below)
    factor = dpi / 72
    x, y = round(left * factor), round(top * factor)
    width, height = round((right - left) * factor), round((bottom - top) * factor)
    output.parent.mkdir(parents=True, exist_ok=True)
    prefix = output.with_suffix("")
    subprocess.run(
        ["pdftoppm", "-f", str(page_number), "-l", str(page_number), "-r", str(dpi),
         "-x", str(x), "-y", str(y), "-W", str(width), "-H", str(height),
         "-singlefile", "-png", str(path), str(prefix)],
        check=True, capture_output=True, timeout=120,
    )
    return {"profile": profile, "pdfBoxPt": [left, top, right, bottom], "rasterBoxPx": [x, y, x + width, y + height],
            "dpi": dpi, "sha256": digest(output), "image": str(output)}


def room_rectangle(image_path: Path, location: dict, parent_crop: dict) -> dict | None:
    """Find four dark drafting lines enclosing a room label on a focused crop."""
    with Image.open(image_path) as source:
        image = source.convert("RGB")
    width, height = image.size
    word = location["roomWord"]
    factor = parent_crop["dpi"] / 72
    crop_x, crop_y = parent_crop["rasterBoxPx"][:2]
    center_x = round((word["xMin"] + word["xMax"]) / 2 * factor - crop_x)
    center_y = round((word["yMin"] + word["yMax"]) / 2 * factor - crop_y)
    if not 15 < center_x < width - 15 or not 15 < center_y < height - 15:
        return None
    pixels = image.load()

    def black(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        return max(red, green, blue) < 105 and max(red, green, blue) - min(red, green, blue) < 25

    band_top, band_bottom = max(0, center_y - 110), min(height, center_y + 270)
    vertical = [sum(black(x, y) for y in range(band_top, band_bottom)) for x in range(width)]
    minimum_vertical = round((band_bottom - band_top) * 0.60)
    left = next((x for x in range(center_x - 15, -1, -1) if vertical[x] >= minimum_vertical), None)
    right = next((x for x in range(center_x + 15, width) if vertical[x] >= minimum_vertical), None)
    if left is None or right is None or right - left < 80:
        return None
    horizontal = [sum(black(x, y) for x in range(left + 3, right - 2)) for y in range(height)]
    # Require a near-continuous horizontal wall. Text underlines and callouts
    # can cross much of a floor-plan room without closing its boundary.
    minimum_horizontal = round((right - left - 5) * 0.85)
    top = next((y for y in range(center_y - 10, -1, -1) if horizontal[y] >= minimum_horizontal), None)
    bottom = next((y for y in range(center_y + 10, height) if horizontal[y] >= minimum_horizontal), None)
    if top is None or bottom is None or bottom - top < 120:
        return None
    # Crop one pixel inside the detected lines; neighboring equipment is excluded.
    box = [left + 2, top + 2, right - 2, bottom - 2]
    output = image_path.with_name(image_path.stem + "-room-only.png")
    room_image = image.crop(tuple(box))
    room_image.save(output)
    page_box = [
        (crop_x + box[0]) / factor, (crop_y + box[1]) / factor,
        (crop_x + box[2]) / factor, (crop_y + box[3]) / factor,
    ]
    return {"algorithm": "black-line-rectangle-v1", "parentCropSha256": parent_crop["sha256"],
            "rasterBoxInParentPx": box, "pdfBoxPt": page_box,
            "lineScores": {"left": vertical[left], "right": vertical[right],
                           "top": horizontal[top], "bottom": horizontal[bottom]},
            "colorLoopProbe": color_loop_probe(room_image),
            "sha256": digest(output), "image": str(output)}


def color_loop_probe(image: Image.Image) -> dict:
    """Count nested red/blue horizontal bands; signal is visual, not a heating verdict."""
    width, height = image.size
    pixels = image.load()
    length_gate = max(25, round(width * 0.15))
    bottom_gate = round(height * 0.85)
    bands: dict[str, list[int]] = {"red": [], "blue": []}
    last_seen = {"red": -10, "blue": -10}
    for y in range(bottom_gate):
        runs = {"red": 0, "blue": 0}
        longest = {"red": 0, "blue": 0}
        for x in range(width):
            red, green, blue = pixels[x, y]
            color = "red" if red > 150 and green < 110 and blue < 110 else (
                "blue" if blue > 150 and red < 110 and green < 150 else None)
            for name in runs:
                runs[name] = runs[name] + 1 if color == name else 0
                longest[name] = max(longest[name], runs[name])
        for name in bands:
            if longest[name] >= length_gate:
                if y - last_seen[name] > 2:
                    bands[name].append(y)
                last_seen[name] = y
    return {"algorithm": "red-blue-horizontal-bands-v1", "redBandRows": bands["red"],
            "blueBandRows": bands["blue"], "minimumRunPx": length_gate,
            "candidate": len(bands["red"]) >= 3 and len(bands["blue"]) >= 3,
            "scope": "cropped rectangle only; absence outside crop is unknown"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--public-checks", type=Path, required=True)
    parser.add_argument("--retrieval-report", type=Path, required=True)
    parser.add_argument("--case-id", action="append", required=True)
    parser.add_argument("--source", action="append", required=True, metavar="FILE_ID=PDF_PATH")
    parser.add_argument("--top-k", type=int, default=2)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--crop-profile", choices=("coarse", "focus"), default="coarse")
    parser.add_argument("--detect-room-rectangle", action="store_true")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.top_k <= 10 or not 72 <= args.dpi <= 300:
        parser.error("top-k must be 1..10 and dpi must be 72..300")
    if args.detect_room_rectangle and args.crop_profile != "focus":
        parser.error("room rectangle detection requires the focus crop profile")

    manifest = {item["file_id"]: item for item in rows(args.manifest)}
    public_cases = {item["check_id"]: item for item in rows(args.public_checks)}
    retrieval = json.loads(args.retrieval_report.read_text(encoding="utf-8"))
    if retrieval.get("schemaVersion") != "local-public-retrieval-v1":
        parser.error("retrieval report schema is invalid")
    source_paths: dict[str, Path] = {}
    for source in args.source:
        if "=" not in source:
            parser.error("--source must be FILE_ID=PDF_PATH")
        file_id, raw_path = source.split("=", 1)
        entry = manifest.get(file_id)
        path = Path(raw_path)
        if (not entry or entry.get("split") != "TRAIN_PUBLIC" or entry.get("distribution_status") != "INCLUDE"
                or not path.is_file() or path.stat().st_size != entry["size_bytes"] or digest(path) != entry["sha256"]):
            parser.error(f"source is not verified TRAIN_PUBLIC: {file_id}")
        source_paths[file_id] = path
    for source in retrieval.get("sources", []):
        file_id = source.get("fileId")
        if file_id not in source_paths or source.get("sha256") != manifest[file_id]["sha256"]:
            parser.error(f"retrieval source mismatch: {file_id}")

    report_cases = {item["caseId"]: item for item in retrieval["cases"]}
    results = []
    for case_id in args.case_id:
        case = public_cases.get(case_id)
        ranked = report_cases.get(case_id)
        if (not case or case.get("split") != "TRAIN_PUBLIC" or case.get("visibility") != "PUBLIC_TRAIN_LABEL"
                or not ranked or ranked["location"] != case["location"]):
            parser.error(f"invalid TRAIN_PUBLIC case or retrieval: {case_id}")
        room = case["location"]
        selected = []
        for stage in ("PD", "RD"):
            for rank, candidate in enumerate(ranked["stages"][stage]["topPages"][:args.top_k], 1):
                file_id, page_number = candidate["fileId"], candidate["sourcePage"]
                if (file_id not in source_paths or manifest[file_id].get("object_id") != case.get("object_id")
                        or not 1 <= page_number <= manifest[file_id]["pdf_pages"]):
                    parser.error(f"invalid candidate page: {file_id}:{page_number}")
                location = locate(source_paths[file_id], page_number, room)
                item = {"stage": stage, "rank": rank, "fileId": file_id, "sourcePage": page_number,
                        "sourceSha256": manifest[file_id]["sha256"], "room": room}
                if location is None:
                    item["status"] = "AMBIGUOUS_LOCATION"
                else:
                    output = args.output_dir / f"{case_id}-{stage}-{rank}-{file_id}-p{page_number}-room{room}.png"
                    parent_crop = crop(source_paths[file_id], page_number, location, output, args.dpi, args.crop_profile)
                    item.update({"status": "COARSE_CROP", "locator": location, "crop": parent_crop})
                    if args.detect_room_rectangle:
                        item["roomRectangle"] = room_rectangle(output, location, parent_crop)
                selected.append(item)
        results.append({"caseId": case_id, "objectId": case["object_id"],
                        "room": room, "candidates": selected})
    report = {"schemaVersion": "public-room-localization-probe-v1", "domainDecision": "NOT_ACCEPTED_PROBE_ONLY",
              "method": "exact-text-room-bbox-" + args.crop_profile + "-crop", "retrievalSha256": digest(args.retrieval_report),
              "cases": results}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / "localization.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(output), "crops": sum(item["status"] == "COARSE_CROP"
                     for case in results for item in case["candidates"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
