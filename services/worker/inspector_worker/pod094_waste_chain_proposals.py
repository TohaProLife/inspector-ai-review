"""Review-only waste quantity navigation in two audited public PDF originals.

The proposed word spans are deliberately not typed facts or cross-document
matches. A project calculation, an orientative contract quantity, and a
weighbridge/talon transfer have different evidentiary meanings.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import fitz


SCHEMA_VERSION = "pod094-waste-chain-proposals-v1"
PROFILE_ID = "pod094-waste-chain-public-review-v1"
_AUDITED = {
    "F0189": ("eae7d1997b49d2302d20d66483f9490ca3fb5e2bb7b465329d9518563e95c7cd", 969, (99, 100)),
    "F0071": ("a314d845fcb58fc6ac1502fc1fb1672562f419ed36cc8ead88327d374817d327", 32, (5,)),
}
_AUDITED_SCOPE = {"F0189": ("OBJ-TYUMENSKAYA-5-GOLD-SEED", "PD", "OTHER"),
                  "F0071": ("OBJ-NOVOSLOBODSKAYA", "ID", "OTHER")}
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_WORDS_PER_PAGE = 5000
MAX_RESULT_BYTES = 256 * 1024
_NUMBER = re.compile(r"\d+[,.]\d+\Z")


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _word(index: int, raw: tuple[Any, ...], page_number: int) -> dict[str, Any]:
    raw_text = str(raw[4])
    return {"pageNumber": page_number, "wordIndex": index, "rawText": raw_text,
            "wordTextSha256": hashlib.sha256(raw_text.encode()).hexdigest(),
            "bboxMilliPointsTopLeft": [round(float(value) * 1000) for value in raw[:4]]}


def _text(words: list[dict[str, Any]]) -> str:
    return " ".join(word["rawText"] for word in words)


def _line(words: list[dict[str, Any]], anchor: dict[str, Any], tolerance: int = 3000) -> list[dict[str, Any]]:
    y = anchor["bboxMilliPointsTopLeft"][1]
    return [word for word in words if abs(word["bboxMilliPointsTopLeft"][1] - y) <= tolerance]


def _proposal(kind: str, roles: dict[str, list[dict[str, Any]]],
              *, reason_codes: list[str]) -> dict[str, Any]:
    result = {"proposalKind": kind, "quantityCategory": kind,
              "materialRaw": _text(roles.get("material", [])) or None,
              "fkkoRaw": _text(roles.get("fkko", [])) or None,
              "hazardClassRaw": _text(roles.get("hazardClass", [])) or None,
              "quantityRaw": _text(roles.get("quantity", [])) or None,
              "unitRaw": _text(roles.get("unit", [])) or None,
              "quantitySlots": {"estimate": None, "contractLimit": None,
                                "contractOrientative": None, "actualTransfer": None},
              "rowAssociationStatus": "UNVERIFIED", "materialAssociationStatus": "UNVERIFIED",
              "fkkoAssociationStatus": "UNVERIFIED", "unitStatus": "UNVERIFIED",
              "batchIdentity": None, "transferDate": None, "talonId": None,
              "receivingPartyVerification": None, "typedValues": None,
              "reasonCodes": sorted(set(reason_codes + ["REVIEW_ONLY_NOT_TYPED_FACT",
                                                  "ROW_ASSOCIATION_UNVERIFIED",
                                                  "SOURCE_ROLE_UNVERIFIED"])),
              "roles": roles}
    # Slots are raw navigation values. Even contract wording does not establish
    # a binding limit, and an agreement is not evidence of a completed transfer.
    if kind == "PROJECT_ESTIMATE_CANDIDATE":
        result["quantitySlots"]["estimate"] = result["quantityRaw"]
    elif kind == "CONTRACT_ORIENTATIVE_CANDIDATE":
        result["quantitySlots"]["contractOrientative"] = result["quantityRaw"]
    result["proposalSha256"] = _hash(result)
    return result


def _estimate_proposals(words: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Two bounded paragraph candidates on F0189 p100; lower table deferred."""
    starts = [index for index, word in enumerate(words)
              if word["rawText"] in {"Отходы", "Лом"}
              and _text(words[index:index + 4]).startswith(("Отходы (мусор) от", "Лом и отходы,"))]
    reasons: list[str] = ["LOWER_TABLE_ROWS_DEFERRED_AMBIGUOUS_CLASS_AND_UNITS"]
    if len(starts) != 2 or starts[0] >= starts[1]:
        return [], reasons + ["ESTIMATE_PARAGRAPH_BOUNDARIES_AMBIGUOUS"]
    proposals = []
    for index, start in enumerate(starts):
        finish = starts[index + 1] if index + 1 < len(starts) else next(
            (i for i in range(start + 1, len(words)) if words[i]["rawText"] == "Отдельно"), len(words))
        chunk = words[start:finish]
        fkko = next((i for i, word in enumerate(chunk) if word["rawText"] == "ФККО"), None)
        mass = next((i for i, word in enumerate(chunk) if word["rawText"] == "Общей"
                     and i + 1 < len(chunk) and chunk[i + 1]["rawText"] == "массой"), None)
        if fkko is None or mass is None or fkko >= mass:
            reasons.append("ESTIMATE_FIELDS_AMBIGUOUS")
            continue
        code_line = _line(chunk, chunk[fkko])
        code_tail = [word for word in code_line if word["wordIndex"] > chunk[fkko]["wordIndex"]]
        class_start = next((i for i, word in enumerate(code_tail) if word["rawText"].startswith("(")), None)
        mass_line = _line(chunk, chunk[mass])
        equals = [i for i, word in enumerate(mass_line) if word["rawText"] == "="]
        if (class_start is None or class_start == 0 or len(equals) != 1
                or equals[0] + 2 >= len(mass_line)
                or not _NUMBER.fullmatch(mass_line[equals[0] + 1]["rawText"])
                or not mass_line[equals[0] + 2]["rawText"].startswith("тонн")):
            reasons.append("ESTIMATE_QUANTITY_OR_CLASS_AMBIGUOUS")
            continue
        material = chunk[:next(i for i, word in enumerate(chunk) if word["rawText"] == "код")]
        # The second material title wraps one line; both lines belong only to
        # this proposal's navigation span, pending visual row verification.
        roles = {"material": material, "fkko": code_tail[:class_start],
                 "hazardClass": code_tail[class_start:],
                 "quantity": [mass_line[equals[0] + 1]],
                 "unit": [mass_line[equals[0] + 2]],
                 "quantityContext": mass_line}
        proposals.append(_proposal("PROJECT_ESTIMATE_CANDIDATE", roles,
                                   reason_codes=["CALCULATION_NOT_ACTUAL_TRANSFER",
                                                 "ESTIMATE_FORMULA_REQUIRES_REVIEW"]))
    return proposals, reasons


