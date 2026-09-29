"""Bounded, local OCR of committed OCR_REQUIRED pages; no rule or finding output."""

from __future__ import annotations

import json
import os
import re
import tempfile
import unicodedata
from bisect import bisect_left
from pathlib import Path
from typing import Any

from .durable_text import download_text_artifact
from .durable_ocr_cache import cached_durable_ocr_page
from .ocr_pilot import canonical_hash, json_stable_ocr_artifact, recognize_pdf_page, validate_local_url
from .text_layer import _download_source, _source_metadata


PROFILE = {
    "schemaVersion": "bounded-ocr-layout-profile-v1",
    "methodId": "first-ocr-required-pages-v1",
    "maxPagesPerRun": 2,
    "maxSourceBytes": 64 * 1024 * 1024,
    "dpi": 120,
    "script": "eslav",
}
PROFILE_ID = "local-bounded-ocr-layout-v1"
PROFILE_HASH = canonical_hash(PROFILE)
PROFILE_V2 = {
    "schemaVersion": "bounded-ocr-layout-profile-v2",
    "methodId": "source-balanced-drawing-context-v2",
    "maxPagesPerRun": 2,
    "maxSourceBytes": 64 * 1024 * 1024,
    "dpi": 120,
    "script": "eslav",
    "drawingLongEdgeMilliPoints": 1_000_000,
    "maxRenderPixels": 25_000_000,
    "maxRenderSidePx": 20_000,
    "geometryTolerancePx": 2,
    "allowSwappedGeometry": True,
    "rendererProfileId": "renderer-pdfium-5.12.1-linux-x86_64-v1",
    "ocrProviderProfileIds": [
        "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
        "ocr-paddle-3.7.0-ru-en-mobile-v1",
        "ocr-paddle-3.7.0-ru-en-server-v1",
    ],
    "anchorTerms": ["общая площадь здания", "тепловая нагрузка", "отоплен", "вентиляц", "таблиц"],
}
PROFILE_ID_V2 = "local-bounded-ocr-layout-v2"
PROFILE_HASH_V2 = canonical_hash(PROFILE_V2)
PROFILE_V3 = {
    "schemaVersion": "bounded-ocr-layout-profile-v3",
    "methodId": "rd-ov-heating-revision-window-v3",
    "maxPagesPerRun": 2,
    "maxSourceBytes": 64 * 1024 * 1024,
    "dpi": 120,
    "script": "eslav",
    "maxRenderPixels": 25_000_000,
    "maxRenderSidePx": 20_000,
    "geometryTolerancePx": 2,
    "allowSwappedGeometry": True,
    "rendererProfileId": "renderer-pdfium-5.12.1-linux-x86_64-v1",
    "ocrProviderProfileIds": [
        "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
        "ocr-paddle-3.7.0-ru-en-mobile-v1",
        "ocr-paddle-3.7.0-ru-en-server-v1",
    ],
    "revisionMarkerTerms": ["разрешение", "обозначение", "-рд-ов"],
    "heatingSummaryTerms": [
        "основные показатели по рабочим чертежам марки ов", "на отопление", "тепловой поток",
    ],
    "maxContextGapPages": 8,
}
PROFILE_ID_V3 = "local-bounded-ocr-layout-v3"
PROFILE_HASH_V3 = canonical_hash(PROFILE_V3)
PROFILE_V4 = {
    **PROFILE_V3,
    "schemaVersion": "bounded-ocr-layout-profile-v4",
    "methodId": "subject-window-or-cid-title-recovery-v4",
    "titleRecoveryMaxPage": 2,
    "titleRecoveryReasonCode": "TEXT_DECODING_ANOMALY",
}
PROFILE_ID_V4 = "local-bounded-ocr-layout-v4"
PROFILE_HASH_V4 = canonical_hash(PROFILE_V4)
PROFILE_V5 = {
    **PROFILE_V4,
    "schemaVersion": "bounded-ocr-layout-profile-v5",
    "methodId": "subject-window-or-cid-title-recovery-v5",
    "maxPagesPerRun": 4,
}
PROFILE_ID_V5 = "local-bounded-ocr-layout-v5"
PROFILE_HASH_V5 = canonical_hash(PROFILE_V5)
PROFILE_V6 = {
    **PROFILE_V5,
    "schemaVersion": "bounded-ocr-layout-profile-v6",
    "methodId": "reviewed-ar-vk-ocr-required-v6",
    "sectionCodesAllowed": ["AR", "VK"],
    "requiredRevisionStatus": "CURRENT",
    "requiredApprovalStatus": "APPROVED",
}
PROFILE_ID_V6 = "local-bounded-ocr-layout-v6"
PROFILE_HASH_V6 = canonical_hash(PROFILE_V6)
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")


