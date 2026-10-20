"""Mechanically reconstruct one source-authored cold-water inlet-node list.

This deliberately narrow grammar consumes the complete selected page. It never
asserts physical absence, document completeness, review, identity or authority.
Only generic native/canonical/full-text/page readers are shared with other work.
"""
from __future__ import annotations
import copy
import hashlib
import re
from typing import Any

from .source_declarations import canonical_source_declaration_json, _valid_artifact
from .table_row_binding import _portable_error, _integer, _text, _key, _box, read_table_row_page

EXTRACTOR_VERSION = 'matrix-zu129-water-node-source-v1'
POLICY_VERSION = 'matrix-zu129-cold-water-inlet-literals-v1'
_RESULT = 'matrix-zu129-water-node-source-result-v1'
_HEADER = 'Состав общедомового вводного узла холодной воды'
_END = 'Конец состава общедомового вводного узла холодной воды'
_PREFIXES = ('Здание:', 'Вводной узел:', 'Система:', 'Назначение:')
_TOKEN = r'[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}'
_BUILDING = re.compile(r'Здание: (' + _TOKEN + r')\Z')
_NODE = re.compile(r'Вводной узел: (' + _TOKEN + r')\Z')
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z')
_FEATURES = {'Счётчик холодной воды': 'WATER_METER', 'Фильтр сетчатый': 'STRAINER',
             'Кран запорный': 'SHUTOFF_VALVE'}
_INPUT_KEYS = {'sourceFileId', 'sourceSha256', 'stage', 'pageStages', 'textArtifact', 'selection'}
_SELECTION_KEYS = {'pageNumber', 'regionBoxMilliPoints', 'headerFragments', 'scopeFragments', 'endFragments'}
_FRAGMENT_KEYS = {'pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'}


def water_node_inventory_content_hash(inventory: Any) -> str:
    """Portable full-body hash, native bounded validation before JSON callbacks.

    The hash is content identity only, never proof that an arbitrary body was
    reconstructed or authenticated. Consumers must independently reconstruct it.
    """
    if _portable_error(inventory):
        raise ValueError('water node inventory is not bounded portable JSON')
    body = {'hashDomain': 'matrix-zu129-water-node-source-id-v1', 'inventory': inventory}
    return hashlib.sha256(canonical_source_declaration_json(body).encode('utf-8')).hexdigest()


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion': _RESULT, 'status': 'ABSTAIN', 'reasonCode': reason}


