"""SHA-pinned, generic unresolved-code text navigation for reviewed sources.

The config is a bounded allowlist, not an executable rule pack. Every row
abstains. A text line and its block bbox cannot establish a table row,
dimension object, PD/RD pair, approved norm, finding, or parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .run_candidate_family_preview import _source, load_durable_candidate_family_inputs


SCHEMA_VERSION = "unresolved-config-run-review-v1"
PROFILE_ID = "unresolved-review-config-v1"
CONFIG_SHA256 = "c5aedccb8752ef365ea18298e1ed222f97abd207607b8caf5a18f23fd547bc85"
V2_SCHEMA_VERSION = "unresolved-config-run-review-v2"
V2_PROFILE_ID = "unresolved-review-config-v2"
V2_CONFIG_SHA256 = "1c31aad1761af86273f421daef5fc04bfe7724c9bf07750a1f1b8b37be30a0e8"
V3_SCHEMA_VERSION = "unresolved-config-run-review-v3"
V3_PROFILE_ID = "unresolved-review-config-v3"
V3_CONFIG_SHA256 = "ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a"
REGISTRY_SHA256 = "fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a"
STRATEGY_SHA256 = "0e9519b426c93fa9eaefe7416d6ced893c212ff3deb198d87e70eedf884d5514"
RULES_DIR = Path(os.environ.get(
    "INSPECTOR_RULES_DIR", Path(__file__).resolve().parent.parent / "rules"))
CONFIG_PATH = RULES_DIR / "unresolved-review-config-v1.json"
V2_CONFIG_PATH = RULES_DIR / "unresolved-review-config-v2.json"
V3_CONFIG_PATH = RULES_DIR / "unresolved-review-config-v3.json"
REGISTRY_PATH = RULES_DIR / "parameter-family-registry-v1.json"
AREA_CODES = ("PZ-003", "PZ-011", "PZ-019", "PZ-020", "SPZU-027", "SPZU-028", "AR-046")
DIMENSION_CODES = ("PZ-005", "SPZU-031", "SPZU-033", "AR-042", "AR-047", "AR-048",
                   "AR-051", "KR-060", "POS-084", "ODI-116", "ODI-117", "ODI-119")
CODES = AREA_CODES + DIMENSION_CODES
APPROVAL_CODES = ("SPZU-026", "AR-052", "IOS2-072", "IOS3-075", "ZU-130")
SAFETY_CODES = ("AR-043", "IOS5-080", "PPM-106", "PPM-108", "PPM-110")
V2_CODES = APPROVAL_CODES + SAFETY_CODES
NETWORK_CODES = ("IOS1-068", "IOS1-069", "IOS1-070", "IOS4-076",
                 "IOS4-078", "PPM-111", "PPM-113")
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_SECTIONS = {"PZ", "GP", "AR", "KR", "POS", "ODI", "VK"}
_PROOF_GATES = {"APPROVED_SOURCE_REVISIONS", "VERIFIED_SECTION_STAGE",
                "SAME_ELEMENT_OR_SPACE", "PD_RD_PAIR", "TABLE_ROW_GEOMETRY",
                "PROGRAM_CONTEXT", "DRAWING_GEOMETRY", "DIMENSION_OBJECT",
                "APPLICABLE_NORM"}
_V2_PROOF_GATES = _PROOF_GATES | {
    "APPROVAL_DOCUMENT", "APPROVAL_AUTHORITY_DATE_SCOPE", "SAME_FACADE_ELEMENT",
    "SAME_SYSTEM_SEGMENT", "RECALCULATION", "PRODUCT_PROPERTY",
    "SAME_INSTALLATION_LOCATION", "EVACUATION_ROUTE",
    "DOOR_SWING_ASSOCIATION", "ZONE_DEVICE_PLACEMENT",
}
_V2_SECTIONS = {"GP", "SPZU", "PP", "AR", "IOS1", "IOS2", "IOS3", "IOS5",
                "VK", "NVK", "EOM", "ZU", "PPM", "SS"}
_V2_CODE_GATES = {
    "SPZU-026": {"TABLE_ROW_GEOMETRY"},
    "AR-052": {"SAME_FACADE_ELEMENT"},
    "IOS2-072": {"SAME_SYSTEM_SEGMENT", "RECALCULATION"},
    "IOS3-075": {"SAME_SYSTEM_SEGMENT", "PRODUCT_PROPERTY"},
    "ZU-130": {"SAME_INSTALLATION_LOCATION", "PRODUCT_PROPERTY"},
    "AR-043": {"EVACUATION_ROUTE", "DOOR_SWING_ASSOCIATION"},
    "IOS5-080": {"ZONE_DEVICE_PLACEMENT"},
    "PPM-106": {"EVACUATION_ROUTE", "DOOR_SWING_ASSOCIATION"},
    "PPM-108": {"ZONE_DEVICE_PLACEMENT"},
    "PPM-110": {"EVACUATION_ROUTE", "ZONE_DEVICE_PLACEMENT"},
}
_V3_PROOF_GATES = _PROOF_GATES | {
    "GRAPH_CONNECTIVITY", "CIRCUIT_DEVICE_ASSIGNMENT", "CABLE_LINE_ASSIGNMENT",
    "GROUNDING_CIRCUIT_CLOSURE", "PIPE_BRANCH_ASSIGNMENT",
    "DUCT_SECTION_GEOMETRY", "BARRIER_PENETRATION",
    "FIRE_WATER_NETWORK", "HYDRAULIC_CONTEXT",
}
_V3_SECTIONS = {"IOS1", "EOM", "IOS4", "OV", "PPM", "VK", "NVK"}
_V3_CODE_GATES = {
    "IOS1-068": {"CIRCUIT_DEVICE_ASSIGNMENT"},
    "IOS1-069": {"CABLE_LINE_ASSIGNMENT", "APPLICABLE_NORM"},
    "IOS1-070": {"GROUNDING_CIRCUIT_CLOSURE"},
    "IOS4-076": {"PIPE_BRANCH_ASSIGNMENT"},
    "IOS4-078": {"DUCT_SECTION_GEOMETRY"},
    "PPM-111": {"BARRIER_PENETRATION", "APPLICABLE_NORM"},
    "PPM-113": {"FIRE_WATER_NETWORK", "HYDRAULIC_CONTEXT"},
}
_PROFILES = {
    "v1": {"schema": SCHEMA_VERSION, "id": PROFILE_ID, "version": "1",
           "sha": CONFIG_SHA256, "path": CONFIG_PATH, "codes": CODES,
           "families": {**{code: "AREA_PROGRAM" for code in AREA_CODES},
                        **{code: "DIMENSION_LAYOUT" for code in DIMENSION_CODES}},
           "sections": _SECTIONS, "gates": _PROOF_GATES,
           "familyGates": {"AREA_PROGRAM": {"TABLE_ROW_GEOMETRY", "PROGRAM_CONTEXT"},
                           "DIMENSION_LAYOUT": {"DRAWING_GEOMETRY", "DIMENSION_OBJECT"}},
           "codeGates": {}, "requiresAnchorEvidence": False, "extraReasons": set(),
           "renderProfile": None},
    "v2": {"schema": V2_SCHEMA_VERSION, "id": V2_PROFILE_ID, "version": "2",
           "sha": V2_CONFIG_SHA256, "path": V2_CONFIG_PATH, "codes": V2_CODES,
           "families": {**{code: "DOCUMENT_APPROVAL" for code in APPROVAL_CODES},
                        **{code: "SAFETY_COVERAGE" for code in SAFETY_CODES}},
           "sections": _V2_SECTIONS, "gates": _V2_PROOF_GATES,
           "familyGates": {"DOCUMENT_APPROVAL": {"APPROVAL_DOCUMENT", "APPROVAL_AUTHORITY_DATE_SCOPE"},
                           "SAFETY_COVERAGE": {"DRAWING_GEOMETRY", "APPLICABLE_NORM"}},
           "codeGates": _V2_CODE_GATES, "requiresAnchorEvidence": True,
           "extraReasons": set(), "renderProfile": None},
    "v3": {"schema": V3_SCHEMA_VERSION, "id": V3_PROFILE_ID, "version": "3",
           "sha": V3_CONFIG_SHA256, "path": V3_CONFIG_PATH, "codes": NETWORK_CODES,
           "families": {code: "NETWORK_TOPOLOGY" for code in NETWORK_CODES},
           "sections": _V3_SECTIONS, "gates": _V3_PROOF_GATES,
           "familyGates": {"NETWORK_TOPOLOGY": {"DRAWING_GEOMETRY", "GRAPH_CONNECTIVITY"}},
           "codeGates": _V3_CODE_GATES, "requiresAnchorEvidence": True,
           "extraReasons": {"NETWORK_TOPOLOGY_UNVERIFIED"},
           "renderProfile": "pdftoppm-100dpi-png-singlefile"},
}


def _profile(profile_id: str) -> dict[str, Any]:
    try:
        return _PROFILES[profile_id]
    except KeyError as exc:
        raise ValueError("unresolved config unsupported profile") from exc


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _normalized(text: str) -> str:
    return " ".join(text.lower().split())


def _validate_config(config: dict[str, Any], *, registry_path: Path = REGISTRY_PATH,
                     profile_id: str = "v1") -> str:
    """Reject config/registry drift, unsupported IDs and ambiguous bounds."""
    profile = _profile(profile_id)
    if not isinstance(config, dict) or _hash(config) != profile["sha"]:
        raise ValueError("unresolved config canonical SHA pin mismatch")
    if (config.get("schemaVersion") != profile["id"]
            or config.get("version") != profile["version"]
            or config.get("executionPolicy") != "REVIEW_ONLY_ABSTAIN"
            or config.get("registrySha256") != REGISTRY_SHA256
            or config.get("strategySha256") != STRATEGY_SHA256
            or config.get("matching") != "ANY_LITERAL_LOWERCASE_COLLAPSE_WHITESPACE"
            or (profile["renderProfile"] is not None
                and config.get("auditedRenderProfile") != profile["renderProfile"])):
        raise ValueError("unresolved config header invalid")
    bounds = config.get("bounds")
    if bounds != {"maxLeadsPerCode": 16, "maxLineChars": 500,
                  "maxTextArtifactBytes": 67108864}:
        raise ValueError("unresolved config bounds invalid")
    entries = config.get("entries")
    if (not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries)
            or [entry.get("parameterCode") for entry in entries] != list(profile["codes"])):
        raise ValueError("unresolved config unsupported, duplicate or reordered code")
    registry_bytes = registry_path.read_bytes()
    if hashlib.sha256(registry_bytes).hexdigest() != REGISTRY_SHA256:
        raise ValueError("unresolved config registry SHA drift")
    registry = json.loads(registry_bytes)
    if (registry.get("schemaVersion") != "parameter-family-registry-v1"
            or registry.get("executionPolicy") != "DESIGN_ONLY"):
        raise ValueError("unresolved config registry identity invalid")
    registry_entries = {entry["parameterCode"]: entry for entry in registry["entries"]}
    if len(registry_entries) != len(registry["entries"]):
        raise ValueError("unresolved config duplicate registry code")
    for entry in entries:
        code = entry["parameterCode"]
        family = profile["families"][code]
        registered = registry_entries.get(code)
        if (registered is None or registered.get("classification") != "UNRESOLVED"
                or entry.get("registryClassification") != "UNRESOLVED"
                or entry.get("registryReasonCode") != registered.get("reasonCode")
                or entry.get("candidateExtractorFamily") != family
                or entry.get("locatorType") != "TEXT_LINE_BBOX_ONLY"):
            raise ValueError(f"unresolved config registry/family mismatch: {code}")
        roles = entry.get("allowedSourceRoles")
        if (not isinstance(roles, list) or not roles
                or any(not isinstance(role, dict) or set(role) != {"stage", "section"}
                       or role["stage"] not in {"PD", "RD"}
                       or role["section"] not in profile["sections"]
                       for role in roles)
                or len({(role["stage"], role["section"]) for role in roles}) != len(roles)):
            raise ValueError(f"unresolved config source roles invalid: {code}")
        anchors = entry.get("anchors")
        if (not isinstance(anchors, list) or not 1 <= len(anchors) <= 6
                or any(not isinstance(anchor, str) or not 3 <= len(anchor) <= 90
                       or anchor != _normalized(anchor) for anchor in anchors)
                or len(set(anchors)) != len(anchors)):
            raise ValueError(f"unresolved config anchors invalid: {code}")
        gates = entry.get("requiredProofGates")
        if (not isinstance(gates, list) or len(set(gates)) != len(gates)
                or not set(gates).issubset(profile["gates"])
                or not {"APPROVED_SOURCE_REVISIONS", "VERIFIED_SECTION_STAGE",
                        "SAME_ELEMENT_OR_SPACE", "PD_RD_PAIR"}.issubset(gates)
                or not profile["familyGates"][family].issubset(gates)
                or not profile["codeGates"].get(code, set()).issubset(gates)):
            raise ValueError(f"unresolved config proof gates invalid: {code}")
        if not isinstance(entry.get("specificProofDependency"), str) or not entry["specificProofDependency"].strip():
            raise ValueError(f"unresolved config proof dependency invalid: {code}")
        if profile["requiresAnchorEvidence"]:
            evidence = entry.get("anchorEvidence")
            if (not isinstance(evidence, list) or len(evidence) != len(anchors)
                    or any(not isinstance(item, dict)
                           or set(item) != {"sourceFileId", "sourceSha256", "pageNumber",
                                            "renderSha256", "lineText"}
                           or not isinstance(item["sourceFileId"], str)
                           or re.fullmatch(r"F\d{4}", item["sourceFileId"]) is None
                           or not isinstance(item["sourceSha256"], str)
                           or _SHA.fullmatch(item["sourceSha256"]) is None
                           or not isinstance(item["renderSha256"], str)
                           or _SHA.fullmatch(item["renderSha256"]) is None
                           or not isinstance(item["pageNumber"], int)
                           or isinstance(item["pageNumber"], bool)
                           or item["pageNumber"] < 1
                           or not isinstance(item["lineText"], str)
                           or not item["lineText"].strip()
                           or anchor not in _normalized(item["lineText"])
                           for anchor, item in zip(anchors, evidence))):
                raise ValueError(f"unresolved config audited anchor evidence invalid: {code}")
    return profile["sha"]


def load_unresolved_review_config(*, path: Path | None = None,
                                  registry_path: Path = REGISTRY_PATH,
                                  profile_id: str = "v1") -> dict[str, Any]:
    if path is None:
        path = _profile(profile_id)["path"]
    config = json.loads(path.read_text(encoding="utf-8"))
    _validate_config(config, registry_path=registry_path, profile_id=profile_id)
    return config


def _lines(text: str):
    # JavaScript verifier splits the same Unicode line boundaries. Keeping
    # U+2028/VT/FF attached to a line would change both locator and SHA.
    yield from enumerate(text.splitlines())


def evaluate_unresolved_config_review(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], *, config: dict[str, Any] | None = None,
    profile_id: str = "v1",
) -> dict[str, Any]:
    """Scan full verified text and expose bounded line locators only."""
    profile = _profile(profile_id)
    config = load_unresolved_review_config(profile_id=profile_id) if config is None else config
    config_sha = _validate_config(config, profile_id=profile_id)
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("unresolved config objectId required")
    if not isinstance(input_manifest_hash, str) or _SHA.fullmatch(input_manifest_hash) is None:
        raise ValueError("unresolved config inputManifestHash invalid")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("unresolved config sources/artifacts must be arrays")
    source_index: dict[str, dict[str, Any]] = {}
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index:
            raise ValueError("unresolved config duplicate source")
        source_index[source_id] = source
    artifacts: dict[str, dict[str, Any]] = {}
    hashes: dict[str, str] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("unresolved config artifact identity invalid")
        source_id = artifact["sourceFileId"]
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("unresolved config unknown or duplicate text artifact")
        encoded = _canonical(artifact)
        if len(encoded) > config["bounds"]["maxTextArtifactBytes"]:
            raise ValueError("unresolved config text artifact exceeds scan bound")
        _validate_artifact(artifact, source_index[source_id])
        artifacts[source_id] = artifact
        hashes[source_id] = hashlib.sha256(encoded).hexdigest()
    source_stage_artifacts = [
        {"sourceFileId": source_id, "sourceSha256": source_index[source_id]["sha256"],
         "textArtifactSha256": hashes[source_id]}
        for source_id in sorted(artifacts)
    ]
    rows = []
    for entry in config["entries"]:
        code = entry["parameterCode"]
        allowed = {(role["stage"], role["section"]) for role in entry["allowedSourceRoles"]}
        reasons = {"CONFIG_PINNED_REVIEW_ONLY", "ELEMENT_OR_SPACE_UNVERIFIED",
                   "PD_RD_PAIR_UNVERIFIED", *profile["extraReasons"]}
        leads: list[dict[str, Any]] = []
        eligible = text_pages = ocr_pages = oversize = lead_count = 0
        for source_id in sorted(source_index):
            source = source_index[source_id]
            if source["revisionStatus"] != "CURRENT" or source["approvalStatus"] != "APPROVED":
                reasons.add("SOURCE_REVIEW_REQUIRED")
                continue
            artifact = artifacts.get(source_id)
            if artifact is None:
                reasons.add("TEXT_ARTIFACT_MISSING")
                continue
            section = source["sectionCode"]
            stage_map = source.get("pageStages", {})
            if len(source["stages"]) > 1:
                expected = {str(page["pageNumber"]) for page in artifact["pages"]}
                if set(stage_map) != expected:
                    reasons.add("PAGE_STAGE_MAP_INCOMPLETE")
                    reasons.add("SOURCE_STAGE_UNRESOLVED")
                    continue
            elif stage_map:
                # _source also rejects this, but keep the gate explicit here.
                reasons.add("SOURCE_STAGE_UNRESOLVED")
                continue
            eligible_pages = []
            for page in sorted(artifact["pages"], key=lambda item: item["pageNumber"]):
                stage = (stage_map[str(page["pageNumber"])] if stage_map
                         else source["stages"][0])
                if stage == "UNRESOLVED":
                    reasons.add("PAGE_STAGE_UNRESOLVED_DEFERRED")
                    continue
                if (stage, section) not in allowed:
                    reasons.add("SOURCE_ROLE_NOT_ALLOWED")
                    continue
                eligible_pages.append((page, stage))
            if not eligible_pages:
                continue
            eligible += 1
            for page, stage in eligible_pages:
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    ocr_pages += 1
                    reasons.add("OCR_REQUIRED_DEFERRED")
                    continue
                text_pages += 1
                for block_index, block in enumerate(page["blocks"]):
                    block_sha = hashlib.sha256(block["text"].encode("utf-8")).hexdigest()
                    for line_index, line in _lines(block["text"]):
                        normalized = _normalized(line)
                        matched = [anchor for anchor in entry["anchors"] if anchor in normalized]
                        if not matched:
                            continue
                        if len(line) > config["bounds"]["maxLineChars"]:
                            oversize += 1
                            reasons.add("OVERSIZE_ANCHOR_LINE_DEFERRED")
                            continue
                        lead_count += 1
                        if len(leads) >= config["bounds"]["maxLeadsPerCode"]:
                            continue
                        lead = {"sourceFileId": source_id, "sourceSha256": source["sha256"],
                                "textArtifactSha256": hashes[source_id],
                                "sourceStage": stage, "sourceSection": section,
                                "pageNumber": page["pageNumber"],
                                "blockIndex": block_index, "lineIndex": line_index,
                                "blockTextSha256": block_sha, "lineText": line,
                                "lineTextSha256": hashlib.sha256(line.encode("utf-8")).hexdigest(),
                                "bboxMilliPoints": block["bboxMilliPoints"],
                                "matchedAnchors": matched,
                                "locatorType": "TEXT_LINE_BBOX_ONLY",
                                "elementAssociationStatus": "UNVERIFIED"}
                        lead["leadSha256"] = _hash(lead)
                        leads.append(lead)
        cap = config["bounds"]["maxLeadsPerCode"]
        truncated = lead_count - len(leads)
        if truncated:
            reasons.add("LEAD_LIMIT_REACHED")
        if eligible == 0:
            reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE")
        if lead_count == 0:
            reasons.add("NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT" if text_pages
                        else "NO_SCANNED_TEXT_IN_SCOPE")
        rows.append({"parameterCode": code,
                     "candidateExtractorFamily": entry["candidateExtractorFamily"],
                     "locatorType": entry["locatorType"],
                     "requiredProofGates": entry["requiredProofGates"],
                     "status": "ABSTAIN", "reasonCodes": sorted(reasons),
                     "eligibleSourceCount": eligible,
                     "textCandidatePageCount": text_pages,
                     "ocrRequiredPageCount": ocr_pages,
                     "oversizeAnchorLineCount": oversize,
                     "leadCount": lead_count,
                     "truncatedLeadCount": truncated,
                     "leadCountSemantics": "MATCHES_IN_SCANNED_TEXT_ONLY",
                     "absenceConclusion": "NOT_AVAILABLE",
                     "leads": leads})
    result = {"schemaVersion": profile["schema"], "profileId": profile["id"],
              "purpose": "REVIEW_ONLY", "objectId": object_id,
              "inputManifestHash": input_manifest_hash,
              "configSha256": config_sha,
              "registrySha256": REGISTRY_SHA256,
              "sourceStageArtifacts": source_stage_artifacts,
              "codeRows": rows, "findingCount": None,
              "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    return result


def execute_durable_unresolved_config_review(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_unresolved_config_review(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
