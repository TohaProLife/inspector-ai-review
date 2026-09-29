"""Review-only role hints from SHA-bound OCR of mixed RD/execution drawing stamps."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from .ocr_pilot import canonical_hash
from .public_ocr_cache import _load_json, public_manifest_entry
from .public_region_ocr import SCHEMA_VERSION, _request, _validate_cache


class MixedStageRegionError(ValueError):
    """A region artifact cannot support a bounded mixed-stage review hint."""


PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"


def _line_locator(index: int, line: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    return {"lineIndex": index, "rawText": line["text"], "bboxCropPx": line["bboxCropPx"],
            "score": line["score"], "ocrArtifactContentHash": artifact["contentHash"],
            "renderSha256": artifact["render"]["sha256"],
            "clipRectPdfPt": artifact["render"]["clipRectPdfPt"],
            "coordinateSystem": "CROP_TOP_LEFT_PIXELS"}


def propose_mixed_stage_region(report: dict[str, Any], manifest_row: dict[str, Any]) -> dict[str, Any]:
    source_id = manifest_row["file_id"]
    if (not isinstance(report, dict)
            or manifest_row.get("split") != "TRAIN_PUBLIC"
            or manifest_row.get("distribution_status") != "INCLUDE"
            or manifest_row.get("label_visibility") != "PUBLIC_TRAIN"
            or manifest_row.get("extension") != ".pdf"
            or manifest_row.get("stage") != "RD_ID_MIXED"
            or report.get("schemaVersion") != SCHEMA_VERSION
            or report.get("sourceFileId") != source_id
            or report.get("sourceSha256") != manifest_row["sha256"]
            or report.get("pageNumber") != 1
            or report.get("indexDisposition") not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
            or report.get("cacheStatus") not in {"HIT", "MISS_WRITTEN"}
            or report.get("interpretation") != "REVIEW_ONLY_NOT_ABSENCE_PROOF"):
        raise MixedStageRegionError("mixed-stage OCR source/scope invalid")
    artifact = report.get("artifact")
    if not isinstance(artifact, dict):
        raise MixedStageRegionError("mixed-stage OCR artifact missing")
    observed = artifact.get("request")
    if not isinstance(observed, dict):
        raise MixedStageRegionError("mixed-stage OCR request missing")
    try:
        request = _request(manifest_row, 1, tuple(report["clipNorm10000"]),
                           observed["dpi"], observed["script"], observed["providerProfileId"])
    except (KeyError, TypeError, ValueError) as error:
        raise MixedStageRegionError("mixed-stage OCR request invalid") from error
    if (observed != request or report.get("cacheKey") != canonical_hash(request)
            or report.get("artifactContentHash") != artifact.get("contentHash")):
        raise MixedStageRegionError("mixed-stage OCR provenance mismatch")
    payload = {"schemaVersion": SCHEMA_VERSION, "request": request, "artifact": artifact}
    payload["contentHash"] = canonical_hash(payload)
    try:
        _validate_cache(payload, request)
    except ValueError as error:
        raise MixedStageRegionError("mixed-stage OCR artifact invalid") from error
    if report.get("lineCount") != len(artifact["lines"]):
        raise MixedStageRegionError("mixed-stage OCR line count invalid")
    lines = artifact["lines"]
    cipher = [(index, line) for index, line in enumerate(lines)
              if "-РД-" in line["text"].upper() and line["score"] >= .8]
    stage = [(index, line) for index, line in enumerate(lines)
             if line["text"].strip().upper() == "РД" and line["score"] >= .6]
    execution = [(index, line) for index, line in enumerate(lines)
                 if line["text"].strip().upper() == "ИСПОЛНИТЕЛЬНЫЙ"
                 and line["score"] >= .9]
    evidence: list[dict[str, Any]] = []
    if len(cipher) == len(stage) == len(execution) == 1:
        stage_box = stage[0][1]["bboxCropPx"]
        execution_box = execution[0][1]["bboxCropPx"]
        if execution_box[2] < stage_box[0]:
            evidence = [
                {"roleHint": "RD_TITLE_MARK", "locators": [
                    _line_locator(*cipher[0], artifact), _line_locator(*stage[0], artifact),
                ]},
                {"roleHint": "EXECUTION_MARK", "locators": [
                    _line_locator(*execution[0], artifact),
                ]},
            ]
    return {"schemaVersion": "mixed-stage-region-proposals-v1",
            "sourceFileId": source_id, "sourceSha256": manifest_row["sha256"],
            "objectId": manifest_row["object_id"], "manifestStage": manifest_row["stage"],
            "manifestSection": manifest_row["section"], "pageNumber": 1,
            "cacheKey": report["cacheKey"], "ocrArtifactContentHash": artifact["contentHash"],
            "status": "REVIEW_ONLY_ABSTAIN", "roleHints": evidence,
            "reason": ("TWO_SPATIALLY_DISTINCT_MARKS_REQUIRE_SOURCE_REVIEW" if evidence
                       else "MIXED_MARKS_NOT_SAFELY_LOCALIZED"),
            "findingCount": None, "parameterCoverage": None}


def build_mixed_stage_region_batch(manifest_path: Path,
                                   reports: dict[str, tuple[Path, str]], *,
                                   _expected_manifest_sha256: str = PUBLIC_MANIFEST_SHA256) -> dict[str, Any]:
    if not reports or len(reports) > 32:
        raise MixedStageRegionError("mixed-stage batch size invalid")
    manifest_hash = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if manifest_hash != _expected_manifest_sha256:
        raise MixedStageRegionError("mixed-stage manifest SHA-256 differs from pinned input")
    items = []
    report_hashes = {}
    for source_id, (path, expected_sha256) in sorted(reports.items()):
        raw = path.read_bytes()
        actual = hashlib.sha256(raw).hexdigest()
        if actual != expected_sha256 or len(raw) > 16_000_000:
            raise MixedStageRegionError("mixed-stage report SHA-256 differs from pinned input")
        report = _load_json(raw)
        row = public_manifest_entry(manifest_path, source_id)
        items.append(propose_mixed_stage_region(report, row))
        report_hashes[source_id] = actual
    return {"schemaVersion": "mixed-stage-region-batch-v1",
            "disposition": "SOURCE_REVIEW_ONLY_ABSTAIN",
            "manifestSha256": manifest_hash,
            "sourceCount": len(items), "localizedSourceCount": sum(bool(item["roleHints"]) for item in items),
            "reports": report_hashes, "sources": items,
            "findingCount": None, "parameterCoverage": None}
