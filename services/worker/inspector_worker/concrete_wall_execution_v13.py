"""OUTPUT-ONLY v13 scalar composition, preserving frozen engine/stair code.

Internal helpers only; no new serialized wrapper, public DTO or authority flag.
Protected release/source/origin authentication must precede actual execution.
The durable draft deliberately refuses dispatch until exact release pins freeze.
"""
from __future__ import annotations
from copy import deepcopy
import re
from typing import Any
from . import concrete_wall_matrix_engine_v13 as matrix_engine
from . import concrete_wall_fact_scope_v13 as _wall_fact_scope
from .concrete_wall_native_v13 import (
    _fail, assert_concrete_wall_lease_native_v13, sha256_portable_evidence_native_v13,
)
from .concrete_wall_transport_v13 import validate_concrete_wall_window_v13, is_wall_claim_v13
from .concrete_wall_prose_v1 import EXTRACTOR_VERSION, extract_concrete_wall_candidates_v1
from . import concrete_wall_scope_v1 as _pair
from .matrix_fact_scope import portable_evidence_hash
from .source_declarations import _valid_artifact
from .durable_pz002 import _reviewed_source

_RULE = "matrix-kr-055-concrete_class"
_ATOMIC = "ruleId ruleVersion parameterCode entityKey comparisonVariant executionStatus machineStatus reasonCode qualified expectedObservationId actualObservationId expectedValue actualValue delta".split()
_ANCHOR = re.compile(r"класс бетона по прочности на сжатие для стен", re.I)


def _fact(source: dict[str, Any], page: dict[str, Any], stage: str,
          primary: list[dict[str, Any]], contexts: list[dict[str, Any]],
          value: str, box: dict[str, float], *, wall: bool) -> dict[str, Any]:
    identity = {"sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
                "stage": stage, "pageNumber": page["pageNumber"],
                "blockIds": [part["blockId"] for part in primary],
                "attribute": "CONCRETE_CLASS", "value": value, "unit": "B_CLASS",
                "contextFragments": contexts}
    version = EXTRACTOR_VERSION if wall else "matrix-text-facts-v1"
    if wall:
        identity = {"schemaVersion": "matrix-concrete-wall-observation-v1", **identity,
                    "extractorVersion": version}
    marker = "CONCRETE_WALL_SCOPE_UNVERIFIED" if wall else "TABLE_CONTEXT_UNVERIFIED"
    return {"id": portable_evidence_hash(identity) if wall else matrix_engine._hash(identity),
            "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
            "stage": stage, "pageNumber": page["pageNumber"], "blockId": primary[0]["blockId"],
            "bbox": box, "rawText": " ".join(part["rawText"] for part in primary),
            "rawValue": value, "rawUnit": "B_CLASS", "attribute": "CONCRETE_CLASS", "value": value,
            "unit": "B_CLASS", "entityKey": None, "method": "TEXT_LAYER", "extractorVersion": version,
            "parameterCodes": ["KR-055"], "sourceFlags": sorted(set([marker, *matrix_engine._flags(
                source, stage, page["quality"]["disposition"])])),
            "evidenceFragments": primary, "contextFragments": contexts}


