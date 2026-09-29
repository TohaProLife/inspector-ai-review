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
from .visual_vlm import (CROP_MAX_EDGE_PX, MAX_OBSERVATIONS, METHOD_ID,
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
PROFILE = PROFILE_V4
PROFILE_ID = PROFILE_ID_V4
PROFILE_HASH = PROFILE_HASH_V4

_PROFILES = {
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
        with tempfile.TemporaryDirectory(prefix="inspector-visual-proposals-") as directory:
            for index, (source_id, source_sha256, byte_size, download_path) in enumerate(sources):
                path = Path(directory) / f"source-{index}.pdf"
                _download_source(download_path, path, source_sha256, byte_size, attempt)
                source_result = scan_pdf(
                    path, source_id, source_sha256,
                    max_pages=selected_profile["maxPagesPerSource"],
                    max_proposals=selected_profile["maxProposalsPerSource"],
                    profile_version=profile_version,
                )
                if profile_version in {"v5", "v6"}:
                    source_result["vlm"] = observe_proposals(
                        path, source_result, os.environ.get("VISUAL_VLM_BASE_URL"), profile_version,
                    )
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
