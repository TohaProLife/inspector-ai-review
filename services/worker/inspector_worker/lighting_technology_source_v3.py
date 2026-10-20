"""Literal lighting declarations from complete original document-text-v3.

Canonical contract: matrix-lighting-technology-source-v3.schema.json. Native
paths and complete raw lines are evidence, never rendered-visibility authority.
No v2 facade, equipment ranking, physical identity or comparison is inferred.
"""
from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

from .document_text_v3 import (_native, _canonical, _box, _positive, _WS,
                               read_document_text_v3_artifact)

EXTRACTOR_VERSION = 'matrix-zu130-lighting-technology-source-v3-v1'
POLICY_VERSION = 'matrix-zu130-explicit-lighting-technology-v3-literals-v1'
_RESULT = 'matrix-zu130-lighting-technology-source-v3-result-v1'
_DECLARATION = 'matrix-zu130-lighting-technology-v3-declaration-v1'
_INPUT = set('sourceFileId sourceSha256 stage pageStages textArtifact selection'.split())
_DECLARATION_KEYS = set(('schemaVersion extractorVersion bindingPolicyVersion sourceFileId sourceSha256 '
    'textArtifactHash extractorProfileHash stage pageNumber pageWidthMilliPoints pageHeightMilliPoints '
    'nativeFrame regionBoxMilliPoints technology rawTechnology positionLabel scopeStatus primaryFragments '
    'authorityStatus renderedVisibility calibratedProbability').split())
_PRIMARY = set('pageNumber sourcePath rawText nativeBoxPointStrings bboxMilliPoints usedTextRange'.split())
_STAGES = frozenset(('PD', 'RD', 'ID', 'UNRESOLVED'))
_SHA = re.compile(r'[a-f0-9]{64}\Z', re.ASCII)
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z', re.ASCII)
_POSITION = re.compile(r'[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}\Z')
_NAMED = re.compile(r'Светильник +([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\. Источник +света: ([^\r\n\t]+)\.\Z')
_FIRST = re.compile(r'Светотехническое +оборудование +приняты +с +энергосберегающими +источниками +света\Z')
_SECOND = re.compile(r'\(([^()\r\n\t]+)\), на базе продукции компании «([^«»()\x22\x27\r\n\t]{1,200})»\.\Z')
_ALIASES = {literal: technology for technology, literals in {
    'LED': ('LED', 'светодиодный', 'светодиодные'),
    'FLUORESCENT': ('FLUORESCENT', 'люминесцентный', 'люминесцентные'),
    'INCANDESCENT': ('INCANDESCENT', 'лампа накаливания', 'лампы накаливания'),
}.items() for literal in literals}
_MAX = 9007199254740991


def _integer(value: Any, minimum: int = 0, maximum: int = _MAX) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _sha(value: Any) -> bool:
    return type(value) is str and bool(_SHA.fullmatch(value))


def _key(value: Any) -> bool:
    # Frozen lighting key grammar; the full v3 artifact reader separately
    # enforces its own source identity policy at the next boundary.
    return (type(value) is str and 1 <= len(value) <= 200
            and ord(value[0]) not in _WS and ord(value[-1]) not in _WS
            and not any((ord(c) < 32 and c != '\t') or c in '\u2028\u2029\ufffd' for c in value))


def _path(value: Any) -> bool:
    return (type(value) is list and 1 <= len(value) <= 64
            and all(_integer(index, 0, 32767) for index in value))


def _raw(value: Any) -> bool:
    return type(value) is str and 1 <= len(value) <= 2000000


def _bbox(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(_integer(edge) for edge in value)
            and 0 <= value[0] < value[2] <= width
            and 0 <= value[1] < value[3] <= height)


def _view(raw: str) -> tuple[str, dict]:
    # Lossless, explicitly versioned grammar view. Never Python strip/trim.
    end = len(raw) - (1 if raw.endswith('\n') else 0)
    start = 0
    while start < end and raw[start] == ' ':
        start += 1
    while end > start and raw[end - 1] == ' ':
        end -= 1
    return raw[start:end], {'start': start, 'end': end}


