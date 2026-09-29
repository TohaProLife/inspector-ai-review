"""Bounded, unclassified vector geometry proposals from an original PDF.

The red-panel/blue-contact pattern is a locator only. It cannot establish a
device class, room, sheet completeness, or verified absence of a device.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
import re
from typing import Literal

import fitz


PROPOSAL_STATUS = "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
CONTEXT_METHOD = "first-two-pdf-cover-text-pages-v1"
_COVER_HEADING = re.compile(r"^(?:РАБОЧАЯ|ПРОЕКТНАЯ)\s+ДОКУМЕНТАЦИЯ$", re.IGNORECASE)
_HEATING = re.compile(r"\bотоплени[еяию]\b", re.IGNORECASE)
_VENTILATION = re.compile(r"\bвентиляци[яиюе]\b", re.IGNORECASE)
MAX_PAGES = 1024
MAX_PROPOSALS = 500


def _selected_page_numbers(page_count: int, max_pages: int) -> list[int]:
    """Pick a fixed, spread-out page sample without inferring document semantics.

    Above the profile limit this is pages 1..8, N-7..N, and
    9 + floor((i + 0.5) * (N - 16) / (max_pages - 16)) for each middle slot.
    Integer math keeps selection identical across runtimes and repeat runs.
    """
    if page_count <= max_pages:
        return list(range(1, page_count + 1))
    edge_count = min(8, max_pages // 4)
    middle_count = max_pages - 2 * edge_count
    middle_size = page_count - 2 * edge_count
    middle = [
        edge_count + 1 + ((2 * index + 1) * middle_size) // (2 * middle_count)
        for index in range(middle_count)
    ]
    return (
        list(range(1, edge_count + 1))
        + middle
        + list(range(page_count - edge_count + 1, page_count + 1))
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _document_context(document: fitz.Document) -> dict:
    """Give source-level cover context only; never classify a page or proposal.

    Text extraction is limited to the first two pages and a short title window.
    A missing, corrupt, mixed, or unreadable title stays UNKNOWN.
    """
    pages = []
    domains: set[str] = set()
    for index in range(min(2, len(document))):
        text = document.load_page(index).get_text("text")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        title_window = None
        for line_index, line in enumerate(lines):
            if _COVER_HEADING.fullmatch(line):
                title_window = "\n".join(lines[line_index:line_index + 6])[:500]
                break
        pages.append({
            "pageNumber": index + 1,
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "titleWindow": title_window,
        })
        if title_window:
            if _HEATING.search(title_window):
                domains.add("HEATING")
            if _VENTILATION.search(title_window):
                domains.add("VENTILATION")
    status = next(iter(domains)) if len(domains) == 1 else "UNKNOWN"
    return {
        "schemaVersion": "document-context-v1",
        "methodId": CONTEXT_METHOD,
        "status": status,
        "reasonCode": "TITLE_KEYWORD_MATCH" if len(domains) == 1
        else "TITLE_CONFLICT" if len(domains) > 1 else "NO_TITLE_KEYWORD_MATCH",
        "inspectedPages": pages,
    }


def _color_matches(color: object, channel: int) -> bool:
    if not isinstance(color, (tuple, list)) or len(color) < 3:
        return False
    try:
        values = tuple(float(value) for value in color[:3])
    except (TypeError, ValueError):
        return False
    return all(math.isfinite(value) for value in values) and (
        values[channel] > 0.8
        and all(values[index] < 0.2 for index in range(3) if index != channel)
    )


def _geometry_on_page(page: fitz.Page) -> list[fitz.Rect]:
    panels: list[fitz.Rect] = []
    blue_endpoints: list[fitz.Point] = []
    for drawing in page.get_drawings():
        color = drawing.get("color")
        if _color_matches(color, 0):
            rect = drawing.get("rect")
            if not isinstance(rect, fitz.Rect) or rect.is_empty or rect.is_infinite:
                continue
            # Broad shape gate, independent of a labelled template or source ID.
            if 2 < rect.width < 25 and 15 < rect.height < 120 and rect.height / rect.width > 2:
                panels.append(rect)
        elif _color_matches(color, 2):
            for item in drawing.get("items", ()):
                if len(item) >= 3 and item[0] == "l":
                    blue_endpoints.extend((fitz.Point(item[1]), fitz.Point(item[2])))

    selected: list[fitz.Rect] = []
    for rect in sorted(panels, key=lambda item: (item.y0, item.x0, item.y1, item.x1)):
        contact = any(
            min(abs(point.x - rect.x0), abs(point.x - rect.x1)) < 3
            and rect.y0 < point.y < rect.y1
            for point in blue_endpoints
        )
        if contact and not any(
            abs(rect.x0 - previous.x0) < 1
            and abs(rect.y0 - previous.y0) < 1
            and abs(rect.x1 - previous.x1) < 1
            and abs(rect.y1 - previous.y1) < 1
            for previous in selected
        ):
            selected.append(rect)
    return selected


def _normalized_bbox(page: fitz.Page, rect: fitz.Rect) -> list[float] | None:
    # get_drawings() uses unrotated coordinates; page.rect uses displayed size.
    displayed = rect * page.rotation_matrix
    bounds = page.rect
    if bounds.is_empty or not all(math.isfinite(value) for value in displayed):
        return None
    x0 = max(bounds.x0, displayed.x0)
    y0 = max(bounds.y0, displayed.y0)
    x1 = min(bounds.x1, displayed.x1)
    y1 = min(bounds.y1, displayed.y1)
    if x0 >= x1 or y0 >= y1:
        return None
    result = [
        round((x0 - bounds.x0) / bounds.width, 6),
        round((y0 - bounds.y0) / bounds.height, 6),
        round((x1 - bounds.x0) / bounds.width, 6),
        round((y1 - bounds.y0) / bounds.height, 6),
    ]
    if not (0 <= result[0] < result[2] <= 1 and 0 <= result[1] < result[3] <= 1):
        return None
    return result


def scan_pdf(
    path: Path,
    source_file_id: str,
    source_sha256: str,
    *,
    max_pages: int | None = None,
    max_proposals: int = MAX_PROPOSALS,
    profile_version: Literal["v1", "v2", "v3", "v4", "v5", "v6"] = "v3",
) -> dict:
    """Return geometry proposals; never classify or assert absence.

    v1 skips a PDF above ``max_pages``. v2 and v3 scan a deterministic
    subset above their own limits and state exactly which pages were inspected.
    ``proposalLimitReached``
    discloses truncation among scanned pages, never among skipped pages.
    """
    if not source_file_id or not isinstance(source_file_id, str):
        raise ValueError("source_file_id is required")
    if not isinstance(source_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
        raise ValueError("source_sha256 must be a lowercase SHA-256 digest")
    if profile_version not in ("v1", "v2", "v3", "v4", "v5", "v6"):
        raise ValueError("profile_version must be v1, v2, v3, v4, v5 or v6")
    profile_max_pages = 64 if profile_version in ("v1", "v2") else MAX_PAGES
    if max_pages is None:
        max_pages = profile_max_pages
    if type(max_pages) is not int or not 1 <= max_pages <= profile_max_pages:
        raise ValueError(f"max_pages must be between 1 and {profile_max_pages}")
    if type(max_proposals) is not int or not 1 <= max_proposals <= MAX_PROPOSALS:
        raise ValueError(f"max_proposals must be between 1 and {MAX_PROPOSALS}")
    if _sha256(path) != source_sha256:
        raise ValueError("source PDF SHA-256 mismatch")

    with fitz.open(path) as document:
        if not document.is_pdf or document.needs_pass:
            raise ValueError("source must be an unencrypted PDF")
        page_count = len(document)
        skipped_for_v1 = profile_version == "v1" and page_count > max_pages
        result = {
            "sourceFileId": source_file_id,
            "sourceSha256": source_sha256,
            "pageCount": page_count,
            "scannedPageCount": 0,
            "status": "SKIPPED_PAGE_LIMIT" if skipped_for_v1 else "SCANNED",
            "proposals": [],
            "proposalLimitReached": False,
            "unretainedProposalCount": 0,
        }
        if profile_version in ("v4", "v5", "v6"):
            result["documentContext"] = _document_context(document)
        if skipped_for_v1:
            return result

        page_numbers = _selected_page_numbers(page_count, max_pages)
        if profile_version in ("v2", "v3", "v4", "v5", "v6"):
            result["scannedPageNumbers"] = page_numbers
            result["skippedPageCount"] = page_count - len(page_numbers)
            if result["skippedPageCount"]:
                result["status"] = "PARTIALLY_SCANNED_PAGE_LIMIT"

        found = 0
        for page_number in page_numbers:
            page = document.load_page(page_number - 1)
            for rect in _geometry_on_page(page):
                bbox = _normalized_bbox(page, rect)
                if bbox is None:
                    continue
                found += 1
                if len(result["proposals"]) < max_proposals:
                    result["proposals"].append({
                        "pageNumber": page_number,
                        "bboxNormalized": bbox,
                        "status": PROPOSAL_STATUS,
                    })
            result["scannedPageCount"] += 1
        result["unretainedProposalCount"] = found - len(result["proposals"])
        result["proposalLimitReached"] = result["unretainedProposalCount"] > 0
        return result
