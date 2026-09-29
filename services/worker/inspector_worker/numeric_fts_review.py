"""Validate manual, SHA-bound review of public numeric FTS page contexts.

This records why a literal-label page remains abstained. It never promotes a
line, table cell, or OCR gap to an engineering fact.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from typing import Any


CATEGORIES = frozenset({
    "EXACT_TABLE_ROW_REVIEW_ONLY",
    "INLINE_SOURCE_GATE_UNRESOLVED",
    "INLINE_DEFINITION_UNRESOLVED",
    "MULTICELL_MULTIENTITY_TABLE",
    "TABLE_HEADER_NO_DIRECT_VALUE",
    "MENTION_OR_DIFFERENT_DEFINITION",
})


def classify_numeric_fts_context(context: dict[str, Any], policy: dict[str, Any],
                                 *, expected_pages: int = 29) -> dict[str, Any]:
    """Require one addressed classification and SHA-backed anchor per page."""
    if (not isinstance(context, dict) or context.get("schemaVersion") != "numeric-fts-page-review-v1"
            or context.get("status") != "CONTEXT_CAPTURED_REVIEW_REQUIRED"
            or not isinstance(context.get("pages"), list)
            or context.get("pageCount") != len(context["pages"])
            or len(context["pages"]) != expected_pages
            or context.get("findingCount") is not None
            or context.get("parameterCoverage") is not None):
        raise ValueError("complete unpromoted numeric FTS context required")
    if (not isinstance(policy, dict)
            or set(policy) != {"schemaVersion", "status", "contextReportSha256",
                               "ftsReportSha256", "classifications"}
            or policy["schemaVersion"] != "numeric-fts-review-v1"
            or policy["status"] != "REVIEW_ONLY_ABSTAIN"
            or not isinstance(policy["classifications"], list)
            or len(policy["classifications"]) != expected_pages):
        raise ValueError("complete numeric review policy required")
    pages = {}
    for page in context["pages"]:
        address = (page["sourceFileId"], page["pageNumber"])
        if address in pages:
            raise ValueError("duplicate numeric FTS context page")
        pages[address] = page
    classified = []
    seen = set()
    for entry in policy["classifications"]:
        if (not isinstance(entry, dict)
                or set(entry) != {"sourceFileId", "pageNumber", "candidateCodes",
                                  "category", "reason", "anchors"}
                or entry["category"] not in CATEGORIES
                or not isinstance(entry["reason"], str)
                or not 10 <= len(entry["reason"].strip()) <= 400
                or not isinstance(entry["anchors"], list)
                or not 1 <= len(entry["anchors"]) <= 12):
            raise ValueError("invalid numeric FTS review classification")
        address = (entry["sourceFileId"], entry["pageNumber"])
        if address in seen or address not in pages:
            raise ValueError("numeric FTS review page missing or duplicate")
        seen.add(address)
        page = pages[address]
        codes = sorted({label["parameterCode"] for label in page["labels"]})
        if entry["candidateCodes"] != codes:
            raise ValueError("review candidate codes differ from FTS labels")
        if (entry["category"] == "EXACT_TABLE_ROW_REVIEW_ONLY") != (address == ("F0150", 26)) and expected_pages == 29:
            raise ValueError("verified F0150 row classification missing or misplaced")
        if any(label["contextLinesOmitted"] != 0 or not label["lineSpans"]
               for label in page["labels"]):
            raise ValueError("FTS label context incomplete or unlocalized")
        locators: dict[tuple[int, int], dict[str, Any]] = {}
        for label in page["labels"]:
            for line in label["context"]:
                key = (line["blockIndex"], line["lineIndex"])
                if (line["pageArtifactSha256"] != page["pageArtifactSha256"]
                        or hashlib.sha256(line["text"].encode("utf-8")).hexdigest()
                        != line["lineTextSha256"]):
                    raise ValueError("numeric FTS review line SHA differs")
                if key in locators and locators[key] != line:
                    raise ValueError("numeric FTS review line locator conflicts")
                locators[key] = line
        anchors = []
        anchored = set()
        for raw in entry["anchors"]:
            if (not isinstance(raw, list) or len(raw) != 2
                    or any(type(number) is not int or number < 0 for number in raw)):
                raise ValueError("invalid numeric FTS anchor address")
            key = tuple(raw)
            if key in anchored or key not in locators:
                raise ValueError("numeric FTS review anchor missing or duplicate")
            anchored.add(key)
            anchors.append(locators[key])
        classified.append({
            "sourceFileId": address[0], "pageNumber": address[1],
            "sourceSha256": page["sourceSha256"],
            "pageArtifactSha256": page["pageArtifactSha256"],
            "stage": page["stage"], "manifestSection": page["manifestSection"],
            "candidateCodes": codes, "category": entry["category"],
            "reason": entry["reason"], "anchors": anchors,
            "status": "REVIEW_ONLY_ABSTAIN",
        })
    if seen != set(pages):
        raise ValueError("numeric FTS review omitted page")
    counts = Counter(item["category"] for item in classified)
    return {"schemaVersion": "numeric-fts-classification-v1",
            "status": "COMPLETE_REVIEW_ONLY_ABSTAIN",
            "scope": context["scope"], "manifestSha256": context["manifestSha256"],
            "auditReportSha256": context["auditReportSha256"],
            "contextReportSha256": policy["contextReportSha256"],
            "ftsReportSha256": policy["ftsReportSha256"],
            "pageCount": len(classified),
            "withoutExactTableRowPages": sum(item["category"] != "EXACT_TABLE_ROW_REVIEW_ONLY"
                                             for item in classified),
            "categoryCounts": dict(sorted(counts.items())),
            "pages": classified, "findingCount": None, "parameterCoverage": None}
