"""Conservative numeric observations from one verified public index page.

The caller supplies exact domain labels. This module never assigns an entity,
links documents, or concludes that a missing label means a missing element.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping, Sequence


_NUMBER = r"(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?"
_SHA = re.compile(r"[0-9a-f]{64}\Z")


def _sha(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _pattern(label: str, aliases: Sequence[str]) -> re.Pattern[str]:
    if not isinstance(label, str) or not label.strip() or len(label) > 120:
        raise ValueError("quantity label must be a bounded literal")
    if (not isinstance(aliases, Sequence) or isinstance(aliases, (str, bytes))
            or not aliases or any(not isinstance(unit, str) or not unit.strip() or len(unit) > 32
                           for unit in aliases)):
        raise ValueError("quantity units must be bounded literals")
    units = "|".join(re.escape(unit) for unit in sorted(aliases, key=len, reverse=True))
    # A whole physical line can be accepted only when a single value is bound
    # directly to the complete label and a named unit. Other columns abstain.
    return re.compile(r"^\s*" + re.escape(label) + r"\s*(?:[:=—–-]\s*|\s+)"
                      + rf"(?P<value>{_NUMBER})\s*(?P<unit>{units})\s*[.;]?\s*$",
                      re.IGNORECASE)


def extract_labeled_numeric_rows(
    evidence: Mapping[str, Any],
    definitions: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Return page-local candidates with exact line provenance and SHA.

    ``definitions`` maps an attribute to ``label`` and ``unitAliases``. It is
    source-specific policy, not a permission to infer entity or revision.
    """
    if (not isinstance(evidence, Mapping)
            or evidence.get("schemaVersion") != "indexed-page-evidence-v1"
            or evidence.get("candidateStatus") != "CANDIDATE"
            or evidence.get("quality", {}).get("disposition") != "TEXT_LAYER_CANDIDATE"
            or not isinstance(evidence.get("evidenceSha256"), str)
            or _SHA.fullmatch(evidence["evidenceSha256"]) is None
            or not isinstance(evidence.get("lines"), list)):
        raise ValueError("verified text-layer page evidence is required")
    unsigned = {key: value for key, value in evidence.items() if key != "evidenceSha256"}
    if _sha(unsigned) != evidence["evidenceSha256"]:
        raise ValueError("page evidence hash mismatch")
    if not isinstance(definitions, Mapping) or not definitions:
        raise ValueError("at least one quantity definition is required")
    compiled: list[tuple[str, re.Pattern[str]]] = []
    for attribute, definition in definitions.items():
        if not isinstance(attribute, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,79}", attribute):
            raise ValueError("invalid quantity attribute")
        if not isinstance(definition, Mapping):
            raise ValueError("quantity definition must be an object")
        compiled.append((attribute, _pattern(definition.get("label"), definition.get("unitAliases", ()))))
    results: list[dict[str, Any]] = []
    for line in evidence["lines"]:
        if not isinstance(line, Mapping) or not isinstance(line.get("text"), str):
            raise ValueError("indexed line is invalid")
        matches = [(attribute, match) for attribute, expression in compiled
                   if (match := expression.fullmatch(line["text"])) is not None]
        if len(matches) != 1:
            continue
        attribute, match = matches[0]
        locator = {"kind": "INDEXED_LINE", "blockIndex": line["blockIndex"],
                   "lineIndex": line["lineIndex"], "bboxMilliPoints": line["bboxMilliPoints"],
                   "valueStart": match.start("value"), "valueEnd": match.end("value")}
        result = {
            "schemaVersion": "indexed-numeric-row-v1", "status": "CANDIDATE",
            "sourceFileId": evidence["sourceFileId"], "sourceSha256": evidence["sourceSha256"],
            "objectId": evidence["objectId"], "stage": evidence["stage"],
            "section": evidence["section"], "pageNumber": evidence["pageNumber"],
            "pageArtifactSha256": evidence["pageArtifactSha256"],
            "pageEvidenceSha256": evidence["evidenceSha256"],
            "parserProvenance": evidence["parserProvenance"],
            "attribute": attribute, "lineText": line["text"],
            "rawValue": match.group("value"), "rawUnit": match.group("unit"),
            "locator": locator,
        }
        result["candidateSha256"] = _sha(result)
        results.append(result)
    return results
