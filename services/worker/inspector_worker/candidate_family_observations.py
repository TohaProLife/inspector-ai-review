"""Verified, review-only observations from run-scoped 47-code lexical leads.

This stage checks each lead against its committed document-text-v2 artifact and
catalog-pinned label policy. It never infers entity identity, complete set
membership, a finding, or parameter coverage. Numeric rows may carry a typed
fact proposal. Class rows preserve literal typed tokens without a class scale;
presence rows remain untyped until enumeration is independently reviewed.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .class_family_candidates import load_class_family_labels
from .fact_comparison import _decimal, make_fact_id
from .numeric_family_candidates import NUMERIC_FAMILIES, load_numeric_family_labels
from .parameter_routing import _validate_artifact
from .presence_family_candidates import load_presence_family_labels
from .run_candidate_family_preview import _line_matches, _lines, _source


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_PREVIEW_KEYS = {
    "schemaVersion", "inputManifestHash", "objectId", "scope", "purpose",
    "candidateRulePackSha256", "numericLabelPackSha256", "classLabelPackSha256",
    "presenceLabelPackSha256", "codeRows", "findingCount", "parameterCoverage",
    "outputCount", "contentHash",
}
_ROW_KEYS = {
    "parameterCode", "family", "ruleId", "status", "reasonCodes",
    "eligibleSourceCount", "textScannedPageCount", "ocrRequiredPageCount",
    "leadCount", "candidateLeads",
}
_LEAD_KEYS = {
    "schemaVersion", "status", "purpose", "parameterCode", "family",
    "attribute", "canonicalUnit", "matchedLabel", "rawValue", "rawUnit",
    "featureKey", "scopeTokens", "sourceFileId", "sourceSha256",
    "artifactSha256", "objectId", "stage", "sectionCode", "revisionStatus",
    "approvalStatus", "pageNumber", "coordinateSystem", "lineText",
    "blockTextSha256", "locator", "leadSha256",
}
_LOCATOR_KEYS = {"kind", "blockIndex", "lineIndex", "start", "end", "bboxMilliPoints"}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _index_inputs(
    object_id: str, sources: object, text_artifacts: object,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, str]]:
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("candidate observations require source and artifact arrays")
    source_index: dict[str, dict[str, Any]] = {}
    artifact_index: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("candidate observations duplicate source")
        source_index[source_id] = source
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("candidate observations artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifact_index:
            raise ValueError("candidate observations unknown or duplicate artifact")
        source = source_index[source_id]
        _validate_artifact(artifact, source)
        if any(int(number) > artifact["pageCount"] for number in source.get("pageStages", {})):
            raise ValueError("candidate observations pageStages exceeds artifact")
        artifact_index[source_id] = artifact
        artifact_hashes[source_id] = _hash(artifact)
    return source_index, artifact_index, artifact_hashes


def _validate_preview(preview: object, rules_pack: dict[str, Any],
                      labels: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(preview, dict) or set(preview) != _PREVIEW_KEYS:
        raise ValueError("candidate observations preview schema invalid")
    object_id, manifest_hash = preview["objectId"], preview["inputManifestHash"]
    if (preview["schemaVersion"] != "candidate-family-preview-v1"
            or preview["scope"] != "RUN_COMMITTED_SOURCES"
            or preview["purpose"] != "REVIEW_ONLY"
            or not isinstance(object_id, str) or not object_id.strip()
            or not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None
            or preview["findingCount"] is not None
            or preview["parameterCoverage"] is not None
            or preview["candidateRulePackSha256"] != rules_pack["packSha256"]
            or any(preview[key] != labels[family]["labelPackSha256"] for key, family in (
                ("numericLabelPackSha256", "numeric"),
                ("classLabelPackSha256", "class"),
                ("presenceLabelPackSha256", "presence")))
            or not isinstance(preview["contentHash"], str)
            or _SHA256.fullmatch(preview["contentHash"]) is None
            or preview["contentHash"] != _hash({key: value for key, value in preview.items()
                                                 if key != "contentHash"})):
        raise ValueError("candidate observations preview policy or content hash invalid")
    rows = preview["codeRows"]
    if (not isinstance(rows, list) or len(rows) != 47
            or preview["outputCount"] != len(rows)):
        raise ValueError("candidate observations require all 47 code rows")
    expected = sorted(rules_pack["rules"], key=lambda rule: rule["parameterCode"])
    for row, rule in zip(rows, expected, strict=True):
        if not isinstance(row, dict) or set(row) != _ROW_KEYS:
            raise ValueError("candidate observations code row schema invalid")
        leads, reasons = row["candidateLeads"], row["reasonCodes"]
        if (row["parameterCode"] != rule["parameterCode"]
                or row["family"] != rule["family"]
                or row["ruleId"] != rule["ruleId"]
                or row["status"] != "ABSTAIN"
                or not isinstance(reasons, list) or reasons != sorted(set(reasons))
                or any(not isinstance(reason, str) or not reason for reason in reasons)
                or not isinstance(leads, list) or len(leads) > 16
                or type(row["leadCount"]) is not int or row["leadCount"] != len(leads)
                or any(type(row[key]) is not int or row[key] < 0 for key in (
                    "eligibleSourceCount", "textScannedPageCount", "ocrRequiredPageCount"))):
            raise ValueError("candidate observations code row policy invalid")
    return rows


def _verified_lead(
    lead: object, rule: dict[str, Any], entry: dict[str, Any],
    object_id: str, source_index: dict[str, dict[str, Any]],
    artifact_index: dict[str, dict[str, Any]], artifact_hashes: dict[str, str],
    page_match_cache: dict[tuple[str, str, int], Counter[str]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if not isinstance(lead, dict) or set(lead) != _LEAD_KEYS:
        raise ValueError("candidate observations lead schema invalid")
    if (lead["schemaVersion"] != "candidate-family-run-lead-v1"
            or lead["status"] != "CANDIDATE" or lead["purpose"] != "REVIEW_ONLY"
            or lead["parameterCode"] != rule["parameterCode"]
            or lead["family"] != rule["family"]
            or lead["objectId"] != object_id
            or not isinstance(lead["leadSha256"], str)
            or _SHA256.fullmatch(lead["leadSha256"]) is None
            or lead["leadSha256"] != _hash({key: value for key, value in lead.items()
                                            if key != "leadSha256"})):
        raise ValueError("candidate observations lead identity or hash invalid")
    source_id = lead["sourceFileId"]
    if not isinstance(source_id, str) or source_id not in source_index or source_id not in artifact_index:
        raise ValueError("candidate observations lead source or artifact missing")
    source, artifact = source_index[source_id], artifact_index[source_id]
    if (lead["sourceSha256"] != source["sha256"]
            or lead["artifactSha256"] != artifact_hashes[source_id]
            or lead["sectionCode"] != source["sectionCode"]
            or lead["revisionStatus"] != "CURRENT"
            or source["revisionStatus"] != "CURRENT"
            or lead["approvalStatus"] != "APPROVED"
            or source["approvalStatus"] != "APPROVED"
            or lead["coordinateSystem"] != "PDF_BOTTOM_LEFT_MILLI_POINTS"):
        raise ValueError("candidate observations lead provenance or review gate invalid")
    page_number, locator = lead["pageNumber"], lead["locator"]
    if (type(page_number) is not int or page_number < 1 or page_number > artifact["pageCount"]
            or not isinstance(locator, dict) or set(locator) != _LOCATOR_KEYS
            or locator["kind"] != "DOCUMENT_TEXT_BLOCK_LINE"
            or any(type(locator[key]) is not int or locator[key] < 0 for key in
                   ("blockIndex", "lineIndex", "start", "end"))
            or not isinstance(lead["lineText"], str)):
        raise ValueError("candidate observations lead locator invalid")
    # document-text-v2 verifies contiguous page numbers, not storage order.
    page = next(item for item in artifact["pages"] if item["pageNumber"] == page_number)
    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
        raise ValueError("candidate observations OCR_REQUIRED page cannot emit observation")
    stages = source["stages"]
    if len(stages) > 1:
        mapping = source.get("pageStages", {})
        if set(mapping) != {str(number) for number in range(1, artifact["pageCount"] + 1)}:
            raise ValueError("candidate observations mixed page stage unresolved")
    stage = stages[0] if len(stages) == 1 else source["pageStages"][str(page_number)]
    side = ("Expected" if stage == rule["expectedStage"] else
            "Actual" if stage in rule["allowedActualStages"] else None)
    if (stage != lead["stage"] or side is None
            or source["sectionCode"] not in rule[f"required{side}DrawingSections"]):
        raise ValueError("candidate observations lead stage or drawing section invalid")
    index = locator["blockIndex"]
    if index >= len(page["blocks"]):
        raise ValueError("candidate observations block index invalid")
    block = page["blocks"][index]
    if (locator["bboxMilliPoints"] != block["bboxMilliPoints"]
            or lead["blockTextSha256"] != hashlib.sha256(block["text"].encode("utf-8")).hexdigest()):
        raise ValueError("candidate observations block provenance invalid")
    lines = list(_lines(block))
    if locator["lineIndex"] >= len(lines):
        raise ValueError("candidate observations line index invalid")
    _, line, line_start = lines[locator["lineIndex"]]
    if lead["lineText"] != line:
        raise ValueError("candidate observations line text differs from artifact")
    matches = _line_matches(line, entry, rule["family"])
    expected_match = {
        "attribute": lead["attribute"], "canonicalUnit": lead["canonicalUnit"],
        "matchedLabel": lead["matchedLabel"], "rawValue": lead["rawValue"],
        "rawUnit": lead["rawUnit"], "start": locator["start"] - line_start,
        "end": locator["end"] - line_start,
    }
    if rule["family"] == "PRESENCE_SET":
        expected_match.update(featureKey=lead["featureKey"], scopeTokens=lead["scopeTokens"])
    elif lead["featureKey"] is not None or lead["scopeTokens"] is not None:
        raise ValueError("candidate observations unexpected feature metadata")
    if (locator["start"] < line_start or locator["end"] > line_start + len(line)
            or locator["start"] >= locator["end"]
            or block["text"][locator["start"]:locator["end"]] != lead["rawValue"]
            or sum(match == expected_match for match in matches) != 1):
        raise ValueError("candidate observations lead does not match pinned label or value")
    if rule["family"] != "PRESENCE_SET":
        key = (rule["parameterCode"], source_id, page_number)
        if key not in page_match_cache:
            page_match_cache[key] = Counter(
                match["attribute"] for item in page["blocks"]
                for _, page_line, _ in _lines(item)
                for match in _line_matches(page_line, entry, rule["family"])
            )
        if page_match_cache[key][lead["attribute"]] != 1:
            raise ValueError("candidate observations ambiguous page label")
    return source, artifact, block


def _typed_numeric_fact(lead: dict[str, Any], block: dict[str, Any],
                        input_manifest_hash: str) -> dict[str, Any] | None:
    if not isinstance(lead["rawUnit"], str) or not lead["rawUnit"].strip():
        return None
    value = _decimal(lead["rawValue"])
    if value is None:
        return None
    if lead["canonicalUnit"] == "count" and value != value.to_integral_value():
        return None
    locator = lead["locator"]
    fact = {
        "schemaVersion": "typed-fact-v1", "parameterCode": lead["parameterCode"],
        "objectId": lead["objectId"], "inputManifestHash": input_manifest_hash,
        "attribute": lead["attribute"],
        "stage": lead["stage"], "sourceFileId": lead["sourceFileId"],
        "sourceSha256": lead["sourceSha256"],
        "artifactSha256": lead["artifactSha256"],
        "leadSha256": lead["leadSha256"], "pageNumber": lead["pageNumber"],
        "rawText": block["text"], "rawValue": lead["rawValue"],
        "rawUnit": lead["rawUnit"], "canonicalUnit": lead["canonicalUnit"],
        "locator": {"kind": "TEXT_BLOCK", "blockIndex": locator["blockIndex"],
                    "start": locator["start"], "end": locator["end"],
                    "bboxMilliPoints": locator["bboxMilliPoints"]},
    }
    return {"factId": make_fact_id(fact), **fact}


def _typed_class_fact(lead: dict[str, Any], block: dict[str, Any],
                      input_manifest_hash: str, entry: dict[str, Any]) -> dict[str, Any] | None:
    """Preserve a literal class token without claiming an ordered scale."""
    if lead["rawUnit"] is not None or lead["rawValue"] not in entry["values"]:
        return None
    locator = lead["locator"]
    fact = {
        "schemaVersion": "typed-fact-v1", "parameterCode": lead["parameterCode"],
        "objectId": lead["objectId"], "inputManifestHash": input_manifest_hash,
        "attribute": lead["attribute"], "stage": lead["stage"],
        "sourceFileId": lead["sourceFileId"], "sourceSha256": lead["sourceSha256"],
        "artifactSha256": lead["artifactSha256"], "leadSha256": lead["leadSha256"],
        "pageNumber": lead["pageNumber"], "rawText": block["text"],
        "rawValue": lead["rawValue"], "rawUnit": lead["canonicalUnit"],
        "canonicalUnit": lead["canonicalUnit"],
        "locator": {"kind": "TEXT_BLOCK", "blockIndex": locator["blockIndex"],
                    "start": locator["start"], "end": locator["end"],
                    "bboxMilliPoints": locator["bboxMilliPoints"]},
    }
    return {"factId": make_fact_id(fact), **fact}


def extract_candidate_family_observations(
    preview: dict[str, Any], sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Verify 47-code preview leads against exact source bytes and pinned policy.

    Failure to establish any supplied lead's provenance rejects the whole pack.
    Empty or truncated preview remains empty/truncated: no absence inference.
    """
    rules_pack = load_candidate_family_pack()
    labels = {
        "numeric": load_numeric_family_labels(),
        "class": load_class_family_labels(),
        "presence": load_presence_family_labels(),
    }
    if any(pack["candidatePackSha256"] != rules_pack["packSha256"]
           for pack in labels.values()):
        raise ValueError("candidate observations label policy differs from rules")
    rows = _validate_preview(preview, rules_pack, labels)
    object_id = preview["objectId"]
    source_index, artifact_index, artifact_hashes = _index_inputs(
        object_id, sources, text_artifacts)
    entries = {
        **{entry["parameterCode"]: entry for entry in labels["numeric"]["entries"]},
        **{entry["parameterCode"]: entry for entry in labels["class"]["entries"]},
        **{entry["parameterCode"]: entry for entry in labels["presence"]["entries"]},
    }
    if len(entries) != 47:
        raise ValueError("candidate observations label policies do not cover 47 codes")
    rules = {rule["parameterCode"]: rule for rule in rules_pack["rules"]}
    observations: list[dict[str, Any]] = []
    code_rows: list[dict[str, Any]] = []
    seen_leads: set[str] = set()
    page_match_cache: dict[tuple[str, str, int], Counter[str]] = {}
    for row in rows:
        rule = rules[row["parameterCode"]]
        before = len(observations)
        for lead in row["candidateLeads"]:
            source, _, block = _verified_lead(
                lead, rule, entries[rule["parameterCode"]], object_id,
                source_index, artifact_index, artifact_hashes, page_match_cache)
            if lead["leadSha256"] in seen_leads:
                raise ValueError("candidate observations duplicate lead")
            seen_leads.add(lead["leadSha256"])
            typed_fact = (_typed_numeric_fact(lead, block, preview["inputManifestHash"])
                          if rule["family"] in NUMERIC_FAMILIES else
                          _typed_class_fact(lead, block, preview["inputManifestHash"],
                                            entries[rule["parameterCode"]])
                          if rule["family"] == "CLASS_DECREASE" else None)
            if rule["family"] != "PRESENCE_SET" and typed_fact is None:
                raise ValueError("candidate observations value or unit invalid")
            observation = {
                "schemaVersion": "candidate-family-observation-v1",
                "status": "REVIEW_ONLY", "parameterCode": lead["parameterCode"],
                "family": lead["family"], "attribute": lead["attribute"],
                "canonicalUnit": lead["canonicalUnit"],
                "matchedLabel": lead["matchedLabel"],
                "rawValue": lead["rawValue"], "rawUnit": lead["rawUnit"],
                "featureKey": lead["featureKey"], "scopeTokens": lead["scopeTokens"],
                "objectId": object_id, "inputManifestHash": preview["inputManifestHash"],
                "sourceFileId": source["sourceFileId"],
                "sourceSha256": source["sha256"],
                "artifactSha256": lead["artifactSha256"],
                "stage": lead["stage"], "sectionCode": source["sectionCode"],
                "revisionStatus": source["revisionStatus"],
                "approvalStatus": source["approvalStatus"],
                "pageNumber": lead["pageNumber"], "lineText": lead["lineText"],
                "blockTextSha256": lead["blockTextSha256"],
                "locator": lead["locator"], "leadSha256": lead["leadSha256"],
                "candidateRulePackSha256": rules_pack["packSha256"],
                "numericLabelPackSha256": labels["numeric"]["labelPackSha256"],
                "classLabelPackSha256": labels["class"]["labelPackSha256"],
                "presenceLabelPackSha256": labels["presence"]["labelPackSha256"],
                "typedFact": typed_fact,
            }
            observation["observationId"] = _hash(observation)
            observations.append(observation)
        code_rows.append({
            "parameterCode": rule["parameterCode"], "family": rule["family"],
            "status": "REVIEW_ONLY", "observationCount": len(observations) - before,
            # Preview's NO_EXACT_LABEL_LEAD is also set when review gates
            # prevent every page scan. It cannot mean absence in that case.
            "reasonCodes": [reason for reason in row["reasonCodes"]
                            if reason != "NO_EXACT_LABEL_LEAD"
                            or row["textScannedPageCount"] > 0],
        })
    result = {
        "schemaVersion": "candidate-family-observations-v1", "purpose": "REVIEW_ONLY",
        "inputManifestHash": preview["inputManifestHash"], "objectId": object_id,
        "candidateRulePackSha256": rules_pack["packSha256"],
        "numericLabelPackSha256": labels["numeric"]["labelPackSha256"],
        "classLabelPackSha256": labels["class"]["labelPackSha256"],
        "presenceLabelPackSha256": labels["presence"]["labelPackSha256"],
        "codeRows": code_rows, "observations": observations,
        "outputCount": len(observations), "findingCount": None,
        "parameterCoverage": None,
    }
    result["contentHash"] = _hash(result)
    return result