def _inside(outer: list[int], inner: list[int]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and inner[2] <= outer[2] and inner[3] <= outer[3]


def _intersects(a: list[int], b: list[int]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _fragment(value: Any, width: int, height: int) -> bool:
    return (type(value) is dict and set(value) == _FRAGMENT_KEYS
            and _integer(value.get('pageNumber'), 1) and _integer(value.get('blockIndex'))
            and _integer(value.get('lineIndex')) and _text(value.get('rawText'), line=True)
            and 0 < len(value['rawText']) <= 8192 and bool(value['rawText'].strip())
            and _box(value.get('bboxMilliPoints'), width, height))


def reconstruct_zu129_water_node_source(value: Any) -> dict[str, Any]:
    """Strict full original envelope plus explicit closed source-line locators.

    Gate order is part of the public diagnostic contract. Supplied source tokens
    remain literal; unrelated pages are retained and hashed, never interpreted.
    """
    error = _portable_error(value)
    if error:
        return _abstain('INPUT_LIMIT' if error == 'LIMIT' else 'INVALID_INPUT')
    if (type(value) is not dict or set(value) != _INPUT_KEYS
            or not _key(value.get('sourceFileId'))
            or type(value.get('sourceSha256')) is not str or not _SHA.fullmatch(value['sourceSha256'])
            or type(value.get('stage')) is not str or type(value.get('pageStages')) is not dict):
        return _abstain('INVALID_INPUT')
    overrides = value['pageStages']
    if any(not _PAGE.fullmatch(k) or not _integer(int(k), 1) or type(stage) is not str
           or stage not in {'PD', 'RD', 'ID', 'UNRESOLVED'} for k, stage in overrides.items()):
        return _abstain('INVALID_INPUT')
    artifact = value['textArtifact']
    if not _valid_artifact(artifact):
        return _abstain('INVALID_TEXT_ARTIFACT')
    if artifact['pageCount'] > 512:
        return _abstain('INPUT_LIMIT')
    if artifact['sourceFileId'] != value['sourceFileId'] or artifact['inputSha256'] != value['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if any(int(k) > artifact['pageCount'] for k in overrides):
        return _abstain('INVALID_INPUT')
    stage = value['stage']
    if stage not in ('PD', 'RD') or any(code != stage for code in overrides.values()):
        return _abstain('STAGE_UNRESOLVED')
    selection = value['selection']
    if (type(selection) is not dict or set(selection) != _SELECTION_KEYS
            or not _integer(selection.get('pageNumber'), 1) or selection['pageNumber'] > artifact['pageCount']):
        return _abstain('INVALID_SELECTION')
    page = artifact['pages'][selection['pageNumber'] - 1]
    width, height = page['widthMilliPoints'], page['heightMilliPoints']
    if (not _box(selection.get('regionBoxMilliPoints'), width, height)
            or any(type(selection.get(k)) is not list or len(selection[k]) != n
                   for k, n in (('headerFragments', 1), ('scopeFragments', 4), ('endFragments', 1)))):
        return _abstain('INVALID_SELECTION')
    anchors = selection['headerFragments'] + selection['scopeFragments'] + selection['endFragments']
    region = selection['regionBoxMilliPoints']
    if (any(not _fragment(f, width, height) or not _inside(region, f['bboxMilliPoints']) for f in anchors)
            or len({(f['pageNumber'], f['blockIndex'], f['lineIndex']) for f in anchors}) != len(anchors)
            or region != [0, selection['endFragments'][0]['bboxMilliPoints'][1], width,
                          selection['headerFragments'][0]['bboxMilliPoints'][3]]):
        return _abstain('INVALID_SELECTION')
    read = read_table_row_page(page)
    if read['status'] != 'READY':
        reason = read['reasonCode']
        return _abstain({'PAGE_LIMIT': 'INPUT_LIMIT', 'INVALID_PAGE': 'INVALID_TEXT_ARTIFACT'}.get(reason, reason))
    full = [line for line in read['lines'] if line['rawText'].strip()]
    active = [line for line in full if _intersects(region, line['bboxMilliPoints'])]
    if len(active) > 128:
        return _abstain('REGION_LINE_LIMIT')
    if any(not _inside(region, line['bboxMilliPoints']) for line in active):
        return _abstain('REGION_BOUNDARY_CROSSED')
    active.sort(key=lambda line: (-line['bboxMilliPoints'][1], line['bboxMilliPoints'][0],
                                  line['blockIndex'], line['lineIndex']))
    # One-column literal list: any vertical overlap is ambiguous, even disjoint x.
    if any(not 0 <= prior['bboxMilliPoints'][1] - current['bboxMilliPoints'][3] <= 30000
           for prior, current in zip(active, active[1:])):
        return _abstain('AMBIGUOUS_LAYOUT')
    headers = [line for line in full if line['rawText'] == _HEADER]
    if (len(headers) != 1 or not active or active[0] != headers[0]
            or selection['headerFragments'] != headers):
        return _abstain('HEADER_UNVERIFIED')
    scopes = active[1:5]
    if (len(scopes) != 4 or any(sum(line['rawText'].startswith(prefix) for line in full) != 1 for prefix in _PREFIXES)
            or selection['scopeFragments'] != scopes):
        return _abstain('SCOPE_UNVERIFIED')
    building, node = _BUILDING.fullmatch(scopes[0]['rawText']), _NODE.fullmatch(scopes[1]['rawText'])
    if (not building or not node or scopes[2]['rawText'] != 'Система: ХВС'
            or scopes[3]['rawText'] != 'Назначение: общедомовой учёт'):
        return _abstain('SCOPE_UNVERIFIED')
    endings = [line for line in full if line['rawText'] == _END]
    if len(endings) != 1 or active[-1] != endings[0] or selection['endFragments'] != endings:
        return _abstain('END_UNVERIFIED')
    if len(full) != len(active):
        return _abstain('OUTSIDE_BODY_ROW')
    body = active[5:-1]
    if not body:
        return _abstain('EMPTY_INVENTORY_UNVERIFIED')
    if any(line['rawText'] not in _FEATURES for line in body):
        return _abstain('UNSUPPORTED_BODY_ROW')
    features = [_FEATURES[line['rawText']] for line in body]
    if len(features) != len(set(features)):
        return _abstain('DUPLICATE_FEATURE')
    inventory = {'schemaVersion': EXTRACTOR_VERSION, 'extractorVersion': EXTRACTOR_VERSION,
                 'policyVersion': POLICY_VERSION, 'sourceFileId': value['sourceFileId'],
                 'sourceSha256': value['sourceSha256'], 'textArtifactHash': hashlib.sha256(
                     canonical_source_declaration_json({'hashDomain': 'matrix-source-declaration-text-artifact-v1',
                                                        'textArtifact': artifact}).encode('utf-8')).hexdigest(),
                 'stage': stage, 'pageNumber': page['pageNumber'], 'widthMilliPoints': width,
                 'heightMilliPoints': height, 'regionBoxMilliPoints': list(region),
                 'headerFragments': headers, 'scopeFragments': scopes, 'endFragments': endings,
                 'buildingToken': building.group(1), 'nodeToken': node.group(1), 'service': 'COLD_WATER',
                 'accountingScope': 'COMMON_BUILDING_INLET',
                 'featureRows': [{'featureKey': feature, 'fragments': [line]} for feature, line in zip(features, body)]}
    return {'schemaVersion': _RESULT, 'status': 'RECONSTRUCTED', 'inventory': copy.deepcopy(inventory)}
