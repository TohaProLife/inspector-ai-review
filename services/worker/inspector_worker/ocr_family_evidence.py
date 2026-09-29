"""Read-only, addressable OCR evidence for one selected public PDF page.

OCR pixels and lines remain distinct from indexed PDF text. This adapter does
not run OCR, extract engineering facts, establish absence, or produce findings.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence

from .indexed_page_evidence import (
    IndexedPageEvidenceError, IndexedPageNeedsOcr, load_indexed_page_evidence,
)
from .ocr_pilot import canonical_hash
from .public_document_index import _version_hash
from .public_ocr_cache import (
    _MAX_CACHE_BYTES, _cache_request, _load_json, _validate_cache,
    public_manifest_entry,
)


SCHEMA_VERSION = "ocr-page-family-evidence-v1"
MAX_SELECTED_LINES = 128
MAX_SELECTED_TEXT_BYTES = 64 * 1024


class OcrFamilyEvidenceError(ValueError):
    """The selected OCR page cannot safely be supplied to family extractors."""


def _selected_lines(indices: Sequence[int]) -> list[int]:
    if (isinstance(indices, (str, bytes)) or not isinstance(indices, Sequence)
            or not 1 <= len(indices) <= MAX_SELECTED_LINES
            or any(type(index) is not int or index < 0 for index in indices)
            or len(set(indices)) != len(indices)):
        raise OcrFamilyEvidenceError("select 1..128 distinct original OCR line indices")
    return sorted(indices)


def load_ocr_family_evidence(
    manifest_path: Path, index_root: Path, cache_root: Path,
    source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    line_indices: Sequence[int], dpi: int, script: str,
    renderer_profile_id: str, provider_profile_id: str,
) -> dict[str, Any]:
    """Select cached OCR lines after exact public source, index and cache gates.

    No provider call and no disk write. Indexed page must be OCR_REQUIRED.
    Pixel boxes are original image coordinates, never PDF text boxes.
    """
    indices = _selected_lines(line_indices)
    if any(not isinstance(value, str) or not value for value in
           (expected_object_id, expected_stage, expected_section)):
        raise OcrFamilyEvidenceError("expected object, stage and section are required")
    if type(page_number) is not int or page_number < 1:
        raise OcrFamilyEvidenceError("invalid selected page number")

    try:
        manifest_before = manifest_path.read_bytes()
        row = public_manifest_entry(manifest_path, source_id)
        request = _cache_request(row, page_number, dpi, script,
                                 renderer_profile_id, provider_profile_id)
    except (OSError, ValueError) as error:
        raise OcrFamilyEvidenceError("original public PDF manifest or request invalid") from error
    if (row.get("object_id"), row.get("stage"), row.get("section")) != (
            expected_object_id, expected_stage, expected_section):
        raise OcrFamilyEvidenceError("requested object/stage/section differs from public manifest")

    try:
        load_indexed_page_evidence(
            manifest_path, index_root, source_id, page_number,
            expected_object_id=expected_object_id,
            expected_stage=expected_stage, expected_section=expected_section,
            block_indices=[0],
        )
    except IndexedPageNeedsOcr:
        pass
    except (IndexedPageEvidenceError, OSError) as error:
        raise OcrFamilyEvidenceError("selected public index page is not verified OCR_REQUIRED") from error
    else:
        raise OcrFamilyEvidenceError("selected public index page is not OCR_REQUIRED")

    cache_key = canonical_hash(request)
    try:
        root = cache_root.resolve(strict=True)
        parent = root / cache_key[:2] / cache_key[2:4]
        path = parent / f"{cache_key}.json"
        if (not root.is_dir() or parent.is_symlink()
                or (root / cache_key[:2]).is_symlink() or path.is_symlink()
                or not path.is_file() or path.stat().st_size > _MAX_CACHE_BYTES):
            raise OcrFamilyEvidenceError("exact cached OCR page missing or unsafe")
        payload = _load_json(path.read_bytes())
        artifact = _validate_cache(payload, request)
        if manifest_path.read_bytes() != manifest_before:
            raise OcrFamilyEvidenceError("public manifest changed during evidence read")
    except OcrFamilyEvidenceError:
        raise
    except (OSError, ValueError) as error:
        raise OcrFamilyEvidenceError("exact cached OCR page failed integrity validation") from error

    lines = artifact["lines"]
    if indices[-1] >= len(lines):
        raise OcrFamilyEvidenceError("selected OCR line index outside cached page")
    selected = [
        {"lineIndex": index, "text": lines[index]["text"],
         "score": lines[index]["score"], "bboxPx": lines[index]["bboxPx"]}
        for index in indices
    ]
    if sum(len(line["text"].encode("utf-8")) for line in selected) > MAX_SELECTED_TEXT_BYTES:
        raise OcrFamilyEvidenceError("selected OCR text exceeds 64 KiB")
    evidence: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "candidateStatus": "CANDIDATE",
        "evidenceKind": "OCR",
        "interpretation": "REVIEW_REQUIRED_NOT_ABSENCE_PROOF",
        "manifestSha256": hashlib.sha256(manifest_before).hexdigest(),
        "indexVersionHash": _version_hash(),
        "indexDisposition": "OCR_REQUIRED",
        "sourceFileId": source_id,
        "objectId": row["object_id"], "stage": row["stage"], "section": row["section"],
        "sourceSha256": row["sha256"], "sourceRelativePath": row["relative_path"],
        "pageNumber": page_number,
        "cacheKey": cache_key, "cacheContentHash": payload["contentHash"],
        "artifactContentHash": artifact["contentHash"],
        "coordinateSystem": "IMAGE_TOP_LEFT_PIXELS",
        "render": artifact["render"], "provider": artifact["provider"],
        "cachedLineCount": len(lines), "selectedLineIndices": indices, "lines": selected,
    }
    evidence["evidenceSha256"] = hashlib.sha256(json.dumps(
        evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode("utf-8")).hexdigest()
    return evidence
