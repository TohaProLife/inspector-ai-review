"""Pure, source-pinned review of two equipment-specification near misses.

The public pages contain a fire sprinkler pump and a legend for a lift power
board. Neither page establishes the target parameter's equipment fact.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import fitz


SCHEMA_VERSION = "equipment-spec-false-near-v1"
PROFILE_ID = "equipment-spec-false-near-public-review-v1"
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_WORDS = 5000
MAX_RESULT_BYTES = 128 * 1024
_OBJECT = "OBJ-TYUMENSKAYA-5-GOLD-SEED"
_AUDITED = {
    "F0165": {"sha256": "f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64",
              "size_bytes": 24_884_908, "pdf_pages": 38, "stage": "PD", "section": "VK",
              "page_number": 26, "parameter_code": "IOS2-073",
              "exclusion": "FIRE_SPRINKLER_SYSTEM_NOT_DOMESTIC_DRINKING_WATER"},
    "F0160": {"sha256": "72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd",
              "size_bytes": 38_153_328, "pdf_pages": 126, "stage": "PD", "section": "EOM",
              "page_number": 37, "parameter_code": "ODI-115",
              "exclusion": "POWER_BOARD_NOT_INSTALLED_LIFT"},
}
_PATTERNS = {
    "F0165": ("насосная", "установка", "для", "пожарной", "системы", "спринклеры"),
    "F0160": ("щл", "-", "щит", "лифта", "подъемника", "мгн"),
}
_KINDS = {"F0165": "FIRE_SPRINKLER_PUMP", "F0160": "LIFT_POWER_BOARD_LEGEND"}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _normalize(word: str) -> str:
    return word.casefold().strip("«»„“”\"'()[]{}.,:;!?")


def _find_near_context(file_id: str, raw_words: list[str]) -> list[tuple[str, int, int]]:
    """Match complete, source-specific excluding phrases; no equipment facts."""
    pattern = _PATTERNS.get(file_id)
    if pattern is None:
        return []
    words = [_normalize(word) for word in raw_words]
    return [(_KINDS[file_id], index, index + len(pattern))
            for index in range(len(words) - len(pattern) + 1)
            if tuple(words[index:index + len(pattern)]) == pattern]


def _locator(index: int, raw: tuple[Any, ...]) -> dict[str, Any]:
    text = str(raw[4])
    return {"wordIndex": index, "rawText": text,
            "wordTextSha256": hashlib.sha256(text.encode()).hexdigest(),
            "bboxMilliPointsTopLeft": [round(float(value) * 1000) for value in raw[:4]]}


def evaluate_equipment_spec_false_near(
    pdf_bytes: bytes, manifest_record: dict[str, Any],
) -> dict[str, Any]:
    """Inspect one audited public original; return an ineligible near-context lead."""
    if not isinstance(manifest_record, dict):
        raise ValueError("equipment false-near manifest record required")
    file_id = manifest_record.get("file_id")
    audited = _AUDITED.get(file_id)
    if audited is None:
        raise ValueError("equipment false-near source is not audited")
    if (manifest_record.get("split"), manifest_record.get("distribution_status"),
            manifest_record.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
        raise ValueError("equipment false-near source is not permitted public training data")
    for key in ("sha256", "size_bytes", "pdf_pages", "stage", "section"):
        if manifest_record.get(key) != audited[key]:
            raise ValueError("equipment false-near audited source metadata mismatch")
    if manifest_record.get("object_id") != _OBJECT:
        raise ValueError("equipment false-near audited source metadata mismatch")
    if not isinstance(pdf_bytes, bytes) or not 0 < len(pdf_bytes) <= MAX_PDF_BYTES:
        raise ValueError("equipment false-near PDF bytes invalid or too large")
    actual_sha = hashlib.sha256(pdf_bytes).hexdigest()
    if actual_sha != audited["sha256"]:
        raise ValueError("equipment false-near PDF SHA mismatch")
    if len(pdf_bytes) != audited["size_bytes"]:
        raise ValueError("equipment false-near PDF size mismatch")
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if len(document) != audited["pdf_pages"]:
            raise ValueError("equipment false-near PDF page count mismatch")
        page = document[audited["page_number"] - 1]
        raw_words = page.get_text("words", sort=False)
        if len(raw_words) > MAX_WORDS:
            raise ValueError("equipment false-near page word count exceeds bound")
        width = round(page.rect.width * 1000)
        height = round(page.rect.height * 1000)
    words = [_locator(index, raw) for index, raw in enumerate(raw_words)]
    matches = _find_near_context(file_id, [word["rawText"] for word in words])
    proposals = []
    if len(matches) == 1:
        kind, start, end = matches[0]
        span = words[start:end]
        proposal = {"proposalKind": kind, "sourceFileId": file_id,
                    "sourceSha256": actual_sha, "pageNumber": audited["page_number"],
                    "nearText": " ".join(word["rawText"] for word in span),
                    "wordLocators": span,
                    "eligibility": "INELIGIBLE_FOR_PARAMETER_FACT",
                    "reasonCodes": [audited["exclusion"], "REVIEW_ONLY_NOT_TYPED_FACT",
                                    "EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED"]}
        proposal["proposalSha256"] = _hash(proposal)
        proposals = [proposal]
    reasons = ["SOURCE_APPROVAL_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED",
               "REVIEW_ONLY_NOT_TYPED_FACT", "EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED",
               audited["exclusion"]]
    if len(matches) != 1:
        reasons.append("EXCLUDING_CONTEXT_MISSING_OR_AMBIGUOUS")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "parameterCode": audited["parameter_code"],
              "sourceFileId": file_id, "objectId": _OBJECT,
              "sourceSha256": actual_sha, "sourceStageFromManifest": audited["stage"],
              "sourceSectionFromManifest": audited["section"],
              "sourceApprovalStatus": "UNVERIFIED",
              "pageNumber": audited["page_number"],
              "pageWidthMilliPoints": width, "pageHeightMilliPoints": height,
              "wordLayoutSha256": _hash(words), "wordCount": len(words),
              "status": "ABSTAIN", "reasonCodes": sorted(reasons),
              "proposalCount": len(proposals), "proposals": proposals,
              "typedFact": None, "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_RESULT_BYTES:
        raise ValueError("equipment false-near result exceeds bound")
    return result
