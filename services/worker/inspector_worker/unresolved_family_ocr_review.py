"""Versioned OCR v6 navigation leads for three unresolved review-only codes.

Input is the run's immutable source/decision/text snapshot and committed OCR
stage. OCR words are navigation clues only; no facts or coverage are emitted.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .durable_ocr_layout import (
    PROFILE_HASH_V6, PROFILE_ID_V6, PROFILE_V6, _validate_bounded_artifact,
    select_v6_pages,
)
from .ocr_pilot import validate_ocr_artifact
from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _hash, _source
from .unresolved_family_run_review import CODES, _SECTION, _line_codes


SCHEMA_VERSION = "unresolved-family-ocr-review-v1"
PROFILE_ID = SCHEMA_VERSION
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_MAX_LEADS_PER_CODE = 16
_MAX_OUTPUT_BYTES = 256 * 1024


def _json_size(value: dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("utf-8"))


def _reviewed_source(raw: dict[str, Any], decision: dict[str, Any] | None,
                     object_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("objectId") != object_id:
        raise ValueError("unresolved OCR source object scope invalid")
    section = decision.get("sectionCode") if isinstance(decision, dict) else None
    if raw.get("sectionCode") != section:
        raise ValueError("unresolved OCR source section differs from reviewed decision")
    reviewed = {
        "revisionStatus": decision.get("revisionStatus", "UNKNOWN") if decision else "UNKNOWN",
        "approvalStatus": decision.get("approvalStatus", "UNKNOWN") if decision else "UNKNOWN",
        "pageStages": decision.get("pageStages", {}) if decision else {},
    }
    if any(key in raw and raw[key] != value for key, value in reviewed.items()):
        raise ValueError("unresolved OCR source review differs from decision")
    return _source({**raw, **reviewed}, object_id)


def _validated_inputs(
    object_id: str, sources: object, decisions: object, artifacts: object,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, str],
           dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    if not isinstance(sources, list) or not isinstance(decisions, dict) or not isinstance(artifacts, list):
        raise ValueError("unresolved OCR source, decision and text inputs invalid")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _reviewed_source(raw, decisions.get(raw.get("sourceFileId")) if isinstance(raw, dict)
                                  else None, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("unresolved OCR duplicate source")
        if (type(source.get("byteSize")) is not int or source["byteSize"] < 0
                or source.get("mediaType") not in {"application/pdf", "text/plain"}):
            raise ValueError("unresolved OCR source size or media type invalid")
        source_index[source_id] = source
    if set(decisions) - set(source_index):
        raise ValueError("unresolved OCR decision for unknown source")
    text_index: dict[str, dict[str, Any]] = {}
    text_hashes: dict[str, str] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("unresolved OCR text artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in text_index:
            raise ValueError("unresolved OCR unknown or duplicate text artifact")
        source = source_index[source_id]
        if source["mediaType"] != "application/pdf":
            raise ValueError("unresolved OCR text artifact belongs to unsupported source")
        _validate_artifact(artifact, source)
        text_index[source_id] = artifact
        text_hashes[source_id] = _hash(artifact)
    if {key for key, value in source_index.items() if value["mediaType"] == "application/pdf"} != set(text_index):
        raise ValueError("unresolved OCR committed PDF text artifact missing")
    tuples = [(source_id, source["sha256"], source["byteSize"], source["mediaType"],
               source["stages"], source["sectionCode"], text_index.get(source_id, {}))
              for source_id, source in source_index.items()]
    selection = select_v6_pages(tuples, decisions)
    return source_index, text_index, text_hashes, decisions, selection


def _validated_stage(
    object_id: str, manifest_hash: str, stage: object, stage_sha256: str,
    source_index: dict[str, dict[str, Any]], text_index: dict[str, dict[str, Any]],
    selection: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if (not isinstance(stage, dict) or not isinstance(stage_sha256, str)
            or _SHA.fullmatch(stage_sha256) is None or _hash(stage) != stage_sha256):
        raise ValueError("unresolved OCR committed stage SHA mismatch")
    analysis = stage.get("analysis")
    if (stage.get("schemaVersion") != "analysis-stage-result-v2"
            or stage.get("jobType") != "DOCUMENT_OCR_LAYOUT"
            or stage.get("inputManifestHash") != manifest_hash
            or stage.get("disposition") != "OCR_LAYOUT_BOUNDED"
            or stage.get("reasonCode") != "BOUNDED_OCR_ONLY"
            or stage.get("providerKind") != "OCR_LAYOUT"
            or stage.get("providerProfileId") != PROFILE_ID_V6
            or stage.get("providerConfigHash") != PROFILE_HASH_V6
            or not isinstance(analysis, dict)
            or analysis.get("schemaVersion") != "bounded-ocr-layout-analysis-v6"
            or analysis.get("objectId") != object_id
            or analysis.get("inputManifestHash") != manifest_hash
            or analysis.get("profile") != PROFILE_V6
            or not isinstance(analysis.get("sources"), list)
            or type(analysis.get("sourceCount")) is not int
            or analysis["sourceCount"] != len(source_index)
            or type(stage.get("outputCount")) is not int):
        raise ValueError("unresolved OCR stage identity or v6 profile invalid")
    rows: dict[str, dict[str, Any]] = {}
    totals = {"ocrRequiredPageCount": 0, "processedPageCount": 0,
              "deferredPageCount": 0, "skippedOversizePageCount": 0,
              "skippedUnsupportedSourceCount": 0, "skippedRenderPixelPageCount": 0,
              "reviewEligiblePageCount": 0, "stageUnresolvedPageCount": 0}
    for row in analysis["sources"]:
        if not isinstance(row, dict) or not isinstance(row.get("sourceFileId"), str):
            raise ValueError("unresolved OCR source row invalid")
        source_id = row["sourceFileId"]
        if source_id not in source_index or source_id in rows:
            raise ValueError("unresolved OCR source row missing or duplicated")
        source = source_index[source_id]
        selected = selection[source_id]
        text = text_index.get(source_id)
        required = (sum(page["quality"]["disposition"] == "OCR_REQUIRED"
                        for page in text["pages"]) if text else 0)
        pages = row.get("pages")
        if (row.get("sourceSha256") != source["sha256"]
                or row.get("mediaType") != source["mediaType"]
                or row.get("pageCount") != (text["pageCount"] if text else None)
                or not isinstance(pages, list)
                or any(type(row.get(key)) is not int for key in (
                    "ocrRequiredPageCount", "processedPageCount", "deferredPageCount",
                    "reviewEligiblePageCount", "stageUnresolvedPageCount",
                    "skippedRenderPixelPageCount"))
                or row.get("ocrRequiredPageCount") != required
                or row.get("processedPageCount") != len(pages)
                or row.get("deferredPageCount") != required - len(pages)
                or row.get("reviewEligiblePageCount") != selected["reviewEligiblePageCount"]
                or row.get("stageUnresolvedPageCount") != selected["stageUnresolvedPageCount"]
                or row.get("skippedRenderPixelPageCount") != selected["rasterSkipped"]
                or row.get("selectionReasonCodes") != selected["selectionReasonCodes"]
                or [page.get("pageNumber") if isinstance(page, dict) else None for page in pages]
                   != selected["selected"]):
            raise ValueError("unresolved OCR source row differs from v6 selection")
        expected_status = (
            "SKIPPED_UNSUPPORTED_FORMAT" if text is None
            else "SKIPPED_SOURCE_TOO_LARGE" if source["byteSize"] > PROFILE_V6["maxSourceBytes"]
            else "NO_OCR_REQUIRED_PAGES" if not required
            else "SCANNED" if len(pages) == required
            else "SKIPPED_SOURCE_REVIEW_REQUIRED"
            if "SOURCE_REVIEW_REQUIRED" in selected["selectionReasonCodes"]
            else "SKIPPED_SOURCE_NOT_CURRENT_APPROVED"
            if "SOURCE_REVIEW_NOT_CURRENT_APPROVED" in selected["selectionReasonCodes"]
            else "SKIPPED_SECTION_NOT_AR_VK"
            if "SECTION_NOT_AR_VK" in selected["selectionReasonCodes"]
            else "SKIPPED_PAGE_STAGE_UNRESOLVED"
            if not selected["reviewEligiblePageCount"] and selected["stageUnresolvedPageCount"]
            else "SKIPPED_RENDER_PIXEL_LIMIT"
            if not pages and selected["rasterSkipped"] == selected["reviewEligiblePageCount"]
               and selected["reviewEligiblePageCount"] > 0
            else "PARTIALLY_SCANNED"
        )
        if row.get("status") != expected_status:
            raise ValueError("unresolved OCR source status differs from v6 selection")
        if text is None:
            totals["skippedUnsupportedSourceCount"] += 1
        else:
            by_page = {page["pageNumber"]: page for page in text["pages"]}
            for page in pages:
                number = page["pageNumber"]
                validate_ocr_artifact(page, source_id=source_id,
                                      source_hash=source["sha256"], page_number=number)
                if (page["render"]["dpi"] != PROFILE_V6["dpi"]
                        or page["provider"]["script"] != PROFILE_V6["script"]):
                    raise ValueError("unresolved OCR page render/provider request changed")
                _validate_bounded_artifact(page, by_page[number], PROFILE_V6)
                if any("\n" in line["text"] or "\r" in line["text"] for line in page["lines"]):
                    raise ValueError("unresolved OCR line contains multiple lines")
            if source["byteSize"] > PROFILE_V6["maxSourceBytes"]:
                totals["skippedOversizePageCount"] += required
        totals["ocrRequiredPageCount"] += required
        totals["processedPageCount"] += len(pages)
        totals["deferredPageCount"] += required - len(pages)
        totals["skippedRenderPixelPageCount"] += selected["rasterSkipped"]
        totals["reviewEligiblePageCount"] += selected["reviewEligiblePageCount"]
        totals["stageUnresolvedPageCount"] += selected["stageUnresolvedPageCount"]
        rows[source_id] = row
    if (set(rows) != set(source_index)
            or analysis.get("processedPageCount") != stage.get("outputCount")
            or any(type(analysis.get(key)) is not int for key in totals)
            or any(analysis.get(key) != value for key, value in totals.items())
            or totals["processedPageCount"] > PROFILE_V6["maxPagesPerRun"]):
        raise ValueError("unresolved OCR stage aggregate counts invalid")
    return rows


def evaluate_unresolved_family_ocr_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    source_decisions: dict[str, Any], text_artifacts: list[dict[str, Any]],
    ocr_stage: dict[str, Any], *, stage_sha256: str,
) -> dict[str, Any]:
    """Return bounded same-line OCR leads after independent v6 provenance checks."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("unresolved OCR objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("unresolved OCR inputManifestHash invalid")
    source_index, text_index, text_hashes, _, selection = _validated_inputs(
        object_id, sources, source_decisions, text_artifacts)
    rows = _validated_stage(object_id, input_manifest_hash, ocr_stage, stage_sha256,
                            source_index, text_index, selection)
    code_rows = []
    for code in CODES:
        reasons = {"LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"}
        leads = []
        eligible = False
        for source_id in sorted(source_index):
            source = source_index[source_id]
            if source["sectionCode"] is None:
                reasons.add("SOURCE_REVIEW_REQUIRED")
                reasons.update(selection[source_id]["selectionReasonCodes"])
                if rows[source_id]["deferredPageCount"]:
                    reasons.add("OCR_PAGES_DEFERRED")
                continue
            if source["sectionCode"] != _SECTION[code]:
                continue
            selected = selection[source_id]
            reasons.update(selected["selectionReasonCodes"])
            if selected["reviewEligiblePageCount"]:
                eligible = True
            if rows[source_id]["deferredPageCount"]:
                reasons.add("OCR_PAGES_DEFERRED")
            if source_id not in text_index:
                continue
            page_stages = source.get("pageStages", {})
            for page in rows[source_id]["pages"]:
                number = page["pageNumber"]
                stage = page_stages.get(str(number), source["stages"][0]
                                        if len(source["stages"]) == 1 else None)
                if stage not in {"PD", "RD"}:
                    raise ValueError("unresolved OCR selected page stage unresolved")
                render, provider = page["render"], page["provider"]
                for line_index, line in enumerate(page["lines"]):
                    if code not in _line_codes(line["text"]):
                        continue
                    lead = {
                        "sourceFileId": source_id, "sourceSha256": source["sha256"],
                        "textArtifactSha256": text_hashes[source_id],
                        "ocrStageSha256": stage_sha256, "ocrPageSha256": page["contentHash"],
                        "pageNumber": number, "stage": stage,
                        "sectionCode": source["sectionCode"],
                        "coordinateSystem": "IMAGE_TOP_LEFT_PIXELS",
                        "lineIndex": line_index, "lineText": line["text"],
                        "score": line["score"], "bboxPx": line["bboxPx"],
                        "renderSha256": render["sha256"],
                        "rendererProfileId": render["rendererProfileId"],
                        "providerProfileId": provider["profileId"],
                        "providerScript": provider["script"],
                        "dpi": render["dpi"], "widthPx": render["widthPx"],
                        "heightPx": render["heightPx"],
                    }
                    lead["leadSha256"] = _hash(lead)
                    leads.append(lead)
        leads.sort(key=lambda lead: (lead["sourceFileId"], lead["pageNumber"],
                                     lead["lineIndex"], lead["lineText"]))
        if len(leads) > _MAX_LEADS_PER_CODE:
            reasons.add("LEAD_LIMIT_REACHED")
            leads = leads[:_MAX_LEADS_PER_CODE]
        if not eligible:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if not leads:
            reasons.add("NO_EXACT_LINE_LEAD")
        code_rows.append({"parameterCode": code, "status": "ABSTAIN",
                          "reasonCodes": sorted(reasons), "leads": leads})
    result = {
        "schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
        "purpose": "REVIEW_ONLY", "objectId": object_id,
        "inputManifestHash": input_manifest_hash, "ocrStageSha256": stage_sha256,
        "sourceStageArtifacts": [
            {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
             "textArtifactSha256": text_hashes[source_id]}
            for source_id in sorted(text_index)],
        "codeRows": code_rows, "findingCount": None, "parameterCoverage": None,
    }
    result["contentHash"] = _hash(result)
    while _json_size(result) > _MAX_OUTPUT_BYTES:
        row = next((item for item in reversed(code_rows) if item["leads"]), None)
        if row is None:
            raise ValueError("unresolved OCR metadata exceeds 256 KiB")
        row["leads"].pop()
        row["reasonCodes"] = sorted(set(row["reasonCodes"]) | {"OCR_BYTE_BUDGET_REACHED"})
        result["contentHash"] = _hash({key: value for key, value in result.items()
                                        if key != "contentHash"})
    return result
