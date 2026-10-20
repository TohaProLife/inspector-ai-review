"""Run-scoped typed text facts and fail-closed matrix rule execution.

Extraction is deliberately independent of source approval. Only comparisons with
explicit, manifest-bound reviewed context qualify. A lexical fact never approves
a source, discovers a complete inventory, establishes an entity, or creates a
probability. Frozen legacy packs are not changed by this module.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from decimal import Decimal, localcontext
from functools import lru_cache
from pathlib import Path
from typing import Any

from .candidate_family_rules import RULES_DIR
from .family_rule_evaluator import _canonical_numeric
from .fact_comparison import _decimal, _decimal_text
from .parameter_routing import _validate_artifact
from .concrete_wall_fact_scope_v13 import derive_matrix_fact_target
from .project_zero_prose import extract_project_zero_candidates
from .rebar_prose import extract_rebar_candidates
from .concrete_prose import extract_concrete_candidates, is_concrete_prose_fact

REGISTRY_PATH = RULES_DIR / 'matrix-execution-v1.json'
EXTRACTOR_VERSION = 'matrix-text-facts-v1'
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_NUMBER = r'(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0\u202f][0-9]{3})+)(?:[.,][0-9]+)?'
_RD_CONCRETE_CLASS_SENTENCE = re.compile(
    r'(?i:Класс бетона по прочности на сжатие)\s+(?P<value>[BВ]' + _NUMBER + r')'
    r'(?:,\s*(?i:марка по морозостойкости)\s+F[0-9]+)?'
    r'(?:,\s*(?i:марка по водонепроницаемости)\s+W[0-9]+)?\.?'
)
_PD_CONCRETE_TABLE_HEADER = re.compile(
    r'(?i:Для железобетонных конструкций предусматривается использование тяжелого бетона '
    r'по ГОСТ [0-9]{1,5}-[0-9]{4} и ГОСТ [0-9]{1,5}-[0-9]{4} '
    r'и приняты следующие классы по прочности на сжатие:)'
)
_PD_CONCRETE_TABLE_SCOPE = re.compile(r'(?i:Подземная часть)')
_PD_CONCRETE_TABLE_LABEL = re.compile(
    r'(?i:(?:·\s*)?(?:фундаментная плита|'
    r'пилоны, колонны [+-]?[0-9]{1,3} по [+-]?[0-9]{1,3}|'
    r'стены [+-]?[0-9]{1,3}(?:го)? по [+-]?[0-9]{1,3}|'
    r'плита [+-]?[0-9]{1,3}(?:го)? этажа|плита покрытия))'
)
_PD_CONCRETE_TABLE_VALUE = re.compile(r'(?P<value>[BВ][0-9]+(?:[.,][0-9]+)?)\s*[.;]?')
_SLAB_NUMBER = r'[0-9]+(?:[.,][0-9]+)?'
_SLAB_UNIT = r'(?:мм|mm|см|cm|м|m)'
_SLAB_FLOOR = r'[+-]?[0-9]{1,3}'
_RD_SLAB_THICKNESS_SENTENCE = re.compile(
    r'(?i:Толщина ж/б плиты перекрытия подземного этажа)\s*-\s*'
    r'(?P<value>' + _SLAB_NUMBER + r')\s*(?P<unit>' + _SLAB_UNIT + r')'
    r',\s*(?i:ж/б капители толщиной)\s*-\s*'
    r'(?P<capital_value>' + _SLAB_NUMBER + r')\s*(?P<capital_unit>' + _SLAB_UNIT + r')\.?'
)
_PD_SLAB_TABLE_HEADER = re.compile(r'(?i:Толщины перекрытия и покрытия:)')
_PD_SLAB_TABLE_SCOPE = re.compile(r'(?i:Толщины перекрытий подземной части)')
_PD_SLAB_TABLE_TARGET = re.compile(
    r'(?i:-\s+Перекрытия (?P<floor_a>' + _SLAB_FLOOR + r') и (?P<floor_b>' + _SLAB_FLOOR + r') этажей)'
)
_PD_SLAB_TABLE_ANY_LABEL = re.compile(
    r'(?i:-\s+(?:Толщина фундаментной плиты|Перекрытия ' + _SLAB_FLOOR + r' и ' + _SLAB_FLOOR +
    r' этажей|Капители ' + _SLAB_FLOOR + r' и ' + _SLAB_FLOOR + r' этажей|'
    r'Плита покрытия \(стилобата\)|Капители покрытия \(стилобата\)))'
)
# Lists only identify neighboring table cells. They never yield a selected value.
_PD_SLAB_TABLE_STRUCTURE_VALUE = re.compile(r'-\s*' + _SLAB_NUMBER + r'(?:,\s+' + _SLAB_NUMBER + r')*\s*' + _SLAB_UNIT + r'[.;]?')
_PD_SLAB_TABLE_VALUE = re.compile(r'-\s+(?P<value>' + _SLAB_NUMBER + r')\s*(?P<unit>' + _SLAB_UNIT + r')[.;]?')
_PD_SIDEWALK_CAPTION = ['ведомость проездов, тротуаров,', 'дорожек и площадок']
_PD_SIDEWALK_HEADER = ['площадь', 'покрытия, кв.м. в', 'гр. гпзу']
_PD_SIDEWALK_LABEL = ['тротуары пешеходные', 'из бетонной плитки,', 'по грунту']
_PD_SIDEWALK_TABLE_VALUE = re.compile(r'(?P<value>' + _NUMBER + r')\s*(?P<unit>м²)')
_STAIR_NUMBER = r'[0-9]+(?:[.,][0-9]+)?'
_STAIR_UNIT = r'(?:мм|mm|см|cm|м|m)'
_STAIR_PROSE_FIRST = re.compile(
    r'(?i:Ширина проступей ступеней предусмотрена)\s+(?P<value>' + _STAIR_NUMBER + r')\s*'
    r'(?P<unit>' + _STAIR_UNIT + r'),\s+(?i:а высота подъема)')
_STAIR_PROSE_SECOND = re.compile(
    r'(?i:ступеней)\s*-\s*(?P<value>' + _STAIR_NUMBER + r')\s*(?P<unit>' + _STAIR_UNIT + r')\.'
    r'(?:\s+(?i:Уклоны лестниц)\s*-\s*1:2\.\s+(?i:Стальные ограждения лестничных))?')
_FAMILIES = {'DIFFERENT', 'INCREASE', 'DECREASE', 'RELATIVE_DELTA', 'RELATIVE_INCREASE',
             'CLASS_DECREASE', 'LOWER_BOUND', 'UPPER_BOUND'}
_SUBRULE_IDENTITY_FIELDS = ['componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']
_SUBRULE_COMPONENT_ROLES = {'POTABLE_WATER_PUMP', 'RADIATOR', 'SMOKE_CONTROL_FAN',
                            'ASPHALT_LAYER', 'CRUSHED_STONE_LAYER'}
_SIDEWALK_RULE_ID = 'matrix-spzu-026-sidewalk_tile_area'
_SIDEWALK_GAP = ('PARTIAL_SUBRULES_ONLY:SIDEWALK_TILE_AREA_ONLY;'
                 'OTHER_PAVING_QUANTITIES_AND_FULL_SCOPE_UNSUPPORTED')
# This role admits one bounded area comparison, never a generic DIFFERENT policy.
_SIDEWALK_RULE_POLICY = {
    'ruleId': _SIDEWALK_RULE_ID, 'version': '1', 'attribute': 'SIDEWALK_TILE_AREA',
    'canonicalUnit': 'm2', 'valueKind': 'DECIMAL', 'family': 'DIFFERENT', 'threshold': None,
    'labels': ['Площадь тротуарного плиточного покрытия', 'Площадь тротуаров из бетонной плитки'],
    'unitAliases': ['м²', 'м2', 'm²', 'm2', 'кв.м', 'кв. м'],
    'allowedValues': [], 'expectedSections': ['SPZU', 'GP'], 'actualSections': ['PP', 'GP'],
    'requiredContext': ['APPROVED_CHANGE_STATUS', 'SURFACE_TYPE_IDENTITY', 'ZONE_IDENTITY',
                        'ATOMIC_SUBRULE_SCOPE:' + _SIDEWALK_RULE_ID],
    'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
    'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
}
_EGRESS_HEIGHT_GAP = ('SCOPED_LITERAL_HEIGHT_ONLY;'
                      'DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_AND_PD_BASELINE_REVIEW_REQUIRED')
_EGRESS_ROLE_BASIS = {
    'EVACUATION_CORRIDOR_CLEARANCE': 'CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION',
    'EVACUATION_DOOR_CLEARANCE': 'CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD',
}
# Two catalog-bound clear-height checks, not a general normative policy. The
# physical measurement basis and evacuation purpose require explicit review.
_EGRESS_HEIGHT_POLICIES = {}
for _kind, _label, _threshold, _role in [
        ('corridor', 'Высота эвакуационного коридора в свету', '2', 'EVACUATION_CORRIDOR_CLEARANCE'),
        ('door', 'Высота эвакуационной двери в свету', '1.9', 'EVACUATION_DOOR_CLEARANCE')]:
    _rule_id = 'matrix-ar-042-evacuation_' + _kind + '_clear_height'
    _EGRESS_HEIGHT_POLICIES[_role] = {
        'ruleId': _rule_id, 'version': '1', 'attribute': 'EVACUATION_' + _kind.upper() + '_CLEAR_HEIGHT',
        'canonicalUnit': 'm', 'labels': [_label], 'unitAliases': ['м', 'm', 'мм', 'mm', 'см', 'cm'],
        'allowedValues': [], 'valueKind': 'DECIMAL', 'family': 'LOWER_BOUND',
        'threshold': {'value': _threshold, 'unit': 'm', 'strict': True},
        'expectedSections': ['AR'], 'actualSections': ['AR'],
        'requiredContext': ['NORM_APPLICABILITY_VERIFIED', 'EVACUATION_ROUTE_IDENTITY',
                            'ATOMIC_SUBRULE_SCOPE:' + _rule_id],
        'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
        'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
    }
del _kind, _label, _threshold, _role, _rule_id
_STAIR_DIMENSIONS_GAP = ('SCOPED_LITERAL_STAIR_DIMENSIONS_ONLY;'
    'STEP_COUNT_DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_PD_BASELINE_AND_ID_REQUIRED')
_STAIR_ROLE_BASIS = {'STAIR_TREAD': 'FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH',
                     'STAIR_RISER': 'FINISHED_VERTICAL_RISER_HEIGHT'}
_STAIR_DIMENSION_POLICIES = {}
for _attribute, _label, _family, _threshold, _role in [
        ('STAIR_TREAD_DEPTH', 'Глубина проступи лестницы в свету', 'LOWER_BOUND', '300', 'STAIR_TREAD'),
        ('STAIR_RISER_HEIGHT', 'Высота подступенка лестницы после отделки', 'UPPER_BOUND', '150', 'STAIR_RISER')]:
    _rule_id = 'matrix-ar-048-' + _attribute.lower()
    _STAIR_DIMENSION_POLICIES[_role] = {
        'ruleId': _rule_id, 'version': '1', 'attribute': _attribute,
        'canonicalUnit': 'mm', 'labels': [_label], 'unitAliases': ['мм', 'mm', 'м', 'm', 'см', 'cm'],
        'allowedValues': [], 'valueKind': 'DECIMAL', 'family': _family,
        'threshold': {'value': _threshold, 'unit': 'mm', 'strict': True},
        'expectedSections': ['AR'], 'actualSections': ['AR'],
        'requiredContext': ['NORM_APPLICABILITY_VERIFIED', 'STAIR_FLIGHT_STEP_IDENTITY',
                            'ATOMIC_SUBRULE_SCOPE:' + _rule_id],
        'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
        'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
    }
del _attribute, _label, _family, _threshold, _role, _rule_id
_FENCE_RULE_ID = 'matrix-spzu-036-territory_fence_height'
_FENCE_GAP = ('PARTIAL_SUBRULES_ONLY:TERRITORY_FENCE_HEIGHT_DECREASE_ONLY;'
    'FENCE_TYPE_REPLACEMENT_GATE_DIMENSIONS_DRAWING_GEOMETRY_COMPLETE_INVENTORY_AND_ID_UNSUPPORTED')
_FENCE_RULE_POLICY = {
    'ruleId': _FENCE_RULE_ID, 'version': '1', 'attribute': 'TERRITORY_FENCE_HEIGHT',
    'canonicalUnit': 'm', 'labels': ['Высота ограждения территории'],
    'unitAliases': ['м', 'm', 'мм', 'mm', 'см', 'cm'], 'allowedValues': [],
    'valueKind': 'DECIMAL', 'family': 'DECREASE', 'threshold': None,
    'expectedSections': ['SPZU', 'GP'], 'actualSections': ['AR', 'PP', 'GP'],
    'requiredContext': ['APPROVED_CHANGE_STATUS', 'FENCE_TYPE_IDENTITY', 'ZONE_IDENTITY',
                        'ATOMIC_SUBRULE_SCOPE:' + _FENCE_RULE_ID],
    'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
    'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
}
_PROJECT_ZERO_RULE_ID = 'matrix-pz-009-declared_project_zero_absolute_elevation'
_PROJECT_ZERO_GAP = ('PARTIAL_SUBRULES_ONLY:DECLARED_PROJECT_ZERO_ABSOLUTE_ELEVATION_ONLY;'
    'INDEPENDENT_GEOREFERENCE_TOPOGRAPHIC_BASE_CONTROL_POINTS_DATUM_TRANSFORM_AND_COMPLETE_INVENTORY_UNSUPPORTED')
_PROJECT_ZERO_BASIS = 'FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM'
_PROJECT_ZERO_POLICY = {
    'ruleId': _PROJECT_ZERO_RULE_ID, 'version': '1', 'attribute': 'PROJECT_ZERO_ABSOLUTE_ELEVATION',
    'canonicalUnit': 'm', 'labels': ['Абсолютная отметка проектного нуля'],
    'unitAliases': ['м', 'метрах'], 'allowedValues': [],
    'valueKind': 'DECIMAL', 'family': 'DIFFERENT', 'threshold': None,
    'expectedSections': ['PZ'], 'actualSections': ['KR', 'AR'],
    'requiredContext': ['APPROVED_CHANGE_STATUS', 'PROJECT_ZERO_GEODETIC_AUTHORITY',
                        'ATOMIC_SUBRULE_SCOPE:' + _PROJECT_ZERO_RULE_ID],
    'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
    'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
}
_REBAR_RULE_ID = 'matrix-kr-057-catalog_a500c_to_a400'
_REBAR_GAP = ('PARTIAL_SUBRULES_ONLY:CATALOG_A500C_TO_A400_EXAMPLE_ONLY;'
    'OTHER_GRADES_PLASTICITY_SCALE_NONWORKING_REINFORCEMENT_COMPLETE_INVENTORY_AND_ID_UNSUPPORTED')
_REBAR_MODE = 'WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED'
_REBAR_BASIS = 'DECLARED_REINFORCEMENT_CLASS'
_REBAR_POLICY = {
    'ruleId': _REBAR_RULE_ID, 'version': '1', 'attribute': 'WORKING_REINFORCEMENT_CLASS',
    'canonicalUnit': 'rebar_catalog_example', 'labels': ['Класс рабочей арматуры'],
    'unitAliases': [], 'allowedValues': ['А500С', 'А400'],
    'valueKind': 'CATEGORY', 'family': 'CLASS_DECREASE', 'threshold': None,
    'expectedSections': ['KR'], 'actualSections': ['KR'],
    'requiredContext': ['APPROVED_CHANGE_STATUS', 'REINFORCEMENT_APPLICATION_SCOPE',
                        'ATOMIC_SUBRULE_SCOPE:' + _REBAR_RULE_ID],
    'comparisonVariants': ['PD_RD'], 'allowedStagePairs': [['PD', 'RD']],
    'enabled': True, 'scopePolicy': 'EXPLICIT_REVIEWED_CONTEXT', 'comparisonPurpose': 'CATALOG_TRIGGER',
}
_FENCE_FIRST = 'по границе территории объекта проектом предусмотрена установка'
_FENCE_SECOND = re.compile(r'(?i:ограждения высотой)\s+(?P<value>' + _STAIR_NUMBER + r')\s*'
    r'(?P<unit>' + _STAIR_UNIT + r'),\s+(?i:протяженностью)\s+'
    + _STAIR_NUMBER + r'\s*' + _STAIR_UNIT + r'\s+(?i:с учетом длины ворот и)')
_UNIT_ADDITIONS = {
    'm': ['м', 'm', 'мм', 'mm', 'см', 'cm'],
    'mm': ['мм', 'mm', 'м', 'm', 'см', 'cm'],
    'm2': ['м²', 'м2', 'm2', 'm²', 'кв.м', 'кв. м', 'см²', 'см2', 'мм²', 'мм2'],
    'm3': ['м³', 'м3', 'm3', 'm³', 'куб.м', 'куб. м', 'тыс. м³', 'тыс. м3'],
    'kW': ['кВт', 'kW', 'Вт', 'МВт'],
    'count': ['шт.', 'шт', 'ед.', 'ед', 'count'],
    't': ['т', 't', 'кг', 'kg'],
}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def canonical_registry_hash(registry: dict[str, Any]) -> str:
    return _hash(registry)


def load_matrix_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding='utf-8'))
    _validate_registry(registry)
    return registry


def _validate_registry(registry: object) -> None:
    if (not isinstance(registry, dict) or registry.get('schemaVersion') != 'matrix-execution-registry-v1'
            or registry.get('version') != '1' or not isinstance(registry.get('entries'), list)
            or len(registry['entries']) != 132):
        raise ValueError('matrix registry schema invalid')
    catalog_bytes = (RULES_DIR / 'parameter_catalog_132.jsonl').read_bytes()
    catalog = {r['parameter_code']: r for r in map(json.loads, catalog_bytes.decode().splitlines()) if r}
    if registry.get('catalogSha256') != hashlib.sha256(catalog_bytes).hexdigest():
        raise ValueError('matrix registry catalog hash mismatch')
    seen: set[str] = set()
    rule_ids: set[str] = set()
    for entry in registry['entries']:
        code = entry.get('parameterCode') if isinstance(entry, dict) else None
        if code not in catalog or code in seen or not isinstance(entry.get('atomicRules'), list):
            raise ValueError('matrix registry parameter invalid')
        seen.add(code)
        if entry.get('name') != catalog[code]['parameter_name'] or entry.get('trigger') != catalog[code]['trigger']:
            raise ValueError('matrix registry catalog semantics drift')
        if not entry['atomicRules'] and not entry.get('gap'):
            raise ValueError('matrix registry unsupported reason missing')
        for rule in entry['atomicRules']:
            if (not isinstance(rule, dict) or not isinstance(rule.get('ruleId'), str)
                    or rule['ruleId'] in rule_ids or rule.get('version') != '1'
                    or rule.get('family') not in _FAMILIES or type(rule.get('enabled')) is not bool
                    or rule.get('valueKind') not in {'DECIMAL', 'INTEGER', 'CATEGORY', 'CONCRETE_CLASS'}
                    or rule.get('prosePolicy') not in {None, 'FIRE_CLASS_SENTENCE_V1'}
                    or not isinstance(rule.get('attribute'), str)
                    or not isinstance(rule.get('canonicalUnit'), str)
                    or any(not isinstance(rule.get(key), list) or not rule[key] or
                           any(not isinstance(v, str) or not v.strip() for v in rule[key])
                           for key in ['labels', 'expectedSections', 'actualSections'])
                    or not isinstance(rule.get('requiredContext'), list)
                    or not isinstance(rule.get('allowedStagePairs'), list) or not rule['allowedStagePairs']
                    or rule['allowedStagePairs'][0] != ['PD', 'RD']
                    or any(pair not in [['PD', 'RD'], ['PD', 'ID'], ['RD', 'ID']] for pair in rule['allowedStagePairs'])
                    or len({tuple(pair) for pair in rule['allowedStagePairs']}) != len(rule['allowedStagePairs'])
                    or rule.get('comparisonVariants') != ['_'.join(pair) for pair in rule['allowedStagePairs']]):
                raise ValueError('matrix registry atomic rule invalid')
            rule_ids.add(rule['ruleId'])
            subrule_context = rule.get('subruleContext')
            egress_identity = any(rule['ruleId'] == policy['ruleId'] or rule['attribute'] == policy['attribute']
                                  for policy in _EGRESS_HEIGHT_POLICIES.values())
            if egress_identity and (not isinstance(subrule_context, dict)
                                    or not isinstance(subrule_context.get('componentRole'), str)
                                    or subrule_context.get('componentRole') not in _EGRESS_HEIGHT_POLICIES):
                # Removing both the typed policy and its atomic gate must not
                # turn a known clear-height rule into an unscoped numeric rule.
                raise ValueError('matrix registry atomic subrule context invalid')
            stair_identity = any(rule['ruleId'] == policy['ruleId'] or rule['attribute'] == policy['attribute']
                                 for policy in _STAIR_DIMENSION_POLICIES.values())
            if stair_identity and (not isinstance(subrule_context, dict)
                                   or not isinstance(subrule_context.get('componentRole'), str)
                                   or subrule_context.get('componentRole') not in _STAIR_DIMENSION_POLICIES):
                raise ValueError('matrix registry atomic subrule context invalid')
            if (rule['ruleId'] == _FENCE_RULE_ID or rule['attribute'] == 'TERRITORY_FENCE_HEIGHT') and (
                    not isinstance(subrule_context, dict)
                    or subrule_context.get('componentRole') != 'TERRITORY_FENCE_SEGMENT'):
                raise ValueError('matrix registry atomic subrule context invalid')
            if (rule['ruleId'] == _PROJECT_ZERO_RULE_ID or rule['attribute'] == 'PROJECT_ZERO_ABSOLUTE_ELEVATION') and (
                    not isinstance(subrule_context, dict)
                    or subrule_context.get('componentRole') != 'PROJECT_ZERO_DATUM'):
                raise ValueError('matrix registry atomic subrule context invalid')
            if (rule['ruleId'] == _REBAR_RULE_ID or rule['attribute'] == 'WORKING_REINFORCEMENT_CLASS'
                    or rule['canonicalUnit'] == 'rebar_catalog_example') and (
                    not isinstance(subrule_context, dict)
                    or subrule_context.get('componentRole') != 'WORKING_REINFORCEMENT_POSITION'):
                raise ValueError('matrix registry atomic subrule context invalid')
            if subrule_context is None and any(key.startswith('ATOMIC_SUBRULE_SCOPE:') for key in rule['requiredContext']):
                raise ValueError('matrix registry atomic subrule context invalid')
            if subrule_context is not None:
                common_valid = (isinstance(subrule_context, dict)
                    and set(subrule_context) == {'schemaVersion', 'componentRole', 'identityFields'}
                    and subrule_context.get('schemaVersion') == 'matched-atomic-context-v1'
                    and isinstance(subrule_context.get('componentRole'), str)
                    and subrule_context.get('identityFields') == _SUBRULE_IDENTITY_FIELDS)
                role = subrule_context.get('componentRole') if isinstance(subrule_context, dict) else None
                legacy_policy = (isinstance(role, str) and role in _SUBRULE_COMPONENT_ROLES
                    and rule['requiredContext'] == ['ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']]
                    and rule['family'] == 'DECREASE' and bool(entry.get('gap')))
                sidewalk_policy = (role == 'SIDEWALK_TILE_PAVING' and code == 'SPZU-026'
                    and entry.get('family') == 'DIFFERENT' and entry.get('gap') == _SIDEWALK_GAP
                    and all(rule.get(key) == value for key, value in _SIDEWALK_RULE_POLICY.items()))
                egress_policy = (isinstance(role, str) and role in _EGRESS_HEIGHT_POLICIES and code == 'AR-042'
                    and entry.get('family') == 'LOWER_BOUND' and entry.get('gap') == _EGRESS_HEIGHT_GAP
                    and all(rule.get(key) == value for key, value in _EGRESS_HEIGHT_POLICIES[role].items()))
                stair_policy = (isinstance(role, str) and role in _STAIR_DIMENSION_POLICIES and code == 'AR-048'
                    and entry.get('family') is None and entry.get('gap') == _STAIR_DIMENSIONS_GAP
                    and all(rule.get(key) == value for key, value in _STAIR_DIMENSION_POLICIES[role].items()))
                fence_policy = (role == 'TERRITORY_FENCE_SEGMENT' and code == 'SPZU-036'
                    and entry.get('family') is None and entry.get('gap') == _FENCE_GAP
                    and all(rule.get(key) == value for key, value in _FENCE_RULE_POLICY.items()))
                project_zero_policy = (role == 'PROJECT_ZERO_DATUM' and code == 'PZ-009'
                    and entry.get('family') is None and entry.get('gap') == _PROJECT_ZERO_GAP
                    and all(rule.get(key) == value for key, value in _PROJECT_ZERO_POLICY.items()))
                rebar_policy = (role == 'WORKING_REINFORCEMENT_POSITION' and code == 'KR-057'
                    and entry.get('family') is None and entry.get('gap') == _REBAR_GAP
                    and all(rule.get(key) == value for key, value in _REBAR_POLICY.items()))
                if not common_valid or not (legacy_policy or sidewalk_policy or egress_policy or stair_policy or fence_policy or project_zero_policy or rebar_policy):
                    raise ValueError('matrix registry atomic subrule context invalid')
            threshold = rule.get('threshold')
            if threshold is not None and (not isinstance(threshold, dict)
                    or _decimal(threshold.get('value')) is None or threshold.get('strict') is not True
                    or not isinstance(threshold.get('unit'), str)):
                raise ValueError('matrix registry threshold invalid')
    if seen != set(catalog):
        raise ValueError('matrix registry missing parameter')


def _sources(object_id: str, sources: object) -> dict[str, dict[str, Any]]:
    if not isinstance(sources, list):
        raise ValueError('matrix sources must be array')
    result = {}
    for raw in sources:
        if not isinstance(raw, dict):
            raise ValueError('matrix source invalid')
        review = raw.get('review') if isinstance(raw.get('review'), dict) else {}
        src = {**raw, **{key: value for key, value in review.items() if key in {
            'revisionStatus', 'approvalStatus', 'linkGroupId', 'pageStages', 'sectionCode', 'scopeProofs'}}}
        src.pop('_factBindings', None)
        identity, sha, stages = src.get('sourceFileId'), src.get('sha256'), src.get('stages')
        if (not isinstance(identity, str) or not identity.strip() or identity in result
                or not isinstance(sha, str) or not _SHA.fullmatch(sha)
                or src.get('objectId', object_id) != object_id
                or not isinstance(stages, list) or not stages or len(set(stages)) != len(stages)
                or any(s not in {'PD', 'RD', 'ID'} for s in stages)):
            raise ValueError('matrix source identity or provenance invalid')
        for key, allowed in [('revisionStatus', {'CURRENT', 'SUPERSEDED', 'UNKNOWN'}),
                             ('approvalStatus', {'APPROVED', 'UNAPPROVED', 'UNKNOWN'})]:
            src.setdefault(key, 'UNKNOWN')
            if src[key] not in allowed:
                raise ValueError('matrix source review invalid')
        page_stages = src.get('pageStages', {})
        if not isinstance(page_stages, dict) or any(not isinstance(k, str) or not k.isdecimal()
                or str(int(k)) != k or int(k) < 1 or v not in {*stages, 'UNRESOLVED'}
                for k, v in page_stages.items()):
            raise ValueError('matrix source page stages invalid')
        src['pageStages'] = page_stages
        if src.get('sectionCode') is not None and not isinstance(src['sectionCode'], str):
            raise ValueError('matrix source section invalid')
        result[identity] = src
    return result


_FACT_CONTEXT_STRINGS = {'drawingSection': 40, 'parameterCode': 40, 'attribute': 100,
                         'threshold': 60, 'canonicalUnit': 40, 'limitValue': 60,
                         'componentRole': 100, 'componentKey': 200, 'zoneKey': 200,
                         'operatingModeKey': 200, 'measurementBasisKey': 200}
_FACT_CONTEXT_BOOLEANS = {'applicable', 'approvedChangePresent', 'reductionConfirmed'}
_FACT_CONTEXT_KEY = re.compile(r'[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_-]+)?\Z')
_JS_TRIM = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def _fact_scope_string(value: Any, maximum: int, minimum: int = 0, *, trim: bool = False) -> str:
    if type(value) is not str:
        raise ValueError('matrix fact scope string invalid')
    value = value.strip(_JS_TRIM) if trim else value
    try:
        length = len(value.encode('utf-16-le')) // 2
    except UnicodeEncodeError as error:
        raise ValueError('matrix fact scope string invalid') from error
    if not minimum <= length <= maximum:
        raise ValueError('matrix fact scope string invalid')
    return value


def _validate_project_zero_authority(value: Any) -> None:
    required = {'kind', 'sourceFileId', 'sourceSha256', 'pageNumber', 'target'}
    if (type(value) is not dict or not required <= set(value) <= required | {'reviewContentHash'}
            or value.get('kind') != 'APPROVED_PD_GEODETIC_BASIS'
            or type(value.get('pageNumber')) is not int or not 0 < value['pageNumber'] <= 9007199254740991
            or type(value.get('sourceSha256')) is not str or not _SHA.fullmatch(value['sourceSha256'])):
        raise ValueError('matrix project zero authority invalid')
    value['sourceFileId'] = _fact_scope_string(value.get('sourceFileId'), 200, 1, trim=True)
    target = value.get('target')
    if (type(target) is not dict
            or set(target) != {'checkId', 'executionContentHash', 'observationId', 'evidenceHash', 'textArtifactHash'}):
        raise ValueError('matrix project zero authority target invalid')
    target['checkId'] = _fact_scope_string(target.get('checkId'), 120, 1, trim=True)
    if any(type(target[key]) is not str or not _SHA.fullmatch(target[key])
           for key in ['executionContentHash', 'observationId', 'evidenceHash', 'textArtifactHash']):
        raise ValueError('matrix project zero authority target hash invalid')
    if ('reviewContentHash' in value and (type(value['reviewContentHash']) is not str
            or not _SHA.fullmatch(value['reviewContentHash']))):
        raise ValueError('matrix project zero authority review hash invalid')


def _validate_fact_bindings(value: Any) -> list[dict[str, Any]]:
    """Mirror strict matrix-fact-scopes-v1 human-details schema, without adding trust."""
    if type(value) is not list or len(value) > 500:
        raise ValueError('matrix fact scope bindings invalid')
    bindings = copy.deepcopy(value)
    seen: set[tuple[str, str]] = set()
    entities: dict[str, str] = {}
    for binding in bindings:
        required = {'ruleId', 'ruleVersion', 'parameterCode', 'entityKey', 'reference', 'target', 'contexts'}
        if type(binding) is not dict or not required <= set(binding) <= required | {'tableContextReview'}:
            raise ValueError('matrix fact scope binding fields invalid')
        for key, maximum, minimum in [('ruleId', 180, 1), ('ruleVersion', 40, 1), ('parameterCode', 40, 1),
                                      ('entityKey', 200, 1), ('reference', 1000, 8)]:
            binding[key] = _fact_scope_string(binding[key], maximum, minimum, trim=True)
        target = binding['target']
        if type(target) is not dict or set(target) != {'checkId', 'executionContentHash', 'observationId', 'evidenceHash', 'textArtifactHash'}:
            raise ValueError('matrix fact scope target invalid')
        target['checkId'] = _fact_scope_string(target['checkId'], 120, 1, trim=True)
        if any(type(target[key]) is not str or not _SHA.fullmatch(target[key])
               for key in ['executionContentHash', 'observationId', 'evidenceHash', 'textArtifactHash']):
            raise ValueError('matrix fact scope target hash invalid')
        contexts = binding['contexts']
        if type(contexts) is not dict or len(contexts) > 100:
            raise ValueError('matrix fact scope contexts invalid')
        for key, context in contexts.items():
            _fact_scope_string(key, 180)
            if (not _FACT_CONTEXT_KEY.fullmatch(key) or re.match(r'^(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|$)', key)
                    or type(context) is not dict or 'reference' not in context
                    or not set(context) <= {'reference', *_FACT_CONTEXT_STRINGS, *_FACT_CONTEXT_BOOLEANS,
                                            *({'projectZeroAuthority'} if key == 'PROJECT_ZERO_GEODETIC_AUTHORITY' else set())}):
                raise ValueError('matrix fact scope context fields invalid')
            context['reference'] = _fact_scope_string(context['reference'], 1000, 8, trim=True)
            if 'projectZeroAuthority' in context:
                if binding['ruleId'] != _PROJECT_ZERO_RULE_ID or binding['ruleVersion'] != '1' or binding['parameterCode'] != 'PZ-009':
                    raise ValueError('matrix project zero authority rule invalid')
                _validate_project_zero_authority(context['projectZeroAuthority'])
            for field, item in list(context.items()):
                if field in _FACT_CONTEXT_STRINGS:
                    trimmed = field in {'componentRole', 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey'}
                    context[field] = _fact_scope_string(item, _FACT_CONTEXT_STRINGS[field], int(trimmed), trim=trimmed)
                    if field == 'limitValue' and not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', context[field]):
                        raise ValueError('matrix fact scope limit invalid')
                elif field in _FACT_CONTEXT_BOOLEANS and type(item) is not bool:
                    raise ValueError('matrix fact scope context type invalid')
        if 'tableContextReview' in binding:
            table = binding['tableContextReview']
            if (type(table) is not dict or set(table) != {'fragmentsHash', 'reference'}
                    or type(table['fragmentsHash']) is not str or not _SHA.fullmatch(table['fragmentsHash'])):
                raise ValueError('matrix fact scope table review invalid')
            table['reference'] = _fact_scope_string(table['reference'], 1000, 8, trim=True)
        identity = target['observationId']
        if ((identity, binding['ruleId']) in seen
                or identity in entities and entities[identity] != binding['entityKey']):
            raise ValueError('matrix fact scope duplicate or conflicting entity')
        seen.add((identity, binding['ruleId']))
        entities[identity] = binding['entityKey']
    return bindings


class _FactBindings:
    """Private per-build snapshot. Cache is populated only after all facts are extracted."""

    def __init__(self, source: dict[str, Any], artifact: dict[str, Any] | None,
                 atomic: list[tuple[dict[str, Any], dict[str, Any]]], object_id: str, manifest: str):
        envelope = source['scopeProofs']['FACT_BINDINGS']
        if (type(envelope) is not dict or envelope.get('status') != 'VERIFIED'
                or envelope.get('sourceFileId') != source['sourceFileId']
                or envelope.get('sourceSha256') != source['sha256'] or envelope.get('objectId') != object_id
                or envelope.get('inputManifestHash') != manifest
                or envelope.get('schemaVersion') != 'matrix-fact-scopes-v1'):
            raise ValueError('matrix fact scope provenance invalid')
        _fact_scope_string(envelope.get('reference'), 100000, 1, trim=True)
        self.review_content_hash = envelope.get('reviewContentHash')
        if 'reviewContentHash' in envelope and (type(self.review_content_hash) is not str
                or not _SHA.fullmatch(self.review_content_hash)):
            raise ValueError('matrix fact scope review content hash invalid')
        self.bindings = _validate_fact_bindings(envelope.get('bindings'))
        if self.bindings and artifact is None:
            raise ValueError('matrix fact scope original text artifact missing')
        self.artifact = copy.deepcopy(artifact) if self.bindings else None
        self.rules = [(entry['parameterCode'], rule) for entry, rule in atomic]
        self.source = {'sourceFileId': source['sourceFileId'], 'sha256': source['sha256']}
        self.object_id, self.manifest = object_id, manifest
        self.cache: dict[str, tuple[dict[str, str] | None, list[dict[str, Any]]]] = {}

    def matching(self, fact: dict[str, Any]) -> tuple[dict[str, str] | None, list[dict[str, Any]]]:
        if fact['id'] not in self.cache:
            candidates = [binding for binding in self.bindings if binding['target']['observationId'] == fact['id']
                          and binding['parameterCode'] in fact['parameterCodes']
                          and any(code == binding['parameterCode'] and rule['ruleId'] == binding['ruleId']
                                  and rule['version'] == binding['ruleVersion'] and rule['attribute'] == fact['attribute']
                                  and rule['canonicalUnit'] == fact['unit'] for code, rule in self.rules)]
            target = derive_matrix_fact_target(fact, self.artifact) if candidates else None
            matches = [binding for binding in candidates if target
                       and binding['target']['evidenceHash'] == target['evidenceHash']
                       and binding['target']['textArtifactHash'] == target['textArtifactHash']]
            self.cache[fact['id']] = target, matches
        return self.cache[fact['id']]

    def selected(self, fact: dict[str, Any], rule: dict[str, Any], code: str) -> tuple[dict[str, str] | None, dict[str, Any] | None]:
        target, bindings = self.matching(fact)
        return target, next((binding for binding in bindings if binding['ruleId'] == rule['ruleId']
                            and binding['ruleVersion'] == rule['version'] and binding['parameterCode'] == code), None)

    def entity(self, fact: dict[str, Any]) -> str | None:
        entities = {binding['entityKey'] for binding in self.matching(fact)[1]}
        return next(iter(entities)) if len(entities) == 1 else None

    def proof(self, fact: dict[str, Any] | None, rule: dict[str, Any] | None, code: str | None, key: str) -> dict[str, Any] | None:
        if fact is None or rule is None or code is None or re.match(r'^(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|$)', key):
            return None
        _, binding = self.selected(fact, rule, code)
        if binding is None:
            return None
        details = {'reference': binding['reference']} if key == 'ENTITY_SCOPE' else binding['contexts'].get(key)
        if details and key == 'PROJECT_ZERO_GEODETIC_AUTHORITY':
            # Server metadata is applied last; human context cannot replace it.
            details = {**details, 'serverReviewContentHash': self.review_content_hash,
                       'bindingTarget': binding['target']}
        return ({**details, 'sourceFileId': self.source['sourceFileId'], 'sourceSha256': self.source['sha256'],
                 'objectId': self.object_id, 'inputManifestHash': self.manifest,
                 'entityKey': binding['entityKey'], 'status': 'VERIFIED'} if details else None)

    def effective_flags(self, fact: dict[str, Any], rule: dict[str, Any], code: str) -> list[str]:
        target, binding = self.selected(fact, rule, code)
        reviewed = (target is not None and target.get('fragmentsHash') is not None and binding is not None
                    and binding.get('tableContextReview', {}).get('fragmentsHash') == target['fragmentsHash'])
        return [flag for flag in fact['sourceFlags'] if flag != 'TABLE_CONTEXT_UNVERIFIED' or not reviewed]


def _proof(src: dict[str, Any], key: str, object_id: str, manifest: str, *,
           fact: dict[str, Any] | None = None, rule: dict[str, Any] | None = None,
           parameter_code: str | None = None) -> dict[str, Any] | None:
    if '_factBindings' in src:
        return src['_factBindings'].proof(fact, rule, parameter_code, key)
    proofs = src.get('scopeProofs')
    p = proofs.get(key) if isinstance(proofs, dict) else None
    if (not isinstance(p, dict) or p.get('status') != 'VERIFIED'
            or not isinstance(p.get('reference'), str) or not p['reference'].strip()
            or p.get('sourceFileId') != src['sourceFileId'] or p.get('sourceSha256') != src['sha256']
            or p.get('objectId') != object_id or p.get('inputManifestHash') != manifest
            or not isinstance(p.get('entityKey'), str) or not p['entityKey'].strip()):
        return None
    return p


def _bbox(box: list[int], page: dict[str, Any]) -> dict[str, float]:
    w, h = page['widthMilliPoints'], page['heightMilliPoints']
    return {'x': box[0] / w, 'y': 1 - box[3] / h,
            'width': (box[2] - box[0]) / w, 'height': (box[3] - box[1]) / h}


def _page_lines(page: dict[str, Any]) -> list[dict[str, Any]]:
    lines = []
    for bi, block in enumerate(page['blocks']):
        parts = block['text'].splitlines()
        for li, text in enumerate(parts):
            if not text.strip():
                continue
            boxes = block.get('lineBboxesMilliPoints')
            # A block box remains a valid coarse locator; never invent line geometry.
            box = boxes[li] if boxes is not None else block['bboxMilliPoints']
            lines.append({'blockId': f'{bi}:{li}', 'text': text, 'box': box,
                          'bbox': _bbox(box, page), 'exactLineBox': boxes is not None or len(parts) == 1})
    return lines


def _clean(text: str) -> str:
    return re.sub(r'\s+', ' ', text.replace('\u202f', ' ').replace('\u00a0', ' ')).strip()


def _unit_pattern(unit: str) -> str:
    # CAD exports sometimes split superscripts into a separate text item.
    return re.escape(unit).replace('²', r'\s*²').replace('³', r'\s*³')


@lru_cache(maxsize=1024)
def _patterns(labels: tuple[str, ...], unit_aliases: tuple[str, ...], kind: str,
              values: tuple[str, ...]) -> tuple[re.Pattern[str], ...]:
    label = '|'.join(re.escape(v) for v in sorted(labels, key=len, reverse=True))
    lead = r'(?i:\s*(?:' + label + r'))\s*(?:[:,;=|—–-]\s*|\s+)'
    if kind == 'CONCRETE_CLASS':
        value = r'(?P<value>[BВ]' + _NUMBER + ')'
        return (re.compile('^' + lead + value + r'\s*[.;]?\s*$'),)
    if kind == 'CATEGORY':
        value = r'(?P<value>' + '|'.join(re.escape(v) for v in sorted(values, key=len, reverse=True)) + ')'
        return (re.compile('^' + lead + value + r'\s*[.;]?\s*$'),)
    units = '|'.join(_unit_pattern(v) for v in sorted(set(unit_aliases), key=len, reverse=True))
    number = r'(?P<value>' + _NUMBER + ')'
    unit = r'(?P<unit>' + units + ')'
    # Exactly one numeric value. Multi-column alternatives or ranges abstain.
    return (re.compile('^' + lead + number + r'\s*(?:\|\s*)?' + unit + r'\s*[.;]?\s*$'),
            re.compile('^' + lead + unit + r'\s*(?:\|\s*|[:,;]\s*|\s+)' + number + r'\s*[.;]?\s*$'))


def _match(text: str, rule: dict[str, Any]) -> re.Match[str] | None:
    if rule['attribute'] in {'TERRITORY_FENCE_HEIGHT', *[p['attribute'] for p in _STAIR_DIMENSION_POLICIES.values()]}:
        label = '|'.join(re.escape(value) for value in rule['labels'])
        return re.fullmatch(r'(?i:(?:' + label + r'))\s*(?:[:,;=|—–-]\s*|\s+)'
                            r'(?P<value>' + _STAIR_NUMBER + r')\s*(?P<unit>' + _STAIR_UNIT + r')\s*[.;]?',
                            _clean(text))
    additions = [] if rule.get('subruleContext') else _UNIT_ADDITIONS.get(rule['canonicalUnit'], [])
    aliases = tuple(sorted(set(rule['unitAliases'] + additions)))
    patterns = _patterns(tuple(rule['labels']), aliases, rule['valueKind'], tuple(rule['allowedValues']))
    matches = [m for pattern in patterns if (m := pattern.fullmatch(_clean(text))) is not None]
    return matches[0] if len(matches) == 1 else None


def _rows(lines: list[dict[str, Any]], rule: dict[str, Any], *, stage: str | None = None) -> list[tuple[str, list[dict[str, Any]], re.Match[str], list[str]]]:
    # Datum prose requires complete floor wording and independent unit authority.
    # A generic label/value row must never bypass the frozen source grammar.
    if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID}:
        return []
    result = []
    occupied: set[str] = set()
    for line in lines:
        # A complete RD compressive-strength statement can contain distinct F/W
        # marks. They do not become strength values or establish element scope.
        # Full-line matching rejects surface classes, alternatives and ranges.
        if (stage == 'RD' and rule['attribute'] == 'CONCRETE_CLASS'
                and rule['valueKind'] == 'CONCRETE_CLASS'
                and (m := _RD_CONCRETE_CLASS_SENTENCE.fullmatch(_clean(line['text']))) is not None):
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
            continue
        # The complete statement explicitly names two components. Only the
        # slab's named value is a fact; the capital remains in original text.
        if (stage == 'RD' and rule['attribute'] == 'SLAB_THICKNESS'
                and rule['valueKind'] == 'DECIMAL'
                and (m := _RD_SLAB_THICKNESS_SENTENCE.fullmatch(_clean(line['text']))) is not None):
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
            continue
        if rule.get('prosePolicy') == 'FIRE_CLASS_SENTENCE_V1' and re.match(
                r'(?i)^(?:Здание|Комплекс|Объект)\s+запроектирован(?:о|а|ы)?\s+', _clean(line['text'])):
            pattern = (r'(?<!\w)(?P<value>I|II|III|IV|V)\s+степени\s+огнестойкости\b'
                       if rule['attribute'] == 'FIRE_RESISTANCE_DEGREE' else
                       r'(?<!\w)(?P<value>[CС][0-3])\s+класса\s+конструктивной\s+пожарной\s+опасности\b')
            matches = list(re.finditer(pattern, _clean(line['text'])))
            if len(matches) == 1:
                result.append((line['text'], [line], matches[0], []))
                occupied.add(line['blockId'])
                continue
        if (m := _match(line['text'], rule)) is not None:
            result.append((line['text'], [line], m, []))
            occupied.add(line['blockId'])
    if rule.get('subruleContext', {}).get('componentRole') in {'SIDEWALK_TILE_PAVING', 'TERRITORY_FENCE_SEGMENT', *_EGRESS_ROLE_BASIS, *_STAIR_ROLE_BASIS}:
        # These bounded policies require label, value and unit on one full line.
        # Public tables need a separate reviewed layout grammar.
        return result
    labels = {_clean(label).casefold().rstrip(':,;') for label in rule['labels']}
    for label in lines:
        if label['blockId'] in occupied or not label['exactLineBox']:
            continue
        # Only a literal whole label may initiate a cross-block table row.
        text = _clean(label['text']).casefold().rstrip(':,;')
        if text not in labels:
            continue
        box = label['box']; height = max(1, box[3] - box[1]); center = (box[1] + box[3]) / 2
        cells = [line for line in lines if line is not label and line['exactLineBox']
                 and line['box'][0] >= box[2] and line['box'][0] - box[2] <= height * 32
                 and abs((line['box'][1] + line['box'][3]) / 2 - center) <= height * .25]
        cells.sort(key=lambda item: item['box'][0])
        # More than two cells or overlapping columns may be alternatives, never pick one.
        if not 1 <= len(cells) <= 2 or any(cells[i]['box'][2] > cells[i + 1]['box'][0]
                                          for i in range(len(cells) - 1)):
            continue
        fragments = [label, *cells]
        text = ' '.join(f['text'] for f in fragments)
        if (m := _match(text, rule)) is not None:
            result.append((text, fragments, m, []))
            continue
        if len(cells) == 1 and re.fullmatch(_NUMBER, _clean(cells[0]['text'])):
            value_cell = cells[0]
            additions = [] if rule.get('subruleContext') else _UNIT_ADDITIONS.get(rule['canonicalUnit'], [])
            aliases = set(rule['unitAliases'] + additions)
            headers = []
            for header in lines:
                hb = header['box']
                if (not header['exactLineBox'] or hb[1] <= box[3] or hb[1] - box[3] > height * 20
                        or hb[0] > value_cell['box'][2] or hb[2] < value_cell['box'][0]):
                    continue
                # Explicit table-column wording only. Unit binding remains a candidate.
                for unit in sorted(aliases, key=len, reverse=True):
                    pattern = r'(?i:(?:В гр\. ГПЗУ|Значение|Показатель|Площадь)\s*[,;:]?)\s*' + _unit_pattern(unit)
                    if re.fullmatch(pattern, _clean(header['text'])):
                        headers.append((header, unit))
            if len(headers) == 1:
                header, unit = headers[0]
                if (m := _match(label['text'].rstrip(':,;') + ' ' + value_cell['text'] + ' ' + unit, rule)) is not None:
                    fragments = [label, value_cell, header]
                    result.append((' '.join(f['text'] for f in fragments), fragments, m,
                                   ['TABLE_HEADER_UNIT_SCOPE_UNVERIFIED']))
    return result


def _stair_dimensions_prose_rows(page: dict[str, Any], *, stage: str) -> dict[str, list[tuple]]:
    """One explicit compound statement; geometry never supplies an entity or norm."""
    if stage not in {'PD', 'RD'}:
        return {}
    lines = _page_lines(page)
    firsts = [line for line in lines if _clean(line['text']).casefold().startswith('ширина проступей ступеней')]
    seconds = [(line, match) for line in lines
               if (match := _STAIR_PROSE_SECOND.fullmatch(_clean(line['text']))) is not None]
    if len(firsts) != 1 or len(seconds) != 1:
        return {}
    first, (second, riser) = firsts[0], seconds[0]
    tread = _STAIR_PROSE_FIRST.fullmatch(_clean(first['text']))
    if tread is None or not first['exactLineBox'] or not second['exactLineBox']:
        return {}
    a, b = first['box'], second['box']
    if (a[3] <= a[1] or b[3] <= b[1] or abs(a[0] - b[0]) > 2000
            or abs((a[3] - a[1]) - (b[3] - b[1])) > 1000
            or not 0 <= a[1] - b[3] <= 18000):
        return {}
    union = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
    if any(line is not first and line is not second
           and line['box'][0] < union[2] and line['box'][2] > union[0]
           and line['box'][1] < union[3] and line['box'][3] > union[1] for line in lines):
        return {}
    text = first['text'] + ' ' + second['text']
    return {attribute: [(text, [first, second], match, [], [])]
            for attribute, match in [('STAIR_TREAD_DEPTH', tread), ('STAIR_RISER_HEIGHT', riser)]}


def _territory_fence_prose_rows(page: dict[str, Any], *, stage: str) -> list[tuple]:
    """Literal project height only. No segment identity or fence type is inferred."""
    if stage != 'PD':
        return []
    lines = _page_lines(page)
    anchors = [line for line in lines if _clean(line['text']).casefold().startswith('по границе территории объекта')]
    seconds = [(line, match) for line in lines
               if (match := _FENCE_SECOND.fullmatch(_clean(line['text']))) is not None]
    if len(anchors) != 1 or len(seconds) != 1:
        return []
    first, (second, match) = anchors[0], seconds[0]
    if _clean(first['text']).casefold() != _FENCE_FIRST or not first['exactLineBox'] or not second['exactLineBox']:
        return []
    first_block, first_line = map(int, first['blockId'].split(':'))
    second_block, second_line = map(int, second['blockId'].split(':'))
    # The source is a paragraph with a first-line indent, not two neighboring columns.
    if first_block != second_block or second_line != first_line + 1:
        return []
    a, b = first['box'], second['box']
    if (a[3] <= a[1] or b[3] <= b[1] or not 0 <= a[0] - b[0] <= 40000
            or abs(a[2] - b[2]) > 2000 or abs((a[3] - a[1]) - (b[3] - b[1])) > 1000
            or not 0 <= a[1] - b[3] <= 18000):
        return []
    union = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
    if any(line is not first and line is not second
           and line['box'][0] < union[2] and line['box'][2] > union[0]
           and line['box'][1] < union[3] and line['box'][3] > union[1] for line in lines):
        return []
    return [(first['text'] + ' ' + second['text'], [first, second], match, [], [])]


def _project_zero_rows(page: dict[str, Any], stage: str) -> list[tuple]:
    rows = []
    for candidate in extract_project_zero_candidates(page, stage):
        primary = [{'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'text': part['rawText'], 'box': part['bboxMilliPoints'],
                    'bbox': _bbox(part['bboxMilliPoints'], page)} for part in candidate['primaryFragments']]
        context = [{'pageNumber': page['pageNumber'], 'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'rawText': part['rawText'], 'bbox': _bbox(part['bboxMilliPoints'], page),
                    'role': 'UNIT_DECLARATION'} for part in candidate['unitAuthorityFragments']]
        rows.append((' '.join(part['text'] for part in primary), primary, candidate, [], context))
    return rows


def _rebar_rows(page: dict[str, Any], stage: str) -> list[tuple]:
    rows = []
    for candidate in extract_rebar_candidates(page, stage):
        primary = [{'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'text': part['rawText'], 'box': part['bboxMilliPoints'],
                    'bbox': _bbox(part['bboxMilliPoints'], page)} for part in candidate['primaryFragments']]
        context = [{'pageNumber': page['pageNumber'], 'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'rawText': part['rawText'], 'bbox': _bbox(part['bboxMilliPoints'], page),
                    'role': 'MATERIAL_SCOPE'} for part in candidate['scopeFragments']]
        rows.append((' '.join(part['text'] for part in primary), primary, candidate, [], context))
    return rows


def _concrete_prose_rows(page: dict[str, Any], source: dict[str, Any],
                         pages: dict[int, dict[str, Any]]) -> list[tuple]:
    stage = _page_stage(source, page)
    if stage not in ('PD', 'RD'):
        return []
    previous = pages.get(page['pageNumber'] - 1) if stage == 'PD' else None
    # Stage comes from the authenticated source decision, never from header text.
    # Even a current-page header cannot borrow a preceding non-PD page.
    if previous is not None and _page_stage(source, previous) != 'PD':
        return []
    rows = []
    for candidate in extract_concrete_candidates(page, stage, previous):
        primary = [{'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'text': part['rawText'], 'box': part['bboxMilliPoints'],
                    'bbox': _bbox(part['bboxMilliPoints'], page)} for part in candidate['primaryFragments']]
        context = [{'pageNumber': part['pageNumber'], 'blockId': f"{part['blockIndex']}:{part['lineIndex']}",
                    'rawText': part['rawText'], 'bbox': _bbox(part['bboxMilliPoints'], pages[part['pageNumber']]),
                    'role': part['role']} for part in candidate['contextFragments']]
        # Existing concrete class normalization preserves literal B/В glyphs and
        # B_CLASS. No numeric/null-unit exception or legacy normalization changes.
        match = re.fullmatch(r'(?P<value>[BВ](?:25|30))', candidate['value'])
        rows.append((' '.join(part['text'] for part in primary), primary, match, [], context))
    return rows


def _page_stage(source: dict[str, Any], page: dict[str, Any]) -> str:
    return (source['stages'][0] if len(source['stages']) == 1
            else source['pageStages'].get(str(page['pageNumber']), 'UNRESOLVED'))


def _pd_concrete_table_rows(page: dict[str, Any], adjacent_pages: list[dict[str, Any]],
                            source: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]], re.Match[str], list[str], list[dict[str, Any]]]]:
    """Bounded concrete schedule; layout context remains explicitly unverified.

    The attribute header may precede the table by one PDF page. Only row label
    and value form primary evidence. Header/scope fragments never establish an
    element, source approval, or a complete inventory.
    """
    if _page_stage(source, page) != 'PD':
        return []
    lines = _page_lines(page)
    scopes = [line for line in lines if _PD_CONCRETE_TABLE_SCOPE.fullmatch(_clean(line['text']))]
    if len(scopes) != 1 or not scopes[0]['exactLineBox']:
        return []
    scope = scopes[0]
    headers = []
    for candidate_page in adjacent_pages:
        candidate_lines = _page_lines(candidate_page)
        for bi, block in enumerate(candidate_page['blocks']):
            if _PD_CONCRETE_TABLE_HEADER.fullmatch(_clean(block['text'])):
                headers.append((candidate_page, [line for line in candidate_lines
                                                if line['blockId'].startswith(f'{bi}:')]))
    if len(headers) != 1:
        return []
    header_page, header_lines = headers[0]
    if (_page_stage(source, header_page) != 'PD' or not 1 <= len(header_lines) <= 3
            or any(not line['exactLineBox'] for line in header_lines)
            or (header_page['pageNumber'] == page['pageNumber']
                and min(line['box'][1] for line in header_lines) <= scope['box'][3])):
        return []
    context = [{'pageNumber': header_page['pageNumber'], 'blockId': line['blockId'],
                'rawText': line['text'], 'bbox': line['bbox'], 'role': 'ATTRIBUTE_HEADER'}
               for line in header_lines]
    context.append({'pageNumber': page['pageNumber'], 'blockId': scope['blockId'],
                    'rawText': scope['text'], 'bbox': scope['bbox'], 'role': 'TABLE_SCOPE'})
    flags = ['TABLE_CONTEXT_UNVERIFIED']
    if header_page['quality']['disposition'] != 'TEXT_LAYER_CANDIDATE':
        flags.append('PAGE_TEXT_REQUIRES_OCR')
    below = [line for line in lines if line is not scope and line['box'][3] <= scope['box'][1]]
    stop = max([0, *[line['box'][3] for line in below
                    if not _PD_CONCRETE_TABLE_LABEL.fullmatch(_clean(line['text']))
                    and not _PD_CONCRETE_TABLE_VALUE.fullmatch(_clean(line['text']))
                    and _clean(line['text']) != '·']])
    labels = [line for line in below if line['exactLineBox']
              and _PD_CONCRETE_TABLE_LABEL.fullmatch(_clean(line['text']))]
    result = []
    for label in labels:
        box = label['box']; height = max(1, box[3] - box[1]); center = (box[1] + box[3]) / 2
        aligned = [line for line in lines if line is not label
                   and abs((line['box'][1] + line['box'][3]) / 2 - center) <= height / 4]
        cells = [line for line in aligned if line['exactLineBox'] and line['box'][0] >= box[2]
                 and line['box'][0] - box[2] <= height * 32]
        if len(cells) != 1:
            continue
        value_cell = cells[0]
        match = _PD_CONCRETE_TABLE_VALUE.fullmatch(_clean(value_cell['text']))
        extras = [line for line in aligned if line is not value_cell]
        if (match is None or len(extras) > 1 or any(not line['exactLineBox'] or _clean(line['text']) != '·'
                or line['box'][2] > box[0] or box[0] - line['box'][2] > 2 * height for line in extras)):
            continue
        bottom, top = min(box[1], value_cell['box'][1]), max(box[3], value_cell['box'][3])
        if bottom < stop or any(other is not label and min(top, other['box'][3]) >
                                 max(bottom, other['box'][1]) for other in labels):
            continue
        fragments = [label, value_cell]
        result.append((' '.join(line['text'] for line in fragments), fragments, match, flags, context))
    return result


def _pd_slab_table_rows(page: dict[str, Any], source: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]], re.Match[str], list[str], list[dict[str, Any]]]]:
    """One explicit two-floor slab row; companion component rows stay unparsed."""
    if _page_stage(source, page) != 'PD':
        return []
    lines = _page_lines(page)
    headers = [line for line in lines if _PD_SLAB_TABLE_HEADER.fullmatch(_clean(line['text']))]
    scopes = [line for line in lines if _PD_SLAB_TABLE_SCOPE.fullmatch(_clean(line['text']))]
    if (len(headers) != 1 or len(scopes) != 1 or not headers[0]['exactLineBox']
            or not scopes[0]['exactLineBox'] or scopes[0]['box'][1] <= headers[0]['box'][3]):
        return []
    header, scope = headers[0], scopes[0]
    below = [line for line in lines if line['box'][3] <= header['box'][1]]
    targets = [(line, match) for line in below
               if (match := _PD_SLAB_TABLE_TARGET.fullmatch(_clean(line['text']))) is not None]
    if len(targets) != 1:
        return []
    label, label_match = targets[0]
    if (not label['exactLineBox']
            or int(label_match.group('floor_a')) == int(label_match.group('floor_b'))):
        return []
    box = label['box']; height = max(1, box[3] - box[1]); center = (box[1] + box[3]) / 2
    if header['box'][1] - box[3] > height * 20:
        return []
    aligned = [line for line in lines if line is not label
               and abs((line['box'][1] + line['box'][3]) / 2 - center) <= height / 4]
    if len(aligned) != 1:
        return []
    value_cell = aligned[0]
    if (not value_cell['exactLineBox'] or value_cell['box'][3] > header['box'][1]
            or value_cell['box'][0] < box[2] or value_cell['box'][0] - box[2] > height * 32):
        return []
    match = _PD_SLAB_TABLE_VALUE.fullmatch(_clean(value_cell['text']))
    if match is None:
        return []
    stop = max([0, *[line['box'][3] for line in below
                    if not _PD_SLAB_TABLE_ANY_LABEL.fullmatch(_clean(line['text']))
                    and not _PD_SLAB_TABLE_STRUCTURE_VALUE.fullmatch(_clean(line['text']))]])
    bottom, top = min(box[1], value_cell['box'][1]), max(box[3], value_cell['box'][3])
    if (bottom < stop or any(other is not label
            and _PD_SLAB_TABLE_ANY_LABEL.fullmatch(_clean(other['text']))
            and min(top, other['box'][3]) > max(bottom, other['box'][1]) for other in below)):
        return []
    context = [{'pageNumber': page['pageNumber'], 'blockId': line['blockId'], 'rawText': line['text'],
                'bbox': line['bbox'], 'role': role}
               for line, role in [(header, 'ATTRIBUTE_HEADER'), (scope, 'TABLE_SCOPE')]]
    fragments = [label, value_cell]
    return [(' '.join(line['text'] for line in fragments), fragments, match,
             ['TABLE_CONTEXT_UNVERIFIED'], context)]


def _pd_sidewalk_tile_table_rows(page: dict[str, Any], source: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]], re.Match[str], list[str], list[dict[str, Any]]]]:
    """One explicit ground-tile area column; roof/vehicle/lawn rows stay separate.

    Complete same-block strings and exact line geometry define every selected
    group. The next same-column schedule is a mandatory lower delimiter for this
    bounded grammar. Caption, scope and column header remain visible unverified
    context; none establishes an element, approval, or complete scope.
    """
    if _page_stage(source, page) != 'PD':
        return []
    lines = _page_lines(page)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for line in lines:
        grouped.setdefault(line['blockId'].split(':')[0], []).append(line)
    groups = list(grouped.values())

    def words(group):
        return [_clean(line['text']).casefold() for line in group]

    def bounds(group):
        return [min(line['box'][0] for line in group), min(line['box'][1] for line in group),
                max(line['box'][2] for line in group), max(line['box'][3] for line in group)]

    def overlap(a, b):
        return min(a[2], b[2]) > max(a[0], b[0])

    def ordered(group):
        if not group or any(not line['exactLineBox'] for line in group):
            return False
        for first, second in zip(group, group[1:]):
            a, b = first['box'], second['box']
            height = max(a[3] - a[1], b[3] - b[1])
            gap = (a[1] + a[3] - b[1] - b[3]) / 2
            if not overlap(a, b) or not height / 2 <= gap <= height * 2:
                return False
        return True

    captions = [group for group in groups if words(group) == _PD_SIDEWALK_CAPTION]
    headers = [group for group in groups if words(group) == _PD_SIDEWALK_HEADER]
    scopes = [group for group in groups if words(group) == ['(в гр. гпзу)']]
    targets = [group for group in groups if words(group) == _PD_SIDEWALK_LABEL]
    if any(len(matches) != 1 for matches in [captions, headers, scopes, targets]):
        return []
    caption, header, scope, label = captions[0], headers[0], scopes[0], targets[0]
    if not all(ordered(group) for group in [caption, header, scope, label]) or not ordered([caption[-1], scope[0]]):
        return []
    cb, hb, sb, lb = map(bounds, [caption, header, scope, label])
    caption_height = max(line['box'][3] - line['box'][1] for line in caption)
    header_height = max(line['box'][3] - line['box'][1] for line in header)
    height = max(line['box'][3] - line['box'][1] for line in label)
    if (sb[0] < cb[0] or sb[2] > cb[2] or hb[3] >= sb[1] or sb[1] - hb[3] > 8 * header_height
            or hb[0] < (cb[0] + cb[2]) / 2 or hb[2] > cb[2] + 2 * caption_height
            or lb[0] < cb[0] or lb[2] >= hb[0] or lb[3] >= hb[1] or hb[1] - lb[3] > 32 * height):
        return []
    band = [cb[0], 0, hb[2], 0]
    delimiters = [group for group in groups if group is not caption and len(group) >= 2
                  and words(group)[:2] == _PD_SIDEWALK_CAPTION and ordered(group[:2])
                  and overlap(bounds(group[:2]), band) and bounds(group[:2])[3] < cb[1]]
    if not delimiters:
        return []
    stop = max(bounds(group[:2])[3] for group in delimiters)
    if lb[1] < stop:
        return []
    # Every item in this explicit area column must itself be one exact area cell.
    # A second heading, coarse fragment or overlapping value never becomes a choice.
    column = [line for line in lines if overlap(line['box'], hb)
              and min(line['box'][3], hb[1]) > max(line['box'][1], stop)]
    if (any(not line['exactLineBox'] or line['box'][1] < stop or line['box'][3] > hb[1]
            or not _PD_SIDEWALK_TABLE_VALUE.fullmatch(_clean(line['text'])) for line in column)
            or any(min(a['box'][3], b['box'][3]) > max(a['box'][1], b['box'][1])
                   for i, a in enumerate(column) for b in column[i + 1:])):
        return []
    types = [line for line in lines if _clean(line['text']).casefold() == '- тип 3'
             and line['exactLineBox'] and line['box'][0] >= lb[2] and line['box'][2] <= hb[0]
             and line['box'][1] >= lb[1] and line['box'][3] <= lb[3]]
    values = [line for line in column if line['box'][0] >= hb[0] and line['box'][2] <= hb[2]
              and line['box'][1] >= lb[1] and line['box'][3] <= lb[3]]
    if len(types) != 1 or len(values) != 1:
        return []
    value, type_line = values[0], types[0]
    fragments = [*label, type_line, value]
    selected = {line['blockId'] for line in fragments}
    row_band = [lb[0], 0, hb[2] + 2 * height, 0]
    if any(line['blockId'] not in selected and overlap(line['box'], row_band)
           and min(line['box'][3], lb[3]) > max(line['box'][1], lb[1]) for line in lines):
        return []
    context = [{'pageNumber': page['pageNumber'], 'blockId': line['blockId'], 'rawText': line['text'],
                'bbox': line['bbox'], 'role': role}
               for group, role in [(caption, 'TABLE_SCOPE'), (scope, 'TABLE_SCOPE'), (header, 'ATTRIBUTE_HEADER')]
               for line in group]
    match = _PD_SIDEWALK_TABLE_VALUE.fullmatch(_clean(value['text']))
    return [(' '.join(line['text'] for line in fragments), fragments, match,
             ['TABLE_CONTEXT_UNVERIFIED'], context)]


def _normalized_value(match: re.Match[str], rule: dict[str, Any]) -> tuple[str, str] | None:
    value = match.group('value')
    if rule['valueKind'] in {'CATEGORY', 'CONCRETE_CLASS'}:
        return value, rule['canonicalUnit']
    raw_unit = re.sub(r'\s+([²³])', r'\1', _clean(match.group('unit')))
    number = value.replace('\u202f', ' ').replace('\u00a0', ' ')
    comparison_unit = 'count' if rule['canonicalUnit'] == 'count' and raw_unit in {'чел.', 'чел'} else raw_unit
    normalized = _canonical_numeric({'rawValue': number, 'rawUnit': comparison_unit,
                                      'attribute': rule['attribute']}, rule['canonicalUnit'])
    if normalized is None or (rule['valueKind'] == 'INTEGER' and normalized != normalized.to_integral_value()):
        return None
    return _decimal_text(normalized), raw_unit


def _stamps(lines: list[dict[str, Any]], page_number: int) -> list[dict[str, Any]]:
    expressions = [('documentCode', re.compile(r'(?i)^(?:Шифр|Обозначение|Код документа)\s*[:=]?\s*(\S.{2,79})$')),
                   ('revision', re.compile(r'(?i)^(?:Изм\.?|Ревизия|Редакция)\s*[:=]?\s*([A-ZА-Я0-9.-]{1,16})$')),
                   ('date', re.compile(r'^(?:Дата\s*[:=]?\s*)?([0-3]\d\.[01]\d\.(?:19|20)\d{2})$')),
                   ('stage', re.compile(r'(?i)^Стадия\s*[:=]?\s*(ПД|РД|ИД|П|Р)$')),
                   ('floor', re.compile(r'(?i)^Этаж\s*[:=]?\s*(-?\d{1,3})$')),
                   ('section', re.compile(r'(?i)^Раздел\s*[:=]?\s*(ПЗ|СПЗУ|АР|КР|КЖ|КМ|ОВ|ВК|ЭОМ|ППМ|ЗУ|ОДИ)$'))]
    result = []
    for line in lines:
        for field, pattern in expressions:
            match = pattern.fullmatch(_clean(line['text']))
            if match:
                result.append({'field': field, 'value': match.group(1), 'pageNumber': page_number,
                               'blockId': line['blockId'], 'bbox': line['bbox'], 'rawText': line['text']})
    return result


def _flags(src: dict[str, Any], stage: str, quality: str) -> list[str]:
    flags = []
    if src['revisionStatus'] != 'CURRENT':
        flags.append('SOURCE_REVISION_' + src['revisionStatus'])
    if src['approvalStatus'] != 'APPROVED':
        flags.append('SOURCE_APPROVAL_' + src['approvalStatus'])
    if stage == 'UNRESOLVED':
        flags.append('SOURCE_STAGE_UNRESOLVED')
    if quality != 'TEXT_LAYER_CANDIDATE':
        flags.append('PAGE_TEXT_REQUIRES_OCR')
    return flags


def _project_zero_authority_valid(pd: dict[str, Any], rd: dict[str, Any],
                                  expected: dict[str, Any], actual: dict[str, Any], rule: dict[str, Any],
                                  object_id: str, manifest: str, code: str, entity: str) -> bool:
    # A whole-file proof/reference cannot classify a geodetic authority. Both
    # pointers originate in authenticated exact-fact scopes and matching selectors.
    if '_factBindings' not in pd or '_factBindings' not in rd:
        return False
    key = 'PROJECT_ZERO_GEODETIC_AUTHORITY'
    a = _proof(pd, key, object_id, manifest, fact=expected, rule=rule, parameter_code=code)
    b = _proof(rd, key, object_id, manifest, fact=actual, rule=rule, parameter_code=code)
    if a is None or b is None or a['entityKey'] != entity or b['entityKey'] != entity:
        return False
    authority, reference = a.get('projectZeroAuthority'), b.get('projectZeroAuthority')
    if not isinstance(authority, dict) or not isinstance(reference, dict):
        return False
    review_hash = a.get('serverReviewContentHash')
    return (expected['stage'] == 'PD' and actual['stage'] == 'RD'
            and authority.get('kind') == 'APPROVED_PD_GEODETIC_BASIS'
            and authority.get('sourceFileId') == pd['sourceFileId']
            and authority.get('sourceSha256') == pd['sha256']
            and authority.get('pageNumber') == expected['pageNumber']
            and authority.get('target') == a.get('bindingTarget')
            and 'reviewContentHash' not in authority
            and isinstance(review_hash, str) and _SHA.fullmatch(review_hash) is not None
            and reference == {**authority, 'reviewContentHash': review_hash})


def _context(rule: dict[str, Any], pd: dict[str, Any], rd: dict[str, Any], entity: str | None,
             object_id: str, manifest: str, parameter_code: str, expected_value: str,
             expected_stage: str, actual_stage: str,
             expected_fact: dict[str, Any], actual_fact: dict[str, Any]) -> str | None:
    if entity is None:
        return 'ENTITY_SCOPE_UNVERIFIED'
    expected_sections = rule['expectedSections'] if expected_stage == 'PD' else rule['actualSections']
    for src, sections, fact, stage in [(pd, expected_sections, expected_fact, expected_stage),
                                       (rd, rule['actualSections'], actual_fact, actual_stage)]:
        scope = _proof(src, 'ENTITY_SCOPE', object_id, manifest, fact=fact, rule=rule, parameter_code=parameter_code)
        if scope is None or scope['entityKey'] != entity:
            return 'ENTITY_SCOPE_MISMATCH'
        if src['revisionStatus'] != 'CURRENT':
            return 'SOURCE_REVISION_UNRESOLVED' if src['revisionStatus'] == 'UNKNOWN' else 'SOURCE_REVISION_SUPERSEDED'
        if src['approvalStatus'] != 'APPROVED':
            return 'SOURCE_APPROVAL_UNRESOLVED' if src['approvalStatus'] == 'UNKNOWN' else 'SOURCE_UNAPPROVED'
        if stage == 'ID':
            # ID evidence has distinct document marks; only explicit section proof can qualify it.
            section = _proof(src, 'DRAWING_SECTION_VERIFIED', object_id, manifest, fact=fact, rule=rule, parameter_code=parameter_code)
            if section is None or section.get('drawingSection') not in sections:
                return 'SOURCE_SECTION_UNVERIFIED'
        elif src.get('sectionCode') not in sections:
            section = _proof(src, 'DRAWING_SECTION_VERIFIED', object_id, manifest, fact=fact, rule=rule, parameter_code=parameter_code)
            if section is None or section.get('drawingSection') not in sections:
                return 'SOURCE_SECTION_UNVERIFIED'
    if not pd.get('linkGroupId') or pd.get('linkGroupId') != rd.get('linkGroupId'):
        return 'LINK_GROUP_MISMATCH'
    if rule['ruleId'] == _REBAR_RULE_ID and any('_factBindings' not in src for src in (pd, rd)):
        return 'CONTEXT_UNVERIFIED:REINFORCEMENT_APPLICATION_SCOPE'
    concrete_prose = (rule['ruleId'] == 'matrix-kr-055-concrete_class'
                      and any(is_concrete_prose_fact(fact) for fact in (expected_fact, actual_fact)))
    if concrete_prose and ((expected_stage, actual_stage) != ('PD', 'RD')
                           or any('_factBindings' not in src for src in (pd, rd))):
        return 'CONTEXT_UNVERIFIED:ELEMENT_IDENTITY'
    for key in rule['requiredContext']:
        if rule['ruleId'] == _PROJECT_ZERO_RULE_ID and key == 'PROJECT_ZERO_GEODETIC_AUTHORITY':
            if not _project_zero_authority_valid(pd, rd, expected_fact, actual_fact, rule,
                                                object_id, manifest, parameter_code, entity):
                return 'CONTEXT_UNVERIFIED:' + key
            continue
        for src, fact in [(pd, expected_fact), (rd, actual_fact)]:
            proof = _proof(src, key, object_id, manifest, fact=fact, rule=rule, parameter_code=parameter_code)
            if proof is None or proof['entityKey'] != entity:
                return 'CONTEXT_UNVERIFIED:' + key
            if concrete_prose and key == 'ELEMENT_IDENTITY':
                expected_proof = _proof(pd, key, object_id, manifest, fact=expected_fact, rule=rule, parameter_code=parameter_code)
                if (proof.get('componentRole') != 'MONOLITHIC_LOAD_BEARING_STAIR'
                        or proof.get('operatingModeKey') != 'CAST_IN_PLACE_LOAD_BEARING_STAIR'
                        or proof.get('measurementBasisKey') != 'CONCRETE_COMPRESSIVE_STRENGTH_CLASS'
                        or expected_proof is None
                        or any(type(proof.get(field)) is not str or not proof[field].strip()
                               or proof[field] != expected_proof.get(field)
                               for field in ('componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey'))):
                    return 'CONTEXT_UNVERIFIED:' + key
            if concrete_prose and key == 'MATERIAL_CLASS_BASIS' and (
                    proof.get('attribute') != 'CONCRETE_CLASS' or proof.get('canonicalUnit') != 'B_CLASS'
                    or proof.get('measurementBasisKey') != 'CONCRETE_COMPRESSIVE_STRENGTH_CLASS'):
                return 'CONTEXT_UNVERIFIED:' + key
            policy = rule.get('subruleContext')
            if policy is not None and key == 'ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']:
                expected_proof = _proof(pd, key, object_id, manifest, fact=expected_fact, rule=rule, parameter_code=parameter_code)
                if (proof.get('parameterCode') != parameter_code
                        or proof.get('attribute') != rule['attribute']
                        or proof.get('canonicalUnit') != rule['canonicalUnit']
                        or proof.get('componentRole') != policy['componentRole']
                        or expected_proof is None
                        or any(not isinstance(proof.get(field), str) or not proof[field].strip()
                               or proof[field] != expected_proof.get(field) for field in policy['identityFields'])):
                    return 'CONTEXT_UNVERIFIED:' + key
                if policy['componentRole'] in _EGRESS_ROLE_BASIS and (
                        proof['operatingModeKey'] != 'EVACUATION'
                        or proof['measurementBasisKey'] != _EGRESS_ROLE_BASIS[policy['componentRole']]):
                    return 'CONTEXT_UNVERIFIED:' + key
                if policy['componentRole'] in _STAIR_ROLE_BASIS and (
                        proof['operatingModeKey'] != 'EVACUATION'
                        or proof['measurementBasisKey'] != _STAIR_ROLE_BASIS[policy['componentRole']]):
                    return 'CONTEXT_UNVERIFIED:' + key
                if policy['componentRole'] == 'TERRITORY_FENCE_SEGMENT' and (
                        proof['operatingModeKey'] != 'TERRITORY_BOUNDARY'
                        or proof['measurementBasisKey'] != 'FINISHED_GROUND_TO_FENCE_TOP'):
                    return 'CONTEXT_UNVERIFIED:' + key
                if (policy['componentRole'] == 'PROJECT_ZERO_DATUM'
                        and proof['measurementBasisKey'] != _PROJECT_ZERO_BASIS):
                    return 'CONTEXT_UNVERIFIED:' + key
                if policy['componentRole'] == 'WORKING_REINFORCEMENT_POSITION' and (
                        proof['operatingModeKey'] != _REBAR_MODE
                        or proof['measurementBasisKey'] != _REBAR_BASIS):
                    return 'CONTEXT_UNVERIFIED:' + key
            if key == 'NORM_APPLICABILITY_VERIFIED' and (proof.get('applicable') is not True
                    or proof.get('parameterCode') != parameter_code or proof.get('attribute') != rule['attribute']
                    or proof.get('threshold') != rule['threshold']['value']
                    or proof.get('canonicalUnit') != rule['canonicalUnit']):
                return 'CONTEXT_UNVERIFIED:' + key
            if key == 'TECHNICAL_CONDITIONS_LIMIT' and (proof.get('limitValue') != expected_value
                    or proof.get('canonicalUnit') != rule['canonicalUnit']):
                return 'CONTEXT_UNVERIFIED:' + key
            if key == 'APPROVED_CHANGE_STATUS' and proof.get('approvedChangePresent') is not False:
                return 'CONTEXT_UNVERIFIED:' + key
            if key == 'THERMAL_RESISTANCE_REDUCTION_VERIFIED' and proof.get('reductionConfirmed') is not True:
                return 'CONTEXT_UNVERIFIED:' + key
    return None


def _class_rank(value: str, unit: str) -> tuple[str, Decimal] | None:
    if unit == 'B_CLASS':
        match = re.fullmatch(r'[BВ](' + _NUMBER + ')', value)
        return ('B', Decimal(match.group(1).replace(',', '.'))) if match else None
    if unit == 'fire_rating':
        match = re.fullmatch(r'(EI|E|I)-(\d+)', value)
        return (match.group(1), Decimal(match.group(2))) if match else None
    if unit == 'reliability_category':
        rank = {'1': 3, 'I': 3, '2': 2, 'II': 2, '3': 1, 'III': 1}.get(value)
    elif unit == 'energy_class':
        aliases = {'А': 'A', 'В': 'B', 'С': 'C', 'Д': 'D', 'Е': 'E'}
        token = aliases.get(value, value)
        rank = {v: i for i, v in enumerate(['G', 'F', 'E', 'D', 'C', 'B', 'A'])}.get(token)
    elif unit == 'fire_resistance_degree':
        rank = {'I': 5, 'II': 4, 'III': 3, 'IV': 2, 'V': 1}.get(value)
    elif unit == 'structural_fire_hazard_class':
        match = re.fullmatch(r'[CС]([0-3])', value)
        rank = 3 - int(match.group(1)) if match else None
    elif unit == 'finish_fire_class':
        match = re.fullmatch(r'(?:КМ|KM)([0-5])', value)
        rank = 5 - int(match.group(1)) if match else None
    else:
        rank = None
    return (unit, Decimal(rank)) if rank is not None else None


def _compare(rule: dict[str, Any], expected: str, actual: str) -> tuple[bool | None, str | None, str | None]:
    family = rule['family']
    if rule['canonicalUnit'] == 'rebar_catalog_example':
        # Only the directed example explicitly supplied in KR-057. These are
        # categories, not numeric strengths or a general plasticity scale.
        if expected == actual and expected in ('А500С', 'А400'):
            return False, None, None
        if expected == 'А500С' and actual == 'А400':
            return True, None, None
        return None, None, 'UNSUPPORTED_CATEGORY_TRANSITION'
    if family == 'CLASS_DECREASE':
        a, b = _class_rank(expected, rule['canonicalUnit']), _class_rank(actual, rule['canonicalUnit'])
        if a is None or b is None or a[0] != b[0]:
            return None, None, 'CLASS_DOMAIN_NOT_COMPARABLE'
        return b[1] < a[1], _decimal_text(b[1] - a[1]), None
    a, b = Decimal(expected), Decimal(actual)
    with localcontext() as ctx:
        ctx.prec = max(80, len(a.as_tuple().digits) + len(b.as_tuple().digits) + 20)
        delta = b - a
        if family in {'RELATIVE_DELTA', 'RELATIVE_INCREASE'}:
            if a == 0:
                return None, None, 'ZERO_BASELINE'
            relative = (abs(delta) if family == 'RELATIVE_DELTA' else delta) / abs(a) * 100
            threshold = Decimal(rule['threshold']['value'])
            return relative > threshold, _decimal_text(relative), None
        if family in {'LOWER_BOUND', 'UPPER_BOUND'}:
            bound = Decimal(rule['threshold']['value'])
            if (family == 'LOWER_BOUND' and a < bound) or (family == 'UPPER_BOUND' and a > bound):
                return None, None, 'PROJECT_BASELINE_OUTSIDE_BOUND'
            return (b < bound if family == 'LOWER_BOUND' else b > bound), _decimal_text(b - bound), None
        return ({'DIFFERENT': delta != 0, 'INCREASE': delta > 0, 'DECREASE': delta < 0}[family],
                _decimal_text(delta), None)


def _evaluate(entry: dict[str, Any], rule: dict[str, Any], observations: list[dict[str, Any]],
              sources: dict[str, dict[str, Any]], object_id: str, manifest: str, expected_stage: str = 'PD', actual_stage: str = 'RD') -> list[dict[str, Any]]:
    facts = [o for o in observations if entry['parameterCode'] in o['parameterCodes']
             and o['attribute'] == rule['attribute'] and o['stage'] in {expected_stage, actual_stage}]
    entities = sorted({o['entityKey'] for o in facts if o['entityKey'] is not None})
    if not entities or any(o['entityKey'] is None for o in facts):
        entities.append(None)
    result = []
    for entity in entities:
        row = {'ruleId': rule['ruleId'], 'ruleVersion': rule['version'], 'parameterCode': entry['parameterCode'],
               'entityKey': entity, 'comparisonVariant': expected_stage + '_' + actual_stage, 'executionStatus': 'SUCCEEDED',
               'machineStatus': 'MISSING_EVIDENCE', 'reasonCode': 'REQUIRED_FACT_MISSING',
               'expectedObservationId': None, 'actualObservationId': None,
               'expectedValue': None, 'actualValue': None, 'delta': None, 'qualified': False}
        # An entity-specific result cannot silently borrow an unlinked fact from another entity.
        selected = [o for o in facts if o['entityKey'] == entity]
        a, b = [o for o in selected if o['stage'] == expected_stage], [o for o in selected if o['stage'] == actual_stage]
        if not a or not b:
            if facts and {o['stage'] for o in facts} == {expected_stage, actual_stage}:
                row.update(machineStatus='NOT_COMPARABLE', reasonCode='ENTITY_SCOPE_MISMATCH')
            result.append(row); continue
        if len(a) != 1 or len(b) != 1:
            row.update(machineStatus='CLARIFICATION_REQUIRED', reasonCode='AMBIGUOUS_FACTS')
            result.append(row); continue
        expected, actual = a[0], b[0]
        row.update(expectedObservationId=expected['id'], actualObservationId=actual['id'],
                   expectedValue=expected['value'], actualValue=actual['value'])
        pd, rd = sources[expected['sourceFileId']], sources[actual['sourceFileId']]
        reason = _context(rule, pd, rd, entity, object_id, manifest, entry['parameterCode'], expected['value'],
                          expected_stage, actual_stage, expected, actual)
        if reason is None and any(sources[o['sourceFileId']]['_factBindings'].effective_flags(o, rule, entry['parameterCode'])
                                  if '_factBindings' in sources[o['sourceFileId']] else o['sourceFlags']
                                  for o in [expected, actual]):
            reason = 'TEXT_OR_STAGE_QUALITY_UNVERIFIED'
        if reason:
            row.update(machineStatus='CLARIFICATION_REQUIRED', reasonCode=reason)
            result.append(row); continue
        triggered, delta, reason = _compare(rule, expected['value'], actual['value'])
        row['delta'] = delta
        if reason:
            row.update(machineStatus='NOT_COMPARABLE', reasonCode=reason)
            result.append(row); continue
        if not triggered and any((p := _proof(s, 'RULE_SCOPE_COMPLETE:' + rule['ruleId'], object_id, manifest)) is None
                                 or p['entityKey'] != entity for s in [pd, rd]):
            row.update(machineStatus='CLARIFICATION_REQUIRED', reasonCode='NEGATIVE_SCOPE_UNVERIFIED')
            result.append(row); continue
        row.update(machineStatus='CANDIDATE' if triggered else 'NEGATIVE_VERIFIED',
                   reasonCode='CATALOG_TRIGGER_MATCHED' if triggered else 'SCOPED_TRIGGER_NOT_MATCHED', qualified=True)
        result.append(row)
    return result


def build_matrix_execution(*, object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
                           text_artifacts: list[dict[str, Any]], registry: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build immutable observations, scoped decisions, and all-132 honest coverage.

    Optional ``scopeProofs`` are trusted reviewed input, not extracted metadata.
    Each proof binds status/reference/sourceFileId/sourceSha256/objectId/
    inputManifestHash/entityKey. Norm applicability additionally binds attribute,
    threshold, canonicalUnit, parameterCode and applicable=true.
    """
    if not isinstance(object_id, str) or not object_id.strip() or not isinstance(input_manifest_hash, str) or not _SHA.fullmatch(input_manifest_hash):
        raise ValueError('matrix object or input manifest invalid')
    registry = copy.deepcopy(registry) if registry is not None else load_matrix_registry()
    _validate_registry(registry)
    source_index = _sources(object_id, sources)
    if not isinstance(text_artifacts, list):
        raise ValueError('matrix text artifacts must be array')
    artifact_index = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or artifact.get('sourceFileId') not in source_index or artifact['sourceFileId'] in artifact_index:
            raise ValueError('matrix unknown or duplicate text artifact')
        src = source_index[artifact['sourceFileId']]
        _validate_artifact(artifact, src)
        if any(int(n) > artifact['pageCount'] for n in src['pageStages']):
            raise ValueError('matrix source page stage exceeds artifact')
        artifact_index[artifact['sourceFileId']] = artifact
    atomic = [(entry, rule) for entry in registry['entries'] for rule in entry['atomicRules'] if rule['enabled']]
    for source_id, src in source_index.items():
        if isinstance(src.get('scopeProofs'), dict) and 'FACT_BINDINGS' in src['scopeProofs']:
            src['_factBindings'] = _FactBindings(src, artifact_index.get(source_id), atomic, object_id, input_manifest_hash)
    observations: dict[str, dict[str, Any]] = {}
    metadata = []
    for source_id, src in sorted(source_index.items()):
        artifact = artifact_index.get(source_id)
        meta = {'sourceFileId': source_id, 'sourceSha256': src['sha256'],
                'stage': src['stages'][0] if len(src['stages']) == 1 else 'UNRESOLVED',
                'sectionCode': src.get('sectionCode'), 'revisionStatus': src['revisionStatus'],
                'approvalStatus': src['approvalStatus'], 'linkGroupId': src.get('linkGroupId'),
                'pageCount': artifact['pageCount'] if artifact else 0, 'stampCandidates': [],
                'reasonCodes': [] if artifact else ['TEXT_ARTIFACT_MISSING']}
        if artifact is None:
            metadata.append(meta); continue
        proof = _proof(src, 'ENTITY_SCOPE', object_id, input_manifest_hash)
        entity = proof['entityKey'] if proof else None
        pages = {page['pageNumber']: page for page in artifact['pages']}
        for page in sorted(pages.values(), key=lambda p: p['pageNumber']):
            stage = _page_stage(src, page)
            lines = _page_lines(page)
            table_rows = _pd_concrete_table_rows(page, [pages[n] for n in [page['pageNumber'] - 1, page['pageNumber']]
                                                       if n in pages], src)
            slab_rows = _pd_slab_table_rows(page, src)
            sidewalk_rows = _pd_sidewalk_tile_table_rows(page, src)
            stair_rows = _stair_dimensions_prose_rows(page, stage=stage)
            fence_rows = _territory_fence_prose_rows(page, stage=stage)
            project_zero_rows = _project_zero_rows(page, stage)
            rebar_rows = _rebar_rows(page, stage)
            concrete_prose_rows = _concrete_prose_rows(page, src, pages)
            meta['stampCandidates'].extend(_stamps(lines, page['pageNumber']))
            for entry, rule in atomic:
                rows = [(*row, []) for row in _rows(lines, rule, stage=stage)]
                if rule['attribute'] == 'CONCRETE_CLASS' and rule['valueKind'] == 'CONCRETE_CLASS':
                    rows.extend(table_rows)
                if rule['ruleId'] == 'matrix-kr-055-concrete_class':
                    rows.extend(concrete_prose_rows)
                if rule['attribute'] == 'SLAB_THICKNESS' and rule['valueKind'] == 'DECIMAL':
                    rows.extend(slab_rows)
                if entry['parameterCode'] == 'SPZU-026' and rule['ruleId'] == _SIDEWALK_RULE_ID:
                    rows.extend(sidewalk_rows)
                if entry['parameterCode'] == 'AR-048':
                    rows.extend(stair_rows.get(rule['attribute'], []))
                if rule['ruleId'] == _FENCE_RULE_ID:
                    rows.extend(fence_rows)
                if rule['ruleId'] == _PROJECT_ZERO_RULE_ID:
                    rows.extend(project_zero_rows)
                if rule['ruleId'] == _REBAR_RULE_ID:
                    rows.extend(rebar_rows)
                for raw_text, fragments, match, row_flags, context in rows:
                    # Signed decimal and categorical glyph aliases are admitted
                    # only by their separate, frozen source grammars.
                    # Generic numeric normalization and all legacy fact IDs stay unchanged.
                    normalized = ((match['value'], match['rawUnit']) if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID}
                                  else _normalized_value(match, rule))
                    if normalized is None:
                        continue
                    value, raw_unit = normalized
                    identity_payload = {'sourceFileId': source_id, 'sourceSha256': src['sha256'], 'stage': stage,
                                        'pageNumber': page['pageNumber'], 'blockIds': [f['blockId'] for f in fragments],
                                        'attribute': rule['attribute'], 'value': value, 'unit': rule['canonicalUnit']}
                    if context:
                        identity_payload['contextFragments'] = context
                    identity = _hash(identity_payload)
                    if identity in observations:
                        observations[identity]['parameterCodes'] = sorted(set(observations[identity]['parameterCodes'] + [entry['parameterCode']]))
                        continue
                    boxes = [f['box'] for f in fragments]
                    union = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                             max(b[2] for b in boxes), max(b[3] for b in boxes)]
                    observations[identity] = {'id': identity, 'sourceFileId': source_id, 'sourceSha256': src['sha256'],
                        'stage': stage, 'pageNumber': page['pageNumber'], 'blockId': fragments[0]['blockId'],
                        'bbox': _bbox(union, page), 'rawText': raw_text, 'rawValue': (match['rawValue'] if rule['ruleId'] in {_PROJECT_ZERO_RULE_ID, _REBAR_RULE_ID} else match.group('value')),
                        'rawUnit': raw_unit, 'attribute': rule['attribute'], 'value': value,
                        'unit': rule['canonicalUnit'], 'entityKey': entity, 'method': 'TEXT_LAYER',
                        'extractorVersion': EXTRACTOR_VERSION, 'parameterCodes': [entry['parameterCode']],
                        'sourceFlags': sorted(set(_flags(src, stage, page['quality']['disposition']) + row_flags)),
                        'evidenceFragments': [{'blockId': f['blockId'], 'rawText': f['text'], 'bbox': f['bbox']} for f in fragments]}
                    if context:
                        observations[identity]['contextFragments'] = context
        meta['stampCandidates'].sort(key=lambda s: (s['pageNumber'], s['blockId'], s['field']))
        metadata.append(meta)
    observation_rows = sorted(observations.values(), key=lambda o: (o['sourceFileId'], o['pageNumber'], o['blockId'], o['attribute'], o['id']))
    for fact in observation_rows:
        src = source_index[fact['sourceFileId']]
        if '_factBindings' in src:
            fact['entityKey'] = src['_factBindings'].entity(fact)
    results = []
    for entry, rule in atomic:
        for expected_stage, actual_stage in rule['allowedStagePairs']:
            if actual_stage == 'ID' and not any('ID' in src['stages'] for src in source_index.values()):
                continue
            results.extend(_evaluate(entry, rule, observation_rows, source_index, object_id, input_manifest_hash,
                                     expected_stage, actual_stage))
    coverage = []
    for entry in registry['entries']:
        rules = entry['atomicRules']; enabled = [r for r in rules if r['enabled']]
        rows = [r for r in results if r['parameterCode'] == entry['parameterCode']]
        failures = sum(r['executionStatus'] == 'FAILED' for r in rows)
        comparisons = sum(r['qualified'] for r in rows)
        abstentions = sum(not r['qualified'] and r['executionStatus'] == 'SUCCEEDED' for r in rows)
        complete_sources = [s for s in source_index.values() if any(o['sourceFileId'] == s['sourceFileId'] and
                            entry['parameterCode'] in o['parameterCodes'] for o in observation_rows)]
        complete = (entry.get('gap') is None and bool(rows) and comparisons == len(rows) and bool(complete_sources)
                    and all(_proof(s, 'PARAMETER_SCOPE_COMPLETE:' + entry['parameterCode'], object_id, input_manifest_hash)
                            is not None and _proof(s, 'PARAMETER_SCOPE_COMPLETE:' + entry['parameterCode'], object_id, input_manifest_hash)['entityKey'] ==
                            _proof(s, 'ENTITY_SCOPE', object_id, input_manifest_hash)['entityKey'] for s in complete_sources))
        status = ('UNSUPPORTED' if not rules else 'TECHNICAL_FAILURE' if failures and not comparisons and not abstentions
                  else 'EVALUATED' if complete and len(enabled) == len(rules) else 'PARTIAL')
        coverage.append({'parameterCode': entry['parameterCode'], 'implementedAtomicRules': len(rules),
                         'enabledAtomicRules': len(enabled), 'evaluatedAtomicRules': len({r['ruleId'] for r in rows}),
                         'successfulComparisons': comparisons, 'abstentions': abstentions, 'failures': failures,
                         'executionStatus': status, 'reason': entry['gap'] if entry.get('gap') else
                         ('ALL_CONFIGURED_RULE_SCOPES_VERIFIED' if complete else 'SCOPED_EXECUTION_WITH_GAPS')})
    return {'schemaVersion': 'matrix-execution-v1', 'objectId': object_id, 'inputManifestHash': input_manifest_hash,
            'registryHash': canonical_registry_hash(registry), 'observations': observation_rows,
            'metadata': metadata, 'results': results, 'coverage': coverage}