def _v2_candidates(text: dict[str, Any]) -> tuple[list[int], int]:
    anchors = []
    for page in text["pages"]:
        width = page.get("widthMilliPoints")
        height = page.get("heightMilliPoints")
        blocks = page.get("blocks")
        if (type(width) is not int or width <= 0 or type(height) is not int or height <= 0
                or not isinstance(blocks, list)):
            raise ValueError("bounded OCR v2 requires committed page geometry and blocks")
        if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        if any(not isinstance(block, dict) or not isinstance(block.get("text"), str)
               for block in blocks):
            raise ValueError("bounded OCR v2 text blocks invalid")
        content = " ".join(unicodedata.normalize("NFKC", block["text"]).lower()
                           for block in blocks)
        content = " ".join(content.split())
        if any(term in content for term in PROFILE_V2["anchorTerms"]):
            anchors.append(page["pageNumber"])
    candidates = []
    raster_skipped = 0
    for page in text["pages"]:
        if page["quality"]["disposition"] != "OCR_REQUIRED":
            continue
        width = page["widthMilliPoints"]
        height = page["heightMilliPoints"]
        width_px = (width * PROFILE_V2["dpi"] + 71_999) // 72_000
        height_px = (height * PROFILE_V2["dpi"] + 71_999) // 72_000
        if (width_px * height_px > PROFILE_V2["maxRenderPixels"]
                or width_px > PROFILE_V2["maxRenderSidePx"]
                or height_px > PROFILE_V2["maxRenderSidePx"]):
            raster_skipped += 1
            continue
        number = page["pageNumber"]
        anchor_index = bisect_left(anchors, number)
        distance = min(
            abs(number - anchors[anchor_index]) if anchor_index < len(anchors) else 2**53 - 1,
            abs(number - anchors[anchor_index - 1]) if anchor_index > 0 else 2**53 - 1,
        )
        drawing = max(width, height) >= PROFILE_V2["drawingLongEdgeMilliPoints"]
        candidates.append((not drawing, distance, number))
    candidates.sort()
    return [number for _drawing, _distance, number in candidates], raster_skipped


