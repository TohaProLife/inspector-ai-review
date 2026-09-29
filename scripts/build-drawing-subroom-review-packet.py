#!/usr/bin/env python3
"""Copy SHA-verified TRAIN_PUBLIC subroom proposal crops into a review packet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import runpy


HERE = Path(__file__).resolve().parent
ROOM = runpy.run_path(str(HERE / "probe-drawing-room-link-public.py"))


def checked_entries(report: dict, circle_report: dict, callouts: list[tuple[Path, dict]],
                    source: dict) -> list[tuple[dict, Path]]:
    if (report.get("schema_version") != "drawing-subroom-link-public-probe-v1"
            or report.get("status") != "EXPLORATORY_ONLY"
            or report.get("source_file_id") != source["file_id"]
            or report.get("source_pdf_sha256") != source["sha256"]
            or circle_report.get("schema_version") != "drawing-red-circle-ocr-public-v1"
            or circle_report.get("number_kind") != "decimal"
            or circle_report.get("source_pdf_sha256") != source["sha256"]):
        raise ValueError("subroom or red circle report provenance mismatch")
    by_index = {}
    for directory, batch in callouts:
        if (batch.get("schema_version") != "drawing-vector-callout-probe-v1"
                or batch.get("source_pdf_sha256") != source["sha256"]):
            raise ValueError("callout report provenance mismatch")
        for row in batch.get("results", []):
            index = row.get("candidate_index")
            if type(index) is not int or index in by_index:
                raise ValueError("duplicate or invalid callout candidate")
            by_index[index] = (directory, row)
    if len(by_index) != len(report.get("results", [])):
        raise ValueError("callout and subroom result sets differ")
    allowed = {row["proposed_label"]["number"] for row in circle_report.get("results", [])
               if row.get("label_status") == "RED_SUBROOM_LABEL_REVIEW_REQUIRED"}
    selected = []
    seen = set()
    for row in report["results"]:
        index = row.get("candidate_index")
        if type(index) is not int or index in seen or index not in by_index:
            raise ValueError("duplicate or missing subroom candidate")
        seen.add(index)
        directory, callout = by_index[index]
        if (row.get("candidate") != callout.get("candidate")
                or row.get("domain_decision") != "NOT_ACCEPTED_PROBE_ONLY"):
            raise ValueError("subroom and callout candidate mismatch")
        if row.get("subroom_status") != "SUBROOM_CANDIDATE_REVIEW_REQUIRED":
            continue
        proposed = row.get("proposed_subroom", {})
        if (callout.get("link_status") != "LINKED_LABEL_REVIEW_REQUIRED"
                or proposed.get("number") not in allowed
                or proposed.get("wall_mask_hits") != 0):
            raise ValueError("unlinked or unverified subroom proposal")
        crop = directory / f"candidate-{index:04d}.png"
        if ROOM["digest"](crop) != callout.get("crop_sha256"):
            raise ValueError("callout crop SHA-256 mismatch")
        selected.append((row, crop))
    return selected


def build(manifest: Path, source_pdf: Path, subroom_report: Path, red_circle_report: Path,
          callout_paths: list[Path], output_dir: Path) -> dict:
    digest = ROOM["digest"]
    report = json.loads(subroom_report.read_text(encoding="utf-8"))
    source = ROOM["manifest_source"](manifest, report["source_file_id"])
    circle_report = json.loads(red_circle_report.read_text(encoding="utf-8"))
    if (source_pdf.stat().st_size != source["size_bytes"]
            or digest(source_pdf) != source["sha256"]
            or report.get("manifest_sha256") != digest(manifest)
            or report.get("red_circle_report_sha256") != digest(red_circle_report)
            or report.get("callout_report_sha256") != [digest(path) for path in callout_paths]):
        raise ValueError("manifest, PDF or input report SHA-256 mismatch")
    callouts = [(path.parent, json.loads(path.read_text(encoding="utf-8")))
                for path in callout_paths]
    selected = checked_entries(report, circle_report, callouts, source)
    output_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for row, crop in selected:
        name = crop.name
        target = output_dir / name
        target.write_bytes(crop.read_bytes())
        entries.append({"candidate_index": row["candidate_index"],
                        "page_number": row["candidate"]["page_number"],
                        "proposed_subroom": row["proposed_subroom"]["number"],
                        "image": name, "sha256": digest(target),
                        "review_status": "UNREVIEWED"})
    packet = {"schema_version": "drawing-subroom-review-packet-v1",
              "status": "REVIEW_PENDING", "source_file_id": source["file_id"],
              "source_pdf_sha256": source["sha256"],
              "manifest_sha256": digest(manifest),
              "subroom_report_sha256": digest(subroom_report),
              "red_circle_report_sha256": digest(red_circle_report),
              "callout_report_sha256": [digest(path) for path in callout_paths],
              "entries": entries}
    (output_dir / "review-index.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return packet


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--subroom-report", type=Path, required=True)
    parser.add_argument("--red-circle-report", type=Path, required=True)
    parser.add_argument("--callout-report", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    packet = build(args.manifest, args.source_pdf, args.subroom_report,
                   args.red_circle_report, args.callout_report, args.output_dir)
    print(json.dumps({"proposals": len(packet["entries"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
