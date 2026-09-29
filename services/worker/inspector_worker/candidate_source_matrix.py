"""Offline source planning for definition-only candidate rules.

Manifest categories are coarse. This module never reads document bodies,
infers drawing marks, pairs facts, or changes parameter coverage.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from pathlib import Path
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .public_document_index import load_public_manifest


PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
PUBLIC_SOURCE_COUNT = 203
PUBLIC_PDF_COUNT = 202
PUBLIC_PAGE_COUNT = 10_142
PUBLIC_TXT_ID = "F0194"
ALLOWED_STAGES = {"PD", "RD", "ID", "RD_ID_MIXED", "UNKNOWN"}
ALLOWED_SECTIONS = {"OTHER", "KR", "VK", "OV", "SS", "POS", "AR", "GP", "EOM", "PB"}


def _validate_inventory(manifest_path: Path, expected_sha256: str) -> list[dict[str, Any]]:
    actual_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if actual_sha != expected_sha256:
        raise ValueError("public manifest SHA-256 differs from pinned inventory")
    rows = load_public_manifest(manifest_path)
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    txt = [row for row in rows if row["extension"] == ".txt"]
    if (len(rows) != PUBLIC_SOURCE_COUNT or len(pdfs) != PUBLIC_PDF_COUNT
            or sum(row["pdf_pages"] for row in pdfs) != PUBLIC_PAGE_COUNT
            or len(txt) != 1 or txt[0]["file_id"] != PUBLIC_TXT_ID
            or txt[0].get("annotation_status") != "GROUND_TRUTH_INDEX"):
        raise ValueError("public source inventory differs from pinned 203-document scope")
    for row in rows:
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
            raise ValueError("source outside public allowlist")
        if (not isinstance(row.get("object_id"), str) or not row["object_id"]
                or row.get("stage") not in ALLOWED_STAGES
                or row.get("section") not in ALLOWED_SECTIONS):
            raise ValueError(f"invalid public source object/stage/section: {row['file_id']}")
    return rows


def _source_ids(rows: list[dict[str, Any]]) -> list[str]:
    return sorted(row["file_id"] for row in rows)


def _role_plan(
    rows: list[dict[str, Any]], rule: dict[str, Any], *, expected: bool,
) -> dict[str, Any]:
    status_key = "expected" if expected else "actual"
    status = rule["manifestSectionStatus"][status_key]
    sections = rule["requiredExpectedSections" if expected else "requiredActualSections"]
    stage = "PD" if expected else "RD"
    if status not in {"EXACT_CATEGORY", "UNKNOWN_ABSTAIN"}:
        raise ValueError("unknown manifest-section status")
    if (status == "EXACT_CATEGORY") != bool(sections):
        raise ValueError("manifest-section status/sections disagree")
    if any(section == "OTHER" or section not in ALLOWED_SECTIONS for section in sections):
        raise ValueError("candidate rule has unknown manifest section")

    stage_rows = [row for row in rows if row["stage"] == stage]
    mixed_rows = [row for row in rows if row["stage"] == "RD_ID_MIXED"] if not expected else []
    if status == "EXACT_CATEGORY":
        exact = [row for row in stage_rows if row["section"] in sections]
        unresolved = [row for row in stage_rows if row["section"] == "OTHER"]
        mixed = [row for row in mixed_rows if row["section"] in sections]
        mixed_unclassified = [row for row in mixed_rows if row["section"] == "OTHER"]
    else:
        exact = []
        unresolved = stage_rows
        mixed = mixed_rows
        mixed_unclassified = []
    return {
        "stage": stage,
        "manifestSectionStatus": status,
        "requiredManifestSections": sections,
        "requiredDrawingSections": rule[
            "requiredExpectedDrawingSections" if expected else "requiredActualDrawingSections"],
        "exactSourceIds": _source_ids(exact),
        "unresolvedSectionSourceIds": _source_ids(unresolved),
        "mixedStageSourceIds": _source_ids(mixed),
        "mixedStageUnclassifiedSourceIds": _source_ids(mixed_unclassified),
    }


def _counts(plan: dict[str, Any]) -> dict[str, int]:
    return {key.removesuffix("Ids") + "Count": len(value)
            for key, value in plan.items() if key.endswith("SourceIds")}


def build_candidate_source_matrix(
    manifest_path: Path, *, expected_manifest_sha256: str = PUBLIC_MANIFEST_SHA256,
) -> dict[str, Any]:
    """List source search candidates for 47 rules, without asserting comparability."""
    rows = _validate_inventory(manifest_path, expected_manifest_sha256)
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    pack = load_candidate_family_pack()
    if len(pack["rules"]) != 47:
        raise ValueError("candidate pack must contain exactly 47 rules")
    objects = sorted({row["object_id"] for row in pdfs})
    by_object: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in pdfs:
        by_object[row["object_id"]].append(row)
    codes: list[dict[str, Any]] = []
    family_counts: dict[str, int] = defaultdict(int)
    for rule in pack["rules"]:
        if (rule["evaluationPolicy"] != "NON_EXECUTING_ABSTAIN"
                or rule["missingEvidenceDisposition"] != "ABSTAIN"
                or rule["expectedStage"] != "PD"
                or rule["allowedActualStages"] != ["RD"]):
            raise ValueError("candidate source matrix requires non-executing PD/RD rules")
        object_plans = []
        for object_id in objects:
            subset = by_object[object_id]
            expected = _role_plan(subset, rule, expected=True)
            actual = _role_plan(subset, rule, expected=False)
            exact_pair = bool(expected["exactSourceIds"] and actual["exactSourceIds"])
            flags = []
            for label, plan in (("EXPECTED", expected), ("ACTUAL", actual)):
                if plan["manifestSectionStatus"] == "UNKNOWN_ABSTAIN":
                    flags.append(label + "_MANIFEST_SECTION_UNRESOLVED")
                if plan["unresolvedSectionSourceIds"]:
                    flags.append(label + "_UNRESOLVED_SECTION_SOURCES")
                if plan["mixedStageSourceIds"] or plan["mixedStageUnclassifiedSourceIds"]:
                    flags.append(label + "_MIXED_STAGE_SOURCES")
            if not exact_pair:
                flags.append("NO_SAME_OBJECT_EXACT_SOURCE_PAIR")
            object_plans.append({
                "objectId": object_id,
                "expected": {**expected, **_counts(expected)},
                "actual": {**actual, **_counts(actual)},
                "sameObjectExactSourcePairAvailable": exact_pair,
                "ambiguityFlags": flags,
            })
        codes.append({
            "parameterCode": rule["parameterCode"],
            "family": rule["family"],
            "ruleId": rule["ruleId"],
            "objects": object_plans,
            "objectCountWithExactSourcePair": sum(
                plan["sameObjectExactSourcePairAvailable"] for plan in object_plans),
            "disposition": "SOURCE_PLANNING_ONLY_ABSTAIN",
        })
        family_counts[rule["family"]] += 1
    return {
        "schemaVersion": "candidate-source-matrix-v1",
        "disposition": "SOURCE_PLANNING_ONLY_ABSTAIN",
        "manifestSha256": expected_manifest_sha256,
        "candidatePackSha256": pack["packSha256"],
        "inventory": {"publicSources": len(rows), "publicPdfSources": len(pdfs),
                      "publicPdfPages": sum(row["pdf_pages"] for row in pdfs),
                      "metadataOnlySourceId": PUBLIC_TXT_ID, "objects": objects},
        "families": [{"family": family, "codeCount": family_counts[family]}
                     for family in sorted(family_counts)],
        "codes": codes,
    }
