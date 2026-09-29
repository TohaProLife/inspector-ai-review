"""Pure PZ-013 review gate for utility contracts and object-name capacity leads.

Exclusions concern only matched text spans. They do not establish the current
functional capacity, source approval, section role, or a comparable PD/RD pair.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_VERSION = "pz013-functional-capacity-exclusions-v1"
PROFILE_ID = "pz013-utility-name-exclusion-v1"
MAX_PDF_BYTES = 100 * 1024 * 1024
MAX_WORDS = 20_000
MAX_EXCLUSIONS = 24
MAX_RESULT_BYTES = 128 * 1024
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_NUMBER = re.compile(r"\d+(?:[,\.]\d+)?\Z")


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _locator(index: int, raw: tuple[Any, ...]) -> dict[str, Any]:
    text = str(raw[4])
    return {"wordIndex": index, "text": text,
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "bboxMilliPoints": [round(float(v) * 1000) for v in raw[:4]]}


def _norm(text: str) -> str:
    return text.lower().strip("«»„“”\"'()[]{}.,:;!?№")


def _spans(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Classify only exact local word sequences under explicit utility context."""
    tokens = [_norm(word["text"]) for word in words]
    contexts: list[tuple[str, list[int]]] = []
    for i in range(len(tokens) - 1):
        if tokens[i:i + 2] == ["технические", "условия"]:
            contexts.append(("ELECTRIC_TECHNICAL_CONDITIONS", [i, i + 1]))
        if tokens[i] == "ао" and tokens[i + 1] == "мосводоканал":
            contexts.append(("WATER_CONNECTION_CONTRACT", [i, i + 1]))
    electric = any(kind == "ELECTRIC_TECHNICAL_CONDITIONS" for kind, _ in contexts)
    water = any(kind == "WATER_CONNECTION_CONTRACT" for kind, _ in contexts)
    if not (electric or water):
        return []
    basis = [{"contextKind": kind, "wordLocators": [words[j] for j in indices]}
             for kind, indices in contexts[:4]]
    exclusions: list[dict[str, Any]] = []
    for i, token in enumerate(tokens):
        if (token == "школа" and i + 3 < len(tokens) and
                tokens[i + 1] == "на" and tokens[i + 2].isdigit() and
                tokens[i + 3] in {"мест", "места"}):
            indices = list(range(i, i + 4))
            kind = "CAPACITY_IN_OBJECT_NAME"
        elif (i + 1 < len(tokens) and _NUMBER.fullmatch(token) and
              ((electric and tokens[i + 1] in {"квт", "квт/ч"} and
                any(t.startswith("присоедин") or t == "освещения"
                    for t in tokens[max(0, i - 24):i])) or
               (water and tokens[i + 1] in {"м3/сут", "м³/сут", "м3/сутки"} and
                any(t.startswith("подключен") or t.startswith("нагрузк")
                    for t in tokens[max(0, i - 24):i])))):
            indices = [i, i + 1]
            kind = "UTILITY_CONNECTION_LOAD"
        else:
            continue
        item = {"exclusionKind": kind,
                "rawText": " ".join(words[j]["text"] for j in indices),
                "wordLocators": [words[j] for j in indices],
                "basis": basis,
                "reasonCodes": (["OBJECT_NAME_NOT_CURRENT_DESIGN_CAPACITY"] if kind == "CAPACITY_IN_OBJECT_NAME"
                                else ["UTILITY_LOAD_NOT_FUNCTIONAL_CAPACITY"]),
                "typedFact": None}
        item["exclusionSha256"] = _hash(item)
        exclusions.append(item)
    return exclusions


def evaluate_pz013_functional_capacity_exclusions(
    pdf_bytes: bytes, manifest_record: dict[str, Any], page_number: int,
) -> dict[str, Any]:
    """Read one SHA-pinned public PDF page; output review navigation only."""
    import fitz

    if not isinstance(pdf_bytes, bytes) or not 0 < len(pdf_bytes) <= MAX_PDF_BYTES:
        raise ValueError("PZ-013 PDF bytes invalid or too large")
    if not isinstance(manifest_record, dict):
        raise ValueError("PZ-013 manifest record required")
    if (manifest_record.get("split"), manifest_record.get("distribution_status"),
            manifest_record.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
        raise ValueError("PZ-013 source is not permitted public training data")
    expected = manifest_record.get("sha256")
    actual = hashlib.sha256(pdf_bytes).hexdigest()
    if not isinstance(expected, str) or not _SHA.fullmatch(expected) or actual != expected:
        raise ValueError("PZ-013 original PDF SHA mismatch")
    if manifest_record.get("size_bytes") != len(pdf_bytes):
        raise ValueError("PZ-013 original PDF size mismatch")
    if not isinstance(page_number, int) or isinstance(page_number, bool) or page_number < 1:
        raise ValueError("PZ-013 physical page invalid")
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if len(document) != manifest_record.get("pdf_pages") or page_number > len(document):
            raise ValueError("PZ-013 PDF page count mismatch")
        page = document[page_number - 1]
        raw_words = page.get_text("words", sort=False)
        if len(raw_words) > MAX_WORDS:
            raise ValueError("PZ-013 page word count exceeds bound")
        width, height = round(page.rect.width * 1000), round(page.rect.height * 1000)
    words = [_locator(i, raw) for i, raw in enumerate(raw_words)]
    found = _spans(words)
    reasons = ["REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_APPROVAL_UNVERIFIED",
               "PD_RD_PAIR_UNVERIFIED", "CURRENT_TX_CAPACITY_NOT_ESTABLISHED",
               "PAGE_NOT_EXHAUSTIVELY_CLASSIFIED"]
    if not found:
        reasons.append("NO_EXPLICIT_UTILITY_EXCLUSION_IN_TEXT_LAYER")
    if len(found) > MAX_EXCLUSIONS:
        reasons.append("EXCLUSION_LIMIT_REACHED")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "parameterCode": "PZ-013",
              "sourceFileId": manifest_record.get("file_id"),
              "objectId": manifest_record.get("object_id"),
              "sourceSha256": actual, "sourceStageFromManifest": manifest_record.get("stage"),
              "sourceSectionFromManifest": manifest_record.get("section"),
              "sourceApprovalStatus": "UNVERIFIED", "pageNumber": page_number,
              "pageWidthMilliPoints": width, "pageHeightMilliPoints": height,
              "wordLayoutSha256": _hash(words), "wordCount": len(words),
              "status": "ABSTAIN", "reasonCodes": sorted(reasons),
              "exclusionCount": len(found),
              "truncatedExclusionCount": max(0, len(found) - MAX_EXCLUSIONS),
              "exclusions": found[:MAX_EXCLUSIONS],
              "typedFact": None, "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RESULT_BYTES:
        raise ValueError("PZ-013 result exceeds bound")
    return result
