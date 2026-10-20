"""Explicit release-pinned source audit; never engineering/OCR execution."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from . import durable_text_v4_full_cache
from .document_text_v4 import (_canonical, _native, _sha, _source_id,
                               extract_pdf_text_artifact_v4_full,
                               get_document_text_v4_extractor_profile,
                               read_document_text_v4_full_artifact)
from .durable_text_v4_full_cache import cached_durable_text_layer_v4_full
from .text_layer import InputDownloadError, _download_source, _source_metadata

PROCESSOR_VERSION = "durable-document-text-v4-full-source-v1"
TRAVERSAL_POLICY_VERSION = "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
_ACCEPTED_TRAVERSALS = (TRAVERSAL_POLICY_VERSION,)
MAX_BYTES = 32000000
SOURCE_AUDIT_PROFILE_VERSION = "SOURCE_AUDIT_V4_FULL_SOURCE_V1"
RESOURCE_POLICY_VERSION = "document-text-v4-full-source-bounds-v1"
_MAX_INTEGER = 9007199254740991


def _release(value: Any) -> dict:
    if type(value) is not dict:
        raise ValueError("INVALID_SOURCE_AUDIT_RELEASE")
    layer = value.get("textLayer")
    _native(layer)
    if type(layer) is not dict or type(layer.get("extractorProfile")) is not dict:
        raise ValueError("SOURCE_AUDIT_RELEASE_PIN_MISMATCH")
    traversal = layer["extractorProfile"].get("traversalPolicyVersion")
    if type(traversal) is not str or traversal not in _ACCEPTED_TRAVERSALS:
        raise ValueError("SOURCE_AUDIT_RELEASE_PIN_MISMATCH")
    expected_profile = get_document_text_v4_extractor_profile(traversal_policy_version=traversal)
    expected = {
        "artifactSchemaVersion": "document-text-v4", "purpose": "SOURCE_AUDIT_ONLY",
        "sourceAuditProfileVersion": SOURCE_AUDIT_PROFILE_VERSION,
        "resourcePolicyVersion": RESOURCE_POLICY_VERSION,
        "extractorProfile": expected_profile,
        "extractorProfileHash": hashlib.sha256(_canonical({
            "hashDomain": "document-text-extractor-profile-v1", "profile": expected_profile}).encode("utf-8")).hexdigest(),
        "processorVersion": PROCESSOR_VERSION,
        "processorSourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "cachePolicyVersion": durable_text_v4_full_cache.CACHE_POLICY_VERSION,
        "cacheSourceSha256": hashlib.sha256(Path(durable_text_v4_full_cache.__file__).read_bytes()).hexdigest(),
    }
    if type(layer) is not dict or set(layer) != set(expected) or layer != expected:
        raise ValueError("SOURCE_AUDIT_RELEASE_PIN_MISMATCH")
    if "externalNetworkAllowed" in value and value["externalNetworkAllowed"] is not False:
        raise ValueError("SOURCE_AUDIT_EXTERNAL_NETWORK_FORBIDDEN")
    if "rules" in value:
        rules = value["rules"]
        _native(rules)
        if (type(rules) is not dict or rules.get("executionStatus") != "UNCONFIGURED"
                or "matrixDefinitions" in rules or "definitions" in rules):
            raise ValueError("SOURCE_AUDIT_RULES_MUST_BE_UNCONFIGURED")
    if "providerSlots" in value:
        slots = value["providerSlots"]
        _native(slots)
        if type(slots) is not list or any(type(slot) is not dict
                or slot.get("status") != "UNCONFIGURED" for slot in slots):
            raise ValueError("SOURCE_AUDIT_PROVIDER_MUST_BE_UNCONFIGURED")
    slot = value.get("providerSlot")
    _native(slot)
    if slot is not None and (type(slot) is not dict or slot.get("status") != "UNCONFIGURED"
            or any(slot.get(key) is not None for key in ("profileId", "configHash", "adapterVersion"))):
        raise ValueError("SOURCE_AUDIT_PROVIDER_MUST_BE_UNCONFIGURED")
    ocr = value.get("ocrLayoutSlot")
    _native(ocr)
    if ocr is not None and (type(ocr) is not dict or set(ocr) != {"profileId", "configHash"}
                            or any(v is not None for v in ocr.values())):
        raise ValueError("SOURCE_AUDIT_OCR_FORBIDDEN")
    return layer


def process_document_text_layer_v4_full(lease: dict, attempt: dict, worker_id: str) -> dict:
    if type(lease) is not dict:
        raise ValueError("INVALID_SOURCE_AUDIT_LEASE")
    release = _release(lease.get("release"))
    _native(attempt)
    if (type(attempt) is not dict or set(attempt) != {"attemptId", "fencingToken"}
            or type(attempt["fencingToken"]) is not int or not 1 <= attempt["fencingToken"] <= _MAX_INTEGER):
        raise ValueError("INVALID_SOURCE_AUDIT_ATTEMPT")
    _source_id(attempt["attemptId"])
    _native(worker_id)
    _source_id(worker_id)
    inputs = lease.get("inputs")
    if type(inputs) is not dict:
        raise ValueError("INVALID_SOURCE_AUDIT_INPUTS")
    source_files = inputs.get("sourceFiles")
    _native(source_files)
    if type(source_files) is not list or not 1 <= len(source_files) <= 64:
        raise ValueError("INVALID_SOURCE_AUDIT_SOURCES")
    prepared = []
    seen = set()
    # Validate ALL metadata before any download, cache or extraction callback.
    for source in source_files:
        metadata = _source_metadata(source)
        source_id, source_hash, byte_size, media_type, download_path = metadata
        _source_id(source_id)
        _sha(source_hash)
        _source_id(media_type)
        if (source_id in seen or type(byte_size) is not int or not 1 <= byte_size <= 67108864
                or type(download_path) is not str or len(download_path) > 2048
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in download_path)
                or "?" in download_path or "#" in download_path):
            raise ValueError("INVALID_SOURCE_AUDIT_SOURCE")
        seen.add(source_id)
        prepared.append(metadata)
    results = []
    with tempfile.TemporaryDirectory(prefix="inspector-source-audit-v4-") as directory:
        for index, (source_id, source_hash, byte_size, media_type, download_path) in enumerate(prepared):
            if media_type != "application/pdf":
                results.append({"sourceFileId": source_id, "inputSha256": source_hash,
                                "status": "SKIPPED_UNSUPPORTED_FORMAT",
                                "reason": f"Unsupported source-audit media type: {media_type}"})
                continue
            destination = Path(directory) / f"source-{index}.pdf"
            for retry, delay in enumerate((0.0, 0.25, 1.0)):
                if delay:
                    time.sleep(delay)
                try:
                    _download_source(download_path, destination, source_hash, byte_size, attempt)
                    break
                except InputDownloadError:
                    if retry == 2:
                        raise
            with destination.open("rb") as stream:
                if (os.fstat(stream.fileno()).st_size != byte_size
                        or hashlib.file_digest(stream, "sha256").hexdigest() != source_hash):
                    raise ValueError("SOURCE_AUDIT_ORIGINAL_BYTES_MISMATCH")

            def extract() -> dict:
                return extract_pdf_text_artifact_v4_full(destination, source_id, source_hash,
                                                   traversal_policy_version=release["extractorProfile"]["traversalPolicyVersion"])

            cache_root = os.environ.get("INSPECTOR_DURABLE_TEXT_CACHE_ROOT")
            if cache_root:
                artifact, _ = cached_durable_text_layer_v4_full(
                    cache_root=Path(cache_root), source_path=destination,
                    source_file_id=source_id, source_sha256=source_hash,
                    extractor_profile=release["extractorProfile"],
                    extractor_profile_hash=release["extractorProfileHash"], extract=extract)
            else:
                artifact = extract()
            if (read_document_text_v4_full_artifact(artifact)["status"] != "VALID"
                    or artifact["sourceFileId"] != source_id or artifact["inputSha256"] != source_hash
                    or artifact["extractorProfile"] != release["extractorProfile"]
                    or artifact["extractorProfileHash"] != release["extractorProfileHash"]):
                raise ValueError("SOURCE_AUDIT_ARTIFACT_MISMATCH")
            results.append({"sourceFileId": source_id, "inputSha256": source_hash,
                            "status": "EXTRACTED", "artifact": artifact})
            if len(_canonical(results).encode("utf-8")) > MAX_BYTES:
                raise ValueError("INPUT_LIMIT")
    result = {"disposition": "DOCUMENT_TEXT_LAYER_COMPLETED", "purpose": "SOURCE_AUDIT_ONLY",
              "resourcePolicyVersion": RESOURCE_POLICY_VERSION,
              "sources": results, "workerId": worker_id}
    durable_text_v4_full_cache._bounded_native(result, "result")
    raw = _canonical(result).encode("utf-8")
    if len(raw) > MAX_BYTES:
        raise ValueError("INPUT_LIMIT")
    return json.loads(raw)


def post_source_audit_v4_full_completion(job_id: str, payload: dict) -> dict:
    """Bounded compact UTF-8 transport dedicated to the explicit large audit."""
    import socket
    import urllib.error
    import urllib.request
    from .main import WorkerControlError

    durable_text_v4_full_cache._bounded_native(payload, "complete")
    _native(job_id)
    _source_id(job_id)
    if (type(payload) is not dict or set(payload) != {"attemptId", "fencingToken", "result"}
            or type(payload["fencingToken"]) is not int
            or not 1 <= payload["fencingToken"] <= _MAX_INTEGER
            or type(payload["result"]) is not dict):
        raise ValueError("INVALID_SOURCE_AUDIT_COMPLETION")
    _source_id(payload["attemptId"])
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(data) > 33554432:
        raise ValueError("INPUT_LIMIT")
    base_url = os.environ["INSPECTOR_API_INTERNAL_URL"].rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/jobs/{job_id}/complete-source-audit-v4-full-source-v1",
        data=data,
        headers={"Content-Type": "application/json", "X-Worker-Token": os.environ["INTERNAL_WORKER_TOKEN"]},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise WorkerControlError("worker API large source audit response exceeds limit")
            result = durable_text_v4_full_cache._parse(raw)
            _native(result)
            if type(result) is not dict:
                raise WorkerControlError("worker API large source audit response is not an object")
            return result
    except urllib.error.HTTPError as error:
        # Do not include server response bodies, request credentials or source text.
        raise WorkerControlError(f"worker API large source audit returned {error.code}") from error
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        raise WorkerControlError("worker API large source audit unavailable") from error
    except (UnicodeError, ValueError) as error:
        raise WorkerControlError("worker API large source audit response invalid") from error
