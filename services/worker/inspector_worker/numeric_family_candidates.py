"""Catalog-pinned, page-local numeric candidates from verified public PDF text.

No fact, entity, revision, norm, link, finding, or coverage is inferred here.
Each returned row is a reviewer lead bound to one immutable indexed line.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

from .candidate_family_rules import CATALOG_PATH, RULES_DIR, load_candidate_family_pack
from .indexed_numeric_rows import _pattern, extract_labeled_numeric_rows
from .indexed_page_evidence import load_indexed_page_evidence


LABEL_PACK_PATH = RULES_DIR / "numeric-family-labels-v1.json"
NUMERIC_FAMILIES = frozenset({"DECREASE", "INCREASE", "DIFFERENT", "RELATIVE_DELTA",
                              "RELATIVE_INCREASE", "LOWER_BOUND", "UPPER_BOUND"})
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_CODE = re.compile(r"[A-Z0-9]+-[0-9]{3}\Z")
_ATTRIBUTE = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
UNIT_ALIASES: dict[str, frozenset[str]] = {
    "m": frozenset({"м", "m"}),
    "m2": frozenset({"м²", "м2", "m2", "кв.м"}),
    "m3": frozenset({"м³", "м3", "m3"}),
    "mm": frozenset({"мм", "mm"}),
    "count": frozenset({"шт.", "шт", "чел.", "чел"}),
    "kW": frozenset({"кВт", "kW"}),
    "m3/day": frozenset({"м³/сут", "м3/сут"}),
    "Gcal/h": frozenset({"Гкал/ч"}),
    "m3/h": frozenset({"м³/ч", "м3/ч"}),
    "t": frozenset({"т", "t"}),
    "day": frozenset({"дни", "день", "дня", "сут", "сут."}),
    "W/(m*C)": frozenset({"Вт/(м·С)", "Вт/(м·°С)", "Вт/(м·C)"}),
    "kWh/m2": frozenset({"кВт·ч/м²", "кВт·ч/м2"}),
    "thousand_rub": frozenset({"тыс. руб.", "тыс руб.", "тыс.руб."}),
}


class NumericFamilyCandidateError(ValueError):
    """Numeric label policy, source eligibility, or section proof is unresolved."""


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _literal_list(value: object, *, limit: int, max_length: int) -> bool:
    return (isinstance(value, list) and 1 <= len(value) <= limit
            and all(isinstance(item, str) and item == item.strip()
                    and 0 < len(item) <= max_length and "\n" not in item and "\r" not in item
                    for item in value)
            and len({item.casefold() for item in value}) == len(value))


def load_numeric_family_labels(
    path: Path = LABEL_PACK_PATH,
    *,
    catalog_path: Path = CATALOG_PATH,
) -> dict[str, Any]:
    """Reject missing, extra, drifting, or ambiguous labels for all numeric rules."""
    try:
        pack = load_candidate_family_pack(catalog_path=catalog_path)
        catalog_bytes = catalog_path.read_bytes()
        catalog = {row["parameter_code"]: row for row in
                   (json.loads(line) for line in catalog_bytes.decode("utf-8").splitlines()
                    if line.strip())}
        labels = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        raise NumericFamilyCandidateError("numeric label policy or pinned catalog invalid") from error
    if (not isinstance(labels, dict)
            or set(labels) != {"schemaVersion", "version", "catalogSha256", "candidatePackSha256",
                               "publicManifestSha256", "disposition", "entries",
                               "verifiedAliasEvidence"}
            or (labels["schemaVersion"], labels["version"]) not in {
                ("numeric-family-labels-v1", "1"),
                ("numeric-family-labels-v2", "2"),
            }
            or labels["disposition"] != "REVIEW_ONLY"
            or labels["catalogSha256"] != hashlib.sha256(catalog_bytes).hexdigest()
            or labels["candidatePackSha256"] != pack["packSha256"]
            or not isinstance(labels["publicManifestSha256"], str)
            or not _HASH.fullmatch(labels["publicManifestSha256"])
            or not isinstance(labels["entries"], list)):
        raise NumericFamilyCandidateError("numeric label policy schema or SHA mismatch")
    numeric_rules = {rule["parameterCode"]: rule for rule in pack["rules"]
                     if rule["family"] in NUMERIC_FAMILIES}
    if len(labels["entries"]) != len(numeric_rules):
        raise NumericFamilyCandidateError("numeric label policy has missing or extra codes")
    seen_codes: set[str] = set()
    for entry in labels["entries"]:
        if not isinstance(entry, dict) or set(entry) != {
                "parameterCode", "catalogName", "family", "attributes"}:
            raise NumericFamilyCandidateError("numeric label entry invalid")
        code = entry["parameterCode"]
        if (not isinstance(code, str) or not _CODE.fullmatch(code) or code in seen_codes
                or code not in numeric_rules):
            raise NumericFamilyCandidateError("numeric label code missing, duplicate, or unknown")
        seen_codes.add(code)
        rule = numeric_rules[code]
        if (entry["family"] != rule["family"]
                or entry["catalogName"] != catalog[code]["parameter_name"]
                or not isinstance(entry["attributes"], list)
                or len(entry["attributes"]) != len(rule["attributes"])):
            raise NumericFamilyCandidateError(f"numeric label/catalog drift: {code}")
        expected_attributes = {item["key"]: item["canonicalUnit"]
                               for item in rule["attributes"]}
        seen_attributes: set[str] = set()
        seen_labels: set[str] = set()
        for attribute in entry["attributes"]:
            if not isinstance(attribute, dict) or set(attribute) != {
                    "key", "canonicalUnit", "labels", "unitAliases"}:
                raise NumericFamilyCandidateError(f"numeric attribute definition invalid: {code}")
            key = attribute["key"]
            if (not isinstance(key, str) or not _ATTRIBUTE.fullmatch(key)
                    or key in seen_attributes or expected_attributes.get(key) != attribute["canonicalUnit"]
                    or not _literal_list(attribute["labels"], limit=8, max_length=120)
                    or not _literal_list(attribute["unitAliases"], limit=8, max_length=32)
                    or not set(attribute["unitAliases"]).issubset(
                        UNIT_ALIASES.get(attribute["canonicalUnit"], frozenset()))):
                raise NumericFamilyCandidateError(f"numeric attribute/label/unit invalid: {code}")
            if attribute["canonicalUnit"] == "count":
                count_unit = catalog[code]["unit"]
                spellings = ({"шт.", "шт"} if count_unit == "шт."
                             else {"чел.", "чел"} if count_unit == "чел." else set())
                if not set(attribute["unitAliases"]).issubset(spellings):
                    raise NumericFamilyCandidateError(f"count unit differs from catalog: {code}")
            if any(label.casefold() in seen_labels for label in attribute["labels"]):
                raise NumericFamilyCandidateError(f"numeric labels overlap attributes: {code}")
            seen_attributes.add(key)
            seen_labels.update(label.casefold() for label in attribute["labels"])
        if seen_attributes != set(expected_attributes):
            raise NumericFamilyCandidateError(f"numeric attribute missing: {code}")
    if seen_codes != set(numeric_rules):
        raise NumericFamilyCandidateError("numeric label policy does not cover all numeric candidates")
    alias_evidence = labels["verifiedAliasEvidence"]
    if not isinstance(alias_evidence, list) or not alias_evidence:
        raise NumericFamilyCandidateError("verified public alias evidence missing")
    observed: set[tuple[str, str, str, str]] = set()
    by_code = {entry["parameterCode"]: entry for entry in labels["entries"]}
    for alias in alias_evidence:
        if (not isinstance(alias, dict) or set(alias) != {
                "parameterCode", "attribute", "label", "unitAlias", "samples"}):
            raise NumericFamilyCandidateError("verified alias record invalid")
        code, key, label, unit = (alias[name] for name in
                                  ("parameterCode", "attribute", "label", "unitAlias"))
        if not all(isinstance(value, str) for value in (code, key, label, unit)):
            raise NumericFamilyCandidateError("verified alias key invalid")
        identity = (code, key, label, unit)
        if code not in by_code or identity in observed:
            raise NumericFamilyCandidateError("verified alias code unknown or duplicate")
        observed.add(identity)
        attribute = next((item for item in by_code[code]["attributes"]
                          if item["key"] == key), None)
        if (attribute is None or label not in attribute["labels"]
                or unit not in attribute["unitAliases"]
                or not isinstance(alias["samples"], list) or not alias["samples"]):
            raise NumericFamilyCandidateError("verified alias absent from policy or samples")
        for sample in alias["samples"]:
            if (not isinstance(sample, dict) or set(sample) != {
                    "sourceFileId", "sourceSha256", "stage", "manifestSection",
                    "pageNumber", "blockIndex", "lineIndex", "pageArtifactSha256",
                    "lineText", "lineTextSha256", "sourceGate"}
                    or not isinstance(sample["sourceFileId"], str)
                    or not re.fullmatch(r"F[0-9]{4}", sample["sourceFileId"])
                    or not isinstance(sample["sourceSha256"], str)
                    or not _HASH.fullmatch(sample["sourceSha256"])
                    or not isinstance(sample["pageArtifactSha256"], str)
                    or not _HASH.fullmatch(sample["pageArtifactSha256"])
                    or not isinstance(sample["stage"], str)
                    or not isinstance(sample["manifestSection"], str)
                    or any(type(sample[name]) is not int or sample[name] < (1 if name == "pageNumber" else 0)
                           for name in ("pageNumber", "blockIndex", "lineIndex"))
                    or not isinstance(sample["lineText"], str) or len(sample["lineText"]) > 512
                    or hashlib.sha256(sample["lineText"].encode()).hexdigest()
                       != sample["lineTextSha256"]
                    or _pattern(label, [unit]).fullmatch(sample["lineText"]) is None
                    or sample["sourceGate"] not in {"INELIGIBLE_STAGE", "SECTION_UNRESOLVED"}):
                raise NumericFamilyCandidateError("verified alias sample invalid")
            rule = numeric_rules[code]
            if sample["stage"] == rule["expectedStage"]:
                side = "expected"
            elif sample["stage"] in rule["allowedActualStages"]:
                side = "actual"
            else:
                side = None
            expected_gate = ("INELIGIBLE_STAGE" if side is None else
                             "SECTION_UNRESOLVED" if rule["manifestSectionStatus"][side]
                             == "UNKNOWN_ABSTAIN" else None)
            if sample["sourceGate"] != expected_gate:
                raise NumericFamilyCandidateError("verified alias source gate incorrect")
    return {**labels, "labelPackSha256": _hash(labels), "rules": numeric_rules}


def _bound_section_proof(proof: Mapping[str, Any] | None, *, stage: str,
                         section: str, drawing_section: str, source_id: str,
                         source_sha: str, manifest_sha: str) -> bool:
    return (isinstance(proof, Mapping)
            and set(proof) == {"status", "reference", "sourceFileId",
                               "sourceSha256", "manifestSha256", "stage",
                               "manifestSection", "drawingSection"}
            and proof.get("status") == "VERIFIED"
            and isinstance(proof.get("reference"), str) and bool(proof["reference"].strip())
            and proof.get("sourceFileId") == source_id
            and proof.get("sourceSha256") == source_sha
            and proof.get("manifestSha256") == manifest_sha
            and proof.get("stage") == stage
            and proof.get("manifestSection") == section
            and proof.get("drawingSection") == drawing_section)


def _eligible_source(rule: Mapping[str, Any], *, stage: str, section: str,
                     drawing_section: str, source_id: str, source_sha: str,
                     manifest_sha: str, section_resolution: Mapping[str, Any] | None,
                     drawing_section_proof: Mapping[str, Any] | None) -> None:
    if stage == rule["expectedStage"]:
        side = "expected"
    elif stage in rule["allowedActualStages"]:
        side = "actual"
    else:
        raise NumericFamilyCandidateError("source stage is ineligible for numeric rule")
    if drawing_section not in rule[f"required{side.title()}DrawingSections"]:
        raise NumericFamilyCandidateError("drawing section is not verified for numeric rule")
    manifest_status = rule["manifestSectionStatus"][side]
    if manifest_status == "EXACT_CATEGORY":
        if section not in rule[f"required{side.title()}Sections"]:
            raise NumericFamilyCandidateError("manifest section is ineligible for numeric rule")
        if section_resolution is not None:
            raise NumericFamilyCandidateError("unneeded section resolution supplied")
        if drawing_section == section and drawing_section_proof is not None:
            raise NumericFamilyCandidateError("unneeded drawing mark proof supplied")
        if drawing_section != section and not _bound_section_proof(
                drawing_section_proof, stage=stage, section=section,
                drawing_section=drawing_section, source_id=source_id,
                source_sha=source_sha, manifest_sha=manifest_sha):
            raise NumericFamilyCandidateError("drawing mark proof required")
    elif manifest_status == "UNKNOWN_ABSTAIN":
        if not _bound_section_proof(section_resolution, stage=stage, section=section,
                                    drawing_section=drawing_section, source_id=source_id,
                                    source_sha=source_sha, manifest_sha=manifest_sha):
            raise NumericFamilyCandidateError("exact drawing section resolution required")
        if drawing_section_proof is not None:
            raise NumericFamilyCandidateError("unneeded drawing mark proof supplied")
    else:
        raise NumericFamilyCandidateError("unsupported manifest section policy")


def extract_indexed_numeric_family_candidates(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    block_indices: Sequence[int], parameter_code: str, drawing_section: str,
    section_resolution: Mapping[str, Any] | None = None,
    drawing_section_proof: Mapping[str, Any] | None = None,
    label_pack_path: Path = LABEL_PACK_PATH,
) -> list[dict[str, Any]]:
    """Extract exact one-line numeric leads; ambiguous values yield no candidate.

    The index adapter verifies public manifest scope, source SHA, page artifact
    SHA, text quality, source completeness, and selected block provenance.
    """
    policy = load_numeric_family_labels(label_pack_path)
    rule = policy["rules"].get(parameter_code)
    if rule is None:
        raise NumericFamilyCandidateError("numeric parameter code is not catalog-pinned")
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=expected_object_id, expected_stage=expected_stage,
        expected_section=expected_section, block_indices=block_indices)
    _eligible_source(rule, stage=evidence["stage"], section=evidence["section"],
                     drawing_section=drawing_section, source_id=evidence["sourceFileId"],
                     source_sha=evidence["sourceSha256"],
                     manifest_sha=evidence["manifestSha256"],
                     section_resolution=section_resolution,
                     drawing_section_proof=drawing_section_proof)
    entry = next(item for item in policy["entries"] if item["parameterCode"] == parameter_code)
    matches: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for attribute in entry["attributes"]:
        for label in attribute["labels"]:
            definitions = {attribute["key"]: {"label": label,
                                               "unitAliases": attribute["unitAliases"]}}
            for observation in extract_labeled_numeric_rows(evidence, definitions):
                matches.append((observation, attribute, label))
    # Multiple exact rows for the same attribute on a selected page can refer
    # to different buildings, floors, or alternatives. Never choose one.
    counts = Counter(observation["attribute"] for observation, _, _ in matches)
    results: list[dict[str, Any]] = []
    for observation, attribute, label in matches:
        if counts[observation["attribute"]] != 1:
            continue
        row = {
            "schemaVersion": "numeric-family-candidate-v1", "status": "CANDIDATE",
            "disposition": "REVIEW_ONLY", "executionPolicy": "NON_EXECUTING_ABSTAIN",
            "parameterCode": parameter_code, "family": rule["family"],
            "ruleId": rule["ruleId"], "rulePackSha256": policy["candidatePackSha256"],
            "labelPackSha256": policy["labelPackSha256"],
            "attribute": observation["attribute"],
            "canonicalUnit": attribute["canonicalUnit"], "matchedLabel": label,
            "sourceFileId": observation["sourceFileId"],
            "sourceSha256": observation["sourceSha256"],
            "manifestSha256": evidence["manifestSha256"],
            "objectId": observation["objectId"], "stage": observation["stage"],
            "manifestSection": observation["section"], "drawingSection": drawing_section,
            "sectionResolutionReference": (section_resolution["reference"]
                                           if section_resolution is not None else None),
            "drawingSectionProofReference": (drawing_section_proof["reference"]
                                              if drawing_section_proof is not None else None),
            "pageNumber": observation["pageNumber"],
            "pageArtifactSha256": observation["pageArtifactSha256"],
            "pageEvidenceSha256": observation["pageEvidenceSha256"],
            "parserProvenance": observation["parserProvenance"],
            "rawValue": observation["rawValue"], "rawUnit": observation["rawUnit"],
            "lineText": observation["lineText"], "locator": observation["locator"],
        }
        row["candidateSha256"] = _hash(row)
        results.append(row)
    return results
