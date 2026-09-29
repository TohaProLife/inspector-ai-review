#!/usr/bin/env python3
"""Verify a persisted bounded OCR stage against included TRAIN_PUBLIC PDF bytes.

Checks committed artifact hashes, text-stage page selection, and independently
rerendered PNG bytes. OCR transcription and semantic correctness need expert
review and are deliberately outside this verifier's verdict.
"""

from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import PackageNotFoundError, version
from io import BytesIO
import json
import math
from pathlib import Path
import re
import sys
from typing import Any
import unicodedata
from bisect import bisect_left


SHA = re.compile(r"[a-f0-9]{64}\Z")
FILE_ID = re.compile(r"F[0-9]{4,}\Z")
RENDERER_PROFILE = "renderer-pdfium-5.12.1-linux-x86_64-v1"
PROFILE = {
    "schemaVersion": "bounded-ocr-layout-profile-v1",
    "methodId": "first-ocr-required-pages-v1",
    "maxPagesPerRun": 2,
    "maxSourceBytes": 64 * 1024 * 1024,
    "dpi": 120,
    "script": "eslav",
}
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
    "rendererProfileId": RENDERER_PROFILE,
    "ocrProviderProfileIds": [
        "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
        "ocr-paddle-3.7.0-ru-en-mobile-v1",
        "ocr-paddle-3.7.0-ru-en-server-v1",
    ],
    "anchorTerms": ["общая площадь здания", "тепловая нагрузка", "отоплен", "вентиляц", "таблиц"],
}
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
    "rendererProfileId": RENDERER_PROFILE,
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
PROFILE_V4 = {
    **PROFILE_V3,
    "schemaVersion": "bounded-ocr-layout-profile-v4",
    "methodId": "subject-window-or-cid-title-recovery-v4",
    "titleRecoveryMaxPage": 2,
    "titleRecoveryReasonCode": "TEXT_DECODING_ANOMALY",
}
PROFILE_V5 = {
    **PROFILE_V4,
    "schemaVersion": "bounded-ocr-layout-profile-v5",
    "methodId": "subject-window-or-cid-title-recovery-v5",
    "maxPagesPerRun": 4,
}
TOP_KEYS = {"schemaVersion", "jobType", "inputManifestHash", "disposition", "reasonCode",
            "providerKind", "providerProfileId", "providerConfigHash", "outputCount", "analysis"}
ANALYSIS_KEYS = {"schemaVersion", "objectId", "inputManifestHash", "profile", "sources",
                 "sourceCount", "ocrRequiredPageCount", "processedPageCount", "deferredPageCount",
                 "skippedOversizePageCount", "skippedUnsupportedSourceCount"}
SOURCE_KEYS = {"sourceFileId", "sourceSha256", "mediaType", "pageCount", "status",
               "ocrRequiredPageCount", "processedPageCount", "deferredPageCount", "pages"}
PAGE_KEYS = {"schemaVersion", "sourceFileId", "inputSha256", "pageNumber", "render",
             "provider", "lines", "contentHash"}


