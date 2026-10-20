"""KR056 literal transition over full originals and explicit human pair review.

The protected caller authenticates actors, original PDF bytes and review journal.
Hashes here prove integrity only; no standards equivalence or strength ranking.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import re
from typing import Any

from .document_text_v3 import _native, _canonical, _WS
from .source_declarations import extract_source_declarations, source_declaration_id
from .steel_prose import compare_steel_catalog_example

_SCHEMA = 'matrix-kr056-steel-comparison-v1'
_SCOPE = 'matrix-kr056-steel-review-v1'
_DOMAIN = 'matrix-kr056-steel-applicability-decision-json-v1'

# Structural validators are compiled from the pinned canonical DTO definitions.
# Original semantics are independently reconstructed by the frozen producer.
_DEFINITIONS = {'key': {'type': 'string', 'minLength': 1, 'maxLength': 200},
 'sha': {'type': 'string', 'pattern': '^[a-f0-9]{64}$'},
 'reference': {'type': 'string', 'minLength': 8, 'maxLength': 1000},
 'bbox': {'type': 'array',
          'minItems': 4,
          'maxItems': 4,
          'items': {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991}},
 'identity': {'type': 'object',
              'additionalProperties': False,
              'required': ['entityKey', 'buildingKey', 'zoneKey', 'memberKey', 'componentRole'],
              'properties': {'entityKey': {'$ref': '#/definitions/key'},
                             'buildingKey': {'$ref': '#/definitions/key'},
                             'zoneKey': {'$ref': '#/definitions/key'},
                             'memberKey': {'$ref': '#/definitions/key'},
                             'componentRole': {'const': 'DISTRIBUTION_BELT_I_BEAM'}}},
 'fragment': {'type': 'object',
              'additionalProperties': False,
              'required': ['pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'],
              'properties': {'pageNumber': {'type': 'integer', 'minimum': 1, 'maximum': 512},
                             'blockIndex': {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991},
                             'lineIndex': {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991},
                             'rawText': {'type': 'string', 'minLength': 1, 'maxLength': 2000000},
                             'bboxMilliPoints': {'$ref': '#/definitions/bbox'}}},
 'productScope': {'type': 'object',
                  'additionalProperties': False,
                  'required': ['role',
                               'productKind',
                               'profile',
                               'count',
                               'tier',
                               'productStandard',
                               'gradeStandard'],
                  'properties': {'role': {'enum': ['DISTRIBUTION_BELT_I_BEAMS',
                                                   'I_BEAM_GENERIC_DECLARATION']},
                                 'productKind': {'const': 'I_BEAM'},
                                 'profile': {'anyOf': [{'type': 'string', 'minLength': 1, 'maxLength': 200},
                                                       {'type': 'null'}]},
                                 'count': {'anyOf': [{'type': 'integer',
                                                      'minimum': 1,
                                                      'maximum': 9007199254740991},
                                                     {'type': 'null'}]},
                                 'tier': {'anyOf': [{'type': 'integer',
                                                     'minimum': 1,
                                                     'maximum': 9007199254740991},
                                                    {'type': 'null'}]},
                                 'productStandard': {'type': 'string', 'minLength': 1, 'maxLength': 200},
                                 'gradeStandard': {'type': 'string', 'minLength': 1, 'maxLength': 200}}},
 'originalSteelScope': {'oneOf': [{'type': 'object',
                                   'additionalProperties': False,
                                   'required': ['role',
                                                'productKind',
                                                'profile',
                                                'count',
                                                'tier',
                                                'productStandard',
                                                'gradeStandard'],
                                   'properties': {'role': {'const': 'DISTRIBUTION_BELT_I_BEAMS'},
                                                  'productKind': {'const': 'I_BEAM'},
                                                  'profile': {'const': '70Б3'},
                                                  'count': {'const': 3},
                                                  'tier': {'const': 2},
                                                  'productStandard': {'const': 'ГОСТ Р 35087-2024'},
                                                  'gradeStandard': {'const': 'ГОСТ 27772-2015'}}},
                                  {'type': 'object',
                                   'additionalProperties': False,
                                   'required': ['role',
                                                'productKind',
                                                'profile',
                                                'count',
                                                'tier',
                                                'productStandard',
                                                'gradeStandard'],
                                   'properties': {'role': {'const': 'I_BEAM_GENERIC_DECLARATION'},
                                                  'productKind': {'const': 'I_BEAM'},
                                                  'profile': {'const': None},
                                                  'count': {'const': None},
                                                  'tier': {'const': None},
                                                  'productStandard': {'const': 'ГОСТ Р 57837-2017'},
                                                  'gradeStandard': {'const': 'ГОСТ 27772-2021'}}}]},
 'declaration': {'type': 'object',
                 'additionalProperties': False,
                 'required': ['schemaVersion',
                              'id',
                              'kind',
                              'extractorVersion',
                              'sourceFileId',
                              'sourceSha256',
                              'textArtifactHash',
                              'stage',
                              'pageNumber',
                              'widthMilliPoints',
                              'heightMilliPoints',
                              'value',
                              'rawValue',
                              'rawUnit',
                              'canonicalUnit',
                              'entityKey',
                              'applicabilityStatus',
                              'primaryFragments',
                              'scopeFragments',
                              'productScope'],
                 'properties': {'schemaVersion': {'const': 'matrix-source-declaration-v1'},
                                'id': {'$ref': '#/definitions/sha'},
                                'kind': {'const': 'SOURCE_AUTHORED_STEEL_DECLARATION'},
                                'extractorVersion': {'const': 'matrix-steel-prose-v1'},
                                'sourceFileId': {'$ref': '#/definitions/key'},
                                'sourceSha256': {'$ref': '#/definitions/sha'},
                                'textArtifactHash': {'$ref': '#/definitions/sha'},
                                'stage': {'enum': ['PD', 'RD']},
                                'pageNumber': {'type': 'integer', 'minimum': 1, 'maximum': 512},
                                'widthMilliPoints': {'type': 'integer',
                                                     'minimum': 1,
                                                     'maximum': 9007199254740991},
                                'heightMilliPoints': {'type': 'integer',
                                                      'minimum': 1,
                                                      'maximum': 9007199254740991},
                                'value': {'enum': ['С245', 'С345']},
                                'rawValue': {'enum': ['C245', 'С245', 'C345', 'С345']},
                                'rawUnit': {'const': None},
                                'canonicalUnit': {'const': 'steel_catalog_example'},
                                'entityKey': {'const': None},
                                'applicabilityStatus': {'const': 'UNREVIEWED'},
                                'primaryFragments': {'type': 'array',
                                                     'minItems': 1,
                                                     'maxItems': 2,
                                                     'items': {'$ref': '#/definitions/fragment'}},
                                'scopeFragments': {'type': 'array',
                                                   'minItems': 3,
                                                   'maxItems': 3,
                                                   'items': {'$ref': '#/definitions/fragment'}},
                                'productScope': {'$ref': '#/definitions/originalSteelScope'}}},
 'originTarget': {'type': 'object',
                  'additionalProperties': False,
                  'required': ['checkId', 'inputManifestHash', 'textStageContentHash', 'textArtifactHash'],
                  'properties': {'checkId': {'type': 'string', 'minLength': 1, 'maxLength': 120},
                                 'inputManifestHash': {'$ref': '#/definitions/sha'},
                                 'textStageContentHash': {'$ref': '#/definitions/sha'},
                                 'textArtifactHash': {'$ref': '#/definitions/sha'}}},
 'target': {'type': 'object',
            'additionalProperties': False,
            'required': ['checkId',
                         'inputManifestHash',
                         'textStageContentHash',
                         'textArtifactHash',
                         'declarationId'],
            'properties': {'checkId': {'type': 'string', 'minLength': 1, 'maxLength': 120},
                           'inputManifestHash': {'$ref': '#/definitions/sha'},
                           'textStageContentHash': {'$ref': '#/definitions/sha'},
                           'textArtifactHash': {'$ref': '#/definitions/sha'},
                           'declarationId': {'$ref': '#/definitions/sha'}}},
 'memberMapping': {'type': 'object',
                   'additionalProperties': False,
                   'required': ['assertion', 'identity', 'scopeFragments', 'reference'],
                   'properties': {'assertion': {'enum': ['UNKNOWN', 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER']},
                                  'identity': {'$ref': '#/definitions/identity'},
                                  'scopeFragments': {'type': 'array',
                                                     'minItems': 1,
                                                     'maxItems': 16,
                                                     'items': {'$ref': '#/definitions/fragment'}},
                                  'reference': {'$ref': '#/definitions/reference'}}},
 'claimRequest': {'type': 'object',
                  'additionalProperties': False,
                  'required': ['target', 'identity', 'memberMapping'],
                  'properties': {'target': {'$ref': '#/definitions/target'},
                                 'identity': {'$ref': '#/definitions/identity'},
                                 'memberMapping': {'$ref': '#/definitions/memberMapping'}}},
 'claimDecision': {'type': 'object',
                   'additionalProperties': False,
                   'required': ['target', 'identity', 'memberMapping', 'declarationSnapshot'],
                   'properties': {'target': {'$ref': '#/definitions/target'},
                                  'identity': {'$ref': '#/definitions/identity'},
                                  'memberMapping': {'$ref': '#/definitions/memberMapping'},
                                  'declarationSnapshot': {'$ref': '#/definitions/declaration'}}},
 'scopeRequest': {'type': 'object',
                  'additionalProperties': False,
                  'required': ['schemaVersion', 'claims'],
                  'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-review-v1'},
                                 'claims': {'type': 'array',
                                            'minItems': 0,
                                            'maxItems': 16,
                                            'items': {'$ref': '#/definitions/claimRequest'}}}},
 'scopeDecision': {'type': 'object',
                   'additionalProperties': False,
                   'required': ['schemaVersion', 'claims'],
                   'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-review-v1'},
                                  'claims': {'type': 'array',
                                             'minItems': 0,
                                             'maxItems': 16,
                                             'items': {'$ref': '#/definitions/claimDecision'}}}},
 'referencePair': {'type': 'object',
                   'additionalProperties': False,
                   'required': ['sourceFileId',
                                'sourceSha256',
                                'reviewDecisionId',
                                'reviewContentHash',
                                'target',
                                'productScope'],
                   'properties': {'sourceFileId': {'$ref': '#/definitions/key'},
                                  'sourceSha256': {'$ref': '#/definitions/sha'},
                                  'reviewDecisionId': {'$ref': '#/definitions/key'},
                                  'reviewContentHash': {'$ref': '#/definitions/sha'},
                                  'target': {'$ref': '#/definitions/target'},
                                  'productScope': {'$ref': '#/definitions/productScope'}}},
 'basis': {'type': 'object',
           'additionalProperties': False,
           'required': ['reference',
                        'expectedScopeFragments',
                        'actualScopeFragments',
                        'catalogScope',
                        'standardsTreatment',
                        'profilesTreatment'],
           'properties': {'reference': {'$ref': '#/definitions/reference'},
                          'expectedScopeFragments': {'type': 'array',
                                                     'minItems': 1,
                                                     'maxItems': 16,
                                                     'items': {'$ref': '#/definitions/fragment'}},
                          'actualScopeFragments': {'type': 'array',
                                                   'minItems': 1,
                                                   'maxItems': 16,
                                                   'items': {'$ref': '#/definitions/fragment'}},
                          'catalogScope': {'const': 'ONLY_KR056_EXPLICIT_C345_TO_C245'},
                          'standardsTreatment': {'const': 'RETAINED_DIFFERENCES_HUMAN_REVIEWED_NO_NORMATIVE_EQUIVALENCE'},
                          'profilesTreatment': {'const': 'RETAINED_DIFFERENCES_NO_GEOMETRY_OR_STRENGTH_RANK'}}},
 'applicabilityDecision': {'type': 'object',
                           'additionalProperties': False,
                           'required': ['schemaVersion',
                                        'decisionId',
                                        'contentHash',
                                        'objectId',
                                        'status',
                                        'authorityKind',
                                        'identity',
                                        'expected',
                                        'actual',
                                        'basis'],
                           'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-applicability-decision-v1'},
                                          'decisionId': {'$ref': '#/definitions/key'},
                                          'contentHash': {'$ref': '#/definitions/sha'},
                                          'objectId': {'$ref': '#/definitions/key'},
                                          'status': {'enum': ['UNKNOWN', 'APPROVED', 'WITHDRAWN']},
                                          'authorityKind': {'const': 'HUMAN_REVIEWED_DECLARATION_APPLICABILITY'},
                                          'identity': {'$ref': '#/definitions/identity'},
                                          'expected': {'$ref': '#/definitions/referencePair'},
                                          'actual': {'$ref': '#/definitions/referencePair'},
                                          'basis': {'$ref': '#/definitions/basis'}}},
 'stages': {'type': 'array',
            'minItems': 0,
            'maxItems': 4,
            'items': {'enum': ['PD', 'RD', 'ID', 'UNRESOLVED']},
            'uniqueItems': True},
 'pageStages': {'type': 'object',
                'propertyNames': {'pattern': '^[1-9][0-9]*$'},
                'additionalProperties': {'enum': ['PD', 'RD', 'ID', 'UNRESOLVED']},
                'maxProperties': 512},
 'review': {'type': 'object',
            'additionalProperties': False,
            'required': ['decisionId',
                         'contentHash',
                         'revisionStatus',
                         'approvalStatus',
                         'sectionCode',
                         'linkGroupId',
                         'pageStages',
                         'steelComparisonScope'],
            'properties': {'decisionId': {'$ref': '#/definitions/key'},
                           'contentHash': {'$ref': '#/definitions/sha'},
                           'revisionStatus': {'enum': ['CURRENT', 'SUPERSEDED', 'UNKNOWN']},
                           'approvalStatus': {'enum': ['APPROVED', 'UNAPPROVED', 'UNKNOWN']},
                           'sectionCode': {'anyOf': [{'enum': ['PZ',
                                                               'SPZU',
                                                               'AR',
                                                               'KR',
                                                               'IOS1',
                                                               'IOS2',
                                                               'IOS3',
                                                               'IOS4',
                                                               'IOS5',
                                                               'POS',
                                                               'POD',
                                                               'OOS',
                                                               'PPM',
                                                               'ODI',
                                                               'ZU',
                                                               'SM',
                                                               'EOM',
                                                               'GP',
                                                               'GSV',
                                                               'KJ',
                                                               'KM',
                                                               'NVK',
                                                               'OV',
                                                               'PP',
                                                               'PPR',
                                                               'SS',
                                                               'VK']},
                                                     {'type': 'null'}]},
                           'linkGroupId': {'anyOf': [{'type': 'string', 'minLength': 1, 'maxLength': 120},
                                                     {'type': 'null'}]},
                           'pageStages': {'$ref': '#/definitions/pageStages'},
                           'steelComparisonScope': {'anyOf': [{'$ref': '#/definitions/scopeDecision'},
                                                              {'type': 'null'}]}}},
 'source': {'type': 'object',
            'additionalProperties': False,
            'required': ['sourceFileId', 'sourceSha256', 'objectId', 'stages', 'review'],
            'properties': {'sourceFileId': {'$ref': '#/definitions/key'},
                           'sourceSha256': {'$ref': '#/definitions/sha'},
                           'objectId': {'$ref': '#/definitions/key'},
                           'stages': {'$ref': '#/definitions/stages'},
                           'review': {'anyOf': [{'$ref': '#/definitions/review'}, {'type': 'null'}]}}},
 'fullTextArtifact': {'type': 'object',
                      'additionalProperties': False,
                      'required': ['schemaVersion',
                                   'sourceFileId',
                                   'inputSha256',
                                   'coordinateSystem',
                                   'pageCount',
                                   'textPageCount',
                                   'qualityPolicyVersion',
                                   'qualitySummary',
                                   'pages'],
                      'properties': {'schemaVersion': {'const': 'document-text-v2'},
                                     'sourceFileId': {'$ref': '#/definitions/key'},
                                     'inputSha256': {'$ref': '#/definitions/sha'},
                                     'coordinateSystem': {'const': 'PDF_BOTTOM_LEFT_MILLI_POINTS'},
                                     'pageCount': {'type': 'integer', 'minimum': 1, 'maximum': 512},
                                     'textPageCount': {'type': 'integer', 'minimum': 0, 'maximum': 512},
                                     'qualityPolicyVersion': {'enum': ['text-layer-quality-v1',
                                                                       'text-layer-quality-v2']},
                                     'qualitySummary': {'type': 'object',
                                                        'additionalProperties': False,
                                                        'required': ['textLayerCandidatePageCount',
                                                                     'ocrRequiredPageCount'],
                                                        'properties': {'textLayerCandidatePageCount': {'type': 'integer',
                                                                                                       'minimum': 0,
                                                                                                       'maximum': 512},
                                                                       'ocrRequiredPageCount': {'type': 'integer',
                                                                                                'minimum': 0,
                                                                                                'maximum': 512}}},
                                     'pages': {'type': 'array',
                                               'minItems': 1,
                                               'maxItems': 512,
                                               'items': {'type': 'object',
                                                         'additionalProperties': False,
                                                         'required': ['pageNumber',
                                                                      'widthMilliPoints',
                                                                      'heightMilliPoints',
                                                                      'blocks',
                                                                      'quality'],
                                                         'properties': {'pageNumber': {'type': 'integer',
                                                                                       'minimum': 1,
                                                                                       'maximum': 512},
                                                                        'widthMilliPoints': {'type': 'integer',
                                                                                             'minimum': 1,
                                                                                             'maximum': 9007199254740991},
                                                                        'heightMilliPoints': {'type': 'integer',
                                                                                              'minimum': 1,
                                                                                              'maximum': 9007199254740991},
                                                                        'blocks': {'type': 'array',
                                                                                   'minItems': 0,
                                                                                   'maxItems': 32768,
                                                                                   'items': {'type': 'object',
                                                                                             'additionalProperties': False,
                                                                                             'required': ['text',
                                                                                                          'bboxMilliPoints'],
                                                                                             'properties': {'text': {'type': 'string',
                                                                                                                     'minLength': 0,
                                                                                                                     'maxLength': 2000000},
                                                                                                            'bboxMilliPoints': {'$ref': '#/definitions/bbox'},
                                                                                                            'lineBboxesMilliPoints': {'type': 'array',
                                                                                                                                      'minItems': 1,
                                                                                                                                      'maxItems': 32768,
                                                                                                                                      'items': {'$ref': '#/definitions/bbox'}}}}},
                                                                        'quality': {'type': 'object',
                                                                                    'additionalProperties': False,
                                                                                    'required': ['disposition',
                                                                                                 'metrics',
                                                                                                 'reasonCodes'],
                                                                                    'properties': {'disposition': {'enum': ['TEXT_LAYER_CANDIDATE',
                                                                                                                            'OCR_REQUIRED']},
                                                                                                   'metrics': {'type': 'object',
                                                                                                               'additionalProperties': False,
                                                                                                               'required': ['alphanumericCharacterCount',
                                                                                                                            'blockCount',
                                                                                                                            'disallowedControlCharacterCount',
                                                                                                                            'nonWhitespaceCharacterCount',
                                                                                                                            'replacementCharacterCount'],
                                                                                                               'properties': {'alphanumericCharacterCount': {'type': 'integer',
                                                                                                                                                             'minimum': 0,
                                                                                                                                                             'maximum': 9007199254740991},
                                                                                                                              'blockCount': {'type': 'integer',
                                                                                                                                             'minimum': 0,
                                                                                                                                             'maximum': 9007199254740991},
                                                                                                                              'disallowedControlCharacterCount': {'type': 'integer',
                                                                                                                                                                  'minimum': 0,
                                                                                                                                                                  'maximum': 9007199254740991},
                                                                                                                              'nonWhitespaceCharacterCount': {'type': 'integer',
                                                                                                                                                              'minimum': 0,
                                                                                                                                                              'maximum': 9007199254740991},
                                                                                                                              'replacementCharacterCount': {'type': 'integer',
                                                                                                                                                            'minimum': 0,
                                                                                                                                                            'maximum': 9007199254740991}}},
                                                                                                   'reasonCodes': {'type': 'array',
                                                                                                                   'minItems': 0,
                                                                                                                   'maxItems': 32,
                                                                                                                   'items': {'type': 'string',
                                                                                                                             'minLength': 1,
                                                                                                                             'maxLength': 200}}}}}}}}},
 'origin': {'type': 'object',
            'additionalProperties': False,
            'required': ['sourceFileId',
                         'sourceSha256',
                         'target',
                         'artifactContentSha256',
                         'textArtifact',
                         'stages',
                         'pageStages'],
            'properties': {'sourceFileId': {'$ref': '#/definitions/key'},
                           'sourceSha256': {'$ref': '#/definitions/sha'},
                           'target': {'$ref': '#/definitions/originTarget'},
                           'artifactContentSha256': {'$ref': '#/definitions/sha'},
                           'textArtifact': {'$ref': '#/definitions/fullTextArtifact'},
                           'stages': {'$ref': '#/definitions/stages'},
                           'pageStages': {'$ref': '#/definitions/pageStages'}}},
 'input': {'type': 'object',
           'additionalProperties': False,
           'required': ['schemaVersion',
                        'objectId',
                        'inputManifestHash',
                        'identity',
                        'sources',
                        'origins',
                        'applicabilityDecisions'],
           'properties': {'schemaVersion': {'const': 'matrix-kr056-steel-comparison-input-v1'},
                          'objectId': {'$ref': '#/definitions/key'},
                          'inputManifestHash': {'$ref': '#/definitions/sha'},
                          'identity': {'$ref': '#/definitions/identity'},
                          'sources': {'type': 'array',
                                      'minItems': 0,
                                      'maxItems': 64,
                                      'items': {'$ref': '#/definitions/source'}},
                          'origins': {'type': 'array',
                                      'minItems': 0,
                                      'maxItems': 128,
                                      'items': {'$ref': '#/definitions/origin'}},
                          'applicabilityDecisions': {'type': 'array',
                                                     'minItems': 0,
                                                     'maxItems': 16,
                                                     'items': {'$ref': '#/definitions/applicabilityDecision'}}}}}


def _clean(value: str) -> bool:
    return (bool(value) and ord(value[0]) not in _WS and ord(value[-1]) not in _WS
            and not any((ord(c) < 32 and c != '\t') or c in '\u2028\u2029\ufffd' for c in value))


def _equal(a: Any, b: Any) -> bool:
    return _canonical(a) == _canonical(b)


def _struct(value: Any, schema: dict) -> bool:
    if '$ref' in schema:
        name = schema['$ref'].rsplit('/', 1)[-1]
        return _struct(value, _DEFINITIONS[name]) and (name not in {'key', 'reference'} or _clean(value))
    if 'anyOf' in schema:
        return any(_struct(value, s) for s in schema['anyOf'])
    if 'oneOf' in schema:
        return sum(_struct(value, s) for s in schema['oneOf']) == 1
    if 'const' in schema and not _equal(value, schema['const']):
        return False
    if 'enum' in schema and not any(_equal(value, e) for e in schema['enum']):
        return False
    kind = schema.get('type')
    if kind == 'null':
        return value is None
    if kind == 'string':
        return (type(value) is str and schema.get('minLength', 0) <= len(value) <= schema.get('maxLength', 2000000)
                and ('pattern' not in schema or re.fullmatch(schema['pattern'].removeprefix('^').removesuffix('$'), value, re.ASCII) is not None))
    if kind == 'integer':
        return type(value) is int and schema.get('minimum', -9007199254740991) <= value <= schema.get('maximum', 9007199254740991)
    if kind == 'array':
        return (type(value) is list and schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', 32768)
                and (not schema.get('uniqueItems') or len({_canonical(x) for x in value}) == len(value))
                and all(_struct(x, schema.get('items', {})) for x in value))
    if kind == 'object':
        if type(value) is not dict or len(value) > schema.get('maxProperties', 32768):
            return False
        props = schema.get('properties', {})
        if not set(schema.get('required', [])).issubset(value):
            return False
        for key, item in value.items():
            if key in {'checkId', 'linkGroupId'} and item is not None and (type(item) is not str or not _clean(item)):
                return False
            if 'propertyNames' in schema and not _struct(key, {'type': 'string', **schema['propertyNames']}):
                return False
            if key in props:
                if not _struct(item, props[key]):
                    return False
            elif schema.get('additionalProperties') is False:
                return False
            elif type(schema.get('additionalProperties')) is dict and not _struct(item, schema['additionalProperties']):
                return False
        return True
    return True


def _dto(value: Any, name: str) -> bool:
    return _struct(value, _DEFINITIONS[name])


def _native_input(value: Any) -> None:
    # Keep the frozen whole-JSON budgets and exact-builtin rejection first.
    _native(value)
    pending = [value]
    while pending:
        item = pending.pop()
        if type(item) is dict:
            for key, child in dict.items(item):
                if not key.isascii():
                    raise ValueError('INVALID_INPUT')
                pending.append(child)
        elif type(item) is list:
            pending.extend(item)


def _hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode('utf-8')).hexdigest()


def _claims(source: dict) -> list:
    review = source['review']
    return [] if review is None or review['steelComparisonScope'] is None else review['steelComparisonScope']['claims']


def _target4(target: dict) -> dict:
    return {k: v for k, v in target.items() if k != 'declarationId'}


def _reference(source: dict, claim: dict) -> dict:
    return {'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sourceSha256'],
            'reviewDecisionId': source['review']['decisionId'], 'reviewContentHash': source['review']['contentHash'],
            'target': claim['target'], 'productScope': claim['declarationSnapshot']['productScope']}


def _fragment_matches(fragment: dict, artifact: dict) -> bool:
    try:
        page = artifact['pages'][fragment['pageNumber'] - 1]
        block = page['blocks'][fragment['blockIndex']]
        index = fragment['lineIndex']
        text = block['text'].split('\n')[index]
        boxes = block.get('lineBboxesMilliPoints')
        box = boxes[index] if boxes is not None else block['bboxMilliPoints'] if len(block['text'].split('\n')) == 1 else None
        return fragment['rawText'] == text and fragment['bboxMilliPoints'] == box
    except (IndexError, KeyError):
        return False


def _scope_unique(value: dict) -> bool:
    ids = [c['target']['declarationId'] for c in value['claims']]
    return len(ids) == len(set(ids))


def _snapshot_local(claim: dict) -> bool:
    snapshot = claim['declarationSnapshot']
    return (snapshot['id'] == claim['target']['declarationId'] == source_declaration_id(snapshot)
            and snapshot['textArtifactHash'] == claim['target']['textArtifactHash']
            and all(f['pageNumber'] == snapshot['pageNumber'] for k in ('primaryFragments', 'scopeFragments') for f in snapshot[k]))


def validate_steel_comparison_scope_request(value: Any) -> dict | None:
    try:
        _native_input(value)
        if len(_canonical(value).encode('utf-8')) > 524288 or not _dto(value, 'scopeRequest') or not _scope_unique(value):
            return None
        return deepcopy(value)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None


def project_steel_comparison_scope_decision(value: Any) -> dict | None:
    try:
        _native_input(value)
        if not _dto(value, 'scopeDecision') or not _scope_unique(value) or not all(_snapshot_local(c) for c in value['claims']):
            return None
        sources = {(c['declarationSnapshot']['sourceFileId'], c['declarationSnapshot']['sourceSha256']) for c in value['claims']}
        if len(sources) > 1:
            return None
        request = {'schemaVersion': _SCOPE, 'claims': [{k: v for k, v in c.items() if k != 'declarationSnapshot'} for c in value['claims']]}
        return validate_steel_comparison_scope_request(request)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return None


def _result(reason: str, identity: Any = None, comparison: Any = None) -> dict:
    return {'schemaVersion': _SCHEMA, 'status': 'CANDIDATE' if comparison is not None else 'ABSTAIN',
            'reasonCode': reason, 'identity': deepcopy(identity), 'comparison': deepcopy(comparison), 'calibratedProbability': None}


def _collection_limit(value: dict) -> bool:
    for key, limit in (('sources', 64), ('origins', 128), ('applicabilityDecisions', 16)):
        if type(value.get(key)) is list and len(value[key]) > limit:
            return True
    total = 0
    for s in value.get('sources', []) if type(value.get('sources')) is list else []:
        if type(s) is not dict or type(s.get('review')) is not dict:
            continue
        scope = s['review'].get('steelComparisonScope')
        if type(scope) is dict and type(scope.get('claims')) is list:
            if len(scope['claims']) > 16:
                return True
            total += len(scope['claims'])
    return total > 128


def compare_kr056_steel_declarations(value: Any) -> dict:
    try:
        _native_input(value)
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        return _result('INPUT_LIMIT' if str(error) == 'INPUT_LIMIT' else 'INVALID_INPUT')
    identity = value.get('identity') if type(value) is dict and _dto(value.get('identity'), 'identity') else None
    if type(value) is dict and _collection_limit(value):
        return _result('INPUT_LIMIT', identity)
    if not _dto(value, 'input'):
        return _result('INVALID_INPUT', identity)
    fail = lambda reason: _result(reason, identity)
    sources = {s['sourceFileId']: s for s in value['sources']}
    if len(sources) != len(value['sources']) or any(s['objectId'] != value['objectId'] for s in value['sources']):
        return fail('SOURCE_PROVENANCE_UNVERIFIED')
    origins = {}
    # Validate every supplied original, including sources without any claim.
    for origin in value['origins']:
        sid = origin['sourceFileId']
        target = origin['target']
        artifact = origin['textArtifact']
        key = (sid, _canonical(target))
        if (sid not in sources or sources[sid]['sourceSha256'] != origin['sourceSha256'] or key in origins
                or artifact['sourceFileId'] != sid or artifact['inputSha256'] != origin['sourceSha256']
                or _hash(artifact) != origin['artifactContentSha256']
                or target['textStageContentHash'] != origin['artifactContentSha256']
                or target['textArtifactHash'] != _hash({'hashDomain': 'matrix-source-declaration-text-artifact-v1', 'textArtifact': artifact})):
            return fail('SOURCE_PROVENANCE_UNVERIFIED')
        review = sources[sid]['review']
        page_bound = str(artifact['pageCount'])
        if review is not None and any(len(p) > len(page_bound) or len(p) == len(page_bound) and p > page_bound for p in review['pageStages']):
            return fail('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key] = origin
    rebuilt = {}
    for key, origin in origins.items():
        try:
            output = extract_source_declarations({'objectId': value['objectId'], 'inputManifestHash': origin['target']['inputManifestHash'],
                'sources': [{'sourceFileId': origin['sourceFileId'], 'sha256': origin['sourceSha256'], 'stages': origin['stages'], 'pageStages': origin['pageStages']}],
                'textArtifacts': [origin['textArtifact']]})
            rebuilt[key] = output['declarations']
        except (ValueError, TypeError, UnicodeError, RecursionError):
            return fail('SOURCE_PROVENANCE_UNVERIFIED')
    entries = []
    for source in value['sources']:
        for claim in _claims(source):
            key = (source['sourceFileId'], _canonical(_target4(claim['target'])))
            origin = origins.get(key)
            snapshot = claim['declarationSnapshot']
            if (origin is None or not any(_equal(snapshot, d) for d in rebuilt[key])
                    or claim['target']['declarationId'] != snapshot['id']
                    or not all(_fragment_matches(f, origin['textArtifact']) for f in claim['memberMapping']['scopeFragments'])):
                return fail('DECLARATION_RECONSTRUCTION_UNVERIFIED')
            entries.append((source, claim, origin))
    # Review hashes are protected-loader assertions; pair decision hash is local integrity.
    seen_decisions = set()
    for decision in value['applicabilityDecisions']:
        if (decision['decisionId'] in seen_decisions or decision['objectId'] != value['objectId']
                or decision['contentHash'] != _hash({'hashDomain': _DOMAIN, 'decision': {k: v for k, v in decision.items() if k != 'contentHash'}})):
            return fail('APPLICABILITY_DECISION_UNVERIFIED')
        seen_decisions.add(decision['decisionId'])
        for role, scope in (('expected', 'expectedScopeFragments'), ('actual', 'actualScopeFragments')):
            original_stage = 'PD' if role == 'expected' else 'RD'
            matches = [(s, c, o) for s, c, o in entries if _equal(_reference(s, c), decision[role])
                       and _equal(c['identity'], decision['identity']) and c['declarationSnapshot']['stage'] == original_stage]
            if not matches or not all(_fragment_matches(f, matches[0][2]['textArtifact']) for f in decision['basis'][scope]):
                return fail('APPLICABILITY_DECISION_UNVERIFIED')
    for source in value['sources']:
        ids = [c['target']['declarationId'] for c in _claims(source)]
        if len(ids) != len(set(ids)):
            return fail('DUPLICATE_DECLARATION')
    selected = [(s, c, o) for s, c, o in entries if _equal(c['identity'], identity)]
    by_stage = {stage: [(s, c, o) for s, c, o in selected if c['declarationSnapshot']['stage'] == stage] for stage in ('PD', 'RD')}
    if any(len(rows) > 1 for rows in by_stage.values()):
        return fail('AMBIGUOUS_DECLARATION_SCOPE')
    if any(not rows for rows in by_stage.values()):
        return fail('REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING')
    expected, actual = by_stage['PD'][0], by_stage['RD'][0]
    for stage, entry in (('PD', expected), ('RD', actual)):
        source, claim, origin = entry
        review = source['review']
        bound = str(origin['textArtifact']['pageCount'])
        outside = any(len(p) > len(bound) or len(p) == len(bound) and p > bound for p in review['pageStages'])
        if source['stages'] != [stage] or any(s != stage for s in review['pageStages'].values()) or outside:
            return fail('SOURCE_STAGE_UNVERIFIED')
    if any(s['review']['revisionStatus'] != 'CURRENT' or s['review']['approvalStatus'] != 'APPROVED' for s, c, o in (expected, actual)):
        return fail('SOURCE_REVIEW_UNVERIFIED')
    if any(s['review']['sectionCode'] != 'KR' for s, c, o in (expected, actual)):
        return fail('SOURCE_SECTION_UNVERIFIED')
    es, ec, _ = expected
    acs, ac, _ = actual
    if (es['sourceFileId'] == acs['sourceFileId'] or es['sourceSha256'] == acs['sourceSha256']
            or not es['review']['linkGroupId'] or es['review']['linkGroupId'] != acs['review']['linkGroupId']):
        return fail('SOURCE_LINK_UNVERIFIED')
    if any(c['memberMapping']['assertion'] != 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER' or not _equal(c['memberMapping']['identity'], identity) for s, c, o in (expected, actual)):
        return fail('PHYSICAL_MEMBER_MAPPING_UNVERIFIED')
    pair = [d for d in value['applicabilityDecisions'] if _equal(d['identity'], identity) and _equal(d['expected'], _reference(es, ec)) and _equal(d['actual'], _reference(acs, ac))]
    if not pair:
        return fail('APPLICABILITY_DECISION_MISSING')
    if len(pair) > 1:
        return fail('AMBIGUOUS_APPLICABILITY_DECISION')
    decision = pair[0]
    if decision['status'] != 'APPROVED':
        return fail('APPLICABILITY_DECISION_UNVERIFIED')
    expected_value, actual_value = ec['declarationSnapshot']['value'], ac['declarationSnapshot']['value']
    if expected_value == actual_value:
        return fail('NEGATIVE_SCOPE_UNVERIFIED')
    if compare_steel_catalog_example(expected_value, actual_value) is not True:
        return fail('UNSUPPORTED_CATEGORY_TRANSITION')
    return _result('EXPLICIT_C345_TO_C245_IN_REVIEWED_SAME_MEMBER', identity, {
        'scope': 'HUMAN_REVIEWED_PHYSICAL_MEMBER_AND_DECLARATION_APPLICABILITY_ONLY',
        'expected': _reference(es, ec), 'actual': _reference(acs, ac),
        'expectedValue': expected_value, 'actualValue': actual_value,
        'applicabilityDecisionId': decision['decisionId'], 'applicabilityDecisionContentHash': decision['contentHash']})
