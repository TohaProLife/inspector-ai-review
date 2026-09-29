#!/usr/bin/env python3
"""Reproduce the fact-family pilot on verified TRAIN_PUBLIC PDFs only."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.fact_family_pipeline import evaluate_fact_family_bundle  # noqa: E402
from inspector_worker.parameter_routing import _validate_artifact  # noqa: E402
from inspector_worker.text_layer import extract_pdf_text_artifact  # noqa: E402


MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", action="append", required=True, metavar="FILE_ID=PATH")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-text-artifacts", action="store_true",
                        help="reuse locally cached text artifacts after manifest and schema checks")
    args = parser.parse_args()
    catalog = {row["file_id"]: row for row in
               (json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines())}
    selected: list[tuple[dict, Path]] = []
    for entry in args.pdf:
        file_id, separator, raw_path = entry.partition("=")
        if not separator or file_id not in catalog or not raw_path:
            parser.error("--pdf must be a known FILE_ID=PATH")
        row = catalog[file_id]
        if (row.get("split") != "TRAIN_PUBLIC" or row.get("distribution_status") != "INCLUDE"
                or row.get("label_visibility") != "PUBLIC_TRAIN" or row.get("extension") != ".pdf"):
            parser.error(f"{file_id} is not an included TRAIN_PUBLIC PDF")
        path = Path(raw_path).resolve()
        if not path.is_file() or path.stat().st_size != row["size_bytes"]:
            parser.error(f"{file_id} is missing or its byte size differs from the manifest")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            parser.error(f"{file_id} SHA-256 differs from the manifest")
        if any(prior["file_id"] == file_id for prior, _ in selected):
            parser.error(f"{file_id} is duplicated")
        selected.append((row, path))
    objects = {row["object_id"] for row, _ in selected}
    if len(objects) != 1:
        parser.error("all PDFs must belong to one object")
    selected.sort(key=lambda pair: pair[0]["file_id"])
    args.output.mkdir(parents=True, exist_ok=True)
    sources = []
    artifacts = []
    for row, path in selected:
        sources.append({
            "sourceFileId": row["file_id"], "objectId": row["object_id"],
            "sha256": row["sha256"], "stages": [row["stage"]],
            "sectionCode": row["section"], "revisionStatus": "UNKNOWN",
            "approvalStatus": "UNKNOWN", "linkGroupId": None, "pageStages": {},
        })
        artifact_path = args.output / f"text-{row['file_id']}.json"
        if args.reuse_text_artifacts and artifact_path.is_file():
            text_artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        else:
            text_artifact = extract_pdf_text_artifact(path, row["file_id"], row["sha256"])
            artifact_path.write_text(json.dumps(text_artifact, ensure_ascii=False,
                                                separators=(",", ":")), encoding="utf-8")
        _validate_artifact(text_artifact, sources[-1])
        artifacts.append(text_artifact)
    manifest_payload = [{"fileId": row["file_id"], "sha256": row["sha256"]}
                        for row, _ in selected]
    manifest_hash = hashlib.sha256(json.dumps(manifest_payload, sort_keys=True,
                                              separators=(",", ":")).encode()).hexdigest()
    result = evaluate_fact_family_bundle(next(iter(objects)), manifest_hash, sources, artifacts)
    (args.output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                                             encoding="utf-8")
    by_code_stage = Counter((fact["parameterCode"], fact["stage"]) for fact in result["facts"])
    report = {
        "schemaVersion": "fact-family-public-smoke-v1",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "textArtifactMode": "REUSE_LOCAL" if args.reuse_text_artifacts else "EXTRACT_FROM_PDF",
        "objectId": next(iter(objects)),
        "sourceChecks": [{"fileId": row["file_id"], "sha256": row["sha256"],
                          "stage": row["stage"], "section": row["section"],
                          "pageCount": artifact["pageCount"],
                          "ocrRequiredPageCount": artifact["qualitySummary"]["ocrRequiredPageCount"]}
                         for (row, _), artifact in zip(selected, artifacts)],
        "factCount": len(result["facts"]),
        "factsByCodeAndStage": [{"parameterCode": code, "stage": stage, "count": count}
                                for (code, stage), count in sorted(by_code_stage.items())],
        "comparisonStatus": [{"parameterCode": item["parameterCode"], "status": item["status"],
                              "reasonCodes": item["reasonCodes"]} for item in result["comparisons"]],
        "findingCount": result["findingCount"], "resultContentHash": result["contentHash"],
    }
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                             encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
