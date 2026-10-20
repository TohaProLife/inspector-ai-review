"""Pure directed comparison of original-backed, explicitly mapped lighting positions.

Supplied review assertions and hashes do not authenticate a database actor, sealed
run or original PDF. The repository must establish that trust before this boundary.
Every retained original and claim is checked before selecting the requested pair.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import re
from typing import Any

from .document_text_v3 import _native, _canonical, _WS, read_document_text_v3_artifact
from .lighting_technology_source_v3 import (
    _path, _raw,
    reconstruct_lighting_technology_source_v3,
    lighting_technology_v3_declaration_content_hash,
)

_SCHEMA = 'matrix-zu130-lighting-technology-comparison-v1'
_INPUT = 'matrix-zu130-lighting-technology-comparison-input-v1'
_SCOPE = 'matrix-zu130-lighting-technology-review-v1'
_SAFE = 2**53 - 1
_SHA = re.compile(r'[a-f0-9]{64}\Z', re.ASCII)
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z', re.ASCII)
_DECIMAL = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?\Z', re.ASCII)
_POSITION = re.compile(r'[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}\Z')
_STAGES = {'PD', 'RD', 'ID', 'UNRESOLVED'}
_SECTIONS = {'PZ','SPZU','AR','KR','IOS1','IOS2','IOS3','IOS4','IOS5','POS','POD','OOS','PPM','ODI','ZU','SM','EOM','GP','GSV','KJ','KM','NVK','OV','PP','PPR','SS','VK'}
_IDENTITY = {'entityKey', 'buildingKey', 'systemKey', 'positionKey', 'componentRole'}
_TARGET = {'checkId', 'inputManifestHash', 'textStageContentHash', 'textArtifactHash', 'declarationContentHash'}
_REQUEST_CLAIM = {'target', 'selection', 'identity', 'positionMapping', 'reference'}
_REVIEW = {'decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','lightingTechnologyScope'}
_ORIGIN = {'checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'}


def _exact(value: Any, keys: set[str]) -> bool:
    return type(value) is dict and set(value) == keys


def _enum(value: Any, values: set[str]) -> bool:
    return type(value) is str and value in values


def _integer(value: Any, minimum: int = 0, maximum: int = _SAFE) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _key(value: Any, maximum: int = 200, minimum: int = 1) -> bool:
    return (type(value) is str and minimum <= len(value) <= maximum
            and ord(value[0]) not in _WS and ord(value[-1]) not in _WS
            and not any((ord(c) < 32 and c != '\t') or c in '\u2028\u2029\ufffd' for c in value))


def _sha(value: Any) -> bool:
    return type(value) is str and bool(_SHA.fullmatch(value))


def _identity(value: Any) -> bool:
    return (_exact(value, _IDENTITY) and value['componentRole'] == 'LUMINAIRE_LIGHT_SOURCE'
            and all(_key(value[k]) for k in _IDENTITY - {'componentRole'}))


def _selection(value: Any) -> bool:
    return (_exact(value, {'pageNumber', 'fragments'}) and _integer(value['pageNumber'], 1, 512)
            and type(value['fragments']) is list and 1 <= len(value['fragments']) <= 2
            and all(_exact(f, {'sourcePath', 'rawText'}) and _path(f['sourcePath']) and _raw(f['rawText'])
                    for f in value['fragments']))


def _target(value: Any) -> bool:
    return (_exact(value, _TARGET) and _key(value['checkId'], 120)
            and all(_sha(value[k]) for k in _TARGET - {'checkId'}))


def _native_box(value: Any) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is str and 1 <= len(n) <= 64 and _DECIMAL.fullmatch(n) for n in value))


def _milli_box(value: Any) -> bool:
    return type(value) is list and len(value) == 4 and all(_integer(n) for n in value)


def _snapshot(value: Any) -> bool:
    # Gate 2 is the exact structural DTO. Literal agreement, positive native
    # geometry and original association belong to reconstruction at gate 6.
    keys = set(('schemaVersion extractorVersion bindingPolicyVersion sourceFileId sourceSha256 '
        'textArtifactHash extractorProfileHash stage pageNumber pageWidthMilliPoints pageHeightMilliPoints '
        'nativeFrame regionBoxMilliPoints technology rawTechnology positionLabel scopeStatus primaryFragments '
        'authorityStatus renderedVisibility calibratedProbability').split())
    if (not _exact(value, keys)
            or value['schemaVersion'] != 'matrix-zu130-lighting-technology-v3-declaration-v1'
            or value['extractorVersion'] != 'matrix-zu130-lighting-technology-source-v3-v1'
            or value['bindingPolicyVersion'] != 'matrix-zu130-explicit-lighting-technology-v3-literals-v1'
            or not _key(value['sourceFileId'])
            or any(not _sha(value[k]) for k in ('sourceSha256', 'textArtifactHash', 'extractorProfileHash'))
            or not _enum(value['stage'], _STAGES) or not _integer(value['pageNumber'], 1, 512)
            or not _integer(value['pageWidthMilliPoints'], 1) or not _integer(value['pageHeightMilliPoints'], 1)
            or not _exact(value['nativeFrame'], {'coordinateSystem', 'visibleBoxPointStrings'})
            or value['nativeFrame']['coordinateSystem'] != 'PDFMINER_LAYOUT_POINTS'
            or not _native_box(value['nativeFrame']['visibleBoxPointStrings'])
            or not _milli_box(value['regionBoxMilliPoints'])
            or not _enum(value['technology'], {'LED','FLUORESCENT','INCANDESCENT'})
            or type(value['rawTechnology']) is not str or not 1 <= len(value['rawTechnology']) <= 200
            or not (value['positionLabel'] is None or type(value['positionLabel']) is str and 1 <= len(value['positionLabel']) <= 80)
            or not _enum(value['scopeStatus'], {'NAMED_POSITION_LITERAL','UNBOUND_GROUP_DECLARATION'})
            or value['authorityStatus'] != 'SOURCE_DECLARED_UNVERIFIED'
            or value['renderedVisibility'] != 'UNVERIFIED' or value['calibratedProbability'] is not None
            or type(value['primaryFragments']) is not list or not 1 <= len(value['primaryFragments']) <= 2):
        return False
    for fragment in value['primaryFragments']:
        if (not _exact(fragment, {'pageNumber','sourcePath','rawText','nativeBoxPointStrings','bboxMilliPoints','usedTextRange'})
                or not _integer(fragment['pageNumber'], 1, 512) or not _path(fragment['sourcePath'])
                or not _raw(fragment['rawText']) or not _native_box(fragment['nativeBoxPointStrings'])
                or not _milli_box(fragment['bboxMilliPoints'])
                or not _exact(fragment['usedTextRange'], {'start','end'})
                or not _integer(fragment['usedTextRange']['start']) or not _integer(fragment['usedTextRange']['end'], 1)):
            return False
    return True


def _claim(value: Any, decision: bool) -> bool:
    return (_exact(value, _REQUEST_CLAIM | ({'declarationSnapshot'} if decision else set()))
            and _target(value['target']) and _selection(value['selection']) and _identity(value['identity'])
            and _exact(value['positionMapping'], {'kind', 'sourcePositionLabel', 'assertion'})
            and value['positionMapping']['kind'] == 'HUMAN_REVIEWED_LIGHTING_POSITION_MAPPING'
            and type(value['positionMapping']['sourcePositionLabel']) is str
            and bool(_POSITION.fullmatch(value['positionMapping']['sourcePositionLabel']))
            and _enum(value['positionMapping']['assertion'], {'UNKNOWN', 'HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION'})
            and _key(value['reference'], 1000, 8)
            and (not decision or _snapshot(value['declarationSnapshot'])))


def _scope(value: Any, decision: bool) -> bool:
    return (_exact(value, {'schemaVersion', 'claims'}) and value['schemaVersion'] == _SCOPE
            and type(value['claims']) is list and len(value['claims']) <= 16
            and all(_claim(c, decision) for c in value['claims']))


def _page_stages(value: Any) -> bool:
    return (type(value) is dict and all(_PAGE.fullmatch(k) and _integer(int(k), 1)
                                      and _enum(stage, _STAGES) for k, stage in value.items()))


def _review(value: Any) -> bool:
    return (_exact(value, _REVIEW)
            and all(_key(value[k]) for k in ('decisionId', 'objectId', 'sourceFileId', 'actorId'))
            and _sha(value['contentHash']) and _sha(value['sourceSha256'])
            and _enum(value['revisionStatus'], {'CURRENT', 'SUPERSEDED', 'UNKNOWN'})
            and _enum(value['approvalStatus'], {'APPROVED', 'UNAPPROVED', 'UNKNOWN'})
            and (value['sectionCode'] is None or _enum(value['sectionCode'], _SECTIONS))
            and (value['linkGroupId'] is None or _key(value['linkGroupId'], 120))
            and _page_stages(value['pageStages'])
            and (value['lightingTechnologyScope'] is None or _scope(value['lightingTechnologyScope'], True)))


def _source(value: Any) -> bool:
    if (not _exact(value, {'sourceFileId', 'sourceSha256', 'stages', 'reviewSnapshot', 'review'})
            or not _key(value['sourceFileId']) or not _sha(value['sourceSha256'])
            or type(value['stages']) is not list or len(value['stages']) > 4
            or not all(_enum(s, _STAGES) for s in value['stages'])):
        return False
    pointer = value['reviewSnapshot']
    return ((pointer is None or _exact(pointer, {'decisionId','contentHash'})
             and _key(pointer['decisionId']) and _sha(pointer['contentHash']))
            and (value['review'] is None or _review(value['review'])))


def _origin(value: Any) -> bool:
    return (_exact(value, _ORIGIN) and _key(value['checkId'], 120)
            and _key(value['objectId']) and _key(value['sourceFileId'])
            and all(_sha(value[k]) for k in ('sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'))
            and type(value['textArtifact']) is dict)


def _claims(source: dict) -> list:
    review = source['review']
    return [] if review is None or review['lightingTechnologyScope'] is None else review['lightingTechnologyScope']['claims']


def _caps(value: Any) -> bool:
    if type(value) is not dict:
        return False
    if type(value.get('sources')) is list and len(value['sources']) > 64:
        return True
    if type(value.get('origins')) is list and len(value['origins']) > 128:
        return True
    total = 0
    for source in value.get('sources', []) if type(value.get('sources')) is list else []:
        if type(source) is not dict or type(source.get('review')) is not dict:
            continue
        scope = source['review'].get('lightingTechnologyScope')
        if type(scope) is dict and type(scope.get('claims')) is list:
            count = len(scope['claims']); total += count
            if count > 16 or total > 128:
                return True
    return False


def _native_error(value: Any) -> str | None:
    try:
        _native(value)
    except ValueError as error:
        return 'INPUT_LIMIT' if str(error) == 'INPUT_LIMIT' else 'INVALID_INPUT'
    return None


def validate_lighting_technology_scope_request(value: Any) -> dict | None:
    """Detach an exact staging request; this establishes no origin authority."""
    if _native_error(value) or not _scope(value, False):
        return None
    hashes = [c['target']['declarationContentHash'] for c in value['claims']]
    return deepcopy(value) if len(hashes) == len(set(hashes)) else None


def project_lighting_technology_scope_decision(value: Any) -> dict | None:
    """Check standalone snapshot consistency and project only request fields."""
    if _native_error(value) or not _scope(value, True):
        return None
    hashes = [c['target']['declarationContentHash'] for c in value['claims']]
    if len(hashes) != len(set(hashes)):
        return None
    source = None
    for claim in value['claims']:
        snapshot, target = claim['declarationSnapshot'], claim['target']
        current = (snapshot['sourceFileId'], snapshot['sourceSha256'])
        if source is not None and current != source:
            return None
        source = current
        selection = {'pageNumber': snapshot['pageNumber'], 'fragments': [
            {'sourcePath': f['sourcePath'], 'rawText': f['rawText']} for f in snapshot['primaryFragments']]}
        try:
            content_hash = lighting_technology_v3_declaration_content_hash(snapshot)
        except ValueError:
            return None
        if (target['textArtifactHash'] != snapshot['textArtifactHash'] or claim['selection'] != selection
                or content_hash != target['declarationContentHash']):
            return None
    return {'schemaVersion': _SCOPE, 'claims': [
        {key: deepcopy(claim[key]) for key in _REQUEST_CLAIM} for claim in value['claims']]}


def _abstain(reason: str) -> dict:
    return {'schemaVersion': _SCHEMA, 'status': 'ABSTAIN', 'reasonCode': reason, 'calibratedProbability': None}


def compare_zu130_lighting_technologies(value: Any) -> dict:
    """Verify all retained inputs before applying the two directed literal pairs."""
    error = _native_error(value)
    if error:
        return _abstain(error)
    if _caps(value):
        return _abstain('INPUT_LIMIT')
    if (not _exact(value, {'schemaVersion','objectId','inputManifestHash','identity','sources','origins'})
            or value['schemaVersion'] != _INPUT or not _key(value['objectId'])
            or not _sha(value['inputManifestHash']) or not _identity(value['identity'])
            or type(value['sources']) is not list or not all(_source(s) for s in value['sources'])
            or type(value['origins']) is not list or not all(_origin(o) for o in value['origins'])):
        return _abstain('INVALID_INPUT')
    sources, origins = {}, {}
    for source in value['sources']:
        sid = source['sourceFileId']
        if sid in sources or len(set(source['stages'])) != len(source['stages']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        sources[sid] = source
        review, pointer = source['review'], source['reviewSnapshot']
        if (review is None) != (pointer is None):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        if review is not None and (review['decisionId'] != pointer['decisionId']
                or review['contentHash'] != pointer['contentHash'] or review['objectId'] != value['objectId']
                or review['sourceFileId'] != sid or review['sourceSha256'] != source['sourceSha256']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    for origin in value['origins']:
        key = (origin['sourceFileId'], origin['checkId'])
        source = sources.get(origin['sourceFileId'])
        if (key in origins or source is None or origin['objectId'] != value['objectId']
                or origin['sourceSha256'] != source['sourceSha256']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key] = origin
    entries = []
    for source in value['sources']:
        for claim in _claims(source):
            target = claim['target']
            origin = origins.get((source['sourceFileId'], target['checkId']))
            if origin is None or any(target[k] != origin[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):
                return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
            entries.append((source, claim, origin))
    # Every original, even with no selected claim, precedes any stage/pair choice.
    for origin in value['origins']:
        artifact = origin['textArtifact']
        read = read_document_text_v3_artifact(artifact)
        if read['status'] != 'VALID':
            return _abstain('INPUT_LIMIT' if read['reasonCode'] == 'INPUT_LIMIT' else 'SOURCE_PROVENANCE_UNVERIFIED')
        source = sources[origin['sourceFileId']]
        review = source['review']
        if (artifact['sourceFileId'] != origin['sourceFileId'] or artifact['inputSha256'] != origin['sourceSha256']
                or read['contentHash'] != origin['textArtifactHash']
                or hashlib.sha256(_canonical(artifact).encode('utf-8')).hexdigest() != origin['textStageContentHash']
                or (review is not None and any(int(page) > artifact['pageCount'] for page in review['pageStages']))):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    # Scan all claim stages before reconstructing even the first retained claim.
    for source, claim, origin in entries:
        if (len(source['stages']) != 1 or source['stages'][0] not in ('PD', 'RD')
                or any(stage != 'UNRESOLVED' and stage != source['stages'][0]
                       for stage in source['review']['pageStages'].values())
                or source['review']['pageStages'].get(str(claim['selection']['pageNumber']), source['stages'][0]) != source['stages'][0]):
            return _abstain('SOURCE_STAGE_UNVERIFIED')
    verified = []
    for source, claim, origin in entries:
        result = reconstruct_lighting_technology_source_v3({
            'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sourceSha256'],
            'stage': source['stages'][0], 'pageStages': source['review']['pageStages'],
            'textArtifact': origin['textArtifact'], 'selection': claim['selection']})
        if (result['status'] != 'RECONSTRUCTED' or result['declaration'] != claim['declarationSnapshot']
                or lighting_technology_v3_declaration_content_hash(result['declaration']) != claim['target']['declarationContentHash']):
            return _abstain('DECLARATION_RECONSTRUCTION_UNVERIFIED')
        verified.append((source, claim, result['declaration']))
    wanted = value['identity']
    selected = [entry for entry in verified if entry[1]['identity']['entityKey'] == wanted['entityKey']
                or all(entry[1]['identity'][key] == wanted[key] for key in ('buildingKey','systemKey','positionKey'))]
    if any(claim['identity'] != wanted for source, claim, declaration in selected):
        return _abstain('POSITION_IDENTITY_CONFLICT')
    pd = [entry for entry in selected if entry[0]['stages'][0] == 'PD']
    rd = [entry for entry in selected if entry[0]['stages'][0] == 'RD']
    for group in (pd, rd):
        hashes = [claim['target']['declarationContentHash'] for source, claim, declaration in group]
        if len(hashes) != len(set(hashes)):
            return _abstain('INVALID_INPUT')
    if len(pd) > 1 or len(rd) > 1:
        return _abstain('AMBIGUOUS_DECLARATION_SCOPE')
    if (len(pd) != 1 or len(rd) != 1 or pd[0][0]['sourceFileId'] == rd[0][0]['sourceFileId']
            or pd[0][0]['sourceSha256'] == rd[0][0]['sourceSha256']):
        return _abstain('MATCHED_DECLARATION_PAIR_UNVERIFIED')
    pair = (pd[0], rd[0])
    if any(source['review']['revisionStatus'] != 'CURRENT' or source['review']['approvalStatus'] != 'APPROVED'
           for source, claim, declaration in pair):
        return _abstain('SOURCE_REVIEW_UNVERIFIED')
    if pair[0][0]['review']['sectionCode'] not in ('ZU','IOS1') or pair[1][0]['review']['sectionCode'] not in ('IOS1','EOM'):
        return _abstain('SOURCE_SECTION_UNVERIFIED')
    links = [source['review']['linkGroupId'] for source, claim, declaration in pair]
    if links[0] is None or links[0] != links[1]:
        return _abstain('LINK_SCOPE_UNVERIFIED')
    if any(declaration['scopeStatus'] != 'NAMED_POSITION_LITERAL' or declaration['positionLabel'] is None
           for source, claim, declaration in pair):
        return _abstain('NAMED_POSITION_UNVERIFIED')
    for source, claim, declaration in pair:
        mapping = claim['positionMapping']
        if (mapping['assertion'] != 'HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION'
                or mapping['sourcePositionLabel'] != declaration['positionLabel']):
            return _abstain('POSITION_MAPPING_UNVERIFIED')
    if pair[0][2]['technology'] != 'LED' or pair[1][2]['technology'] not in ('FLUORESCENT','INCANDESCENT'):
        return _abstain('DIRECTED_TRANSITION_UNSUPPORTED')
    def reference(entry: tuple) -> dict:
        source, claim, declaration = entry
        return {'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sourceSha256'],
                'reviewDecisionId': source['review']['decisionId'], 'reviewContentHash': source['review']['contentHash'],
                'declarationContentHash': claim['target']['declarationContentHash']}
    return {'schemaVersion': _SCHEMA, 'status': 'CANDIDATE',
            'ruleId': 'matrix-zu-130-declared_led_technology_replacement', 'ruleVersion': '1', 'parameterCode': 'ZU-130',
            'reasonCode': 'LED_REPLACED_BY_FLUORESCENT_OR_INCANDESCENT', 'calibratedProbability': None,
            'comparisonScope': 'REVIEWED_NAMED_LUMINAIRE_LIGHT_SOURCE_POSITION_ONLY', 'identity': deepcopy(wanted),
            'expected': reference(pair[0]), 'actual': reference(pair[1]),
            'expectedTechnology': 'LED', 'actualTechnology': pair[1][2]['technology']}
