"""Narrow, evidence-preserving text extraction for the PZ-002 pilot."""

from __future__ import annotations

import re
from typing import Any


_BUILDING_AREA = re.compile(
    r"(?<!\w)общая[ \t]+площадь[ \t]+здания(?!\w)"
    r"[ \t\r\n:;=—–-]{0,24}"
    r"(?P<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)"
    r"[ \t\r\n]*"
    r"(?P<unit>(?:мм|см|м|mm|cm|m)[²2]|кв\.?[ \t]*м\.?)"
    r"(?!\w)",
    re.IGNORECASE | re.UNICODE,
)

# Real project PDFs also place the unit before the value in a TEP table, or
# insert an area variable between the label and value. Keep both shapes tied
# to the complete building-area label; nearby floor/plot areas are different facts.
_BUILDING_AREA_TABLE = re.compile(
    r"(?<!\w)общая[ \t]+площадь[ \t]+здания(?!\w)"
    r"[ \t]*,[ \t]*в[ \t]+т\.?[ \t]*ч\.?:?[ \t\r\n]*"
    r"(?P<unit>(?:мм|см|м|mm|cm|m)[ \t]*[²2]|кв\.?[ \t]*м\.?)"
    r"[ \t\r\n]{1,24}"
    r"(?P<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)"
    r"(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
_BUILDING_AREA_VARIABLE = re.compile(
    r"(?<!\w)общая[ \t]+площадь[ \t]+здания(?!\w)"
    r"[ \t]+S[ \t]*=[ \t]*"
    r"(?P<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)"
    r"[ \t\r\n]*"
    r"(?P<unit>(?:мм|см|м|mm|cm|m)[ \t]*[²2]|кв\.?[ \t]*м\.?)"
    r"(?!\w)",
    re.IGNORECASE | re.UNICODE,
)


def building_area_matches(text: str) -> list[re.Match[str]]:
    matches = [match for pattern in (_BUILDING_AREA, _BUILDING_AREA_TABLE, _BUILDING_AREA_VARIABLE)
               for match in pattern.finditer(text)]
    return sorted(matches, key=lambda match: (match.start(), match.end()))


def extract_pz_002_facts(
    route_result: dict[str, Any],
    artifacts: list[dict[str, Any]],
    *,
    entity_key: str,
) -> list[dict[str, Any]]:
    """Read only routed text blocks; ambiguous extractions remain separate facts."""
    if (not isinstance(route_result, dict) or route_result.get("schemaVersion") != "parameter-route-result-v1"
            or route_result.get("parameterCode") != "PZ-002"
            or route_result.get("disposition") != "NAVIGATION_ONLY"):
        raise ValueError("PZ-002 extraction requires a matching navigation result")
    if not isinstance(entity_key, str) or not entity_key.strip():
        raise ValueError("entity_key is required")
    if not isinstance(artifacts, list):
        raise ValueError("artifacts must be an array")
    artifact_index = {item["sourceFileId"]: item for item in artifacts}
    if len(artifact_index) != len(artifacts):
        raise ValueError("duplicate text artifact sourceFileId")
    facts: list[dict[str, Any]] = []
    for stage in route_result["stages"]:
        for candidate in stage["candidates"]:
            artifact = artifact_index.get(candidate["sourceFileId"])
            if artifact is None or artifact.get("inputSha256") != candidate["inputSha256"]:
                raise ValueError("routed candidate has no matching text artifact")
            page_number = candidate["pageNumber"]
            if type(page_number) is not int or page_number < 1 or page_number > artifact["pageCount"]:
                raise ValueError("routed candidate page is invalid")
            page = artifact["pages"][page_number - 1]
            if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                raise ValueError("routed candidate has no qualified text layer")
            for block_index in candidate["blockIndexes"]:
                if type(block_index) is not int or block_index < 0 or block_index >= len(page["blocks"]):
                    raise ValueError("routed candidate block is invalid")
                block = page["blocks"][block_index]
                for match in building_area_matches(block["text"]):
                    facts.append({
                        "sourceFileId": candidate["sourceFileId"],
                        "inputSha256": candidate["inputSha256"],
                        "pageNumber": page_number,
                        "blockIndex": block_index,
                        "entityKey": entity_key.strip(),
                        "rawValue": match.group("value"),
                        "rawUnit": match.group("unit"),
                        "unit": match.group("unit").replace(" ", "").replace("\u00a0", "").rstrip("."),
                        "extractionProfile": "pz-002-text-label-v1",
                    })
    return facts
