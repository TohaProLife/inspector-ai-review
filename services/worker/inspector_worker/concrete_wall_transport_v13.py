"""OUTPUT-ONLY closed v13 lease-window consistency, never synthetic authority.

The protected server owns persisted-review body/journal authentication, original
PDF I/O and old sealed stage/release association. This projection cannot prove
those facts from hashes alone. No `authority` argument or fallback exists.
"""
from __future__ import annotations
from copy import deepcopy
import re
from typing import Any
from . import matrix_engine
from .concrete_wall_native_v13 import (
    _fail, canonical_concrete_wall_lease_native_v13,
    canonical_concrete_wall_origins_native_v1,
)
from .concrete_wall_scope_v1 import _binding_shape

_HASH = re.compile(r"[a-f0-9]{64}\Z", re.ASCII)
_UUID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z", re.ASCII)
_PAGE = re.compile(r"[1-9][0-9]*\Z", re.ASCII)
_FLOOR = "CONCRETE_WALL_FLOOR_SCOPE_V1"
_RULE = "matrix-kr-055-concrete_class"
_TARGET = set("checkId executionContentHash observationId evidenceHash textArtifactHash".split())
_RECORD = set("sourceFileId sourceSha256 target objectId inputManifestHash originalStages originalPageStages".split())
_SOURCE = set("sourceFileId sha256 stages sectionCode byteSize mediaType downloadPath".split())
_DECISION = set("sourceSha256 revisionStatus approvalStatus linkGroupId sectionCode pageStages basis scopeProofs reviewDecisionId reviewContentHash".split())
_PROOF = set("schemaVersion bindings sourceFileId sourceSha256 objectId inputManifestHash reviewDecisionId reviewContentHash status reference".split())
_ANCHOR = re.compile(r"класс бетона по прочности на сжатие для стен", re.I)


def _exact(value: Any, keys: set[str]) -> bool:
    return type(value) is dict and set(value) == keys


def _text(value: Any, maximum: int, minimum: int = 1) -> bool:
    return type(value) is str and minimum <= len(value.encode("utf-16-le")) // 2 <= maximum


def _hash(value: Any) -> bool:
    return type(value) is str and _HASH.fullmatch(value) is not None


def _uuid(value: Any) -> bool:
    return type(value) is str and _UUID.fullmatch(value) is not None


def _target(value: Any) -> bool:
    return (_exact(value, _TARGET) and _text(value["checkId"], 120)
            and all(_hash(value[key]) for key in _TARGET - {"checkId"}))


def _stages(value: Any) -> bool:
    return (type(value) is list and 1 <= len(value) <= 3
            and all(type(v) is str and v in {"PD", "RD", "ID"} for v in value)
            and len(set(value)) == len(value))


def _pages(value: Any) -> bool:
    return (type(value) is dict and len(value) <= 512
            and all(_PAGE.fullmatch(key) is not None and type(stage) is str
                    and stage in {"PD", "RD", "ID", "UNRESOLVED"}
                    for key, stage in value.items()))


def is_wall_claim_v13(binding: dict[str, Any], fact: dict[str, Any] | None = None) -> bool:
    """Family discovery, not eligibility; absence of floor never hides a claim."""
    contexts = binding["contexts"]
    element = contexts.get("ELEMENT_IDENTITY")
    return (_FLOOR in contexts
            or (type(element) is dict and element.get("componentRole") == "MONOLITHIC_LOAD_BEARING_WALL")
            or (fact is not None and (fact.get("extractorVersion") == "matrix-concrete-wall-prose-v1"
                or (type(fact.get("rawText")) is str and _ANCHOR.search(fact["rawText"]) is not None))))


def _validate_bindings_without_rewriting(raw: list[dict[str, Any]]) -> None:
    """Inherited sibling validation; raw authenticated strings remain immutable.

    The legacy validator intentionally trims human references and descriptive
    strings. Only identity-bearing target/source normalization is forbidden;
    its normalized private copy is never returned or written into the window.
    """
    try:
        normalized = matrix_engine._validate_fact_bindings(deepcopy(raw))
    except ValueError:
        _fail()
    for original, checked in zip(raw, normalized):
        if original["target"] != checked["target"]:
            _fail()
        for key, context in original["contexts"].items():
            if "projectZeroAuthority" not in context:
                continue
            authority = context["projectZeroAuthority"]
            checked_authority = checked["contexts"][key]["projectZeroAuthority"]
            if (authority["target"] != checked_authority["target"]
                    or authority["sourceFileId"] != checked_authority["sourceFileId"]):
                _fail()


