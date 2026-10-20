"""Generic matrix execution on committed bytes. No public labels or external provider."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from . import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose, rebar_prose, concrete_prose, source_declarations, source_declarations_v2, steel_prose, fire_resistance_table, table_row_binding
from .durable_pz002 import _reviewed_source
from .durable_text import download_text_artifact
from .matrix_engine import build_matrix_execution, load_matrix_registry


def execute_durable_matrix(lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
    release = lease.get("release", {})
    slot = release.get("providerSlot", {})
    definitions = release.get("rules", {}).get("matrixDefinitions")
    profile = slot.get("profileId")
    profile_capabilities = {
        "matrix-text-facts-v1": {"adapterVersion": "1", "constraints": False, "declarations": False},
        "matrix-text-facts-constraints-v2": {"adapterVersion": "2", "constraints": True, "declarations": False},
        "matrix-text-facts-evidence-v3": {"adapterVersion": "3", "constraints": True, "declarations": True},
        "matrix-text-facts-evidence-v4": {"adapterVersion": "4", "constraints": True, "declarations": True},
    }
    if (release.get("lifecycle") != "DRAFT" or release.get("externalNetworkAllowed") is not False
            or profile not in profile_capabilities
            or slot.get("adapterVersion") != profile_capabilities.get(profile, {}).get("adapterVersion") or slot.get("providerKind") != "RULE_ENGINE"
            or slot.get("stageJobType") != "RULE_EVALUATION" or slot.get("status") != "CONFIGURED"
            or not isinstance(definitions, dict)):
        raise ValueError("invalid matrix execution release")
    engine_hash = hashlib.sha256(Path(matrix_engine.__file__).read_bytes()).hexdigest()
    if definitions.get("engineSourceSha256") != engine_hash:
        raise ValueError("matrix engine source differs from pinned release")
    helper_hash = hashlib.sha256(Path(matrix_fact_scope.__file__).read_bytes()).hexdigest()
    if definitions.get("factScopeSourceSha256") != helper_hash:
        raise ValueError("matrix fact scope source differs from pinned release")
    expected_zero = {
        "extractorVersion": project_zero_prose.EXTRACTOR_VERSION,
        "sourceSha256": hashlib.sha256(Path(project_zero_prose.__file__).read_bytes()).hexdigest(),
    }
    if definitions.get("projectZeroProse") != expected_zero:
        raise ValueError("matrix project zero prose differs from pinned release")
    expected_rebar = {
        "extractorVersion": rebar_prose.EXTRACTOR_VERSION,
        "sourceSha256": hashlib.sha256(Path(rebar_prose.__file__).read_bytes()).hexdigest(),
    }
    if definitions.get("rebarProse") != expected_rebar:
        raise ValueError("matrix rebar prose differs from pinned release")
    expected_concrete = {
        "extractorVersion": concrete_prose.EXTRACTOR_VERSION,
        "sourceSha256": hashlib.sha256(Path(concrete_prose.__file__).read_bytes()).hexdigest(),
    }
    if definitions.get("concreteProse") != expected_concrete:
        raise ValueError("matrix concrete prose differs from pinned release")
    if profile_capabilities[profile]["constraints"]:
        expected_constraints = {
            "schemaVersion": "matrix-project-constraints-v1",
            "extractorVersion": project_constraints.EXTRACTOR_VERSION,
            "sourceSha256": hashlib.sha256(Path(project_constraints.__file__).read_bytes()).hexdigest(),
            "purpose": "EVIDENCE_ONLY",
        }
        if definitions.get("projectConstraints") != expected_constraints:
            raise ValueError("matrix project constraints differ from pinned release")
    elif "projectConstraints" in definitions:
        raise ValueError("legacy matrix profile cannot carry project constraints")
    if profile_capabilities[profile]["declarations"]:
        expected_declarations = {
            "schemaVersion": source_declarations.SCHEMA_VERSION,
            "extractorVersion": source_declarations.EXTRACTOR_VERSION,
            "sourceSha256": hashlib.sha256(Path(source_declarations.__file__).read_bytes()).hexdigest(),
            "steelExtractorVersion": steel_prose.EXTRACTOR_VERSION,
            "steelSourceSha256": hashlib.sha256(Path(steel_prose.__file__).read_bytes()).hexdigest(),
            "hashPolicyVersion": source_declarations.HASH_POLICY_VERSION,
            "purpose": "EVIDENCE_ONLY",
        }
        if profile == "matrix-text-facts-evidence-v4":
            expected_declarations.update({
                "schemaVersion": source_declarations_v2.SCHEMA_VERSION,
                "extractorVersion": source_declarations_v2.EXTRACTOR_VERSION,
                "sourceSha256": hashlib.sha256(Path(source_declarations_v2.__file__).read_bytes()).hexdigest(),
                "legacyExtractorVersion": source_declarations.EXTRACTOR_VERSION,
                "legacySourceSha256": hashlib.sha256(Path(source_declarations.__file__).read_bytes()).hexdigest(),
                "fireExtractorVersion": fire_resistance_table.EXTRACTOR_VERSION,
                "fireSourceSha256": hashlib.sha256(Path(fire_resistance_table.__file__).read_bytes()).hexdigest(),
                "tableBindingVersion": table_row_binding.BINDER_VERSION,
                "tableBindingSourceSha256": hashlib.sha256(Path(table_row_binding.__file__).read_bytes()).hexdigest(),
                "bindingPolicyVersion": fire_resistance_table.BINDING_POLICY_VERSION,
            })
        if definitions.get("sourceDeclarations") != expected_declarations:
            raise ValueError("matrix source declarations differ from pinned release")
    elif "sourceDeclarations" in definitions:
        raise ValueError("older matrix profile cannot carry source declarations")
    registry = load_matrix_registry()
    if definitions.get("registry") != registry:
        raise ValueError("matrix registry differs from pinned release")
    config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False, sort_keys=True,
                                          separators=(",", ":")).encode()).hexdigest()
    if slot.get("configHash") != config_hash:
        raise ValueError("matrix definitions hash mismatch")
    inputs = lease["inputs"]
    sources, artifacts = [], []
    for source in inputs["sourceFiles"]:
        decision = inputs.get("sourceDecisions", {}).get(source["sourceFileId"])
        sources.append({**source, **_reviewed_source(source, decision),
                        "scopeProofs": (decision or {}).get("scopeProofs", {})})
        if source.get("mediaType") == "application/pdf":
            artifacts.append(download_text_artifact(lease, source, attempt))
    execution = build_matrix_execution(object_id=lease["objectId"],
        input_manifest_hash=lease["inputManifestHash"], sources=sources,
        text_artifacts=artifacts, registry=registry)
    result = {"schemaVersion": "analysis-stage-result-v2", "jobType": "RULE_EVALUATION",
        "inputManifestHash": lease["inputManifestHash"], "disposition": "RULES_EVALUATED",
        "providerKind": "RULE_ENGINE", "providerProfileId": slot["profileId"],
        "providerConfigHash": config_hash, "outputCount": len(execution["results"]),
        "execution": execution}
    if profile_capabilities[profile]["constraints"]:
        result["projectConstraints"] = project_constraints.extract_project_constraints(
            lease["objectId"], lease["inputManifestHash"], sources, artifacts)
    if profile_capabilities[profile]["declarations"]:
        declaration_extractor = (source_declarations_v2.extract_source_declarations
                                 if profile == "matrix-text-facts-evidence-v4"
                                 else source_declarations.extract_source_declarations)
        result["sourceDeclarations"] = declaration_extractor({
            "objectId": lease["objectId"], "inputManifestHash": lease["inputManifestHash"],
            "sources": sources, "textArtifacts": artifacts})
    return result
