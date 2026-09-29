#!/usr/bin/env python3
"""Evaluate durable visual proposals on independently reviewed TRAIN_PUBLIC sheets.

This measures class-conditioned proposal localization. Proposals carry no class,
so these numbers are never class recognition precision or an inspection verdict.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any

import fitz


PROFILE_LIMITS = {
    "visual-proposal-analysis-v1": ("visual-proposal-profile-v1", 64),
    "visual-proposal-analysis-v2": ("visual-proposal-profile-v2", 64),
    "visual-proposal-analysis-v3": ("visual-proposal-profile-v3", 1024),
    "visual-proposal-analysis-v4": ("visual-proposal-profile-v4", 1024),
    "visual-proposal-analysis-v5": ("visual-proposal-profile-v5", 1024),
    "visual-proposal-analysis-v6": ("visual-proposal-profile-v6", 1024),
}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
VLM_MODEL_ID = "inspector-qwen3vl4b-eval"
VLM_WEIGHTS_SHA256 = "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a"
VLM_PROJECTOR_SHA256 = "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d"
VLM_PROMPT_SHA256 = "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611"
SERVER_VLM_MODEL_ID = "inspector-qwen3-vl-8b-fp8"
SERVER_VLM_REVISION = "9cdc6310a8cb770ce18efaf4e9935334512aee45"
SERVER_VLM_LOCK_SHA256 = "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879"
SERVER_VLM_SHARDS = [
    {"filename": "model-00001-of-00002.safetensors", "sha256": "e2dea2e85e643ef7045c31a485a426631a1e0a84e463f8b2c7e9c6682a06eafd"},
    {"filename": "model-00002-of-00002.safetensors", "sha256": "3dc64ec934af27a7007d265014e907aff9e16658d409e5cd4cf79869bf2bd8c1"},
]
_COVER_HEADING = re.compile(r"^(?:РАБОЧАЯ|ПРОЕКТНАЯ)\s+ДОКУМЕНТАЦИЯ$", re.IGNORECASE)
_HEATING = re.compile(r"\bотоплени[еяию]\b", re.IGNORECASE)
_VENTILATION = re.compile(r"\bвентиляци[яиюе]\b", re.IGNORECASE)


def original_document_context(document: fitz.Document) -> dict[str, Any]:
    """Recompute v4 cover context from the verified PDF, independent of API claim."""
    pages = []
    domains: set[str] = set()
    for index in range(min(2, len(document))):
        source_text = document.load_page(index).get_text("text")
        lines = [line.strip() for line in source_text.splitlines() if line.strip()]
        title_window = None
        for line_index, line in enumerate(lines):
            if _COVER_HEADING.fullmatch(line):
                title_window = "\n".join(lines[line_index:line_index + 6])[:500]
                break
        pages.append({
            "pageNumber": index + 1,
            "textSha256": hashlib.sha256(source_text.encode("utf-8")).hexdigest(),
            "titleWindow": title_window,
        })
        if title_window:
            if _HEATING.search(title_window):
                domains.add("HEATING")
            if _VENTILATION.search(title_window):
                domains.add("VENTILATION")
    status = next(iter(domains)) if len(domains) == 1 else "UNKNOWN"
    return {
        "schemaVersion": "document-context-v1",
        "methodId": "first-two-pdf-cover-text-pages-v1",
        "status": status,
        "reasonCode": "TITLE_KEYWORD_MATCH" if len(domains) == 1
        else "TITLE_CONFLICT" if len(domains) > 1 else "NO_TITLE_KEYWORD_MATCH",
        "inspectedPages": pages,
    }


def original_vlm_crop(document: fitz.Document, proposal: dict[str, Any]) -> bytes:
    """Re-render the v5 crop from the verified original PDF, not the saved claim."""
    page = document.load_page(proposal["pageNumber"] - 1)
    box = rectangle(proposal["bboxNormalized"], "VLM crop", 1, 1)
    bounds = page.rect
    width = min(1., max((box[2] - box[0]) * 4, 0.04))
    height = min(1., max((box[3] - box[1]) * 4, 0.04))
    if width * bounds.width < height * bounds.height:
        width = min(1., height * bounds.height / bounds.width)
    else:
        height = min(1., width * bounds.width / bounds.height)
    left = max(0., min(1. - width, (box[0] + box[2] - width) / 2))
    top = max(0., min(1. - height, (box[1] + box[3] - height) / 2))
    displayed = fitz.Rect(bounds.x0 + left * bounds.width, bounds.y0 + top * bounds.height,
                          bounds.x0 + (left + width) * bounds.width,
                          bounds.y0 + (top + height) * bounds.height)
    scale = min(768 / max(displayed.width, displayed.height), 600 / 72)
    clip = displayed * page.derotation_matrix
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
    if not 1 <= pixmap.width <= 772 or not 1 <= pixmap.height <= 772 \
            or pixmap.width * pixmap.height > 600_000:
        raise ValueError("VLM crop pixel count exceeds limit")
    png = pixmap.tobytes("png")
    if len(png) > 2 * 1024 * 1024:
        raise ValueError("VLM crop byte count exceeds limit")
    return png


def verify_vlm_observations(document: fitz.Document, source: dict[str, Any],
                            version: str) -> dict[str, int]:
    vlm = source.get("vlm")
    proposals = source["proposals"]
    count = len(proposals)
    ordinals = list(range(count)) if count <= 2 else [count // 4, (3 * count) // 4]
    if (not isinstance(vlm, dict) or set(vlm) != {"schemaVersion", "methodId", "eligibleProposalCount",
                                                "selectedOrdinals", "omittedProposalCount", "observations"}
            or vlm.get("schemaVersion") != "visual-vlm-observations-v1"
            or vlm.get("methodId") != ("spread-two-saved-proposals-server-nonnegative-v1"
                                       if version == "visual-proposal-analysis-v6"
                                       else "spread-two-saved-proposals-v1")
            or vlm.get("eligibleProposalCount") != count
            or vlm.get("selectedOrdinals") != ordinals
            or vlm.get("omittedProposalCount") != count - len(ordinals)
            or not isinstance(vlm.get("observations"), list)
            or len(vlm["observations"]) != len(ordinals)):
        raise ValueError("VLM observation scope differs from immutable profile")
    decisions = {"RADIATOR_HINT": 0, "OTHER_HINT": 0, "ABSTAIN": 0}
    for index, ordinal in enumerate(ordinals):
        observation = vlm["observations"][index]
        proposal = proposals[ordinal]
        server = version == "visual-proposal-analysis-v6"
        if (not isinstance(observation, dict)
                or set(observation) != ({"proposalOrdinal", "sourceSha256", "pageNumber",
                                         "bboxNormalized", "cropSha256", "modelId", "promptSha256",
                                         "decision", "reasonCode", "responseSha256"}
                                        | ({"modelRevision", "modelLockSha256"} if server
                                           else {"modelWeightsSha256", "modelProjectorSha256"}))
                or observation["proposalOrdinal"] != ordinal
                or observation["sourceSha256"] != source["sourceSha256"]
                or observation["pageNumber"] != proposal["pageNumber"]
                or observation["bboxNormalized"] != proposal["bboxNormalized"]
                or observation["modelId"] != (SERVER_VLM_MODEL_ID if server else VLM_MODEL_ID)
                or (server and (observation["modelRevision"] != SERVER_VLM_REVISION
                                or observation["modelLockSha256"] != SERVER_VLM_LOCK_SHA256))
                or (not server and (observation["modelWeightsSha256"] != VLM_WEIGHTS_SHA256
                                    or observation["modelProjectorSha256"] != VLM_PROJECTOR_SHA256))
                or observation["promptSha256"] != VLM_PROMPT_SHA256
                or observation["decision"] not in decisions):
            raise ValueError("VLM observation provenance or proposal mapping differs")
        crop_sha = observation["cropSha256"]
        response_sha = observation["responseSha256"]
        reason = observation["reasonCode"]
        if reason == "CROP_RENDER_ERROR":
            if crop_sha is not None or response_sha is not None or observation["decision"] != "ABSTAIN":
                raise ValueError("VLM crop error has contradictory evidence")
        else:
            if not isinstance(crop_sha, str) or not SHA256.fullmatch(crop_sha):
                raise ValueError("VLM crop hash missing")
            if hashlib.sha256(original_vlm_crop(document, proposal)).hexdigest() != crop_sha:
                raise ValueError("VLM crop differs from original PDF")
            if reason == "MODEL_RESPONSE":
                if observation["decision"] not in ({"RADIATOR_HINT"} if server else
                                                  {"RADIATOR_HINT", "OTHER_HINT"}):
                    raise ValueError("VLM decision contradicts response status")
            elif reason == "MODEL_ABSTAIN":
                if observation["decision"] != "ABSTAIN":
                    raise ValueError("VLM decision contradicts abstention")
            elif server and reason == "MODEL_OTHER_UNTRUSTED":
                if observation["decision"] != "ABSTAIN":
                    raise ValueError("VLM negative response was not rejected")
            elif reason in {"ENDPOINT_NOT_CONFIGURED", "MODEL_HTTP_ERROR", "MODEL_TIMEOUT",
                            "MODEL_UNAVAILABLE", "MODEL_REDIRECT_REJECTED", "MODEL_OUTPUT_INVALID",
                            "MODEL_RESPONSE_TOO_LARGE"}:
                if observation["decision"] != "ABSTAIN" or response_sha is not None:
                    raise ValueError("VLM transport error has contradictory evidence")
            else:
                raise ValueError("VLM reason is invalid")
            if reason in {"MODEL_RESPONSE", "MODEL_ABSTAIN", "MODEL_OTHER_UNTRUSTED"} and (
                    not isinstance(response_sha, str) or not SHA256.fullmatch(response_sha)):
                raise ValueError("VLM response hash missing")
        decisions[observation["decision"]] += 1
    return decisions


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def parse_jsonl(content: bytes, path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(content.decode("utf-8").splitlines(), 1):
        if not line.strip():
            raise ValueError(f"blank JSONL row at {path}:{number}")
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError(f"JSONL row must be an object at {path}:{number}")
        rows.append(row)
    return rows


def rectangle(value: object, label: str, width: float, height: float) -> tuple[float, float, float, float]:
    if (not isinstance(value, list) or len(value) != 4
            or any(type(item) not in (int, float) or not math.isfinite(item) for item in value)):
        raise ValueError(f"{label}: bbox requires four finite numbers")
    x0, y0, x1, y1 = (float(item) for item in value)
    if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
        raise ValueError(f"{label}: bbox outside top-left display bounds")
    return x0, y0, x1, y1


def iou(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    overlap = max(0.0, min(left[2], right[2]) - max(left[0], right[0])) * max(
        0.0, min(left[3], right[3]) - max(left[1], right[1]))
    left_area = (left[2] - left[0]) * (left[3] - left[1])
    right_area = (right[2] - right[0]) * (right[3] - right[1])
    return overlap / (left_area + right_area - overlap)


def matches(proposals: list[tuple[float, float, float, float]],
            truth: list[tuple[float, float, float, float]], threshold: float) -> list[tuple[int, int]]:
    # Maximum-cardinality one-to-one matching; duplicate proposals count as FP.
    edges = [[target for target, _ in sorted(
        ((index, iou(proposal, box)) for index, box in enumerate(truth)
         if iou(proposal, box) >= threshold), key=lambda pair: (-pair[1], pair[0]))]
        for proposal in proposals]
    assigned: dict[int, int] = {}

    def augment(proposal: int, seen: set[int]) -> bool:
        for target in edges[proposal]:
            if target in seen:
                continue
            seen.add(target)
            previous = assigned.get(target)
            if previous is None or augment(previous, seen):
                assigned[target] = proposal
                return True
        return False

    for proposal in range(len(proposals)):
        augment(proposal, set())
    return sorted((proposal, target) for target, proposal in assigned.items())


def scanned_pages(source: dict[str, Any], version: str, page_count: int) -> list[int]:
    _, limit = PROFILE_LIMITS[version]
    if page_count <= limit:
        expected = list(range(1, page_count + 1))
    elif version == "visual-proposal-analysis-v1":
        expected = []
    else:
        middle_count = limit - 16
        expected = list(range(1, 9)) + [
            9 + ((2 * index + 1) * (page_count - 16)) // (2 * middle_count)
            for index in range(middle_count)
        ] + list(range(page_count - 7, page_count + 1))
    status = ("SKIPPED_PAGE_LIMIT" if not expected else
              "PARTIALLY_SCANNED_PAGE_LIMIT" if len(expected) < page_count else "SCANNED")
    if (source.get("status") != status
            or type(source.get("scannedPageCount")) is not int
            or source["scannedPageCount"] != len(expected)
            or type(source.get("proposalLimitReached")) is not bool
            or type(source.get("unretainedProposalCount")) is not int
            or source["unretainedProposalCount"] < 0
            or source["proposalLimitReached"] != (source["unretainedProposalCount"] > 0)):
        raise ValueError("visual scan scope or proposal limit is inconsistent")
    if version != "visual-proposal-analysis-v1":
        selected = source.get("scannedPageNumbers")
        if (not isinstance(selected, list) or any(type(page) is not int for page in selected)
                or selected != expected or type(source.get("skippedPageCount")) is not int
                or source["skippedPageCount"] != page_count - len(expected)):
            raise ValueError("visual scannedPageNumbers differ from immutable profile")
    return expected


def evaluate(manifest: list[dict[str, Any]], artifact: dict[str, Any],
             reviews: list[dict[str, Any]], source_pdf: Path, file_id: str,
             pages: list[int], classes: list[str], minimum_iou: float,
             *, manifest_sha256: str, artifact_sha256: str, reviews_sha256: str) -> dict[str, Any]:
    if not 0 < minimum_iou <= 1 or not math.isfinite(minimum_iou):
        raise ValueError("minimum IoU must be in (0, 1]")
    if not pages or any(type(page) is not int or page < 1 for page in pages) or len(set(pages)) != len(pages):
        raise ValueError("selected pages must be unique positive integers")
    if (not classes or any(not isinstance(name, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name)
                           for name in classes) or len(set(classes)) != len(classes)):
        raise ValueError("selected classes must be unique uppercase class IDs")
    matches_manifest = [row for row in manifest if row.get("file_id") == file_id]
    if len(matches_manifest) != 1:
        raise ValueError("source file_id must occur exactly once in manifest")
    entry = matches_manifest[0]
    if (entry.get("split") != "TRAIN_PUBLIC" or entry.get("distribution_status") != "INCLUDE"
            or entry.get("label_visibility") != "PUBLIC_TRAIN"):
        raise ValueError("only included TRAIN_PUBLIC/PUBLIC_TRAIN sources are allowed")
    if (not isinstance(entry.get("sha256"), str) or not SHA256.fullmatch(entry["sha256"])
            or type(entry.get("size_bytes")) is not int or entry["size_bytes"] < 1
            or type(entry.get("pdf_pages")) is not int or entry["pdf_pages"] < 1
            or not isinstance(entry.get("object_id"), str) or not entry["object_id"]):
        raise ValueError("manifest source identity is incomplete")
    if source_pdf.stat().st_size != entry["size_bytes"] or digest(source_pdf) != entry["sha256"]:
        raise ValueError("source PDF size or SHA-256 mismatch")

    version = artifact.get("schemaVersion")
    if (not isinstance(version, str) or version not in PROFILE_LIMITS
            or artifact.get("status") != "PROPOSAL_ONLY_UNVERIFIED"
            or not isinstance(artifact.get("sources"), list)
            or not isinstance(artifact.get("objectId"), str)
            or not isinstance(artifact.get("inputManifestHash"), str)
            or not SHA256.fullmatch(artifact["inputManifestHash"])
            or not isinstance(artifact.get("contentHash"), str)
            or not SHA256.fullmatch(artifact["contentHash"])):
        raise ValueError("visual artifact schema or provenance is invalid")
    profile_version, limit = PROFILE_LIMITS[version]
    profile = artifact.get("profile")
    expected_profile = {
        "schemaVersion": profile_version,
        "methodId": "red-vector-panel-blue-contact-v1",
        "maxPagesPerSource": limit,
        "maxProposalsPerSource": 500,
        "coordinateSystem": "NORMALIZED_TOP_LEFT",
    }
    if version in {"visual-proposal-analysis-v4", "visual-proposal-analysis-v5", "visual-proposal-analysis-v6"}:
        expected_profile.update({"contextMethodId": "first-two-pdf-cover-text-pages-v1",
                                 "maxContextPages": 2})
    if version == "visual-proposal-analysis-v5":
        expected_profile.update({
            "vlmMethodId": "spread-two-saved-proposals-v1",
            "vlmModelId": VLM_MODEL_ID,
            "vlmModelWeightsSha256": VLM_WEIGHTS_SHA256,
            "vlmModelProjectorSha256": VLM_PROJECTOR_SHA256,
            "vlmPromptSha256": VLM_PROMPT_SHA256,
            "maxVlmObservationsPerSource": 2,
            "vlmCropMaxEdgePx": 768,
        })
    if version == "visual-proposal-analysis-v6":
        expected_profile.update({
            "vlmMethodId": "spread-two-saved-proposals-server-nonnegative-v1",
            "vlmModelId": SERVER_VLM_MODEL_ID,
            "vlmModelRevision": SERVER_VLM_REVISION,
            "vlmModelLockSha256": SERVER_VLM_LOCK_SHA256,
            "vlmModelShards": SERVER_VLM_SHARDS,
            "vlmPromptSha256": VLM_PROMPT_SHA256,
            "maxVlmObservationsPerSource": 2,
            "vlmCropMaxEdgePx": 768,
        })
    if profile != expected_profile:
        raise ValueError("visual profile or coordinate convention is ambiguous")
    sources = [source for source in artifact["sources"] if isinstance(source, dict)
               and source.get("sourceSha256") == entry["sha256"]]
    if len(sources) != 1:
        raise ValueError("visual artifact must identify exactly one source PDF SHA-256")
    source = sources[0]
    if (not isinstance(source.get("sourceFileId"), str) or not source["sourceFileId"]
            or source.get("sourceSha256") != entry["sha256"]
            or type(source.get("pageCount")) is not int
            or source["pageCount"] != entry["pdf_pages"]
            or not isinstance(source.get("proposals"), list)
            or len(source["proposals"]) > 500):
        raise ValueError("visual source identity or proposal count is invalid")
    scanned = scanned_pages(source, version, entry["pdf_pages"])
    if not set(pages).issubset(scanned):
        raise ValueError("selected page was not scanned")
    vlm_decisions = None
    if version in {"visual-proposal-analysis-v5", "visual-proposal-analysis-v6"}:
        with fitz.open(source_pdf) as document:
            vlm_decisions = verify_vlm_observations(document, source, version)
    elif "vlm" in source:
        raise ValueError("legacy visual artifact unexpectedly has VLM observations")
    if source["proposalLimitReached"]:
        return {
            "schema_version": "visual-proposal-evaluation-v1", "status": "NOT_ESTIMABLE",
            "reason_code": "PROPOSAL_LIMIT_REACHED", "metrics": None,
            "recognition_metrics": None, "release_gate": "NOT_ASSESSED",
            "file_id": file_id, "selected_pages": pages, "selected_classes": classes,
            "scanned_page_count": len(scanned),
            "other_scanned_pages_not_evaluated": len(scanned) - len(pages),
            "skipped_page_count": entry["pdf_pages"] - len(scanned),
            "unretained_proposal_count": source["unretainedProposalCount"],
            "manifest_sha256": manifest_sha256, "artifact_file_sha256": artifact_sha256,
            "artifact_content_hash_claim": artifact["contentHash"],
            "vlm_decisions_not_recognition_metrics": vlm_decisions,
            "reviews_sha256": reviews_sha256,
        }

    with fitz.open(source_pdf) as document:
        if not document.is_pdf or document.needs_pass or len(document) != entry["pdf_pages"]:
            raise ValueError("source is not an unencrypted PDF with manifest page count")
        if version in {"visual-proposal-analysis-v4", "visual-proposal-analysis-v5", "visual-proposal-analysis-v6"}:
            if source.get("documentContext") != original_document_context(document):
                raise ValueError("visual document context differs from original PDF")
        elif "documentContext" in source:
            raise ValueError("legacy visual artifact unexpectedly has document context")
        dimensions = {page: (float(document[page - 1].rect.width),
                             float(document[page - 1].rect.height)) for page in pages}

    proposed: dict[int, list[tuple[float, float, float, float]]] = {page: [] for page in pages}
    last_page = 0
    for index, proposal in enumerate(source["proposals"]):
        if not isinstance(proposal, dict):
            raise ValueError(f"proposal {index} is not an object")
        page = proposal.get("pageNumber")
        if (type(page) is not int or page not in scanned or page < last_page
                or proposal.get("status") != "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"):
            raise ValueError(f"proposal {index} has invalid page, order or status")
        last_page = page
        normalized = rectangle(proposal.get("bboxNormalized"), f"proposal {index}", 1, 1)
        if page in proposed:
            width, height = dimensions[page]
            proposed[page].append((normalized[0] * width, normalized[1] * height,
                                   normalized[2] * width, normalized[3] * height))

    labels: dict[tuple[int, str], dict[str, Any]] = {}
    allowed = {(page, name) for page in pages for name in classes}
    review_keys = {
        "schema_version", "file_id", "source_sha256", "object_id", "page_number",
        "class_id", "coverage", "review_status", "reviewer_id", "annotation_origin",
        "created_without_proposals", "coordinate_system", "page_display_size_pt", "instances",
    }
    for row in reviews:
        if (row.get("schema_version") != "visual-full-sheet-review-v1"
                or row.get("file_id") != file_id or row.get("source_sha256") != entry["sha256"]
                or row.get("object_id") != entry["object_id"]):
            raise ValueError("review source identity or schema is invalid")
        key = (row.get("page_number"), row.get("class_id"))
        if (type(key[0]) is not int or not isinstance(key[1], str)
                or key not in allowed or key in labels):
            raise ValueError("review page/class outside selected set or duplicated")
        if set(row) != review_keys:
            raise ValueError("review has unexpected or proposal-derived fields")
        labels[key] = row

    missing = []
    for page, name in sorted(allowed):
        row = labels.get((page, name))
        if (row is None or row.get("review_status") != "HUMAN_APPROVED"
                or row.get("coverage") != "FULL_SHEET"
                or row.get("annotation_origin") != "INDEPENDENT_OF_PROPOSALS"
                or row.get("created_without_proposals") is not True
                or not isinstance(row.get("reviewer_id"), str) or not row["reviewer_id"].strip()):
            missing.append({"page_number": page, "class_id": name})
    common = {
        "schema_version": "visual-proposal-evaluation-v1",
        "file_id": file_id,
        "source_sha256": entry["sha256"],
        "source_object_id": entry["object_id"],
        "inspector_object_id": artifact["objectId"],
        "source_file_id_in_artifact": source["sourceFileId"],
        "visual_analysis_schema": version,
        "selected_pages": pages,
        "selected_classes": classes,
        "scanned_page_count": len(scanned),
        "other_scanned_pages_not_evaluated": len(scanned) - len(pages),
        "skipped_page_count": entry["pdf_pages"] - len(scanned),
        "minimum_iou": minimum_iou,
        "manifest_sha256": manifest_sha256,
        "artifact_file_sha256": artifact_sha256,
        "artifact_content_hash_claim": artifact.get("contentHash"),
        "reviews_sha256": reviews_sha256,
        "recognition_metrics": None,
        "vlm_decisions_not_recognition_metrics": vlm_decisions,
        "release_gate": "NOT_ASSESSED",
        "independence": "HUMAN_ATTESTED_NOT_EXTERNALLY_AUTHENTICATED",
    }
    if missing:
        return {**common, "status": "NOT_ESTIMABLE", "reason_code": "FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING",
                "missing_page_classes": missing, "metrics": None}

    by_class: dict[str, dict[str, Any]] = {}
    for name in classes:
        tp = fp = fn = 0
        page_results = []
        for page in pages:
            row = labels[(page, name)]
            if row.get("coordinate_system") != "DISPLAY_POINT_TOP_LEFT":
                raise ValueError("review coordinate convention is ambiguous")
            size = row.get("page_display_size_pt")
            width, height = dimensions[page]
            if (not isinstance(size, list) or len(size) != 2
                    or any(type(item) not in (int, float) or not math.isfinite(item) for item in size)
                    or abs(size[0] - width) > 0.01 or abs(size[1] - height) > 0.01):
                raise ValueError("review display size disagrees with original PDF")
            instances = row.get("instances")
            if not isinstance(instances, list):
                raise ValueError("full-sheet review needs instances array; [] is reviewed absence")
            seen_ids: set[str] = set()
            truth = []
            for instance in instances:
                if (not isinstance(instance, dict)
                        or set(instance) != {"instance_id", "bbox_display_pt"}
                        or not isinstance(instance.get("instance_id"), str)
                        or not instance["instance_id"].strip()
                        or instance["instance_id"] in seen_ids):
                    raise ValueError("review instance ID missing or duplicated")
                seen_ids.add(instance["instance_id"])
                truth.append(rectangle(instance.get("bbox_display_pt"),
                                       f"review instance {instance['instance_id']}", width, height))
            pairs = matches(proposed[page], truth, minimum_iou)
            page_tp = len(pairs)
            page_fp = len(proposed[page]) - page_tp
            page_fn = len(truth) - page_tp
            tp += page_tp
            fp += page_fp
            fn += page_fn
            page_results.append({"page_number": page, "proposal_count": len(proposed[page]),
                                 "ground_truth_count": len(truth), "true_positive": page_tp,
                                 "false_positive": page_fp, "false_negative": page_fn,
                                 "matches": [{"proposal_index_on_page": pi,
                                              "instance_id": instances[ti]["instance_id"],
                                              "iou": round(iou(proposed[page][pi], truth[ti]), 6)}
                                             for pi, ti in pairs]})
        by_class[name] = {
            "true_positive": tp, "false_positive": fp, "false_negative": fn,
            "class_conditioned_proposal_precision": tp / (tp + fp) if tp + fp else None,
            "proposal_localization_recall": tp / (tp + fn) if tp + fn else None,
            "pages": page_results,
        }
    return {**common, "status": "MEASURED", "reason_code": None,
            "missing_page_classes": [], "metrics": by_class}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--visual-artifact", type=Path, required=True,
                        help="JSON response from authenticated /api/checks/:id/visual-proposals")
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--file-id", required=True, help="public document_manifest.jsonl file_id")
    parser.add_argument("--reviews", type=Path, required=True, help="independent full-sheet human JSONL")
    parser.add_argument("--page", type=int, action="append", required=True)
    parser.add_argument("--class", dest="classes", action="append", required=True)
    parser.add_argument("--minimum-iou", type=float, default=0.5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest_content = args.manifest.read_bytes()
    artifact_content = args.visual_artifact.read_bytes()
    reviews_content = args.reviews.read_bytes()
    report = evaluate(
        parse_jsonl(manifest_content, args.manifest), json.loads(artifact_content),
        parse_jsonl(reviews_content, args.reviews), args.source_pdf, args.file_id,
        args.page, args.classes, args.minimum_iou,
        manifest_sha256=hashlib.sha256(manifest_content).hexdigest(),
        artifact_sha256=hashlib.sha256(artifact_content).hexdigest(),
        reviews_sha256=hashlib.sha256(reviews_content).hexdigest(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "reason_code": report.get("reason_code"),
                      "output": str(args.output)}, ensure_ascii=False))
    return 0 if report["status"] == "MEASURED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
