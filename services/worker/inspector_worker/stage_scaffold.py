from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Protocol


STAGE_RESULT_SCHEMA_VERSION = "analysis-stage-result-v1"


@dataclass(frozen=True)
class StageScaffoldContract:
    disposition: str
    reason_code: str
    provider_kind: str


STAGE_SCAFFOLD_CONTRACTS = {
    "DOCUMENT_RENDER": StageScaffoldContract(
        "PROVIDER_NOT_CONFIGURED",
        "RENDERER_PROFILE_NOT_SELECTED",
        "RENDERER",
    ),
    "DOCUMENT_OCR_LAYOUT": StageScaffoldContract(
        "PROVIDER_NOT_CONFIGURED",
        "OCR_LAYOUT_PROFILE_NOT_SELECTED",
        "OCR_LAYOUT",
    ),
    "DOCUMENT_METADATA": StageScaffoldContract(
        "PROVIDER_NOT_CONFIGURED",
        "METADATA_PROFILE_NOT_SELECTED",
        "METADATA_EXTRACTOR",
    ),
    "DOCUMENT_LINKING": StageScaffoldContract(
        "POLICY_NOT_CONFIGURED",
        "LINKING_POLICY_NOT_SELECTED",
        "LINKING_POLICY",
    ),
    "ENTITY_EXTRACTION": StageScaffoldContract(
        "PROVIDER_NOT_CONFIGURED",
        "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED",
        "ENTITY_EXTRACTION_MODEL",
    ),
    "RULE_EVALUATION": StageScaffoldContract(
        "UNSUPPORTED_RULESET",
        "EXECUTABLE_RULES_NOT_CONFIGURED",
        "RULE_ENGINE",
    ),
    "EVIDENCE_VALIDATION": StageScaffoldContract(
        "NO_MACHINE_RESULTS",
        "RULE_RESULTS_UNAVAILABLE",
        "EVIDENCE_VALIDATOR",
    ),
}

SCAFFOLD_JOB_TYPES = tuple(STAGE_SCAFFOLD_CONTRACTS)


class StageProviderAdapter(Protocol):
    job_type: str
    provider_kind: str

    def execute(
        self,
        lease: dict[str, object],
        attempt: dict[str, object],
    ) -> dict[str, object]: ...


class StageProviderRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, StageProviderAdapter] = {}

    def register(self, adapter: StageProviderAdapter) -> None:
        contract = STAGE_SCAFFOLD_CONTRACTS.get(adapter.job_type)
        if contract is None:
            raise ValueError(f"unsupported scaffold job_type {adapter.job_type}")
        if adapter.provider_kind != contract.provider_kind:
            raise ValueError(
                f"provider kind {adapter.provider_kind} does not match {contract.provider_kind}"
            )
        if adapter.job_type in self._adapters:
            raise ValueError(f"provider adapter for {adapter.job_type} is already registered")
        self._adapters[adapter.job_type] = adapter

    def execute(
        self,
        job_type: str,
        lease: dict[str, object],
        attempt: dict[str, object],
    ) -> dict[str, object]:
        contract = STAGE_SCAFFOLD_CONTRACTS.get(job_type)
        if contract is None:
            raise ValueError(f"unsupported scaffold job_type {job_type}")
        release = lease.get("release")
        provider_slot: dict[str, object] | None = None
        if isinstance(release, dict):
            if release.get("externalNetworkAllowed") is not False:
                raise ValueError("analysis release must disable external network access")
            raw_slot = release.get("providerSlot")
            if raw_slot is not None and not isinstance(raw_slot, dict):
                raise ValueError("analysis release providerSlot must be an object or null")
            provider_slot = raw_slot
            if provider_slot is not None and provider_slot.get("providerKind") != contract.provider_kind:
                raise ValueError("analysis release provider slot does not match the job contract")
        adapter = self._adapters.get(job_type)
        if provider_slot is not None and provider_slot.get("status") == "CONFIGURED":
            if adapter is None:
                raise ValueError(f"configured provider adapter for {job_type} is unavailable")
            result = adapter.execute(lease, attempt)
            if not isinstance(result, dict):
                raise ValueError(f"provider adapter for {job_type} returned a non-object result")
            return result
        if provider_slot is not None and provider_slot.get("status") != "UNCONFIGURED":
            raise ValueError(f"provider slot for {job_type} has an unknown status")
        return build_unconfigured_stage_result(job_type, str(lease.get("inputManifestHash", "")))


DEFAULT_STAGE_PROVIDER_REGISTRY = StageProviderRegistry()


def build_unconfigured_stage_result(job_type: str, input_manifest_hash: str) -> dict[str, object]:
    contract = STAGE_SCAFFOLD_CONTRACTS.get(job_type)
    if contract is None:
        raise ValueError(f"unsupported scaffold job_type {job_type}")
    if not re.fullmatch(r"[a-f0-9]{64}", input_manifest_hash):
        raise ValueError("inputManifestHash must be a lowercase sha256")
    return {
        "schemaVersion": STAGE_RESULT_SCHEMA_VERSION,
        "jobType": job_type,
        "inputManifestHash": input_manifest_hash,
        "disposition": contract.disposition,
        "reasonCode": contract.reason_code,
        "providerKind": contract.provider_kind,
        "providerProfileId": None,
        "providerConfigHash": None,
        "outputCount": 0,
    }
