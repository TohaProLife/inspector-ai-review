"""Staged T40 pure reconstruction; no review authority or presence predicate.

The approved wire and authored oracles remain separate immutable inputs. This
module uses the frozen source-envelope validator and public canonical page reader.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
from typing import Any

from inspector_worker.source_declarations import _valid_artifact
from inspector_worker.table_row_binding import _portable_error, _key, read_table_row_page

EXTRACTOR_VERSION = 'matrix-ar053-inventory-source-v1'
POLICY_VERSION = 'matrix-ar053-inventory-literals-v1'
RESULT_SCHEMA_VERSION = 'matrix-inventory-source-result-v1'
INVENTORY_SCHEMA_VERSION = 'matrix-inventory-source-v1'
_SAFE = 2**53 - 1
_SHA = re.compile(r'[0-9a-f]{64}\Z', re.ASCII)
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z', re.ASCII)
_SCOPE = re.compile(r'Узел [A-Za-z0-9А-Яа-яЁё_-]{1,40}\. Сопряжение перегородки с перекрытием\Z')
_HEADER = 'Ведомость мероприятий сопряжения перегородки с перекрытием'
_FEATURES = {'Демпферная лента': 'DAMPING_TAPE',
             'Акустическая прокладка': 'ACOUSTIC_GASKET'}
_FRAGMENT = {'pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'}


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion': RESULT_SCHEMA_VERSION, 'status': 'ABSTAIN', 'reasonCode': reason}


def _integer(value: Any, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= _SAFE


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(_integer(n) for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _contains(outer: list[int], inner: list[int]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and inner[2] <= outer[2] and inner[3] <= outer[3]


def _intersects(a: list[int], b: list[int]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _canonical_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def reconstruct_ar053_inventory_source(input: Any) -> dict[str, Any]:
    """Reconstruct exact local rows, retaining unresolved source content.

    Native validation precedes all application traversal. RECONSTRUCTED means
    mechanically accounted source rows, never closed scope or human completeness.
    """
    portable_error = _portable_error(input)
    if portable_error:
        return _abstain('INPUT_LIMIT' if portable_error == 'LIMIT' else 'INVALID_INPUT')
    if (type(input) is not dict or set(input) != {
            'sourceFileId', 'sourceSha256', 'stage', 'pageStages', 'textArtifact', 'selection'}
            or not _key(input.get('sourceFileId'))
            or type(input.get('sourceSha256')) is not str or not _SHA.fullmatch(input['sourceSha256'])
            or type(input.get('stage')) is not str
            or type(input.get('pageStages')) is not dict):
        return _abstain('INVALID_INPUT')
    stages = input['pageStages']
    if any(not _PAGE.fullmatch(key) or type(stage) is not str
           or stage not in {'PD', 'RD', 'ID', 'UNRESOLVED'} for key, stage in stages.items()):
        return _abstain('INVALID_INPUT')
    selection = input['selection']
    # Numeric type errors are native input failures, not rounding/selection repair.
    if type(selection) is dict:
        numbers = [selection.get('pageNumber')]
        region = selection.get('regionBoxMilliPoints')
        if type(region) is list:
            numbers.extend(region)
        for group in ('headerFragments', 'scopeFragments'):
            if type(selection.get(group)) is list:
                for fragment in selection[group]:
                    if type(fragment) is dict:
                        numbers.extend(fragment.get(key) for key in ('pageNumber', 'blockIndex', 'lineIndex'))
                        if type(fragment.get('bboxMilliPoints')) is list:
                            numbers.extend(fragment['bboxMilliPoints'])
        if any(type(n) is bool for n in numbers):
            return _abstain('INVALID_INPUT')
    artifact = input['textArtifact']
    if not _valid_artifact(artifact):
        return _abstain('INVALID_TEXT_ARTIFACT')
    if artifact['pageCount'] > 512:
        return _abstain('INPUT_LIMIT')
    if any(int(key) > artifact['pageCount'] for key in stages):
        return _abstain('INVALID_INPUT')
    if artifact['sourceFileId'] != input['sourceFileId'] or artifact['inputSha256'] != input['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if input['stage'] not in {'PD', 'RD'} or any(stage != input['stage'] for stage in stages.values()):
        return _abstain('STAGE_UNRESOLVED')
    if (type(selection) is not dict or set(selection) != {
            'pageNumber', 'regionBoxMilliPoints', 'headerFragments', 'scopeFragments'}
            or not _integer(selection.get('pageNumber'), 1)
            or selection['pageNumber'] > artifact['pageCount']):
        return _abstain('INVALID_SELECTION')
    page = artifact['pages'][selection['pageNumber'] - 1]
    region = selection['regionBoxMilliPoints']
    if not _box(region, page['widthMilliPoints'], page['heightMilliPoints']):
        return _abstain('INVALID_SELECTION')
    for group in ('headerFragments', 'scopeFragments'):
        fragments = selection[group]
        if (type(fragments) is not list or len(fragments) != 1
                or type(fragments[0]) is not dict or set(fragments[0]) != _FRAGMENT
                or not _integer(fragments[0]['pageNumber'], 1)
                or not _integer(fragments[0]['blockIndex'])
                or not _integer(fragments[0]['lineIndex'])
                or type(fragments[0]['rawText']) is not str
                or not _box(fragments[0]['bboxMilliPoints'], page['widthMilliPoints'], page['heightMilliPoints'])):
            return _abstain('INVALID_SELECTION')
    reader = read_table_row_page(page)
    if reader['status'] != 'READY':
        reason = reader['reasonCode']
        return _abstain({'INVALID_PAGE': 'INVALID_TEXT_ARTIFACT', 'PAGE_LIMIT': 'INPUT_LIMIT'}.get(reason, reason))
    intersects = [line for line in reader['lines']
                  if line['rawText'].strip() and _intersects(region, line['bboxMilliPoints'])]
    if len(intersects) > 128:
        return _abstain('REGION_LINE_LIMIT')
    if any(not _contains(region, line['bboxMilliPoints']) for line in intersects):
        return _abstain('REGION_BOUNDARY_CROSSED')
    lines = sorted(intersects, key=lambda line: (-line['bboxMilliPoints'][1], line['bboxMilliPoints'][0],
                                               line['blockIndex'], line['lineIndex']))
    # One-column policy: distinct source lines cannot occupy the same Y band.
    for previous, current in zip(lines, lines[1:]):
        gap = previous['bboxMilliPoints'][1] - current['bboxMilliPoints'][3]
        if not 0 <= gap <= 30000:
            return _abstain('AMBIGUOUS_LAYOUT')
    header = selection['headerFragments'][0]
    scope = selection['scopeFragments'][0]
    if (header['rawText'] != _HEADER or header not in lines
            or sum(line['rawText'] == _HEADER for line in lines) != 1 or lines[0] != header):
        return _abstain('HEADER_UNVERIFIED')
    if (not _SCOPE.fullmatch(scope['rawText']) or scope not in lines
            or sum(bool(_SCOPE.fullmatch(line['rawText'])) for line in lines) != 1
            or len(lines) < 2 or lines[1] != scope):
        return _abstain('SCOPE_UNVERIFIED')
    feature_rows = []
    unresolved = []
    seen = set()
    for line in lines[2:]:
        feature = _FEATURES.get(line['rawText'])
        if feature is None:
            unresolved.append({'reasonCode': 'UNSUPPORTED_ROW', 'fragments': [deepcopy(line)]})
        else:
            feature_rows.append({'featureKey': feature, 'fragments': [deepcopy(line)]})
            if feature in seen:
                unresolved.append({'reasonCode': 'DUPLICATE_FEATURE', 'fragments': [deepcopy(line)]})
            seen.add(feature)
    if len(feature_rows) > 64 or len(unresolved) > 128:
        return _abstain('REGION_LINE_LIMIT')
    body = {'schemaVersion': INVENTORY_SCHEMA_VERSION, 'extractorVersion': EXTRACTOR_VERSION,
            'policyVersion': POLICY_VERSION, 'sourceFileId': input['sourceFileId'],
            'sourceSha256': input['sourceSha256'], 'textArtifactHash': _canonical_hash({
                'hashDomain': 'matrix-source-declaration-text-artifact-v1', 'textArtifact': artifact}),
            'stage': input['stage'], 'pageNumber': page['pageNumber'],
            'widthMilliPoints': page['widthMilliPoints'], 'heightMilliPoints': page['heightMilliPoints'],
            'regionBoxMilliPoints': list(region), 'headerFragments': deepcopy(selection['headerFragments']),
            'scopeFragments': deepcopy(selection['scopeFragments']),
            'featureRows': feature_rows, 'unresolvedRows': unresolved}
    return {'schemaVersion': RESULT_SCHEMA_VERSION, 'status': 'RECONSTRUCTED', 'inventory': body}
