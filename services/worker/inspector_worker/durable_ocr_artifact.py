"""Fetch a committed bounded OCR stage through its current rule-job lease."""

from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .durable_ocr_layout import (PROFILE_HASH_V3, PROFILE_ID_V3, PROFILE_V3,
                                 PROFILE_HASH_V4, PROFILE_ID_V4, PROFILE_V4,
                                 PROFILE_HASH_V5, PROFILE_ID_V5, PROFILE_V5,
                                 PROFILE_HASH_V6, PROFILE_ID_V6, PROFILE_V6)
from .text_layer import InputDownloadError


MAX_OCR_STAGE_BYTES = 8 * 1024 * 1024
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_LOCAL_API_HOSTS = {"api", "127.0.0.1", "localhost", "host.docker.internal"}
_V6_RULE_PROFILE = "typed-pz002-pz017-ocr-v6-unresolved-family-review-v1"


class OcrArtifactLeaseLost(RuntimeError):
    """The rule job no longer owns the attempt used for the OCR stage read."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def _reject_non_json_constant(value: str) -> None:
    raise ValueError(f"non-JSON numeric constant {value}")


def download_ocr_layout_artifact(
    lease: dict[str, Any], attempt: dict[str, Any],
) -> dict[str, Any]:
    """Return a verified persisted-stage envelope, never a promoted OCR fact."""
    job_id = lease.get("jobId")
    manifest_hash = lease.get("inputManifestHash")
    object_id = lease.get("objectId")
    attempt_id = attempt.get("attemptId")
    fencing_token = attempt.get("fencingToken")
    if lease.get("jobType") != "RULE_EVALUATION" or not isinstance(job_id, str) or not job_id:
        raise ValueError("OCR artifact requires a rule job lease with jobId")
    if not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None:
        raise ValueError("OCR artifact lease has no immutable manifest hash")
    if not isinstance(object_id, str) or not object_id:
        raise ValueError("OCR artifact lease has no objectId")
    if not isinstance(attempt_id, str) or not attempt_id or type(fencing_token) is not int or fencing_token < 1:
        raise ValueError("OCR artifact attempt is invalid")
    token = os.environ.get("INTERNAL_WORKER_TOKEN")
    if not token:
        raise ValueError("INTERNAL_WORKER_TOKEN is required")
    api_url = urllib.parse.urlsplit(os.environ["INSPECTOR_API_INTERNAL_URL"])
    if (api_url.scheme != "http" or api_url.hostname not in _LOCAL_API_HOSTS
            or api_url.username or api_url.password or api_url.path.rstrip("/") != "/api/internal/v1"
            or api_url.query or api_url.fragment):
        raise ValueError("INSPECTOR_API_INTERNAL_URL must be a local worker API")
    path = "/api/internal/v1/jobs/{}/ocr-layout-artifact".format(urllib.parse.quote(job_id, safe=""))
    query = urllib.parse.urlencode({"attemptId": attempt_id, "fencingToken": fencing_token})
    url = f"{api_url.scheme}://{api_url.netloc}{path}?{query}"
    request = urllib.request.Request(url, headers={"X-Worker-Token": token}, method="GET")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            content_length = response.headers.get("Content-Length")
            content_hash = response.headers.get("X-Content-SHA256")
            input_hash = response.headers.get("X-Input-Manifest-SHA256")
            schema_version = response.headers.get("X-Artifact-Schema-Version")
            profile_id = response.headers.get("X-Provider-Profile-Id")
            config_hash = response.headers.get("X-Provider-Config-SHA256")
            if content_length is None or not content_length.isdecimal() or not 0 < int(content_length) <= MAX_OCR_STAGE_BYTES:
                raise InputDownloadError("OCR artifact has an invalid Content-Length")
            if content_hash is None or _SHA256.fullmatch(content_hash) is None:
                raise InputDownloadError("OCR artifact has no valid content hash header")
            if input_hash != manifest_hash:
                raise InputDownloadError("OCR artifact manifest hash differs from lease")
            expected = {
                PROFILE_ID_V3: (PROFILE_HASH_V3, PROFILE_V3, "bounded-ocr-layout-analysis-v3"),
                PROFILE_ID_V4: (PROFILE_HASH_V4, PROFILE_V4, "bounded-ocr-layout-analysis-v4"),
                PROFILE_ID_V5: (PROFILE_HASH_V5, PROFILE_V5, "bounded-ocr-layout-analysis-v5"),
                PROFILE_ID_V6: (PROFILE_HASH_V6, PROFILE_V6, "bounded-ocr-layout-analysis-v6"),
            }.get(profile_id)
            if expected is None or config_hash != expected[0] or schema_version != expected[2]:
                raise InputDownloadError("OCR artifact provider profile or schema is not supported")
            if profile_id == PROFILE_ID_V6:
                release = lease.get("release")
                rule_slot = release.get("providerSlot") if isinstance(release, dict) else None
                ocr_slot = release.get("ocrLayoutSlot") if isinstance(release, dict) else None
                if (not isinstance(rule_slot, dict)
                        or rule_slot.get("profileId") != _V6_RULE_PROFILE
                        or not isinstance(ocr_slot, dict)
                        or ocr_slot.get("profileId") != PROFILE_ID_V6
                        or ocr_slot.get("configHash") != PROFILE_HASH_V6):
                    raise InputDownloadError("OCR v6 artifact is outside immutable release selection")
            body = response.read(MAX_OCR_STAGE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 409:
            raise OcrArtifactLeaseLost("OCR artifact attempt is stale or terminal") from error
        raise InputDownloadError(f"OCR artifact returned HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as error:
        raise InputDownloadError(f"OCR artifact unavailable: {error}") from error

    if len(body) != int(content_length) or hashlib.sha256(body).hexdigest() != content_hash:
        raise InputDownloadError("OCR artifact bytes do not match committed hash and size")
    try:
        artifact = json.loads(body.decode("utf-8"), parse_constant=_reject_non_json_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise InputDownloadError("OCR artifact is not valid UTF-8 JSON") from error
    if not isinstance(artifact, dict):
        raise InputDownloadError("OCR artifact JSON is not an object")
    canonical = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if canonical != body:
        raise InputDownloadError("OCR artifact bytes are not canonical JSON")
    analysis = artifact.get("analysis")
    if (artifact.get("schemaVersion") != "analysis-stage-result-v2"
            or artifact.get("jobType") != "DOCUMENT_OCR_LAYOUT"
            or artifact.get("inputManifestHash") != manifest_hash
            or artifact.get("disposition") != "OCR_LAYOUT_BOUNDED"
            or artifact.get("reasonCode") != "BOUNDED_OCR_ONLY"
            or artifact.get("providerKind") != "OCR_LAYOUT"
            or artifact.get("providerProfileId") != profile_id
            or artifact.get("providerConfigHash") != config_hash
            or not isinstance(analysis, dict)
            or analysis.get("schemaVersion") != schema_version
            or analysis.get("objectId") != object_id
            or analysis.get("inputManifestHash") != manifest_hash
            or analysis.get("profile") != expected[1]
            or not isinstance(analysis.get("sources"), list)
            or type(analysis.get("processedPageCount")) is not int
            or artifact.get("outputCount") != analysis["processedPageCount"]):
        raise InputDownloadError("OCR artifact stage provenance differs from lease and pinned profile")
    return {
        "content_json": artifact,
        "content_hash": content_hash,
        "byte_size": len(body),
        "provider_profile_id": profile_id,
        "provider_config_hash": config_hash,
        "input_manifest_hash": input_hash,
    }
