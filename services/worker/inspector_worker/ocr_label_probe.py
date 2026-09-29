"""Read-only lexical leads from one explicitly selected, cached public OCR page.

This is a bounded review aid. It never parses an engineering value, resolves a
drawing section, establishes absence, emits a typed fact, or runs a rule.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Mapping, Sequence

from .class_family_candidates import load_class_family_labels
from .numeric_family_candidates import load_numeric_family_labels
from .ocr_family_evidence import load_ocr_family_evidence
from .ocr_pilot import canonical_hash
from .presence_family_candidates import load_presence_family_labels


SCHEMA_VERSION = "ocr-candidate-label-probe-v1"
MAX_LEADS = 512


class OcrLabelProbeError(ValueError):
    """Selected OCR page or pinned label policy cannot be probed safely."""


def _normalized(text: str) -> str:
    return text.casefold().replace("ё", "е")


def _has_label(text: str, label: str) -> bool:
    return re.search(r"(?<!\w)" + re.escape(_normalized(label)) + r"(?!\w)",
                     _normalized(text)) is not None


def _source_gate(rule: Mapping[str, Any], evidence: Mapping[str, Any]) -> str:
    """Manifest metadata only; OCR text cannot prove section or page stage."""
    if evidence["stage"] == rule["expectedStage"]:
        side = "Expected"
    elif evidence["stage"] in rule["allowedActualStages"]:
        side = "Actual"
    else:
        return "STAGE_OUTSIDE_RULE"
    if rule["manifestSectionStatus"][side.lower()] == "UNKNOWN_ABSTAIN":
        return "DRAWING_SECTION_RESOLUTION_REQUIRED"
    if evidence["section"] not in rule[f"required{side}Sections"]:
        return "MANIFEST_SECTION_OUTSIDE_RULE"
    return "PAGE_STAGE_SECTION_AND_ENTITY_REVIEW_REQUIRED"


def _label_records(numeric_label_pack_path: Path | None = None) -> tuple[list[dict[str, Any]], dict[str, str]]:
    numeric = (load_numeric_family_labels(numeric_label_pack_path)
               if numeric_label_pack_path is not None else load_numeric_family_labels())
    classes = load_class_family_labels()
    presence = load_presence_family_labels()
    policies = {"numeric": numeric, "class": classes, "presence": presence}
    records: list[dict[str, Any]] = []
    for family_name, policy in policies.items():
        for entry in policy["entries"]:
            code = entry["parameterCode"]
            rule = policy["rules"][code]
            if family_name == "numeric":
                labels = ((attribute["key"], "ATTRIBUTE", None, label)
                          for attribute in entry["attributes"]
                          for label in attribute["labels"])
            elif family_name == "class":
                labels = ((entry["attribute"], "ATTRIBUTE", None, label)
                          for label in entry["labels"])
            else:
                labels = (
                    [(entry["attribute"], "FEATURE", feature["featureKey"], label)
                     for feature in entry["features"] for label in feature["labels"]]
                    + [(entry["attribute"], "SCOPE", group["scopeKey"], label)
                       for group in entry["scopeGroups"] for label in group["labels"]]
                )
            for attribute, role, feature_key, label in labels:
                records.append({
                    "parameterCode": code, "family": rule["family"],
                    "attribute": attribute, "labelRole": role,
                    "featureOrScopeKey": feature_key, "literalLabel": label,
                    "ruleId": rule["ruleId"], "rule": rule,
                    "labelPackSha256": policy["labelPackSha256"],
                })
    codes = {record["parameterCode"] for record in records}
    if len(codes) != 47:
        raise OcrLabelProbeError("pinned OCR label policies do not cover 47 candidates")
    records.sort(key=lambda row: (row["parameterCode"], row["attribute"],
                                  row["labelRole"], row["literalLabel"]))
    return records, {name: policy["labelPackSha256"] for name, policy in policies.items()}


def _locator(line: Mapping[str, Any]) -> dict[str, Any]:
    return {"lineIndex": line["lineIndex"], "text": line["text"],
            "score": line["score"], "bboxPx": line["bboxPx"]}


def _crosses_boundary(first: str, second: str, label: str) -> bool:
    """Only adjacent original OCR lines; a joined label is uncertain."""
    a, b = _normalized(first.strip()), _normalized(second.strip())
    if not a or not b or len(a) > 160 or len(b) > 160:
        return False
    expression = re.compile(r"(?<!\w)" + re.escape(_normalized(label)) + r"(?!\w)")
    for glue in (" ", ""):
        joined = a + glue + b
        boundary = len(a)
        if any(match.start() < boundary < match.end()
               for match in expression.finditer(joined)):
            return True
    return False


def probe_cached_ocr_labels(
    manifest_path: Path, index_root: Path, cache_root: Path,
    source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    line_indices: Sequence[int], dpi: int, script: str,
    renderer_profile_id: str, provider_profile_id: str,
    numeric_label_pack_path: Path | None = None,
) -> dict[str, Any]:
    """Return bounded literal/fragment leads with exact OCR cache provenance."""
    try:
        evidence = load_ocr_family_evidence(
            manifest_path, index_root, cache_root, source_id, page_number,
            expected_object_id=expected_object_id, expected_stage=expected_stage,
            expected_section=expected_section, line_indices=line_indices, dpi=dpi,
            script=script, renderer_profile_id=renderer_profile_id,
            provider_profile_id=provider_profile_id)
        records, label_hashes = _label_records(numeric_label_pack_path)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise OcrLabelProbeError("public OCR evidence or pinned label policy invalid") from error
    if (evidence.get("schemaVersion") != "ocr-page-family-evidence-v1"
            or evidence.get("evidenceKind") != "OCR"
            or evidence.get("indexDisposition") != "OCR_REQUIRED"
            or evidence.get("coordinateSystem") != "IMAGE_TOP_LEFT_PIXELS"
            or evidence.get("evidenceSha256") != canonical_hash({
                key: value for key, value in evidence.items() if key != "evidenceSha256"})):
        raise OcrLabelProbeError("OCR evidence integrity or coordinate system invalid")
    lines = evidence["lines"]
    leads: list[dict[str, Any]] = []
    for record in records:
        base = {key: record[key] for key in (
            "parameterCode", "family", "attribute", "labelRole", "featureOrScopeKey",
            "literalLabel", "ruleId", "labelPackSha256")}
        source_gate = _source_gate(record["rule"], evidence)
        for line in lines:
            if _has_label(line["text"], record["literalLabel"]):
                leads.append({**base, "matchKind": "LITERAL_LABEL_IN_SINGLE_OCR_LINE",
                              "sourceGate": source_gate, "locators": [_locator(line)]})
        for first, second in zip(lines, lines[1:]):
            if second["lineIndex"] != first["lineIndex"] + 1:
                continue
            if (_has_label(first["text"], record["literalLabel"])
                    or _has_label(second["text"], record["literalLabel"])):
                continue
            if _crosses_boundary(first["text"], second["text"], record["literalLabel"]):
                leads.append({**base, "matchKind": "ADJACENT_OCR_FRAGMENT_UNCERTAIN",
                              "sourceGate": source_gate,
                              "locators": [_locator(first), _locator(second)]})
        if len(leads) > MAX_LEADS:
            raise OcrLabelProbeError("selected page has too many lexical leads")
    result = {
        "schemaVersion": SCHEMA_VERSION, "status": "ABSTAIN",
        "disposition": "REVIEW_ONLY", "executionPolicy": "NON_EXECUTING_ABSTAIN",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "interpretation": "LEXICAL_LEADS_ONLY_NOT_ABSENCE_PROOF",
        "sourceFileId": evidence["sourceFileId"],
        "sourceSha256": evidence["sourceSha256"],
        "sourceRelativePath": evidence["sourceRelativePath"],
        "objectId": evidence["objectId"], "stage": evidence["stage"],
        "manifestSection": evidence["section"],
        "manifestSha256": evidence["manifestSha256"],
        "pageNumber": evidence["pageNumber"],
        "indexVersionHash": evidence["indexVersionHash"],
        "cacheKey": evidence["cacheKey"],
        "cacheContentHash": evidence["cacheContentHash"],
        "artifactContentHash": evidence["artifactContentHash"],
        "ocrEvidenceSha256": evidence["evidenceSha256"],
        "coordinateSystem": evidence["coordinateSystem"],
        "render": evidence["render"], "provider": evidence["provider"],
        "cachedLineCount": evidence["cachedLineCount"],
        "selectedLineIndices": evidence["selectedLineIndices"],
        "labelPackSha256": label_hashes,
        "pinnedCodeCount": 47, "leadCount": len(leads), "leads": leads,
    }
    result["reportSha256"] = canonical_hash(result)
    return result