def _wall_facts(source: dict[str, Any], artifact: dict[str, Any],
                stages: list[str], pages: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    for page in artifact["pages"]:
        stage = _pair._stage_at(stages, pages, page["pageNumber"])
        if stage != "RD":
            continue
        for candidate in extract_concrete_wall_candidates_v1(page, stage):
            primary = [_pair._fragment(part, page) for part in candidate["primaryFragments"]]
            contexts = [_pair._fragment(part, page, True) for part in candidate["contextFragments"]]
            rows.append(_fact(source, page, stage, primary, contexts, candidate["value"], primary[0]["bbox"], wall=True))
    return rows


def _origin_fact(source: dict[str, Any], artifact: dict[str, Any], origin: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Reconstruct immutable PD/RD fact without today's review stage inference."""
    candidates = _wall_facts(source, artifact, origin["originalStages"], origin["originalPageStages"])
    pages = {page["pageNumber"]: page for page in artifact["pages"]}
    for page in artifact["pages"]:
        if _pair._stage_at(origin["originalStages"], origin["originalPageStages"], page["pageNumber"]) != "PD":
            continue
        for candidate in _pair._pd_table_candidates(page, pages, origin):
            candidates.append(_fact(source, page, "PD", candidate["evidenceFragments"],
                candidate["contextFragments"], candidate["value"], candidate["bbox"], wall=False))
    matched = [fact for fact in candidates if fact["id"] == origin["target"]["observationId"]]
    if len(matched) != 1:
        _fail("TARGET_UNVERIFIED")
    return matched[0], matched[0]["stage"]


# V13-only copies of frozen pair bodies. All original validation and result
# order remains; only the full-artifact hash uses bounded native serialization.
def _reconstruct_v13(side: dict[str, Any], stage: str) -> dict[str, Any] | None:
    fact, origin, source = side["fact"], side["origin"], side["source"]
    if fact is None:
        if side["binding"] is not None:
            _pair._fail("TARGET_UNVERIFIED")
        return None
    artifact = origin["artifact"]
    pages = {page["pageNumber"]: page for page in artifact["pages"]}
    number = fact["pageNumber"]
    if (type(number) is not int or number not in pages or fact["stage"] != stage
            or _pair._stage_at(origin["originalStages"], origin["originalPageStages"], number) != stage
            or fact["sourceFileId"] != source["sourceFileId"] or fact["sourceSha256"] != source["sourceSha256"]
            or fact["attribute"] != "CONCRETE_CLASS" or fact["unit"] != "B_CLASS"
            or fact["rawUnit"] != "B_CLASS" or fact["method"] != "TEXT_LAYER"
            or fact["parameterCodes"] != ["KR-055"] or not _pair._hash(fact["id"])
            or type(fact["value"]) is not str or _pair._CLASS.fullmatch(fact["value"]) is None
            or fact["rawValue"] != fact["value"] or type(fact["sourceFlags"]) is not list
            or any(not _pair._text(flag, 200, clean=True) for flag in fact["sourceFlags"])
            or len(set(fact["sourceFlags"])) != len(fact["sourceFlags"])
            or not (fact["entityKey"] is None or _pair._text(fact["entityKey"], 200, clean=True))):
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    page = pages[number]
    if stage == "PD":
        candidates = _pair._pd_table_candidates(page, pages, origin)
        if (fact["extractorVersion"] != "matrix-text-facts-v1" or "TABLE_CONTEXT_UNVERIFIED" not in fact["sourceFlags"]
                or len(candidates) != 1):
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
        candidate = candidates[0]
        if (fact["value"] != candidate["value"] or fact["evidenceFragments"] != candidate["evidenceFragments"]
                or fact["contextFragments"] != candidate["contextFragments"] or fact["bbox"] != candidate["bbox"]):
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
        selector = _wall_fact_scope.derive_matrix_fact_selector(fact, artifact)
        if selector is None:
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    else:
        candidates = _pair.extract_concrete_wall_candidates_v1(page, "RD")
        if (fact["extractorVersion"] != _pair.EXTRACTOR_VERSION or "CONCRETE_WALL_SCOPE_UNVERIFIED" not in fact["sourceFlags"]
                or len(candidates) != 1):
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
        candidate = candidates[0]
        primary = [_pair._fragment(part, page) for part in candidate["primaryFragments"]]
        contexts = [_pair._fragment(part, page, True) for part in candidate["contextFragments"]]
        if (fact["value"] != candidate["value"] or fact["evidenceFragments"] != primary
                or fact["contextFragments"] != contexts or fact["bbox"] != primary[0]["bbox"]):
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
        fields = "sourceFileId sourceSha256 stage pageNumber blockId attribute value unit rawValue rawUnit rawText method extractorVersion bbox evidenceFragments contextFragments".split()
        selector = {"schemaVersion": "matrix-fact-selector-v1", **{key: fact[key] for key in fields},
                    "textArtifactHash": origin["target"]["textArtifactHash"]}
    if (not fact["evidenceFragments"] or fact["blockId"] != fact["evidenceFragments"][0]["blockId"]
            or fact["rawText"] != " ".join(part["rawText"] for part in fact["evidenceFragments"])):
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    identity = {key: fact[key] for key in ("sourceFileId", "sourceSha256", "stage", "pageNumber", "attribute", "value", "unit")}
    identity["blockIds"] = [part["blockId"] for part in fact["evidenceFragments"]]
    identity["contextFragments"] = fact["contextFragments"]
    if stage == "RD":
        identity = {"schemaVersion": "matrix-concrete-wall-observation-v1", **identity,
                    "extractorVersion": _pair.EXTRACTOR_VERSION}
        observation_id = _pair.portable_evidence_hash(identity)
    else:
        observation_id = _pair.hashlib.sha256(_pair.json.dumps(identity, ensure_ascii=False, sort_keys=True,
                                                   separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if observation_id != fact["id"]:
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    computed = {**origin["target"], "observationId": fact["id"], "evidenceHash": _pair.portable_evidence_hash(selector)}
    if computed != origin["target"]:
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    return computed


def _integrity_v13(value: dict[str, Any], side: dict[str, Any]) -> None:
    origin, source, artifact = side["origin"], side["source"], side["origin"]["artifact"]
    if (origin["objectId"] != value["objectId"] or source["objectId"] != value["objectId"]
            or origin["inputManifestHash"] != value["inputManifestHash"] or not _pair._valid_artifact(artifact)
            or artifact["pageCount"] > 512 or source["sourceFileId"] != artifact["sourceFileId"]
            or source["sourceSha256"] != artifact["inputSha256"]
            or not _pair._page_ranges(source["pageStages"], artifact["pageCount"])
            or not _pair._page_ranges(origin["originalPageStages"], artifact["pageCount"])):
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    for page in artifact["pages"]:
        if len(page["blocks"]) > 32768 or any(len(line) > 100000
                for block in page["blocks"] for line in block["text"].split("\n")):
            _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    if sha256_portable_evidence_native_v13(artifact) != origin["target"]["textArtifactHash"]:
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")


def _evaluate_concrete_wall_pair_v13(raw: Any) -> dict[str, Any]:
    """Closed, detached result; full retained integrity precedes all eligibility."""
    try:
        _pair._native(raw)
    except _pair._NativeError as error:
        _pair._fail(error.code)
    _pair._shape(raw)
    for name in ("expected", "actual"):
        _integrity_v13(raw, raw[name])
    expected, actual = raw["expected"], raw["actual"]
    if (expected["source"]["sourceFileId"] == actual["source"]["sourceFileId"]
            or expected["source"]["sourceSha256"] == actual["source"]["sourceSha256"]):
        _pair._fail("SOURCE_PROVENANCE_UNVERIFIED")
    targets = [_reconstruct_v13(side, stage) for side, stage in ((expected, "PD"), (actual, "RD"))]
    for side, target in zip((expected, actual), targets):
        binding = side["binding"]
        if binding is not None and (binding["target"] != target
                or binding["ruleId"] != _pair._RULE or binding["ruleVersion"] != "1" or binding["parameterCode"] != "KR-055"):
            _pair._fail("TARGET_UNVERIFIED")
    if expected["fact"] is None or actual["fact"] is None:
        return _pair._result(raw, "REQUIRED_FACT_MISSING", status="MISSING_EVIDENCE")
    for side, stage, sections in ((expected, "PD", {"KR"}), (actual, "RD", {"KJ", "KR"})):
        source, fact = side["source"], side["fact"]
        if _pair._stage_at(source["stages"], source["pageStages"], fact["pageNumber"]) != stage:
            return _pair._result(raw, "SOURCE_STAGE_UNVERIFIED")
        if source["revisionStatus"] != "CURRENT":
            return _pair._result(raw, "SOURCE_REVISION_UNRESOLVED" if source["revisionStatus"] == "UNKNOWN" else "SOURCE_REVISION_SUPERSEDED")
        if source["approvalStatus"] != "APPROVED":
            return _pair._result(raw, "SOURCE_APPROVAL_UNRESOLVED" if source["approvalStatus"] == "UNKNOWN" else "SOURCE_UNAPPROVED")
        if source["sectionCode"] not in sections:
            return _pair._result(raw, "SOURCE_SECTION_UNVERIFIED")
    if not expected["source"]["linkGroupId"] or expected["source"]["linkGroupId"] != actual["source"]["linkGroupId"]:
        return _pair._result(raw, "LINK_GROUP_MISMATCH")
    bindings = [expected["binding"], actual["binding"]]
    if (any(binding is None for binding in bindings) or bindings[0]["entityKey"] != bindings[1]["entityKey"]
            or not _pair._same_context(bindings, "ELEMENT_IDENTITY", _pair._IDENTITY_KEYS,
                {"componentRole": "MONOLITHIC_LOAD_BEARING_WALL", "operatingModeKey": "CAST_IN_PLACE_LOAD_BEARING_WALL",
                 "measurementBasisKey": _pair._BASIS}, ("componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"))):
        return _pair._result(raw, "CONTEXT_UNVERIFIED:ELEMENT_IDENTITY")
    if not _pair._same_context(bindings, "MATERIAL_CLASS_BASIS", _pair._MATERIAL_KEYS,
                         {"attribute": "CONCRETE_CLASS", "canonicalUnit": "B_CLASS", "measurementBasisKey": _pair._BASIS},
                         ("attribute", "canonicalUnit", "measurementBasisKey")):
        return _pair._result(raw, "CONTEXT_UNVERIFIED:MATERIAL_CLASS_BASIS")
    if (not _pair._same_context(bindings, _pair._FLOOR, _pair._FLOOR_KEYS,
                          {"componentRole": "EXACT_STOREY", "measurementBasisKey": "EXACT_COMMON_STOREY"},
                          ("componentKey", "zoneKey", "measurementBasisKey"))
            or any(binding["contexts"][_pair._FLOOR]["zoneKey"] != binding["contexts"]["ELEMENT_IDENTITY"]["zoneKey"] for binding in bindings)
            or bindings[0]["contexts"][_pair._FLOOR]["componentKey"] not in {"-3", "-2", "-1", "0", "1"}):
        return _pair._result(raw, "CONTEXT_UNVERIFIED:" + _pair._FLOOR)
    for side in (expected, actual):
        review = side["binding"].get("tableContextReview")
        if review is None or review["fragmentsHash"] != _pair.portable_evidence_hash(side["fact"]["contextFragments"]):
            return _pair._result(raw, "TEXT_OR_STAGE_QUALITY_UNVERIFIED")
    ei = bindings[0]["contexts"]["ELEMENT_IDENTITY"]
    scope = {"policyVersion": _pair._POLICY, "entityKey": bindings[0]["entityKey"], "componentKey": ei["componentKey"],
             "zoneKey": ei["zoneKey"], "floorKey": bindings[0]["contexts"][_pair._FLOOR]["componentKey"],
             "expectedTarget": targets[0], "actualTarget": targets[1],
             "expectedReview": expected["source"]["reviewRef"], "actualReview": actual["source"]["reviewRef"]}
    evalue = _pair.Decimal(_pair._CLASS.fullmatch(expected["fact"]["value"]).group("rank").replace(",", "."))
    avalue = _pair.Decimal(_pair._CLASS.fullmatch(actual["fact"]["value"]).group("rank").replace(",", "."))
    difference = avalue - evalue
    delta = "0" if difference == 0 else format(difference, "f").rstrip("0").rstrip(".") if "." in format(difference, "f") else format(difference, "f")
    return _pair._result(raw, "CONCRETE_WALL_SCOPED_DECREASE_V1" if difference < 0 else "CONCRETE_WALL_SCOPED_NO_DECREASE_V1",
                   status="CANDIDATE" if difference < 0 else "NEGATIVE_VERIFIED", qualified=True, delta=delta, scope=scope)



def _validate_retained_original_side(pair_input: dict[str, Any], side: dict[str, Any], stage: str) -> None:
    try:
        _integrity_v13(pair_input, side)
        _reconstruct_v13(side, stage)
    except _pair.ConcreteWallScopeValidationError:
        _fail("TARGET_UNVERIFIED")


def _prepare(window: dict[str, Any], artifacts: list[dict[str, Any]],
             observations: list[dict[str, Any]] | None) -> tuple[list[tuple[str, dict[str, Any]]], list[tuple[str, dict[str, Any]]]]:
    inputs = window["inputs"]
    files = {source["sourceFileId"]: source for source in inputs["sourceFiles"]}
    decisions = inputs["sourceDecisions"]
    artifact_index = {}
    # Full originals for ALL retained PDFs, even missing/UNKNOWN/withdrawn pairs.
    for artifact in artifacts:
        if (not _valid_artifact(artifact) or artifact["pageCount"] > 512
                or artifact["sourceFileId"] not in files or artifact["sourceFileId"] in artifact_index
                or files[artifact["sourceFileId"]]["sha256"] != artifact["inputSha256"]):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        source_id = artifact["sourceFileId"]
        current = decisions.get(source_id)
        if current is not None and not _pair._page_ranges(current["pageStages"], artifact["pageCount"]):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        artifact_index[source_id] = artifact
    if {key for key, source in files.items() if source["mediaType"] == "application/pdf"} != set(artifact_index):
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    records = inputs["concreteWallOriginsV1"]["records"]
    prepared = []
    claimed = []
    by_id = {}
    for fact in observations or []:
        if fact["id"] in by_id:
            _fail("TARGET_UNVERIFIED")
        by_id[fact["id"]] = fact
    for source_id, decision in decisions.items():
        proof = decision["scopeProofs"].get("FACT_BINDINGS")
        if proof is None:
            continue
        for binding in proof["bindings"]:
            fact = by_id.get(binding["target"]["observationId"])
            matches = [record for record in records if record["sourceFileId"] == source_id
                       and record["target"] == binding["target"]]
            if not is_wall_claim_v13(binding, fact) and not matches:
                continue
            # Reserved extractor/anchor discovery can occur only after full
            # artifacts arrive. It must receive the same wall-only restriction
            # as context-discovered wall claims, never the sibling PZ policy.
            if not _pair._binding_shape(binding):
                _fail()
            # A record cannot authorize discovery: _origin_fact below MUST
            # independently reconstruct the exact PD wall table or RD wall
            # clause; a stair/slab record fails before any context decision.
            claimed.append((source_id, binding))
            if len(matches) != 1 or source_id not in artifact_index:
                _fail("TARGET_UNVERIFIED")
            record = matches[0]
            artifact = artifact_index[source_id]
            if not _pair._page_ranges(record["originalPageStages"], artifact["pageCount"]):
                _fail("TARGET_UNVERIFIED")
            source = {**files[source_id], **_reviewed_source(files[source_id], decision)}
            original, stage = _origin_fact(source, artifact, record)
            source_context = {"objectId": window["objectId"], "sourceFileId": source_id,
                "sourceSha256": source["sha256"], "stages": source["stages"],
                "revisionStatus": decision["revisionStatus"], "approvalStatus": decision["approvalStatus"],
                "sectionCode": decision["sectionCode"], "linkGroupId": decision["linkGroupId"],
                "pageStages": decision["pageStages"], "reviewRef": {
                    "decisionId": decision["reviewDecisionId"], "contentHash": decision["reviewContentHash"]}}
            side = {"fact": original, "origin": {key: record[key] for key in (
                "target", "objectId", "inputManifestHash", "originalStages", "originalPageStages")},
                "source": source_context, "binding": binding}
            side["origin"]["artifact"] = artifact
            pair_input = {"objectId": window["objectId"], "inputManifestHash": record["inputManifestHash"]}
            _validate_retained_original_side(pair_input, side, stage)
            original["entityKey"] = binding["entityKey"]
            prepared.append((stage, side))
    if observations is not None and len(claimed) != len(records):
        _fail("TARGET_UNVERIFIED")
    order = {record["target"]["observationId"]: i for i, record in enumerate(records)}
    prepared.sort(key=lambda item: order[item[1]["origin"]["target"]["observationId"]])
    stages = [stage for stage, _ in prepared]
    if stages != sorted(stages, key={"PD": 0, "RD": 1}.__getitem__) or len(set(stages)) != len(stages):
        _fail("TARGET_UNVERIFIED")
    if [side["origin"]["target"] for _, side in prepared] != [record["target"] for record in records]:
        _fail("TARGET_UNVERIFIED")
    return prepared, claimed


def _current_selected(side: dict[str, Any], stage: str,
                      observations: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Exact original identity or absence; never a same-value replacement."""
    matches = [fact for fact in observations if fact["id"] == side["fact"]["id"]]
    if len(matches) > 1:
        _fail("TARGET_UNVERIFIED")
    if not matches:
        return None
    current = matches[0]
    try:
        _reconstruct_v13({**side, "fact": current}, stage)
    except _pair.ConcreteWallScopeValidationError:
        _fail("TARGET_UNVERIFIED")
    return current


def _stage_nullable(decision: dict[str, Any]) -> bool:
    return (decision["reasonCode"] == "SOURCE_STAGE_UNVERIFIED"
            and decision["executionStatus"] == "SUCCEEDED"
            and decision["machineStatus"] == "CLARIFICATION_REQUIRED"
            and decision["qualified"] is False and decision["delta"] is None
            and decision["wallScope"] is None)


def _project_pair_row(decision: dict[str, Any], expected: dict[str, Any],
                      actual: dict[str, Any], current: list[dict[str, Any] | None]) -> dict[str, Any]:
    """Only a genuine helper stage refusal permits absent current references."""
    row = {key: deepcopy(decision[key]) for key in _ATOMIC}
    for prefix, side, present in zip(("expected", "actual"), (expected, actual), current):
        if (decision[prefix + "ObservationId"] != side["fact"]["id"]
                or decision[prefix + "Value"] != side["fact"]["value"]):
            _fail("TARGET_UNVERIFIED")
        if present is None:
            if not _stage_nullable(decision):
                _fail("TARGET_UNVERIFIED")
            row[prefix + "ObservationId"] = None
            row[prefix + "Value"] = None
    if decision["qualified"]:
        row["wallScope"] = deepcopy(decision["wallScope"])
    return row


def _merge_selected_pair(rows: list[dict[str, Any]], row: dict[str, Any],
                          candidate_ids: set[str], selected_ids: set[str],
                          current: list[dict[str, Any] | None]) -> list[dict[str, Any]]:
    """One exact key only; preserve competing candidates and all other rows.

    These are private post-reconstruction arguments, not trusted input flags.
    No absence is manufactured here. The caller already verified each present
    selected observation and called the strict helper on immutable originals.
    """
    group = [i for i, old in enumerate(rows) if old["parameterCode"] == "KR-055"
             and old["ruleId"] == _RULE and old["comparisonVariant"] == "PD_RD"]
    if not group:
        _fail("TARGET_UNVERIFIED")
    key = (row["ruleId"], row["entityKey"], row["comparisonVariant"])
    matches = [i for i, old in enumerate(rows)
               if (old["ruleId"], old["entityKey"], old["comparisonVariant"]) == key]
    if len(matches) > 1:
        _fail("TARGET_UNVERIFIED")
    if not candidate_ids <= selected_ids:
        return rows  # Full same-entity ambiguity must remain unchanged.
    if matches:
        old = rows[matches[0]]
        if old["parameterCode"] != "KR-055":
            _fail("TARGET_UNVERIFIED")
        for prefix, present in zip(("expected", "actual"), current):
            prior_id, prior_value = old[prefix + "ObservationId"], old[prefix + "Value"]
            if prior_id is None:
                if prior_value is not None:
                    _fail("TARGET_UNVERIFIED")
            elif (present is None or prior_id != present["id"] or prior_value != present["value"]):
                _fail("TARGET_UNVERIFIED")
        result = list(rows)
        result[matches[0]] = row
        return result
    if len(rows) >= 50000:
        _fail("INPUT_LIMIT")
    return rows[:group[-1] + 1] + [row] + rows[group[-1] + 1:]


def build_concrete_wall_execution_v13(*, window: Any, text_artifacts: Any, registry: Any = None) -> dict[str, Any]:
    """Internal scalar result only. Seven typed domains are composed by durable.

    No old execution/profile is called with a fabricated lease. The old pure
    engine is deliberately reused, with only one new observation family and
    exact KR055 variant reconstruction over its unchanged registry.
    """
    assert_concrete_wall_lease_native_v13({"window": window, "textArtifacts": text_artifacts, "registry": registry})
    window = validate_concrete_wall_window_v13(window)
    if type(text_artifacts) is not list:
        _fail()
    sources = []
    for source in window["inputs"]["sourceFiles"]:
        decision = window["inputs"]["sourceDecisions"].get(source["sourceFileId"])
        sources.append({**source, **_reviewed_source(source, decision),
                        "sectionCode": decision["sectionCode"] if decision is not None else source["sectionCode"],
                        "scopeProofs": decision["scopeProofs"] if decision is not None else {}})
    source_index = {source["sourceFileId"]: source for source in sources}
    # Prevalidate ALL original envelopes and page ranges BEFORE the old engine
    # sees large page-key decimals. No engine/source/selector mutation.
    _prepare(window, text_artifacts, None)
    execution = matrix_engine.build_matrix_execution(object_id=window["objectId"],
        input_manifest_hash=window["inputManifestHash"], sources=sources,
        text_artifacts=text_artifacts, registry=registry)
    observations = deepcopy(execution["observations"])
    wall = []
    for artifact in text_artifacts:
        source = source_index[artifact["sourceFileId"]]
        wall.extend(_wall_facts(source, artifact, source["stages"], source["pageStages"]))
    # A reserved wall clause is never allowed to escape through a generic/stair
    # selector. Literal facts come exclusively from the new exact wall parser.
    observations = [fact for fact in observations if not (fact["extractorVersion"] == EXTRACTOR_VERSION
        or (fact["attribute"] == "CONCRETE_CLASS" and _ANCHOR.search(fact["rawText"]) is not None))]
    observations.extend(wall)
    prepared, _ = _prepare(window, text_artifacts, observations)
    current_selected = [_current_selected(side, stage, observations) for stage, side in prepared]
    # This is the existing authenticated physical binding assignment, only to
    # a genuinely present exact current fact. Never inject an original or edit
    # its stage/ID/raw/value to satisfy a retained target.
    for (_, side), present in zip(prepared, current_selected):
        if present is not None:
            present["entityKey"] = side["binding"]["entityKey"]
    selected_registry = matrix_engine.load_matrix_registry() if registry is None else registry
    entries = [(entry, rule) for entry in selected_registry["entries"] for rule in entry["atomicRules"]
               if rule["ruleId"] == _RULE and rule["enabled"]]
    if len(entries) != 1:
        _fail()
    entry, rule = entries[0]
    rebuilt_index = matrix_engine._sources(window["objectId"], sources)
    artifacts_by_id = {artifact["sourceFileId"]: artifact for artifact in text_artifacts}
    atomic = [(e, r) for e in selected_registry["entries"] for r in e["atomicRules"] if r["enabled"]]
    for source_id, source in rebuilt_index.items():
        if "FACT_BINDINGS" in source.get("scopeProofs", {}):
            source["_factBindings"] = matrix_engine._FactBindings(source, artifacts_by_id.get(source_id),
                atomic, window["objectId"], window["inputManifestHash"])
    # The final observation set may add RD wall facts to ID comparisons too.
    # Preserve the historical registry order and source-declared ID gate;
    # floor-qualified wall authority remains exclusive to the PD_RD overlay.
    pairs = []
    for expected_stage, actual_stage in rule["allowedStagePairs"]:
        if actual_stage == "ID" and not any("ID" in source["stages"] for source in rebuilt_index.values()):
            continue
        pairs.extend(matrix_engine._evaluate(entry, rule, observations, rebuilt_index,
            window["objectId"], window["inputManifestHash"], expected_stage, actual_stage))
    results = []
    inserted = False
    for row in execution["results"]:
        if row["ruleId"] == _RULE:
            if not inserted:
                results.extend(pairs)
                inserted = True
        else:
            results.append(row)
    if not inserted:
        _fail()
    if len(prepared) == 2:
        expected, actual = [side for _, side in prepared]
        # Required even when one/both exact IDs are absent from the current
        # observations. The helper receives originals, not guessed current IDs.
        decision = _evaluate_concrete_wall_pair_v13({"schemaVersion": "matrix-concrete-wall-pair-input-v1",
            "objectId": window["objectId"], "inputManifestHash": expected["origin"]["inputManifestHash"],
            "expected": expected, "actual": actual})
        row = _project_pair_row(decision, expected, actual, current_selected)
        entity = expected["binding"]["entityKey"]
        if entity == actual["binding"]["entityKey"]:
            facts = [fact for fact in observations if fact["attribute"] == "CONCRETE_CLASS"
                     and fact["entityKey"] == entity and fact["stage"] in {"PD", "RD"}]
            results = _merge_selected_pair(results, row, {fact["id"] for fact in facts},
                {expected["fact"]["id"], actual["fact"]["id"]}, current_selected)
    elif any(present is None for present in current_selected):
        # No two-origin strict helper result exists to authorize nullable sides.
        _fail("TARGET_UNVERIFIED")
    if len(results) > 50000 or len(observations) > 50000:
        _fail("INPUT_LIMIT")
    execution["results"] = results
    execution["observations"] = sorted(observations, key=lambda o: (
        o["sourceFileId"], o["pageNumber"], o["blockId"], o["attribute"], o["id"]))
    for coverage in execution["coverage"]:
        if coverage["parameterCode"] != "KR-055":
            continue
        rows = [row for row in results if row["parameterCode"] == "KR-055"]
        coverage.update(successfulComparisons=sum(row["qualified"] for row in rows),
            abstentions=sum(not row["qualified"] and row["executionStatus"] == "SUCCEEDED" for row in rows),
            failures=sum(row["executionStatus"] == "FAILED" for row in rows),
            evaluatedAtomicRules=len({row["ruleId"] for row in rows}), executionStatus="PARTIAL",
            reason="SCOPED_EXECUTION_WITH_GAPS")
    # Existing fixed native/container budgets also apply to the final result;
    # the 50000 result ceiling above never enlarges the container cap32768.
    assert_concrete_wall_lease_native_v13(execution)
    return execution
