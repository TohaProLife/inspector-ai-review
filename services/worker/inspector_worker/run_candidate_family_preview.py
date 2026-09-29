"""Run-scoped lexical preview for all 47 catalog-pinned candidate rules.

This is a navigation aid over committed document-text-v2 artifacts. Every code
abstains: a matching line is neither a typed fact nor an entity comparison.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from functools import lru_cache
from typing import Any, Iterator

from .candidate_family_rules import load_candidate_family_pack
from .class_family_candidates import (
    class_line_pattern, load_class_family_labels, matched_class_label,
)
from .durable_pz002 import _reviewed_source
from .durable_text import download_text_artifact
from .indexed_numeric_rows import _pattern
from .numeric_family_candidates import load_numeric_family_labels
from .parameter_routing import _validate_artifact
from .presence_family_candidates import (
    _CARRIER_BY_FEATURE, _UNCERTAIN, _label_matches, _normalized,
    _scope_tokens, load_presence_family_labels,
)


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_STAGES = frozenset({"PD", "RD", "ID"})
_MAX_LEADS_PER_CODE = 16
_MAX_PREVIEW_BYTES = 1024 * 1024


def _hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source(source: object, object_id: str) -> dict[str, Any]:
    if not isinstance(source, dict):
        raise ValueError("candidate preview source must be an object")
    source_id, digest, stages = (source.get(key) for key in
                                 ("sourceFileId", "sha256", "stages"))
    if (not isinstance(source_id, str) or not source_id.strip()
            or not isinstance(digest, str) or _SHA256.fullmatch(digest) is None
            or source.get("objectId") != object_id
            or not isinstance(stages, list) or not stages
            or any(stage not in _STAGES for stage in stages)
            or len(set(stages)) != len(stages)):
        raise ValueError("candidate preview source identity or stage invalid")
    if source.get("revisionStatus") not in {"CURRENT", "SUPERSEDED", "UNKNOWN"}:
        raise ValueError("candidate preview revisionStatus invalid")
    if source.get("approvalStatus") not in {"APPROVED", "UNAPPROVED", "UNKNOWN"}:
        raise ValueError("candidate preview approvalStatus invalid")
    section = source.get("sectionCode")
    if section is not None and (not isinstance(section, str)
                                or re.fullmatch(r"[A-Z0-9]{1,12}", section) is None):
        raise ValueError("candidate preview sectionCode invalid")
    page_stages = source.get("pageStages", {})
    if (not isinstance(page_stages, dict)
            or any(not isinstance(key, str) or not key.isdecimal()
                   or str(int(key)) != key or int(key) < 1
                   or stage not in {*stages, "UNRESOLVED"}
                   for key, stage in page_stages.items())
            or (len(stages) == 1 and page_stages)):
        raise ValueError("candidate preview pageStages invalid")
    return source


def _lines(block: dict[str, Any]) -> Iterator[tuple[int, str, int]]:
    offset = 0
    for line_index, part in enumerate(block["text"].splitlines(keepends=True)):
        line = part.rstrip("\r\n")
        yield line_index, line, offset
        offset += len(part)


@lru_cache(maxsize=256)
def _numeric_pattern(label: str, aliases: tuple[str, ...]) -> re.Pattern[str]:
    return _pattern(label, aliases)


def _numeric_matches(line: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    matches = []
    for attribute in entry["attributes"]:
        for label in attribute["labels"]:
            match = _numeric_pattern(label, tuple(attribute["unitAliases"])).fullmatch(line)
            if match is not None:
                matches.append({
                    "attribute": attribute["key"],
                    "canonicalUnit": attribute["canonicalUnit"],
                    "matchedLabel": label,
                    "rawValue": match.group("value"),
                    "rawUnit": match.group("unit"),
                    "start": match.start("value"), "end": match.end("value"),
                })
    return matches if len(matches) == 1 else []


@lru_cache(maxsize=32)
def _class_pattern(labels: tuple[str, ...], values: tuple[str, ...]) -> re.Pattern[str]:
    return class_line_pattern({"labels": labels, "values": values})


def _class_matches(line: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    match = _class_pattern(tuple(entry["labels"]), tuple(entry["values"])).fullmatch(line)
    if match is None:
        return []
    alias = matched_class_label(entry, match)
    if alias is None:
        return []
    return [{
        "attribute": entry["attribute"], "canonicalUnit": entry["canonicalUnit"],
        "matchedLabel": alias, "rawValue": match.group("value"),
        "rawUnit": None, "start": match.start("value"), "end": match.end("value"),
    }]


def _presence_matches(line: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    if len(line) > 500 or "?" in line or _UNCERTAIN.search(line):
        return []
    scopes = _scope_tokens(line, entry["scopeGroups"])
    if scopes is None:
        return []
    normalized = _normalized(line)
    # Unicode case folding can expand a character; then normalized regex
    # offsets no longer locate the same bytes in the original text block.
    if len(normalized) != len(line):
        return []
    matches = []
    for feature in entry["features"]:
        if (entry["parameterCode"] == "ZU-129"
                and _normalized(scopes[0]["matchedLabel"])
                not in _CARRIER_BY_FEATURE[feature["featureKey"]]):
            continue
        label_matches = [(label, match) for label in feature["labels"]
                         for match in _label_matches(normalized, label)]
        if not label_matches:
            continue
        label, match = sorted(label_matches, key=lambda item: (-len(item[0]), item[1].start()))[0]
        matches.append({
            "attribute": entry["attribute"], "canonicalUnit": "set",
            "matchedLabel": label, "rawValue": line[match.start():match.end()],
            "rawUnit": None, "featureKey": feature["featureKey"],
            "scopeTokens": scopes, "start": match.start(), "end": match.end(),
        })
    return matches


def _line_matches(line: str, entry: dict[str, Any], family: str) -> list[dict[str, Any]]:
    if not line.strip() or len(line) > 500:
        return []
    if family == "CLASS_DECREASE":
        return _class_matches(line, entry)
    if family == "PRESENCE_SET":
        return _presence_matches(line, entry)
    return _numeric_matches(line, entry)


def _lead(
    *, rule: dict[str, Any], match: dict[str, Any], source: dict[str, Any],
    artifact_hash: str, page: dict[str, Any], block: dict[str, Any],
    block_index: int, line_index: int, line: str, line_start: int, object_id: str,
    stage: str,
) -> dict[str, Any]:
    start, end = line_start + match["start"], line_start + match["end"]
    result = {
        "schemaVersion": "candidate-family-run-lead-v1", "status": "CANDIDATE",
        "purpose": "REVIEW_ONLY", "parameterCode": rule["parameterCode"],
        "family": rule["family"], "attribute": match["attribute"],
        "canonicalUnit": match["canonicalUnit"],
        "matchedLabel": match["matchedLabel"],
        "rawValue": match["rawValue"], "rawUnit": match["rawUnit"],
        "featureKey": match.get("featureKey"), "scopeTokens": match.get("scopeTokens"),
        "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
        "artifactSha256": artifact_hash, "objectId": object_id,
        "stage": stage, "sectionCode": source["sectionCode"],
        "revisionStatus": source["revisionStatus"],
        "approvalStatus": source["approvalStatus"],
        "pageNumber": page["pageNumber"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "lineText": line,
        "blockTextSha256": hashlib.sha256(block["text"].encode("utf-8")).hexdigest(),
        "locator": {
            "kind": "DOCUMENT_TEXT_BLOCK_LINE", "blockIndex": block_index,
            "lineIndex": line_index, "start": start, "end": end,
            "bboxMilliPoints": block["bboxMilliPoints"],
        },
    }
    result["leadSha256"] = _hash(result)
    return result


def evaluate_run_candidate_family_preview(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], *, max_leads_per_code: int = _MAX_LEADS_PER_CODE,
) -> dict[str, Any]:
    """Preview exact same-line leads from reviewed run sources, always ABSTAIN.

    Caller must bind source metadata to immutable sourceDecisions. Invalid
    metadata or text artifacts fail closed. Unknown review gates produce no
    leads and explicit reason codes.
    """
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("candidate preview objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA256.fullmatch(input_manifest_hash) is None:
        raise ValueError("candidate preview inputManifestHash invalid")
    if type(max_leads_per_code) is not int or not 1 <= max_leads_per_code <= 16:
        raise ValueError("candidate preview max_leads_per_code must be 1..16")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("candidate preview sources/artifacts must be arrays")

    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        if source["sourceFileId"] in source_index:
            raise ValueError("candidate preview duplicate source")
        source_index[source["sourceFileId"]] = source
    artifact_index: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("candidate preview artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifact_index:
            raise ValueError("candidate preview unknown or duplicate artifact")
        _validate_artifact(artifact, source_index[source_id])
        artifact_index[source_id] = artifact
        artifact_hashes[source_id] = _hash(artifact)
        page_stages = source_index[source_id].get("pageStages", {})
        if any(int(number) > artifact["pageCount"] for number in page_stages):
            raise ValueError("candidate preview pageStages exceeds artifact")

    rules_pack = load_candidate_family_pack()
    numeric = load_numeric_family_labels()
    classes = load_class_family_labels()
    presence = load_presence_family_labels()
    if any(pack["candidatePackSha256"] != rules_pack["packSha256"]
           for pack in (numeric, classes, presence)):
        raise ValueError("candidate preview label packs differ from rule pack")
    entries = {
        **{entry["parameterCode"]: entry for entry in numeric["entries"]},
        **{entry["parameterCode"]: entry for entry in classes["entries"]},
        **{entry["parameterCode"]: entry for entry in presence["entries"]},
    }
    if len(entries) != 47:
        raise ValueError("candidate preview label packs do not cover 47 rules")
    rows = []
    for rule in sorted(rules_pack["rules"], key=lambda value: value["parameterCode"]):
        code = rule["parameterCode"]
        reasons: set[str] = set()
        leads: list[dict[str, Any]] = []
        eligible_sources = 0
        scanned_pages = 0
        ocr_pages = 0
        for source_id in sorted(source_index):
            source = source_index[source_id]
            stages = source["stages"]
            relevant = [stage for stage in stages if stage == rule["expectedStage"]
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
            if len(stages) > 1:
                page_stages = source.get("pageStages", {})
                artifact = artifact_index.get(source_id)
                if (artifact is None or set(page_stages) !=
                        {str(number) for number in range(1, artifact["pageCount"] + 1)}):
                    reasons.add("SOURCE_PAGE_STAGE_UNRESOLVED")
                    continue
                if "UNRESOLVED" in page_stages.values():
                    reasons.add("SOURCE_PAGE_STAGE_UNRESOLVED")
            matching_stages = [stage for stage in relevant
                               if source.get("sectionCode") in rule[
                                   "requiredExpectedDrawingSections" if stage == "PD"
                                   else "requiredActualDrawingSections"]]
            if not matching_stages:
                reasons.add("DRAWING_SECTION_UNRESOLVED")
                continue
            artifact = artifact_index.get(source_id)
            if artifact is None:
                reasons.add("TEXT_ARTIFACT_MISSING")
                continue
            if len(stages) > 1 and not any(
                    stage in matching_stages for stage in source["pageStages"].values()):
                # A complete map may still leave some pages unresolved. Only
                # confirmed, relevant pages can contribute observations.
                continue
            eligible_sources += 1
            for page in artifact["pages"]:
                stage = (stages[0] if len(stages) == 1 else
                         source["pageStages"][str(page["pageNumber"])])
                if stage not in matching_stages:
                    continue
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    ocr_pages += 1
                    continue
                scanned_pages += 1
                page_leads: list[dict[str, Any]] = []
                for block_index, block in enumerate(page["blocks"]):
                    for line_index, line, line_start in _lines(block):
                        for match in _line_matches(line, entries[code], rule["family"]):
                            page_leads.append(_lead(
                                rule=rule, match=match, source=source,
                                artifact_hash=artifact_hashes[source_id], page=page,
                                block=block, block_index=block_index,
                                line_index=line_index, line=line, line_start=line_start,
                                object_id=object_id, stage=stage,
                            ))
                # A repeated numeric/class label on a page may describe a
                # second building, floor, variant, or table. Never choose one.
                if rule["family"] != "PRESENCE_SET":
                    counts = Counter(item["attribute"] for item in page_leads)
                    if any(count > 1 for count in counts.values()):
                        reasons.add("AMBIGUOUS_PAGE_LABEL")
                    page_leads = [item for item in page_leads
                                  if counts[item["attribute"]] == 1]
                leads.extend(page_leads)
        leads.sort(key=lambda item: (item["sourceFileId"], item["pageNumber"],
                                     item["locator"]["blockIndex"],
                                     item["locator"]["start"], item["attribute"],
                                     item.get("featureKey") or ""))
        if len(leads) > max_leads_per_code:
            reasons.add("LEAD_LIMIT_REACHED")
            leads = leads[:max_leads_per_code]
        if ocr_pages:
            reasons.add("OCR_REQUIRED_IN_SCOPE")
        if not eligible_sources:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if not leads:
            if scanned_pages:
                reasons.add("NO_EXACT_LABEL_LEAD")
        else:
            reasons.add("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED")
        rows.append({
            "parameterCode": code, "family": rule["family"], "ruleId": rule["ruleId"],
            "status": "ABSTAIN", "reasonCodes": sorted(reasons),
            "eligibleSourceCount": eligible_sources,
            "textScannedPageCount": scanned_pages, "ocrRequiredPageCount": ocr_pages,
            "leadCount": len(leads), "candidateLeads": leads,
        })
    result = {
        "schemaVersion": "candidate-family-preview-v1",
        "inputManifestHash": input_manifest_hash, "objectId": object_id,
        "scope": "RUN_COMMITTED_SOURCES", "purpose": "REVIEW_ONLY",
        "candidateRulePackSha256": rules_pack["packSha256"],
        "numericLabelPackSha256": numeric["labelPackSha256"],
        "classLabelPackSha256": classes["labelPackSha256"],
        "presenceLabelPackSha256": presence["labelPackSha256"],
        "codeRows": rows, "findingCount": None, "parameterCoverage": None,
        "outputCount": len(rows),
    }
    # The API accepts at most 1 MiB of preview JSON. Keep the earliest leads
    # per code, then trim one lead per code in reverse code order until the
    # whole canonical payload fits. A byte limit is review truncation, never
    # evidence that a value or element is absent.
    result["contentHash"] = "0" * 64
    trim_cursor = len(rows) - 1
    while len(json.dumps(result, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")) > _MAX_PREVIEW_BYTES:
        trimmed = False
        for offset in range(len(rows)):
            row_index = (trim_cursor - offset) % len(rows)
            row = rows[row_index]
            if not row["candidateLeads"]:
                continue
            row["candidateLeads"].pop()
            row["leadCount"] -= 1
            reason_codes = set(row["reasonCodes"])
            reason_codes.add("PREVIEW_BYTE_BUDGET_REACHED")
            if row["leadCount"] == 0:
                reason_codes.discard("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED")
                if row["textScannedPageCount"]:
                    reason_codes.add("NO_EXACT_LABEL_LEAD")
            row["reasonCodes"] = sorted(reason_codes)
            trim_cursor = (row_index - 1) % len(rows)
            trimmed = True
            break
        if not trimmed:
            raise ValueError("candidate preview metadata exceeds byte budget")
    result["contentHash"] = _hash({key: value for key, value in result.items()
                                    if key != "contentHash"})
    return result


def execute_durable_candidate_family_preview(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    """Load fenced, immutable text artifacts for a committed run."""
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_run_candidate_family_preview(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)


def load_durable_candidate_family_inputs(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return the same validated source and text inputs for preview and observations."""
    if not isinstance(lease, dict) or not isinstance(lease.get("inputs"), dict):
        raise ValueError("candidate preview lease inputs invalid")
    inputs = lease["inputs"]
    raw_sources, decisions = inputs.get("sourceFiles"), inputs.get("sourceDecisions", {})
    if not isinstance(raw_sources, list) or not isinstance(decisions, dict):
        raise ValueError("candidate preview source inputs invalid")
    source_ids = {raw.get("sourceFileId") for raw in raw_sources if isinstance(raw, dict)}
    if set(decisions) - source_ids:
        raise ValueError("candidate preview decision for unknown source")
    sources, artifacts = [], []
    for raw in raw_sources:
        if not isinstance(raw, dict) or not isinstance(raw.get("sourceFileId"), str):
            raise ValueError("candidate preview source metadata invalid")
        decision = decisions.get(raw["sourceFileId"])
        reviewed_section = decision.get("sectionCode") if isinstance(decision, dict) else None
        if raw.get("sectionCode") != reviewed_section:
            raise ValueError("candidate preview sectionCode differs from reviewed decision")
        if reviewed_section is not None:
            basis = decision.get("basis")
            if (not isinstance(basis, dict) or not isinstance(basis.get("reference"), str)
                    or not basis["reference"].strip()):
                raise ValueError("candidate preview reviewed section requires a reference")
        sources.append({
            "sourceFileId": raw["sourceFileId"], "objectId": lease.get("objectId"),
            "sha256": raw.get("sha256"), "stages": raw.get("stages"),
            "sectionCode": reviewed_section,
            **_reviewed_source(raw, decision),
        })
        if raw.get("mediaType") == "application/pdf":
            artifacts.append(download_text_artifact(lease, raw, attempt))
    return sources, artifacts
