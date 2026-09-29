"""Catalog-pinned definitions for the 47 generic candidates; never execute them.

These definitions are deliberately separate from the executable pilot pack.
They describe what a future family extractor must prove, not parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from .parameter_family_registry import load_parameter_family_registry


RULES_DIR = Path(os.environ.get("INSPECTOR_RULES_DIR", Path(__file__).resolve().parents[1] / "rules"))
CATALOG_PATH = RULES_DIR / "parameter_catalog_132.jsonl"
REGISTRY_PATH = RULES_DIR / "parameter-family-registry-v1.json"
PACK_PATH = RULES_DIR / "parameter-candidate-rules-v1.json"

# Explicit fact identity and source sections, read from the pinned catalog.
# Each tuple is (atomic attributes with canonical units, PD sections, RD sections,
# entity/measurement gates). Abbreviations are project section names, not evidence.
CODE_SPECS: dict[str, tuple[tuple[tuple[str, str], ...], tuple[str, ...],
                            tuple[str, ...], tuple[str, ...]]] = {
    "PZ-002": ((("BUILDING_TOTAL_AREA", "m2"),), ("PZ",), ("AR",), ("BUILDING_SCOPE",)),
    "PZ-008": ((("BUILDING_HEIGHT", "m"),), ("PZ",), ("AR",), ("BUILDING_HEIGHT_DATUM",)),
    "PZ-010": ((("APARTMENT_COUNT", "count"),), ("PZ",), ("AR",), ("HOUSING_UNIT_SCOPE",)),
    "PZ-012": ((("UNDERGROUND_PARKING_COUNT", "count"),), ("PZ",), ("AR",), ("UNDERGROUND_PARKING_SCOPE",)),
    "PZ-014": ((("DESIGN_ELECTRIC_POWER", "kW"),), ("PZ",), ("EOM",), ("TECHNICAL_CONDITIONS_LIMIT",)),
    "PZ-015": ((("POWER_SUPPLY_RELIABILITY_CATEGORY", "reliability_category"),), ("PZ",), ("EOM",), ("CONSUMER_IDENTITY",)),
    "PZ-016": ((("DAILY_WATER_CONSUMPTION", "m3/day"),), ("PZ",), ("VK",), ("WATER_SUPPLY_SCOPE",)),
    "PZ-017": ((("TOTAL_HEATING_LOAD", "Gcal/h"),), ("PZ",), ("OV",), ("HEATING_LOAD_SCOPE",)),
    "PZ-018": ((("MAX_HOURLY_GAS_FLOW", "m3/h"),), ("PZ",), ("GSV",), ("GAS_SUPPLY_SCOPE",)),
    "PZ-021": ((("ENERGY_EFFICIENCY_CLASS", "energy_class"),), ("PZ",), ("AR", "OV"), ("BUILDING_SCOPE",)),
    "PZ-022": ((("FIRE_RESISTANCE_DEGREE", "fire_resistance_degree"),), ("PZ",), ("AR", "KR"), ("BUILDING_SCOPE",)),
    "PZ-023": ((("STRUCTURAL_FIRE_HAZARD_CLASS", "structural_fire_hazard_class"),), ("PZ",), ("AR", "KR"), ("BUILDING_SCOPE",)),
    "SPZU-024": ((("EXCAVATION_VOLUME", "m3"), ("BACKFILL_VOLUME", "m3")), ("SPZU",), ("PP",), ("EARTHWORK_SCOPE", "VOLUME_COMPONENT_IDENTITY")),
    "SPZU-025": ((("HARD_SURFACE_AREA", "m2"),), ("SPZU",), ("PP",), ("SURFACE_TYPE_IDENTITY",)),
    "SPZU-030": ((("FIRE_ACCESS_ROAD_WIDTH", "m"),), ("SPZU",), ("PP",), ("FIRE_ACCESS_ROAD_IDENTITY",)),
    "SPZU-037": ((("SURFACE_PARKING_COUNT", "count"),), ("SPZU",), ("PP",), ("SURFACE_PARKING_SCOPE",)),
    "SPZU-039": ((("DRAINAGE_MEASURE_SET", "set"),), ("SPZU",), ("NVK",), ("DRAINAGE_ZONE_IDENTITY",)),
    "AR-040": ((("EVACUATION_CORRIDOR_WIDTH", "m"),), ("AR",), ("AR",), ("CORRIDOR_IDENTITY", "FLOOR_IDENTITY")),
    "AR-041": ((("EVACUATION_DOOR_CLEAR_WIDTH", "m"),), ("AR",), ("AR",), ("DOOR_IDENTITY", "EVACUATION_ROUTE_IDENTITY")),
    "AR-049": ((("ROOF_BALCONY_GUARD_HEIGHT", "m"),), ("AR",), ("AR",), ("GUARD_LOCATION_IDENTITY", "GUARD_TYPE_IDENTITY")),
    "AR-050": ((("FINISH_FIRE_CLASS", "finish_fire_class"),), ("AR",), ("AR",), ("FINISH_LOCATION_IDENTITY", "EVACUATION_ROUTE_IDENTITY")),
    "AR-053": ((("NOISE_PROTECTION_MEASURE_SET", "set"),), ("AR",), ("AR",), ("PARTITION_JOINT_IDENTITY",)),
    "KR-061": ((("LOAD_BEARING_MONOLITHIC_WALL_THICKNESS", "mm"),), ("KR",), ("KJ",), ("WALL_IDENTITY", "ZONE_IDENTITY", "FLOOR_IDENTITY", "THICKNESS_MEASUREMENT_BASIS")),
    "KR-062": ((("LONGITUDINAL_REBAR_DIAMETER", "mm"),), ("KR",), ("KJ",), ("COLUMN_OR_PYLON_IDENTITY", "ZONE_IDENTITY", "FLOOR_IDENTITY", "REBAR_ROLE_IDENTITY")),
    "KR-067": ((("CONCRETE_VOLUME", "m3"), ("STEEL_MASS", "t")), ("KR",), ("KJ", "KM"), ("STRUCTURE_SCOPE", "MATERIAL_COMPONENT_IDENTITY")),
    "IOS2-071": ((("WATER_PIPE_DIAMETER", "mm"),), ("IOS2",), ("VK",), ("PIPE_SYSTEM_IDENTITY", "PIPE_RUN_IDENTITY", "DIAMETER_BASIS")),
    "IOS3-074": ((("SEWER_PIPE_DIAMETER", "mm"),), ("IOS3",), ("VK",), ("SEWER_SYSTEM_IDENTITY", "OUTLET_IDENTITY", "DIAMETER_BASIS")),
    "POS-082": ((("CRITICAL_CONSTRUCTION_STAGE_DURATION", "day"),), ("POS",), ("PPR",), ("CRITICAL_STAGE_IDENTITY",)),
    "POS-086": ((("PEAK_PERSONNEL_COUNT", "count"),), ("POS",), ("PPR",), ("WORKFORCE_SCOPE", "SITE_CAMP_CAPACITY_BASIS")),
    "POS-088": ((("TEMPORARY_POWER_DEMAND", "kW"), ("TEMPORARY_RESOURCE_VOLUME", "m3")), ("POS",), ("PPR",), ("RESOURCE_TYPE_IDENTITY", "TEMPORARY_NETWORK_IDENTITY")),
    "POD-092": ((("LIVE_UTILITY_PROTECTION_SET", "set"),), ("POD",), ("PPR",), ("UTILITY_IDENTITY", "MACHINE_WORK_ZONE")),
    "POD-093": ((("DEMOLITION_VOLUME_BY_TYPE", "m3"),), ("POD",), ("PPR",), ("DEMOLITION_MATERIAL_TYPE",)),
    "POD-095": ((("DUST_NOISE_SUPPRESSION_SET", "set"),), ("POD",), ("PPR",), ("DEMOLITION_ZONE_IDENTITY",)),
    "PPM-103": ((("FIRE_DOOR_RATING", "fire_rating"),), ("PPM",), ("AR",), ("DOOR_IDENTITY", "FIRE_RATING_NOTATION")),
    "PPM-104": ((("EVACUATION_PASSAGE_WIDTH", "m"), ("EVACUATION_PASSAGE_HEIGHT", "m")), ("PPM",), ("AR",), ("PASSAGE_IDENTITY", "EVACUATION_ROUTE_IDENTITY")),
    "PPM-105": ((("EXTERNAL_EVACUATION_DOOR_CLEAR_WIDTH", "m"),), ("PPM",), ("AR",), ("EXTERNAL_DOOR_IDENTITY",)),
    "PPM-107": ((("FINISH_FIRE_CLASS", "finish_fire_class"),), ("PPM",), ("AR",), ("FINISH_LOCATION_IDENTITY", "EVACUATION_ROUTE_IDENTITY")),
    "ODI-118": ((("ACCESSIBLE_DOOR_THRESHOLD_HEIGHT", "m"),), ("ODI",), ("AR",), ("ACCESSIBLE_DOOR_IDENTITY",)),
    "ODI-120": ((("ACCESSIBLE_GRAB_RAIL_SET", "set"),), ("ODI",), ("AR",), ("ACCESSIBLE_TOILET_IDENTITY",)),
    "ODI-122": ((("TACTILE_WARNING_SET", "set"),), ("ODI",), ("GP", "AR"), ("STAIR_OR_DOOR_IDENTITY",)),
    "ODI-123": ((("ASSISTANCE_CALL_SYSTEM_SET", "set"),), ("ODI",), ("SS",), ("ACCESSIBLE_FACILITY_IDENTITY",)),
    "ZU-124": ((("ENERGY_EFFICIENCY_CLASS", "energy_class"),), ("ZU",), ("AR", "OV"), ("BUILDING_SCOPE",)),
    "ZU-126": ((("WALL_INSULATION_THERMAL_CONDUCTIVITY", "W/(m*C)"),), ("ZU",), ("AR",), ("INSULATION_MATERIAL_IDENTITY", "WALL_ASSEMBLY_IDENTITY")),
    "ZU-128": ((("ROOF_INSULATION_THICKNESS", "mm"),), ("ZU", "AR"), ("AR",), ("ROOF_ASSEMBLY_IDENTITY",)),
    "ZU-129": ((("ENERGY_METER_SET", "set"),), ("ZU",), ("IOS1", "IOS2", "OV"), ("ENERGY_CARRIER_IDENTITY", "METER_SCOPE")),
    "ZU-131": ((("ANNUAL_SPECIFIC_HEATING_ENERGY", "kWh/m2"),), ("ZU",), ("OV",), ("BUILDING_AREA_BASIS", "ANNUAL_PERIOD_BASIS")),
    "SM-132": ((("CONSTRUCTION_TOTAL_COST", "thousand_rub"),), ("SM",), ("SM",), ("ESTIMATE_SCOPE", "PRICE_BASE_DATE", "COST_COMPONENT_SCOPE")),
}

# Literal strict bounds in trigger text. All other thresholds remain null.
TRIGGER_THRESHOLDS: dict[str, tuple[str, str]] = {
    "PZ-002": ("1", "percent"),
    "SPZU-024": ("5", "percent"),
    "SPZU-025": ("5", "percent"),
    "SPZU-030": ("4.2", "m"),
    "AR-040": ("1.2", "m"),
    "AR-041": ("0.9", "m"),
    "AR-049": ("1.2", "m"),
    "KR-067": ("2", "percent"),
    "POS-082": ("10", "percent"),
    "POD-093": ("5", "percent"),
    "PPM-104": ("1.2", "m"),
    "PPM-105": ("0.9", "m"),
    "ODI-118": ("0.014", "m"),
    "SM-132": ("5", "percent"),
}

BASE_GATES = ("SOURCE_STAGE_VERIFIED", "SOURCE_REVISION_CURRENT",
              "SOURCE_APPROVAL_CONFIRMED", "FACT_ENTITY_LINK_REVIEWED",
              "TEXT_OR_OCR_LOCATOR_VERIFIED")
FAMILY_GATES = {
    "RELATIVE_DELTA": ("RELATIVE_DENOMINATOR_VERIFIED",),
    "RELATIVE_INCREASE": ("RELATIVE_DENOMINATOR_VERIFIED",),
    "CLASS_DECREASE": ("ORDERED_DOMAIN_VERIFIED",),
    "PRESENCE_SET": ("ENUMERATION_COMPLETE", "SEARCH_SCOPE_VERIFIED"),
    "LOWER_BOUND": ("NORM_APPLICABILITY_VERIFIED",),
    "UPPER_BOUND": ("NORM_APPLICABILITY_VERIFIED",),
}
OPERATORS = {
    "RELATIVE_DELTA": ">", "RELATIVE_INCREASE": ">", "INCREASE": ">",
    "DIFFERENT": "!=", "DECREASE": "<", "LOWER_BOUND": "<",
    "UPPER_BOUND": ">", "CLASS_DECREASE": None, "PRESENCE_SET": None,
}
COMPARISON_KEYS = {
    "POS-088": ("TEMPORARY_POWER_DEMAND",),
    "PPM-104": ("EVACUATION_PASSAGE_WIDTH",),
}
# Public manifest uses coarse section categories. KJ/KM are drawing marks
# nested in KR, while PZ/SPZU/PP/PPR and other marks have no exact category.
# Do not infer OTHER as a section: it is an unclassified catch-all.
DRAWING_TO_MANIFEST_SECTION: dict[str, str] = {
    "AR": "AR", "KR": "KR", "KJ": "KR", "KM": "KR",
    "EOM": "EOM", "VK": "VK", "OV": "OV", "GP": "GP",
    "SS": "SS", "POS": "POS",
}
UNIT_SIGNATURES: dict[str, set[tuple[str, ...]]] = {
    "Буква": {("energy_class",)},
    "Вт/(м·С)": {("W/(m*C)",)},
    "Гкал/ч": {("Gcal/h",)},
    "Кат.": {("reliability_category",)},
    "Класс (КМ)": {("finish_fire_class",)},
    "Класс (С0, С1)": {("structural_fire_hazard_class",)},
    "Степень": {("fire_resistance_degree",)},
    "дни": {("day",)},
    "кВт": {("kW",)},
    "кВт / м³": {("kW", "m3")},
    "кВт·ч/м²": {("kWh/m2",)},
    "м": {("m",), ("m", "m")},
    "м²": {("m2",)},
    "м³": {("m3",), ("m3", "m3")},
    "м³ / т": {("m3", "t")},
    "м³/сут": {("m3/day",)},
    "м³/ч": {("m3/h",)},
    "мин": {("fire_rating",)},
    "мм": {("mm",)},
    "тыс. руб.": {("thousand_rub",)},
    "чел.": {("count",)},
    "шт.": {("count",), ("set",)},
    "—": {("set",)},
}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _manifest_sections(drawing_sections: tuple[str, ...]) -> list[str]:
    # Mixed mapped/unmapped alternatives cannot be narrowed to one manifest
    # category without excluding the unknown alternative.
    if any(section not in DRAWING_TO_MANIFEST_SECTION for section in drawing_sections):
        return []
    return list(dict.fromkeys(DRAWING_TO_MANIFEST_SECTION[section]
                              for section in drawing_sections))


def _expected_rule(entry: dict[str, Any]) -> dict[str, Any]:
    code, family = entry["parameterCode"], entry["family"]
    attributes, expected_sections, actual_sections, scope_gates = CODE_SPECS[code]
    threshold = TRIGGER_THRESHOLDS.get(code)
    expected_manifest_sections = _manifest_sections(expected_sections)
    actual_manifest_sections = _manifest_sections(actual_sections)
    section_gates = ["DRAWING_SECTION_VERIFIED"]
    if not expected_manifest_sections:
        section_gates.append("EXPECTED_MANIFEST_SECTION_UNRESOLVED")
    if not actual_manifest_sections:
        section_gates.append("ACTUAL_MANIFEST_SECTION_UNRESOLVED")
    return {
        "schemaVersion": "parameter-candidate-rule-v1",
        "ruleId": f"candidate-{code.lower()}",
        "version": "1",
        "parameterCode": code,
        "family": family,
        "factType": entry["factType"],
        "attributes": [{"key": key, "canonicalUnit": unit} for key, unit in attributes],
        "expectedStage": "PD",
        "allowedActualStages": ["RD"],
        "requiredExpectedSections": expected_manifest_sections,
        "requiredActualSections": actual_manifest_sections,
        "requiredExpectedDrawingSections": list(expected_sections),
        "requiredActualDrawingSections": list(actual_sections),
        "manifestSectionStatus": {
            "expected": "EXACT_CATEGORY" if expected_manifest_sections else "UNKNOWN_ABSTAIN",
            "actual": "EXACT_CATEGORY" if actual_manifest_sections else "UNKNOWN_ABSTAIN",
        },
        "requiredContext": list(dict.fromkeys((*BASE_GATES, *scope_gates,
                                              *FAMILY_GATES.get(family, ()),
                                              *section_gates))),
        "comparison": {
            # POS-086 compares peak staff to campsite capacity, not blindly to
            # the PD staff forecast. The approved baseline is still unknown.
            "operator": None if code == "POS-086" else OPERATORS[family],
            "attributeKeys": list(COMPARISON_KEYS.get(
                code, tuple(key for key, _ in attributes))),
            "aggregation": "PER_ATTRIBUTE",
            "threshold": ({"value": threshold[0], "unit": threshold[1], "strict": True}
                          if threshold is not None else None),
            "relativeBasis": None,
        },
        "evaluationPolicy": "NON_EXECUTING_ABSTAIN",
        "missingEvidenceDisposition": "ABSTAIN",
    }


def load_candidate_family_pack(
    catalog_path: Path = CATALOG_PATH,
    registry_path: Path = REGISTRY_PATH,
    pack_path: Path = PACK_PATH,
) -> dict[str, Any]:
    """Reject drift or unsupported semantics; no evaluator consumes this pack."""
    registry = load_parameter_family_registry(catalog_path=catalog_path,
                                               registry_path=registry_path)
    candidates = [row for row in registry["entries"]
                  if row["classification"] == "GENERIC_CANDIDATE"]
    candidate_codes = {row["parameterCode"] for row in candidates}
    if len(candidates) != 47 or candidate_codes != set(CODE_SPECS):
        raise ValueError("candidate rules do not match the 47-code registry")
    if set(TRIGGER_THRESHOLDS) - candidate_codes:
        raise ValueError("candidate thresholds include noncandidate code")
    catalog_rows = {row["parameter_code"]: row for row in
                    (json.loads(line) for line in catalog_path.read_text(encoding="utf-8").splitlines()
                     if line.strip())}
    for entry in candidates:
        code = entry["parameterCode"]
        row = catalog_rows[code]
        units = tuple(unit for _, unit in CODE_SPECS[code][0])
        if units not in UNIT_SIGNATURES.get(row["unit"], set()):
            raise ValueError(f"candidate canonical unit differs from catalog: {code}")
        threshold = TRIGGER_THRESHOLDS.get(code)
        if threshold and (re.search(r"(?<!\d)" + re.escape(threshold[0]) + r"(?!\d)",
                                    row["trigger"]) is None
                          or threshold[1] == "percent" and "%" not in row["trigger"]):
            raise ValueError(f"candidate threshold is not literal in catalog trigger: {code}")
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    if (not isinstance(pack, dict)
            or set(pack) != {"schemaVersion", "version", "catalogSha256", "registrySha256",
                             "disposition", "executionPolicy", "rules"}
            or pack["schemaVersion"] != "parameter-candidate-rules-v1"
            or pack["version"] != "1"
            or pack["catalogSha256"] != hashlib.sha256(catalog_path.read_bytes()).hexdigest()
            or pack["registrySha256"] != hashlib.sha256(registry_path.read_bytes()).hexdigest()
            or pack["disposition"] != "REVIEW_ONLY"
            or pack["executionPolicy"] != "DEFINITION_ONLY"
            or not isinstance(pack["rules"], list)):
        raise ValueError("candidate pack schema, policy, or pinned SHA-256 is invalid")
    if len(pack["rules"]) != len(candidates):
        raise ValueError("candidate pack has missing or extra rules")
    for actual, entry in zip(pack["rules"], candidates, strict=True):
        expected = _expected_rule(entry)
        if actual != expected:
            raise ValueError(f"candidate rule differs from catalog-bound definition: {entry['parameterCode']}")
    return {**pack, "packSha256": hashlib.sha256(_canonical_json(pack).encode("utf-8")).hexdigest()}


def rules_by_family(pack: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Group definitions for offline review; never invoke comparison."""
    if (pack.get("schemaVersion") != "parameter-candidate-rules-v1"
            or pack.get("executionPolicy") != "DEFINITION_ONLY"):
        raise ValueError("candidate pack must remain definition-only")
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in pack["rules"]:
        grouped[row["family"]].append(row)
    return dict(grouped)
