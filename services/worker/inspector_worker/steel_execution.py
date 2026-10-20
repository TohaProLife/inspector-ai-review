"""KR056 typed overlay over complete retained originals and pair review projections.

Pure hashes establish integrity, not original-byte or professional authority.
Protected loaders authenticate frozen journals, actors, objects and sealed runs.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any
from . import steel_comparison as c

_DTO = {'loaderPackage': {'type': 'object',
                   'additionalProperties': False,
                   'required': ['schemaVersion',
                                'objectId',
                                'inputManifestHash',
                                'sources',
                                'origins',
                                'applicabilityDecisions',
                                'identities'],
                   'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-loader-inputs-v1'},
                                  'objectId': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/key'},
                                  'inputManifestHash': {'type': 'string',
                                                        'pattern': '^[a-f0-9]{64}$',
                                                        'minLength': 64,
                                                        'maxLength': 64},
                                  'sources': {'type': 'array',
                                              'minItems': 0,
                                              'maxItems': 64,
                                              'items': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/source'}},
                                  'origins': {'type': 'array',
                                              'minItems': 0,
                                              'maxItems': 128,
                                              'items': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/origin'}},
                                  'applicabilityDecisions': {'type': 'array',
                                                             'minItems': 0,
                                                             'maxItems': 16,
                                                             'items': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/applicabilityDecision'}},
                                  'identities': {'type': 'array',
                                                 'minItems': 0,
                                                 'maxItems': 128,
                                                 'items': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/identity'}}}},
 'executionResult': {'oneOf': [{'type': 'object',
                                'additionalProperties': False,
                                'required': ['schemaVersion',
                                             'id',
                                             'ruleId',
                                             'ruleVersion',
                                             'parameterCode',
                                             'comparisonVariant',
                                             'kind',
                                             'identity',
                                             'comparison'],
                                'properties': {'schemaVersion': {'const': 'matrix-steel-execution-result-v1'},
                                               'id': {'type': 'string',
                                                      'pattern': '^[a-f0-9]{64}$',
                                                      'minLength': 64,
                                                      'maxLength': 64},
                                               'ruleId': {'const': 'matrix-kr-056-reviewed_steel_catalog_transition'},
                                               'ruleVersion': {'const': '1'},
                                               'parameterCode': {'const': 'KR-056'},
                                               'comparisonVariant': {'const': 'PD_RD'},
                                               'kind': {'const': 'SCOPED_COMPARISON'},
                                               'identity': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/identity'},
                                               'comparison': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/result'}}},
                               {'type': 'object',
                                'additionalProperties': False,
                                'required': ['schemaVersion',
                                             'id',
                                             'ruleId',
                                             'ruleVersion',
                                             'parameterCode',
                                             'comparisonVariant',
                                             'kind',
                                             'reasonCode',
                                             'calibratedProbability'],
                                'properties': {'schemaVersion': {'const': 'matrix-steel-execution-result-v1'},
                                               'id': {'type': 'string',
                                                      'pattern': '^[a-f0-9]{64}$',
                                                      'minLength': 64,
                                                      'maxLength': 64},
                                               'ruleId': {'const': 'matrix-kr-056-reviewed_steel_catalog_transition'},
                                               'ruleVersion': {'const': '1'},
                                               'parameterCode': {'const': 'KR-056'},
                                               'comparisonVariant': {'const': 'PD_RD'},
                                               'kind': {'const': 'UNBOUND_ATOM_ABSTENTION'},
                                               'reasonCode': {'const': 'REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING'},
                                               'calibratedProbability': {'const': None}}}]},
 'comparisons': {'type': 'object',
                 'additionalProperties': False,
                 'required': ['schemaVersion',
                              'purpose',
                              'objectId',
                              'inputManifestHash',
                              'capabilityRegistryHash',
                              'results'],
                 'properties': {'schemaVersion': {'const': 'matrix-steel-comparisons-v1'},
                                'purpose': {'const': 'MACHINE_COMPARISON'},
                                'objectId': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/key'},
                                'inputManifestHash': {'type': 'string',
                                                      'pattern': '^[a-f0-9]{64}$',
                                                      'minLength': 64,
                                                      'maxLength': 64},
                                'capabilityRegistryHash': {'type': 'string',
                                                           'pattern': '^[a-f0-9]{64}$',
                                                           'minLength': 64,
                                                           'maxLength': 64},
                                'results': {'type': 'array',
                                            'minItems': 1,
                                            'maxItems': 128,
                                            'items': {'$ref': '#/definitions/executionResult'}}}},
 'evidence': {'type': 'object',
              'additionalProperties': False,
              'required': ['resultId',
                           'role',
                           'sourceFileId',
                           'sourceSha256',
                           'reviewDecisionId',
                           'reviewContentHash',
                           'target',
                           'applicabilityDecisionId',
                           'applicabilityDecisionContentHash',
                           'pageNumber',
                           'pageFrame',
                           'fragmentRole',
                           'fragment'],
              'properties': {'resultId': {'type': 'string',
                                          'pattern': '^[a-f0-9]{64}$',
                                          'minLength': 64,
                                          'maxLength': 64},
                             'role': {'enum': ['EXPECTED', 'ACTUAL']},
                             'sourceFileId': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/key'},
                             'sourceSha256': {'type': 'string',
                                              'pattern': '^[a-f0-9]{64}$',
                                              'minLength': 64,
                                              'maxLength': 64},
                             'reviewDecisionId': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/key'},
                             'reviewContentHash': {'type': 'string',
                                                   'pattern': '^[a-f0-9]{64}$',
                                                   'minLength': 64,
                                                   'maxLength': 64},
                             'target': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/target'},
                             'applicabilityDecisionId': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/key'},
                             'applicabilityDecisionContentHash': {'type': 'string',
                                                                  'pattern': '^[a-f0-9]{64}$',
                                                                  'minLength': 64,
                                                                  'maxLength': 64},
                             'pageNumber': {'type': 'integer', 'minimum': 1, 'maximum': 512},
                             'pageFrame': {'type': 'object',
                                           'additionalProperties': False,
                                           'required': ['widthMilliPoints', 'heightMilliPoints'],
                                           'properties': {'widthMilliPoints': {'type': 'integer',
                                                                               'minimum': 1,
                                                                               'maximum': 9007199254740991},
                                                          'heightMilliPoints': {'type': 'integer',
                                                                                'minimum': 1,
                                                                                'maximum': 9007199254740991}}},
                             'fragmentRole': {'enum': ['PRIMARY',
                                                       'DECLARATION_SCOPE',
                                                       'PHYSICAL_MEMBER_SCOPE',
                                                       'APPLICABILITY_BASIS']},
                             'fragment': {'$ref': 'matrix-steel-comparison.schema.json#/definitions/fragment'}}},
 'coverageRow': {'type': 'object',
                 'additionalProperties': False,
                 'required': ['parameterCode',
                              'implementedAtomicRules',
                              'enabledAtomicRules',
                              'evaluatedAtomicRules',
                              'successfulComparisons',
                              'abstentions',
                              'failures',
                              'executionStatus',
                              'reason'],
                 'properties': {'parameterCode': {'type': 'string', 'minLength': 1, 'maxLength': 120},
                                'implementedAtomicRules': {'type': 'integer',
                                                           'minimum': 0,
                                                           'maximum': 9007199254740991},
                                'enabledAtomicRules': {'type': 'integer',
                                                       'minimum': 0,
                                                       'maximum': 9007199254740991},
                                'evaluatedAtomicRules': {'type': 'integer',
                                                         'minimum': 0,
                                                         'maximum': 9007199254740991},
                                'successfulComparisons': {'type': 'integer',
                                                          'minimum': 0,
                                                          'maximum': 9007199254740991},
                                'abstentions': {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991},
                                'failures': {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991},
                                'executionStatus': {'enum': ['UNSUPPORTED',
                                                             'PARTIAL',
                                                             'EVALUATED',
                                                             'TECHNICAL_FAILURE']},
                                'reason': {'type': 'string', 'maxLength': 2000000}}}}
_COMPARISON_DTO = {'result': {'oneOf': [{'type': 'object',
                       'additionalProperties': False,
                       'required': ['schemaVersion',
                                    'identity',
                                    'calibratedProbability',
                                    'status',
                                    'reasonCode',
                                    'comparison'],
                       'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-comparison-v1'},
                                      'identity': {'$ref': '#/definitions/identity'},
                                      'calibratedProbability': {'const': None},
                                      'status': {'const': 'CANDIDATE'},
                                      'reasonCode': {'const': 'EXPLICIT_C345_TO_C245_IN_REVIEWED_SAME_MEMBER'},
                                      'comparison': {'$ref': '#/definitions/candidateComparison'}}},
                      {'type': 'object',
                       'additionalProperties': False,
                       'required': ['schemaVersion',
                                    'identity',
                                    'calibratedProbability',
                                    'status',
                                    'reasonCode',
                                    'comparison'],
                       'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-comparison-v1'},
                                      'identity': {'anyOf': [{'$ref': '#/definitions/identity'},
                                                             {'type': 'null'}]},
                                      'calibratedProbability': {'const': None},
                                      'status': {'const': 'ABSTAIN'},
                                      'reasonCode': {'enum': ['INVALID_INPUT',
                                                              'INPUT_LIMIT',
                                                              'SOURCE_PROVENANCE_UNVERIFIED',
                                                              'DECLARATION_RECONSTRUCTION_UNVERIFIED',
                                                              'APPLICABILITY_DECISION_UNVERIFIED',
                                                              'REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING',
                                                              'AMBIGUOUS_DECLARATION_SCOPE',
                                                              'DUPLICATE_DECLARATION',
                                                              'SOURCE_STAGE_UNVERIFIED',
                                                              'SOURCE_REVIEW_UNVERIFIED',
                                                              'SOURCE_SECTION_UNVERIFIED',
                                                              'SOURCE_LINK_UNVERIFIED',
                                                              'PHYSICAL_MEMBER_MAPPING_UNVERIFIED',
                                                              'APPLICABILITY_DECISION_MISSING',
                                                              'AMBIGUOUS_APPLICABILITY_DECISION',
                                                              'UNSUPPORTED_CATEGORY_TRANSITION',
                                                              'NEGATIVE_SCOPE_UNVERIFIED']},
                                      'comparison': {'const': None}}}]},
 'candidateComparison': {'type': 'object',
                         'additionalProperties': False,
                         'required': ['scope',
                                      'expected',
                                      'actual',
                                      'expectedValue',
                                      'actualValue',
                                      'applicabilityDecisionId',
                                      'applicabilityDecisionContentHash'],
                         'properties': {'scope': {'const': 'HUMAN_REVIEWED_PHYSICAL_MEMBER_AND_DECLARATION_APPLICABILITY_ONLY'},
                                        'expected': {'$ref': '#/definitions/referencePair'},
                                        'actual': {'$ref': '#/definitions/referencePair'},
                                        'expectedValue': {'const': 'С345'},
                                        'actualValue': {'const': 'С245'},
                                        'applicabilityDecisionId': {'$ref': '#/definitions/key'},
                                        'applicabilityDecisionContentHash': {'$ref': '#/definitions/sha'}}}}

_RULE = 'matrix-kr-056-reviewed_steel_catalog_transition'
_COMMON = {'schemaVersion':'matrix-steel-execution-result-v1', 'ruleId':_RULE,
           'ruleVersion':'1', 'parameterCode':'KR-056', 'comparisonVariant':'PD_RD'}
_INTEGRITY = {'INVALID_INPUT','INPUT_LIMIT','SOURCE_PROVENANCE_UNVERIFIED',
              'DECLARATION_RECONSTRUCTION_UNVERIFIED','DUPLICATE_DECLARATION'}
_COUNTERS = {'implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules',
             'successfulComparisons','abstentions','failures'}
_RESOURCE = Path(__file__).parent.parent / 'rules'
_REGISTRY_JSON = c._canonical(json.loads((_RESOURCE/'matrix-steel-comparison-capabilities-v1.json').read_text()))
STEEL_COMPARISON_CAPABILITY_REGISTRY = json.loads(_REGISTRY_JSON)
STEEL_COMPARISON_CAPABILITY_REGISTRY_HASH = hashlib.sha256(_REGISTRY_JSON.encode()).hexdigest()
_DEFAULT = object()
_SCALAR_ENTRIES = json.loads((_RESOURCE/'matrix-execution-v1.json').read_text())['entries']
_CODES = tuple(row['parameterCode'] for row in _SCALAR_ENTRIES)
_SCALAR_IDS = frozenset(rule['ruleId'] for row in _SCALAR_ENTRIES for rule in row['atomicRules'])


def _fail(reason: str = 'INVALID_INPUT') -> None:
    raise ValueError(reason)


def _shape(value: Any, schema: dict) -> bool:
    """Structural pinned DTOs; full original semantics are checked separately."""
    if '$ref' in schema:
        name = schema['$ref'].split('/')[-1]
        if schema['$ref'].startswith('matrix-steel-comparison.schema.json'):
            return _shape(value, _COMPARISON_DTO[name]) if name in _COMPARISON_DTO else c._dto(value, name)
        if name in _DTO:
            return _shape(value, _DTO[name])
        return _shape(value, _COMPARISON_DTO[name]) if name in _COMPARISON_DTO else c._dto(value, name)
    if 'oneOf' in schema and sum(_shape(value, part) for part in schema['oneOf']) != 1:
        return False
    if 'anyOf' in schema and not any(_shape(value, part) for part in schema['anyOf']):
        return False
    if 'const' in schema and not c._equal(value, schema['const']):
        return False
    if 'enum' in schema and not any(c._equal(value, item) for item in schema['enum']):
        return False
    if schema.get('type') == 'object':
        if type(value) is not dict or not set(schema.get('required', [])).issubset(value):
            return False
        props = schema.get('properties', {})
        return all((_shape(item, props[key]) if key in props else schema.get('additionalProperties') is not False)
                   for key, item in value.items())
    if schema.get('type') == 'array':
        return (type(value) is list and schema.get('minItems',0) <= len(value) <= schema.get('maxItems',32768)
                and all(_shape(item, schema.get('items',{})) for item in value))
    return c._struct(value, {key:item for key,item in schema.items() if key not in {'oneOf','anyOf'}})


def _registry(value: Any) -> None:
    if _RULE in _SCALAR_IDS:
        _fail('CAPABILITY_REGISTRY_OVERLAP')
    if value is _DEFAULT:
        return
    c._native_input(value)
    if c._canonical(value) != _REGISTRY_JSON:
        _fail('INVALID_CAPABILITY_REGISTRY')


def _identities(sources: list) -> list:
    distinct = {c._canonical(claim['identity']):claim['identity'] for source in sources for claim in c._claims(source)}
    return [deepcopy(distinct[key]) for key in sorted(distinct)]


def _sources(sources: Any, object_id: str | None = None) -> None:
    if type(sources) is not list:
        _fail()
    if len(sources) > 64:
        _fail('INPUT_LIMIT')
    seen, objects, total = set(), set(), 0
    for source in sources:
        if not c._dto(source, 'source'):
            _fail()
        if source['sourceFileId'] in seen:
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        seen.add(source['sourceFileId']); objects.add(source['objectId'])
        if object_id is not None and source['objectId'] != object_id:
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        claims = c._claims(source)
        if len(claims) > 16:
            _fail('INPUT_LIMIT')
        total += len(claims)
        if total > 128:
            _fail('INPUT_LIMIT')
        declaration_ids = [claim['target']['declarationId'] for claim in claims]
        if len(declaration_ids) != len(set(declaration_ids)):
            _fail('DUPLICATE_DECLARATION')
        for claim in claims:
            snapshot = claim['declarationSnapshot']
            if (snapshot['sourceFileId'] != source['sourceFileId'] or snapshot['sourceSha256'] != source['sourceSha256']
                    or not c._snapshot_local(claim)):
                _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
    if len(objects) > 1:
        _fail('SOURCE_PROVENANCE_UNVERIFIED')


def derive_steel_comparison_identities(sources: Any) -> list:
    c._native_input(sources)
    _sources(sources)
    return _identities(sources)


def _retained(value: dict) -> None:
    """Independent all-retained prepass: no identity sentinel or diagnostic filter."""
    sources = {source['sourceFileId']:source for source in value['sources']}
    origins = {}
    for origin in value['origins']:
        sid, target, artifact = origin['sourceFileId'], origin['target'], origin['textArtifact']
        key = (sid, c._canonical(target))
        if (sid not in sources or sources[sid]['sourceSha256'] != origin['sourceSha256'] or key in origins
                or artifact['sourceFileId'] != sid or artifact['inputSha256'] != origin['sourceSha256']
                or c._hash(artifact) != origin['artifactContentSha256']
                or target['textStageContentHash'] != origin['artifactContentSha256']
                or target['textArtifactHash'] != c._hash({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact})):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        review, bound = sources[sid]['review'], str(artifact['pageCount'])
        if review is not None and any(len(page)>len(bound) or len(page)==len(bound) and page>bound for page in review['pageStages']):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key] = origin
    rebuilt = {}
    for key, origin in origins.items():
        try:
            reconstructed = c.extract_source_declarations({'objectId':value['objectId'],
                'inputManifestHash':origin['target']['inputManifestHash'],
                'sources':[{'sourceFileId':origin['sourceFileId'],'sha256':origin['sourceSha256'],
                            'stages':origin['stages'],'pageStages':origin['pageStages']}],
                'textArtifacts':[origin['textArtifact']]})
            rebuilt[key] = reconstructed['declarations']
        except (ValueError,TypeError,UnicodeError,RecursionError):
            _fail('SOURCE_PROVENANCE_UNVERIFIED')
    entries = []
    for source in value['sources']:
        for claim in c._claims(source):
            key = (source['sourceFileId'],c._canonical(c._target4(claim['target'])))
            origin, snapshot = origins.get(key), claim['declarationSnapshot']
            if (origin is None or not any(c._equal(snapshot,d) for d in rebuilt[key])
                    or claim['target']['declarationId'] != snapshot['id']
                    or not all(c._fragment_matches(f,origin['textArtifact']) for f in claim['memberMapping']['scopeFragments'])):
                _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
            entries.append((source,claim,origin))
    seen = set()
    for decision in value['applicabilityDecisions']:
        if (decision['decisionId'] in seen or decision['objectId'] != value['objectId']
                or decision['contentHash'] != c._hash({'hashDomain':c._DOMAIN,
                    'decision':{key:item for key,item in decision.items() if key!='contentHash'}})):
            _fail('APPLICABILITY_DECISION_UNVERIFIED')
        seen.add(decision['decisionId'])
        for role, scope, stage in [('expected','expectedScopeFragments','PD'),('actual','actualScopeFragments','RD')]:
            matches = [(s,cl,o) for s,cl,o in entries if c._equal(c._reference(s,cl),decision[role])
                       and c._equal(cl['identity'],decision['identity']) and cl['declarationSnapshot']['stage']==stage]
            if not matches or not all(c._fragment_matches(f,matches[0][2]['textArtifact']) for f in decision['basis'][scope]):
                _fail('APPLICABILITY_DECISION_UNVERIFIED')


def validate_steel_comparison_loader_package(value: Any) -> dict:
    c._native_input(value)
    if type(value) is dict and (c._collection_limit(value) or type(value.get('identities')) is list and len(value['identities'])>128):
        _fail('INPUT_LIMIT')
    if not _shape(value,_DTO['loaderPackage']):
        _fail()
    _sources(value['sources'],value['objectId'])
    _retained(value)
    if value['identities'] != _identities(value['sources']):
        _fail('IDENTITY_PROJECTION_MISMATCH')
    return deepcopy(value)


def _result_id(envelope: dict, body: dict) -> str:
    return c._hash({'hashDomain':'matrix-steel-execution-result-id-v1','objectId':envelope['objectId'],
        'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':body})


def build_steel_comparisons(value: Any, registry: Any = _DEFAULT) -> dict:
    _registry(registry)
    package = validate_steel_comparison_loader_package(value)
    result = {'schemaVersion':'matrix-steel-comparisons-v1','purpose':'MACHINE_COMPARISON',
              'objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],
              'capabilityRegistryHash':STEEL_COMPARISON_CAPABILITY_REGISTRY_HASH,'results':[]}
    for identity in package['identities']:
        comparison = c.compare_kr056_steel_declarations({'schemaVersion':'matrix-kr056-steel-comparison-input-v1',
            'objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],'identity':identity,
            'sources':package['sources'],'origins':package['origins'],'applicabilityDecisions':package['applicabilityDecisions']})
        body = {**_COMMON,'kind':'SCOPED_COMPARISON','identity':identity,'comparison':comparison}
        result['results'].append({'id':_result_id(result,body),**body})
    if not result['results']:
        body = {**_COMMON,'kind':'UNBOUND_ATOM_ABSTENTION',
                'reasonCode':'REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING','calibratedProbability':None}
        result['results'].append({'id':_result_id(result,body),**body})
    return result


def validate_steel_comparisons(value: Any) -> dict:
    c._native_input(value)
    if not _shape(value,_DTO['comparisons']) or value['capabilityRegistryHash'] != STEEL_COMPARISON_CAPABILITY_REGISTRY_HASH:
        _fail()
    ids, identities = set(), []
    for row in value['results']:
        if row['kind']=='UNBOUND_ATOM_ABSTENTION':
            if len(value['results'])!=1:
                _fail()
        else:
            comparison = row['comparison']
            if comparison['identity'] != row['identity'] or comparison['reasonCode'] in _INTEGRITY:
                _fail()
            if comparison['status']=='CANDIDATE':
                expected, actual = comparison['comparison']['expected'],comparison['comparison']['actual']
                if expected['sourceFileId']==actual['sourceFileId'] or expected['sourceSha256']==actual['sourceSha256']:
                    _fail()
            identities.append(c._canonical(row['identity']))
        if row['id'] in ids or row['id'] != _result_id(value,{key:item for key,item in row.items() if key!='id'}):
            _fail('RESULT_ID_MISMATCH')
        ids.add(row['id'])
    if identities != sorted(set(identities)):
        _fail('IDENTITY_ORDER_MISMATCH')
    return deepcopy(value)


def steel_comparison_evidence(value: Any, envelope: Any, registry: Any = _DEFAULT) -> list:
    c._native_input(envelope)
    expected = build_steel_comparisons(value,registry)
    if not c._equal(envelope,expected):
        _fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
    output = []
    for row in expected['results']:
        if row['kind']!='SCOPED_COMPARISON' or row['comparison']['status']!='CANDIDATE':
            continue
        comparison = row['comparison']['comparison']
        pair = next(d for d in value['applicabilityDecisions'] if d['decisionId']==comparison['applicabilityDecisionId']
                    and d['contentHash']==comparison['applicabilityDecisionContentHash'])
        for role,key,basis in [('EXPECTED','expected','expectedScopeFragments'),('ACTUAL','actual','actualScopeFragments')]:
            ref = comparison[key]
            matches = [(s,cl) for s in value['sources'] for cl in c._claims(s)
                       if c._equal(c._reference(s,cl),ref) and c._equal(cl['identity'],row['identity'])]
            if len(matches)!=1:
                _fail('SOURCE_PROVENANCE_UNVERIFIED')
            source,claim = matches[0]
            origin = next(o for o in value['origins'] if o['sourceFileId']==source['sourceFileId']
                          and c._equal(o['target'],c._target4(claim['target'])))
            snapshot = claim['declarationSnapshot']
            groups = [('PRIMARY',snapshot['primaryFragments']),('DECLARATION_SCOPE',snapshot['scopeFragments']),
                      ('PHYSICAL_MEMBER_SCOPE',claim['memberMapping']['scopeFragments']),('APPLICABILITY_BASIS',pair['basis'][basis])]
            for fragment_role,fragments in groups:
                for fragment in fragments:
                    page = origin['textArtifact']['pages'][fragment['pageNumber']-1]
                    output.append({'resultId':row['id'],'role':role,'sourceFileId':ref['sourceFileId'],
                        'sourceSha256':ref['sourceSha256'],'reviewDecisionId':ref['reviewDecisionId'],
                        'reviewContentHash':ref['reviewContentHash'],'target':deepcopy(ref['target']),
                        'applicabilityDecisionId':pair['decisionId'],'applicabilityDecisionContentHash':pair['contentHash'],
                        'pageNumber':fragment['pageNumber'],'pageFrame':{'widthMilliPoints':page['widthMilliPoints'],
                            'heightMilliPoints':page['heightMilliPoints']},'fragmentRole':fragment_role,'fragment':deepcopy(fragment)})
    return output


def merge_steel_comparison_coverage(coverage: Any, envelope: Any, registry: Any = _DEFAULT) -> list:
    _registry(registry)
    c._native_input(coverage)
    checked = validate_steel_comparisons(envelope)
    if type(coverage) is not list or len(coverage)!=132 or len(_CODES)!=132:
        _fail()
    if any(not _shape(row,_DTO['coverageRow']) or row['parameterCode']!=_CODES[index] for index,row in enumerate(coverage)):
        _fail()
    index = _CODES.index('KR-056')
    if coverage[index]['executionStatus']!='UNSUPPORTED' or any(coverage[index][key]!=0 for key in _COUNTERS):
        _fail('COVERAGE_TARGET_OVERLAP')
    output = deepcopy(coverage)
    success = sum(row['kind']=='SCOPED_COMPARISON' and row['comparison']['status']=='CANDIDATE' for row in checked['results'])
    output[index] = {'parameterCode':'KR-056','implementedAtomicRules':1,'enabledAtomicRules':1,'evaluatedAtomicRules':1,
                     'successfulComparisons':success,'abstentions':len(checked['results'])-success,'failures':0,
                     'executionStatus':'PARTIAL','reason':json.loads(_REGISTRY_JSON)['entries'][0]['partialGap']}
    return output
