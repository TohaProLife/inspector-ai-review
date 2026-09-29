"""Run-scoped OCR label leads for the 47 candidate rules; never facts or findings.

The caller supplies a fenced, committed DOCUMENT_OCR_LAYOUT stage and the same
reviewed source/text snapshot used by the run.  Every emitted line is checked
against the pinned label packs and immutable OCR page/render/provider identity.
Deferred OCR pages remain unknown, including when a processed page has no hit.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .class_family_candidates import load_class_family_labels
from .durable_ocr_layout import (
    PROFILE_HASH_V3, PROFILE_HASH_V4, PROFILE_HASH_V5,
    PROFILE_ID_V3, PROFILE_ID_V4, PROFILE_ID_V5,
    PROFILE_V3, PROFILE_V4, PROFILE_V5, _validate_bounded_artifact,
)
from .numeric_family_candidates import load_numeric_family_labels
from .ocr_pilot import validate_ocr_artifact
from .presence_family_candidates import load_presence_family_labels
from .run_candidate_family_preview import _hash, _line_matches, _source
from .candidate_family_observations import _index_inputs


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_PROFILES = {
    PROFILE_ID_V3: (PROFILE_HASH_V3, PROFILE_V3, "bounded-ocr-layout-analysis-v3"),
    PROFILE_ID_V4: (PROFILE_HASH_V4, PROFILE_V4, "bounded-ocr-layout-analysis-v4"),
    PROFILE_ID_V5: (PROFILE_HASH_V5, PROFILE_V5, "bounded-ocr-layout-analysis-v5"),
}
_MAX_OUTPUT_BYTES = 1024 * 1024


def _validated_ocr_stage(
    object_id: str, manifest_hash: str, source_index: dict[str, dict[str, Any]],
    text_index: dict[str, dict[str, Any]], stage: object,
) -> tuple[str, dict[str, dict[str, Any]]]:
    if not isinstance(stage, dict):
        raise ValueError("candidate OCR stage must be an object")
    profile_id = stage.get("providerProfileId")
    selected = _PROFILES.get(profile_id)
    if selected is None:
        raise ValueError("candidate OCR stage profile unsupported")
    config_hash, profile, schema = selected
    analysis = stage.get("analysis")
    if (stage.get("schemaVersion") != "analysis-stage-result-v2"
            or stage.get("jobType") != "DOCUMENT_OCR_LAYOUT"
            or stage.get("inputManifestHash") != manifest_hash
            or stage.get("disposition") != "OCR_LAYOUT_BOUNDED"
            or stage.get("reasonCode") != "BOUNDED_OCR_ONLY"
            or stage.get("providerKind") != "OCR_LAYOUT"
            or stage.get("providerConfigHash") != config_hash
            or not isinstance(analysis, dict)
            or analysis.get("schemaVersion") != schema
            or analysis.get("inputManifestHash") != manifest_hash
            or analysis.get("objectId") != object_id
            or analysis.get("profile") != profile
            or not isinstance(analysis.get("sources"), list)
            or analysis.get("sourceCount") != len(source_index)
            or type(analysis.get("processedPageCount")) is not int
            or not 0 <= analysis["processedPageCount"] <= profile["maxPagesPerRun"]
            or stage.get("outputCount") != analysis["processedPageCount"]):
        raise ValueError("candidate OCR stage identity, profile or counts invalid")
    rows: dict[str, dict[str, Any]] = {}
    required_total = processed_total = deferred_total = unsupported_total = 0
    for row in analysis["sources"]:
        if not isinstance(row, dict) or not isinstance(row.get("sourceFileId"), str):
            raise ValueError("candidate OCR source row invalid")
        source_id = row["sourceFileId"]
        if source_id not in source_index or source_id in rows:
            raise ValueError("candidate OCR source missing or duplicated")
        source = source_index[source_id]
        pages = row.get("pages")
        if (row.get("sourceSha256") != source["sha256"]
                or (source.get("mediaType") is not None
                    and row.get("mediaType") != source["mediaType"])
                or not isinstance(pages, list)
                or type(row.get("ocrRequiredPageCount")) is not int
                or type(row.get("processedPageCount")) is not int
                or type(row.get("deferredPageCount")) is not int
                or min(row["ocrRequiredPageCount"], row["processedPageCount"],
                       row["deferredPageCount"]) < 0
                or row["processedPageCount"] != len(pages)
                or row["deferredPageCount"] != row["ocrRequiredPageCount"] - len(pages)):
            raise ValueError("candidate OCR source provenance or page counts invalid")
        if row.get("mediaType") == "application/pdf":
            text = text_index.get(source_id)
            if (text is None or row.get("pageCount") != text["pageCount"]
                    or row["ocrRequiredPageCount"] != text["qualitySummary"]["ocrRequiredPageCount"]):
                raise ValueError("candidate OCR PDF differs from committed text artifact")
            by_page = {item["pageNumber"]: item for item in text["pages"]}
            if any(int(number) > text["pageCount"] for number in source.get("pageStages", {})):
                raise ValueError("candidate OCR page stage exceeds text artifact")
            seen_pages: set[int] = set()
            for page in pages:
                if not isinstance(page, dict):
                    raise ValueError("candidate OCR page invalid")
                number = page.get("pageNumber")
                if type(number) is not int or number not in by_page or number in seen_pages:
                    raise ValueError("candidate OCR page number invalid or duplicated")
                seen_pages.add(number)
                if by_page[number]["quality"]["disposition"] != "OCR_REQUIRED":
                    raise ValueError("candidate OCR page was not OCR_REQUIRED")
                validate_ocr_artifact(page, source_id=source_id,
                                      source_hash=source["sha256"], page_number=number)
                if (page["render"]["dpi"] != profile["dpi"]
                        or page["provider"]["script"] != profile["script"]):
                    raise ValueError("candidate OCR page render request differs from profile")
                _validate_bounded_artifact(page, by_page[number], profile)
        elif (source_id in text_index or row.get("pageCount") is not None
              or row["ocrRequiredPageCount"] or pages
              or row.get("status") != "SKIPPED_UNSUPPORTED_FORMAT"):
            raise ValueError("candidate OCR unsupported source has PDF/text output")
        else:
            unsupported_total += 1
        required_total += row["ocrRequiredPageCount"]
        processed_total += len(pages)
        deferred_total += row["deferredPageCount"]
        rows[source_id] = row
    if (set(rows) != set(source_index)
            or any(analysis.get(key) != value for key, value in (
                ("ocrRequiredPageCount", required_total),
                ("processedPageCount", processed_total),
                ("deferredPageCount", deferred_total),
                ("skippedUnsupportedSourceCount", unsupported_total)))):
        raise ValueError("candidate OCR stage aggregate counts invalid")
    return _hash(stage), rows


def _lead(
    *, rule: dict[str, Any], match: dict[str, Any], source: dict[str, Any],
    page: dict[str, Any], line: dict[str, Any], line_index: int,
    object_id: str, manifest_hash: str, stage: str, ocr_stage_hash: str,
) -> dict[str, Any]:
    render, provider = page["render"], page["provider"]
    value = {
        "schemaVersion": "candidate-family-ocr-lead-v1", "status": "CANDIDATE",
        "purpose": "REVIEW_ONLY", "parameterCode": rule["parameterCode"],
        "family": rule["family"], "attribute": match["attribute"],
        "canonicalUnit": match["canonicalUnit"], "matchedLabel": match["matchedLabel"],
        "rawValue": match["rawValue"], "rawUnit": match["rawUnit"],
        "featureKey": match.get("featureKey"), "scopeTokens": match.get("scopeTokens"),
        "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
        "ocrArtifactSha256": ocr_stage_hash, "ocrPageSha256": page["contentHash"],
        "objectId": object_id, "inputManifestHash": manifest_hash,
        "stage": stage, "sectionCode": source["sectionCode"],
        "revisionStatus": source["revisionStatus"],
        "approvalStatus": source["approvalStatus"],
        "pageNumber": page["pageNumber"],
        "coordinateSystem": "IMAGE_TOP_LEFT_PIXELS", "lineText": line["text"],
        "locator": {
            "kind": "DOCUMENT_OCR_LINE", "lineIndex": line_index,
            "start": match["start"], "end": match["end"], "bboxPx": line["bboxPx"],
            "score": line["score"],
            "renderSha256": render["sha256"],
            "rendererProfileId": render["rendererProfileId"],
            "providerProfileId": provider["profileId"],
            "providerScript": provider["script"], "dpi": render["dpi"],
            "widthPx": render["widthPx"], "heightPx": render["heightPx"],
        },
    }
    value["leadSha256"] = _hash(value)
    return value


def evaluate_run_candidate_family_ocr_observations(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], ocr_stage: dict[str, Any], *,
    max_leads_per_code: int = 16,
) -> dict[str, Any]:
    """Return bounded OCR review leads; any absent, deferred or conflicting page abstains."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("candidate OCR objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA256.fullmatch(input_manifest_hash) is None:
        raise ValueError("candidate OCR inputManifestHash invalid")
    if type(max_leads_per_code) is not int or not 1 <= max_leads_per_code <= 16:
        raise ValueError("candidate OCR max_leads_per_code must be 1..16")
    source_index, text_index, _text_hashes = _index_inputs(object_id, sources, text_artifacts)
    ocr_stage_hash, ocr_rows = _validated_ocr_stage(
        object_id, input_manifest_hash, source_index, text_index, ocr_stage)
    rules_pack = load_candidate_family_pack()
    numeric, classes, presence = (load_numeric_family_labels(),
                                  load_class_family_labels(), load_presence_family_labels())
    if any(pack["candidatePackSha256"] != rules_pack["packSha256"]
           for pack in (numeric, classes, presence)):
        raise ValueError("candidate OCR label packs differ from pinned rules")
    entries = {
        **{item["parameterCode"]: item for item in numeric["entries"]},
        **{item["parameterCode"]: item for item in classes["entries"]},
        **{item["parameterCode"]: item for item in presence["entries"]},
    }
    if len(entries) != 47 or len(rules_pack["rules"]) != 47:
        raise ValueError("candidate OCR label packs do not cover 47 rules")
    rows = []
    for rule in sorted(rules_pack["rules"], key=lambda item: item["parameterCode"]):
        code = rule["parameterCode"]
        reasons: set[str] = set()
        leads: list[dict[str, Any]] = []
        eligible_sources = processed_pages = deferred_pages = 0
        for source_id in sorted(source_index):
            source, ocr_row = source_index[source_id], ocr_rows[source_id]
            relevant = [stage for stage in source["stages"] if stage == rule["expectedStage"]
                        or stage in rule["allowedActualStages"]]
            if not relevant:
                continue
            if source["revisionStatus"] != "CURRENT":
                reasons.add("SOURCE_REVISION_UNRESOLVED" if source["revisionStatus"] == "UNKNOWN"
                            else "SOURCE_REVISION_SUPERSEDED")
                continue
            if source["approvalStatus"] != "APPROVED":
                reasons.add("SOURCE_APPROVAL_UNRESOLVED" if source["approvalStatus"] == "UNKNOWN"
                            else "SOURCE_UNAPPROVED")
                continue
            matching = [stage for stage in relevant if source.get("sectionCode") in
                        rule["requiredExpectedDrawingSections" if stage == "PD"
                             else "requiredActualDrawingSections"]]
            if not matching:
                reasons.add("DRAWING_SECTION_UNRESOLVED")
                continue
            text = text_index.get(source_id)
            if text is None:
                reasons.add("TEXT_ARTIFACT_MISSING")
                continue
            stages = source["stages"]
            page_stages = source.get("pageStages", {})
            if len(stages) > 1 and set(page_stages) != {
                    str(number) for number in range(1, text["pageCount"] + 1)}:
                reasons.add("SOURCE_PAGE_STAGE_UNRESOLVED")
                continue
            if len(stages) > 1 and "UNRESOLVED" in page_stages.values():
                reasons.add("SOURCE_PAGE_STAGE_UNRESOLVED")
            eligible_sources += 1
            deferred_pages += ocr_row["deferredPageCount"]
            for page in sorted(ocr_row["pages"], key=lambda item: item["pageNumber"]):
                stage = stages[0] if len(stages) == 1 else page_stages[str(page["pageNumber"])]
                if stage not in matching:
                    continue
                processed_pages += 1
                page_leads = []
                for line_index, line in enumerate(page["lines"]):
                    for match in _line_matches(line["text"], entries[code], rule["family"]):
                        page_leads.append(_lead(
                            rule=rule, match=match, source=source, page=page,
                            line=line, line_index=line_index, object_id=object_id,
                            manifest_hash=input_manifest_hash, stage=stage,
                            ocr_stage_hash=ocr_stage_hash))
                # A second same-label value on a drawing may be another floor,
                # variant, or building. Never choose one automatically.
                if rule["family"] != "PRESENCE_SET":
                    counts = Counter(item["attribute"] for item in page_leads)
                    if any(count > 1 for count in counts.values()):
                        reasons.add("AMBIGUOUS_PAGE_LABEL")
                    page_leads = [item for item in page_leads
                                  if counts[item["attribute"]] == 1]
                leads.extend(page_leads)
        leads.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                     item["locator"]["lineIndex"],
                                     item["locator"]["start"], item["attribute"],
                                     item["featureKey"] or ""))
        if len(leads) > max_leads_per_code:
            reasons.add("LEAD_LIMIT_REACHED")
            leads = leads[:max_leads_per_code]
        if deferred_pages:
            reasons.add("OCR_DEFERRED_IN_SCOPE")
        if not eligible_sources:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if not leads and processed_pages:
            reasons.add("NO_EXACT_OCR_LABEL_LEAD")
        if leads:
            reasons.add("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED")
        rows.append({
            "parameterCode": code, "family": rule["family"], "ruleId": rule["ruleId"],
            "status": "ABSTAIN", "reasonCodes": sorted(reasons),
            "eligibleSourceCount": eligible_sources,
            "ocrProcessedPageCount": processed_pages,
            "ocrDeferredPageCount": deferred_pages,
            "leadCount": len(leads), "candidateLeads": leads,
        })
    result = {
        "schemaVersion": "candidate-family-ocr-observations-v1",
        "inputManifestHash": input_manifest_hash, "objectId": object_id,
        "scope": "RUN_COMMITTED_OCR", "purpose": "REVIEW_ONLY",
        "ocrArtifactSha256": ocr_stage_hash,
        "candidateRulePackSha256": rules_pack["packSha256"],
        "numericLabelPackSha256": numeric["labelPackSha256"],
        "classLabelPackSha256": classes["labelPackSha256"],
        "presenceLabelPackSha256": presence["labelPackSha256"],
        "codeRows": rows, "findingCount": None, "parameterCoverage": None,
        "outputCount": len(rows),
    }
    result["contentHash"] = _hash(result)
    while len(json.dumps(result, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")) > _MAX_OUTPUT_BYTES:
        row = next((item for item in reversed(rows) if item["candidateLeads"]), None)
        if row is None:
            raise ValueError("candidate OCR metadata exceeds 1 MiB budget")
        row["candidateLeads"].pop()
        row["leadCount"] -= 1
        row["reasonCodes"] = sorted(set(row["reasonCodes"]) | {"OCR_BYTE_BUDGET_REACHED"})
        result["contentHash"] = _hash({key: value for key, value in result.items()
                                        if key != "contentHash"})
    return result