def validate_concrete_wall_window_v13(raw: Any) -> dict[str, Any]:
    # Complete native admission MUST precede even reading root object identity.
    canonical_concrete_wall_lease_native_v13(raw)
    if (not _exact(raw, set("objectId runId inputManifestHash releaseId inputs".split()))
            or not _uuid(raw["objectId"]) or not _uuid(raw["runId"])
            or not _hash(raw["inputManifestHash"]) or not _text(raw["releaseId"], 200)):
        _fail()
    inputs = raw["inputs"]
    required = {"sourceFiles", "sourceDecisions", "concreteWallOriginsV1"}
    if type(inputs) is not dict or not required <= set(inputs) <= required | {"reviewedEntityLinks"}:
        _fail()
    files, decisions, contexts = inputs["sourceFiles"], inputs["sourceDecisions"], inputs["concreteWallOriginsV1"]
    if (type(files) is not list or not 1 <= len(files) <= 64
            or type(decisions) is not dict or len(decisions) > 64):
        _fail()
    canonical_concrete_wall_origins_native_v1(contexts)
    if not _exact(contexts, {"schemaVersion", "records"}) or contexts["schemaVersion"] != "matrix-concrete-wall-origin-contexts-v1" or type(contexts["records"]) is not list:
        _fail()
    if len(contexts["records"]) > 2:
        _fail("INPUT_LIMIT")
    index: dict[str, Any] = {}
    for source in files:
        if (not _exact(source, _SOURCE) or not _text(source["sourceFileId"], 200)
                or not _hash(source["sha256"]) or not _stages(source["stages"])
                or not (source["sectionCode"] is None or type(source["sectionCode"]) is str)
                or type(source["byteSize"]) is not int
                or not (5 if source["mediaType"] == "application/pdf" else 1) <= source["byteSize"] <= 67108864
                or not _text(source["mediaType"], 200) or not _text(source["downloadPath"], 2000)
                or source["sourceFileId"] in index):
            _fail()
        index[source["sourceFileId"]] = source
    if "reviewedEntityLinks" in inputs and (type(inputs["reviewedEntityLinks"]) is not list
            or any(type(link) is not dict for link in inputs["reviewedEntityLinks"])):
        _fail()
    retained = []
    all_bindings = []
    for source_id, decision in decisions.items():
        if (not _text(source_id, 200) or not _exact(decision, _DECISION)
                or not _hash(decision["sourceSha256"]) or not _uuid(decision["reviewDecisionId"])
                or not _hash(decision["reviewContentHash"])
                or type(decision["revisionStatus"]) is not str or decision["revisionStatus"] not in {"UNKNOWN", "CURRENT", "SUPERSEDED"}
                or type(decision["approvalStatus"]) is not str or decision["approvalStatus"] not in {"UNKNOWN", "APPROVED", "UNAPPROVED"}
                or not (decision["linkGroupId"] is None or _text(decision["linkGroupId"], 120))
                or not (decision["sectionCode"] is None or type(decision["sectionCode"]) is str)
                or not _pages(decision["pageStages"])
                or not _exact(decision["basis"], {"reference"}) or not _text(decision["basis"]["reference"], 1000, 8)
                or type(decision["scopeProofs"]) is not dict):
            _fail()
        for key, proof in decision["scopeProofs"].items():
            if type(proof) is not dict:
                _fail()
            if key != "FACT_BINDINGS":
                continue  # Their unchanged frozen validators remain authoritative.
            if (not _exact(proof, _PROOF) or proof["schemaVersion"] != "matrix-fact-scopes-v1"
                    or proof["status"] != "VERIFIED" or proof["reference"] != "Authenticated fact bindings; original evidence reviewed"
                    or not _text(proof["sourceFileId"], 200) or not _hash(proof["sourceSha256"])
                    or not _uuid(proof["objectId"]) or not _hash(proof["inputManifestHash"])
                    or not _uuid(proof["reviewDecisionId"]) or not _hash(proof["reviewContentHash"])
                    or type(proof["bindings"]) is not list or len(proof["bindings"]) > 500
                    or any(type(binding) is not dict for binding in proof["bindings"])):
                _fail()
            _validate_bindings_without_rewriting(proof["bindings"])
            seen = set()
            for binding in proof["bindings"]:
                all_bindings.append((source_id, binding))
                signature = (binding["ruleId"], binding["entityKey"], binding["target"]["observationId"])
                if signature in seen:
                    _fail()
                seen.add(signature)
                if is_wall_claim_v13(binding):
                    if not _binding_shape(binding):
                        _fail()
                    retained.append((source_id, binding))
    records = contexts["records"]
    for record in records:
        if (not _exact(record, _RECORD) or not _text(record["sourceFileId"], 200)
                or not _hash(record["sourceSha256"]) or not _target(record["target"])
                or not _uuid(record["objectId"]) or not _hash(record["inputManifestHash"])
                or not _stages(record["originalStages"]) or not _pages(record["originalPageStages"])):
            _fail()
    # All records passed native, closed primitive and generic binding shape
    # validation. Only now may association failures take priority.
    for source_id, decision in decisions.items():
        if source_id not in index or index[source_id]["sha256"] != decision["sourceSha256"]:
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        proof = decision["scopeProofs"].get("FACT_BINDINGS")
        if proof is not None and (proof["sourceFileId"] != source_id
                or proof["sourceSha256"] != decision["sourceSha256"]
                or proof["objectId"] != raw["objectId"] or proof["inputManifestHash"] != raw["inputManifestHash"]
                or proof["reviewDecisionId"] != decision["reviewDecisionId"]
                or proof["reviewContentHash"] != decision["reviewContentHash"]):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
    for source_id, binding in retained:
        if binding["ruleId"] != _RULE or binding["ruleVersion"] != "1" or binding["parameterCode"] != "KR-055":
            _fail("TARGET_UNVERIFIED")
    for record in records:
        if (record["objectId"] != raw["objectId"] or record["sourceFileId"] not in index
                or record["sourceSha256"] != index[record["sourceFileId"]]["sha256"]):
            _fail("TARGET_UNVERIFIED")
    if len({r["sourceFileId"] for r in records}) != len(records):
        _fail("TARGET_UNVERIFIED")
    if len({r["sourceSha256"] for r in records}) != len(records):
        _fail("TARGET_UNVERIFIED")
    if len({r["inputManifestHash"] for r in records}) > 1:
        _fail("TARGET_UNVERIFIED")
    # Family includes floorless wall bindings. Exact artifact-based reserved
    # extractor discovery is repeated after all full original artifacts arrive.
    for record in records:
        matches = [(source_id, binding) for source_id, binding in all_bindings
                   if record["sourceFileId"] == source_id and record["target"] == binding["target"]]
        if len(matches) != 1:
            _fail("TARGET_UNVERIFIED")
    for source_id, binding in retained:
        matches = [r for r in records if r["sourceFileId"] == source_id and r["target"] == binding["target"]]
        if len(matches) != 1:
            _fail("TARGET_UNVERIFIED")
    return deepcopy(raw)


def project_concrete_wall_window_v13(lease: Any) -> dict[str, Any]:
    canonical_concrete_wall_lease_native_v13(lease)
    if type(lease) is not dict or type(lease.get("inputs")) is not dict:
        _fail()
    required = {"sourceFiles", "sourceDecisions", "concreteWallOriginsV1"}
    if not required <= set(lease["inputs"]):
        _fail()
    keys = set("objectId runId inputManifestHash releaseId".split())
    if not keys <= set(lease):
        _fail()
    inputs = {key: lease["inputs"][key] for key in required}
    if "reviewedEntityLinks" in lease["inputs"]:
        inputs["reviewedEntityLinks"] = lease["inputs"]["reviewedEntityLinks"]
    return validate_concrete_wall_window_v13({**{key: lease[key] for key in keys}, "inputs": inputs})
