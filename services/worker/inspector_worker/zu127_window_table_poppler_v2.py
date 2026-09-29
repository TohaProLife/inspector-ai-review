"""Poppler word based, SHA-pinned ZU-127 navigation. Never emits a fact.

This offline profile covers only the audited public F0152 pages 49 and 51.
Poppler is the canonical word source for this profile: its word indices must
not be compared with PyMuPDF indices from the older profile.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "zu127-window-table-proposals-poppler-v2"
PROFILE_ID = "zu127-window-table-poppler-review-v2"
PUBLIC_SHA = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af"
PUBLIC_OBJECT_ID = "OBJ-TYUMENSKAYA-5-GOLD-SEED"
PUBLIC_SIZE = 6_359_136
PUBLIC_PAGES = 77
SELECTED_PAGES = [49, 51]
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_XML_BYTES = 16 * 1024 * 1024
MAX_WORDS = 5000
MAX_RESULT_BYTES = 256 * 1024
_NUMBER = re.compile(r"\d{1,2}[,.]\d{1,3}\Z")
_DECIMAL = re.compile(r"(?:0|[1-9]\d*)(?:\.\d{1,6})?\Z")
_LABELS = {"окна": "WINDOW", "витражи": "VITRAGE"}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hash(value: Any) -> str:
    return _sha(json.dumps(value, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False).encode())


def _run(program: str, args: list[str], *, max_bytes: int) -> tuple[bytes, bytes]:
    try:
        done = subprocess.run([program, *args], capture_output=True, timeout=15, check=True,
                              env={"LC_ALL": "C", "PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f"Poppler {program} unavailable or failed") from error
    if len(done.stdout) > max_bytes or len(done.stderr) > 4096:
        raise ValueError("Poppler output outside bounds")
    return done.stdout, done.stderr


def _single(value: str, pattern: str, field: str) -> str:
    matches = re.findall(pattern, value, re.M)
    if len(matches) != 1:
        raise ValueError(f"ambiguous Poppler {field}")
    return matches[0]


def _milli(value: str) -> int:
    if _DECIMAL.fullmatch(value) is None:
        raise ValueError("invalid Poppler word coordinate")
    number = float(value)
    if not math.isfinite(number) or number > 100_000:
        raise ValueError("Poppler word coordinate outside bounds")
    return math.floor(number * 1000 + 0.5)


def _parse_page(xml: bytes, page_number: int) -> dict[str, Any]:
    if not xml or len(xml) > MAX_XML_BYTES:
        raise ValueError("Poppler XML outside bounds")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ValueError("invalid Poppler XML") from error
    pages = [item for item in root.iter() if item.tag.rsplit("}", 1)[-1] == "page"]
    if len(pages) != 1:
        raise ValueError("Poppler XML must contain one page")
    page = pages[0]
    width, height = _milli(page.attrib.get("width", "")), _milli(page.attrib.get("height", ""))
    if not width or not height:
        raise ValueError("empty Poppler page")
    words = []
    for element in page.iter():
        if element.tag.rsplit("}", 1)[-1] != "word":
            continue
        if len(words) >= MAX_WORDS or not element.text or list(element):
            raise ValueError("empty, nested, or excessive Poppler words")
        box = [_milli(element.attrib.get(key, ""))
               for key in ("xMin", "yMin", "xMax", "yMax")]
        if box[0] > box[2] or box[2] > width or box[1] > box[3] or box[3] > height:
            raise ValueError("Poppler word outside page")
        words.append({"pageNumber": page_number, "wordIndex": len(words),
                      "rawText": element.text, "wordTextSha256": _sha(element.text.encode()),
                      "bboxMilliPointsTopLeft": box})
    if not words:
        raise ValueError("missing Poppler page words")
    return {"pageWidthMilliPoints": width, "pageHeightMilliPoints": height, "words": words}


def _mid_x(word: dict[str, Any]) -> int:
    box = word["bboxMilliPointsTopLeft"]
    return (box[0] + box[2]) // 2


def _mid_y(word: dict[str, Any]) -> int:
    box = word["bboxMilliPointsTopLeft"]
    return (box[1] + box[3]) // 2


def _label(word: dict[str, Any]) -> str | None:
    return _LABELS.get(word["rawText"].strip(".: ").casefold())


def _proposal(kind: str, product: str, roles: dict[str, dict[str, Any]],
              raw_cells: dict[str, str]) -> dict[str, Any]:
    body = {"proposalKind": kind, "productKind": product,
            "thermalQuantity": "R_RESISTANCE_CANDIDATE",
            "unitInterpretationStatus": "UNVERIFIED", "rowAssociationStatus": "UNVERIFIED",
            "productEquivalenceStatus": "UNVERIFIED",
            "protocolAssociationStatus": "UNVERIFIED",
            "reasonCodes": ["ROW_ASSOCIATION_UNVERIFIED", "SOURCE_ROLE_UNVERIFIED",
                            "PRODUCT_EQUIVALENCE_UNVERIFIED"],
            "roles": roles, "rawCellTexts": raw_cells, "typedValues": None}
    return {**body, "proposalSha256": _hash(body)}


def _footnote(words: list[dict[str, Any]], number: dict[str, Any]) -> list[dict[str, Any]]:
    box = number["bboxMilliPointsTopLeft"]
    return [word for word in words if word["rawText"] in {"*", "**"}
            and 0 <= word["bboxMilliPointsTopLeft"][0] - box[2] <= 200
            and min(box[3], word["bboxMilliPointsTopLeft"][3])
            > max(box[1], word["bboxMilliPointsTopLeft"][1])]


def _page_proposals(page: dict[str, Any], page_number: int) -> tuple[list[dict[str, Any]], list[str]]:
    words = page["words"]
    text = page["pageText"]
    if (not re.search(r"сопротивлени[ея]\s+теплопередач", text, re.I)
            or re.search(r"коэффициент\s+теплопередач", text, re.I)):
        return [], ["R_HEADING_NOT_UNAMBIGUOUS"]
    if page_number == 49:
        # F0152 product schedule. Title labels above y=100pt are excluded.
        labels = [word for word in words if _label(word)
                  and 290_000 <= _mid_x(word) <= 360_000
                  and 100_000 < _mid_y(word) < 225_000]
        labels.sort(key=_mid_y)
        if len(labels) != 2 or [_label(word) for word in labels] != ["WINDOW", "VITRAGE"]:
            return [], ["PRODUCT_HEADINGS_AMBIGUOUS"]
        proposals = []
        reasons = []
        for index, label in enumerate(labels):
            lower = _mid_y(labels[index + 1]) if index + 1 < len(labels) else _mid_y(label) + 50_000
            hits = [word for word in words if _NUMBER.fullmatch(word["rawText"])
                    and _mid_y(label) + 3000 < _mid_y(word) < lower - 3000
                    and _mid_x(word) > page["pageWidthMilliPoints"] * 0.7]
            if len(hits) != 1:
                reasons.append("PRODUCT_ROW_ADJACENCY_AMBIGUOUS")
                continue
            markers = _footnote(words, hits[0])
            if len(markers) != 1:
                reasons.append("PRODUCT_FOOTNOTE_ADJACENCY_AMBIGUOUS")
                continue
            proposals.append(_proposal("R_PRODUCT_ROW_ADJACENCY_POPPLER", _label(label),
                                       {"productHeading": label, "resistanceCell": hits[0],
                                        "footnoteMarker": markers[0]},
                                       {"resistance": hits[0]["rawText"],
                                        "footnoteMarker": markers[0]["rawText"]}))
        return proposals, reasons
    if page_number == 51:
        labels = [word for word in words if _label(word) and _mid_x(word) < 200_000
                  and 300_000 < _mid_y(word) < 550_000]
        labels.sort(key=_mid_y)
        if len(labels) != 2 or [_label(word) for word in labels] != ["WINDOW", "VITRAGE"]:
            return [], ["SUMMARY_PRODUCT_LABELS_AMBIGUOUS"]
        first_y = _mid_y(labels[0])
        required = [word for word in words if word["rawText"].casefold() == "требуемое"
                    and _mid_y(word) < first_y]
        calculated = [word for word in words if word["rawText"].casefold()
                      in {"расчётное", "расчетное"} and _mid_y(word) < first_y]
        if (len(required) != 1 or len(calculated) != 1
                or _mid_x(required[0]) + 40_000 >= _mid_x(calculated[0])):
            return [], ["SUMMARY_HEADERS_AMBIGUOUS"]
        left, right = required[0], calculated[0]
        proposals = []
        reasons = []
        for label in labels:
            candidates = [word for word in words if _NUMBER.fullmatch(word["rawText"])
                          and abs(_mid_y(word) - _mid_y(label)) <= 5000
                          and _mid_x(word) > _mid_x(label) + 20_000]
            left_hits = [word for word in candidates if abs(_mid_x(word) - _mid_x(left)) <= 45_000]
            right_hits = [word for word in candidates if abs(_mid_x(word) - _mid_x(right)) <= 45_000]
            if len(left_hits) != 1 or len(right_hits) != 1 or left_hits[0] is right_hits[0]:
                reasons.append("SUMMARY_ROW_ADJACENCY_AMBIGUOUS")
                continue
            proposals.append(_proposal("R_SUMMARY_ROW_ADJACENCY_POPPLER", _label(label),
                                       {"productLabel": label, "requiredHeader": left,
                                        "calculatedHeader": right, "requiredCell": left_hits[0],
                                        "calculatedCell": right_hits[0]},
                                       {"required": left_hits[0]["rawText"],
                                        "calculated": right_hits[0]["rawText"]}))
        return proposals, reasons
    raise ValueError("page outside ZU-127 Poppler profile")


def evaluate_zu127_window_table_poppler_v2(
    pdf_path: Path, source: dict[str, Any], page_numbers: list[int],
) -> dict[str, Any]:
    """Return review-only navigation, pinned to original public F0152 bytes."""
    if (not isinstance(source, dict) or source.get("file_id") != "F0152"
            or (source.get("split"), source.get("distribution_status"),
                source.get("label_visibility")) != ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN")
            or source.get("sha256") != PUBLIC_SHA or source.get("size_bytes") != PUBLIC_SIZE
            or source.get("pdf_pages") != PUBLIC_PAGES
            or source.get("object_id") != PUBLIC_OBJECT_ID
            or source.get("stage") != "PD" or source.get("section") != "OTHER"):
        raise ValueError("ZU-127 Poppler profile requires audited public F0152 source")
    if page_numbers != SELECTED_PAGES:
        raise ValueError("ZU-127 Poppler profile requires pages 49 and 51")
    path = Path(pdf_path)
    if path.stat().st_size > MAX_PDF_BYTES:
        raise ValueError("ZU-127 PDF exceeds byte bound")
    payload = path.read_bytes()
    if len(payload) != PUBLIC_SIZE or _sha(payload) != PUBLIC_SHA or not payload.startswith(b"%PDF-"):
        raise ValueError("ZU-127 PDF size/SHA mismatch")
    version_out, version_error = _run("pdftotext", ["-v"], max_bytes=4096)
    version = _single((version_out + version_error).decode("utf-8"),
                      r"^pdftotext version (\d+\.\d+\.\d+)\s*$", "version")
    proposals = []
    receipts = []
    reasons = {"REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_ROLE_UNVERIFIED",
               "PD_RD_PAIR_UNVERIFIED", "ROW_ASSOCIATION_UNVERIFIED"}
    with tempfile.TemporaryDirectory(prefix="inspector-zu127-poppler-") as directory:
        verified_path = Path(directory) / "source.pdf"
        with verified_path.open("xb") as handle:
            handle.write(payload)
        info, info_error = _run("pdfinfo", [str(verified_path)], max_bytes=128 * 1024)
        if info_error:
            raise ValueError("Poppler reported PDF warning")
        info_text = info.decode("utf-8")
        count = int(_single(info_text, r"^Pages:\s*(\d+)\s*$", "page count"))
        encrypted = _single(info_text, r"^Encrypted:\s*(yes|no)(?:\s+.*)?$", "PDF encryption")
        if count != PUBLIC_PAGES or encrypted != "no":
            raise ValueError("Poppler page count or encryption mismatch")
        for page_number in page_numbers:
            args = ["-f", str(page_number), "-l", str(page_number)]
            xml, xml_error = _run("pdftotext", [*args, "-bbox-layout", "-enc", "UTF-8",
                                                  str(verified_path), "-"], max_bytes=MAX_XML_BYTES)
            plain, plain_error = _run("pdftotext", [*args, "-raw", "-enc", "UTF-8",
                                                      str(verified_path), "-"], max_bytes=MAX_XML_BYTES)
            if xml_error or plain_error:
                raise ValueError("Poppler reported extraction warning")
            page = _parse_page(xml, page_number)
            page["pageText"] = plain.decode("utf-8")
            local, local_reasons = _page_proposals(page, page_number)
            proposals.extend(local)
            reasons.update(local_reasons)
            receipts.append({"pageNumber": page_number,
                             "providerId": f"poppler-pdftotext-bbox-layout-v2@{version}",
                             "pageWidthMilliPoints": page["pageWidthMilliPoints"],
                             "pageHeightMilliPoints": page["pageHeightMilliPoints"],
                             "wordCount": len(page["words"]),
                             "wordArtifactSha256": _hash(page["words"]),
                             "xmlSha256": _sha(xml), "plainTextSha256": _sha(plain),
                             "proposalCount": len(local),
                             "reasonCodes": sorted(set(local_reasons))})
    if not proposals:
        reasons.add("NO_SAFE_PROPOSAL_IN_SELECTED_PAGES")
    result = {"schemaVersion": SCHEMA_VERSION, "profileId": PROFILE_ID,
              "purpose": "REVIEW_ONLY", "sourceFileId": "F0152", "sourceSha256": PUBLIC_SHA,
              "sourceObjectId": PUBLIC_OBJECT_ID, "selectedPageNumbers": page_numbers,
              "pageReceipts": receipts,
              "codeRows": [{"parameterCode": "ZU-127", "status": "ABSTAIN",
                            "reasonCodes": sorted(reasons), "proposalCount": len(proposals),
                            "truncatedProposalCount": max(0, len(proposals) - 16),
                            "absenceConclusion": "NOT_AVAILABLE", "typedFact": None,
                            "proposals": proposals[:16]}],
              "findings": None, "findingCount": None, "parameterCoverage": None,
              "typedFacts": None}
    result["contentHash"] = _hash(result)
    if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_RESULT_BYTES:
        raise ValueError("ZU-127 review output exceeds bound")
    return result
