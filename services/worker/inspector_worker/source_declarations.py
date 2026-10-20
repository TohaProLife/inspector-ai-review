"""Immutable source-authored declarations, evidence only and outside rule execution.

Validate complete committed text envelopes before invoking the frozen steel
parser. No observation/parameter/rule/entity/approval or coverage is inferred.
This module owns a separate portable JSON/hash domain; old hashes stay intact.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .steel_prose import EXTRACTOR_VERSION as STEEL_EXTRACTOR_VERSION, extract_steel_candidates

SCHEMA_VERSION = 'matrix-source-declarations-v1'
EXTRACTOR_VERSION = 'matrix-source-declarations-v1'
HASH_POLICY_VERSION = 'matrix-source-declaration-json-v1'
_MAX_SAFE = 2**53 - 1
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_PAGE_KEY = re.compile(r'[1-9][0-9]*\Z')
_STAGES = {'PD', 'RD', 'ID', 'UNRESOLVED'}
_METRICS = {'alphanumericCharacterCount', 'blockCount', 'disallowedControlCharacterCount',
            'nonWhitespaceCharacterCount', 'replacementCharacterCount'}


def _json_tree(value: Any, depth: int = 0, ancestors: frozenset[int] = frozenset()) -> None:
    if depth > 64:
        raise ValueError('source declaration JSON exceeds depth limit')
    if value is None or type(value) is bool:
        return
    if type(value) is int and abs(value) <= _MAX_SAFE:
        return
    if type(value) is str and not any(0xD800 <= ord(c) <= 0xDFFF for c in value):
        return
    if type(value) not in (dict, list) or id(value) in ancestors:
        raise ValueError('source declaration JSON is not portable')
    next_ancestors = ancestors | {id(value)}
    if type(value) is dict:
        if any(type(k) is not str or not k.isascii() for k in value):
            raise ValueError('source declaration JSON keys must be ASCII')
        children = value.values()
    else:
        children = value
    for child in children:
        _json_tree(child, depth + 1, next_ancestors)


def canonical_source_declaration_json(value: Any) -> str:
    _json_tree(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _hash(value: Any) -> str:
    return hashlib.sha256(canonical_source_declaration_json(value).encode('utf-8')).hexdigest()


def source_declaration_id(declaration: dict[str, Any]) -> str:
    if type(declaration) is not dict:
        raise ValueError('invalid source declaration body')
    return _hash({'hashDomain': 'matrix-source-declaration-id-v1',
                  'declaration': {key: value for key, value in declaration.items() if key != 'id'}})


def _string(value: Any) -> bool:
    return (type(value) is str and 0 < len(value) <= 200 and value.strip() == value
            and not any(0xD800 <= ord(c) <= 0xDFFF for c in value))


def _positive(value: Any) -> bool:
    return type(value) is int and 0 < value <= _MAX_SAFE


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is int and 0 <= n <= _MAX_SAFE for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _valid_artifact(artifact: Any) -> bool:
    # Independent complete document-text-v2 validation. Missing/coarse line boxes
    # remain legitimate text artifacts; the narrow parser abstains on such pages.
    if (type(artifact) is not dict
            or set(artifact) != {'schemaVersion', 'sourceFileId', 'inputSha256', 'coordinateSystem',
                                 'pageCount', 'textPageCount', 'qualityPolicyVersion', 'qualitySummary', 'pages'}
            or artifact.get('schemaVersion') != 'document-text-v2'
            or not _string(artifact.get('sourceFileId'))
            or type(artifact.get('inputSha256')) is not str or not _SHA.fullmatch(artifact['inputSha256'])
            or artifact.get('coordinateSystem') != 'PDF_BOTTOM_LEFT_MILLI_POINTS'
            or type(artifact.get('qualityPolicyVersion')) is not str
            or artifact['qualityPolicyVersion'] not in {'text-layer-quality-v1', 'text-layer-quality-v2'}
            or not _positive(artifact.get('pageCount')) or type(artifact.get('pages')) is not list
            or len(artifact['pages']) != artifact['pageCount']):
        return False
    pages = artifact['pages']
    for number, page in enumerate(pages, 1):
        if (type(page) is not dict
                or set(page) != {'pageNumber', 'widthMilliPoints', 'heightMilliPoints', 'blocks', 'quality'}
                or type(page.get('pageNumber')) is not int or page['pageNumber'] != number
                or not _positive(page.get('widthMilliPoints')) or not _positive(page.get('heightMilliPoints'))
                or type(page.get('blocks')) is not list or type(page.get('quality')) is not dict):
            return False
        quality = page['quality']
        if (set(quality) != {'disposition', 'metrics', 'reasonCodes'}
                or type(quality.get('disposition')) is not str
                or quality['disposition'] not in {'TEXT_LAYER_CANDIDATE', 'OCR_REQUIRED'}
                or type(quality.get('metrics')) is not dict or set(quality['metrics']) != _METRICS
                or any(type(n) is not int or not 0 <= n <= _MAX_SAFE for n in quality['metrics'].values())
                or type(quality.get('reasonCodes')) is not list
                or any(type(code) is not str for code in quality['reasonCodes'])):
            return False
        for block in page['blocks']:
            if (type(block) is not dict
                    or set(block) not in ({'text', 'bboxMilliPoints'},
                                          {'text', 'bboxMilliPoints', 'lineBboxesMilliPoints'})
                    or type(block.get('text')) is not str
                    or not _box(block.get('bboxMilliPoints'), page['widthMilliPoints'], page['heightMilliPoints'])):
                return False
            if 'lineBboxesMilliPoints' in block:
                boxes = block['lineBboxesMilliPoints']
                if (type(boxes) is not list or len(boxes) != len(block['text'].split('\n'))
                        or any(not _box(box, page['widthMilliPoints'], page['heightMilliPoints']) for box in boxes)):
                    return False
    expected_summary = {'textLayerCandidatePageCount': sum(p['quality']['disposition'] == 'TEXT_LAYER_CANDIDATE' for p in pages),
                        'ocrRequiredPageCount': sum(p['quality']['disposition'] == 'OCR_REQUIRED' for p in pages)}
    summary = artifact.get('qualitySummary')
    return (type(artifact.get('textPageCount')) is int
            and artifact['textPageCount'] == sum(bool(p['blocks']) for p in pages)
            and type(summary) is dict and set(summary) == set(expected_summary)
            and all(type(n) is int for n in summary.values()) and summary == expected_summary)


def _source(source: Any, object_id: str) -> tuple[str, str, list[str], dict[str, str]]:
    # Only canonical trusted fields are consumed; existing source metadata extras
    # are deliberately accepted, never included in the declaration hash body.
    if (type(source) is not dict or not _string(source.get('sourceFileId'))
            or type(source.get('sha256')) is not str or not _SHA.fullmatch(source['sha256'])
            or type(source.get('stages')) is not list
            or any(type(stage) is not str or stage not in _STAGES for stage in source['stages'])
            or len(source['stages']) != len(set(source['stages']))
            or source.get('objectId', object_id) != object_id):
        raise ValueError('invalid source declaration source metadata')
    page_stages = source.get('pageStages', {})
    if (type(page_stages) is not dict
            or any(type(key) is not str or not _PAGE_KEY.fullmatch(key) or len(key) > 16
                   or not _positive(int(key)) or type(stage) is not str or stage not in _STAGES
                   for key, stage in page_stages.items())):
        raise ValueError('invalid source declaration page stages')
    return source['sourceFileId'], source['sha256'], source['stages'], page_stages


def extract_source_declarations(input: Any) -> dict[str, Any]:
    """Extract immutable evidence over trusted sources and full committed artifacts.

    Missing artifacts produce no evidence. Malformed supplied artifacts, orphan
    or duplicate IDs, source SHA/object mismatch fail the configured stage.
    Caller authenticates bytes and maps reviewed pageStages to top-level fields.
    No source approval or section change is performed by this module.
    """
    if (type(input) is not dict or set(input) != {'objectId', 'inputManifestHash', 'sources', 'textArtifacts'}
            or not _string(input.get('objectId'))
            or type(input.get('inputManifestHash')) is not str or not _SHA.fullmatch(input['inputManifestHash'])
            or type(input.get('sources')) is not list or type(input.get('textArtifacts')) is not list):
        raise ValueError('invalid source declaration input')
    object_id = input['objectId']
    sources = {}
    for source in input['sources']:
        sid, sha, stages, page_stages = _source(source, object_id)
        if sid in sources:
            raise ValueError('duplicate source declaration source ID')
        sources[sid] = (sha, stages, page_stages)
    artifacts = {}
    for artifact in input['textArtifacts']:
        # Canonical portability validates every supplied artifact, even sources
        # later excluded by stage; malformed evidence cannot disappear silently.
        _json_tree(artifact)
        if not _valid_artifact(artifact):
            raise ValueError('invalid source declaration text artifact')
        sid = artifact['sourceFileId']
        if sid not in sources or sid in artifacts:
            raise ValueError('unknown or duplicate source declaration artifact ID')
        if artifact['inputSha256'] != sources[sid][0]:
            raise ValueError('source declaration artifact differs from source SHA')
        if any(int(key) > artifact['pageCount'] for key in sources[sid][2]):
            raise ValueError('source declaration page stage outside artifact')
        artifacts[sid] = artifact
    result = {'schemaVersion': SCHEMA_VERSION, 'objectId': object_id,
              'inputManifestHash': input['inputManifestHash'], 'extractorVersion': EXTRACTOR_VERSION,
              'purpose': 'EVIDENCE_ONLY', 'declarations': []}
    for sid, (sha, stages, page_stages) in sources.items():
        if sid not in artifacts or len(stages) != 1 or stages[0] not in {'PD', 'RD'}:
            continue
        stage = stages[0]
        if any(value != stage for value in page_stages.values()):
            continue
        artifact = artifacts[sid]
        text_hash = _hash({'hashDomain': 'matrix-source-declaration-text-artifact-v1', 'textArtifact': artifact})
        for page in artifact['pages']:
            for candidate in extract_steel_candidates(page, stage):
                body = {'schemaVersion': 'matrix-source-declaration-v1',
                        'kind': 'SOURCE_AUTHORED_STEEL_DECLARATION', 'extractorVersion': STEEL_EXTRACTOR_VERSION,
                        'sourceFileId': sid, 'sourceSha256': sha, 'textArtifactHash': text_hash, 'stage': stage,
                        'pageNumber': page['pageNumber'], 'widthMilliPoints': page['widthMilliPoints'],
                        'heightMilliPoints': page['heightMilliPoints'], 'entityKey': None,
                        'applicabilityStatus': 'UNREVIEWED', **candidate}
                result['declarations'].append({'id': source_declaration_id(body), **body})
    result['declarations'].sort(key=lambda declaration: (
        declaration['sourceFileId'], declaration['pageNumber'], declaration['id']))
    return result


def validate_source_declarations(raw: Any, input: Any) -> dict[str, Any] | None:
    """Reconstruct expected evidence; valid-looking/rehashed worker claims untrusted.

    Invalid trusted inputs still raise ValueError. A malformed or forged supplied
    sibling returns None. No unknown fields or missing declarations are ignored.
    """
    expected = extract_source_declarations(input)
    try:
        return expected if canonical_source_declaration_json(raw) == canonical_source_declaration_json(expected) else None
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None