def select_v2_pages(sources: list[tuple[str, int, str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Source tuples are (ID, byte size, media type, committed text artifact)."""
    ranked: dict[str, list[int]] = {}
    selection: dict[str, dict[str, Any]] = {}
    for source_id, byte_size, media_type, text in sorted(sources):
        if source_id in ranked:
            raise ValueError("bounded OCR v2 duplicate source")
        if media_type != "application/pdf" or byte_size > PROFILE_V2["maxSourceBytes"]:
            pages, raster_skipped = [], 0
        else:
            pages, raster_skipped = _v2_candidates(text)
        ranked[source_id] = pages
        selection[source_id] = {"selected": [], "rasterSkipped": raster_skipped}
    processed = 0
    for round_index in range(PROFILE_V2["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                selection[source_id]["selected"].append(ranked[source_id][round_index])
                processed += 1
                if processed == PROFILE_V2["maxPagesPerRun"]:
                    return selection
    return selection


def _v3_candidates(text: dict[str, Any]) -> tuple[list[int], int, int]:
    markers = []
    summaries = []
    for page in text["pages"]:
        width = page.get("widthMilliPoints")
        height = page.get("heightMilliPoints")
        blocks = page.get("blocks")
        if (type(width) is not int or width <= 0 or type(height) is not int or height <= 0
                or not isinstance(blocks, list)):
            raise ValueError("bounded OCR v3 requires committed page geometry and blocks")
        if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        if any(not isinstance(block, dict) or not isinstance(block.get("text"), str)
               for block in blocks):
            raise ValueError("bounded OCR v3 text blocks invalid")
        content = " ".join(unicodedata.normalize("NFKC", block["text"]).lower()
                           for block in blocks)
        content = " ".join(content.split())
        if all(term in content for term in PROFILE_V3["revisionMarkerTerms"]):
            markers.append(page["pageNumber"])
        if all(term in content for term in PROFILE_V3["heatingSummaryTerms"]):
            summaries.append(page["pageNumber"])
    qualified = set()
    for marker in markers:
        summary = next((number for number in summaries
                        if marker < number <= marker + PROFILE_V3["maxContextGapPages"]), None)
        if summary is None:
            continue
        for number in range(marker + 1, summary):
            if text["pages"][number - 1]["quality"]["disposition"] == "OCR_REQUIRED":
                qualified.add(number)
    ranked = []
    raster_skipped = 0
    for number in sorted(qualified):
        page = text["pages"][number - 1]
        width_px = (page["widthMilliPoints"] * PROFILE_V3["dpi"] + 71_999) // 72_000
        height_px = (page["heightMilliPoints"] * PROFILE_V3["dpi"] + 71_999) // 72_000
        if (width_px * height_px > PROFILE_V3["maxRenderPixels"]
                or width_px > PROFILE_V3["maxRenderSidePx"]
                or height_px > PROFILE_V3["maxRenderSidePx"]):
            raster_skipped += 1
        else:
            ranked.append(number)
    return ranked, raster_skipped, len(qualified)


def select_v3_pages(sources: list[tuple[str, int, str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Abstain unless committed text anchors enclose OCR_REQUIRED pages."""
    ranked: dict[str, list[int]] = {}
    selection: dict[str, dict[str, Any]] = {}
    for source_id, byte_size, media_type, text in sorted(sources):
        if source_id in ranked:
            raise ValueError("bounded OCR v3 duplicate source")
        if media_type != "application/pdf":
            pages, raster_skipped, candidate_count = [], 0, 0
        else:
            pages, raster_skipped, candidate_count = _v3_candidates(text)
            if byte_size > PROFILE_V3["maxSourceBytes"]:
                pages, raster_skipped = [], 0
        ranked[source_id] = pages
        selection[source_id] = {"selected": [], "rasterSkipped": raster_skipped,
                                "subjectCandidateCount": candidate_count}
    processed = 0
    for round_index in range(PROFILE_V3["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                selection[source_id]["selected"].append(ranked[source_id][round_index])
                processed += 1
                if processed == PROFILE_V3["maxPagesPerRun"]:
                    return selection
    return selection


def _v4_candidates(text: dict[str, Any]) -> tuple[list[int], int, int, int]:
    subject, raster_skipped, subject_count = _v3_candidates(text)
    if subject_count:
        return subject, raster_skipped, subject_count, 0
    title = []
    title_count = 0
    for page in text["pages"][:PROFILE_V4["titleRecoveryMaxPage"]]:
        quality = page["quality"]
        if (quality["disposition"] != "OCR_REQUIRED"
                or PROFILE_V4["titleRecoveryReasonCode"] not in quality["reasonCodes"]):
            continue
        title_count += 1
        width_px = (page["widthMilliPoints"] * PROFILE_V4["dpi"] + 71_999) // 72_000
        height_px = (page["heightMilliPoints"] * PROFILE_V4["dpi"] + 71_999) // 72_000
        if (width_px * height_px > PROFILE_V4["maxRenderPixels"]
                or width_px > PROFILE_V4["maxRenderSidePx"]
                or height_px > PROFILE_V4["maxRenderSidePx"]):
            raster_skipped += 1
        else:
            title.append(page["pageNumber"])
    return title, raster_skipped, 0, title_count


def _select_v4_like_pages(
    sources: list[tuple[str, int, str, dict[str, Any]]], max_pages: int,
) -> dict[str, dict[str, Any]]:
    """Preserve v4 ranking while applying the selected immutable page budget."""
    ranked: dict[str, list[int]] = {}
    selection: dict[str, dict[str, Any]] = {}
    for source_id, byte_size, media_type, text in sorted(sources):
        if source_id in ranked:
            raise ValueError("bounded OCR v4 duplicate source")
        if media_type != "application/pdf":
            pages, raster_skipped, subject_count, title_count = [], 0, 0, 0
        else:
            pages, raster_skipped, subject_count, title_count = _v4_candidates(text)
            if byte_size > PROFILE_V4["maxSourceBytes"]:
                pages, raster_skipped = [], 0
        ranked[source_id] = pages
        selection[source_id] = {
            "selected": [], "rasterSkipped": raster_skipped,
            "subjectCandidateCount": subject_count,
            "titleRecoveryCandidateCount": title_count,
        }
    processed = 0
    for round_index in range(max_pages):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                selection[source_id]["selected"].append(ranked[source_id][round_index])
                processed += 1
                if processed == max_pages:
                    return selection
    return selection


def select_v4_pages(sources: list[tuple[str, int, str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Preserve v3 subject selection; recover only undecodable opening titles otherwise."""
    return _select_v4_like_pages(sources, PROFILE_V4["maxPagesPerRun"])


def select_v5_pages(sources: list[tuple[str, int, str, dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    """Use v4 candidates and round-robin selection, bounded to four pages."""
    return _select_v4_like_pages(sources, PROFILE_V5["maxPagesPerRun"])


def select_v6_pages(sources: list[tuple[str, str, int, str, list[str], str | None, dict[str, Any]]],
                    decisions: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Select only reviewed AR/VK OCR_REQUIRED pages from committed text artifacts.

    Source tuples are (ID, SHA, byte size, media type, manifest stages, section, text).
    Missing decisions defer OCR; malformed or forged decisions fail closed.
    """
    if not isinstance(decisions, dict):
        raise ValueError("bounded OCR v6 sourceDecisions must be an object")
    source_ids = [source[0] for source in sources]
    if len(set(source_ids)) != len(source_ids):
        raise ValueError("bounded OCR v6 duplicate source")
    if set(decisions) - set(source_ids):
        raise ValueError("bounded OCR v6 sourceDecisions contain an unknown source")
    ranked: dict[str, list[int]] = {}
    selection: dict[str, dict[str, Any]] = {}
    for source_id, source_sha, byte_size, media_type, stages, section_code, artifact in sorted(sources):
        if (not isinstance(source_id, str) or not source_id
                or not isinstance(source_sha, str) or not _SHA256.fullmatch(source_sha)
                or type(byte_size) is not int or byte_size < 0
                or not isinstance(stages, list) or not stages
                or any(not isinstance(stage, str) or stage not in {"PD", "RD", "ID"}
                       for stage in stages)
                or len(stages) != len(set(stages))
                or section_code is not None and not isinstance(section_code, str)):
            raise ValueError("bounded OCR v6 source metadata is invalid")
        decision = decisions.get(source_id)
        entry = {"selected": [], "rasterSkipped": 0, "reviewEligiblePageCount": 0,
                 "stageUnresolvedPageCount": 0, "selectionReasonCodes": []}
        selection[source_id] = entry
        ranked[source_id] = []
        if decision is not None:
            if (not isinstance(decision, dict) or decision.get("sourceSha256") != source_sha
                    or not isinstance(decision.get("pageStages"), dict)
                    or not isinstance(decision.get("basis"), dict)
                    or not isinstance(decision["basis"].get("reference"), str)
                    or not decision["basis"]["reference"].strip()
                    or section_code != decision.get("sectionCode")
                    or decision.get("revisionStatus") not in {"CURRENT", "SUPERSEDED", "UNKNOWN"}
                    or decision.get("approvalStatus") not in {"APPROVED", "UNAPPROVED", "UNKNOWN"}
                    or any(not isinstance(page, str) or re.fullmatch(r"[1-9][0-9]*", page) is None
                           or stage not in {"PD", "RD", "ID", "UNRESOLVED"}
                           or stage != "UNRESOLVED" and stage not in stages
                           for page, stage in decision["pageStages"].items())):
                raise ValueError("bounded OCR v6 source decision is invalid or does not match manifest")
        elif section_code is not None:
            raise ValueError("bounded OCR v6 source section requires a matching decision")
        if media_type != "application/pdf":
            continue
        pages = artifact.get("pages") if isinstance(artifact, dict) else None
        if (not isinstance(artifact, dict)
                or artifact.get("schemaVersion") != "document-text-v2"
                or artifact.get("sourceFileId") != source_id
                or artifact.get("inputSha256") != source_sha
                or not isinstance(pages, list)
                or artifact.get("pageCount") != len(pages)):
            raise ValueError("bounded OCR v6 requires committed matching document-text-v2")
        if decision is not None and any(int(page) > len(pages) for page in decision["pageStages"]):
            raise ValueError("bounded OCR v6 pageStages exceed committed page count")
        required = []
        for index, page in enumerate(pages, start=1):
            if (not isinstance(page, dict) or page.get("pageNumber") != index
                    or not isinstance(page.get("quality"), dict)):
                raise ValueError("bounded OCR v6 committed page metadata is invalid")
            if page["quality"].get("disposition") == "OCR_REQUIRED":
                required.append(page)
        if not required:
            continue
        if decision is None:
            entry["selectionReasonCodes"].append("SOURCE_REVIEW_REQUIRED")
            continue
        if (decision["revisionStatus"] != PROFILE_V6["requiredRevisionStatus"]
                or decision["approvalStatus"] != PROFILE_V6["requiredApprovalStatus"]):
            entry["selectionReasonCodes"].append("SOURCE_REVIEW_NOT_CURRENT_APPROVED")
            continue
        if decision.get("sectionCode") not in PROFILE_V6["sectionCodesAllowed"]:
            entry["selectionReasonCodes"].append("SECTION_NOT_AR_VK")
            continue
        for page in required:
            number = page["pageNumber"]
            stage = decision["pageStages"].get(str(number))
            if stage is None and len(stages) == 1:
                stage = stages[0]
            if stage not in {"PD", "RD"}:
                entry["stageUnresolvedPageCount"] += 1
                continue
            if stage not in stages:
                raise ValueError("bounded OCR v6 page stage is absent from source manifest")
            entry["reviewEligiblePageCount"] += 1
            width = page.get("widthMilliPoints")
            height = page.get("heightMilliPoints")
            if (type(width) is not int or width <= 0 or type(height) is not int or height <= 0):
                raise ValueError("bounded OCR v6 requires committed page geometry")
            width_px = (width * PROFILE_V6["dpi"] + 71_999) // 72_000
            height_px = (height * PROFILE_V6["dpi"] + 71_999) // 72_000
            if (width_px * height_px > PROFILE_V6["maxRenderPixels"]
                    or width_px > PROFILE_V6["maxRenderSidePx"]
                    or height_px > PROFILE_V6["maxRenderSidePx"]):
                entry["rasterSkipped"] += 1
            elif byte_size <= PROFILE_V6["maxSourceBytes"]:
                ranked[source_id].append(number)
        if entry["stageUnresolvedPageCount"]:
            entry["selectionReasonCodes"].append("PAGE_STAGE_UNRESOLVED")
        if entry["reviewEligiblePageCount"] and byte_size > PROFILE_V6["maxSourceBytes"]:
            entry["selectionReasonCodes"].append("SOURCE_TOO_LARGE")
        if entry["rasterSkipped"]:
            entry["selectionReasonCodes"].append("RENDER_PIXEL_LIMIT")
    processed = 0
    for round_index in range(PROFILE_V6["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                selection[source_id]["selected"].append(ranked[source_id][round_index])
                processed += 1
                if processed == PROFILE_V6["maxPagesPerRun"]:
                    break
        if processed == PROFILE_V6["maxPagesPerRun"]:
            break
    for source_id, pages in ranked.items():
        if len(pages) > len(selection[source_id]["selected"]):
            selection[source_id]["selectionReasonCodes"].append("PAGE_BUDGET_EXHAUSTED")
        selection[source_id]["selectionReasonCodes"].sort()
    return selection


def _validate_bounded_artifact(artifact: dict[str, Any], source_page: dict[str, Any],
                               profile: dict[str, Any]) -> None:
    render = artifact.get("render")
    provider = artifact.get("provider")
    if not isinstance(render, dict) or not isinstance(provider, dict):
        raise ValueError("bounded OCR v2 missing renderer or provider identity")
    if (render.get("rendererProfileId") != profile["rendererProfileId"]
            or provider.get("profileId") not in profile["ocrProviderProfileIds"]):
        raise ValueError("bounded OCR renderer or provider profile changed")
    width = render.get("widthPx")
    height = render.get("heightPx")
    if (type(width) is not int or type(height) is not int or width < 1 or height < 1
            or width > profile["maxRenderSidePx"]
            or height > profile["maxRenderSidePx"]
            or width * height > profile["maxRenderPixels"]):
        raise ValueError("bounded OCR render dimensions invalid")
    expected_width = (source_page["widthMilliPoints"] * profile["dpi"] + 71_999) // 72_000
    expected_height = (source_page["heightMilliPoints"] * profile["dpi"] + 71_999) // 72_000
    tolerance = profile["geometryTolerancePx"]
    direct = abs(width - expected_width) <= tolerance and abs(height - expected_height) <= tolerance
    swapped = (profile["allowSwappedGeometry"]
               and abs(width - expected_height) <= tolerance
               and abs(height - expected_width) <= tolerance)
    if not direct and not swapped:
        raise ValueError("bounded OCR render geometry differs from committed text artifact")


class BoundedOcrLayoutAdapter:
    job_type = "DOCUMENT_OCR_LAYOUT"
    provider_kind = "OCR_LAYOUT"

    def execute(self, lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
        release = lease.get("release")
        slot = release.get("providerSlot") if isinstance(release, dict) else None
        profile_id = slot.get("profileId") if isinstance(slot, dict) else None
        v2 = profile_id == PROFILE_ID_V2
        v3 = profile_id == PROFILE_ID_V3
        v4 = profile_id == PROFILE_ID_V4
        v5 = profile_id == PROFILE_ID_V5
        v6 = profile_id == PROFILE_ID_V6
        v4_selection = v4 or v5
        v3_counters = v3 or v4_selection
        bounded = v2 or v3_counters or v6
        profile = (PROFILE_V6 if v6 else PROFILE_V5 if v5 else PROFILE_V4 if v4 else PROFILE_V3 if v3
                   else PROFILE_V2 if v2 else PROFILE)
        profile_hash = (PROFILE_HASH_V6 if v6 else PROFILE_HASH_V5 if v5 else PROFILE_HASH_V4 if v4 else PROFILE_HASH_V3 if v3
                        else PROFILE_HASH_V2 if v2 else PROFILE_HASH)
        if (not isinstance(release, dict) or release.get("lifecycle") != "DRAFT"
                or release.get("externalNetworkAllowed") is not False
                or not isinstance(slot, dict) or slot.get("stageJobType") != self.job_type
                or slot.get("providerKind") != self.provider_kind
                or slot.get("status") != "CONFIGURED"
                or profile_id not in {PROFILE_ID, PROFILE_ID_V2, PROFILE_ID_V3, PROFILE_ID_V4,
                                      PROFILE_ID_V5, PROFILE_ID_V6}
                or slot.get("adapterVersion") != ("6" if v6 else "5" if v5 else "4" if v4 else "3" if v3
                                                  else "2" if v2 else "1")
                or slot.get("configHash") != profile_hash):
            raise ValueError("bounded OCR slot does not match immutable release")
        manifest_hash = lease.get("inputManifestHash")
        object_id = lease.get("objectId")
        inputs = lease.get("inputs")
        if not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None:
            raise ValueError("bounded OCR lease has no immutable manifest hash")
        if not isinstance(object_id, str) or not object_id:
            raise ValueError("bounded OCR lease has no objectId")
        if not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list):
            raise ValueError("bounded OCR lease has no sourceFiles")

        sources = []
        seen: set[str] = set()
        for raw_source in inputs["sourceFiles"]:
            source_id, source_hash, byte_size, media_type, download_path = _source_metadata(raw_source)
            if source_id in seen:
                raise ValueError("bounded OCR lease contains duplicate sourceFileId")
            seen.add(source_id)
            sources.append((source_id, source_hash, byte_size, media_type, download_path, raw_source))
        sources.sort(key=lambda item: item[0])

        processed = 0
        required_total = 0
        oversize_pages = 0
        unsupported_sources = 0
        raster_skipped_total = 0
        subject_candidate_total = 0
        title_candidate_total = 0
        review_eligible_total = 0
        stage_unresolved_total = 0
        outputs = []
        local_url: str | None = None
        texts = {source_id: download_text_artifact(lease, raw_source, attempt)
                 for source_id, _source_hash, _byte_size, media_type, _download_path, raw_source in sources
                 if media_type == "application/pdf"} if bounded else {}
        selection_inputs = [
            (source_id, byte_size, media_type, texts.get(source_id, {}))
            for source_id, _source_hash, byte_size, media_type, _download_path, _raw_source in sources
        ]
        v6_inputs = [
            (source_id, source_hash, byte_size, media_type, raw_source.get("stages"),
             raw_source.get("sectionCode"), texts.get(source_id, {}))
            for source_id, source_hash, byte_size, media_type, _download_path, raw_source in sources
        ] if v6 else []
        selection = (select_v6_pages(v6_inputs, inputs.get("sourceDecisions", {})) if v6 else
                     select_v5_pages(selection_inputs) if v5 else
                     select_v4_pages(selection_inputs) if v4 else
                     select_v3_pages(selection_inputs) if v3 else
                     select_v2_pages(selection_inputs) if v2 else {})
        with tempfile.TemporaryDirectory(prefix="inspector-bounded-ocr-") as directory:
            for index, (source_id, source_hash, byte_size, media_type, download_path, raw_source) in enumerate(sources):
                if media_type != "application/pdf":
                    unsupported_sources += 1
                    outputs.append({
                        "sourceFileId": source_id, "sourceSha256": source_hash,
                        "mediaType": media_type, "pageCount": None,
                        "status": "SKIPPED_UNSUPPORTED_FORMAT", "ocrRequiredPageCount": 0,
                        "processedPageCount": 0, "deferredPageCount": 0, "pages": [],
                        **({"skippedRenderPixelPageCount": 0} if bounded else {}),
                        **({"subjectCandidatePageCount": 0} if v3_counters else {}),
                        **({"titleRecoveryCandidatePageCount": 0} if v4_selection else {}),
                        **({"reviewEligiblePageCount": 0, "stageUnresolvedPageCount": 0,
                            "selectionReasonCodes": []} if v6 else {}),
                    })
                    continue
                text = texts[source_id] if bounded else download_text_artifact(lease, raw_source, attempt)
                pages = text["pages"]
                required = [page["pageNumber"] for page in pages
                            if page["quality"]["disposition"] == "OCR_REQUIRED"]
                required_total += len(required)
                oversized = byte_size > profile["maxSourceBytes"]
                if oversized:
                    oversize_pages += len(required)
                selected = (selection[source_id]["selected"] if bounded else
                            [] if oversized else required[:PROFILE["maxPagesPerRun"] - processed])
                source_raster_skipped = selection[source_id]["rasterSkipped"] if bounded else 0
                source_subject_candidates = selection[source_id]["subjectCandidateCount"] if v3_counters else 0
                source_title_candidates = selection[source_id]["titleRecoveryCandidateCount"] if v4_selection else 0
                source_review_eligible = selection[source_id]["reviewEligiblePageCount"] if v6 else 0
                source_stage_unresolved = selection[source_id]["stageUnresolvedPageCount"] if v6 else 0
                source_selection_reasons = selection[source_id]["selectionReasonCodes"] if v6 else []
                raster_skipped_total += source_raster_skipped
                subject_candidate_total += source_subject_candidates
                title_candidate_total += source_title_candidates
                review_eligible_total += source_review_eligible
                stage_unresolved_total += source_stage_unresolved
                artifacts = []
                if selected:
                    if local_url is None:
                        provider_url = os.environ.get("DOCUMENT_PROVIDER_BASE_URL")
                        if not provider_url:
                            raise ValueError("configured bounded OCR requires DOCUMENT_PROVIDER_BASE_URL")
                        local_url = validate_local_url(provider_url)
                    path = Path(directory) / f"source-{index}.pdf"
                    _download_source(download_path, path, source_hash, byte_size, attempt)
                    for number in selected:
                        def recognize() -> dict[str, Any]:
                            return recognize_pdf_page(
                                path, source_id, source_hash, number, text["pageCount"],
                                base_url=local_url, dpi=profile["dpi"], script=profile["script"],
                            )

                        cache_root = os.environ.get("INSPECTOR_DURABLE_OCR_CACHE_ROOT")
                        expected_provider = os.environ.get("OCR_LAYOUT_PROFILE_ID")
                        if bounded and cache_root and expected_provider:
                            artifact, _cache_status = cached_durable_ocr_page(
                                cache_root=Path(cache_root), source_path=path,
                                source_file_id=source_id, source_sha256=source_hash,
                                page_number=number, page_count=text["pageCount"],
                                dpi=profile["dpi"], script=profile["script"],
                                renderer_profile_id=profile["rendererProfileId"],
                                provider_profile_id=expected_provider,
                                recognize=recognize,
                            )
                        else:
                            artifact = recognize()
                        # Verified legacy cache receipts may contain 1.0 or 10.0.
                        # Keep the cache immutable; use a JSON-stable copy in this run.
                        if isinstance(artifact.get("lines"), list):
                            artifact = json_stable_ocr_artifact(artifact)
                        if bounded:
                            _validate_bounded_artifact(artifact, text["pages"][number - 1], profile)
                        artifacts.append(artifact)
                    path.unlink()
                processed += len(artifacts)
                if v6:
                    status = ("SKIPPED_SOURCE_TOO_LARGE" if oversized
                              else "NO_OCR_REQUIRED_PAGES" if not required
                              else "SCANNED" if len(artifacts) == len(required)
                              else "SKIPPED_SOURCE_REVIEW_REQUIRED" if "SOURCE_REVIEW_REQUIRED" in source_selection_reasons
                              else "SKIPPED_SOURCE_NOT_CURRENT_APPROVED" if "SOURCE_REVIEW_NOT_CURRENT_APPROVED" in source_selection_reasons
                              else "SKIPPED_SECTION_NOT_AR_VK" if "SECTION_NOT_AR_VK" in source_selection_reasons
                              else "SKIPPED_PAGE_STAGE_UNRESOLVED" if not source_review_eligible and source_stage_unresolved
                              else "SKIPPED_RENDER_PIXEL_LIMIT" if not artifacts and source_raster_skipped
                                   == source_review_eligible and source_review_eligible > 0
                              else "PARTIALLY_SCANNED")
                else:
                    status = ("SKIPPED_SOURCE_TOO_LARGE" if oversized
                          else "NO_OCR_REQUIRED_PAGES" if not required
                          else "SCANNED" if len(artifacts) == len(required)
                          else "SKIPPED_NO_SUBJECT_CONTEXT" if v3 and not source_subject_candidates
                          else "SKIPPED_NO_SELECTION_CONTEXT" if v4_selection and not (
                              source_subject_candidates or source_title_candidates)
                          else "SKIPPED_RENDER_PIXEL_LIMIT" if bounded and not artifacts
                              and source_raster_skipped == (
                                  source_subject_candidates + source_title_candidates if v4_selection
                                  else source_subject_candidates if v3 else len(required))
                          else "PARTIALLY_SCANNED" if bounded
                          else "PARTIALLY_SCANNED_PAGE_BUDGET")
                outputs.append({
                    "sourceFileId": source_id, "sourceSha256": source_hash,
                    "mediaType": media_type, "pageCount": text["pageCount"],
                    "status": status, "ocrRequiredPageCount": len(required),
                    "processedPageCount": len(artifacts),
                    "deferredPageCount": len(required) - len(artifacts), "pages": artifacts,
                    **({"skippedRenderPixelPageCount": source_raster_skipped} if bounded else {}),
                    **({"subjectCandidatePageCount": source_subject_candidates} if v3_counters else {}),
                    **({"titleRecoveryCandidatePageCount": source_title_candidates} if v4_selection else {}),
                    **({"reviewEligiblePageCount": source_review_eligible,
                        "stageUnresolvedPageCount": source_stage_unresolved,
                        "selectionReasonCodes": source_selection_reasons} if v6 else {}),
                })
        result = {
            "schemaVersion": "analysis-stage-result-v2", "jobType": self.job_type,
            "inputManifestHash": manifest_hash, "disposition": "OCR_LAYOUT_BOUNDED",
            "reasonCode": "BOUNDED_OCR_ONLY", "providerKind": self.provider_kind,
            "providerProfileId": profile_id, "providerConfigHash": profile_hash,
            "outputCount": processed,
            "analysis": {
                "schemaVersion": ("bounded-ocr-layout-analysis-v6" if v6 else
                                  "bounded-ocr-layout-analysis-v5" if v5 else
                                  "bounded-ocr-layout-analysis-v4" if v4 else
                                  "bounded-ocr-layout-analysis-v3" if v3 else
                                  "bounded-ocr-layout-analysis-v2" if v2 else
                                  "bounded-ocr-layout-analysis-v1"),
                "objectId": object_id,
                "inputManifestHash": manifest_hash, "profile": profile,
                "sources": outputs, "sourceCount": len(outputs),
                "ocrRequiredPageCount": required_total, "processedPageCount": processed,
                "deferredPageCount": required_total - processed,
                "skippedOversizePageCount": oversize_pages,
                "skippedUnsupportedSourceCount": unsupported_sources,
                **({"skippedRenderPixelPageCount": raster_skipped_total} if bounded else {}),
                **({"subjectCandidatePageCount": subject_candidate_total} if v3_counters else {}),
                **({"titleRecoveryCandidatePageCount": title_candidate_total} if v4_selection else {}),
                **({"reviewEligiblePageCount": review_eligible_total,
                    "stageUnresolvedPageCount": stage_unresolved_total} if v6 else {}),
            },
        }
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > 8 * 1024 * 1024:
            raise ValueError("bounded OCR stage result exceeds 8 MiB")
        return result
