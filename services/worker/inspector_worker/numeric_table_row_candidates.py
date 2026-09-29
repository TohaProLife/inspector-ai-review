"""Verified indexed geometry for one public PZ-002 table row.

This is a page-local reviewer observation, never a comparable fact or finding.
The source section, revision, approval, stage of mixed documents, and entity
link must be decided elsewhere.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping

from .candidate_family_rules import RULES_DIR
from .indexed_page_evidence import load_indexed_page_evidence
from .numeric_family_candidates import load_numeric_family_labels
from .public_document_index import get_indexed_page, load_public_manifest


TABLE_POLICY_PATH = RULES_DIR / "numeric-table-row-labels-v1.json"
_HASH = re.compile(r"[a-f0-9]{64}\Z")
_VALUE = re.compile(r"(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?\Z")


class NumericTableRowError(ValueError):
    """Table policy, public source, indexed page, or geometry is invalid."""


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _overlap(left: list[int], right: list[int]) -> bool:
    overlap = min(left[3], right[3]) - max(left[1], right[1])
    return overlap > 0 and overlap * 2 >= min(left[3] - left[1], right[3] - right[1])


def _role(line: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
        "bboxMilliPoints": line["bboxMilliPoints"], "text": line["text"],
        "lineTextSha256": hashlib.sha256(line["text"].encode()).hexdigest(),
    }


def load_numeric_table_policy(path: Path = TABLE_POLICY_PATH) -> dict[str, Any]:
    """A single literal, catalog-bound PZ-002 row pattern with a real sample."""
    base = load_numeric_family_labels()
    try:
        policy = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise NumericTableRowError("numeric table policy missing or invalid") from error
    if (not isinstance(policy, dict)
            or set(policy) != {"schemaVersion", "version", "disposition",
                               "publicManifestSha256", "parameterCode",
                               "attribute", "canonicalUnit", "label", "unit",
                               "verifiedSample"}
            or policy["schemaVersion"] != "numeric-table-row-labels-v1"
            or policy["version"] != "1"
            or policy["disposition"] != "REVIEW_ONLY_ABSTAIN"
            or policy["publicManifestSha256"] != base["publicManifestSha256"]
            or policy["parameterCode"] != "PZ-002"
            or policy["attribute"] != "BUILDING_TOTAL_AREA"
            or policy["canonicalUnit"] != "m2"
            or policy["label"] != "Общая площадь здания, в т.ч.:"
            or policy["unit"] != "м ²"):
        raise NumericTableRowError("numeric table policy is not pinned to PZ-002")
    sample = policy["verifiedSample"]
    if (not isinstance(sample, dict)
            or set(sample) != {"sourceFileId", "sourceSha256", "stage",
                               "manifestSection", "pageNumber",
                               "pageArtifactSha256", "roles", "sourceGate"}
            or sample["sourceFileId"] != "F0150"
            or sample["stage"] != "PD"
            or sample["manifestSection"] != "OTHER"
            or sample["pageNumber"] != 26
            or sample["sourceGate"] != "SECTION_UNRESOLVED"
            or any(not isinstance(sample.get(key), str)
                   or not _HASH.fullmatch(sample[key])
                   for key in ("sourceSha256", "pageArtifactSha256"))
            or not isinstance(sample["roles"], dict)
            or set(sample["roles"]) != {"label", "unit", "value"}):
        raise NumericTableRowError("numeric table sample source or page invalid")
    for role, text in (("label", policy["label"]), ("unit", policy["unit"]),
                       ("value", "11618,27")):
        item = sample["roles"][role]
        if (not isinstance(item, dict)
                or set(item) != {"blockIndex", "lineIndex", "bboxMilliPoints",
                                 "text", "lineTextSha256"}
                or any(type(item[name]) is not int or item[name] < 0
                       for name in ("blockIndex", "lineIndex"))
                or not isinstance(item["bboxMilliPoints"], list)
                or len(item["bboxMilliPoints"]) != 4
                or any(type(n) is not int or n < 0 for n in item["bboxMilliPoints"])
                or not (item["bboxMilliPoints"][0] < item["bboxMilliPoints"][2]
                        and item["bboxMilliPoints"][1] < item["bboxMilliPoints"][3])
                or item["text"] != text
                or hashlib.sha256(text.encode()).hexdigest() != item["lineTextSha256"]):
            raise NumericTableRowError(f"numeric table sample {role} invalid")
    if (not _overlap(sample["roles"]["label"]["bboxMilliPoints"],
                     sample["roles"]["unit"]["bboxMilliPoints"])
            or not _overlap(sample["roles"]["label"]["bboxMilliPoints"],
                            sample["roles"]["value"]["bboxMilliPoints"])):
        raise NumericTableRowError("numeric table sample row geometry invalid")
    return {**policy, "policySha256": _hash(policy)}


def observe_indexed_numeric_table_row(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    policy_path: Path = TABLE_POLICY_PATH,
) -> dict[str, Any]:
    """Observe one exact label/unit/value row; abstain on any ambiguity."""
    policy = load_numeric_table_policy(policy_path)
    try:
        before = manifest_path.read_bytes()
        rows = load_public_manifest(manifest_path)
    except (OSError, ValueError) as error:
        raise NumericTableRowError("public PDF manifest allowlist invalid") from error
    if manifest_path.read_bytes() != before or hashlib.sha256(before).hexdigest() != policy["publicManifestSha256"]:
        raise NumericTableRowError("public manifest changed or differs from pinned policy")
    source = next((row for row in rows if row["file_id"] == source_id), None)
    if (source is None or source_id == "F0194" or source["extension"] != ".pdf"
            or type(page_number) is not int or not 1 <= page_number <= source["pdf_pages"]):
        raise NumericTableRowError("source page outside public PDF allowlist")
    indexed = get_indexed_page(index_root, source_id, page_number)
    meta = indexed["source"]
    if (meta["status"] != "COMPLETE"
            or (meta["source_id"], meta["object_id"], meta["stage"],
                meta["section"], meta["source_sha256"], meta["relative_path"])
            != (source["file_id"], source["object_id"], source["stage"],
                source["section"], source["sha256"], source["relative_path"])):
        raise NumericTableRowError("indexed source differs from public manifest")
    page = indexed["page"]
    base = {
        "schemaVersion": "numeric-table-row-observation-v1",
        "status": "REVIEW_ONLY_ABSTAIN", "parameterCode": policy["parameterCode"],
        "attribute": policy["attribute"], "policySha256": policy["policySha256"],
        "manifestSha256": hashlib.sha256(before).hexdigest(),
        "sourceFileId": source_id, "sourceSha256": source["sha256"],
        "objectId": source["object_id"], "stage": source["stage"],
        "manifestSection": source["section"], "pageNumber": page_number,
        "qualityDisposition": page["quality"]["disposition"],
        "findingCount": None, "parameterCoverage": None,
    }
    if page["quality"]["disposition"] == "OCR_REQUIRED":
        return {**base, "reason": "OCR_REQUIRED", "row": None}
    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
        raise NumericTableRowError("indexed page quality unknown")
    lines = page["lines"]
    labels = [line for line in lines if line["text"] == policy["label"]]
    if len(labels) != 1:
        return {**base, "reason": ("NO_LITERAL_LABEL" if not labels else
                                  "MULTIPLE_LABEL_ROWS"), "row": None}
    label = labels[0]
    box = label["bboxMilliPoints"]
    units = [line for line in lines if line["text"] == policy["unit"]
             and box[2] < line["bboxMilliPoints"][0]
             and _overlap(box, line["bboxMilliPoints"])]
    values = [line for line in lines if _VALUE.fullmatch(line["text"])
              and box[2] < line["bboxMilliPoints"][0]
              and _overlap(box, line["bboxMilliPoints"])]
    pairs = [(unit, value) for unit in units for value in values
             if unit["bboxMilliPoints"][2] < value["bboxMilliPoints"][0]
             and _overlap(unit["bboxMilliPoints"], value["bboxMilliPoints"])]
    if len(pairs) != 1:
        return {**base, "reason": "MISSING_OR_AMBIGUOUS_ROW_CELLS", "row": None}
    unit, value = pairs[0]
    selected = sorted({label["blockIndex"], unit["blockIndex"], value["blockIndex"]})
    evidence = load_indexed_page_evidence(
        manifest_path, index_root, source_id, page_number,
        expected_object_id=source["object_id"], expected_stage=source["stage"],
        expected_section=source["section"], block_indices=selected)
    if (evidence["sourceSha256"] != source["sha256"]
            or evidence["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"
            or evidence["indexVersionHash"] != page["indexVersionHash"]):
        raise NumericTableRowError("selected page evidence changed")
    addressed = {(line["blockIndex"], line["lineIndex"]): line
                 for line in evidence["lines"]}
    for line in (label, unit, value):
        if addressed.get((line["blockIndex"], line["lineIndex"])) != line:
            raise NumericTableRowError("table role differs from SHA-checked page evidence")
    sample = policy["verifiedSample"]
    if source_id == sample["sourceFileId"] and page_number == sample["pageNumber"]:
        if (source["sha256"] != sample["sourceSha256"]
                or evidence["pageArtifactSha256"] != sample["pageArtifactSha256"]
                or {role: _role(line) for role, line in
                    (("label", label), ("unit", unit), ("value", value))}
                   != sample["roles"]):
            raise NumericTableRowError("real public table sample SHA/locator differs")
    if source["stage"] not in {"PD", "RD"}:
        source_gate = "INELIGIBLE_STAGE"
    elif source["stage"] == "RD" and source["section"] != "AR":
        source_gate = "INELIGIBLE_SECTION"
    elif source["stage"] == "PD":
        source_gate = "SECTION_UNRESOLVED"
    else:
        source_gate = "DRAWING_SECTION_UNVERIFIED"
    row = {
        "rawValue": value["text"], "rawUnit": unit["text"],
        "canonicalUnit": policy["canonicalUnit"],
        "label": policy["label"],
        "sourceGate": source_gate,
        "reviewGates": ["SOURCE_REVISION_UNRESOLVED",
                        "SOURCE_APPROVAL_UNRESOLVED",
                        "ENTITY_LINK_UNRESOLVED",
                        "DEFINITION_EQUIVALENCE_UNRESOLVED"],
        "pageArtifactSha256": evidence["pageArtifactSha256"],
        "pageEvidenceSha256": evidence["evidenceSha256"],
        "coordinateSystem": evidence["coordinateSystem"],
        "roles": {role: _role(line) for role, line in
                  (("label", label), ("unit", unit), ("value", value))},
    }
    row["rowEvidenceSha256"] = _hash(row)
    return {**base, "reason": "SOURCE_CONTEXT_UNRESOLVED", "row": row}
