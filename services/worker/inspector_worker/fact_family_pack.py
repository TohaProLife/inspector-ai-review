"""Pinned, review-only pilot policy for two fact-comparison families.

The catalog is authoritative for names and triggers. This package does not
promote a catalog row into a finding or complete parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


RULES_DIR = Path(os.environ.get("INSPECTOR_RULES_DIR", Path(__file__).resolve().parents[1] / "rules"))
PACK_PATH = RULES_DIR / "fact-family-pilot-v1.json"
CATALOG_PATH = RULES_DIR / "parameter_catalog_132.jsonl"
SELECTED_CODES = frozenset({"PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"})
RULE_FIELDS = frozenset({"schemaVersion", "ruleId", "version", "parameterCode", "attribute",
                         "expectedStage", "actualStage", "canonicalUnit", "comparator"})


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def load_fact_family_pack(catalog_path: Path = CATALOG_PATH,
                          pack_path: Path = PACK_PATH) -> dict[str, Any]:
    """Reject changed catalog or malformed policy; return catalog-bound pack."""
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    if (not isinstance(pack, dict) or pack.get("schemaVersion") != "fact-family-pack-v1"
            or pack.get("version") != "1" or pack.get("disposition") != "REVIEW_ONLY"
            or not isinstance(pack.get("rules"), list)):
        raise ValueError("fact family pack schema is invalid")
    catalog_hash = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
    if pack.get("catalogSha256") != catalog_hash:
        raise ValueError("fact family pack does not match pinned catalog SHA-256")
    catalog: dict[str, dict[str, Any]] = {}
    for raw in catalog_path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        row = json.loads(raw)
        code = row.get("parameter_code")
        if code in catalog:
            raise ValueError("duplicate parameter in catalog")
        catalog[code] = row
    if len(catalog) != 132:
        raise ValueError("fact family pack requires the 132-code source catalog")
    seen: set[str] = set()
    for row in pack["rules"]:
        if not isinstance(row, dict) or not RULE_FIELDS.issubset(row):
            raise ValueError("fact family rule is incomplete")
        code = row["parameterCode"]
        if code not in SELECTED_CODES or code in seen or code not in catalog:
            raise ValueError("unknown or duplicate fact family parameter")
        seen.add(code)
        if (row["schemaVersion"] != "fact-comparison-rule-v1" or row["version"] != "1"
                or row["expectedStage"] != "PD" or row["actualStage"] != "RD"
                or not isinstance(row["ruleId"], str) or not row["ruleId"]
                or not isinstance(row.get("requiredContext"), list)
                or not row["requiredContext"]
                or any(not isinstance(item, str) or not item for item in row["requiredContext"])
                or not isinstance(row.get("requiredActualSection"), list)
                or not row["requiredActualSection"]):
            raise ValueError(f"invalid rule scope or review gates for {code}")
    if seen != SELECTED_CODES:
        raise ValueError("fact family pack is missing a selected parameter")
    return {**pack, "catalogRows": {code: catalog[code] for code in sorted(SELECTED_CODES)},
            "packSha256": hashlib.sha256(canonical_json(pack).encode("utf-8")).hexdigest()}


def rules_for_object(object_id: str, pack: dict[str, Any]) -> list[dict[str, Any]]:
    """Bind immutable rule definitions to one object; retain review gates."""
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("fact family rules require objectId")
    if pack.get("schemaVersion") != "fact-family-pack-v1" or pack.get("disposition") != "REVIEW_ONLY":
        raise ValueError("fact family pack is not review-only")
    return [{**row, "objectId": object_id.strip()} for row in pack["rules"]]
