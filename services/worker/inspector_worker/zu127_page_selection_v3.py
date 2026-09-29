"""Source-independent, text-only ZU-127 page navigation.

This pure stage consumes caller-supplied immutable source review and a committed
document-text-v2 receipt. It never reads a PDF or asserts that a window row,
thermal value, PD/RD pair, absence, or finding has been established.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any

from .parameter_routing import _validate_artifact


SCHEMA_VERSION = "zu127-page-selection-v3"
MAX_SELECTED_PAGES = 4
MAX_SOURCES = 64
MAX_PAGES_PER_SOURCE = 2_000
MAX_TOTAL_PAGES = 10_000
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_PAGE_KEY = re.compile(r"[1-9][0-9]*\Z")
_RESISTANCE = re.compile(r"\bсопротивлен\w*\b", re.UNICODE)
_HEAT_TRANSFER = re.compile(r"\bтеплопередач\w*\b", re.UNICODE)
_WINDOW = re.compile(r"\b(?:окн\w*|окон\w*|витраж\w*)\b", re.UNICODE)


def _canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("ZU-127 input is not canonical JSON") from error


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _source(raw: Any, object_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("ZU-127 source metadata must be an object")
    source_id, sha = raw.get("sourceFileId"), raw.get("sha256")
    count, stages = raw.get("pageCount"), raw.get("stages")
    byte_size = raw.get("byteSize")
    if (not isinstance(source_id, str) or not source_id.strip()
            or not isinstance(sha, str) or _SHA.fullmatch(sha) is None
            or type(count) is not int or not 1 <= count <= MAX_PAGES_PER_SOURCE
            or type(byte_size) is not int or not 5 <= byte_size <= MAX_SOURCE_BYTES
            or raw.get("mediaType") != "application/pdf"
            or not isinstance(stages, list) or not stages
            or any(not isinstance(stage, str) or stage not in {"PD", "RD", "ID"}
                   for stage in stages)
            or len(stages) != len(set(stages))
            or raw.get("sectionCode") is not None
            and (not isinstance(raw["sectionCode"], str) or not raw["sectionCode"].strip())
            or raw.get("objectId", object_id) != object_id):
        raise ValueError("ZU-127 source metadata invalid")
    return raw


def _review_reason(source: dict[str, Any], decision: Any) -> str | None:
    if decision is None:
        return "SOURCE_REVIEW_REQUIRED"
    if not isinstance(decision, dict) or decision.get("sourceSha256") != source["sha256"]:
        raise ValueError("ZU-127 decision source SHA mismatch")
    pages = decision.get("pageStages")
    if not isinstance(pages, dict):
        return "PAGE_STAGE_REVIEW_REQUIRED"
    for key, stage in pages.items():
        if (not isinstance(key, str) or _PAGE_KEY.fullmatch(key) is None
                or int(key) > source["pageCount"]
                or stage not in {"PD", "RD", "ID", "UNRESOLVED"}
                or stage != "UNRESOLVED" and stage not in source["stages"]):
            raise ValueError("ZU-127 decision pageStages invalid")
    if (decision.get("revisionStatus") != "CURRENT"
            or decision.get("approvalStatus") != "APPROVED"):
        return "SOURCE_REVIEW_NOT_CURRENT_APPROVED"
    if decision.get("sectionCode") != "ZU":
        return "SOURCE_SECTION_REVIEW_REQUIRED"
    basis = decision.get("basis")
    if (not isinstance(basis, dict) or not isinstance(basis.get("reference"), str)
            or len(basis["reference"].strip()) < 8):
        return "SOURCE_REVIEW_REQUIRED"
    if "PD" not in source["stages"]:
        return "PD_SOURCE_REQUIRED"
    if (len(source["stages"]) > 1
            and len(pages) != source["pageCount"]):
        return "PAGE_STAGE_REVIEW_REQUIRED"
    if any(stage == "UNRESOLVED" for stage in pages.values()):
        return "PAGE_STAGE_REVIEW_REQUIRED"
    return None


def _lexical_cues(page: dict[str, Any]) -> tuple[bool, bool]:
    text = unicodedata.normalize("NFKC", " ".join(block["text"] for block in page["blocks"]))
    text = " ".join(text.casefold().split())
    return bool(_RESISTANCE.search(text) and _HEAT_TRANSFER.search(text)), bool(_WINDOW.search(text))


def select_zu127_review_pages(
    object_id: str, input_manifest_hash: str,
    sources: list[dict[str, Any]], source_decisions: dict[str, Any],
    text_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Select at most four text-layer pages for review, never infer a result.

    ``text_artifacts`` entries carry ``artifact`` and its canonical
    ``contentSha256``. Caller must supply the *committed* artifact and immutable
    review snapshot; this pure function can verify their bytes and bindings,
    but cannot authenticate the caller or establish database commitment.
    """
    if (not isinstance(object_id, str) or not object_id.strip()
            or not isinstance(input_manifest_hash, str)
            or _SHA.fullmatch(input_manifest_hash) is None
            or not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES
            or not isinstance(source_decisions, dict)
            or not isinstance(text_artifacts, list)):
        raise ValueError("ZU-127 selection inputs invalid")
    source_index: dict[str, dict[str, Any]] = {}
    hashes: set[str] = set()
    total_pages = 0
    for raw in sources:
        source = _source(raw, object_id)
        source_id = source["sourceFileId"]
        if source_id in source_index or source["sha256"] in hashes:
            raise ValueError("ZU-127 duplicate source identity")
        source_index[source_id] = source
        hashes.add(source["sha256"])
        total_pages += source["pageCount"]
        if total_pages > MAX_TOTAL_PAGES:
            raise ValueError("ZU-127 source page count exceeds bounded scope")
    if set(source_decisions) - set(source_index):
        raise ValueError("ZU-127 decision references unknown source")
    artifacts: dict[str, dict[str, Any]] = {}
    artifact_hashes: dict[str, str] = {}
    for receipt in text_artifacts:
        if not isinstance(receipt, dict):
            raise ValueError("ZU-127 artifact receipt invalid")
        source_id = receipt.get("sourceFileId")
        if source_id not in source_index or source_id in artifacts:
            raise ValueError("ZU-127 artifact source missing or duplicate")
        artifact = receipt.get("artifact")
        expected = receipt.get("contentSha256")
        if not isinstance(artifact, dict) or not isinstance(expected, str) or _SHA.fullmatch(expected) is None:
            raise ValueError("ZU-127 artifact receipt invalid")
        canonical = _canonical_bytes(artifact)
        if len(canonical) > MAX_ARTIFACT_BYTES or hashlib.sha256(canonical).hexdigest() != expected:
            raise ValueError("ZU-127 committed text artifact hash or size mismatch")
        source = source_index[source_id]
        if artifact.get("pageCount") != source["pageCount"]:
            raise ValueError("ZU-127 source/artifact pageCount mismatch")
        _validate_artifact(artifact, source)
        artifacts[source_id], artifact_hashes[source_id] = artifact, expected
    if set(artifacts) != set(source_index):
        raise ValueError("ZU-127 committed text artifact missing")

    rows: list[dict[str, Any]] = []
    remaining = MAX_SELECTED_PAGES
    for source_id in sorted(source_index):
        source = source_index[source_id]
        base = {"sourceFileId": source_id, "sourceSha256": source["sha256"],
                "sourceByteSize": source["byteSize"],
                "textArtifactSha256": artifact_hashes[source_id],
                "sourcePageCount": source["pageCount"]}
        decision = source_decisions.get(source_id)
        reason = _review_reason(source, decision)
        if reason is not None:
            rows.append({**base, "reasonCodes": [reason], "reviewEligible": False,
                         "textSearchedPageCount": None, "thermalCuePageCount": None,
                         "windowCuePageCount": None, "candidatePageCount": None,
                         "candidatePageNumbers": None, "selectedPageNumbers": [],
                         "ocrRequiredDeferredPageNumbers": None,
                         "truncatedCandidatePageCount": None})
            continue
        artifact = artifacts[source_id]
        pages = decision["pageStages"]
        text_searched = thermal_count = window_count = 0
        candidates: list[int] = []
        ocr_deferred: list[int] = []
        for page in artifact["pages"]:
            number = page["pageNumber"]
            stage = pages.get(str(number), source["stages"][0]
                             if len(source["stages"]) == 1 else None)
            if stage != "PD":
                continue
            if page["quality"]["disposition"] == "OCR_REQUIRED":
                ocr_deferred.append(number)
                continue
            text_searched += 1
            thermal, window = _lexical_cues(page)
            thermal_count += thermal
            window_count += window
            if thermal and window:
                candidates.append(number)
        selected = candidates[:remaining]
        remaining -= len(selected)
        truncated = len(candidates) - len(selected)
        reasons = ["LEXICAL_NAVIGATION_ONLY"]
        if ocr_deferred:
            reasons.append("OCR_REQUIRED_UNREAD")
        if truncated:
            reasons.append("PAGE_SELECTION_TRUNCATED")
        if not candidates:
            reasons.append("NO_TEXT_LAYER_CANDIDATE")
        rows.append({**base, "reasonCodes": reasons, "reviewEligible": True,
                     "textSearchedPageCount": text_searched,
                     "thermalCuePageCount": thermal_count,
                     "windowCuePageCount": window_count,
                     "candidatePageCount": len(candidates),
                     "candidatePageNumbers": candidates,
                     "selectedPageNumbers": selected,
                     "ocrRequiredDeferredPageNumbers": ocr_deferred,
                     "truncatedCandidatePageCount": truncated})
    result = {"schemaVersion": SCHEMA_VERSION, "parameterCode": "ZU-127",
              "purpose": "REVIEW_ONLY", "status": "ABSTAIN",
              "objectId": object_id, "inputManifestHash": input_manifest_hash,
              "maxSelectedPages": MAX_SELECTED_PAGES, "sourceRows": rows,
              "reviewEligibleSourceCount": sum(row["reviewEligible"] for row in rows),
              "reviewBlockedSourceCount": sum(not row["reviewEligible"] for row in rows),
              "scannedCandidatePageCount": sum(row["candidatePageCount"] or 0 for row in rows),
              "selectedPageCount": sum(len(row["selectedPageNumbers"]) for row in rows),
              "deferredOcrRequiredPageCount": sum(
                  len(row["ocrRequiredDeferredPageNumbers"] or []) for row in rows),
              "truncatedCandidatePageCount": sum(
                  row["truncatedCandidatePageCount"] or 0 for row in rows),
              "findings": None, "findingCount": None,
              "parameterCoverage": None, "typedFacts": None,
              "absenceConclusion": "NOT_AVAILABLE"}
    return {**result, "contentHash": _sha(result)}


