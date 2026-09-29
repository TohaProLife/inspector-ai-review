"""Opt-in fenced ZU-127 page navigation; deliberately not a durable consumer.

The lease reader trusts the API's fenced artifact endpoint for commitment. This
module does not authenticate a human decision independently, register a queue,
or allow a finding. A later API verifier must replay source and PDF evidence.
"""

from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from .durable_text import download_text_artifact
from .poppler_page_evidence import extract_poppler_page_evidence
from .text_layer import _download_source, _source_metadata
from .zu127_page_selection_v3 import (
    MAX_SELECTED_PAGES, select_zu127_review_pages, selected_poppler_page_scope,
)


PROFILE_ID = "zu127-generic-poppler-page-review-v3"
SCHEMA_VERSION = "zu127-generic-stage-v3"
MAX_STAGE_BYTES = 32 * 1024 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_PROFILE_DEFINITION = {
    "profileId": PROFILE_ID,
    "pageSelectionSchemaVersion": "zu127-page-selection-v3",
    "pageEvidenceSchemaVersion": "poppler-page-evidence-v1",
    "maxSelectedPages": MAX_SELECTED_PAGES,
    "disposition": "REVIEW_AID_ONLY",
}


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


PROFILE_CONFIG_HASH = _hash(_PROFILE_DEFINITION)
_TextDownload = Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], dict[str, Any]]
_SourceDownload = Callable[[str, Path, str, int, dict[str, object]], None]
_PageExtract = Callable[..., dict[str, Any]]


