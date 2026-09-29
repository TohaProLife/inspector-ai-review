"""Three review-only candidate aids from one fenced text/source snapshot.

The caller supplies the committed OCR stage returned by the same fenced rule
attempt. OCR leads stay separate from typed facts and coverage.
"""

from __future__ import annotations

from typing import Any

from .candidate_family_ocr_observations import evaluate_run_candidate_family_ocr_observations
from .durable_candidate_family_observations import _fit_combined_budget
from .run_candidate_family_preview import (
    evaluate_run_candidate_family_preview,
    load_durable_candidate_family_inputs,
)
from .review_candidates import evaluate_review_candidates


def execute_durable_candidate_family_ocr_observations(
    lease: dict[str, Any], attempt: dict[str, Any], ocr_stage: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Return text preview, text observations and committed OCR observations."""
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    object_id, manifest_hash = lease.get("objectId"), lease.get("inputManifestHash")
    preview = evaluate_run_candidate_family_preview(
        object_id, manifest_hash, sources, artifacts)
    preview, observations = _fit_combined_budget(preview, sources, artifacts)
    ocr_observations = evaluate_run_candidate_family_ocr_observations(
        object_id, manifest_hash, sources, artifacts, ocr_stage)
    if (preview.get("inputManifestHash") != manifest_hash
            or observations.get("inputManifestHash") != manifest_hash
            or ocr_observations.get("inputManifestHash") != manifest_hash):
        raise ValueError("candidate review aids manifest hash mismatch")
    return {
        "candidateFamilyPreview": preview,
        "candidateFamilyObservations": observations,
        "candidateFamilyOcrObservations": ocr_observations,
        "reviewCandidates": evaluate_review_candidates(object_id, manifest_hash, sources, artifacts),
    }
