"""Literal source-only lighting declarations, without identity or comparison.

Only generic full-envelope, native JSON and original line readers are reused.
Neither a manufacturer nor a model number establishes a lamp technology.
"""
from __future__ import annotations
import copy
import hashlib
import re
from typing import Any

from .source_declarations import canonical_source_declaration_json, _valid_artifact
from .table_row_binding import _portable_error, _integer, _text, _key, _box, read_table_row_page

EXTRACTOR_VERSION = 'matrix-zu130-lighting-technology-source-v1'
POLICY_VERSION = 'matrix-zu130-explicit-lighting-technology-literals-v1'
_RESULT = 'matrix-zu130-lighting-technology-source-result-v1'
_INPUT = {'sourceFileId', 'sourceSha256', 'stage', 'pageStages', 'textArtifact', 'selection'}
_FRAGMENT = {'pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'}
_STAGES = {'PD', 'RD', 'ID', 'UNRESOLVED'}
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z')
_ALIASES = {literal: technology for technology, literals in {
    'LED': ('LED', 'светодиодный', 'светодиодные'),
    'FLUORESCENT': ('FLUORESCENT', 'люминесцентный', 'люминесцентные'),
    'INCANDESCENT': ('INCANDESCENT', 'лампа накаливания', 'лампы накаливания'),
}.items() for literal in literals}
_NAMED = re.compile(r'Светильник +([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\. Источник +света: ([^\r\n\t]+)\.\Z')
_FIRST = re.compile(r'Светотехническое +оборудование +приняты +с +энергосберегающими +источниками +света\Z')
_SECOND = re.compile(r'\(([^()\r\n\t]+)\), на базе продукции компании «([^«»()\x22\x27\r\n\t]{1,200})»\.\Z')


def lighting_technology_declaration_content_hash(declaration: Any) -> str:
    """A bounded portable content hash is not an authentication claim."""
    if _portable_error(declaration):
        raise ValueError('lighting declaration is not bounded portable JSON')
    body = {'hashDomain': 'matrix-zu130-lighting-technology-source-id-v1', 'declaration': declaration}
    return hashlib.sha256(canonical_source_declaration_json(body).encode('utf-8')).hexdigest()


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion': _RESULT, 'status': 'ABSTAIN', 'reasonCode': reason}


def _fragment(raw: Any, page: int, width: int, height: int) -> bool:
    return (type(raw) is dict and set(raw) == _FRAGMENT and _integer(raw.get('pageNumber'), 1)
            and raw['pageNumber'] == page and _integer(raw.get('blockIndex')) and _integer(raw.get('lineIndex'))
            and _text(raw.get('rawText'), line=True) and 0 < len(raw['rawText']) <= 8192
            and bool(raw['rawText'].strip()) and _box(raw.get('bboxMilliPoints'), width, height))