def _validate_lease(lease: dict[str, Any], attempt: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not isinstance(lease, dict) or not isinstance(attempt, dict):
        raise ValueError("ZU-127 v3 fenced lease required")
    if (lease.get("jobType") != "RULE_EVALUATION"
            or not isinstance(lease.get("jobId"), str) or not lease["jobId"]
            or not isinstance(lease.get("runId"), str) or not lease["runId"]
            or not isinstance(lease.get("releaseId"), str) or not lease["releaseId"]
            or not isinstance(lease.get("objectId"), str) or not lease["objectId"]
            or not isinstance(lease.get("inputManifestHash"), str)
            or _SHA.fullmatch(lease["inputManifestHash"]) is None
            or not isinstance(attempt.get("attemptId"), str) or not attempt["attemptId"]
            or type(attempt.get("fencingToken")) is not int
            or attempt["fencingToken"] < 1
            or lease.get("attemptId") != attempt["attemptId"]
            or lease.get("fencingToken") != attempt["fencingToken"]):
        raise ValueError("ZU-127 v3 fenced RULE_EVALUATION lease invalid")
    release = lease.get("release")
    slot = release.get("providerSlot") if isinstance(release, dict) else None
    if (not isinstance(release, dict) or release.get("lifecycle") != "DRAFT"
            or release.get("externalNetworkAllowed") is not False
            or not isinstance(release.get("manifestHash"), str)
            or _SHA.fullmatch(release["manifestHash"]) is None
            or not isinstance(slot, dict)
            or slot.get("stageJobType") != "RULE_EVALUATION"
            or slot.get("providerKind") != "RULE_ENGINE"
            or slot.get("status") != "CONFIGURED"
            or slot.get("profileId") != PROFILE_ID
            or slot.get("configHash") != PROFILE_CONFIG_HASH):
        raise ValueError("ZU-127 v3 immutable release profile invalid")
    inputs = lease.get("inputs")
    sources = inputs.get("sourceFiles") if isinstance(inputs, dict) else None
    decisions = inputs.get("sourceDecisions") if isinstance(inputs, dict) else None
    if not isinstance(sources, list) or not 1 <= len(sources) <= 64 or not isinstance(decisions, dict):
        raise ValueError("ZU-127 v3 immutable source snapshot invalid")
    seen: set[str] = set()
    for raw in sources:
        source_id, _, _, media_type, path = _source_metadata(raw)
        if source_id in seen or media_type != "application/pdf":
            raise ValueError("ZU-127 v3 source identity or media type invalid")
        seen.add(source_id)
        if path != f"/api/internal/v1/jobs/{lease['jobId']}/inputs/{source_id}":
            raise ValueError("ZU-127 v3 source download path invalid")
        decision = decisions.get(source_id)
        if decision is not None and (not isinstance(decision, dict)
                                     or raw.get("sectionCode") != decision.get("sectionCode")):
            raise ValueError("ZU-127 v3 source review snapshot mismatch")
    if set(decisions) - seen:
        raise ValueError("ZU-127 v3 source decision references unknown source")
    return sources, decisions


def evaluate_fenced_zu127_generic_stage_v3(
    lease: dict[str, Any], attempt: dict[str, Any], *,
    download_text: _TextDownload = download_text_artifact,
    download_source: _SourceDownload = _download_source,
    extract_pages: _PageExtract = extract_poppler_page_evidence,
) -> dict[str, Any]:
    """Read committed text, select pages, then inspect only eligible PDF pages.

    Caller owns lease heartbeat, completion and persistence. No queue or stage
    registry imports this opt-in function. Missing review returns ABSTAIN and
    never downloads a PDF. Test injection cannot bypass PDF hash validation.
    """
    sources, decisions = _validate_lease(lease, attempt)
    selection_sources: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    for raw in sources:
        artifact = download_text(lease, raw, attempt)
        if not isinstance(artifact, dict):
            raise ValueError("ZU-127 v3 committed text artifact invalid")
        if raw.get("pageCount") is not None and raw["pageCount"] != artifact.get("pageCount"):
            raise ValueError("ZU-127 v3 source/text page count mismatch")
        source = {"objectId": lease["objectId"], **raw,
                  "pageCount": artifact.get("pageCount")}
        selection_sources.append(source)
        receipts.append({"sourceFileId": raw["sourceFileId"],
                         "contentSha256": _hash(artifact), "artifact": artifact})
    selection = select_zu127_review_pages(
        lease["objectId"], lease["inputManifestHash"],
        selection_sources, decisions, receipts,
    )
    by_id = {source["sourceFileId"]: source for source in sources}
    page_receipts: list[dict[str, Any]] = []
    for row in selection["sourceRows"]:
        if not row["selectedPageNumbers"]:
            continue
        source = by_id[row["sourceFileId"]]
        scope = selected_poppler_page_scope(selection, row["sourceFileId"])
        with tempfile.TemporaryDirectory(prefix="inspector-zu127-v3-") as directory:
            path = Path(directory) / "source.pdf"
            download_source(source["downloadPath"], path, source["sha256"],
                            source["byteSize"], attempt)
            with path.open("rb") as stream:
                pdf_bytes = stream.read(source["byteSize"] + 1)
            if (len(pdf_bytes) != source["byteSize"] or not pdf_bytes.startswith(b"%PDF-")
                    or hashlib.sha256(pdf_bytes).hexdigest() != source["sha256"]):
                raise ValueError("ZU-127 v3 downloaded PDF SHA or size mismatch")
            page_evidence = extract_pages(path, **scope)
        if (not isinstance(page_evidence, dict)
                or page_evidence.get("schemaVersion") != "poppler-page-evidence-v1"
                or page_evidence.get("purpose") != "REVIEW_ONLY"
                or page_evidence.get("sourceSha256") != source["sha256"]
                or page_evidence.get("sourceByteSize") != source["byteSize"]
                or page_evidence.get("pdfPageCount") != scope["expected_page_count"]
                or page_evidence.get("selectedPageNumbers") != scope["page_numbers"]
                or page_evidence.get("typedFacts") is not None
                or page_evidence.get("findings") is not None
                or page_evidence.get("parameterCoverage") is not None
                or page_evidence.get("contentHash") != _hash({
                    key: value for key, value in page_evidence.items() if key != "contentHash"})):
            raise ValueError("ZU-127 v3 Poppler page evidence invalid")
        pages = page_evidence.get("pageEvidence")
        if (not isinstance(pages, list) or len(pages) != len(scope["page_numbers"])
                or [page.get("pageNumber") if isinstance(page, dict) else None
                    for page in pages] != scope["page_numbers"]
                or any(page.get("sourceSha256") != source["sha256"]
                       or page.get("pdfPageCount") != scope["expected_page_count"]
                       or page.get("inspectionSha256") != _hash({
                           key: value for key, value in page.items()
                           if key != "inspectionSha256"})
                       for page in pages)):
            raise ValueError("ZU-127 v3 Poppler page receipt invalid")
        page_receipts.append({"sourceFileId": row["sourceFileId"],
                              "textArtifactSha256": row["textArtifactSha256"],
                              "pageEvidence": page_evidence})
    result = {"schemaVersion": SCHEMA_VERSION, "purpose": "REVIEW_ONLY",
              "status": "ABSTAIN", "parameterCode": "ZU-127",
              "jobId": lease["jobId"], "runId": lease["runId"],
              "objectId": lease["objectId"], "inputManifestHash": lease["inputManifestHash"],
              "releaseId": lease["releaseId"],
              "releaseManifestHash": lease["release"]["manifestHash"],
              "providerProfileId": PROFILE_ID, "providerConfigHash": PROFILE_CONFIG_HASH,
              "sourceDecisionSnapshotSha256": _hash(decisions),
              "selection": selection, "pageReceipts": page_receipts,
              "selectedPageCount": selection["selectedPageCount"],
              "absenceConclusion": "NOT_AVAILABLE", "typedFacts": None,
              "findings": None, "findingCount": None,
              "parameterCoverage": None}
    output = {**result, "contentHash": _hash(result)}
    if len(_canonical(output)) > MAX_STAGE_BYTES:
        raise ValueError("ZU-127 v3 stage result exceeds byte bound")
    return output
