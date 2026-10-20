"""Release-gated, proposal-only drawing scan for durable ENTITY_EXTRACTION."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .text_layer import _download_source, _source_metadata
from .vector_proposals import scan_pdf
from .visual_vlm import (CROP_MAX_EDGE_PX, DISPLAY_CROP_METHOD_ID, MAX_OBSERVATIONS, METHOD_ID,
                         MODEL_ID, MODEL_WEIGHTS_SHA256, MODEL_PROJECTOR_SHA256,
                         PROMPT_SHA256, SERVER_METHOD_ID, SERVER_MODEL_ID, SERVER_MODEL_REVISION,
                         SERVER_MODEL_LOCK_SHA256, SERVER_MODEL_SHARDS, observe_proposals)


PROFILE_V1 = {
    "schemaVersion": "visual-proposal-profile-v1",
    "methodId": "red-vector-panel-blue-contact-v1",
    "maxPagesPerSource": 64,
    "maxProposalsPerSource": 500,
    "coordinateSystem": "NORMALIZED_TOP_LEFT",
}
PROFILE_V2 = {**PROFILE_V1, "schemaVersion": "visual-proposal-profile-v2"}
PROFILE_V3 = {**PROFILE_V2, "schemaVersion": "visual-proposal-profile-v3", "maxPagesPerSource": 1024}
PROFILE_V4 = {**PROFILE_V3, "schemaVersion": "visual-proposal-profile-v4",
              "contextMethodId": "first-two-pdf-cover-text-pages-v1", "maxContextPages": 2}
PROFILE_V5 = {**PROFILE_V4, "schemaVersion": "visual-proposal-profile-v5",
              "vlmMethodId": METHOD_ID, "vlmModelId": MODEL_ID,
              "vlmModelWeightsSha256": MODEL_WEIGHTS_SHA256,
              "vlmModelProjectorSha256": MODEL_PROJECTOR_SHA256,
              "vlmPromptSha256": PROMPT_SHA256,
              "maxVlmObservationsPerSource": MAX_OBSERVATIONS,
              "vlmCropMaxEdgePx": CROP_MAX_EDGE_PX}
PROFILE_V6 = {**PROFILE_V4, "schemaVersion": "visual-proposal-profile-v6",
              "vlmMethodId": SERVER_METHOD_ID, "vlmModelId": SERVER_MODEL_ID,
              "vlmModelRevision": SERVER_MODEL_REVISION,
              "vlmModelLockSha256": SERVER_MODEL_LOCK_SHA256,
              "vlmModelShards": SERVER_MODEL_SHARDS,
              "vlmPromptSha256": PROMPT_SHA256,
              "maxVlmObservationsPerSource": MAX_OBSERVATIONS,
              "vlmCropMaxEdgePx": CROP_MAX_EDGE_PX}
PROFILE_V7_SAMPLE = {**PROFILE_V5, "schemaVersion": "visual-proposal-profile-v7",
    "contextMethodId": "metadata-outline-page-signals-v2", "maxContextPages": 10000,
    "analysisMode": "SAMPLE", "vlmCropMaxEdgePx": 2048}
PROFILE_V7_FULL = {**PROFILE_V7_SAMPLE, "analysisMode": "FULL", "vlmMethodId": "all-saved-proposals-v1",
    "maxPagesPerSource": 10000, "maxProposalsPerSource": 100000,
    "maxVlmObservationsPerSource": 100000}
PROFILE_V8_SAMPLE = {**PROFILE_V7_SAMPLE, "schemaVersion": "visual-proposal-profile-v8",
    "vlmCropMethodId": DISPLAY_CROP_METHOD_ID}
PROFILE_V8_FULL = {**PROFILE_V7_FULL, "schemaVersion": "visual-proposal-profile-v8",
    "vlmCropMethodId": DISPLAY_CROP_METHOD_ID}
# Server model/provenance are immutable V6 pins; expanded scope and displayed
# crops have their own release rather than changing any V1-V8 contract.
PROFILE_V9_SAMPLE = {**PROFILE_V6, "schemaVersion": "visual-proposal-profile-v9",
    "contextMethodId": "metadata-outline-page-signals-v2", "maxContextPages": 10000,
    "analysisMode": "SAMPLE", "vlmCropMaxEdgePx": 2048,
    "vlmCropMethodId": DISPLAY_CROP_METHOD_ID}
PROFILE_V9_FULL = {**PROFILE_V9_SAMPLE, "analysisMode": "FULL",
    "vlmMethodId": "all-saved-proposals-server-nonnegative-v1",
    "maxPagesPerSource": 10000, "maxProposalsPerSource": 100000,
    "maxVlmObservationsPerSource": 100000}
PROFILE_ID_V9_SAMPLE = "red-vector-proposals-v9-sample"
PROFILE_ID_V9_FULL = "red-vector-proposals-v9-full"
PROFILE_ID_V8_SAMPLE = "red-vector-proposals-v8-sample"
PROFILE_ID_V8_FULL = "red-vector-proposals-v8-full"
PROFILE_ID_V7_SAMPLE = "red-vector-proposals-v7-sample"
PROFILE_ID_V7_FULL = "red-vector-proposals-v7-full"
PROFILE_ID_V1 = "red-vector-proposals-v1"
PROFILE_ID_V2 = "red-vector-proposals-v2"
PROFILE_ID_V3 = "red-vector-proposals-v3"
PROFILE_ID_V4 = "red-vector-proposals-v4"
PROFILE_ID_V5 = "red-vector-proposals-v5"
PROFILE_ID_V6 = "red-vector-proposals-v6"


def _profile_hash(profile: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


PROFILE_HASH_V1 = _profile_hash(PROFILE_V1)
PROFILE_HASH_V2 = _profile_hash(PROFILE_V2)
PROFILE_HASH_V3 = _profile_hash(PROFILE_V3)
PROFILE_HASH_V4 = _profile_hash(PROFILE_V4)
PROFILE_HASH_V5 = _profile_hash(PROFILE_V5)
PROFILE_HASH_V6 = _profile_hash(PROFILE_V6)
PROFILE_HASH_V7_SAMPLE = _profile_hash(PROFILE_V7_SAMPLE)
PROFILE_HASH_V7_FULL = _profile_hash(PROFILE_V7_FULL)
PROFILE_HASH_V8_SAMPLE = _profile_hash(PROFILE_V8_SAMPLE)
PROFILE_HASH_V8_FULL = _profile_hash(PROFILE_V8_FULL)
PROFILE_HASH_V9_SAMPLE = _profile_hash(PROFILE_V9_SAMPLE)
PROFILE_HASH_V9_FULL = _profile_hash(PROFILE_V9_FULL)
PROFILE = PROFILE_V4
PROFILE_ID = PROFILE_ID_V4
PROFILE_HASH = PROFILE_HASH_V4

_PROFILES = {
    PROFILE_ID_V9_SAMPLE: (PROFILE_V9_SAMPLE, PROFILE_HASH_V9_SAMPLE, "9", "v9"),
    PROFILE_ID_V9_FULL: (PROFILE_V9_FULL, PROFILE_HASH_V9_FULL, "9", "v9"),
    PROFILE_ID_V8_SAMPLE: (PROFILE_V8_SAMPLE, PROFILE_HASH_V8_SAMPLE, "8", "v8"),
    PROFILE_ID_V8_FULL: (PROFILE_V8_FULL, PROFILE_HASH_V8_FULL, "8", "v8"),
    PROFILE_ID_V7_SAMPLE: (PROFILE_V7_SAMPLE, PROFILE_HASH_V7_SAMPLE, "7", "v7"),
    PROFILE_ID_V7_FULL: (PROFILE_V7_FULL, PROFILE_HASH_V7_FULL, "7", "v7"),
    PROFILE_ID_V1: (PROFILE_V1, PROFILE_HASH_V1, "1", "v1"),
    PROFILE_ID_V2: (PROFILE_V2, PROFILE_HASH_V2, "2", "v2"),
    PROFILE_ID_V3: (PROFILE_V3, PROFILE_HASH_V3, "3", "v3"),
    PROFILE_ID_V4: (PROFILE_V4, PROFILE_HASH_V4, "4", "v4"),
    PROFILE_ID_V5: (PROFILE_V5, PROFILE_HASH_V5, "5", "v5"),
    PROFILE_ID_V6: (PROFILE_V6, PROFILE_HASH_V6, "6", "v6"),
}


class VisualProposalAdapter:
    job_type = "ENTITY_EXTRACTION"
    provider_kind = "ENTITY_EXTRACTION_MODEL"

    def execute(self, lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
        release = lease.get("release")
        if not isinstance(release, dict) or release.get("lifecycle") != "DRAFT":
            raise ValueError("visual proposal scan requires a DRAFT release")
        slot = release.get("providerSlot")
        requested_profile_id = slot.get("profileId") if isinstance(slot, dict) else None
        profile = _PROFILES.get(requested_profile_id) if isinstance(requested_profile_id, str) else None
        if (not isinstance(slot, dict) or slot.get("stageJobType") != self.job_type
                or slot.get("providerKind") != self.provider_kind
                or slot.get("status") != "CONFIGURED"
                or profile is None
                or slot.get("adapterVersion") != profile[2]
                or slot.get("configHash") != profile[1]):
            raise ValueError("visual proposal provider slot does not match immutable release")
        selected_profile, profile_hash, _, profile_version = profile
        profile_id = slot["profileId"]
        manifest_hash = lease.get("inputManifestHash")
        object_id = lease.get("objectId")
        if not isinstance(manifest_hash, str) or re.fullmatch(r"[a-f0-9]{64}", manifest_hash) is None:
            raise ValueError("visual proposal lease has no immutable manifest hash")
        if not isinstance(object_id, str) or not object_id:
            raise ValueError("visual proposal lease has no objectId")
        inputs = lease.get("inputs")
        if not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list):
            raise ValueError("visual proposal lease has no sourceFiles")

        sources = []
        seen: set[str] = set()
        for raw_source in inputs["sourceFiles"]:
            source_id, source_sha256, byte_size, media_type, download_path = _source_metadata(raw_source)
            if source_id in seen:
                raise ValueError("visual proposal lease contains duplicate sourceFileId")
            seen.add(source_id)
            if media_type == "application/pdf":
                sources.append((source_id, source_sha256, byte_size, download_path))
        sources.sort(key=lambda item: item[0])

        scanned = []
        progress = {"mode": selected_profile.get("analysisMode", "SAMPLE"), "documentCount": len(sources),
            "completedDocuments": 0, "scannedPages": 0, "skippedPages": 0,
            "eligible": 0, "selected": 0, "processed": 0, "failed": 0}
        with tempfile.TemporaryDirectory(prefix="inspector-visual-proposals-") as directory:
            for index, (source_id, source_sha256, byte_size, download_path) in enumerate(sources):
                path = Path(directory) / f"source-{index}.pdf"
                _download_source(download_path, path, source_sha256, byte_size, attempt)
                source_result = scan_pdf(
                    path, source_id, source_sha256,
                    max_pages=selected_profile["maxPagesPerSource"],
                    max_proposals=selected_profile["maxProposalsPerSource"],
                    profile_version="v7" if profile_version in {"v8", "v9"} else profile_version,
                )
                if profile_version in {"v7", "v8", "v9"}:
                    if selected_profile["analysisMode"] == "FULL" and (source_result.get("skippedPageCount", 0)
                            or source_result["unretainedProposalCount"]):
                        raise ValueError("FULL_ANALYSIS_LIMIT_EXCEEDED: no partial result accepted; split PDF into smaller sources")
                    count = len(source_result["proposals"])
                    progress["scannedPages"] += source_result["scannedPageCount"]
                    progress["skippedPages"] += source_result.get("skippedPageCount", 0)
                    progress["eligible"] += count + source_result["unretainedProposalCount"]
                    progress["selected"] += count if selected_profile["analysisMode"] == "FULL" else min(2, count)
                    before_processed, before_failed = progress["processed"], progress["failed"]
                    attempt["visualProgress"] = dict(progress)
                    def report(processed, failed):
                        progress["processed"] = before_processed + processed
                        progress["failed"] = before_failed + failed
                        attempt["visualProgress"] = dict(progress)
                if profile_version in {"v5", "v6", "v7", "v8", "v9"}:
                    source_result["vlm"] = observe_proposals(
                        path, source_result, os.environ.get("VISUAL_VLM_BASE_URL"),
                        "v6" if profile_version == "v9" else "v5" if profile_version in {"v7", "v8"} else profile_version,
                        **({"mode": selected_profile["analysisMode"], "max_edge": 2048, "progress": report,
                            "cache_namespace": profile_hash} if profile_version in {"v7", "v8", "v9"} else {}),
                        **({"crop_method_id": selected_profile["vlmCropMethodId"]} if profile_version in {"v8", "v9"} else {}),
                    )
                    if profile_version == "v9":
                        source_result["vlm"]["methodId"] = selected_profile["vlmMethodId"]
                progress["completedDocuments"] += 1
                if profile_version in {"v7", "v8", "v9"}: attempt["visualProgress"] = dict(progress)
                scanned.append(source_result)
                path.unlink()

        result = {
            "schemaVersion": "analysis-stage-result-v2",
            "jobType": self.job_type,
            "inputManifestHash": manifest_hash,
            "disposition": "VISUAL_PROPOSAL_SCAN",
            "reasonCode": "PROPOSAL_ONLY_UNVERIFIED",
            "providerKind": self.provider_kind,
            "providerProfileId": profile_id,
            "providerConfigHash": profile_hash,
            "outputCount": sum(len(item["proposals"]) for item in scanned),
            "analysis": {
                "schemaVersion": f"visual-proposal-analysis-{profile_version}",
                "objectId": object_id,
                "inputManifestHash": manifest_hash,
                "profile": selected_profile,
                "sources": scanned,
            },
        }
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 6 * 1024 * 1024:
            raise ValueError("visual proposal stage result exceeds 6 MiB")
        return result
