"""Complete-source column/pylon raw literals, with no engineering authority."""
from __future__ import annotations

import copy
import re

from .document_text_v3 import read_document_text_v3_large_artifact

_SCHEMA = "column-pylon-dimension-literals-v1"
_POLICY = "document-text-v3-large-source-bounds-v1"
_LITERAL = re.compile(
    r"(?P<kind>Колонна|Пилон) (?P<first>[1-9][0-9]{0,8})х"
    r"(?P<second>[1-9][0-9]{0,8})(?P<unit>мм) "
    r"(?P<level>[+-]?(?:0|[1-9][0-9]{0,3})) этаж \[(?P<scope>[^\[\]]{1,200})\]"
)
_TOKENS = ("kind", "first", "second", "unit", "level", "scope")
# Frozen codepoint set, independent of host Unicode whitespace tables.
_WS = frozenset(
    list(range(0x09, 0x0E)) + list(range(0x1C, 0x21))
    + [0x85, 0xA0, 0x1680] + list(range(0x2000, 0x200B))
    + [0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
)


def _abstain(reason: str) -> dict:
    return {"schemaVersion": _SCHEMA, "resourcePolicyVersion": _POLICY,
            "status": "ABSTAIN", "reasonCode": reason}


def _literal(raw: str):
    if len(raw) > 8192:
        return None
    terminal = raw[:-1] if raw.endswith("\n") else raw
    start = len(terminal) - len(terminal.lstrip(" "))
    view = terminal.strip(" ")
    match = _LITERAL.fullmatch(view)
    if match is None:
        return None
    scope = match.group("scope")
    if scope.startswith(" ") or scope.endswith(" "):
        return None
    if any(ord(c) <= 0x1F or 0x7F <= ord(c) <= 0x9F
           or ord(c) in (0x2028, 0x2029, 0xFFFD) for c in scope):
        return None
    if not any(ord(c) not in _WS for c in scope):
        return None
    tokens = {name: {"raw": match.group(name),
                     "rangeCodePoints": [start + match.start(name),
                                         start + match.end(name)]}
              for name in _TOKENS}
    return [start, start + len(view)], tokens


def extract_column_pylon_dimension_literals(value: object) -> dict:
    """Validate the complete artifact before inspecting any page or literal."""
    admitted = read_document_text_v3_large_artifact(value)
    if admitted["status"] != "VALID":
        return _abstain(admitted["reasonCode"])

    literals = []
    excluded = []
    for page in value["pages"]:
        reason = ("UNLOCATED_RECORDS" if page["unlocatedLines"] else
                  "PAGE_NOT_CANDIDATE" if page["quality"]["disposition"] !=
                  "TEXT_LAYER_CANDIDATE" else None)
        if reason is not None:
            excluded.append({"pageNumber": page["pageNumber"], "reasonCode": reason})
            continue
        for line in page["locatedLines"]:
            parsed = _literal(line["rawText"])
            if parsed is None:
                continue
            if len(literals) == 128:
                return _abstain("INPUT_LIMIT")
            used_range, tokens = parsed
            literals.append({
                "pageNumber": page["pageNumber"],
                "sourcePath": copy.deepcopy(line["sourcePath"]),
                "rawText": line["rawText"],
                "nativeBoxPointStrings": copy.deepcopy(line["nativeBoxPointStrings"]),
                "bboxMilliPoints": copy.deepcopy(line["bboxMilliPoints"]),
                "pageFrame": {"widthMilliPoints": page["widthMilliPoints"],
                              "heightMilliPoints": page["heightMilliPoints"],
                              "nativeFrame": copy.deepcopy(page["nativeFrame"])},
                "usedTextRangeCodePoints": used_range,
                "tokens": tokens,
                "sourceOnly": True,
                "calibratedProbability": None,
                "rectangleStatus": "UNVERIFIED",
                "grossSectionStatus": "UNVERIFIED",
                "physicalMemberStatus": "UNVERIFIED",
                "applicabilityStatus": "UNVERIFIED",
                "renderedVisibilityStatus": "UNVERIFIED",
            })
    return {"schemaVersion": _SCHEMA, "resourcePolicyVersion": _POLICY,
            "status": "SOURCE_LITERALS", "sourceFileId": value["sourceFileId"],
            "inputSha256": value["inputSha256"],
            "sourceArtifactContentHash": admitted["contentHash"],
            "extractorProfile": copy.deepcopy(value["extractorProfile"]),
            "extractorProfileHash": value["extractorProfileHash"],
            "literals": literals, "excludedPages": excluded}
