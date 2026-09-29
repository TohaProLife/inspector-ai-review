"""Bounded, review-only thermal-table navigation from a SHA-checked PDF.

Word boxes provide candidate cell adjacency. They do not prove drawn table
boundaries, product equivalence, an approved source role, or a ZU-127 fact.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import fitz


SCHEMA_VERSION = "zu127-window-table-proposals-v1"
PROFILE_ID = "zu127-window-table-review-v1"
MAX_PAGES = 8
MAX_WORDS_PER_PAGE = 5000
MAX_PROPOSALS = 16
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024
_SHA = re.compile(r"[0-9a-f]{64}\Z")
_NUMBER = re.compile(r"\d{1,2}[,.]\d{1,3}\*{0,2}\Z")
_LABELS = {"окна": "WINDOW", "витражи": "VITRAGE"}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _word(index: int, item: tuple[Any, ...], page_number: int) -> dict[str, Any]:
    text = str(item[4])
    return {"pageNumber": page_number, "wordIndex": index, "rawText": text,
            "wordTextSha256": hashlib.sha256(text.encode()).hexdigest(),
            "bboxMilliPointsTopLeft": [round(float(value) * 1000) for value in item[:4]]}


def _mid_y(word: dict[str, Any]) -> int:
    box = word["bboxMilliPointsTopLeft"]
    return (box[1] + box[3]) // 2


def _mid_x(word: dict[str, Any]) -> int:
    box = word["bboxMilliPointsTopLeft"]
    return (box[0] + box[2]) // 2


def _proposal(kind: str, product: str, roles: dict[str, dict[str, Any]],
              raw_values: dict[str, str]) -> dict[str, Any]:
    result = {"proposalKind": kind, "productKind": product,
              "thermalQuantity": "R_RESISTANCE_CANDIDATE",
              "unitInterpretationStatus": "UNVERIFIED",
              "rowAssociationStatus": "UNVERIFIED",
              "productEquivalenceStatus": "UNVERIFIED",
              "protocolAssociationStatus": "UNVERIFIED",
              "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED", "SOURCE_ROLE_UNVERIFIED",
                              "PRODUCT_EQUIVALENCE_UNVERIFIED"],
              "roles": roles, "rawCellTexts": raw_values,
              "typedValues": None}
    result["proposalSha256"] = _hash(result)
    return result


def _page_proposals(page: fitz.Page, page_number: int) -> tuple[list[dict[str, Any]], list[str], str]:
    raw_words = page.get_text("words", sort=False)
    if len(raw_words) > MAX_WORDS_PER_PAGE:
        return [], ["WORD_LIMIT_REACHED"], ""
    words = [_word(index, item, page_number) for index, item in enumerate(raw_words)]
    word_sha = _hash(words)
    text = page.get_text("text")
    # R and U are reciprocals with different units. A coefficient heading
    # cannot qualify a resistance proposal, even if it has window numbers.
    if (not re.search(r"сопротивлени[ея]\s+теплопередач", text, re.I)
            or re.search(r"коэффициент\s+теплопередач", text, re.I)):
        return [], ["R_HEADING_NOT_UNAMBIGUOUS"], word_sha
    proposals: list[dict[str, Any]] = []
    reasons: list[str] = []
    labels = [word for word in words if word["rawText"].strip(".: ").casefold() in _LABELS]
    first_label_y = min((_mid_y(word) for word in labels), default=10**9)
    required = [word for word in words if word["rawText"].casefold() == "требуемое"
                and _mid_y(word) < first_label_y]
    calculated = [word for word in words if word["rawText"].casefold() in {"расчётное", "расчетное"}
                  and _mid_y(word) < first_label_y]
    # Summary table: use column headings and one numeric word per same-height
    # candidate row. This is word adjacency, not verified table-cell membership.
    if len(required) == 1 and len(calculated) == 1:
        left, right = required[0], calculated[0]
        if _mid_x(left) + 40000 < _mid_x(right):
            for label in labels:
                label_y = _mid_y(label)
                if label_y <= max(_mid_y(left), _mid_y(right)) + 5000:
                    continue
                candidates = [word for word in words
                              if (_NUMBER.fullmatch(word["rawText"])
                                  and abs(_mid_y(word) - label_y) <= 5000
                                  and _mid_x(word) > _mid_x(label) + 20000)]
                left_hits = [word for word in candidates if abs(_mid_x(word) - _mid_x(left)) <= 45000]
                right_hits = [word for word in candidates if abs(_mid_x(word) - _mid_x(right)) <= 45000]
                if len(left_hits) != 1 or len(right_hits) != 1 or left_hits[0] is right_hits[0]:
                    reasons.append("SUMMARY_ROW_ADJACENCY_AMBIGUOUS")
                    continue
                product = _LABELS[label["rawText"].strip(".: ").casefold()]
                proposals.append(_proposal("R_SUMMARY_ROW_ADJACENCY", product,
                                           {"productLabel": label, "requiredHeader": left,
                                            "calculatedHeader": right,
                                            "requiredCell": left_hits[0],
                                            "calculatedCell": right_hits[0]},
                                           {"required": left_hits[0]["rawText"],
                                            "calculated": right_hits[0]["rawText"]}))
    # Product schedule: separate category headings bound a vertical region.
    # A single right-column number becomes navigation only; long multiline
    # descriptions and protocol footnotes are deliberately left unassociated.
    elif not required and not calculated:
        category_labels = sorted((word for word in labels if word["rawText"].strip(".: ").casefold()
                                  in _LABELS), key=_mid_y)
        for index, label in enumerate(category_labels):
            lower = (_mid_y(category_labels[index + 1]) if index + 1 < len(category_labels)
                     else _mid_y(label) + 45000)
            hits = [word for word in words
                    if (_NUMBER.fullmatch(word["rawText"])
                        and _mid_y(label) + 3000 < _mid_y(word) < lower - 3000
                        and _mid_x(word) > page.rect.width * 1000 * 0.65)]
            if len(hits) != 1:
                reasons.append("PRODUCT_ROW_ADJACENCY_AMBIGUOUS")
                continue
            product = _LABELS[label["rawText"].strip(".: ").casefold()]
            proposals.append(_proposal("R_PRODUCT_ROW_ADJACENCY", product,
                                       {"productHeading": label, "resistanceCell": hits[0]},
                                       {"resistance": hits[0]["rawText"]}))
    else:
        reasons.append("SUMMARY_HEADERS_AMBIGUOUS")
    return proposals, reasons, word_sha


def evaluate_zu127_window_table_proposals(
    pdf_path: Path, source: dict[str, Any], page_numbers: list[int],
) -> dict[str, Any]:
    if not isinstance(source, dict) or source.get("file_id") != "F0152":
        raise ValueError("ZU-127 requires audited F0152 public source")
    if (source.get("split"), source.get("distribution_status"),
            source.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
        raise ValueError("ZU-127 source is not permitted public training data")
    expected_sha = source.get("sha256")
    if not isinstance(expected_sha, str) or _SHA.fullmatch(expected_sha) is None:
        raise ValueError("ZU-127 source SHA invalid")
    if (not isinstance(page_numbers, list) or not page_numbers
            or len(page_numbers) > MAX_PAGES or len(set(page_numbers)) != len(page_numbers)
            or any(not isinstance(number, int) or isinstance(number, bool) or number < 1
                   for number in page_numbers)):
        raise ValueError("ZU-127 page selection invalid")
    if not isinstance(source.get("size_bytes"), int) or not 0 < source["size_bytes"] <= MAX_PDF_BYTES:
        raise ValueError("ZU-127 PDF byte size outside bound")
    if Path(pdf_path).stat().st_size > MAX_PDF_BYTES:
        raise ValueError("ZU-127 PDF exceeds byte bound")
    payload = Path(pdf_path).read_bytes()
    if len(payload) != source.get("size_bytes") or hashlib.sha256(payload).hexdigest() != expected_sha:
        raise ValueError("ZU-127 PDF size/SHA mismatch")
    document = fitz.open(stream=payload, filetype="pdf")
    if document.page_count != source.get("pdf_pages") or max(page_numbers) > document.page_count:
        raise ValueError("ZU-127 PDF page count/selection mismatch")
    proposals: list[dict[str, Any]] = []
    page_receipts: list[dict[str, Any]] = []
    reasons = {"REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_ROLE_UNVERIFIED",
               "PD_RD_PAIR_UNVERIFIED", "ROW_ASSOCIATION_UNVERIFIED"}
    for page_number in sorted(page_numbers):
        local, local_reasons, word_sha = _page_proposals(document[page_number - 1], page_number)
        page_receipts.append({"pageNumber": page_number, "wordArtifactSha256": word_sha,
                              "proposalCount": len(local), "reasonCodes": sorted(set(local_reasons))})
        reasons.update(local_reasons)
        proposals.extend(local)
    if not proposals:
        reasons.add("NO_SAFE_PROPOSAL_IN_SELECTED_PAGES")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "sourceFileId": "F0152", "sourceSha256": expected_sha,
              "sourceObjectId": source.get("object_id"), "selectedPageNumbers": sorted(page_numbers),
              "pageReceipts": page_receipts,
              "codeRows": [{"parameterCode": "ZU-127", "status": "ABSTAIN",
                            "reasonCodes": sorted(reasons), "proposalCount": len(proposals),
                            "truncatedProposalCount": max(0, len(proposals) - MAX_PROPOSALS),
                            "absenceConclusion": "NOT_AVAILABLE",
                            "proposals": proposals[:MAX_PROPOSALS]}],
              "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_RESULT_BYTES:
        raise ValueError("ZU-127 review output exceeds bound")
    return result