class VerificationError(ValueError):
    """A source, stage, or rendered page does not match its claimed provenance."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    raise VerificationError(f"non-finite JSON number: {value}")


def read_json(path: Path, expected_sha256: str) -> dict[str, Any]:
    if not SHA.fullmatch(expected_sha256):
        raise VerificationError("expected artifact SHA-256 is invalid")
    data = path.read_bytes()
    if digest(data) != expected_sha256:
        raise VerificationError(f"artifact SHA-256 differs from committed value: {path.name}")
    try:
        value = json.loads(data, object_pairs_hook=_unique_pairs,
                           parse_constant=_invalid_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"artifact is not UTF-8 JSON: {path.name}") from error
    if not isinstance(value, dict):
        raise VerificationError(f"artifact root must be an object: {path.name}")
    if digest(canonical(value)) != expected_sha256:
        raise VerificationError(f"artifact canonical hash differs from committed value: {path.name}")
    return value


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def manifest_entry(manifest: Path, file_id: str) -> dict[str, Any]:
    if not FILE_ID.fullmatch(file_id):
        raise VerificationError(f"invalid public file ID: {file_id}")
    selected: list[dict[str, Any]] = []
    with manifest.open("r", encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                raise VerificationError(f"blank manifest row {number}")
            try:
                row = json.loads(line, object_pairs_hook=_unique_pairs,
                                 parse_constant=_invalid_constant)
            except json.JSONDecodeError as error:
                raise VerificationError(f"invalid manifest JSON row {number}") from error
            if not isinstance(row, dict):
                raise VerificationError(f"manifest row {number} is not an object")
            if row.get("file_id") == file_id:
                selected.append(row)
    if len(selected) != 1:
        raise VerificationError(f"file_id must occur once in manifest: {file_id}")
    entry = selected[0]
    extension = entry.get("extension", ".pdf")
    if (entry.get("split") != "TRAIN_PUBLIC"
            or entry.get("distribution_status") != "INCLUDE"
            or entry.get("label_visibility") != "PUBLIC_TRAIN"
            or not isinstance(extension, str) or extension.lower() != ".pdf"):
        raise VerificationError(f"source is not included public training PDF: {file_id}")
    if (not isinstance(entry.get("sha256"), str) or not SHA.fullmatch(entry["sha256"])
            or type(entry.get("size_bytes")) is not int or entry["size_bytes"] < 1
            or type(entry.get("pdf_pages")) is not int or entry["pdf_pages"] < 1):
        raise VerificationError(f"manifest source identity incomplete: {file_id}")
    return entry


def exact_record(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise VerificationError(f"{label} structure is invalid")
    return value


def positive_int(value: Any) -> bool:
    return type(value) is int and value > 0


def nonnegative_int(value: Any) -> bool:
    return type(value) is int and value >= 0


def text_required_pages(text: dict[str, Any], source_id: str, source_sha: str,
                        page_count: int, *, v2: bool = False) -> list[int]:
    if (text.get("schemaVersion") != "document-text-v2"
            or text.get("sourceFileId") != source_id
            or text.get("inputSha256") != source_sha
            or text.get("qualityPolicyVersion") not in {"text-layer-quality-v1", "text-layer-quality-v2"}
            or not positive_int(text.get("pageCount"))
            or text.get("pageCount") != page_count
            or not isinstance(text.get("pages"), list)
            or len(text["pages"]) != page_count):
        raise VerificationError(f"text artifact provenance/page count invalid: {source_id}")
    required: list[int] = []
    for index, page in enumerate(text["pages"], 1):
        if (not isinstance(page, dict) or not positive_int(page.get("pageNumber"))
                or page["pageNumber"] != index):
            raise VerificationError(f"text artifact page sequence invalid: {source_id}")
        quality = page.get("quality")
        disposition = quality.get("disposition") if isinstance(quality, dict) else None
        if disposition not in {"OCR_REQUIRED", "TEXT_LAYER_CANDIDATE"}:
            raise VerificationError(f"text artifact quality invalid: {source_id} p{index}")
        if disposition == "OCR_REQUIRED":
            required.append(index)
        if v2:
            if (not positive_int(page.get("widthMilliPoints"))
                    or not positive_int(page.get("heightMilliPoints"))
                    or not isinstance(page.get("blocks"), list)):
                raise VerificationError(f"text artifact v2 geometry/blocks invalid: {source_id} p{index}")
            if (disposition == "TEXT_LAYER_CANDIDATE"
                    and any(not isinstance(block, dict) or not isinstance(block.get("text"), str)
                            for block in page["blocks"])):
                raise VerificationError(f"text artifact v2 anchor blocks invalid: {source_id} p{index}")
    summary = text.get("qualitySummary")
    if (not isinstance(summary, dict)
            or not nonnegative_int(summary.get("ocrRequiredPageCount"))
            or not nonnegative_int(summary.get("textLayerCandidatePageCount"))
            or summary.get("ocrRequiredPageCount") != len(required)
            or summary.get("textLayerCandidatePageCount") != page_count - len(required)):
        raise VerificationError(f"text artifact quality summary invalid: {source_id}")
    return required


def v2_candidates(text: dict[str, Any]) -> tuple[list[int], int]:
    anchors: list[int] = []
    for page in text["pages"]:
        if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        content = " ".join(unicodedata.normalize("NFKC", block["text"]).lower()
                           for block in page["blocks"])
        content = " ".join(content.split())
        if any(term in content for term in PROFILE_V2["anchorTerms"]):
            anchors.append(page["pageNumber"])
    ranked: list[tuple[bool, int, int]] = []
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
        index = bisect_left(anchors, number)
        distance = min(
            abs(number - anchors[index]) if index < len(anchors) else 2**53 - 1,
            abs(number - anchors[index - 1]) if index > 0 else 2**53 - 1,
        )
        drawing = max(width, height) >= PROFILE_V2["drawingLongEdgeMilliPoints"]
        ranked.append((not drawing, distance, number))
    ranked.sort()
    return [number for _drawing, _distance, number in ranked], raster_skipped


def select_v2_pages(prepared: list[dict[str, Any]]) -> dict[str, tuple[list[int], int]]:
    ranked: dict[str, list[int]] = {}
    result: dict[str, tuple[list[int], int]] = {}
    for source in prepared:
        source_id = source["sourceId"]
        if source["oversize"]:
            candidates, raster_skipped = [], 0
        else:
            candidates, raster_skipped = v2_candidates(source["text"])
        ranked[source_id] = candidates
        result[source_id] = ([], raster_skipped)
    processed = 0
    for round_index in range(PROFILE_V2["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                result[source_id][0].append(ranked[source_id][round_index])
                processed += 1
                if processed == PROFILE_V2["maxPagesPerRun"]:
                    return result
    return result


def v3_candidates(text: dict[str, Any]) -> tuple[list[int], int, int]:
    markers: list[int] = []
    summaries: list[int] = []
    for page in text["pages"]:
        if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        content = " ".join(unicodedata.normalize("NFKC", block["text"]).lower()
                           for block in page["blocks"])
        content = " ".join(content.split())
        if all(term in content for term in PROFILE_V3["revisionMarkerTerms"]):
            markers.append(page["pageNumber"])
        if all(term in content for term in PROFILE_V3["heatingSummaryTerms"]):
            summaries.append(page["pageNumber"])
    qualified: set[int] = set()
    for marker in markers:
        summary = next((number for number in summaries
                        if marker < number <= marker + PROFILE_V3["maxContextGapPages"]), None)
        if summary is None:
            continue
        for number in range(marker + 1, summary):
            if text["pages"][number - 1]["quality"]["disposition"] == "OCR_REQUIRED":
                qualified.add(number)
    ranked: list[int] = []
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


def select_v3_pages(prepared: list[dict[str, Any]]) -> dict[str, tuple[list[int], int, int]]:
    ranked: dict[str, list[int]] = {}
    result: dict[str, tuple[list[int], int, int]] = {}
    for source in prepared:
        source_id = source["sourceId"]
        candidates, raster_skipped, subject_count = v3_candidates(source["text"])
        if source["oversize"]:
            candidates, raster_skipped = [], 0
        ranked[source_id] = candidates
        result[source_id] = ([], raster_skipped, subject_count)
    processed = 0
    for round_index in range(PROFILE_V3["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                result[source_id][0].append(ranked[source_id][round_index])
                processed += 1
                if processed == PROFILE_V3["maxPagesPerRun"]:
                    return result
    return result


def select_v4_pages(
    prepared: list[dict[str, Any]], profile: dict[str, Any] = PROFILE_V4,
) -> dict[str, tuple[list[int], int, int, int]]:
    """Independently select subject pages or undecodable opening titles for v4/v5."""
    ranked: dict[str, list[int]] = {}
    result: dict[str, tuple[list[int], int, int, int]] = {}
    for source in prepared:
        source_id = source["sourceId"]
        candidates, raster_skipped, subject_count = v3_candidates(source["text"])
        title_count = 0
        if not subject_count:
            for page in source["text"]["pages"][:profile["titleRecoveryMaxPage"]]:
                quality = page["quality"]
                reasons = quality.get("reasonCodes")
                if (quality["disposition"] != "OCR_REQUIRED" or not isinstance(reasons, list)
                        or profile["titleRecoveryReasonCode"] not in reasons):
                    continue
                title_count += 1
                width_px = (page["widthMilliPoints"] * profile["dpi"] + 71_999) // 72_000
                height_px = (page["heightMilliPoints"] * profile["dpi"] + 71_999) // 72_000
                if (width_px * height_px > profile["maxRenderPixels"]
                        or width_px > profile["maxRenderSidePx"]
                        or height_px > profile["maxRenderSidePx"]):
                    raster_skipped += 1
                else:
                    candidates.append(page["pageNumber"])
        if source["oversize"]:
            candidates, raster_skipped = [], 0
        ranked[source_id] = candidates
        result[source_id] = ([], raster_skipped, subject_count, title_count)
    processed = 0
    for round_index in range(profile["maxPagesPerRun"]):
        for source_id in sorted(ranked):
            if round_index < len(ranked[source_id]):
                result[source_id][0].append(ranked[source_id][round_index])
                processed += 1
                if processed == profile["maxPagesPerRun"]:
                    return result
    return result


def validate_ocr_page(page: Any, source_id: str, source_sha: str,
                      page_number: int, *, v2: bool = False,
                      v3: bool = False, v4: bool = False, v5: bool = False,
                      text_page: dict[str, Any] | None = None) -> dict[str, Any]:
    page = exact_record(page, PAGE_KEYS, f"OCR page {source_id} p{page_number}")
    if (page["schemaVersion"] != "document-ocr-page-v1"
            or page["sourceFileId"] != source_id or page["inputSha256"] != source_sha
            or page["pageNumber"] != page_number or not isinstance(page["contentHash"], str)
            or not SHA.fullmatch(page["contentHash"])):
        raise VerificationError(f"OCR page provenance invalid: {source_id} p{page_number}")
    render = exact_record(page["render"],
                          {"sha256", "widthPx", "heightPx", "dpi", "rendererProfileId"},
                          "OCR render")
    provider = exact_record(page["provider"], {"profileId", "script"}, "OCR provider")
    if (not isinstance(render["sha256"], str) or not SHA.fullmatch(render["sha256"])
            or not positive_int(render["widthPx"]) or not positive_int(render["heightPx"])
            or render["widthPx"] * render["heightPx"] > 25_000_000
            or render["dpi"] != PROFILE["dpi"]
            or render["rendererProfileId"] != RENDERER_PROFILE
            or not isinstance(provider["profileId"], str) or not provider["profileId"]
            or provider["script"] != PROFILE["script"]
            or not isinstance(page["lines"], list) or len(page["lines"]) > 5000):
        raise VerificationError(f"OCR render/provider structure invalid: {source_id} p{page_number}")
    if v2 or v3 or v4 or v5:
        assert text_page is not None
        bounded = PROFILE_V5 if v5 else PROFILE_V4 if v4 else PROFILE_V3 if v3 else PROFILE_V2
        expected_width = (text_page["widthMilliPoints"] * bounded["dpi"] + 71_999) // 72_000
        expected_height = (text_page["heightMilliPoints"] * bounded["dpi"] + 71_999) // 72_000
        tolerance = bounded["geometryTolerancePx"]
        direct = (abs(render["widthPx"] - expected_width) <= tolerance
                  and abs(render["heightPx"] - expected_height) <= tolerance)
        swapped = (bounded["allowSwappedGeometry"]
                   and abs(render["widthPx"] - expected_height) <= tolerance
                   and abs(render["heightPx"] - expected_width) <= tolerance)
        if (render["widthPx"] > bounded["maxRenderSidePx"]
                or render["heightPx"] > bounded["maxRenderSidePx"]
                or provider["profileId"] not in bounded["ocrProviderProfileIds"]
                or not (direct or swapped)):
            raise VerificationError(f"OCR v2 provider/text geometry mismatch: {source_id} p{page_number}")
    for line in page["lines"]:
        line = exact_record(line, {"text", "score", "bboxPx"}, "OCR line")
        box = line["bboxPx"]
        if (not isinstance(line["text"], str) or len(line["text"]) > 4096
                or type(line["score"]) not in {int, float} or not math.isfinite(line["score"])
                or not 0 <= line["score"] <= 1 or not isinstance(box, list) or len(box) != 4
                or any(type(v) not in {int, float} or not math.isfinite(v) for v in box)
                or not (0 <= box[0] < box[2] <= render["widthPx"]
                        and 0 <= box[1] < box[3] <= render["heightPx"])):
            raise VerificationError(f"OCR line geometry invalid: {source_id} p{page_number}")
    without_hash = {key: value for key, value in page.items() if key != "contentHash"}
    if digest(canonical(without_hash)) != page["contentHash"]:
        raise VerificationError(f"OCR page canonical hash mismatch: {source_id} p{page_number}")
    return render


def render_verified_page(document: Any, number: int, render: dict[str, Any],
                         source_id: str) -> None:
    source_page = document[number - 1]
    bitmap = source_page.render(scale=PROFILE["dpi"] / 72.0, rev_byteorder=True)
    image = bitmap.to_pil().convert("RGB")
    if (image.width != render["widthPx"] or image.height != render["heightPx"]
            or image.width * image.height > 25_000_000):
        raise VerificationError(f"rerendered PNG geometry mismatch: {source_id} p{number}")
    output = BytesIO()
    image.save(output, format="PNG", optimize=False)
    if digest(output.getvalue()) != render["sha256"]:
        raise VerificationError(f"rerendered PNG SHA-256 mismatch: {source_id} p{number}")


def verify(manifest: Path, artifact_path: Path, expected_artifact_sha: str,
           sources: dict[str, tuple[str, Path]],
           texts: dict[str, tuple[Path, str]],
           *, expected_object_id: str | None = None,
           expected_input_manifest_hash: str | None = None) -> dict[str, Any]:
    try:
        if version("pypdfium2") != "5.12.1":
            raise VerificationError("pypdfium2==5.12.1 is required for byte-identical rerender")
    except PackageNotFoundError as error:
        raise VerificationError("pypdfium2==5.12.1 is required for offline rerender") from error
    import pypdfium2 as pdfium

    if not sources or set(texts) != set(sources):
        raise VerificationError("every source requires an explicit PDF and committed text artifact")
    artifact = read_json(artifact_path, expected_artifact_sha)
    exact_record(artifact, TOP_KEYS, "bounded OCR stage")
    manifest_hash = artifact["inputManifestHash"]
    profile_id = artifact["providerProfileId"]
    if profile_id not in {"local-bounded-ocr-layout-v1", "local-bounded-ocr-layout-v2",
                          "local-bounded-ocr-layout-v3", "local-bounded-ocr-layout-v4",
                          "local-bounded-ocr-layout-v5"}:
        raise VerificationError("bounded OCR stage provider profile is unknown")
    v2 = profile_id == "local-bounded-ocr-layout-v2"
    v3 = profile_id == "local-bounded-ocr-layout-v3"
    v4 = profile_id == "local-bounded-ocr-layout-v4"
    v5 = profile_id == "local-bounded-ocr-layout-v5"
    bounded = v2 or v3 or v4 or v5
    profile = PROFILE_V5 if v5 else PROFILE_V4 if v4 else PROFILE_V3 if v3 else PROFILE_V2 if v2 else PROFILE
    if (artifact["schemaVersion"] != "analysis-stage-result-v2"
            or artifact["jobType"] != "DOCUMENT_OCR_LAYOUT"
            or not isinstance(manifest_hash, str) or not SHA.fullmatch(manifest_hash)
            or expected_input_manifest_hash is not None
            and manifest_hash != expected_input_manifest_hash
            or artifact["disposition"] != "OCR_LAYOUT_BOUNDED"
            or artifact["reasonCode"] != "BOUNDED_OCR_ONLY"
            or artifact["providerKind"] != "OCR_LAYOUT"
            or artifact["providerConfigHash"] != digest(canonical(profile))
            or not nonnegative_int(artifact["outputCount"])):
        raise VerificationError("bounded OCR stage provenance/profile invalid")
    analysis = exact_record(artifact["analysis"],
                            ANALYSIS_KEYS
                            | ({"skippedRenderPixelPageCount"} if bounded else set())
                            | ({"subjectCandidatePageCount"} if v3 or v4 or v5 else set())
                            | ({"titleRecoveryCandidatePageCount"} if v4 or v5 else set()),
                            "bounded OCR analysis")
    if (analysis["schemaVersion"] != ("bounded-ocr-layout-analysis-v5" if v5
                                     else "bounded-ocr-layout-analysis-v4" if v4
                                     else "bounded-ocr-layout-analysis-v3" if v3
                                     else "bounded-ocr-layout-analysis-v2" if v2
                                     else "bounded-ocr-layout-analysis-v1")
            or not isinstance(analysis["objectId"], str) or not analysis["objectId"]
            or expected_object_id is not None and analysis["objectId"] != expected_object_id
            or analysis["inputManifestHash"] != manifest_hash or analysis["profile"] != profile
            or not isinstance(analysis["sources"], list)
            or not nonnegative_int(analysis["sourceCount"])
            or analysis["sourceCount"] != len(analysis["sources"])):
        raise VerificationError("bounded OCR analysis provenance/profile invalid")
    aggregate_counters = ("ocrRequiredPageCount", "processedPageCount", "deferredPageCount",
                          "skippedOversizePageCount", "skippedUnsupportedSourceCount")
    if bounded:
        aggregate_counters += ("skippedRenderPixelPageCount",)
    if v3 or v4 or v5:
        aggregate_counters += ("subjectCandidatePageCount",)
    if v4 or v5:
        aggregate_counters += ("titleRecoveryCandidatePageCount",)
    if any(not nonnegative_int(analysis.get(key)) for key in aggregate_counters):
        raise VerificationError("bounded OCR analysis counters invalid")
    rows = analysis["sources"]
    source_ids = [row.get("sourceFileId") if isinstance(row, dict) else None for row in rows]
    if (len(rows) != len(sources)
            or any(not isinstance(source_id, str) or not source_id for source_id in source_ids)
            or len(set(source_ids)) != len(rows)
            or source_ids != sorted(source_ids)
            or set(source_ids) != {value[0] for value in sources.values()}):
        raise VerificationError("OCR stage source set/order differs from explicit mappings")

    selected_total = required_total = skipped_oversize = verified_pages = raster_skipped_total = 0
    subject_candidate_total = title_candidate_total = 0
    report_sources = []
    by_id = {value[0]: (file_id, value[1]) for file_id, value in sources.items()}
    prepared: list[dict[str, Any]] = []
    for row in rows:
        row = exact_record(row, SOURCE_KEYS
                           | ({"skippedRenderPixelPageCount"} if bounded else set())
                           | ({"subjectCandidatePageCount"} if v3 or v4 or v5 else set())
                           | ({"titleRecoveryCandidatePageCount"} if v4 or v5 else set()),
                           "OCR source")
        source_id = row["sourceFileId"]
        file_id, path = by_id[source_id]
        entry = manifest_entry(manifest, file_id)
        pdf_bytes = path.read_bytes()
        if (len(pdf_bytes) != entry["size_bytes"] or digest(pdf_bytes) != entry["sha256"]):
            raise VerificationError(f"public source size/SHA-256 mismatch: {file_id}")
        source_counters = ("ocrRequiredPageCount", "processedPageCount", "deferredPageCount")
        if bounded:
            source_counters += ("skippedRenderPixelPageCount",)
        if v3 or v4 or v5:
            source_counters += ("subjectCandidatePageCount",)
        if v4 or v5:
            source_counters += ("titleRecoveryCandidatePageCount",)
        if (row["sourceSha256"] != entry["sha256"] or row["mediaType"] != "application/pdf"
                or not positive_int(row["pageCount"])
                or row["pageCount"] != entry["pdf_pages"]
                or any(not nonnegative_int(row.get(key)) for key in source_counters)
                or not isinstance(row["pages"], list)):
            raise VerificationError(f"OCR source provenance/page count invalid: {file_id}")
        text_path, text_hash = texts[file_id]
        text = read_json(text_path, text_hash)
        required = text_required_pages(text, source_id, entry["sha256"], entry["pdf_pages"],
                                       v2=bounded)
        prepared.append({"row": row, "sourceId": source_id, "fileId": file_id,
                         "entry": entry, "pdfBytes": pdf_bytes, "text": text,
                         "textHash": text_hash, "required": required,
                         "oversize": entry["size_bytes"] > profile["maxSourceBytes"]})
    v2_selection = select_v2_pages(prepared) if v2 else {}
    v3_selection = select_v3_pages(prepared) if v3 else {}
    v4_selection = select_v4_pages(prepared, profile) if v4 or v5 else {}
    for source in prepared:
        row = source["row"]
        source_id = source["sourceId"]
        file_id = source["fileId"]
        entry = source["entry"]
        required = source["required"]
        oversize = source["oversize"]
        if v4 or v5:
            selected, raster_skipped, subject_candidates, title_candidates = v4_selection[source_id]
        elif v3:
            selected, raster_skipped, subject_candidates = v3_selection[source_id]
            title_candidates = 0
        elif v2:
            selected, raster_skipped = v2_selection[source_id]
            subject_candidates = title_candidates = 0
        else:
            selected = [] if oversize else required[:PROFILE["maxPagesPerRun"] - selected_total]
            raster_skipped = subject_candidates = title_candidates = 0
        expected_status = ("SKIPPED_SOURCE_TOO_LARGE" if oversize
                           else "NO_OCR_REQUIRED_PAGES" if not required
                           else "SCANNED" if len(selected) == len(required)
                           else "SKIPPED_NO_SUBJECT_CONTEXT" if v3 and not subject_candidates
                           else "SKIPPED_NO_SELECTION_CONTEXT" if (v4 or v5) and not (subject_candidates or title_candidates)
                           else "SKIPPED_RENDER_PIXEL_LIMIT" if bounded and not selected
                           and raster_skipped == (subject_candidates + title_candidates if v4 or v5
                                                  else subject_candidates if v3 else len(required))
                           else "PARTIALLY_SCANNED" if bounded
                           else "PARTIALLY_SCANNED_PAGE_BUDGET")
        if (row["status"] != expected_status or row["ocrRequiredPageCount"] != len(required)
                or row["processedPageCount"] != len(selected)
                or row["deferredPageCount"] != len(required) - len(selected)
                or bounded and row["skippedRenderPixelPageCount"] != raster_skipped
                or (v3 or v4 or v5) and row["subjectCandidatePageCount"] != subject_candidates
                or (v4 or v5) and row["titleRecoveryCandidatePageCount"] != title_candidates
                or len(row["pages"]) != len(selected)):
            raise VerificationError(f"OCR source selection/counters invalid: {file_id}")
        document = pdfium.PdfDocument(source["pdfBytes"])
        try:
            if len(document) != entry["pdf_pages"]:
                raise VerificationError(f"original PDF page count mismatch: {file_id}")
            for page, number in zip(row["pages"], selected, strict=True):
                render = validate_ocr_page(page, source_id, entry["sha256"], number,
                                           v2=v2, v3=v3, v4=v4, v5=v5,
                                           text_page=source["text"]["pages"][number - 1])
                render_verified_page(document, number, render, source_id)
                verified_pages += 1
        finally:
            document.close()
        selected_total += len(selected)
        required_total += len(required)
        skipped_oversize += len(required) if oversize else 0
        raster_skipped_total += raster_skipped
        subject_candidate_total += subject_candidates
        title_candidate_total += title_candidates
        report_sources.append({"fileId": file_id, "sourceFileId": source_id,
                               "sourceSha256": entry["sha256"],
                               "textArtifactSha256": source["textHash"],
                               "ocrRequiredPageCount": len(required),
                               **({"skippedRenderPixelPageCount": raster_skipped} if bounded else {}),
                               **({"subjectCandidatePageCount": subject_candidates} if v3 or v4 or v5 else {}),
                               **({"titleRecoveryCandidatePageCount": title_candidates} if v4 or v5 else {}),
                               "verifiedRenderedPages": selected})
    if (artifact["outputCount"] != selected_total
            or analysis["processedPageCount"] != selected_total
            or analysis["ocrRequiredPageCount"] != required_total
            or analysis["deferredPageCount"] != required_total - selected_total
            or analysis["skippedOversizePageCount"] != skipped_oversize
            or bounded and analysis["skippedRenderPixelPageCount"] != raster_skipped_total
            or (v3 or v4 or v5) and analysis["subjectCandidatePageCount"] != subject_candidate_total
            or (v4 or v5) and analysis["titleRecoveryCandidatePageCount"] != title_candidate_total
            or analysis["skippedUnsupportedSourceCount"] != 0):
        raise VerificationError("OCR stage aggregate counters invalid")
    return {
        "schemaVersion": "bounded-ocr-stage-verification-v1",
        "status": "SOURCE_RENDER_SCOPE_VERIFIED",
        "profileId": profile_id,
        "artifactSha256": expected_artifact_sha,
        "inputManifestHash": manifest_hash,
        "objectId": analysis["objectId"],
        "verifiedRenderedPageCount": verified_pages,
        "ocrLineTextVerified": False,
        "ocrLineTextVerificationReason": "INDEPENDENT_EXPERT_REVIEW_REQUIRED",
        "sources": report_sources,
    }


def _parse_source(value: str) -> tuple[str, str, Path]:
    parts = value.split("=", 2)
    if len(parts) != 3 or not FILE_ID.fullmatch(parts[0]) or not parts[1] or not parts[2]:
        raise argparse.ArgumentTypeError("source must be FILE_ID=SOURCE_FILE_ID=PDF_PATH")
    return parts[0], parts[1], Path(parts[2])


def _parse_text(value: str) -> tuple[str, Path, str]:
    parts = value.split("=", 2)
    if len(parts) != 3 or not FILE_ID.fullmatch(parts[0]) or not parts[1] or not SHA.fullmatch(parts[2]):
        raise argparse.ArgumentTypeError("text must be FILE_ID=TEXT_JSON_PATH=COMMITTED_SHA256")
    return parts[0], Path(parts[1]), parts[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--expected-artifact-sha256", required=True)
    parser.add_argument("--source", required=True, type=_parse_source, action="append")
    parser.add_argument("--text", required=True, type=_parse_text, action="append")
    parser.add_argument("--expected-object-id")
    parser.add_argument("--expected-input-manifest-hash")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    sources: dict[str, tuple[str, Path]] = {}
    texts: dict[str, tuple[Path, str]] = {}
    for file_id, source_id, path in args.source:
        if file_id in sources or any(item[0] == source_id for item in sources.values()):
            parser.error("duplicate file ID or sourceFileId")
        sources[file_id] = (source_id, path)
    for file_id, path, sha in args.text:
        if file_id in texts:
            parser.error("duplicate text artifact file ID")
        texts[file_id] = (path, sha)
    try:
        result = verify(args.manifest, args.artifact, args.expected_artifact_sha256,
                        sources, texts, expected_object_id=args.expected_object_id,
                        expected_input_manifest_hash=args.expected_input_manifest_hash)
    except (VerificationError, OSError, ValueError) as error:
        print(json.dumps({"status": "VERIFICATION_FAILED", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    serialized = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
