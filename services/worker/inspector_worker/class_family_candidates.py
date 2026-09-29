"""Strict, review-only class tokens from verified public indexed PDF lines.

No ordering, entity, PD/RD link, revision, finding, or coverage is inferred.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

from .candidate_family_rules import CATALOG_PATH, RULES_DIR, load_candidate_family_pack
from .indexed_page_evidence import load_indexed_page_evidence


LABEL_PACK_PATH = RULES_DIR / "class-family-labels-v1.json"
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_CODE = re.compile(r"[A-Z0-9]+-[0-9]{3}\Z")
_VALUES: dict[str, tuple[str, ...]] = {
    "reliability_category": ("1", "2", "3", "I", "II", "III"),
    "energy_class": ("A", "B", "C", "D", "E", "F", "G", "А", "В", "С", "Д", "Е"),
    "fire_resistance_degree": ("I", "II", "III", "IV", "V"),
    "structural_fire_hazard_class": tuple(
        f"{prefix}{number}" for prefix in ("С", "C") for number in range(4)
    ),
    "finish_fire_class": tuple(
        f"{prefix}{number}" for prefix in ("КМ", "KM") for number in range(6)
    ),
    "fire_rating": tuple(
        f"{prefix}-{minutes}" for prefix in ("EI", "E", "I")
        for minutes in (15, 30, 45, 60, 90, 120)
    ),
}


class ClassFamilyCandidateError(ValueError):
    """Class policy, indexed evidence, or source/section proof is unresolved."""


def _sha(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def load_class_family_labels(
    path: Path = LABEL_PACK_PATH, *, catalog_path: Path = CATALOG_PATH,
) -> dict[str, Any]:
    """Load all eight catalog-bound CLASS_DECREASE candidate definitions."""
    try:
        candidate_pack = load_candidate_family_pack(catalog_path=catalog_path)
        catalog_bytes = catalog_path.read_bytes()
        catalog = {row["parameter_code"]: row for row in
                   (json.loads(line) for line in catalog_bytes.decode("utf-8").splitlines()
                    if line.strip())}
        labels = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        raise ClassFamilyCandidateError("class policy or pinned catalog invalid") from error
    rules = {rule["parameterCode"]: rule for rule in candidate_pack["rules"]
             if rule["family"] == "CLASS_DECREASE"}
    if (len(rules) != 8 or not isinstance(labels, dict)
            or set(labels) != {"schemaVersion", "version", "catalogSha256",
                               "candidatePackSha256", "disposition", "entries"}
            or labels["schemaVersion"] != "class-family-labels-v1"
            or labels["version"] != "1" or labels["disposition"] != "REVIEW_ONLY"
            or labels["catalogSha256"] != hashlib.sha256(catalog_bytes).hexdigest()
            or labels["candidatePackSha256"] != candidate_pack["packSha256"]
            or not isinstance(labels["entries"], list)
            or len(labels["entries"]) != len(rules)):
        raise ClassFamilyCandidateError("class policy schema, SHA, or code count invalid")
    seen: set[str] = set()
    for entry in labels["entries"]:
        if (not isinstance(entry, dict)
                or set(entry) != {"parameterCode", "catalogName", "attribute",
                                  "canonicalUnit", "labels", "values"}):
            raise ClassFamilyCandidateError("class label entry invalid")
        code = entry["parameterCode"]
        if (not isinstance(code, str) or _CODE.fullmatch(code) is None
                or code not in rules or code in seen):
            raise ClassFamilyCandidateError("class code missing, duplicate, or unknown")
        seen.add(code)
        rule = rules[code]
        expected_attribute = rule["attributes"]
        if (len(expected_attribute) != 1 or entry["catalogName"] != catalog[code]["parameter_name"]
                or entry["attribute"] != expected_attribute[0]["key"]
                or entry["canonicalUnit"] != expected_attribute[0]["canonicalUnit"]
                or entry["canonicalUnit"] not in _VALUES
                or entry["labels"] != [entry["catalogName"]]
                or entry["values"] != list(_VALUES[entry["canonicalUnit"]])):
            raise ClassFamilyCandidateError(f"class labels or values differ from policy: {code}")
    if seen != set(rules):
        raise ClassFamilyCandidateError("class label policy does not cover eight candidate codes")
    return {**labels, "labelPackSha256": _sha(labels), "rules": rules}


def _bound_proof(proof: Mapping[str, Any] | None, *, evidence: Mapping[str, Any],
                 drawing_section: str) -> bool:
    return (isinstance(proof, Mapping)
            and set(proof) == {"status", "reference", "sourceFileId", "sourceSha256",
                               "manifestSha256", "stage", "manifestSection", "drawingSection"}
            and proof.get("status") == "VERIFIED"
            and isinstance(proof.get("reference"), str) and bool(proof["reference"].strip())
            and proof.get("sourceFileId") == evidence["sourceFileId"]
            and proof.get("sourceSha256") == evidence["sourceSha256"]
            and proof.get("manifestSha256") == evidence["manifestSha256"]
            and proof.get("stage") == evidence["stage"]
            and proof.get("manifestSection") == evidence["section"]
            and proof.get("drawingSection") == drawing_section)


def _eligible(rule: Mapping[str, Any], evidence: Mapping[str, Any], drawing_section: str,
              section_resolution: Mapping[str, Any] | None,
              drawing_section_proof: Mapping[str, Any] | None) -> None:
    stage, section = evidence["stage"], evidence["section"]
    if stage == rule["expectedStage"]:
        side = "Expected"
    elif stage in rule["allowedActualStages"]:
        side = "Actual"
    else:
        raise ClassFamilyCandidateError("source stage is ineligible for class rule")
    if drawing_section not in rule[f"required{side}DrawingSections"]:
        raise ClassFamilyCandidateError("drawing section is ineligible for class rule")
    status = rule["manifestSectionStatus"][side.lower()]
    if status == "EXACT_CATEGORY":
        if section not in rule[f"required{side}Sections"]:
            raise ClassFamilyCandidateError("manifest section is ineligible for class rule")
        if section_resolution is not None:
            raise ClassFamilyCandidateError("unneeded section resolution supplied")
        if drawing_section == section:
            if drawing_section_proof is not None:
                raise ClassFamilyCandidateError("unneeded drawing mark proof supplied")
        elif not _bound_proof(drawing_section_proof, evidence=evidence,
                              drawing_section=drawing_section):
            raise ClassFamilyCandidateError("drawing mark proof required")
    elif status == "UNKNOWN_ABSTAIN":
        if not _bound_proof(section_resolution, evidence=evidence,
                            drawing_section=drawing_section):
            raise ClassFamilyCandidateError("exact drawing section resolution required")
        if drawing_section_proof is not None:
            raise ClassFamilyCandidateError("unneeded drawing mark proof supplied")
    else:
        raise ClassFamilyCandidateError("unsupported manifest section policy")


def _verified_lines(evidence: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    digest = evidence.get("evidenceSha256")
    quality = evidence.get("quality")
    if (evidence.get("schemaVersion") != "indexed-page-evidence-v1"
            or evidence.get("candidateStatus") != "CANDIDATE"
            or not isinstance(quality, Mapping)
            or quality.get("disposition") != "TEXT_LAYER_CANDIDATE"
            or not isinstance(digest, str) or _HASH.fullmatch(digest) is None
            or digest != _sha({key: value for key, value in evidence.items()
                               if key != "evidenceSha256"})):
        raise ClassFamilyCandidateError("page evidence hash or quality invalid")
    indices = evidence.get("selectedBlockIndices")
    blocks = evidence.get("blocks")
    lines = evidence.get("lines")
    if (not isinstance(indices, list) or not 1 <= len(indices) <= 64
            or indices != sorted(set(indices))
            or any(type(index) is not int or index < 0 for index in indices)
            or not isinstance(blocks, list) or len(blocks) != len(indices)
            or not isinstance(lines, list) or len(lines) > 512):
        raise ClassFamilyCandidateError("selected indexed blocks or lines invalid")
    block_map = {block.get("blockIndex"): block for block in blocks
                 if isinstance(block, Mapping)}
    if set(block_map) != set(indices):
        raise ClassFamilyCandidateError("indexed block address invalid")
    seen_lines: set[tuple[int, int]] = set()
    for line in lines:
        if not isinstance(line, Mapping):
            raise ClassFamilyCandidateError("indexed line invalid")
        address = (line.get("blockIndex"), line.get("lineIndex"))
        block = block_map.get(address[0])
        bbox = line.get("bboxMilliPoints")
        if (type(address[1]) is not int or address[1] < 0 or address in seen_lines
                or block is None or not isinstance(block.get("text"), str)
                or not isinstance(line.get("text"), str)
                or block["text"].count(line["text"]) != 1
                or not isinstance(bbox, list) or len(bbox) != 4
                or any(type(number) is not int for number in bbox)):
            raise ClassFamilyCandidateError("indexed line provenance invalid")
        seen_lines.add(address)
    return lines


def class_line_pattern(entry: Mapping[str, Any]) -> re.Pattern[str]:
    """One lexical contract shared by page extraction and corpus census."""
    values = "|".join(re.escape(value) for value in sorted(entry["values"], key=len, reverse=True))
    labels = "|".join(re.escape(label) for label in sorted(entry["labels"], key=len, reverse=True))
    return re.compile(r"^\s*(?P<label>" + labels + r")\s*(?:[:=—–-]\s*|\s+)"
                      + r"(?P<value>(?-i:" + values + r"))\s*[.;]?\s*$", re.IGNORECASE)


def matched_class_label(entry: Mapping[str, Any], match: re.Match[str]) -> str | None:
    """Resolve matched source spelling to one configured alias, else abstain."""
    raw = match.group("label")
    aliases = [label for label in entry["labels"] if label.casefold() == raw.casefold()]
    return aliases[0] if len(aliases) == 1 else None


def extract_indexed_class_family_candidates(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    block_indices: Sequence[int], parameter_code: str, drawing_section: str,
    section_resolution: Mapping[str, Any] | None = None,
    drawing_section_proof: Mapping[str, Any] | None = None,
    label_pack_path: Path = LABEL_PACK_PATH,
) -> list[dict[str, Any]]:
    """Return zero or one page-local literal class lead; ambiguity abstains."""
    policy = load_class_family_labels(label_pack_path)
    rule = policy["rules"].get(parameter_code)
    if rule is None:
        raise ClassFamilyCandidateError("class parameter code is not catalog-pinned")
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=expected_object_id, expected_stage=expected_stage,
        expected_section=expected_section, block_indices=block_indices)
    _eligible(rule, evidence, drawing_section, section_resolution, drawing_section_proof)
    lines = _verified_lines(evidence)
    entry = next(row for row in policy["entries"] if row["parameterCode"] == parameter_code)
    pattern = class_line_pattern(entry)
    matched = [(line, match, alias) for line in lines
               if (match := pattern.fullmatch(line["text"])) is not None
               if (alias := matched_class_label(entry, match)) is not None]
    if len(matched) != 1:
        return []
    line, match, alias = matched[0]
    result = {
        "schemaVersion": "class-family-candidate-v1", "status": "CANDIDATE",
        "disposition": "REVIEW_ONLY", "executionPolicy": "NON_EXECUTING_ABSTAIN",
        "parameterCode": parameter_code, "family": "CLASS_DECREASE",
        "ruleId": rule["ruleId"], "rulePackSha256": policy["candidatePackSha256"],
        "labelPackSha256": policy["labelPackSha256"],
        "attribute": entry["attribute"], "canonicalUnit": entry["canonicalUnit"],
        "matchedLabel": alias, "rawValue": match.group("value"),
        "lineText": line["text"],
        "sourceFileId": evidence["sourceFileId"], "sourceSha256": evidence["sourceSha256"],
        "manifestSha256": evidence["manifestSha256"], "objectId": evidence["objectId"],
        "stage": evidence["stage"], "manifestSection": evidence["section"],
        "drawingSection": drawing_section,
        "sectionResolutionReference": (section_resolution["reference"]
                                       if section_resolution is not None else None),
        "drawingSectionProofReference": (drawing_section_proof["reference"]
                                         if drawing_section_proof is not None else None),
        "pageNumber": evidence["pageNumber"], "pageArtifactSha256": evidence["pageArtifactSha256"],
        "pageEvidenceSha256": evidence["evidenceSha256"],
        "parserProvenance": evidence["parserProvenance"],
        "locator": {"kind": "INDEXED_LINE", "blockIndex": line["blockIndex"],
                    "lineIndex": line["lineIndex"], "bboxMilliPoints": line["bboxMilliPoints"],
                    "valueStart": match.start("value"), "valueEnd": match.end("value")},
    }
    result["candidateSha256"] = _sha(result)
    return [result]
