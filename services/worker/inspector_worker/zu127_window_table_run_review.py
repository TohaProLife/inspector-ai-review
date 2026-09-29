"""Opt-in lease gate for public F0152 ZU-127 Poppler navigation.

This is a pure sidecar entry point, not registered in RULE_EVALUATION. The
normal release API cannot yet select this profile; an expert must also review
the manifest's OTHER section as ZU for the selected source.
Missing human review therefore returns ABSTAIN without opening the PDF.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .zu127_window_table_poppler_v2 import (
    PROFILE_ID, PUBLIC_OBJECT_ID, PUBLIC_PAGES, PUBLIC_SHA, PUBLIC_SIZE,
    SCHEMA_VERSION, SELECTED_PAGES, _run, evaluate_zu127_window_table_poppler_v2,
)


RUN_SCHEMA_VERSION = "zu127-window-table-run-review-v1"
POPPLER_VERSION = "25.12.0"
_SHA = re.compile(r"[a-f0-9]{64}\Z")


def _hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _version(program: str) -> str:
    stdout, stderr = _run(program, ["-v"], max_bytes=4096)
    lines = (stdout + stderr).decode("utf-8").splitlines()
    match = (re.fullmatch(rf"{re.escape(program)} version (\d+\.\d+\.\d+)", lines[0])
             if lines else None)
    if match is None or match.group(1) != POPPLER_VERSION:
        raise ValueError(f"ZU-127 requires {program} {POPPLER_VERSION}")
    return match.group(1)


def _abstain(manifest_hash: str, source_id: str, reason: str) -> dict[str, Any]:
    result = {"schemaVersion": RUN_SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "inputManifestHash": manifest_hash,
              "runSourceFileId": source_id, "sourceSha256": PUBLIC_SHA,
              "selectedPageNumbers": SELECTED_PAGES,
              "popplerVersion": None, "pageReceipts": [],
              "codeRows": [{"parameterCode": "ZU-127", "status": "ABSTAIN",
                            "reasonCodes": [reason], "proposalCount": 0,
                            "truncatedProposalCount": 0,
                            "absenceConclusion": "NOT_AVAILABLE", "typedFact": None,
                            "proposals": []}],
              "findings": None, "findingCount": None,
              "parameterCoverage": None, "typedFacts": None}
    result["contentHash"] = _hash(result)
    return result


def evaluate_reviewed_zu127_window_table(
    lease: dict[str, Any], pdf_path: Path,
) -> dict[str, Any]:
    """Return ABSTAIN review from exact source, approved scope, and Poppler 25.12.0.

    The PDF path must be downloaded through the normal immutable job-input
    endpoint before calling this function; underlying evaluator checks bytes.
    """
    manifest_hash = lease.get("inputManifestHash")
    release = lease.get("release")
    slot = release.get("providerSlot") if isinstance(release, dict) else None
    if (not isinstance(manifest_hash, str) or _SHA.fullmatch(manifest_hash) is None
            or lease.get("objectId") != PUBLIC_OBJECT_ID
            or not isinstance(release, dict) or release.get("lifecycle") != "DRAFT"
            or release.get("externalNetworkAllowed") is not False
            or not isinstance(slot, dict)
            or slot.get("stageJobType") != "RULE_EVALUATION"
            or slot.get("providerKind") != "RULE_ENGINE"
            or slot.get("status") != "CONFIGURED"
            or slot.get("profileId") != PROFILE_ID):
        raise ValueError("ZU-127 run review requires explicit immutable release selection")
    inputs = lease.get("inputs")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list) \
            or not isinstance(inputs.get("sourceDecisions"), dict):
        raise ValueError("ZU-127 run review requires immutable source manifest and decisions")
    matches = [item for item in inputs["sourceFiles"] if isinstance(item, dict)
               and item.get("sha256") == PUBLIC_SHA]
    if len(matches) != 1:
        raise ValueError("ZU-127 requires one exact F0152 source SHA")
    source = matches[0]
    source_id = source.get("sourceFileId")
    if (not isinstance(source_id, str) or not source_id
            or source.get("byteSize") != PUBLIC_SIZE
            or source.get("mediaType") != "application/pdf"
            or source.get("stages") != ["PD"]):
        raise ValueError("ZU-127 source metadata differs from audited F0152")
    decision = inputs["sourceDecisions"].get(source_id)
    if decision is None:
        return _abstain(manifest_hash, source_id, "SOURCE_REVIEW_REQUIRED")
    if not isinstance(decision, dict) or decision.get("sourceSha256") != PUBLIC_SHA:
        raise ValueError("ZU-127 source decision SHA mismatch")
    if (decision.get("revisionStatus") != "CURRENT"
            or decision.get("approvalStatus") != "APPROVED"):
        return _abstain(manifest_hash, source_id, "SOURCE_REVIEW_NOT_CURRENT_APPROVED")
    # Public manifest labels F0152 OTHER. The immutable reviewer decision must
    # explicitly identify it as ZU before this navigation is even eligible.
    if source.get("sectionCode") != "ZU" or decision.get("sectionCode") != "ZU":
        return _abstain(manifest_hash, source_id, "SOURCE_SECTION_UNRESOLVED")
    if decision.get("pageStages") not in ({}, {"49": "PD", "51": "PD"}):
        raise ValueError("ZU-127 page stage decision is invalid")
    basis = decision.get("basis")
    if (not isinstance(basis, dict) or not isinstance(basis.get("reference"), str)
            or len(basis["reference"].strip()) < 8):
        raise ValueError("ZU-127 approved source requires review basis")

    # Version gates precede any PDF read. Underlying profile rechecks source
    # SHA, size, Poppler extraction, and page receipts independently.
    _version("pdftotext")
    _version("pdfinfo")
    public_source = {"file_id": "F0152", "split": "TRAIN_PUBLIC",
                     "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                     "sha256": PUBLIC_SHA, "size_bytes": PUBLIC_SIZE,
                     "pdf_pages": PUBLIC_PAGES, "object_id": PUBLIC_OBJECT_ID,
                     "stage": "PD", "section": "OTHER"}
    review = evaluate_zu127_window_table_poppler_v2(Path(pdf_path), public_source,
                                                      SELECTED_PAGES.copy())
    rows = review.get("codeRows")
    receipts = review.get("pageReceipts")
    if (review.get("schemaVersion") != SCHEMA_VERSION
            or review.get("profileId") != PROFILE_ID
            or review.get("purpose") != "REVIEW_ONLY"
            or review.get("sourceFileId") != "F0152"
            or review.get("sourceSha256") != PUBLIC_SHA
            or review.get("sourceObjectId") != PUBLIC_OBJECT_ID
            or review.get("selectedPageNumbers") != SELECTED_PAGES
            or review.get("contentHash") != _hash({key: value for key, value in
                                                    review.items() if key != "contentHash"})
            or not isinstance(rows, list) or len(rows) != 1
            or rows[0].get("parameterCode") != "ZU-127"
            or rows[0].get("status") != "ABSTAIN"
            or rows[0].get("typedFact") is not None
            or rows[0].get("absenceConclusion") != "NOT_AVAILABLE"
            or not isinstance(rows[0].get("proposals"), list)
            or any(proposal.get("typedValues") is not None
                   or proposal.get("rowAssociationStatus") != "UNVERIFIED"
                   for proposal in rows[0]["proposals"])
            or review.get("findings") is not None
            or review.get("findingCount") is not None
            or review.get("parameterCoverage") is not None
            or review.get("typedFacts") is not None
            or not isinstance(receipts, list)
            or [receipt.get("pageNumber") for receipt in receipts] != SELECTED_PAGES
            or any(receipt.get("providerId")
                   != f"poppler-pdftotext-bbox-layout-v2@{POPPLER_VERSION}"
                   for receipt in receipts)):
        raise ValueError("ZU-127 Poppler review-only result invalid")
    result = {"schemaVersion": RUN_SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "inputManifestHash": manifest_hash,
              "runSourceFileId": source_id, "sourceSha256": PUBLIC_SHA,
              "selectedPageNumbers": SELECTED_PAGES,
              "popplerVersion": POPPLER_VERSION, "pageReceipts": receipts,
              "codeRows": rows, "findings": None, "findingCount": None,
              "parameterCoverage": None, "typedFacts": None,
              "pureReviewContentHash": review.get("contentHash")}
    result["contentHash"] = _hash(result)
    return result