def _declaration_dto(value: Any) -> None:
    """Standalone bounded DTO integrity, not reconstruction/authentication."""
    _native(value)
    if type(value) is not dict or set(value) != _DECLARATION_KEYS:
        raise ValueError('INVALID_DECLARATION')
    constants = {'schemaVersion': _DECLARATION, 'extractorVersion': EXTRACTOR_VERSION,
                 'bindingPolicyVersion': POLICY_VERSION,
                 'authorityStatus': 'SOURCE_DECLARED_UNVERIFIED', 'renderedVisibility': 'UNVERIFIED'}
    if (any(value[k] != expected for k, expected in constants.items())
            or value['calibratedProbability'] is not None or not _key(value['sourceFileId'])
            or any(not _sha(value[k]) for k in ('sourceSha256', 'textArtifactHash', 'extractorProfileHash'))
            or type(value['stage']) is not str or value['stage'] not in _STAGES
            or not _integer(value['pageNumber'], 1, 512)
            or any(not _integer(value[k], 1) for k in ('pageWidthMilliPoints', 'pageHeightMilliPoints'))
            or type(value['technology']) is not str or value['technology'] not in _ALIASES.values()
            or type(value['rawTechnology']) is not str or not 1 <= len(value['rawTechnology']) <= 200):
        raise ValueError('INVALID_DECLARATION')
    width, height = value['pageWidthMilliPoints'], value['pageHeightMilliPoints']
    frame = value['nativeFrame']
    if (type(frame) is not dict or set(frame) != {'coordinateSystem', 'visibleBoxPointStrings'}
            or frame['coordinateSystem'] != 'PDFMINER_LAYOUT_POINTS'
            or not _positive(_box(frame['visibleBoxPointStrings']))
            or not _bbox(value['regionBoxMilliPoints'], width, height)):
        raise ValueError('INVALID_DECLARATION')
    fragments = value['primaryFragments']
    if type(fragments) is not list or len(fragments) not in (1, 2):
        raise ValueError('INVALID_DECLARATION')
    paths = set()
    for fragment in fragments:
        if (type(fragment) is not dict or set(fragment) != _PRIMARY
                or not _integer(fragment['pageNumber'], 1, 512) or fragment['pageNumber'] != value['pageNumber']
                or not _path(fragment['sourcePath']) or not _raw(fragment['rawText'])
                or not _positive(_box(fragment['nativeBoxPointStrings']))
                or not _bbox(fragment['bboxMilliPoints'], width, height)):
            raise ValueError('INVALID_DECLARATION')
        path = tuple(fragment['sourcePath'])
        if any(path == previous or path[:len(previous)] == previous or previous[:len(path)] == path
               for previous in paths):
            raise ValueError('INVALID_DECLARATION')
        paths.add(path)
        used = fragment['usedTextRange']
        if (type(used) is not dict or set(used) != {'start', 'end'}
                or not _integer(used['start']) or not _integer(used['end'], 1)
                or not used['start'] < used['end'] <= len(fragment['rawText'])):
            raise ValueError('INVALID_DECLARATION')
    if value['scopeStatus'] == 'NAMED_POSITION_LITERAL':
        if (len(fragments) != 1 or type(value['positionLabel']) is not str
                or not _POSITION.fullmatch(value['positionLabel'])):
            raise ValueError('INVALID_DECLARATION')
    elif value['scopeStatus'] == 'UNBOUND_GROUP_DECLARATION':
        if len(fragments) != 2 or value['positionLabel'] is not None:
            raise ValueError('INVALID_DECLARATION')
    else:
        raise ValueError('INVALID_DECLARATION')
    # Standalone integrity must bind reported literals/ranges to these raw
    # whole lines. This authenticates neither their origin nor their hashes.
    views = [_view(fragment['rawText']) for fragment in fragments]
    if (any(not view or any(c in view for c in '\r\n\t') for view, _ in views)
            or any(fragment['usedTextRange'] != used
                   for fragment, (_, used) in zip(fragments, views))):
        raise ValueError('INVALID_DECLARATION')
    if len(fragments) == 1:
        match = _NAMED.fullmatch(views[0][0])
        if not match:
            raise ValueError('INVALID_DECLARATION')
        position, raw_technology = match[1], match[2]
    else:
        match = _SECOND.fullmatch(views[1][0])
        if (not _FIRST.fullmatch(views[0][0]) or not match
                or not match[2] or match[2].strip() != match[2]
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in match[2])):
            raise ValueError('INVALID_DECLARATION')
        position, raw_technology = None, match[1]
    if (raw_technology not in _ALIASES or value['rawTechnology'] != raw_technology
            or value['technology'] != _ALIASES[raw_technology]
            or value['positionLabel'] != position):
        raise ValueError('INVALID_DECLARATION')