def _contract_proposals(words: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """One orientative line on F0071 p5; nearby price must stay separate."""
    reasons: list[str] = []
    heading = [word for word in words if word["rawText"] == "Ориентировочный"]
    material_start = [word for word in words if word["rawText"] == "Лом"
                      and 560000 <= word["bboxMilliPointsTopLeft"][1] <= 620000]
    if len(heading) != 1 or len(material_start) != 1:
        return [], ["CONTRACT_TABLE_HEADING_OR_ROW_AMBIGUOUS"]
    row = [word for word in words if 560000 <= word["bboxMilliPointsTopLeft"][1] <= 617000]
    material = [word for word in row if 90000 <= word["bboxMilliPointsTopLeft"][0] < 225000]
    classes = [word for word in row if 225000 <= word["bboxMilliPointsTopLeft"][0] < 285000
               and word["rawText"].upper() in {"I", "II", "III", "IV", "V"}]
    fkko = [word for word in row if 285000 <= word["bboxMilliPointsTopLeft"][0] < 385000
            and word["rawText"].isdigit()]
    mass = [word for word in row if 385000 <= word["bboxMilliPointsTopLeft"][0] < 490000
            and _NUMBER.fullmatch(word["rawText"])]
    tonne = [word for word in words if word["rawText"] == "(тонн)"
             and abs(word["bboxMilliPointsTopLeft"][1] - heading[0]["bboxMilliPointsTopLeft"][1]) <= 40000]
    price = [word for word in row if word["bboxMilliPointsTopLeft"][0] >= 490000
             and _NUMBER.fullmatch(word["rawText"])]
    if (len(material) < 3 or len(classes) != 1 or len(fkko) != 6 or len(mass) != 1
            or len(tonne) != 1 or len(price) != 1):
        return [], ["CONTRACT_ROW_OR_UNIT_AMBIGUOUS"]
    roles = {"material": material, "fkko": fkko, "hazardClass": classes,
             "quantity": mass, "unit": tonne,
             "contractQuantityHeading": heading, "excludedPriceCell": price}
    return [_proposal("CONTRACT_ORIENTATIVE_CANDIDATE", roles,
                      reason_codes=["ORIENTATIVE_QUANTITY_NOT_BINDING_LIMIT",
                                    "CONTRACT_NOT_ACTUAL_TRANSFER",
                                    "PRICE_CELL_EXCLUDED_FROM_QUANTITY"])], reasons


def evaluate_pod094_waste_chain_proposals(pdf_path: Path, source: dict[str, Any]) -> dict[str, Any]:
    """Read only an audited public original and emit source-local proposals."""
    if not isinstance(source, dict) or source.get("file_id") not in _AUDITED:
        raise ValueError("POD-094 source is not an audited public PDF")
    if (source.get("split"), source.get("distribution_status"),
            source.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
        raise ValueError("POD-094 source is not permitted public training data")
    file_id = source["file_id"]
    audited_sha, audited_pages, pages = _AUDITED[file_id]
    if (source.get("sha256") != audited_sha or source.get("pdf_pages") != audited_pages
            or (source.get("object_id"), source.get("stage"), source.get("section")) != _AUDITED_SCOPE[file_id]
            or not isinstance(source.get("size_bytes"), int)
            or isinstance(source.get("size_bytes"), bool)
            or not 0 < source["size_bytes"] <= MAX_PDF_BYTES):
        raise ValueError("POD-094 source manifest identity invalid")
    path = Path(pdf_path)
    if path.stat().st_size != source["size_bytes"]:
        raise ValueError("POD-094 original PDF size mismatch")
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != audited_sha:
        raise ValueError("POD-094 original PDF SHA mismatch")
    with fitz.open(stream=payload, filetype="pdf") as document:
        if document.page_count != audited_pages:
            raise ValueError("POD-094 original PDF page count mismatch")
        page_words = {}
        for page_number in pages:
            raw_words = document[page_number - 1].get_text("words", sort=False)
            if len(raw_words) > MAX_WORDS_PER_PAGE:
                raise ValueError("POD-094 page word limit reached")
            page_words[page_number] = [_word(index, item, page_number)
                                       for index, item in enumerate(raw_words)]
    if file_id == "F0189":
        context = _text(page_words[99])
        if "Расчет отходов строительства" not in context:
            proposals, reasons = [], ["ESTIMATE_SECTION_CONTEXT_AMBIGUOUS"]
        else:
            proposals, reasons = _estimate_proposals(page_words[100])
    else:
        proposals, reasons = _contract_proposals(page_words[5])
    reasons.extend(["NO_APPROVED_POD_PPR_SOURCE_ROLE", "NO_VERIFIED_BATCH_LINK",
                    "NO_ACTUAL_TRANSFER_PROOF_FROM_SCANNED_PAGES"])
    if not proposals:
        reasons.append("NO_SAFE_PROPOSAL_IN_SCANNED_PAGES")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "parameterCode": "POD-094",
              "sourceFileId": file_id, "objectId": source.get("object_id"),
              "sourceSha256": audited_sha, "sourceStageFromManifest": source.get("stage"),
              "sourceSectionFromManifest": source.get("section"),
              "sourceApprovalStatus": "UNVERIFIED",
              "scannedPages": [{"pageNumber": page, "wordCount": len(page_words[page]),
                                "wordLayoutSha256": _hash(page_words[page])} for page in pages],
              "status": "ABSTAIN", "reasonCodes": sorted(set(reasons)),
              "proposalCount": len(proposals), "proposals": proposals,
              "documentAssociationStatus": "SOURCE_LOCAL_ONLY",
              "contractLimit": None, "actualTransfer": None, "typedFact": None,
              "findingCount": None, "parameterCoverage": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_RESULT_BYTES:
        raise ValueError("POD-094 output exceeds bound")
    return result
