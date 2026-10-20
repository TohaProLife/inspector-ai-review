"""OUTPUT-ONLY v13 source proposal with a complete guarded release/SEAL path.

Accepted capsule pins remain absent until genuine T83 qualification. No new
profile can run yet. Inherited v12 entrypoints and live sources stay unchanged.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import http.client
import json
import os
import re
import time
from pathlib import Path
from typing import Any
import urllib.parse
from . import durable_column_pylon_section_matrix_v12 as _v12
from . import concrete_wall_execution_v13 as _wall
from .concrete_wall_native_v13 import canonical_concrete_wall_lease_native_v13, _fail
from .concrete_wall_transport_v13 import project_concrete_wall_window_v13

PROFILE_ID = "matrix-text-facts-concrete-walls-v13"
ADAPTER_VERSION = "13"
MAX_LOADER_BYTES = 67108864
LOADER_SOCKET_DEADLINE_SECONDS = 60
LOADER_SCHEMA = "matrix-reviewed-inventory-loader-inputs-v7"


_WALL_LEAF_BLUEPRINT = {'schemaVersion': 'matrix-concrete-wall-execution-v1', 'purpose': 'MACHINE_COMPARISON', 'baseProfileId': 'matrix-text-facts-column-pylon-section-v12', 'baseAdapterVersion': '12', 'baseConfigHash': None, 'sourcePins': {'concrete_wall_native_v13.py': 'de295d9e1a55349978ea80dd8d920b6ba4e3be8e6a13ee36ff5dcff45ec01047', 'concrete_wall_prose_v1.py': '24973dd12cfa53630efb22505f76279c9598aa686a9bd87ebbb99270e78c65c5', 'concrete_wall_scope_v1.py': '2110a9372e34dc604d6a0128ef485ab19141c65f8a1cc59439b7a5c72887b94d', 'concrete_wall_transport_v13.py': 'b9088bdc5a93babc9cf85ded0ba5a6f006896819b980f4bea8e4d3a618786640', 'concrete_wall_execution_v13.py': 'cb4666791cd0f9e844f5669817063a1d3ff05f8521d3bf33fc45b826def6129c', 'durable_concrete_wall_matrix_v13.py': '58780b429c87f6e28517a9011f1e68ed39d52336dbb3f4797bb5db4ed5e55d8d'}, 'extractorVersion': 'matrix-concrete-wall-prose-v1', 'scopePolicyVersion': 'matrix-concrete-wall-reviewed-pair-v1', 'scalarExecutionVersion': 'matrix-concrete-wall-scalar-v13', 'durableWrapperVersion': 'matrix-concrete-wall-durable-v13', 'loaderSchemaVersion': 'matrix-reviewed-inventory-loader-inputs-v7', 'loaderResourcePolicy': {'canonicalUtf8Bytes': 67108864, 'nodesIncludingKeys': 4500018, 'maximumDepth': 69, 'containerItems': 32768, 'scalarStringCodePoints': 2000000}, 'originResourcePolicy': {'canonicalUtf8Bytes': 524288, 'nodesIncludingKeys': 200000, 'maximumDepth': 64, 'containerItems': 32768, 'scalarStringCodePoints': 2000000}, 'coveragePolicyVersion': 'matrix-concrete-wall-scoped-partial-v1', 'inheritedPolicy': 'ACCEPTED_V12_EXACT_NO_REGISTRY_OR_CONFIDENCE_CHANGE'}


class DraftConcreteWallPolicyUnavailable(RuntimeError):
    """No accepted installed base; never an operational engineering result."""


# Filled only by a separately reviewed promotion bound to genuine T83 acceptance.
# No setter, caller data, environment path or generated placeholder resource.
_ACCEPTED_CAPSULE_SHA256: str | None = "0632bc8b627d7e5df0a99148d67e0669cc7219cd21759e1c84db8e63e9cf9e39"
_ACCEPTED_V12_CONFIG_HASH: str | None = "10a652201897fafc049b5fb48cc77e7d86a7bc446a9b43a9d33487d8e96c7bf2"
_MAX_CAPSULE_BYTES = 2 * 1024 * 1024
_CAPSULE_PATH = Path(__file__).with_name("matrix-policy-history-v3.json")
_HISTORY_IDENTITIES = (
    ("matrix-text-facts-lighting-technology-v9", "9", "c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84"),
    ("matrix-text-facts-steel-comparison-v10", "10", "ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6"),
    ("matrix-text-facts-steel-comparison-v11", "11", "3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7"),
)


def _accepted_v12_definitions() -> dict[str, Any]:
    # Deliberately refuse before touching any resource while no real pins exist.
    if _ACCEPTED_CAPSULE_SHA256 is None or _ACCEPTED_V12_CONFIG_HASH is None:
        raise DraftConcreteWallPolicyUnavailable("accepted v12 capsule/config is unavailable")
    if (_CAPSULE_PATH.is_symlink() or not _CAPSULE_PATH.is_file()
            or not 0 < _CAPSULE_PATH.stat().st_size <= _MAX_CAPSULE_BYTES):
        _fail()
    data = _CAPSULE_PATH.read_bytes()
    if len(data) > _MAX_CAPSULE_BYTES or hashlib.sha256(data).hexdigest() != _ACCEPTED_CAPSULE_SHA256:
        _fail()
    capsule = json.loads(data.decode("utf-8"), object_pairs_hook=_v12._unique_object,
        parse_int=_v12._safe_json_int, parse_constant=_v12._reject_constant)
    canonical_concrete_wall_lease_native_v13(capsule)
    if (type(capsule) is not dict or set(capsule) != {"schemaVersion", "purpose", "entries"}
            or capsule["schemaVersion"] != "matrix-policy-history-v3"
            or capsule["purpose"] != "FINITE_HISTORICAL_MATRIX_IDENTITIES"
            or type(capsule["entries"]) is not list or len(capsule["entries"]) != 4):
        _fail()
    expected = (*_HISTORY_IDENTITIES,
        ("matrix-text-facts-column-pylon-section-v12", "12", _ACCEPTED_V12_CONFIG_HASH))
    for row, (profile, adapter, config_hash) in zip(capsule["entries"], expected):
        if (type(row) is not dict or set(row) != {"profileId", "adapterVersion", "configHash", "definitions"}
                or row["profileId"] != profile or row["adapterVersion"] != adapter
                or row["configHash"] != config_hash or type(row["definitions"]) is not dict
                or _v12._sha(row["definitions"]) != config_hash):
            _fail()
    return deepcopy(capsule["entries"][3]["definitions"])


def _validate_base_runtime(definitions: dict[str, Any], registries: tuple[Any, ...]) -> None:
    """Real inherited validation body; no archived lease/entrypoint fabricated."""
    inventory_registry, call_registry, rail_registry, water_registry, lighting_registry, steel_registry, column_registry = registries
    base={k:v for k,v in definitions.items() if k!='columnPylonSectionExecution'}
    if (_v12._sha(base)!=_v12.COLUMN_BASE_CONFIG_HASH
            or _v12._canonical(definitions.get('columnPylonSectionExecution'))!=_v12._canonical(_v12._column_pylon_section_policy(column_registry))):
        raise ValueError('column/pylon definitions differ from frozen v11 or typed policy')
    v9={k:v for k,v in base.items() if k!='steelExecution'}
    if (_v12._sha(v9)!=_v12.BASE_CONFIG_HASH
            or _v12._canonical(base.get('steelExecution'))!=_v12._canonical(_v12._steel_policy(steel_registry))
            or _v12._canonical(v9.get('lightingTechnologyExecution'))!=_v12._canonical(_v12._v9._lighting_technology_policy(lighting_registry))):
        raise ValueError('steel definitions differ from frozen v9 or typed policies')
    v8={k:v for k,v in v9.items() if k!='lightingTechnologyExecution'}
    if (_v12._sha(v8)!=_v12._v9.BASE_CONFIG_HASH
            or _v12._canonical(v9.get('lightingTechnologyExecution'))!=_v12._canonical(_v12._v9._lighting_technology_policy(lighting_registry))
            or _v12._canonical(v8.get('waterNodeExecution'))!=_v12._canonical(_v12._v8._water_node_policy(water_registry))):
        raise ValueError('lighting definitions differ from frozen v8 or typed policies')
    v7={k:v for k,v in v8.items() if k!='waterNodeExecution'}
    if (_v12._sha(v7)!=_v12._v8.BASE_CONFIG_HASH
            or _v12._canonical(v7.get('railExecution'))!=_v12._canonical(_v12._v7._rail_inventory_policy(rail_registry))):
        raise ValueError('lighting base differs from frozen v7')
    v6={k:v for k,v in v7.items() if k!='railExecution'}
    if (_v12._sha(v6)!=_v12._v7.BASE_CONFIG_HASH
            or _v12._canonical(v7.get('railExecution'))!=_v12._canonical(_v12._v7._rail_inventory_policy(rail_registry))
            or _v12._canonical(v6.get('callInventoryExecution'))!=_v12._canonical(_v12._v6._call_inventory_policy(call_registry))):
        raise ValueError('rail inventory definitions differ from frozen v6 or typed policies')
    v5={k:v for k,v in v6.items() if k!='callInventoryExecution'}
    if (_v12._sha(v5)!=_v12._v6.BASE_CONFIG_HASH
            or _v12._canonical(v5.get('inventoryExecution'))!=_v12._canonical(_v12._base._inventory_policy(inventory_registry))):
        raise ValueError('lighting technology base differs from frozen v5')
    v4={k:v for k,v in v5.items() if k!='inventoryExecution'}
    if _v12._sha(v4)!=_v12._base.BASE_CONFIG_HASH:raise ValueError('lighting technology base differs from frozen v4')
    direct=[(v4['engineSourceSha256'],_v12.matrix_engine),(v4['factScopeSourceSha256'],_v12.matrix_fact_scope),
        (v4['projectZeroProse']['sourceSha256'],_v12.project_zero_prose),
        (v4['rebarProse']['sourceSha256'],_v12.rebar_prose),(v4['concreteProse']['sourceSha256'],_v12.concrete_prose),
        (v4['projectConstraints']['sourceSha256'],_v12.project_constraints)]
    declaration=v4['sourceDeclarations']
    direct.extend([(declaration['sourceSha256'],_v12.source_declarations_v2),
        (declaration['legacySourceSha256'],_v12.source_declarations),(declaration['steelSourceSha256'],_v12.steel_prose),
        (declaration['fireSourceSha256'],_v12.fire_resistance_table),(declaration['tableBindingSourceSha256'],_v12.table_row_binding)])
    if any(expected!=_v12._file(module) for expected,module in direct) or _v12._canonical(v4['registry'])!=_v12._canonical(_v12.matrix_engine.load_matrix_registry()):
        raise ValueError('lighting technology base runtime source differs from frozen release')
    _v12.inventory_execution._registry(inventory_registry)
    _v12.call_inventory_execution._registry(call_registry)
    _v12.rail_inventory_execution._registry(rail_registry)
    _v12.water_node_execution._registry(water_registry)
    _v12.lighting_technology_execution._registry(lighting_registry)
    _v12.steel_execution._registry(steel_registry)


def _concrete_wall_policy(base_hash: str) -> dict[str, Any]:
    from . import concrete_wall_native_v13, concrete_wall_prose_v1
    from . import concrete_wall_scope_v1, concrete_wall_transport_v13
    from . import concrete_wall_fact_scope_v13, concrete_wall_matrix_engine_v13
    result = deepcopy(_WALL_LEAF_BLUEPRINT)
    result["baseConfigHash"] = base_hash
    result["sourcePins"] = {
        "concrete_wall_native_v13.py": _v12._file(concrete_wall_native_v13),
        "concrete_wall_fact_scope_v13.py": _v12._file(concrete_wall_fact_scope_v13),
        "concrete_wall_matrix_engine_v13.py": _v12._file(concrete_wall_matrix_engine_v13),
        "concrete_wall_prose_v1.py": _v12._file(concrete_wall_prose_v1),
        "concrete_wall_scope_v1.py": _v12._file(concrete_wall_scope_v1),
        "concrete_wall_transport_v13.py": _v12._file(concrete_wall_transport_v13),
        "concrete_wall_execution_v13.py": _v12._file(_wall),
        "durable_concrete_wall_matrix_v13.py": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    return result


def _validate_policy_body(lease: dict[str, Any], registries: tuple[Any, ...]) -> str:
    """Private body, called only after whole native admission at both entrypoints."""
    release = lease.get("release")
    rules = release.get("rules") if type(release) is dict else None
    definitions = rules.get("matrixDefinitions") if type(rules) is dict else None
    if (type(release) is not dict or release.get("lifecycle") != "DRAFT"
            or release.get("externalNetworkAllowed") is not False
            or type(rules) is not dict or rules.get("executionStatus") != "PILOT"
            or type(definitions) is not dict or "concreteWallExecution" not in definitions):
        _fail()
    if type(registries) is not tuple or len(registries) != 7:
        _fail()
    for registry in registries:
        canonical_concrete_wall_lease_native_v13(registry)
    accepted = _accepted_v12_definitions()
    base = {key: value for key, value in definitions.items() if key != "concreteWallExecution"}
    if _v12._canonical(base) != _v12._canonical(accepted):
        _fail()
    base_hash = _v12._sha(accepted)
    if _v12._canonical(definitions["concreteWallExecution"]) != _v12._canonical(_concrete_wall_policy(base_hash)):
        _fail()
    _validate_base_runtime(accepted, registries)
    return _v12._sha(definitions)


def _validate_release(lease: Any, registries: tuple[Any, ...]) -> tuple[dict[str, Any], str]:
    canonical_concrete_wall_lease_native_v13(lease)
    if type(lease) is not dict or type(lease.get("release")) is not dict:
        _fail()
    slot = lease["release"].get("providerSlot")
    if (type(slot) is not dict or slot.get("profileId") != PROFILE_ID or slot.get("adapterVersion") != ADAPTER_VERSION
            or slot.get("providerKind") != "RULE_ENGINE" or slot.get("stageJobType") != "RULE_EVALUATION"
            or slot.get("status") != "CONFIGURED"):
        _fail()
    config_hash = _validate_policy_body(lease, registries)
    if slot.get("configHash") != config_hash:
        _fail()
    return deepcopy(slot), config_hash


def _completion_marker_v13(lease: Any, job_type: str) -> bool:
    """Own RULE/SEAL policy; never infer v13 from inherited v12 marker alone."""
    canonical_concrete_wall_lease_native_v13(lease)
    if job_type not in {"RULE_EVALUATION", "ANALYSIS_SEAL_UNSUPPORTED"}:
        return False
    if type(lease) is not dict:
        _fail()
    registries = _v12._load_capability_registries()
    if job_type == "RULE_EVALUATION":
        _validate_release(lease, registries)
    else:
        _validate_policy_body(lease, registries)
    return True


def download_concrete_wall_reviewed_inventory_inputs_v13(lease: Any, attempt: Any) -> dict[str, Any]:
    canonical_concrete_wall_lease_native_v13({"lease": lease, "attempt": attempt})
    if type(lease) is not dict or type(attempt) is not dict:
        _fail()
    if (type(lease.get("jobId")) is not str or not lease["jobId"]
            or type(attempt.get("attemptId")) is not str or not attempt["attemptId"]
            or type(attempt.get("fencingToken")) is not int or attempt["fencingToken"] < 1):
        _fail()
    base = urllib.parse.urlsplit(os.environ["INSPECTOR_API_INTERNAL_URL"])
    if base.scheme not in {"http", "https"} or not base.hostname or base.username or base.password or base.query or base.fragment:
        _fail()
    path = ("/api/internal/v1/jobs/" + urllib.parse.quote(lease["jobId"], safe="")
            + "/concrete-wall-reviewed-inventory-comparison-inputs?" + urllib.parse.urlencode({
                "attemptId": attempt["attemptId"], "fencingToken": attempt["fencingToken"]}))
    constructor = http.client.HTTPSConnection if base.scheme == "https" else http.client.HTTPConnection
    connection = constructor(base.hostname, port=base.port, timeout=LOADER_SOCKET_DEADLINE_SECONDS)
    deadline = time.monotonic() + LOADER_SOCKET_DEADLINE_SECONDS
    response = None
    try:
        connection.request("GET", path, headers={"X-Worker-Token": os.environ["INTERNAL_WORKER_TOKEN"]})
        stream_socket = connection.sock
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("concrete wall loader deadline exceeded")
        stream_socket.settimeout(remaining)
        response = connection.getresponse()
        if response.status == 409:
            raise _v12.TextArtifactLeaseLost("concrete wall loader attempt stale or terminal")
        if response.status != 200:
            raise ValueError("concrete wall loader non-success HTTP status")
        length, digest = response.getheader("Content-Length"), response.getheader("X-Content-SHA256")
        if (type(length) is not str or re.fullmatch(r"[0-9]{1,8}", length) is None
                or not 0 < int(length) <= MAX_LOADER_BYTES or type(digest) is not str
                or re.fullmatch(r"[a-f0-9]{64}", digest) is None
                or response.getheader("X-Artifact-Schema-Version") != LOADER_SCHEMA
                or response.getheader("X-Input-Manifest-SHA256") != lease.get("inputManifestHash")):
            _fail()
        chunks, size = [], 0
        while size < int(length):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("concrete wall loader deadline exceeded")
            stream_socket.settimeout(remaining)
            chunk = response.read1(min(65536, int(length) - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_LOADER_BYTES or size > int(length):
                _fail("INPUT_LIMIT")
            chunks.append(chunk)
        body = b"".join(chunks)
        if len(body) != int(length) or hashlib.sha256(body).hexdigest() != digest:
            _fail()
        value = json.loads(body.decode("utf-8"), object_pairs_hook=_v12._unique_object,
            parse_float=_v12._reject_constant, parse_constant=_v12._reject_constant, parse_int=_v12._safe_json_int)
    finally:
        if response is not None:
            response.close()
        connection.close()
    # Unchanged thirteen-key parent; no v12 route or release emulation.
    return _v12._validate_loader(value, lease)


def execute_durable_concrete_wall_matrix_v13(lease: Any, attempt: Any) -> dict[str, Any]:
    canonical_concrete_wall_lease_native_v13(lease)
    canonical_concrete_wall_lease_native_v13(attempt)
    registries = _v12._load_capability_registries()
    slot, config_hash = _validate_release(lease, registries)
    window = project_concrete_wall_window_v13(lease)
    package = download_concrete_wall_reviewed_inventory_inputs_v13(lease, attempt)
    ir, cr, rr, wr, lr, sr, pr = registries
    inventory = _v12.inventory_execution.build_inventory_comparisons(package["inventory"], ir)
    call = _v12.call_inventory_execution.build_call_inventory_comparisons(package["callInventory"], cr)
    rail = _v12.rail_inventory_execution.build_rail_inventory_comparisons(package["railInventory"], rr)
    water = _v12.water_node_execution.build_water_node_comparisons(package["waterNode"], wr)
    lighting = _v12.lighting_technology_execution.build_lighting_technology_comparisons(package["lightingTechnology"], lr)
    steel = _v12.steel_execution.build_steel_comparisons(package["steelComparison"], sr)
    column = _v12.column_pylon_section_execution.build_column_pylon_section_comparisons(
        package["columnPylonSection"], package["columnPylonSectionSnapshot"], pr)
    sources, artifacts = [], []
    for source in window["inputs"]["sourceFiles"]:
        decision = window["inputs"]["sourceDecisions"].get(source["sourceFileId"])
        sources.append({**source, **_v12._reviewed_source(source, decision),
            "sectionCode": decision["sectionCode"] if decision is not None else source["sectionCode"],
            "scopeProofs": decision["scopeProofs"] if decision is not None else {}})
        if source["mediaType"] == "application/pdf":
            artifacts.append(_v12.download_text_artifact(lease, source, attempt))
    execution = _wall.build_concrete_wall_execution_v13(window=window, text_artifacts=artifacts,
        registry=_v12.matrix_engine.load_matrix_registry())
    coverage = _v12.inventory_execution.merge_inventory_coverage(execution["coverage"], inventory, ir)
    coverage = _v12.call_inventory_execution.merge_call_inventory_coverage(coverage, call, cr)
    coverage = _v12.rail_inventory_execution.merge_rail_inventory_coverage(coverage, rail, rr)
    coverage = _v12.water_node_execution.merge_water_node_coverage(coverage, water, wr)
    coverage = _v12.lighting_technology_execution.merge_lighting_technology_coverage(coverage, lighting, lr)
    coverage = _v12.steel_execution.merge_steel_comparison_coverage(coverage, steel, sr)
    coverage = _v12.column_pylon_section_execution.merge_column_pylon_section_coverage(coverage, column, pr)
    return {"schemaVersion": "analysis-stage-result-v2", "jobType": "RULE_EVALUATION",
        "inputManifestHash": lease["inputManifestHash"], "disposition": "RULES_EVALUATED",
        "providerKind": "RULE_ENGINE", "providerProfileId": slot["profileId"], "providerConfigHash": config_hash,
        "outputCount": sum(len(value["results"]) for value in (execution, inventory, call, rail, water, lighting, steel, column)),
        "execution": execution,
        "projectConstraints": _v12.project_constraints.extract_project_constraints(lease["objectId"], lease["inputManifestHash"], sources, artifacts),
        "sourceDeclarations": _v12.source_declarations_v2.extract_source_declarations({"objectId": lease["objectId"],
            "inputManifestHash": lease["inputManifestHash"], "sources": sources, "textArtifacts": artifacts}),
        "inventoryComparisons": inventory, "callInventoryComparisons": call, "railInventoryComparisons": rail,
        "waterNodeComparisons": water, "lightingTechnologyComparisons": lighting, "steelComparisons": steel,
        "steelApplicabilitySnapshot": deepcopy(package["steelApplicabilitySnapshot"]),
        "columnPylonSectionComparisons": column, "columnPylonSectionSnapshot": deepcopy(package["columnPylonSectionSnapshot"]),
        "effectiveCoverage": coverage}
