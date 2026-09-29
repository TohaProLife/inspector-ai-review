"""Review-only positive set-item mentions from SHA-checked public index lines.

One page line may suggest an item to review. It cannot establish a complete
enumeration, a missing item in another document, or a PD/RD entity link.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

from .candidate_family_rules import CATALOG_PATH, RULES_DIR, load_candidate_family_pack
from .indexed_page_evidence import load_indexed_page_evidence


LABEL_PACK_PATH = RULES_DIR / "presence-family-labels-v1.json"
PRESENCE_CODES = frozenset({
    "SPZU-039", "AR-053", "POD-092", "POD-095", "ODI-120", "ODI-122",
    "ODI-123", "ZU-129",
})
_KEY = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_SCOPE_ID = re.compile(r"\s*(?:№\s*)?([А-ЯA-Z]{0,3}-?\d{1,4}[А-ЯA-Z0-9-]*)\b", re.I)
# An ambiguous, future, conditional, removed, or explicitly absent measure is
# not a positive mention. Whole-line rejection favors abstention over recall.
_UNCERTAIN = re.compile(
    r"\b(?:отсутств\w*|без|исключ\w*|демонтир\w*|демонтирован\w*|планир\w*|"
    r"вариант\w*|альтернатив\w*|возможн\w*|предлага\w*|"
    r"необходим\w*|требу\w*|следует|подлеж\w*|провер\w*|"
    r"проектир\w*|запроектир\w*|предполага\w*|намеч\w*|будущ\w*|"
    r"предусмотреть|должн\w*|"
    # Material brands in public AR text include both "Шума-нет" and
    # "Шума- нет". Their suffix is not a negated measure.
    r"может\s+быть|(?<!шума-)(?<!шума- )нет|не\s+\w+)\b", re.I,
)
_CARRIER_BY_FEATURE = {
    "ELECTRIC_METER": {"электроэнергия", "электроэнергии"},
    "WATER_METER": {"вода", "воды"},
    "HEAT_METER": {"тепло", "тепловой энергии"},
}


class PresenceFamilyCandidateError(ValueError):
    """Catalog policy, public source, or drawing-section proof is invalid."""


def _hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _literal_list(value: object, *, limit: int, max_length: int) -> bool:
    return (isinstance(value, list) and 1 <= len(value) <= limit
            and all(isinstance(item, str) and item == item.strip()
                    and 2 <= len(item) <= max_length and not any(c in item for c in "\r\n\t")
                    for item in value)
            and len({item.casefold() for item in value}) == len(value))


def load_presence_family_labels(
    path: Path = LABEL_PACK_PATH, *, catalog_path: Path = CATALOG_PATH,
) -> dict[str, Any]:
    """Load eight exact catalog/rule-bound labels; reject policy drift."""
    try:
        candidate_pack = load_candidate_family_pack(catalog_path=catalog_path)
        catalog_bytes = catalog_path.read_bytes()
        catalog = {row["parameter_code"]: row for row in
                   (json.loads(line) for line in catalog_bytes.decode("utf-8").splitlines()
                    if line.strip())}
        labels = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        raise PresenceFamilyCandidateError("presence label policy or pinned catalog invalid") from error
    if (not isinstance(labels, dict)
            or set(labels) != {"schemaVersion", "version", "catalogSha256",
                               "candidatePackSha256", "disposition", "entries"}
            or labels["schemaVersion"] != "presence-family-labels-v1"
            or labels["version"] != "1" or labels["disposition"] != "REVIEW_ONLY"
            or labels["catalogSha256"] != hashlib.sha256(catalog_bytes).hexdigest()
            or labels["candidatePackSha256"] != candidate_pack["packSha256"]
            or not isinstance(labels["entries"], list)
            or len(labels["entries"]) != len(PRESENCE_CODES)):
        raise PresenceFamilyCandidateError("presence label policy schema or SHA mismatch")
    rules = {row["parameterCode"]: row for row in candidate_pack["rules"]
             if row["family"] == "PRESENCE_SET"}
    if set(rules) != PRESENCE_CODES:
        raise PresenceFamilyCandidateError("presence code set differs from pinned candidate rules")
    seen: set[str] = set()
    for entry in labels["entries"]:
        if not isinstance(entry, dict) or set(entry) != {
                "parameterCode", "catalogName", "attribute", "features", "scopeGroups"}:
            raise PresenceFamilyCandidateError("presence label entry invalid")
        code = entry["parameterCode"]
        if not isinstance(code, str) or code in seen or code not in rules:
            raise PresenceFamilyCandidateError("presence label code missing, duplicate, or unknown")
        seen.add(code)
        rule = rules[code]
        if (entry["catalogName"] != catalog[code]["parameter_name"]
                or len(rule["attributes"]) != 1
                or rule["attributes"][0] != {"key": entry["attribute"],
                                               "canonicalUnit": "set"}
                or not isinstance(entry["features"], list)
                or not 1 <= len(entry["features"]) <= 8
                or not isinstance(entry["scopeGroups"], list)
                or not 1 <= len(entry["scopeGroups"]) <= 3):
            raise PresenceFamilyCandidateError(f"presence label/catalog drift: {code}")
        feature_keys: set[str] = set()
        feature_labels: set[str] = set()
        for feature in entry["features"]:
            if (not isinstance(feature, dict) or set(feature) != {"featureKey", "labels"}
                    or not isinstance(feature["featureKey"], str)
                    or not _KEY.fullmatch(feature["featureKey"])
                    or feature["featureKey"] in feature_keys
                    or not _literal_list(feature["labels"], limit=8, max_length=100)):
                raise PresenceFamilyCandidateError(f"presence feature policy invalid: {code}")
            feature_keys.add(feature["featureKey"])
            normalized_labels = {_normalized(label) for label in feature["labels"]}
            if feature_labels.intersection(normalized_labels):
                raise PresenceFamilyCandidateError(f"presence feature labels overlap: {code}")
            feature_labels.update(normalized_labels)
        scope_keys: set[str] = set()
        for group in entry["scopeGroups"]:
            if (not isinstance(group, dict)
                    or set(group) != {"scopeKey", "labels", "requireId"}
                    or not isinstance(group["scopeKey"], str)
                    or not _KEY.fullmatch(group["scopeKey"])
                    or group["scopeKey"] in scope_keys
                    or type(group["requireId"]) is not bool
                    or not _literal_list(group["labels"], limit=8, max_length=100)):
                raise PresenceFamilyCandidateError(f"presence scope policy invalid: {code}")
            scope_keys.add(group["scopeKey"])
    if seen != PRESENCE_CODES:
        raise PresenceFamilyCandidateError("presence policy does not cover exactly eight codes")
    return {**labels, "labelPackSha256": _hash(labels), "rules": rules}


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


def _eligible_source(rule: Mapping[str, Any], evidence: Mapping[str, Any], *,
                     drawing_section: str,
                     section_resolution: Mapping[str, Any] | None,
                     drawing_section_proof: Mapping[str, Any] | None) -> None:
    stage, section = evidence["stage"], evidence["section"]
    if stage == rule["expectedStage"]:
        side = "expected"
    elif stage in rule["allowedActualStages"]:
        side = "actual"
    else:
        raise PresenceFamilyCandidateError("source stage is ineligible for presence rule")
    if drawing_section not in rule[f"required{side.title()}DrawingSections"]:
        raise PresenceFamilyCandidateError("drawing section is ineligible for presence rule")
    policy = rule["manifestSectionStatus"][side]
    if policy == "EXACT_CATEGORY":
        if section not in rule[f"required{side.title()}Sections"]:
            raise PresenceFamilyCandidateError("manifest section is ineligible for presence rule")
        if section_resolution is not None:
            raise PresenceFamilyCandidateError("unneeded section resolution supplied")
        if drawing_section == section:
            if drawing_section_proof is not None:
                raise PresenceFamilyCandidateError("unneeded drawing mark proof supplied")
        elif not _bound_proof(drawing_section_proof, evidence=evidence,
                              drawing_section=drawing_section):
            raise PresenceFamilyCandidateError("drawing mark proof required")
    elif policy == "UNKNOWN_ABSTAIN":
        if not _bound_proof(section_resolution, evidence=evidence,
                            drawing_section=drawing_section):
            raise PresenceFamilyCandidateError("exact drawing section resolution required")
        if drawing_section_proof is not None:
            raise PresenceFamilyCandidateError("unneeded drawing mark proof supplied")
    else:
        raise PresenceFamilyCandidateError("manifest section policy unsupported")


def _normalized(text: str) -> str:
    return text.casefold().replace("ё", "е")


def _label_matches(text: str, label: str) -> list[re.Match[str]]:
    escaped = re.escape(_normalized(label))
    return list(re.finditer(r"(?<!\w)" + escaped + r"(?!\w)", text))


def _scope_tokens(text: str, groups: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    normalized = _normalized(text)
    tokens: list[dict[str, Any]] = []
    for group in groups:
        found: dict[tuple[str, str | None], dict[str, Any]] = {}
        for label in group["labels"]:
            for match in _label_matches(normalized, label):
                identifier = None
                if group["requireId"]:
                    id_match = _SCOPE_ID.match(text, match.end())
                    if id_match is None:
                        continue
                    identifier = id_match.group(1)
                token = {"scopeKey": group["scopeKey"], "matchedLabel": label,
                         "rawIdentifier": identifier}
                found[(_normalized(label), _normalized(identifier or ""))] = token
        # Different occurrences within a scope group might name different
        # objects or carriers. Never pick one by order or nearest distance.
        if len(found) != 1:
            return None
        tokens.append(next(iter(found.values())))
    return tokens


def extract_indexed_presence_family_candidates(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    block_indices: Sequence[int], parameter_code: str, drawing_section: str,
    section_resolution: Mapping[str, Any] | None = None,
    drawing_section_proof: Mapping[str, Any] | None = None,
    label_pack_path: Path = LABEL_PACK_PATH,
) -> list[dict[str, Any]]:
    """Return page-local set-item leads only; ambiguity yields no candidate."""
    policy = load_presence_family_labels(label_pack_path)
    rule = policy["rules"].get(parameter_code)
    if rule is None:
        raise PresenceFamilyCandidateError("presence parameter code is not catalog-pinned")
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=expected_object_id, expected_stage=expected_stage,
        expected_section=expected_section, block_indices=block_indices)
    if (not isinstance(evidence.get("evidenceSha256"), str)
            or not _HASH.fullmatch(evidence["evidenceSha256"])
            or evidence["evidenceSha256"] != _hash({key: value for key, value in
                                                    evidence.items() if key != "evidenceSha256"})):
        raise PresenceFamilyCandidateError("indexed page evidence SHA mismatch")
    _eligible_source(rule, evidence, drawing_section=drawing_section,
                     section_resolution=section_resolution,
                     drawing_section_proof=drawing_section_proof)
    entry = next(row for row in policy["entries"] if row["parameterCode"] == parameter_code)
    results: list[dict[str, Any]] = []
    for line in evidence["lines"]:
        raw_text = line["text"]
        if (not isinstance(raw_text, str) or not raw_text.strip() or len(raw_text) > 500
                or "?" in raw_text or _UNCERTAIN.search(raw_text)):
            continue
        normalized = _normalized(raw_text)
        scopes = _scope_tokens(raw_text, entry["scopeGroups"])
        if scopes is None:
            continue
        for feature in entry["features"]:
            labels = [label for label in feature["labels"]
                      if _label_matches(normalized, label)]
            if not labels:
                continue
            if parameter_code == "ZU-129" and _normalized(scopes[0]["matchedLabel"]) not in (
                    _CARRIER_BY_FEATURE[feature["featureKey"]]):
                continue
            # Several spellings of one item on the same line remain one lead.
            matched_label = max(labels, key=len)
            candidate = {
                "schemaVersion": "presence-family-candidate-v1", "status": "CANDIDATE",
                "disposition": "REVIEW_ONLY", "executionPolicy": "NON_EXECUTING_ABSTAIN",
                "parameterCode": parameter_code, "family": "PRESENCE_SET",
                "ruleId": rule["ruleId"], "rulePackSha256": policy["candidatePackSha256"],
                "labelPackSha256": policy["labelPackSha256"],
                "attribute": entry["attribute"], "canonicalUnit": "set",
                "featureKey": feature["featureKey"], "matchedLabel": matched_label,
                "scopeTokens": scopes,
                "sourceFileId": evidence["sourceFileId"],
                "sourceSha256": evidence["sourceSha256"],
                "manifestSha256": evidence["manifestSha256"],
                "objectId": evidence["objectId"], "stage": evidence["stage"],
                "manifestSection": evidence["section"], "drawingSection": drawing_section,
                "sectionResolutionReference": (section_resolution["reference"]
                                               if section_resolution is not None else None),
                "drawingSectionProofReference": (drawing_section_proof["reference"]
                                                  if drawing_section_proof is not None else None),
                "pageNumber": evidence["pageNumber"],
                "pageArtifactSha256": evidence["pageArtifactSha256"],
                "pageEvidenceSha256": evidence["evidenceSha256"],
                "parserProvenance": evidence["parserProvenance"],
                "coordinateSystem": evidence["coordinateSystem"],
                "lineText": raw_text,
                "locator": {"blockIndex": line["blockIndex"],
                            "lineIndex": line["lineIndex"],
                            "bboxMilliPoints": line["bboxMilliPoints"]},
            }
            candidate["candidateSha256"] = _hash(candidate)
            results.append(candidate)
    return results
