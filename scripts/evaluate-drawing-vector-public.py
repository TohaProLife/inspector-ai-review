#!/usr/bin/env python3
"""Evaluate vector proposals only against full-sheet, human-approved TRAIN_PUBLIC reviews.

Partial symbol labels and unreviewed proposal packets cannot establish recall or
precision. This command fails closed with NOT_ESTIMABLE until every selected page
has an independent, complete review for the requested class.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise ValueError(f"blank JSONL row at {path}:{number}")
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"JSONL row must be an object at {path}:{number}")
        rows.append(row)
    return rows


def box(value: object, label: str) -> tuple[float, float, float, float]:
    if (not isinstance(value, list) or len(value) != 4
            or any(type(item) not in {int, float} for item in value)):
        raise ValueError(f"{label} bbox must have four finite numbers")
    from math import isfinite
    coordinates = tuple(float(item) for item in value)
    if not all(isfinite(item) for item in coordinates) or not (
            coordinates[0] >= 0 and coordinates[1] >= 0
            and coordinates[0] < coordinates[2] and coordinates[1] < coordinates[3]):
        raise ValueError(f"{label} bbox is invalid")
    return coordinates  # type: ignore[return-value]


def iou(left: tuple[float, float, float, float],
        right: tuple[float, float, float, float]) -> float:
    width = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    height = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    intersection = width * height
    left_area = (left[2] - left[0]) * (left[3] - left[1])
    right_area = (right[2] - right[0]) * (right[3] - right[1])
    return intersection / (left_area + right_area - intersection)


def one_to_one_matches(proposals: list[tuple[float, float, float, float]],
                       truth: list[tuple[float, float, float, float]],
                       minimum_iou: float) -> list[tuple[int, int, float]]:
    # An augmenting path maximizes the number of matched instances. A greedy
    # highest-IoU pairing can strand a second proposal that has only one match.
    edges = []
    overlaps: dict[tuple[int, int], float] = {}
    for pi, proposal in enumerate(proposals):
        matches = []
        for ti, target in enumerate(truth):
            overlap = iou(proposal, target)
            if overlap >= minimum_iou:
                matches.append((ti, overlap))
                overlaps[(pi, ti)] = overlap
        edges.append([ti for ti, _ in sorted(matches, key=lambda item: (-item[1], item[0]))])
    assigned_truth: dict[int, int] = {}

    def assign(pi: int, seen: set[int]) -> bool:
        for ti in edges[pi]:
            if ti in seen:
                continue
            seen.add(ti)
            previous = assigned_truth.get(ti)
            if previous is None or assign(previous, seen):
                assigned_truth[ti] = pi
                return True
        return False

    for pi in range(len(proposals)):
        assign(pi, set())
    return sorted((pi, ti, round(overlaps[(pi, ti)], 6))
                  for ti, pi in assigned_truth.items())


def evaluate(manifest: list[dict[str, Any]], locator: dict[str, Any],
             reviews: list[dict[str, Any]], source_pdf: Path,
             pages: list[int], minimum_iou: float,
             library: dict[str, Any], library_sha256: str,
             manifest_sha256: str, locator_sha256: str) -> dict[str, Any]:
    target_id = locator.get("target_file_id")
    entries = [row for row in manifest if row.get("file_id") == target_id]
    if len(entries) != 1:
        raise ValueError("target file must occur exactly once in manifest")
    target = entries[0]
    if target.get("split") != "TRAIN_PUBLIC" or target.get("distribution_status") != "INCLUDE":
        raise ValueError("only included TRAIN_PUBLIC sources are allowed")
    if (source_pdf.stat().st_size != target.get("size_bytes")
            or digest(source_pdf) != target.get("sha256")):
        raise ValueError("source PDF size or SHA-256 mismatch")
    if (library.get("schema_version") != "drawing-template-library-v1"
            or library.get("release_status") != "EXPERIMENTAL_REVIEW_REQUIRED"
            or library.get("manifest_sha256") != manifest_sha256
            or locator.get("template_library_sha256") != library_sha256):
        raise ValueError("template library provenance is invalid")
    if not isinstance(library.get("templates"), list):
        raise ValueError("template library has no templates array")
    templates = [entry for entry in library["templates"]
                 if isinstance(entry, dict) and entry.get("template_id") == locator.get("template_id")]
    if len(templates) != 1 or templates[0].get("class_id") != "RADIATOR":
        raise ValueError("locator template is not a unique RADIATOR template")
    template = templates[0]
    source_entries = [row for row in manifest if row.get("file_id") == template.get("source_file_id")]
    if (len(source_entries) != 1 or source_entries[0].get("split") != "TRAIN_PUBLIC"
            or source_entries[0].get("distribution_status") != "INCLUDE"
            or source_entries[0].get("sha256") != template.get("source_pdf_sha256")
            or source_entries[0].get("object_id") != template.get("source_object_id")):
        raise ValueError("template source is not an included TRAIN_PUBLIC file")
    if (locator.get("schema_version") != "drawing-vector-public-locator-v1"
            or locator.get("status") != "EXPLORATORY_ONLY"
            or locator.get("target_pdf_sha256") != target["sha256"]
            or locator.get("target_object_id") != target["object_id"]
            or locator.get("source_object_id") != template["source_object_id"]
            or type(locator.get("cross_object_eval")) is not bool
            or not isinstance(locator.get("target_pages"), list)
            or not isinstance(locator.get("candidates"), list)
            or locator.get("candidate_count") != len(locator["candidates"])):
        raise ValueError("locator report provenance or counts are invalid")
    locator_pages = locator["target_pages"]
    if (any(type(page) is not int or page < 1 or page > target["pdf_pages"] for page in locator_pages)
            or len(set(locator_pages)) != len(locator_pages)
            or not pages or any(type(page) is not int for page in pages)
            or len(set(pages)) != len(pages)
            or not set(pages).issubset(locator_pages)):
        raise ValueError("selected pages must be unique pages from the locator report")
    if ((locator.get("source_object_id") == target["object_id"])
            == locator.get("cross_object_eval")):
        raise ValueError("locator cross-object flag is inconsistent")

    proposals_by_page: dict[int, list[tuple[float, float, float, float]]] = {page: [] for page in pages}
    for index, candidate in enumerate(locator["candidates"]):
        if (not isinstance(candidate, dict) or candidate.get("file_id") != target_id
                or candidate.get("source_sha256") != target["sha256"]
                or candidate.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
                or candidate.get("method") != "red_vector_panel_with_blue_contact_v1"
                or candidate.get("template_id") != locator.get("template_id")
                or candidate.get("page_number") not in locator_pages):
            raise ValueError(f"invalid locator candidate {index}")
        candidate_box = box(candidate.get("bbox_display_pt"), f"candidate {index}")
        if candidate["page_number"] in proposals_by_page:
            proposals_by_page[candidate["page_number"]].append(candidate_box)

    reviews_by_page: dict[int, dict[str, Any]] = {}
    for row in reviews:
        if row.get("schema_version") != "drawing-sheet-review-v1":
            raise ValueError("review schema_version is invalid")
        if (row.get("file_id") != target_id or row.get("source_sha256") != target["sha256"]
                or row.get("object_id") != target["object_id"]
                or row.get("class_id") != "RADIATOR"):
            raise ValueError("review source or class does not match target")
        page = row.get("page_number")
        if type(page) is not int or page not in pages or page in reviews_by_page:
            raise ValueError("review page is outside selected set or duplicated")
        if row.get("locator_report_sha256") not in {None, locator_sha256}:
            raise ValueError("review locator report SHA-256 mismatch")
        reviews_by_page[page] = row

    missing = []
    for page in pages:
        row = reviews_by_page.get(page)
        if (row is None or row.get("review_status") != "HUMAN_APPROVED"
                or row.get("coverage") != "FULL_SHEET"
                or row.get("locator_report_sha256") != locator_sha256
                or not isinstance(row.get("reviewer_id"), str)
                or not row["reviewer_id"].strip()):
            missing.append(page)
    common = {
        "schema_version": "drawing-vector-evaluation-v1",
        "file_id": target_id,
        "source_sha256": target["sha256"],
        "object_id": target["object_id"],
        "scope": "CROSS_OBJECT" if locator["cross_object_eval"] else "SAME_OBJECT_DEVELOPMENT",
        "selected_pages": pages,
        "proposal_count": sum(len(items) for items in proposals_by_page.values()),
        "minimum_iou": minimum_iou,
        "template_library_sha256": library_sha256,
        "locator_report_sha256": locator_sha256,
        "release_gate": "NOT_ASSESSED",
    }
    if missing:
        return {**common, "status": "NOT_ESTIMABLE", "reason_code": "FULL_SHEET_HUMAN_REVIEW_MISSING",
                "unreviewed_pages": missing, "metrics": None}

    page_results = []
    total_tp = total_fp = total_fn = 0
    for page in pages:
        row = reviews_by_page[page]
        instances = row.get("instances")
        if not isinstance(instances, list):
            raise ValueError(f"review page {page} needs instances array; [] means reviewed absence")
        ids: set[str] = set()
        truth = []
        for instance in instances:
            if (not isinstance(instance, dict) or not isinstance(instance.get("instance_id"), str)
                    or not instance["instance_id"].strip() or instance["instance_id"] in ids):
                raise ValueError(f"review page {page} has invalid or duplicate instance_id")
            ids.add(instance["instance_id"])
            truth.append(box(instance.get("bbox_display_pt"), f"review instance {instance['instance_id']}"))
        proposals = proposals_by_page[page]
        matches = one_to_one_matches(proposals, truth, minimum_iou)
        tp, fp, fn = len(matches), len(proposals) - len(matches), len(truth) - len(matches)
        total_tp += tp
        total_fp += fp
        total_fn += fn
        page_results.append({"page_number": page, "proposal_count": len(proposals),
                             "verified_instance_count": len(truth), "true_positive": tp,
                             "false_positive": fp, "false_negative": fn,
                             "matches": [{"proposal_index": pi, "instance_id": instances[ti]["instance_id"],
                                          "iou": overlap} for pi, ti, overlap in matches]})
    return {**common, "status": "MEASURED", "unreviewed_pages": [],
            "metrics": {"true_positive": total_tp, "false_positive": total_fp,
                        "false_negative": total_fn,
                        "precision": total_tp / (total_tp + total_fp) if total_tp + total_fp else None,
                        "recall": total_tp / (total_tp + total_fn) if total_tp + total_fn else None},
            "pages": page_results}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--locator-report", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--reviews", type=Path, required=True)
    parser.add_argument("--template-library", type=Path, required=True)
    parser.add_argument("--page", type=int, action="append", required=True)
    parser.add_argument("--minimum-iou", type=float, default=0.5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 0 < args.minimum_iou <= 1:
        parser.error("minimum IoU must be in (0, 1]")
    manifest_sha256 = digest(args.manifest)
    library_sha256 = digest(args.template_library)
    locator_sha256 = digest(args.locator_report)
    report = evaluate(jsonl(args.manifest), json.loads(args.locator_report.read_text(encoding="utf-8")),
                      jsonl(args.reviews), args.source_pdf, args.page, args.minimum_iou,
                      json.loads(args.template_library.read_text(encoding="utf-8")),
                      library_sha256, manifest_sha256, locator_sha256)
    report["manifest_sha256"] = manifest_sha256
    report["reviews_sha256"] = digest(args.reviews)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "pages": report["selected_pages"],
                      "proposals": report["proposal_count"]}))


if __name__ == "__main__":
    main()
