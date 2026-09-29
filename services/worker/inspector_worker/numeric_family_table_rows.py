"""Exact geometric table-row observations for all 31 numeric candidate codes.

An observed row is a reviewer lead only. Stage/section gates are descriptive;
this module cannot establish a drawing mark, entity, revision, approval,
denominator, or comparability.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Mapping

from .indexed_page_evidence import load_indexed_page_evidence
from .numeric_family_candidates import load_numeric_family_labels
from .numeric_table_row_candidates import (
    _VALUE, _hash, _overlap, _role, load_numeric_table_policy,
)
from .public_document_index import get_indexed_page, load_public_manifest


_HASH = re.compile(r"[a-f0-9]{64}\Z")


class NumericFamilyTableError(ValueError):
    """Public source, pinned policy, indexed row, or provenance failed closed."""


def _definitions(policy: dict[str, Any], special: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for entry in policy["entries"]:
        for attribute in entry["attributes"]:
            for label in attribute["labels"]:
                result.append({
                    "parameterCode": entry["parameterCode"],
                    "attribute": attribute["key"], "canonicalUnit": attribute["canonicalUnit"],
                    "label": label, "unitAliases": attribute["unitAliases"],
                    "policyKind": "NUMERIC_FAMILY_LITERAL",
                })
    result.append({
        "parameterCode": special["parameterCode"], "attribute": special["attribute"],
        "canonicalUnit": special["canonicalUnit"], "label": special["label"],
        "unitAliases": [special["unit"]], "policyKind": "VERIFIED_PUBLIC_TABLE_SAMPLE",
    })
    return result


def _source_gate(rule: Mapping[str, Any], stage: str, section: str) -> str:
    if stage == rule["expectedStage"]:
        side = "expected"
    elif stage in rule["allowedActualStages"]:
        side = "actual"
    else:
        return "INELIGIBLE_STAGE"
    if rule["manifestSectionStatus"][side] == "UNKNOWN_ABSTAIN":
        return "SECTION_UNRESOLVED"
    if section not in rule[f"required{side.title()}Sections"]:
        return "INELIGIBLE_MANIFEST_SECTION"
    return "DRAWING_SECTION_UNVERIFIED"


def _matched_labels(lines: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    # Only exact policy text or its terminal colon are accepted. The special
    # public sample already contains a colon and is not broadened further.
    alternatives = {label, label + ":"} if not label.endswith(":") else {label}
    return [line for line in lines if line["text"] in alternatives]


def _row_pairs(lines: list[dict[str, Any]], label: dict[str, Any],
               aliases: list[str]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    box = label["bboxMilliPoints"]
    units = [line for line in lines if line["text"] in aliases
             and box[2] < line["bboxMilliPoints"][0]
             and _overlap(box, line["bboxMilliPoints"])]
    values = [line for line in lines if _VALUE.fullmatch(line["text"])
              and box[2] < line["bboxMilliPoints"][0]
              and _overlap(box, line["bboxMilliPoints"])]
    return [(unit, value) for unit in units for value in values
            if unit["bboxMilliPoints"][2] < value["bboxMilliPoints"][0]
            and _overlap(unit["bboxMilliPoints"], value["bboxMilliPoints"])]


def observe_indexed_numeric_family_table_rows(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    max_label_rows: int = 64,
) -> dict[str, Any]:
    """Read one SHA-checked page; return bounded row observations or abstentions."""
    if type(max_label_rows) is not int or not 1 <= max_label_rows <= 128:
        raise NumericFamilyTableError("label row limit invalid")
    policy = load_numeric_family_labels()
    special = load_numeric_table_policy()
    try:
        manifest_bytes = manifest_path.read_bytes()
        rows = load_public_manifest(manifest_path)
    except (OSError, ValueError) as error:
        raise NumericFamilyTableError("public PDF manifest allowlist invalid") from error
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if (manifest_path.read_bytes() != manifest_bytes
            or manifest_sha != policy["publicManifestSha256"]
            or manifest_sha != special["publicManifestSha256"]):
        raise NumericFamilyTableError("public manifest differs from pinned policy")
    source = next((row for row in rows if row["file_id"] == source_id), None)
    if (source is None or source_id == "F0194" or source["extension"] != ".pdf"
            or type(page_number) is not int or not 1 <= page_number <= source["pdf_pages"]):
        raise NumericFamilyTableError("source page outside public PDF allowlist")
    indexed = get_indexed_page(index_root, source_id, page_number)
    meta = indexed["source"]
    if (meta["status"] != "COMPLETE"
            or (meta["source_id"], meta["object_id"], meta["stage"],
                meta["section"], meta["source_sha256"], meta["relative_path"])
            != (source["file_id"], source["object_id"], source["stage"],
                source["section"], source["sha256"], source["relative_path"])):
        raise NumericFamilyTableError("indexed source differs from public manifest")
    page = indexed["page"]
    disposition = page["quality"]["disposition"]
    if disposition not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}:
        raise NumericFamilyTableError("indexed page quality unknown")
    base = {
        "schemaVersion": "numeric-family-table-observations-v1",
        "status": "REVIEW_ONLY_ABSTAIN",
        "sourceFileId": source_id, "sourceSha256": source["sha256"],
        "manifestSha256": manifest_sha, "objectId": source["object_id"],
        "stage": source["stage"], "manifestSection": source["section"],
        "pageNumber": page_number, "qualityDisposition": disposition,
        "labelPackSha256": policy["labelPackSha256"],
        "tablePolicySha256": special["policySha256"],
        "findingCount": None, "parameterCoverage": None,
    }
    if disposition == "OCR_REQUIRED":
        return {**base, "reason": "OCR_REQUIRED", "labelRowsSeen": 0,
                "observations": []}
    lines = page["lines"]
    definitions = _definitions(policy, special)
    by_attribute: dict[tuple[str, str], list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    for definition in definitions:
        for line in _matched_labels(lines, definition["label"]):
            by_attribute[(definition["parameterCode"], definition["attribute"])].append(
                (definition, line))
    count = sum(len(items) for items in by_attribute.values())
    if count > max_label_rows:
        raise NumericFamilyTableError("page exceeds bounded exact label rows")
    observations = []
    sample = special["verifiedSample"]
    sample_seen = False
    for (code, attribute), matches in sorted(by_attribute.items()):
        gate = _source_gate(policy["rules"][code], source["stage"], source["section"])
        if len(matches) != 1:
            observations.append({
                "parameterCode": code, "attribute": attribute,
                "status": "ABSTAIN_MULTIPLE_LABEL_ROWS",
                "labelRows": [_role(line) for _, line in matches],
                "sourceGate": gate, "row": None,
            })
            continue
        definition, label = matches[0]
        pairs = _row_pairs(lines, label, definition["unitAliases"])
        if len(pairs) != 1:
            observations.append({
                "parameterCode": code, "attribute": attribute,
                "status": "ABSTAIN_MISSING_OR_AMBIGUOUS_CELLS",
                "labelRows": [_role(label)], "sourceGate": gate,
                "pairCount": len(pairs), "row": None,
            })
            continue
        unit, value = pairs[0]
        selected = sorted({label["blockIndex"], unit["blockIndex"], value["blockIndex"]})
        evidence = load_indexed_page_evidence(
            manifest_path, index_root, source_id, page_number,
            expected_object_id=source["object_id"], expected_stage=source["stage"],
            expected_section=source["section"], block_indices=selected)
        if (evidence["sourceSha256"] != source["sha256"]
                or evidence["indexVersionHash"] != page["indexVersionHash"]
                or not isinstance(evidence["pageArtifactSha256"], str)
                or not _HASH.fullmatch(evidence["pageArtifactSha256"])):
            raise NumericFamilyTableError("selected page evidence differs from public index")
        addressed = {(line["blockIndex"], line["lineIndex"]): line
                     for line in evidence["lines"]}
        if any(addressed.get((line["blockIndex"], line["lineIndex"])) != line
               for line in (label, unit, value)):
            raise NumericFamilyTableError("table role differs from SHA-checked page evidence")
        roles = {role: _role(line) for role, line in
                 (("label", label), ("unit", unit), ("value", value))}
        if ((source_id, page_number) == (sample["sourceFileId"], sample["pageNumber"])
                and definition["policyKind"] == "VERIFIED_PUBLIC_TABLE_SAMPLE"):
            if (source["sha256"] != sample["sourceSha256"]
                    or evidence["pageArtifactSha256"] != sample["pageArtifactSha256"]
                    or roles != sample["roles"]):
                raise NumericFamilyTableError("verified F0150 table sample SHA/roles differ")
            sample_seen = True
        row = {
            "rawValue": value["text"], "rawUnit": unit["text"],
            "canonicalUnit": definition["canonicalUnit"],
            "label": label["text"], "policyKind": definition["policyKind"],
            "pageArtifactSha256": evidence["pageArtifactSha256"],
            "pageEvidenceSha256": evidence["evidenceSha256"],
            "coordinateSystem": evidence["coordinateSystem"],
            "roles": roles,
        }
        row["rowEvidenceSha256"] = _hash(row)
        observations.append({
            "parameterCode": code, "attribute": attribute,
            "status": "REVIEW_ONLY_ABSTAIN", "sourceGate": gate,
            "reviewGates": ["DRAWING_SECTION_REVIEW_REQUIRED",
                            "SOURCE_REVISION_UNRESOLVED",
                            "SOURCE_APPROVAL_UNRESOLVED",
                            "ENTITY_LINK_UNRESOLVED",
                            "DEFINITION_EQUIVALENCE_UNRESOLVED"],
            "row": row,
        })
    if (source_id, page_number) == (sample["sourceFileId"], sample["pageNumber"]) and not sample_seen:
        raise NumericFamilyTableError("verified F0150 table sample not recovered")
    return {**base, "reason": "PAGE_LOCAL_REVIEW_ONLY",
            "labelRowsSeen": count, "observations": observations}
