"""Pure seven-code network navigation over reviewed, committed text.

This profile locates literal lines only. It does not identify a circuit,
connected branch, barrier penetration, applicable norm, PD/RD pair, or absence.
The durable adapter uses this evaluator only under its separate opt-in release.
"""

from __future__ import annotations

from typing import Any

from .run_candidate_family_preview import load_durable_candidate_family_inputs
from .unresolved_config_review import (
    NETWORK_CODES, V3_CONFIG_PATH, V3_CONFIG_SHA256, V3_PROFILE_ID,
    V3_SCHEMA_VERSION, evaluate_unresolved_config_review,
    load_unresolved_review_config,
)


def load_unresolved_review_config_v3() -> dict[str, Any]:
    return load_unresolved_review_config(profile_id="v3")


def evaluate_unresolved_config_review_v3(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], *, config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return evaluate_unresolved_config_review(
        object_id, input_manifest_hash, sources, text_artifacts,
        config=config, profile_id="v3")


def execute_durable_unresolved_config_review_v3(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_unresolved_config_review_v3(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
