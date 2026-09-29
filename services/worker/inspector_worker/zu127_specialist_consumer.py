"""F0152 public fixture adapter, not a general ZU-127 production consumer.

The normal rules.evaluate consumer must never import or select this profile.
This module hardcodes one audited public PDF's object, SHA and byte size.
It can evaluate an already claimed, explicitly selected F0152 fixture lease,
but cannot acknowledge a queue delivery. A production consumer needs a
source-independent release contract and independent durable API validation.
"""

from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from .text_layer import _download_source, _source_metadata
from .zu127_window_table_poppler_v2 import PUBLIC_OBJECT_ID, PUBLIC_SHA, PUBLIC_SIZE
from .zu127_window_table_run_review import (
    PROFILE_ID,
    _version,
    evaluate_reviewed_zu127_window_table,
)


SPECIALIST_QUEUE = "rules.evaluate.zu127.poppler-v2"
SPECIALIST_JOB_TYPE = "RULE_EVALUATION"
_DOWNLOAD = Callable[[str, Path, str, int, dict[str, object]], None]
_SHA = re.compile(r"[a-f0-9]{64}\Z")


def fixture_claim_payload(worker_id: str) -> dict[str, object]:
    if not isinstance(worker_id, str) or not worker_id.strip():
        raise ValueError("ZU-127 specialist worker identity required")
    return {"workerId": worker_id, "capabilities": [SPECIALIST_JOB_TYPE],
            "queueName": SPECIALIST_QUEUE}


def verify_runtime() -> None:
    """Check the exact Poppler identity before accepting any work."""
    _version("pdftotext")
    _version("pdfinfo")


def evaluate_f0152_fixture_lease(
    lease: dict[str, Any],
    attempt: dict[str, object],
    *,
    download: _DOWNLOAD = _download_source,
) -> dict[str, Any]:
    """Evaluate fenced F0152 fixture input; caller owns heartbeat and commit.

    This is not registered with the normal stage provider registry. Current
    API lacks the specialist result validator, so production code must not
    call it from a message handler. It cannot handle arbitrary source files.
    """
    if (not isinstance(attempt.get("attemptId"), str)
            or not attempt["attemptId"]
            or type(attempt.get("fencingToken")) is not int
            or attempt["fencingToken"] < 1
            or lease.get("jobType") != SPECIALIST_JOB_TYPE
            or not isinstance(lease.get("jobId"), str)
            or not lease["jobId"]
            or lease.get("objectId") != PUBLIC_OBJECT_ID
            or not isinstance(lease.get("inputManifestHash"), str)
            or _SHA.fullmatch(lease["inputManifestHash"]) is None):
        raise ValueError("ZU-127 specialist requires fenced RULE_EVALUATION lease")
    release = lease.get("release")
    slot = release.get("providerSlot") if isinstance(release, dict) else None
    if (not isinstance(release, dict) or release.get("lifecycle") != "DRAFT"
            or release.get("externalNetworkAllowed") is not False
            or not isinstance(slot, dict)
            or slot.get("stageJobType") != SPECIALIST_JOB_TYPE
            or slot.get("providerKind") != "RULE_ENGINE"
            or slot.get("status") != "CONFIGURED"
            or slot.get("profileId") != PROFILE_ID):
        raise ValueError("ZU-127 specialist requires explicit immutable profile")
    inputs = lease.get("inputs")
    sources = inputs.get("sourceFiles") if isinstance(inputs, dict) else None
    if not isinstance(sources, list):
        raise ValueError("ZU-127 specialist requires immutable source manifest")
    selected = [source for source in sources if isinstance(source, dict)
                and source.get("sha256") == PUBLIC_SHA]
    if len(selected) != 1:
        raise ValueError("ZU-127 specialist requires one exact F0152 source")
    source_id, sha256, size, media_type, download_path = _source_metadata(selected[0])
    if sha256 != PUBLIC_SHA or size != PUBLIC_SIZE or media_type != "application/pdf":
        raise ValueError("ZU-127 specialist source metadata mismatch")
    if selected[0].get("stages") != ["PD"]:
        raise ValueError("ZU-127 specialist requires PD source")
    if download_path != f"/api/internal/v1/jobs/{lease['jobId']}/inputs/{source_id}":
        raise ValueError("ZU-127 specialist source download path mismatch")

    # No PDF access for missing human review. The run gate produces a bounded
    # abstention before its first file or Poppler read in that case.
    no_file_result = evaluate_reviewed_zu127_window_table(
        lease, Path("/nonexistent-zu127-specialist-input"),
    ) if _review_gate_abstains(lease, source_id) else None
    if no_file_result is not None:
        return no_file_result

    decisions = inputs.get("sourceDecisions")
    decision = decisions.get(source_id) if isinstance(decisions, dict) else None
    if (not isinstance(decision, dict)
            or decision.get("sourceSha256") != PUBLIC_SHA
            or decision.get("revisionStatus") != "CURRENT"
            or decision.get("approvalStatus") != "APPROVED"
            or selected[0].get("sectionCode") != "ZU"
            or decision.get("sectionCode") != "ZU"
            or decision.get("pageStages") not in ({}, {"49": "PD", "51": "PD"})
            or not isinstance(decision.get("basis"), dict)
            or not isinstance(decision["basis"].get("reference"), str)
            or len(decision["basis"]["reference"].strip()) < 8):
        raise ValueError("ZU-127 specialist requires authenticated source review")

    verify_runtime()
    with tempfile.TemporaryDirectory(prefix="inspector-zu127-") as directory:
        path = Path(directory) / "source.pdf"
        download(download_path, path, sha256, size, attempt)
        return evaluate_reviewed_zu127_window_table(lease, path)


def _review_gate_abstains(lease: dict[str, Any], source_id: str) -> bool:
    inputs = lease.get("inputs")
    decisions = inputs.get("sourceDecisions") if isinstance(inputs, dict) else None
    if not isinstance(decisions, dict):
        return False
    decision = decisions.get(source_id)
    if decision is None:
        return True
    if not isinstance(decision, dict):
        return False
    if (decision.get("revisionStatus") != "CURRENT"
            or decision.get("approvalStatus") != "APPROVED"):
        return True
    sources = inputs.get("sourceFiles")
    source = next((item for item in sources if isinstance(item, dict)
                   and item.get("sourceFileId") == source_id), None)
    return source is not None and (source.get("sectionCode") != "ZU"
                                   or decision.get("sectionCode") != "ZU")


def main() -> None:
    parser = argparse.ArgumentParser(description="F0152 public fixture Poppler preflight; no durable consumer")
    parser.add_argument("--queue", default=SPECIALIST_QUEUE)
    parser.add_argument("--check", action="store_true", help="Verify pinned runtime only")
    args = parser.parse_args()
    if args.queue != SPECIALIST_QUEUE:
        parser.error(f"specialist queue must be {SPECIALIST_QUEUE}")
    verify_runtime()
    if args.check:
        return
    # No passive declaration, basic_consume, claim, or ack until API has
    # queue routing, independent full-page validation, and a durable schema.
    raise SystemExit("F0152 fixture has no durable API contract or consumer")


if __name__ == "__main__":
    main()
