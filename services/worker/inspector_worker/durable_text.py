"""Read a committed text artifact through the current fenced job lease."""

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

from .parameter_routing import _validate_artifact
from .text_layer import InputDownloadError, MAX_TEXT_ARTIFACT_BYTES


_SHA256 = re.compile(r"[a-f0-9]{64}\Z")


class TextArtifactLeaseLost(RuntimeError):
    """The job no longer owns the attempt used for an artifact read."""


def download_text_artifact(
    lease: dict[str, Any],
    source: dict[str, Any],
    attempt: dict[str, Any],
) -> dict[str, Any]:
    job_id = lease.get("jobId")
    source_id = source.get("sourceFileId")
    source_sha256 = source.get("sha256")
    attempt_id = attempt.get("attemptId")
    fencing_token = attempt.get("fencingToken")
    if not isinstance(job_id, str) or not job_id:
        raise ValueError("text artifact lease has no jobId")
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("text artifact source has no sourceFileId")
    if not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None:
        raise ValueError("text artifact source has no valid sha256")
    if not isinstance(attempt_id, str) or not attempt_id or type(fencing_token) is not int or fencing_token < 1:
        raise ValueError("text artifact attempt is invalid")

    api_url = urllib.parse.urlsplit(os.environ["INSPECTOR_API_INTERNAL_URL"])
    if api_url.scheme not in {"http", "https"} or not api_url.netloc:
        raise ValueError("INSPECTOR_API_INTERNAL_URL is invalid")
    path = "/api/internal/v1/jobs/{}/text-artifacts/{}".format(
        urllib.parse.quote(job_id, safe=""), urllib.parse.quote(source_id, safe=""),
    )
    query = urllib.parse.urlencode({"attemptId": attempt_id, "fencingToken": fencing_token})
    url = f"{api_url.scheme}://{api_url.netloc}{path}?{query}"
    request = urllib.request.Request(
        url,
        headers={"X-Worker-Token": os.environ["INTERNAL_WORKER_TOKEN"]},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content_length = response.headers.get("Content-Length")
            content_hash = response.headers.get("X-Content-SHA256")
            input_hash = response.headers.get("X-Input-SHA256")
            schema_version = response.headers.get("X-Artifact-Schema-Version")
            if (content_length is None or not content_length.isdecimal()
                    or not 0 < int(content_length) <= MAX_TEXT_ARTIFACT_BYTES):
                raise InputDownloadError("text artifact has an invalid Content-Length")
            if content_hash is None or _SHA256.fullmatch(content_hash) is None:
                raise InputDownloadError("text artifact has no valid content hash header")
            if input_hash != source_sha256:
                raise InputDownloadError("text artifact input hash differs from manifest")
            if schema_version != "document-text-v2":
                raise InputDownloadError("text artifact schema version is not supported")
            body = response.read(MAX_TEXT_ARTIFACT_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 409:
            raise TextArtifactLeaseLost("text artifact attempt is stale or terminal") from error
        raise InputDownloadError(f"text artifact returned HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as error:
        raise InputDownloadError(f"text artifact unavailable: {error}") from error

    if len(body) != int(content_length) or hashlib.sha256(body).hexdigest() != content_hash:
        raise InputDownloadError("text artifact bytes do not match committed hash and size")
    try:
        artifact = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InputDownloadError("text artifact is not valid UTF-8 JSON") from error
    if not isinstance(artifact, dict):
        raise InputDownloadError("text artifact JSON is not an object")
    try:
        _validate_artifact(artifact, {"sourceFileId": source_id, "sha256": source_sha256})
    except ValueError as error:
        raise InputDownloadError(f"text artifact failed schema validation: {error}") from error
    return artifact
