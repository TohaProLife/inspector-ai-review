"""One fenced text read for the candidate preview and its review-only observations."""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any

from .candidate_family_observations import extract_candidate_family_observations
from .run_candidate_family_preview import (
    _hash,
    evaluate_run_candidate_family_preview,
    load_durable_candidate_family_inputs,
)
from .review_candidates import evaluate_review_candidates


_MAX_COMBINED_BYTES = 2 * 1024 * 1024


def _combined_size(preview: dict[str, Any], observations: dict[str, Any]) -> int:
    return len(json.dumps({"candidateFamilyPreview": preview,
                           "candidateFamilyObservations": observations},
                          ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                          allow_nan=False).encode("utf-8"))


def _drop_last_leads(preview: dict[str, Any], count: int) -> dict[str, Any]:
    trimmed = deepcopy(preview)
    for row in reversed(trimmed["codeRows"]):
        if count == 0:
            break
        remove = min(count, row["leadCount"])
        if remove == 0:
            continue
        del row["candidateLeads"][-remove:]
        row["leadCount"] -= remove
        count -= remove
        reasons = set(row["reasonCodes"])
        reasons.add("PREVIEW_BYTE_BUDGET_REACHED")
        if row["leadCount"] == 0:
            reasons.discard("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED")
            reasons.add("NO_EXACT_LABEL_LEAD")
        row["reasonCodes"] = sorted(reasons)
    if count:
        raise ValueError("candidate observations requested more lead trimming than available")
    trimmed["contentHash"] = _hash({key: value for key, value in trimmed.items()
                                     if key != "contentHash"})
    return trimmed


def _fit_combined_budget(
    preview: dict[str, Any], sources: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    observations = extract_candidate_family_observations(preview, sources, artifacts)
    if _combined_size(preview, observations) <= _MAX_COMBINED_BYTES:
        return preview, observations
    available = sum(row["leadCount"] for row in preview["codeRows"])
    if available == 0:
        raise ValueError("candidate observations metadata exceeds 2 MiB budget")

    # Removing the latest lead in reverse code order preserves deterministic
    # navigation priority. Search for the smallest removal count that fits.
    low, high = 1, available
    fitted: tuple[dict[str, Any], dict[str, Any]] | None = None
    while low <= high:
        remove = (low + high) // 2
        candidate = _drop_last_leads(preview, remove)
        candidate_observations = extract_candidate_family_observations(
            candidate, sources, artifacts)
        if _combined_size(candidate, candidate_observations) <= _MAX_COMBINED_BYTES:
            fitted = candidate, candidate_observations
            high = remove - 1
        else:
            low = remove + 1
    if fitted is None:
        raise ValueError("candidate observations metadata exceeds 2 MiB budget")
    return fitted


def execute_durable_candidate_family_observations(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Return two review aids from one validated source/artifact snapshot."""
    sources, artifacts = load_durable_candidate_family_inputs(lease, attempt)
    preview = evaluate_run_candidate_family_preview(
        lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)
    preview, observations = _fit_combined_budget(preview, sources, artifacts)
    return {"candidateFamilyPreview": preview,
            "candidateFamilyObservations": observations,
            "reviewCandidates": evaluate_review_candidates(
                lease.get("objectId"), lease.get("inputManifestHash"), sources, artifacts)}
