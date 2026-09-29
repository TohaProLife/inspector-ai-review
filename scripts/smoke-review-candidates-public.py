#!/usr/bin/env python3
"""Reproduce review candidates from original, SHA-verified TRAIN_PUBLIC PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.parameter_routing import _validate_artifact  # noqa: E402
from inspector_worker.review_candidates import evaluate_review_candidates  # noqa: E402
from inspector_worker.run_candidate_family_preview import _hash  # noqa: E402
from inspector_worker.text_layer import extract_pdf_text_artifact  # noqa: E402

MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", action="append", required=True, metavar="FILE_ID=PATH")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reuse-text-artifacts", action="store_true")
    args = parser.parse_args()
    catalog = {row["file_id"]: row for row in
               (json.loads(line) for line in MANIFEST.read_text().splitlines())}
    selected = []
    for binding in args.pdf:
        file_id, separator, raw_path = binding.partition("=")
        if not separator or file_id not in catalog:
            parser.error("unknown FILE_ID=PATH binding")
        row = catalog[file_id]
        if (row.get("split"), row.get("distribution_status"),
                row.get("label_visibility"), row.get("extension")) != (
                    "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", ".pdf"):
            parser.error(f"source is outside allowed public scope: {file_id}")
        path = Path(raw_path).resolve()
        if not path.is_file() or path.stat().st_size != row["size_bytes"]:
            parser.error(f"source size mismatch: {file_id}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            parser.error(f"source SHA mismatch: {file_id}")
        if any(previous["file_id"] == file_id for previous, _ in selected):
            parser.error(f"duplicate source: {file_id}")
        selected.append((row, path))
    if len({row["object_id"] for row, _ in selected}) != 1:
        parser.error("all files must belong to one public object")
    selected.sort(key=lambda item: item[0]["file_id"])
    args.output.mkdir(parents=True, exist_ok=True)
    sources, artifacts = [], []
    for row, path in selected:
        source = {"sourceFileId": row["file_id"], "objectId": row["object_id"],
                  "sha256": row["sha256"],
                  "stages": ["RD", "ID"] if row["stage"] == "RD_ID_MIXED" else [row["stage"]],
                  "sectionCode": None, "revisionStatus": "UNKNOWN",
                  "approvalStatus": "UNKNOWN", "linkGroupId": None, "pageStages": {}}
        sources.append(source)
        cached = args.output / f"text-{row['file_id']}.json"
        if args.reuse_text_artifacts and cached.is_file():
            artifact = json.loads(cached.read_text())
        else:
            artifact = extract_pdf_text_artifact(path, row["file_id"], row["sha256"])
            cached.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")))
        _validate_artifact(artifact, source)
        artifacts.append(artifact)
    manifest_hash = hashlib.sha256(json.dumps([
        {"fileId": row["file_id"], "sha256": row["sha256"]} for row, _ in selected],
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    result = evaluate_review_candidates(selected[0][0]["object_id"], manifest_hash,
                                        sources, artifacts)
    (args.output / "review-candidates.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    verification_input = {
        "objectId": result["objectId"],
        "inputManifestHash": manifest_hash,
        "sourceFiles": [{"sourceFileId": source["sourceFileId"],
                         "objectId": source["objectId"], "sha256": source["sha256"],
                         "stages": source["stages"], "sectionCode": None,
                         "sourceReviewHash": None} for source in sources],
        "sourceReviews": {},
        "textArtifacts": {artifact["sourceFileId"]: {
            "content_json": artifact, "content_hash": _hash(artifact),
        } for artifact in artifacts},
        "result": result,
    }
    (args.output / "verification-input.json").write_text(
        json.dumps(verification_input, ensure_ascii=False, separators=(",", ":")))
    report = {"scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
              "objectId": selected[0][0]["object_id"],
              "originals": [{"fileId": row["file_id"], "sha256": row["sha256"],
                             "pageCount": artifact["pageCount"]}
                            for (row, _), artifact in zip(selected, artifacts)],
              "candidateCount": result["candidateCount"], "truncated": result["truncated"],
              "candidateCodes": sorted({item["parameterCode"] for item in result["candidates"]}),
              "candidateKinds": {kind: sum(item["kind"] == kind for item in result["candidates"])
                                 for kind in ("ONE_DOCUMENT_SIGNAL", "POSSIBLE_PAIR", "POSSIBLE_DIFFERENCE")},
              "officialEvaluation": "NOT_RUN",
              "artifactContentHash": result["contentHash"]}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
