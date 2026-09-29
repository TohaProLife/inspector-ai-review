"""Design-only, catalog-bound comparator-family registry for 132 parameters.

Family assignment describes the public trigger's shape. It never authorizes
execution, supplies a normative threshold, or establishes document evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any


RULES_DIR = Path(os.environ.get("INSPECTOR_RULES_DIR", Path(__file__).resolve().parents[1] / "rules"))
CATALOG_PATH = RULES_DIR / "parameter_catalog_132.jsonl"
REGISTRY_PATH = RULES_DIR / "parameter-family-registry-v1.json"
PILOT_PACK_PATH = RULES_DIR / "fact-family-pilot-v1.json"
CATALOG_SHA256 = "c6b73dffbea6bb366fc50f08392522c390bdf7b19420051802bd0bcbd32b4e4f"
PILOT_FAMILIES = {
    "PZ-004": "DIFFERENT",
    "PZ-007": "DIFFERENT",
    "KR-055": "CLASS_DECREASE",
    "KR-058": "DECREASE",
    "KR-059": "DECREASE",
}
FAMILY_FACT_TYPES = {
    "DIFFERENT": {"DECIMAL", "INTEGER"},
    "DECREASE": {"DECIMAL", "INTEGER"},
    "INCREASE": {"DECIMAL", "INTEGER"},
    "RELATIVE_DELTA": {"DECIMAL"},
    "RELATIVE_INCREASE": {"DECIMAL"},
    "CLASS_DECREASE": {"ORDERED_DOMAIN"},
    "PRESENCE_SET": {"SET"},
    "LOWER_BOUND": {"DECIMAL"},
    "UPPER_BOUND": {"DECIMAL"},
}
UNRESOLVED_REASONS = frozenset({
    "GEOMETRY_OR_TOPOLOGY", "NORMATIVE_OR_APPLICABILITY", "APPROVAL_OR_CONTEXT",
    "COMPOSITE_TRIGGER", "SOURCE_TRIGGER_CONFLICT", "EXTERNAL_REGISTRY",
    "PUBLIC_MAPPING_CONFLICT",
})


def _catalog_rows(path: Path) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CATALOG_SHA256:
        raise ValueError("parameter family registry catalog SHA-256 drift")
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    codes = [row.get("parameter_code") for row in rows]
    if (len(codes) != 132 or len(set(codes)) != 132
            or any(not isinstance(code, str) or not code for code in codes)):
        raise ValueError("parameter family registry requires 132 unique catalog codes")
    return rows


def _pilot_families(path: Path) -> dict[str, str]:
    pack = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(pack, dict) or pack.get("schemaVersion") != "fact-family-pack-v1"
            or pack.get("catalogSha256") != CATALOG_SHA256
            or pack.get("disposition") != "REVIEW_ONLY"
            or not isinstance(pack.get("rules"), list)):
        raise ValueError("parameter family pilot pack is not review-only or catalog-bound")
    if any(not isinstance(row, dict) or not isinstance(row.get("comparator"), dict)
           for row in pack["rules"]):
        raise ValueError("parameter family pilot pack rules are malformed")
    pairs = [(row.get("parameterCode"), row["comparator"].get("family"))
             for row in pack["rules"]]
    if len(pairs) != len(PILOT_FAMILIES) or dict(pairs) != PILOT_FAMILIES:
        raise ValueError("parameter family registry pilot codes differ from pinned pack")
    return dict(pairs)


def load_parameter_family_registry(
    catalog_path: Path = CATALOG_PATH,
    registry_path: Path = REGISTRY_PATH,
    pilot_pack_path: Path = PILOT_PACK_PATH,
) -> dict[str, Any]:
    """Load full classification; fail closed on drift, gaps, or execution claims."""
    catalog = _catalog_rows(catalog_path)
    pilot_families = _pilot_families(pilot_pack_path)
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    if (not isinstance(registry, dict)
            or set(registry) != {"schemaVersion", "version", "catalogSha256", "executionPolicy", "entries"}
            or registry["schemaVersion"] != "parameter-family-registry-v1"
            or registry["version"] != "1"
            or registry["catalogSha256"] != CATALOG_SHA256
            or registry["executionPolicy"] != "DESIGN_ONLY"
            or not isinstance(registry["entries"], list)):
        raise ValueError("parameter family registry schema, SHA, or execution policy is invalid")
    entries = registry["entries"]
    catalog_codes = [row["parameter_code"] for row in catalog]
    codes = [row.get("parameterCode") for row in entries if isinstance(row, dict)]
    if len(entries) != 132 or len(codes) != 132 or codes != catalog_codes:
        raise ValueError("parameter family registry must cover catalog exactly once in catalog order")
    for row in entries:
        if set(row) != {"parameterCode", "classification", "family", "factType", "reasonCode"}:
            raise ValueError(f"parameter family registry entry has unsupported fields: {row.get('parameterCode')}")
        code = row["parameterCode"]
        classification = row["classification"]
        family = row["family"]
        fact_type = row["factType"]
        reason = row["reasonCode"]
        if code in pilot_families:
            if (classification != "PILOT_REVIEW_ONLY" or family != pilot_families[code]
                    or reason is not None):
                raise ValueError(f"parameter family registry pilot mismatch: {code}")
        elif classification == "PILOT_REVIEW_ONLY":
            raise ValueError(f"parameter family registry overclaims pilot implementation: {code}")
        elif classification == "GENERIC_CANDIDATE":
            if reason is not None:
                raise ValueError(f"parameter family candidate cannot assert a resolution: {code}")
        elif classification == "UNRESOLVED":
            if family is not None or fact_type is not None or reason not in UNRESOLVED_REASONS:
                raise ValueError(f"parameter family unresolved entry is invalid: {code}")
            continue
        else:
            raise ValueError(f"parameter family classification is invalid: {code}")
        if family not in FAMILY_FACT_TYPES or fact_type not in FAMILY_FACT_TYPES[family]:
            raise ValueError(f"parameter family fact type is invalid: {code}")
    return registry


def registry_summary(registry: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Counts only registry labels; does not report execution coverage."""
    entries = registry["entries"]
    return {
        "classification": dict(sorted(Counter(row["classification"] for row in entries).items())),
        "family": dict(sorted(Counter(row["family"] for row in entries if row["family"]).items())),
        "unresolvedReason": dict(sorted(Counter(row["reasonCode"] for row in entries
                                              if row["reasonCode"]).items())),
    }
