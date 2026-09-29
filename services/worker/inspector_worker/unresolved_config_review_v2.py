"""Pure review-only navigation for audited approval and safety code families.

This separate pinned profile reuses the v1 scan engine. It is deliberately not
connected to a durable rule or release profile: no result is a typed fact,
finding, absence conclusion, or parameter coverage.
"""

from __future__ import annotations

from typing import Any

from .run_candidate_family_preview import load_durable_candidate_family_inputs
from .unresolved_config_review import (
    APPROVAL_CODES, SAFETY_CODES, V2_CODES, V2_CONFIG_PATH, V2_CONFIG_SHA256,
    V2_PROFILE_ID, V2_SCHEMA_VERSION, evaluate_unresolved_config_review,
    load_unresolved_review_config,
)


def load_unresolved_review_config_v2() -> dict[str, Any]:
    return load_unresolved_review_config(profile_id="v2")


def evaluate_unresolved_config_review_v2(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], *, config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return evaluate_unresolved_config_review(
        object_id, input_manifest_hash, sources, text_artifacts,
        config=config, profile_id="v2")


def execute_durable_unresolved_config_review_v2(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    return evaluate_unresolved_config_review_v2(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