def lighting_technology_v3_declaration_content_hash(declaration: Any) -> str:
    _declaration_dto(declaration)
    body = {'hashDomain': 'matrix-zu130-lighting-technology-v3-source-id-v1', 'declaration': declaration}
    return hashlib.sha256(_canonical(body).encode('utf-8')).hexdigest()


def _abstain(reason: str) -> dict:
    return {'schemaVersion': _RESULT, 'status': 'ABSTAIN', 'reasonCode': reason}


def reconstruct_lighting_technology_source_v3(value: Any) -> dict:
    try:
        _native(value)
    except ValueError as error:
        return _abstain('INPUT_LIMIT' if str(error) == 'INPUT_LIMIT' else 'INVALID_INPUT')
    if (type(value) is not dict or set(value) != _INPUT or not _key(value['sourceFileId'])
            or not _sha(value['sourceSha256']) or type(value['stage']) is not str
            or value['stage'] not in _STAGES or type(value['pageStages']) is not dict):
        return _abstain('INVALID_INPUT')
    overrides = value['pageStages']
    if any(not _PAGE.fullmatch(key) or not _integer(int(key), 1)
           or type(stage) is not str or stage not in _STAGES for key, stage in overrides.items()):
        return _abstain('INVALID_INPUT')
    artifact = value['textArtifact']
    read = read_document_text_v3_artifact(artifact)
    if read['status'] != 'VALID':
        return _abstain('INPUT_LIMIT' if read['reasonCode'] == 'INPUT_LIMIT' else 'INVALID_TEXT_ARTIFACT')
    if artifact['sourceFileId'] != value['sourceFileId'] or artifact['inputSha256'] != value['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if any(int(key) > artifact['pageCount'] for key in overrides):
        return _abstain('INVALID_INPUT')
    if any(stage != 'UNRESOLVED' and stage != value['stage'] for stage in overrides.values()):
        return _abstain('STAGE_CONFLICT')
    selection = value['selection']
    if (type(selection) is not dict or set(selection) != {'pageNumber', 'fragments'}
            or not _integer(selection['pageNumber'], 1, artifact['pageCount'])
            or type(selection['fragments']) is not list or len(selection['fragments']) not in (1, 2)):
        return _abstain('INVALID_SELECTION')
    requested = selection['fragments']
    if any(type(f) is not dict or set(f) != {'sourcePath', 'rawText'}
           or not _path(f['sourcePath']) or not _raw(f['rawText']) for f in requested):
        return _abstain('INVALID_SELECTION')
    refs = [tuple(f['sourcePath']) for f in requested]
    if len(set(refs)) != len(refs):
        return _abstain('INVALID_SELECTION')
    number = selection['pageNumber']
    page = artifact['pages'][number - 1]
    source = {tuple(f['sourcePath']): f for f in page['locatedLines'] + page['unlocatedLines']}
    if any(ref not in source or source[ref]['rawText'] != f['rawText'] for ref, f in zip(refs, requested)):
        return _abstain('SELECTION_MISMATCH')
    fragments = [source[ref] for ref in refs]
    if any('reasonCode' in f for f in fragments):
        return _abstain('SELECTED_TEXT_UNLOCATED')
    if page['unlocatedLines']:
        return _abstain('UNLOCATED_PAGE_TEXT')
    if page['quality']['disposition'] != 'TEXT_LAYER_CANDIDATE':
        return _abstain('SOURCE_TEXT_UNAVAILABLE')
    order = lambda f: (-f['bboxMilliPoints'][3], f['bboxMilliPoints'][0], tuple(f['sourcePath']))
    if fragments != sorted(fragments, key=order):
        return _abstain('INVALID_SELECTION')
    boxes = [f['bboxMilliPoints'] for f in fragments]
    region = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    for line in page['locatedLines']:
        if tuple(line['sourcePath']) in refs or not any(ord(c) not in _WS for c in line['rawText']):
            continue
        box = line['bboxMilliPoints']
        if region[0] <= box[2] and box[0] <= region[2] and region[1] <= box[3] and box[1] <= region[3]:
            return _abstain('AMBIGUOUS_LAYOUT')
    if len(fragments) == 2:
        first, second = fragments
        a, b = boxes
        if (not all(9000 <= box[3] - box[1] <= 14000 for box in boxes)
                or abs((a[3] - a[1]) - (b[3] - b[1])) > 1000
                or abs(a[0] - b[0]) > 16000 or a[2] < b[2]
                or not 0 <= a[1] - b[3] <= 18000
                or (first['sourcePath'][:-1] == second['sourcePath'][:-1]
                    and second['sourcePath'][-1] != first['sourcePath'][-1] + 1)):
            return _abstain('AMBIGUOUS_LAYOUT')
    views = [_view(f['rawText']) for f in fragments]
    if any(not view or any(c in view for c in '\r\n\t') for view, _ in views):
        return _abstain('DECLARATION_UNVERIFIED')
    if len(fragments) == 2:
        match = _SECOND.fullmatch(views[1][0])
        if (not _FIRST.fullmatch(views[0][0]) or not match or match[2].strip() != match[2]
                or not match[2] or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in match[2])):
            return _abstain('DECLARATION_UNVERIFIED')
        raw_technology, position = match[1], None
    else:
        match = _NAMED.fullmatch(views[0][0])
        if not match:
            return _abstain('DECLARATION_UNVERIFIED')
        position, raw_technology = match[1], match[2]
    technology = _ALIASES.get(raw_technology)
    if technology is None:
        return _abstain('DECLARATION_UNVERIFIED')
    primary = [{'pageNumber': number, **copy.deepcopy(line), 'usedTextRange': used}
               for line, (_, used) in zip(fragments, views)]
    declaration = {'schemaVersion': _DECLARATION, 'extractorVersion': EXTRACTOR_VERSION,
        'bindingPolicyVersion': POLICY_VERSION, 'sourceFileId': value['sourceFileId'],
        'sourceSha256': value['sourceSha256'], 'textArtifactHash': read['contentHash'],
        'extractorProfileHash': artifact['extractorProfileHash'],
        'stage': overrides.get(str(number), value['stage']), 'pageNumber': number,
        'pageWidthMilliPoints': page['widthMilliPoints'], 'pageHeightMilliPoints': page['heightMilliPoints'],
        'nativeFrame': copy.deepcopy(page['nativeFrame']), 'regionBoxMilliPoints': region,
        'technology': technology, 'rawTechnology': raw_technology, 'positionLabel': position,
        'scopeStatus': 'NAMED_POSITION_LITERAL' if position is not None else 'UNBOUND_GROUP_DECLARATION',
        'primaryFragments': primary, 'authorityStatus': 'SOURCE_DECLARED_UNVERIFIED',
        'renderedVisibility': 'UNVERIFIED', 'calibratedProbability': None}
    return {'schemaVersion': _RESULT, 'status': 'RECONSTRUCTED', 'declaration': declaration}
