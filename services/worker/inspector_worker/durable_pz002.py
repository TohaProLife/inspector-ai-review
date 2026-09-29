"""Run PZ-002 on committed NORMAL-run inputs; never load public labels."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .analysis_pilot import analyze_pz002_bundle
from .durable_ocr_cache import cached_durable_ocr_page
from .durable_text import download_text_artifact
from .ocr_pilot import recognize_pdf_page
from .text_layer import _download_source


_SHA256 = re.compile(r"[a-f0-9]{64}\Z")


def _reviewed_source(source: dict[str, Any], decision: object) -> dict[str, Any]:
    if decision is None:
        return {
            "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
            "linkGroupId": None, "pageStages": {},
        }
    if not isinstance(decision, dict) or decision.get("sourceSha256") != source["sha256"]:
        raise ValueError("source decision does not match immutable manifest SHA-256")
    revision = decision.get("revisionStatus", "UNKNOWN")
    approval = decision.get("approvalStatus", "UNKNOWN")
    link_group = decision.get("linkGroupId")
    page_stages = decision.get("pageStages", {})
    if revision not in {"CURRENT", "SUPERSEDED", "UNKNOWN"}:
        raise ValueError("source revision decision is invalid")
    if approval not in {"APPROVED", "UNAPPROVED", "UNKNOWN"}:
        raise ValueError("source approval decision is invalid")
    if link_group is not None and (not isinstance(link_group, str) or not link_group.strip()):
        raise ValueError("source link decision is invalid")
    if not isinstance(page_stages, dict):
        raise ValueError("source pageStages decision is invalid")
    if revision != "UNKNOWN" or approval != "UNKNOWN" or link_group is not None or page_stages:
        basis = decision.get("basis")
        if (not isinstance(basis, dict) or not isinstance(basis.get("reference"), str)
                or not basis["reference"].strip()):
            raise ValueError("reviewed source decision requires a reference")
    return {
        "revisionStatus": revision, "approvalStatus": approval,
        "linkGroupId": link_group, "pageStages": page_stages,
    }


def execute_durable_pz002(
    lease: dict[str, Any],
    attempt: dict[str, Any],
    navigation_rule: dict[str, Any],
    numeric_rule: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate committed source bytes. Unknown source decisions force abstention."""
    manifest_hash = lease.get("inputManifestHash")
    object_id = lease.get("objectId")
    raw_inputs = lease.get("inputs")
    if not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None:
        raise ValueError("durable PZ-002 lease has no inputManifestHash")
    if not isinstance(object_id, str) or not object_id:
        raise ValueError("durable PZ-002 lease has no objectId")
    if not isinstance(raw_inputs, dict) or not isinstance(raw_inputs.get("sourceFiles"), list):
        raise ValueError("durable PZ-002 lease has no sourceFiles")
    raw_decisions = raw_inputs.get("sourceDecisions", {})
    if not isinstance(raw_decisions, dict):
        raise ValueError("durable PZ-002 sourceDecisions must be an object")
    if set(raw_decisions) - {source.get("sourceFileId") for source in raw_inputs["sourceFiles"]
                             if isinstance(source, dict)}:
        raise ValueError("durable PZ-002 sourceDecisions contain an unknown source")

    sources: list[dict[str, Any]] = []
    text_artifacts: list[dict[str, Any]] = []
    source_index: dict[str, dict[str, Any]] = {}
    for raw_source in raw_inputs["sourceFiles"]:
        if not isinstance(raw_source, dict):
            raise ValueError("durable PZ-002 source is not an object")
        source_id = raw_source.get("sourceFileId")
        source_hash = raw_source.get("sha256")
        stages = raw_source.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in source_index
                or not isinstance(source_hash, str) or _SHA256.fullmatch(source_hash) is None
                or not isinstance(stages, list) or not stages
                or any(stage not in {"PD", "RD", "ID"} for stage in stages)):
            raise ValueError("durable PZ-002 source metadata is invalid")
        source_index[source_id] = raw_source
        sources.append({
            "sourceFileId": source_id, "sha256": source_hash, "objectId": object_id,
            "stages": stages, "sectionCode": raw_source.get("sectionCode"),
            **_reviewed_source(raw_source, raw_decisions.get(source_id)),
        })
        if raw_source.get("mediaType") == "application/pdf":
            text_artifacts.append(download_text_artifact(lease, raw_source, attempt))

    try:
        max_ocr_pages = int(os.environ.get("PZ002_MAX_OCR_PAGES", "2"))
    except ValueError as error:
        raise ValueError("PZ002_MAX_OCR_PAGES must be a non-negative integer") from error
    if max_ocr_pages < 0:
        raise ValueError("PZ002_MAX_OCR_PAGES must be a non-negative integer")
    try:
        max_table_pages = int(os.environ.get("PZ002_MAX_TABLE_PAGES", "8"))
    except ValueError as error:
        raise ValueError("PZ002_MAX_TABLE_PAGES must be a non-negative integer") from error
    if max_table_pages < 0:
        raise ValueError("PZ002_MAX_TABLE_PAGES must be a non-negative integer")
    try:
        max_table_ocr_pages = int(os.environ.get("PZ002_MAX_TABLE_OCR_PAGES", "2"))
    except ValueError as error:
        raise ValueError("PZ002_MAX_TABLE_OCR_PAGES must be a non-negative integer") from error
    if max_table_ocr_pages < 0:
        raise ValueError("PZ002_MAX_TABLE_OCR_PAGES must be a non-negative integer")
    document_ai_url = os.environ.get("DOCUMENT_PROVIDER_BASE_URL") or None
    with tempfile.TemporaryDirectory(prefix="inspector-pz002-") as directory:
        downloaded: dict[str, Path] = {}

        def source_path_for_ocr(source_id: str) -> Path:
            if source_id in downloaded:
                return downloaded[source_id]
            source = source_index[source_id]
            download_path = source.get("downloadPath")
            byte_size = source.get("byteSize")
            if (not isinstance(download_path, str) or not download_path.startswith("/api/internal/v1/jobs/")
                    or type(byte_size) is not int or byte_size < 1):
                raise ValueError("OCR source download metadata is invalid")
            path = Path(directory) / f"source-{len(downloaded)}.pdf"
            _download_source(download_path, path, source["sha256"], byte_size, attempt)
            downloaded[source_id] = path
            return path

        def recognize_page(source_id: str, page_number: int, page_count: int,
                           base_url: str) -> dict[str, Any]:
            source = source_index[source_id]
            path = source_path_for_ocr(source_id)

            def recognize() -> dict[str, Any]:
                return recognize_pdf_page(path, source_id, source["sha256"],
                                          page_number, page_count, base_url=base_url)

            cache_root = os.environ.get("INSPECTOR_DURABLE_OCR_CACHE_ROOT")
            provider_profile = os.environ.get("OCR_LAYOUT_PROFILE_ID")
            if cache_root and provider_profile:
                artifact, _cache_status = cached_durable_ocr_page(
                    cache_root=Path(cache_root), source_path=path,
                    source_file_id=source_id, source_sha256=source["sha256"],
                    page_number=page_number, page_count=page_count,
                    dpi=120, script="eslav",
                    renderer_profile_id="renderer-pdfium-5.12.1-linux-x86_64-v1",
                    provider_profile_id=provider_profile, recognize=recognize,
                )
                return artifact
            return recognize()

        return analyze_pz002_bundle(
            {
                "objectId": object_id,
                "selectedManifestHash": manifest_hash,
                "selectedFileIds": sorted(source_index),
                "sources": sources,
                "textArtifacts": text_artifacts,
            },
            navigation_rule, numeric_rule,
            document_ai_url=document_ai_url,
            max_ocr_pages=max_ocr_pages,
            max_table_pages=max_table_pages,
            max_table_ocr_pages=max_table_ocr_pages,
            source_path_for_ocr=source_path_for_ocr,
            recognize_page=recognize_page,
        )
