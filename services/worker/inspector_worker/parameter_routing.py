"""Conservative, deterministic page routing for one atomic parameter rule.

This is a navigation stage. A text hit is never a verified fact or an absence
finding; the caller must still extract values, link entities, and check evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from .text_layer import (LEGACY_TEXT_QUALITY_POLICY_VERSION,
                         TEXT_QUALITY_POLICY_VERSION, qualify_page_text)


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_STAGES = {"PD", "RD", "ID"}
_REVISION = {"CURRENT", "SUPERSEDED", "UNKNOWN"}
_APPROVAL = {"APPROVED", "UNAPPROVED", "UNKNOWN"}


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _nonempty(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _terms(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value or any(not isinstance(x, str) or not x.strip() for x in value):
        raise ValueError(f"{label} must contain non-empty strings")
    return list(dict.fromkeys(x.strip() for x in value))


def _tokens(value: str) -> tuple[str, ...]:
    return tuple(re.findall(r"\w+", unicodedata.normalize("NFKC", value).casefold(), re.UNICODE))


def _contains_phrase(haystack: tuple[str, ...], phrase: str) -> bool:
    needle = _tokens(phrase)
    return bool(needle) and any(haystack[i:i + len(needle)] == needle for i in range(len(haystack) - len(needle) + 1))


def _source_gate(source: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if source["revisionStatus"] == "SUPERSEDED":
        reasons.append("SUPERSEDED_REVISION")
    elif source["revisionStatus"] == "UNKNOWN":
        reasons.append("REVISION_UNRESOLVED")
    if source["approvalStatus"] == "UNAPPROVED":
        reasons.append("SOURCE_UNAPPROVED")
    elif source["approvalStatus"] == "UNKNOWN":
        reasons.append("APPROVAL_UNRESOLVED")
    return reasons


def _validate_artifact(artifact: dict[str, Any], source: dict[str, Any]) -> None:
    if artifact.get("schemaVersion") != "document-text-v2":
        raise ValueError("text artifact schemaVersion must be document-text-v2")
    if artifact.get("sourceFileId") != source["sourceFileId"] or artifact.get("inputSha256") != source["sha256"]:
        raise ValueError(f"text artifact provenance mismatch for {source['sourceFileId']}")
    if artifact.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS":
        raise ValueError("text artifact coordinateSystem is unsupported")
    pages = artifact.get("pages")
    if (not isinstance(pages, list) or not pages or type(artifact.get("pageCount")) is not int
            or artifact["pageCount"] != len(pages)):
        raise ValueError("text artifact pageCount does not match pages")
    policy_version = artifact.get("qualityPolicyVersion")
    if policy_version not in (LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("text artifact qualityPolicyVersion is unsupported")
    seen: set[int] = set()
    text_page_count = 0
    text_candidate_count = 0
    for page in pages:
        page = _object(page, "text page")
        number = page.get("pageNumber")
        if type(number) is not int or number < 1 or number > len(pages) or number in seen:
            raise ValueError("text artifact page numbers must be unique and contiguous")
        seen.add(number)
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            raise ValueError("text page blocks must be an array")
        if (type(page.get("widthMilliPoints")) is not int or page["widthMilliPoints"] < 1
                or type(page.get("heightMilliPoints")) is not int or page["heightMilliPoints"] < 1):
            raise ValueError("text page dimensions are invalid")
        if blocks:
            text_page_count += 1
        for block in blocks:
            block = _object(block, "text block")
            if not isinstance(block.get("text"), str):
                raise ValueError("text block text must be a string")
            bbox = block.get("bboxMilliPoints")
            if not isinstance(bbox, list) or len(bbox) != 4 or any(type(x) is not int or x < 0 for x in bbox):
                raise ValueError("text block bboxMilliPoints is invalid")
            if bbox[0] > bbox[2] or bbox[1] > bbox[3]:
                raise ValueError("text block bboxMilliPoints is inverted")
            if bbox[2] > page["widthMilliPoints"] or bbox[3] > page["heightMilliPoints"]:
                raise ValueError("text block bboxMilliPoints exceeds page")
            line_boxes = block.get("lineBboxesMilliPoints")
            if line_boxes is not None:
                if (not isinstance(line_boxes, list)
                        or len(line_boxes) != len(block["text"].splitlines())):
                    raise ValueError("text line bbox count is invalid")
                for line_box in line_boxes:
                    if (not isinstance(line_box, list) or len(line_box) != 4
                            or any(type(value) is not int for value in line_box)
                            or line_box[0] < bbox[0] or line_box[1] < bbox[1]
                            or line_box[2] > bbox[2] or line_box[3] > bbox[3]
                            or line_box[0] > line_box[2] or line_box[1] > line_box[3]):
                        raise ValueError("text line bbox is invalid")
        quality = _object(page.get("quality"), "text page quality")
        expected_quality = qualify_page_text([block["text"] for block in blocks],
                                             policy_version=policy_version)
        if quality != expected_quality:
            raise ValueError("text page quality does not match its blocks")
        if quality["disposition"] == "TEXT_LAYER_CANDIDATE":
            text_candidate_count += 1
    if seen != set(range(1, len(pages) + 1)):
        raise ValueError("text artifact page numbers must be unique and contiguous")
    if artifact.get("textPageCount") != text_page_count or artifact.get("qualitySummary") != {
        "textLayerCandidatePageCount": text_candidate_count,
        "ocrRequiredPageCount": len(pages) - text_candidate_count,
    }:
        raise ValueError("text artifact counts do not match pages")


def route_parameter(request: dict[str, Any]) -> dict[str, Any]:
    """Return explainable page candidates without making a comparison claim."""
    request = _object(request, "request")
    if request.get("schemaVersion") != "parameter-route-request-v1":
        raise ValueError("request schemaVersion must be parameter-route-request-v1")
    manifest_hash = _nonempty(request.get("inputManifestHash"), "inputManifestHash")
    if _SHA256.fullmatch(manifest_hash) is None:
        raise ValueError("inputManifestHash must be a lowercase SHA-256")
    object_id = _nonempty(request.get("objectId"), "objectId")
    rule = _object(request.get("rule"), "rule")
    rule_id = _nonempty(rule.get("ruleId"), "ruleId")
    rule_version = _nonempty(rule.get("version"), "rule version")
    parameter_code = _nonempty(rule.get("parameterCode"), "parameterCode")
    required_stages = rule.get("requiredStages")
    if (not isinstance(required_stages, list) or not required_stages
            or any(not isinstance(stage, str) or stage not in _STAGES for stage in required_stages)
            or len(set(required_stages)) != len(required_stages)):
        raise ValueError("requiredStages must be unique PD/RD/ID values")
    subject_terms = _terms(rule.get("subjectTerms"), "subjectTerms")
    location_terms = rule.get("locationTerms", [])
    if not isinstance(location_terms, list) or any(not isinstance(x, str) or not x.strip() for x in location_terms):
        raise ValueError("locationTerms must be an array of non-empty strings")
    section_codes = rule.get("sectionCodes", [])
    if not isinstance(section_codes, list) or any(not isinstance(x, str) or not x.strip() for x in section_codes):
        raise ValueError("sectionCodes must be an array of non-empty strings")
    if not isinstance(rule.get("visualFactRequired"), bool):
        raise ValueError("visualFactRequired must be a boolean")

    raw_sources = request.get("sources")
    raw_artifacts = request.get("textArtifacts")
    if not isinstance(raw_sources, list) or not isinstance(raw_artifacts, list):
        raise ValueError("sources and textArtifacts must be arrays")
    sources: dict[str, dict[str, Any]] = {}
    for raw in raw_sources:
        source = _object(raw, "source")
        source_id = _nonempty(source.get("sourceFileId"), "sourceFileId")
        if source_id in sources:
            raise ValueError(f"duplicate sourceFileId {source_id}")
        source_hash = _nonempty(source.get("sha256"), "source sha256")
        if _SHA256.fullmatch(source_hash) is None:
            raise ValueError("source sha256 must be a lowercase SHA-256")
        _nonempty(source.get("objectId"), "source objectId")
        stages = source.get("stages")
        if (not isinstance(stages, list) or not stages
                or any(not isinstance(stage, str) or stage not in _STAGES for stage in stages)
                or len(set(stages)) != len(stages)):
            raise ValueError("source stages must be unique PD/RD/ID values")
        if source.get("revisionStatus", "UNKNOWN") not in _REVISION:
            raise ValueError("source revisionStatus is invalid")
        if source.get("approvalStatus", "UNKNOWN") not in _APPROVAL:
            raise ValueError("source approvalStatus is invalid")
        page_stages = source.get("pageStages", {})
        if not isinstance(page_stages, dict) or any(
            not isinstance(key, str) or not key.isdecimal() or int(key) < 1
            or str(int(key)) != key or (value != "UNRESOLVED" and value not in stages)
            for key, value in page_stages.items()
        ):
            raise ValueError("source pageStages must map page numbers to declared stages or UNRESOLVED")
        if len(stages) == 1 and page_stages:
            raise ValueError("single-stage source cannot have pageStages")
        sources[source_id] = {
            **source,
            "sourceFileId": source_id,
            "sha256": source_hash,
            "revisionStatus": source.get("revisionStatus", "UNKNOWN"),
            "approvalStatus": source.get("approvalStatus", "UNKNOWN"),
            "pageStages": page_stages,
        }

    artifacts: dict[str, dict[str, Any]] = {}
    for raw in raw_artifacts:
        artifact = _object(raw, "text artifact")
        source_id = _nonempty(artifact.get("sourceFileId"), "artifact sourceFileId")
        if source_id in artifacts or source_id not in sources:
            raise ValueError(f"duplicate or unknown text artifact sourceFileId {source_id}")
        _validate_artifact(artifact, sources[source_id])
        artifacts[source_id] = artifact
    for source_id, source in sources.items():
        artifact = artifacts.get(source_id)
        if artifact and any(int(page_number) > artifact["pageCount"] for page_number in source["pageStages"]):
            raise ValueError(f"pageStages exceeds page count for {source_id}")

    stages_out: list[dict[str, Any]] = []
    for stage in required_stages:
        candidates: list[dict[str, Any]] = []
        review: list[dict[str, Any]] = []

        def add_review(source_id: str, reason_codes: list[str]) -> None:
            for item in review:
                if item["sourceFileId"] == source_id:
                    item["reasonCodes"] = list(dict.fromkeys([*item["reasonCodes"], *reason_codes]))
                    return
            review.append({"sourceFileId": source_id, "reasonCodes": list(dict.fromkeys(reason_codes))})

        ocr_pages: list[dict[str, Any]] = []
        source_count = 0
        page_count_in_scope = 0
        text_searched_page_count = 0
        for source_id, source in sorted(sources.items()):
            if source["objectId"] != object_id or stage not in source["stages"]:
                continue
            source_count += 1
            gate_reasons = _source_gate(source)
            if len(source["stages"]) > 1 and not source["pageStages"]:
                add_review(source_id, ["STAGE_SEGMENTATION_REQUIRED", *gate_reasons])
                continue
            artifact = artifacts.get(source_id)
            if artifact is None:
                add_review(source_id, ["TEXT_ARTIFACT_MISSING"])
                continue
            if len(source["stages"]) > 1 and len(source["pageStages"]) != artifact["pageCount"]:
                add_review(source_id, ["STAGE_PAGES_UNASSIGNED", *gate_reasons])
            if len(source["stages"]) > 1 and "UNRESOLVED" in source["pageStages"].values():
                add_review(source_id, ["STAGE_PAGES_UNRESOLVED", *gate_reasons])
            eligible_pages = []
            for page in artifact["pages"]:
                page_number = page["pageNumber"]
                if len(source["stages"]) > 1 and source["pageStages"].get(str(page_number)) != stage:
                    continue
                eligible_pages.append(page)
            if not eligible_pages:
                if not any(item["sourceFileId"] == source_id for item in review):
                    add_review(source_id, ["STAGE_PAGES_UNASSIGNED", *gate_reasons])
                continue
            hard_exclusion = any(reason in {"SUPERSEDED_REVISION", "SOURCE_UNAPPROVED"} for reason in gate_reasons)
            if hard_exclusion:
                add_review(source_id, gate_reasons)
                continue
            if gate_reasons:
                add_review(source_id, gate_reasons)
            for page in eligible_pages:
                page_count_in_scope += 1
                locator = {"sourceFileId": source_id, "inputSha256": source["sha256"], "pageNumber": page["pageNumber"]}
                if page["quality"]["disposition"] == "OCR_REQUIRED":
                    ocr_pages.append({**locator, "reasonCode": "OCR_REQUIRED"})
                    continue
                text_searched_page_count += 1
                matched_subjects: list[str] = []
                matched_locations: list[str] = []
                matching_blocks: list[int] = []
                for index, block in enumerate(page["blocks"]):
                    tokens = _tokens(block["text"])
                    subjects = [term for term in subject_terms if _contains_phrase(tokens, term)]
                    locations = [term for term in location_terms if _contains_phrase(tokens, term)]
                    if subjects or locations:
                        matching_blocks.append(index)
                        matched_subjects.extend(subjects)
                        matched_locations.extend(locations)
                matched_subjects = list(dict.fromkeys(matched_subjects))
                matched_locations = list(dict.fromkeys(matched_locations))
                if not matched_subjects and not matched_locations:
                    continue
                section_match = source.get("sectionCode") in section_codes if section_codes else False
                score = 4 * len(matched_subjects) + 6 * len(matched_locations) + int(section_match)
                reason_codes = []
                if matched_subjects:
                    reason_codes.append("SUBJECT_TEXT_MATCH")
                if matched_locations:
                    reason_codes.append("LOCATION_TEXT_MATCH")
                if section_match:
                    reason_codes.append("SECTION_HINT_MATCH")
                candidates.append({
                    **locator,
                    "score": score,
                    "reasonCodes": reason_codes,
                    "matchedSubjectTerms": matched_subjects,
                    "matchedLocationTerms": matched_locations,
                    "blockIndexes": matching_blocks,
                    "sourceGate": "REVISION_APPROVAL_CLEARED" if not gate_reasons else "REVISION_APPROVAL_REVIEW_REQUIRED",
                })
        candidates.sort(key=lambda item: (-item["score"], item["sourceFileId"], item["pageNumber"]))
        ocr_pages.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"]))
        if source_count == 0:
            status = "MISSING_SOURCE"
        elif review and not candidates and not ocr_pages:
            status = "REVIEW_REQUIRED"
        elif ocr_pages:
            status = "OCR_AND_REVIEW_REQUIRED"
        elif candidates:
            status = "TEXT_CANDIDATES_REVIEW_REQUIRED" if review else "TEXT_CANDIDATES"
        else:
            status = "NO_TEXT_CANDIDATE"
        stages_out.append({
            "stage": stage,
            "status": status,
            "sourceCount": source_count,
            "pageCountInScope": page_count_in_scope,
            "textSearchedPageCount": text_searched_page_count,
            "candidates": candidates,
            "ocrPages": ocr_pages,
            "sourceReview": review,
        })

    return {
        "schemaVersion": "parameter-route-result-v1",
        "disposition": "NAVIGATION_ONLY",
        "inputManifestHash": manifest_hash,
        "objectId": object_id,
        "ruleId": rule_id,
        "ruleVersion": rule_version,
        "parameterCode": parameter_code,
        "visualFactRequired": rule["visualFactRequired"],
        "stages": stages_out,
        "comparisonStatus": "NOT_EVALUATED",
        "absenceVerified": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Route a parameter rule over verified document-text-v2 artifacts")
    parser.add_argument("request", type=Path, help="JSON parameter-route-request-v1")
    parser.add_argument("--output", type=Path, help="Write result JSON; stdout otherwise")
    args = parser.parse_args()
    result = route_parameter(json.loads(args.request.read_text(encoding="utf-8")))
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