def reconstruct_lighting_technology_source(value: Any) -> dict[str, Any]:
    error = _portable_error(value)
    if error:
        return _abstain('INPUT_LIMIT' if error == 'LIMIT' else 'INVALID_INPUT')
    if (type(value) is not dict or set(value) != _INPUT or not _key(value.get('sourceFileId'))
            or type(value.get('sourceSha256')) is not str or not _SHA.fullmatch(value['sourceSha256'])
            or type(value.get('stage')) is not str or value['stage'] not in _STAGES
            or type(value.get('pageStages')) is not dict):
        return _abstain('INVALID_INPUT')
    overrides = value['pageStages']
    if any(not _PAGE.fullmatch(k) or not _integer(int(k), 1)
           or type(stage) is not str or stage not in _STAGES for k, stage in overrides.items()):
        return _abstain('INVALID_INPUT')
    artifact = value['textArtifact']
    if not _valid_artifact(artifact):
        return _abstain('INVALID_TEXT_ARTIFACT')
    if artifact['pageCount'] > 512 or sum(len(block['text'].split('\n'))
            for page in artifact['pages'] for block in page['blocks']) > 100000:
        return _abstain('INPUT_LIMIT')
    if artifact['sourceFileId'] != value['sourceFileId'] or artifact['inputSha256'] != value['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if any(int(k) > artifact['pageCount'] for k in overrides):
        return _abstain('INVALID_INPUT')
    if any(stage != 'UNRESOLVED' and stage != value['stage'] for stage in overrides.values()):
        return _abstain('STAGE_CONFLICT')
    selection = value['selection']
    if (type(selection) is not dict or set(selection) != {'pageNumber', 'fragments'}
            or not _integer(selection.get('pageNumber'), 1) or selection['pageNumber'] > artifact['pageCount']
            or type(selection.get('fragments')) is not list or len(selection['fragments']) not in (1, 2)):
        return _abstain('INVALID_SELECTION')
    page_number = selection['pageNumber']
    page = artifact['pages'][page_number - 1]
    width, height = page['widthMilliPoints'], page['heightMilliPoints']
    fragments = selection['fragments']
    if any(not _fragment(f, page_number, width, height) for f in fragments):
        return _abstain('INVALID_SELECTION')
    order = lambda f: (-f['bboxMilliPoints'][3], f['bboxMilliPoints'][0], f['blockIndex'], f['lineIndex'])
    if fragments != sorted(fragments, key=order) or len({(f['blockIndex'], f['lineIndex']) for f in fragments}) != len(fragments):
        return _abstain('INVALID_SELECTION')
    read = read_table_row_page(page)
    if read['status'] != 'READY':
        reason = read['reasonCode']
        return _abstain('INPUT_LIMIT' if reason == 'PAGE_LIMIT' else
            'SOURCE_TEXT_UNAVAILABLE' if reason in ('TEXT_LAYER_UNAVAILABLE', 'LINE_GEOMETRY_UNAVAILABLE') else
            'LINE_GEOMETRY_INCONSISTENT' if reason == 'LINE_GEOMETRY_INCONSISTENT' else 'INVALID_TEXT_ARTIFACT')
    source_lines = {(f['blockIndex'], f['lineIndex']): f for f in read['lines']}
    if any(source_lines.get((f['blockIndex'], f['lineIndex'])) != f for f in fragments):
        return _abstain('SELECTION_MISMATCH')
    boxes = [f['bboxMilliPoints'] for f in fragments]
    region = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    selected_refs = {(f['blockIndex'], f['lineIndex']) for f in fragments}
    for line in read['lines']:
        if (line['blockIndex'], line['lineIndex']) in selected_refs or not line['rawText'].strip():
            continue
        box = line['bboxMilliPoints']
        if region[0] <= box[2] and box[0] <= region[2] and region[1] <= box[3] and box[1] <= region[3]:
            return _abstain('AMBIGUOUS_LAYOUT')
    if len(fragments) == 2:
        first, second = fragments
        a, b = boxes
        # Real group: heights12000, indent14160, vertical gap10080mpt.
        if (not all(9000 <= box[3] - box[1] <= 14000 for box in boxes)
                or abs((a[3] - a[1]) - (b[3] - b[1])) > 1000 or abs(a[0] - b[0]) > 16000
                or a[2] < b[2] or not 0 <= a[1] - b[3] <= 18000
                or (first['blockIndex'] == second['blockIndex'] and second['lineIndex'] != first['lineIndex'] + 1)):
            return _abstain('AMBIGUOUS_LAYOUT')
        match = _SECOND.fullmatch(second['rawText'])
        if not _FIRST.fullmatch(first['rawText']) or not match or match[2].strip() != match[2] or not match[2].strip():
            return _abstain('DECLARATION_UNVERIFIED')
        raw_technology, position = match[1], None
    else:
        match = _NAMED.fullmatch(fragments[0]['rawText'])
        if not match:
            return _abstain('DECLARATION_UNVERIFIED')
        position, raw_technology = match[1], match[2]
    technology = _ALIASES.get(raw_technology)
    if technology is None:
        return _abstain('DECLARATION_UNVERIFIED')
    text_hash = hashlib.sha256(canonical_source_declaration_json({
        'hashDomain': 'matrix-source-declaration-text-artifact-v1', 'textArtifact': artifact}).encode('utf-8')).hexdigest()
    declaration = {'schemaVersion': 'matrix-zu130-lighting-technology-declaration-v1',
        'extractorVersion': EXTRACTOR_VERSION, 'bindingPolicyVersion': POLICY_VERSION,
        'sourceFileId': value['sourceFileId'], 'sourceSha256': value['sourceSha256'],
        'textArtifactHash': text_hash, 'stage': overrides.get(str(page_number), value['stage']),
        'pageNumber': page_number, 'pageWidthMilliPoints': width, 'pageHeightMilliPoints': height,
        'regionBoxMilliPoints': region, 'technology': technology, 'rawTechnology': raw_technology,
        'positionLabel': position, 'scopeStatus': 'UNBOUND_GROUP_DECLARATION' if position is None else 'NAMED_POSITION_LITERAL',
        'primaryFragments': copy.deepcopy(fragments), 'authorityStatus': 'SOURCE_DECLARED_UNVERIFIED', 'calibratedProbability': None}
    return {'schemaVersion': _RESULT, 'status': 'RECONSTRUCTED', 'declaration': declaration}
