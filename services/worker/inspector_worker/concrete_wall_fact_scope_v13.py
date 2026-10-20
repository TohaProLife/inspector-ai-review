"""Portable fact selectors only. No source approval, entity trust or coverage effects.

Used by matrix_engine for authenticated fact bindings. The durable adapter pins this
module alongside the engine. Legacy engine JSON hashing remains unchanged.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from typing import Any

from .rebar_prose import extract_rebar_candidates
from .concrete_prose import extract_concrete_candidates, is_concrete_prose_fact


def _scalar_string(value: str) -> bool:
    try:
        value.encode('utf-8')
        return True
    except UnicodeEncodeError:
        return False


def _portable_tree(value: Any, ancestors: set[int], depth: int = 0) -> Any:
    if value is None or type(value) is bool:
        return value
    if type(value) is str:
        if not _scalar_string(value):
            raise TypeError('Portable evidence requires Unicode scalar strings')
        return value
    if type(value) in (int, float):
        try:
            number = float(value)
        except OverflowError as error:
            raise TypeError('Portable evidence requires finite JSON numbers') from error
        if not math.isfinite(number):
            raise TypeError('Portable evidence requires finite JSON numbers')
        return ['$number', struct.pack('>d', number).hex()]
    if type(value) not in (list, dict) or depth > 100 or id(value) in ancestors:
        raise TypeError('Portable evidence requires finite acyclic JSON values')
    ancestors.add(id(value))
    try:
        if type(value) is list:
            return ['$array', [_portable_tree(child, ancestors, depth + 1) for child in value]]
        if any(type(key) is not str or not _scalar_string(key) for key in value):
            raise TypeError('Portable evidence requires Unicode scalar object keys')
        return ['$object', [[key, _portable_tree(value[key], ancestors, depth + 1)]
                            for key in sorted(value, key=lambda key: key.encode('utf-8'))]]
    finally:
        ancestors.remove(id(value))


def portable_evidence_json(value: Any) -> str:
    """UTF-8 JSON typed tree; numbers are big-endian float64 hex, keys sort by UTF-8 bytes."""
    return json.dumps(_portable_tree(value, set()), ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def portable_evidence_hash(value: Any) -> str:
    """Same legacy typed bytes, streamed without a complete tagged tree/string."""
    digest = hashlib.sha256()
    buffer = bytearray()

    def emit(token: bytes) -> None:
        if len(buffer) + len(token) > 65536:
            digest.update(buffer)
            buffer.clear()
        buffer.extend(token)

    def scalar_string(item: str) -> bool:
        # Exact str only. Avoid a full UTF8 copy during legacy scalar admission.
        try:
            for start in range(0, len(item), 8192):
                item[start:start + 8192].encode('utf-8')
            return True
        except UnicodeEncodeError:
            return False

    def string(item: str) -> None:
        emit(b'"')
        for start in range(0, len(item), 8192):
            # JSON escapes are per codepoint; scalar admission forbids surrogates.
            part = json.dumps(item[start:start + 8192], ensure_ascii=False,
                              separators=(',', ':'), allow_nan=False)
            emit(part[1:-1].encode('utf-8'))
        emit(b'"')

    def visit(item: Any, ancestors: set[int], depth: int = 0) -> None:
        if item is None or type(item) is bool:
            emit(b'null' if item is None else b'true' if item else b'false')
            return
        if type(item) is str:
            if not scalar_string(item):
                raise TypeError('Portable evidence requires Unicode scalar strings')
            string(item)
            return
        if type(item) in (int, float):
            try:
                number = float(item)
            except OverflowError as error:
                raise TypeError('Portable evidence requires finite JSON numbers') from error
            if not math.isfinite(number):
                raise TypeError('Portable evidence requires finite JSON numbers')
            emit(b'["$number","' + struct.pack('>d', number).hex().encode('ascii') + b'"]')
            return
        if type(item) not in (list, dict) or depth > 100 or id(item) in ancestors:
            raise TypeError('Portable evidence requires finite acyclic JSON values')
        ancestors.add(id(item))
        try:
            if type(item) is list:
                emit(b'["$array",[')
                for index, child in enumerate(item):
                    if index:
                        emit(b',')
                    visit(child, ancestors, depth + 1)
                emit(b']]')
                return
            if any(type(key) is not str or not scalar_string(key) for key in item):
                raise TypeError('Portable evidence requires Unicode scalar object keys')
            emit(b'["$object",[')
            # Unicode scalar codepoint order equals UTF8 byte order, including
            # prefixes and BMP/astral boundaries. No full encoded-key copies.
            for index, key in enumerate(sorted(item)):
                if index:
                    emit(b',')
                emit(b'[')
                string(key)
                emit(b',')
                visit(item[key], ancestors, depth + 1)
                emit(b']')
            emit(b']]')
        finally:
            ancestors.remove(id(item))

    visit(value, set())
    if buffer:
        digest.update(buffer)
    return digest.hexdigest()


_HASH = re.compile(r'[a-f0-9]{64}\Z')
_BLOCK_ID = re.compile(r'[0-9]+:[0-9]+\Z')
_BOX_KEYS = ('x', 'y', 'width', 'height')
_SELECTOR_FIELDS = ('sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'blockId',
                    'attribute', 'value', 'unit', 'rawValue', 'rawUnit', 'rawText',
                    'method', 'extractorVersion', 'bbox', 'evidenceFragments')


def _string(value: Any, maximum: int, minimum: int = 1) -> bool:
    return (type(value) is str and _scalar_string(value)
            and minimum <= len(value.encode('utf-16-le')) // 2 <= maximum)


def _safe_integer(value: Any) -> bool:
    return (type(value) in (int, float) and abs(value) <= 9007199254740991
            and math.isfinite(value) and value == int(value))


def _valid_box(value: Any) -> bool:
    return (type(value) is dict and set(value) == set(_BOX_KEYS)
            and all(type(value[key]) in (int, float) and 0 <= value[key] <= 1 for key in _BOX_KEYS)
            and 0 <= value['x'] <= 1 and 0 <= value['y'] <= 1
            and 0 < value['width'] <= 1 and 0 < value['height'] <= 1
            and value['x'] + value['width'] <= 1.000001
            and value['y'] + value['height'] <= 1.000001)


def _valid_fragment(value: Any, *, context: bool = False) -> bool:
    keys = {'blockId', 'rawText', 'bbox'} | ({'pageNumber', 'role'} if context else set())
    return (type(value) is dict and set(value) == keys
            and _string(value.get('blockId'), 40) and _BLOCK_ID.fullmatch(value['blockId']) is not None
            and _string(value.get('rawText'), 100000) and _valid_box(value.get('bbox'))
            and (not context or (_safe_integer(value.get('pageNumber')) and value['pageNumber'] > 0
                                 and value.get('role') in ('ATTRIBUTE_HEADER', 'TABLE_SCOPE', 'UNIT_DECLARATION', 'MATERIAL_SCOPE'))))


def _source_box(fragment: dict[str, Any], page_number: int, pages: list[dict[str, Any]]) -> list[int] | None:
    page = next((item for item in pages if item['pageNumber'] == page_number), None)
    if page is None or type(page.get('blocks')) is not list:
        return None
    width, height = page.get('widthMilliPoints'), page.get('heightMilliPoints')
    if not _safe_integer(width) or not _safe_integer(height) or width <= 0 or height <= 0:
        return None
    block_index, line_index = map(int, fragment['blockId'].split(':'))
    if block_index >= len(page['blocks']):
        return None
    block = page['blocks'][block_index]
    if type(block) is not dict or type(block.get('text')) is not str:
        return None
    lines = re.split(r'\r?\n', block['text'])
    if line_index >= len(lines) or lines[line_index].strip() != fragment['rawText'].strip():
        return None
    line_boxes = block.get('lineBboxesMilliPoints')
    source = ((line_boxes[line_index] if line_index < len(line_boxes) else None)
              if type(line_boxes) is list else block.get('bboxMilliPoints'))
    if (type(source) is not list or len(source) != 4 or not all(_safe_integer(n) for n in source)
            or source[0] < 0 or source[1] < 0 or source[2] > width or source[3] > height
            or source[2] <= source[0] or source[3] <= source[1]):
        return None
    expected = {'x': source[0] / width, 'y': 1 - source[3] / height,
                'width': (source[2] - source[0]) / width, 'height': (source[3] - source[1]) / height}
    return source if all(abs(fragment['bbox'][key] - expected[key]) < 1e-9 for key in _BOX_KEYS) else None


def derive_matrix_fact_selector(fact: Any, text_artifact: Any) -> dict[str, Any] | None:
    """Mirror API selector fields. Caller must load an independently validated immutable origin.

    Object/manifest, review/entity, flags, parameter codes, observation ID and origin run refs
    are excluded. Array order and every raw string are preserved. Artifact hash covers the
    entire artifact, including all page geometry and unselected original text.
    """
    if type(fact) is not dict or type(text_artifact) is not dict:
        return None
    for key, maximum in [('sourceFileId', 200), ('attribute', 100), ('value', 1000), ('unit', 100),
                       ('rawValue', 1000), ('rawText', 100000), ('extractorVersion', 200)]:
        if not _string(fact.get(key), maximum):
            return None
    if 'rawUnit' not in fact or not (_string(fact.get('rawUnit'), 100) or (fact.get('rawUnit') is None
            and fact.get('attribute') == 'WORKING_REINFORCEMENT_CLASS'
            and fact.get('unit') == 'rebar_catalog_example')):
        return None
    if (type(fact.get('id')) is not str or not _HASH.fullmatch(fact['id'])
            or type(fact.get('sourceSha256')) is not str or not _HASH.fullmatch(fact['sourceSha256'])
            or fact.get('stage') not in ('PD', 'RD', 'ID', 'UNRESOLVED') or fact.get('method') != 'TEXT_LAYER'
            or not _safe_integer(fact.get('pageNumber')) or fact['pageNumber'] <= 0
            or not _string(fact.get('blockId'), 40) or not _BLOCK_ID.fullmatch(fact['blockId'])
            or not _valid_box(fact.get('bbox'))):
        return None
    fragments, contexts = fact.get('evidenceFragments'), fact.get('contextFragments')
    if (type(fragments) is not list or not 1 <= len(fragments) <= 100
            or not all(_valid_fragment(part) for part in fragments)
            or ('contextFragments' in fact and (type(contexts) is not list or not 1 <= len(contexts) <= 8
                                               or not all(_valid_fragment(part, context=True) for part in contexts)))):
        return None
    if (fact.get('attribute') not in ('WORKING_REINFORCEMENT_CLASS', 'CONCRETE_CLASS')
            and any(part['role'] == 'MATERIAL_SCOPE' for part in contexts or [])):
        return None
    if (text_artifact.get('schemaVersion') not in ('document-text-v1', 'document-text-v2')
            or text_artifact.get('coordinateSystem') != 'PDF_BOTTOM_LEFT_MILLI_POINTS'
            or text_artifact.get('sourceFileId') != fact['sourceFileId']
            or text_artifact.get('inputSha256') != fact['sourceSha256']):
        return None
    pages = text_artifact.get('pages')
    if type(pages) is not list or any(type(page) is not dict for page in pages):
        return None
    page_numbers = [page.get('pageNumber') for page in pages]
    if (any(not _safe_integer(number) or number < 1 for number in page_numbers)
            or len(set(page_numbers)) != len(page_numbers)):
        return None
    boxes = [_source_box(part, fact['pageNumber'], pages) for part in fragments]
    if (any(box is None for box in boxes) or fact['blockId'] != fragments[0]['blockId']
            or fact['rawText'] != ' '.join(part['rawText'] for part in fragments)
            or any(_source_box(part, part['pageNumber'], pages) is None for part in contexts or [])):
        return None
    page = next(page for page in pages if page['pageNumber'] == fact['pageNumber'])
    if fact['attribute'] == 'WORKING_REINFORCEMENT_CLASS' and not _valid_rebar_source_binding(fact, page):
        return None
    if is_concrete_prose_fact(fact) and not _valid_concrete_source_binding(fact, page, pages):
        return None
    width, height = page['widthMilliPoints'], page['heightMilliPoints']
    union = {'x': min(box[0] for box in boxes) / width, 'y': 1 - max(box[3] for box in boxes) / height,
             'width': (max(box[2] for box in boxes) - min(box[0] for box in boxes)) / width,
             'height': (max(box[3] for box in boxes) - min(box[1] for box in boxes)) / height}
    if any(abs(fact['bbox'][key] - union[key]) >= 1e-9 for key in _BOX_KEYS):
        return None
    try:
        selector = {'schemaVersion': 'matrix-fact-selector-v1', **{key: fact[key] for key in _SELECTOR_FIELDS},
                    **({'contextFragments': contexts} if contexts is not None else {}),
                    'textArtifactHash': portable_evidence_hash(text_artifact)}
        portable_evidence_json(selector)
        return selector
    except (TypeError, ValueError):
        return None


def _valid_rebar_source_binding(fact: dict[str, Any], page: dict[str, Any]) -> bool:
    """Reconstruct categorical declaration and its full applicability from the source."""
    if (fact.get('unit') != 'rebar_catalog_example' or fact.get('parameterCodes') != ['KR-057']
            or any(key in fact for key in ('applicationScope', 'workingRole',
                'reinforcementApplicationScope', 'componentKey', 'zoneKey'))):
        return False
    candidates = extract_rebar_candidates(page, fact['stage'])
    if len(candidates) != 1:
        return False
    candidate = candidates[0]
    width, height = page['widthMilliPoints'], page['heightMilliPoints']
    def fragment(part: dict[str, Any]) -> dict[str, Any]:
        box = part['bboxMilliPoints']
        return {'blockId': f"{part['blockIndex']}:{part['lineIndex']}", 'rawText': part['rawText'],
                'bbox': {'x': box[0] / width, 'y': 1 - box[3] / height,
                         'width': (box[2] - box[0]) / width, 'height': (box[3] - box[1]) / height}}
    primary = [fragment(part) for part in candidate['primaryFragments']]
    contexts = [{'pageNumber': fact['pageNumber'], **fragment(part), 'role': 'MATERIAL_SCOPE'}
                for part in candidate['scopeFragments']]
    return (fact['value'] == candidate['value'] and fact['rawValue'] == candidate['rawValue']
            and fact['rawUnit'] is None and fact['evidenceFragments'] == primary
            and fact.get('contextFragments') == contexts)


def _valid_concrete_source_binding(fact: dict[str, Any], page: dict[str, Any], pages: list[dict[str, Any]]) -> bool:
    """Strictly reconstruct stair concrete and same-artifact cross-page authority.

    Source stage authentication belongs to the immutable origin execution. This
    selector has no source review metadata and never infers that authentication.
    """
    if (fact.get('stage') not in ('PD', 'RD') or fact.get('unit') != 'B_CLASS'
            or fact.get('rawUnit') != 'B_CLASS' or fact.get('parameterCodes') != ['KR-055']
            or any(key in fact for key in ('applicationScope', 'concreteApplicationScope', 'concreteScope',
                'materialClassBasis', 'workingRole', 'componentRole', 'componentKey', 'zoneKey',
                'operatingModeKey', 'measurementBasisKey', 'loadBearing', 'memberIdentity'))):
        return False
    by_number = {part['pageNumber']: part for part in pages}
    previous = by_number.get(page['pageNumber'] - 1) if fact['stage'] == 'PD' else None
    candidates = extract_concrete_candidates(page, fact['stage'], previous)
    if len(candidates) != 1:
        return False
    candidate = candidates[0]
    def fragment(part: dict[str, Any]) -> dict[str, Any]:
        source_page = by_number[part['pageNumber']]
        width, height = source_page['widthMilliPoints'], source_page['heightMilliPoints']
        box = part['bboxMilliPoints']
        return {'blockId': f"{part['blockIndex']}:{part['lineIndex']}", 'rawText': part['rawText'],
                'bbox': {'x': box[0] / width, 'y': 1 - box[3] / height,
                         'width': (box[2] - box[0]) / width, 'height': (box[3] - box[1]) / height}}
    primary = [fragment(part) for part in candidate['primaryFragments']]
    contexts = [{'pageNumber': part['pageNumber'], **fragment(part), 'role': part['role']}
                for part in candidate['contextFragments']]
    return (fact['value'] == candidate['value'] and fact['rawValue'] == candidate['rawValue']
            and fact['evidenceFragments'] == primary and fact.get('contextFragments') == contexts)


def derive_matrix_fact_target(fact: Any, text_artifact: Any) -> dict[str, str] | None:
    selector = derive_matrix_fact_selector(fact, text_artifact)
    if selector is None:
        return None
    return {'observationId': fact['id'], 'evidenceHash': portable_evidence_hash(selector),
            'textArtifactHash': selector['textArtifactHash'],
            **({'fragmentsHash': portable_evidence_hash(selector['contextFragments'])}
               if 'contextFragments' in selector else {})}