def selected_poppler_page_scope(selection: dict[str, Any], source_id: str) -> dict[str, Any]:
    """Turn an unmodified review selection into bounded page-evidence arguments.

    This handoff does not authenticate review decisions or read a PDF. The
    caller must recheck immutable decisions and download the SHA-bound source
    before giving this scope to ``extract_poppler_page_evidence``.
    """
    if (not isinstance(selection, dict) or selection.get("schemaVersion") != SCHEMA_VERSION
            or selection.get("purpose") != "REVIEW_ONLY"
            or selection.get("status") != "ABSTAIN"
            or selection.get("contentHash") != _sha({key: value for key, value in
                                                    selection.items() if key != "contentHash"})
            or not isinstance(source_id, str)):
        raise ValueError("ZU-127 page selection handoff invalid")
    rows = selection.get("sourceRows")
    if not isinstance(rows, list):
        raise ValueError("ZU-127 page selection rows invalid")
    matches = [row for row in rows if isinstance(row, dict)
               and row.get("sourceFileId") == source_id]
    if len(matches) != 1 or matches[0].get("reviewEligible") is not True:
        raise ValueError("ZU-127 page selection source not eligible")
    row = matches[0]
    pages = row.get("selectedPageNumbers")
    if (not isinstance(pages, list) or not 1 <= len(pages) <= MAX_SELECTED_PAGES
            or any(type(number) is not int or not 1 <= number <= row.get("sourcePageCount", 0)
                   for number in pages)
            or pages != sorted(set(pages))):
        raise ValueError("ZU-127 selected page scope invalid")
    return {"expected_sha256": row["sourceSha256"],
            "expected_byte_size": row["sourceByteSize"],
            "expected_page_count": row["sourcePageCount"],
            "page_numbers": pages.copy()}
