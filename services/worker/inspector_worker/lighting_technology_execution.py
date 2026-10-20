"""Typed lighting execution over complete immutable supplied v3 projections.

Hashes establish DTO consistency here. Authentication of actors, sealed origin
runs, manifest membership and original PDF bytes belongs to the protected loader.
The legacy scalar engine, profiles and source/comparator modules are unchanged.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any

from . import lighting_technology_comparison as c
from .document_text_v3 import _native, _canonical, read_document_text_v3_artifact
from .lighting_technology_source_v3 import (
    reconstruct_lighting_technology_source_v3,
    lighting_technology_v3_declaration_content_hash,
)

_RULE = 'matrix-zu-130-declared_led_technology_replacement'
_COMMON = {'schemaVersion': 'matrix-lighting-technology-execution-result-v1',
           'ruleId': _RULE, 'ruleVersion': '1', 'parameterCode': 'ZU-130', 'comparisonVariant': 'PD_RD'}
_INTEGRITY = {'INVALID_INPUT','INPUT_LIMIT','SOURCE_PROVENANCE_UNVERIFIED','DECLARATION_RECONSTRUCTION_UNVERIFIED'}
_OPERATIONAL = {'SOURCE_STAGE_UNVERIFIED','POSITION_IDENTITY_CONFLICT','AMBIGUOUS_DECLARATION_SCOPE',
                'MATCHED_DECLARATION_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED',
                'LINK_SCOPE_UNVERIFIED','NAMED_POSITION_UNVERIFIED','POSITION_MAPPING_UNVERIFIED','DIRECTED_TRANSITION_UNSUPPORTED'}
_RESOURCE = Path(__file__).parent.parent / 'rules'
_REGISTRY_JSON = _canonical(json.loads((_RESOURCE / 'matrix-lighting-technology-capabilities-v1.json').read_text()))
LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY = json.loads(_REGISTRY_JSON)
LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY_HASH = hashlib.sha256(_REGISTRY_JSON.encode('utf-8')).hexdigest()
_DEFAULT_REGISTRY = object()
_SCALAR_ENTRIES = json.loads((_RESOURCE / 'matrix-execution-v1.json').read_text())['entries']
_SCALAR_CODES = tuple(row['parameterCode'] for row in _SCALAR_ENTRIES)
_SCALAR_RULE_IDS = frozenset(rule['ruleId'] for row in _SCALAR_ENTRIES for rule in row['atomicRules'])
_COUNTERS = {'implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'}


def _fail(reason: str = 'INVALID_INPUT') -> None:
    raise ValueError(reason)


def _registry(value: Any) -> None:
    if value is _DEFAULT_REGISTRY:
        return
    _native(value)
    if _canonical(value) != _REGISTRY_JSON:
        _fail('INVALID_CAPABILITY_REGISTRY')


def _identity_list(sources: list) -> list:
    unique = {_canonical(claim['identity']): claim['identity'] for source in sources for claim in c._claims(source)}
    return [deepcopy(unique[key]) for key in sorted(unique)]


def _sources(sources: Any, object_id: str | None = None) -> None:
    if type(sources) is not list:
        _fail()
    if len(sources) > 64:
        _fail('INPUT_LIMIT')
    if not all(c._source(source) for source in sources):
        _fail()
    seen, total = set(), 0
    for source in sources:
        sid = source['sourceFileId']
        if sid in seen or len(set(source['stages'])) != len(source['stages']):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        seen.add(sid)
        review, pointer = source['review'], source['reviewSnapshot']
        if (review is None) != (pointer is None):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        if review is not None:
            if (review['sourceFileId'] != sid or review['sourceSha256'] != source['sourceSha256']
                    or review['decisionId'] != pointer['decisionId'] or review['contentHash'] != pointer['contentHash']
                    or object_id is not None and review['objectId'] != object_id):
                _fail('SOURCE_PROVENANCE_UNVERIFIED')
            scope = review['lightingTechnologyScope']
            if scope is not None:
                if c.project_lighting_technology_scope_decision(scope) is None:
                    _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
                for claim in scope['claims']:
                    snap = claim['declarationSnapshot']
                    if snap['sourceFileId'] != sid or snap['sourceSha256'] != source['sourceSha256']:
                        _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
        total += len(c._claims(source))
        if total > 128:
            _fail('INPUT_LIMIT')


def derive_lighting_technology_identities(sources: Any) -> list:
    """Enumerate detached complete identities from all structurally valid claims."""
    _native(sources)
    _sources(sources)
    return _identity_list(sources)


def validate_lighting_technology_loader_package(value: Any) -> dict:
    _native(value)
    if c._caps(value):
        _fail('INPUT_LIMIT')
    if (not c._exact(value, {'schemaVersion','objectId','inputManifestHash','sources','origins','identities'})
            or value['schemaVersion'] != 'matrix-zu130-lighting-technology-loader-inputs-v1'
            or not c._key(value['objectId']) or not c._sha(value['inputManifestHash'])
            or type(value['origins']) is not list or type(value['identities']) is not list):
        _fail()
    if len(value['origins']) > 128 or len(value['identities']) > 128:
        _fail('INPUT_LIMIT')
    _sources(value['sources'], value['objectId'])
    if not all(c._identity(identity) for identity in value['identities']):
        _fail()
    if value['identities'] != _identity_list(value['sources']):
        _fail('IDENTITY_PROJECTION_MISMATCH')
    sources = {source['sourceFileId']: source for source in value['sources']}
    origins = {}
    # Whole retained origin validation is independent of current stage eligibility.
    for origin in value['origins']:
        if not c._origin(origin):
            _fail()
        key = (origin['sourceFileId'], origin['checkId'])
        source = sources.get(origin['sourceFileId'])
        if (key in origins or source is None or origin['objectId'] != value['objectId']
                or origin['sourceSha256'] != source['sourceSha256']):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        artifact = origin['textArtifact']
        read = read_document_text_v3_artifact(artifact)
        if read['status'] != 'VALID':
            _fail('INPUT_LIMIT' if read['reasonCode'] == 'INPUT_LIMIT' else 'SOURCE_PROVENANCE_UNVERIFIED')
        if (artifact['sourceFileId'] != origin['sourceFileId'] or artifact['inputSha256'] != origin['sourceSha256']
                or read['contentHash'] != origin['textArtifactHash']
                or hashlib.sha256(_canonical(artifact).encode('utf-8')).hexdigest() != origin['textStageContentHash']):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        review = source['review']
        if review is not None and any(int(page) > artifact['pageCount'] for page in review['pageStages']):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key] = origin
    # EVERY immutable claim is reconstructed even when a different retained
    # claim would cause comparator gate5 to return an operational stage refusal.
    # Snapshot.stage is reconstruction metadata, never current stage authority.
    for source in value['sources']:
        for claim in c._claims(source):
            target, snap = claim['target'], claim['declarationSnapshot']
            origin = origins.get((source['sourceFileId'], target['checkId']))
            if origin is None or any(target[k] != origin[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):
                _fail('SOURCE_PROVENANCE_UNVERIFIED')
            rebuilt = reconstruct_lighting_technology_source_v3({
                'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sourceSha256'],
                'stage': snap['stage'], 'pageStages': source['review']['pageStages'],
                'textArtifact': origin['textArtifact'], 'selection': claim['selection']})
            if (rebuilt['status'] != 'RECONSTRUCTED' or rebuilt['declaration'] != snap
                    or lighting_technology_v3_declaration_content_hash(rebuilt['declaration']) != target['declarationContentHash']):
                _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
    return deepcopy(value)


def _result_id(envelope: dict, body: dict) -> str:
    return hashlib.sha256(_canonical({'hashDomain':'matrix-lighting-technology-execution-result-id-v1',
        'objectId':envelope['objectId'], 'inputManifestHash':envelope['inputManifestHash'],
        'capabilityRegistryHash':envelope['capabilityRegistryHash'], 'result':body}).encode('utf-8')).hexdigest()


def build_lighting_technology_comparisons(value: Any, registry: Any = _DEFAULT_REGISTRY) -> dict:
    _registry(registry)
    package = validate_lighting_technology_loader_package(value)
    envelope = {'schemaVersion':'matrix-lighting-technology-comparisons-v1', 'purpose':'MACHINE_COMPARISON',
                'objectId':package['objectId'], 'inputManifestHash':package['inputManifestHash'],
                'capabilityRegistryHash':LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY_HASH, 'results':[]}
    for identity in package['identities']:
        comparison = c.compare_zu130_lighting_technologies({
            'schemaVersion':'matrix-zu130-lighting-technology-comparison-input-v1',
            'objectId':package['objectId'], 'inputManifestHash':package['inputManifestHash'],
            'identity':identity, 'sources':package['sources'], 'origins':package['origins']})
        if comparison['status'] == 'ABSTAIN' and comparison['reasonCode'] in _INTEGRITY:
            _fail(comparison['reasonCode'])
        body = {**_COMMON, 'kind':'SCOPED_COMPARISON', 'identity':identity, 'comparison':comparison}
        envelope['results'].append({'id':_result_id(envelope, body), **body})
    if not envelope['results']:
        body = {**_COMMON, 'kind':'UNBOUND_ATOM_ABSTENTION',
                'reasonCode':'REVIEWED_LIGHTING_POSITION_IDENTITY_MISSING', 'calibratedProbability':None}
        envelope['results'].append({'id':_result_id(envelope, body), **body})
    return envelope


def _reference(value: Any) -> bool:
    return (c._exact(value, {'sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','declarationContentHash'})
            and c._key(value['sourceFileId']) and c._key(value['reviewDecisionId'])
            and all(c._sha(value[k]) for k in ('sourceSha256','reviewContentHash','declarationContentHash')))


def _comparison(value: Any, identity: dict) -> bool:
    if type(value) is not dict:
        return False
    if value.get('status') == 'ABSTAIN':
        return (c._exact(value, {'schemaVersion','status','reasonCode','calibratedProbability'})
                and value['schemaVersion'] == c._SCHEMA and c._enum(value['reasonCode'], _OPERATIONAL)
                and value['calibratedProbability'] is None)
    return (c._exact(value, {'schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode',
                            'calibratedProbability','comparisonScope','identity','expected','actual','expectedTechnology','actualTechnology'})
            and value['schemaVersion'] == c._SCHEMA and value['status'] == 'CANDIDATE'
            and value['ruleId'] == _RULE and value['ruleVersion'] == '1' and value['parameterCode'] == 'ZU-130'
            and value['reasonCode'] == 'LED_REPLACED_BY_FLUORESCENT_OR_INCANDESCENT'
            and value['calibratedProbability'] is None
            and value['comparisonScope'] == 'REVIEWED_NAMED_LUMINAIRE_LIGHT_SOURCE_POSITION_ONLY'
            and value['identity'] == identity and _reference(value['expected']) and _reference(value['actual'])
            and value['expected']['sourceFileId'] != value['actual']['sourceFileId']
            and value['expected']['sourceSha256'] != value['actual']['sourceSha256']
            and value['expectedTechnology'] == 'LED' and c._enum(value['actualTechnology'], {'FLUORESCENT','INCANDESCENT'}))


def validate_lighting_technology_comparisons(value: Any) -> dict:
    _native(value)
    if (not c._exact(value, {'schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'})
            or value['schemaVersion'] != 'matrix-lighting-technology-comparisons-v1'
            or value['purpose'] != 'MACHINE_COMPARISON' or not c._key(value['objectId'])
            or not c._sha(value['inputManifestHash'])
            or value['capabilityRegistryHash'] != LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY_HASH
            or type(value['results']) is not list or not 1 <= len(value['results']) <= 128):
        _fail()
    ids, identities = set(), []
    for row in value['results']:
        if type(row) is not dict or any(row.get(k) != expected for k, expected in _COMMON.items()) or not c._sha(row.get('id')):
            _fail()
        if row.get('kind') == 'UNBOUND_ATOM_ABSTENTION':
            if (len(value['results']) != 1 or set(row) != set(_COMMON) | {'id','kind','reasonCode','calibratedProbability'}
                    or row['reasonCode'] != 'REVIEWED_LIGHTING_POSITION_IDENTITY_MISSING' or row['calibratedProbability'] is not None):
                _fail()
        elif row.get('kind') == 'SCOPED_COMPARISON':
            if (set(row) != set(_COMMON) | {'id','kind','identity','comparison'}
                    or not c._identity(row['identity']) or not _comparison(row['comparison'], row['identity'])):
                _fail()
            identities.append(_canonical(row['identity']))
        else:
            _fail()
        body = {key: item for key, item in row.items() if key != 'id'}
        if row['id'] in ids or _result_id(value, body) != row['id']:
            _fail('RESULT_ID_MISMATCH')
        ids.add(row['id'])
    if identities != sorted(set(identities)):
        _fail('IDENTITY_ORDER_MISMATCH')
    return deepcopy(value)


def lighting_technology_comparison_evidence(value: Any, envelope: Any, registry: Any = _DEFAULT_REGISTRY) -> list:
    _native(envelope)
    expected = build_lighting_technology_comparisons(value, registry)
    if expected != envelope:
        _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
    output = []
    for row in expected['results']:
        if row['kind'] != 'SCOPED_COMPARISON' or row['comparison']['status'] != 'CANDIDATE':
            continue
        for role, key in (('EXPECTED','expected'), ('ACTUAL','actual')):
            ref = row['comparison'][key]
            matches = [(source, claim) for source in value['sources'] for claim in c._claims(source)
                       if claim['identity'] == row['identity'] and source['sourceFileId'] == ref['sourceFileId']
                       and source['sourceSha256'] == ref['sourceSha256']
                       and source['review']['decisionId'] == ref['reviewDecisionId']
                       and source['review']['contentHash'] == ref['reviewContentHash']
                       and claim['target']['declarationContentHash'] == ref['declarationContentHash']]
            if len(matches) != 1:
                _fail('SOURCE_PROVENANCE_UNVERIFIED')
            source, claim = matches[0]
            snap = claim['declarationSnapshot']
            for fragment in snap['primaryFragments']:
                output.append({'resultId':row['id'], 'role':role, **ref, 'originCheckId':claim['target']['checkId'],
                    'pageNumber':snap['pageNumber'],
                    'pageFrame':{'widthMilliPoints':snap['pageWidthMilliPoints'], 'heightMilliPoints':snap['pageHeightMilliPoints']},
                    'nativeFrame':deepcopy(snap['nativeFrame']), 'fragmentRole':'PRIMARY', 'fragment':deepcopy(fragment)})
    return output


def merge_lighting_technology_coverage(coverage: Any, envelope: Any, registry: Any = _DEFAULT_REGISTRY) -> list:
    _registry(registry)
    _native(coverage)
    validated = validate_lighting_technology_comparisons(envelope)
    if type(coverage) is not list or len(coverage) != 132 or len(_SCALAR_CODES) != 132 or _RULE in _SCALAR_RULE_IDS:
        _fail()
    for index, row in enumerate(coverage):
        if (not c._exact(row, _COUNTERS | {'parameterCode','executionStatus','reason'})
                or row['parameterCode'] != _SCALAR_CODES[index]
                or not all(c._integer(row[k]) for k in _COUNTERS)
                or not c._enum(row['executionStatus'], {'UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'})
                or type(row['reason']) is not str):
            _fail()
    index = _SCALAR_CODES.index('ZU-130')
    if coverage[index]['executionStatus'] != 'UNSUPPORTED' or any(coverage[index][key] != 0 for key in _COUNTERS):
        _fail('COVERAGE_TARGET_OVERLAP')
    output = deepcopy(coverage)
    successes = sum(row['kind'] == 'SCOPED_COMPARISON' and row['comparison']['status'] == 'CANDIDATE'
                    for row in validated['results'])
    output[index] = {'parameterCode':'ZU-130', 'implementedAtomicRules':1, 'enabledAtomicRules':1, 'evaluatedAtomicRules':1,
        'successfulComparisons':successes, 'abstentions':len(validated['results']) - successes, 'failures':0,
        'executionStatus':'PARTIAL', 'reason':json.loads(_REGISTRY_JSON)['entries'][0]['partialGap']}
    return output
