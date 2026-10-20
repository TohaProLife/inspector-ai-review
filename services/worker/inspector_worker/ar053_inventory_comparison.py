"""Independent staged AR053 declared-region comparison over protected projections.

This is not an HTTP trust parser. Repository authentication of the entire frozen
manifest/review/actor/origin precedes this function. Internal hash consistency
cannot establish that any DB record exists. No calibrated probability is made.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import re
from typing import Any

from inspector_worker.inventory_source import reconstruct_ar053_inventory_source, _portable_error, _key

INPUT_VERSION = 'matrix-ar053-inventory-input-v1'
RESULT_VERSION = 'matrix-ar053-inventory-comparison-v1'
RULE_ID = 'matrix-ar-053-declared_joint_damping_tape_omission'
RULE_VERSION = '1'
_SAFE = 2**53 - 1
_SHA = re.compile(r'[a-f0-9]{64}\Z', re.ASCII)
_PAGE = re.compile(r'[1-9][0-9]{0,15}\Z', re.ASCII)
_STAGES = {'PD', 'RD', 'ID', 'UNRESOLVED'}
_SECTIONS = {'PZ', 'SPZU', 'AR', 'KR', 'IOS1', 'IOS2', 'IOS3', 'IOS4', 'IOS5', 'POS', 'POD',
             'OOS', 'PPM', 'ODI', 'ZU', 'SM', 'EOM', 'GP', 'GSV', 'KJ', 'KM', 'NVK', 'OV',
             'PP', 'PPR', 'SS', 'VK'}
_IDENTITY_KEYS = {'entityKey', 'componentRole', 'componentKey', 'zoneKey', 'operatingModeKey',
                  'measurementBasisKey'}
_FRAGMENT_KEYS = {'pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'}
_SELECTION_KEYS = {'pageNumber', 'regionBoxMilliPoints', 'headerFragments', 'scopeFragments'}
_TARGET_KEYS = {'checkId', 'inputManifestHash', 'textStageContentHash', 'textArtifactHash',
                'inventoryContentHash'}
_SOURCE_KEYS = {'sourceFileId', 'sourceSha256', 'stages', 'reviewSnapshot', 'review'}
_REVIEW_KEYS = {'decisionId', 'contentHash', 'objectId', 'sourceFileId', 'sourceSha256', 'actorId',
                'revisionStatus', 'approvalStatus', 'sectionCode', 'linkGroupId', 'pageStages',
                'inventoryScope'}
_ORIGIN_KEYS = {'checkId', 'objectId', 'sourceFileId', 'sourceSha256', 'inputManifestHash',
                'textStageContentHash', 'textArtifactHash', 'textArtifact'}
_INVENTORY_KEYS = {'schemaVersion', 'extractorVersion', 'policyVersion', 'sourceFileId', 'sourceSha256',
                   'textArtifactHash', 'stage', 'pageNumber', 'widthMilliPoints', 'heightMilliPoints',
                   'regionBoxMilliPoints', 'headerFragments', 'scopeFragments', 'featureRows', 'unresolvedRows'}


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion': RESULT_VERSION, 'status': 'ABSTAIN', 'reasonCode': reason,
            'calibratedProbability': None}


def _exact(value: Any, keys: set[str]) -> bool:
    return type(value) is dict and set(value) == keys


def _integer(value: Any, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= _SAFE


def _id(value: Any, maximum: int = 200) -> bool:
    return _key(value) and len(value) <= maximum


def _sha(value: Any) -> bool:
    return type(value) is str and bool(_SHA.fullmatch(value))


def _member(value: Any, allowed: set[str]) -> bool:
    return type(value) is str and value in allowed


def _box(value: Any) -> bool:
    return (type(value) is list and len(value) == 4 and all(_integer(n) for n in value)
            and value[0] < value[2] and value[1] < value[3])


def _contains(outer: list[int], inner: list[int]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and inner[2] <= outer[2] and inner[3] <= outer[3]


def _line(value: Any) -> bool:
    # Frozen review fragment line controls, including TAB/C1 allowance.
    return (type(value) is str and 0 < len(value) <= 8192 and bool(value.strip())
            and not any(ord(c) < 32 and c != '\t' or c in '\u2028\u2029\ufffd' for c in value))


def _fragment(value: Any) -> bool:
    return (_exact(value, _FRAGMENT_KEYS) and _integer(value['pageNumber'], 1)
            and _integer(value['blockIndex']) and _integer(value['lineIndex'])
            and _line(value['rawText']) and _box(value['bboxMilliPoints']))


def _one_fragment(value: Any) -> bool:
    return type(value) is list and len(value) == 1 and _fragment(value[0])


def _identity(value: Any, *, claim: bool = False) -> bool:
    if type(value) is not dict or not _IDENTITY_KEYS <= value.keys():
        return False
    if not claim and set(value) != _IDENTITY_KEYS:
        return False
    return (all(_id(value[k]) for k in ('entityKey', 'componentKey', 'zoneKey'))
            and value['componentRole'] == 'PARTITION_SLAB_JOINT'
            and value['operatingModeKey'] == 'DECLARED_NOISE_PROTECTION_MEASURES'
            and value['measurementBasisKey'] == 'SOURCE_AUTHORED_MEASURE_MEMBERSHIP')


def _page_stages(value: Any) -> bool:
    return (type(value) is dict and all(bool(_PAGE.fullmatch(k)) and int(k) <= _SAFE and _member(v, _STAGES)
                                       for k, v in value.items()))


def _selection(value: Any) -> bool:
    if (not _exact(value, _SELECTION_KEYS) or not _integer(value['pageNumber'], 1)
            or not _box(value['regionBoxMilliPoints'])
            or not all(_one_fragment(value[k]) for k in ('headerFragments', 'scopeFragments'))):
        return False
    return all(f['pageNumber'] == value['pageNumber'] and _contains(value['regionBoxMilliPoints'], f['bboxMilliPoints'])
               for k in ('headerFragments', 'scopeFragments') for f in value[k])


def _target(value: Any) -> bool:
    return (_exact(value, _TARGET_KEYS) and _id(value['checkId'], 120)
            and all(_sha(value[k]) for k in _TARGET_KEYS - {'checkId'}))


def _inventory(value: Any) -> bool:
    if (not _exact(value, _INVENTORY_KEYS)
            or value['schemaVersion'] != 'matrix-inventory-source-v1'
            or value['extractorVersion'] != 'matrix-ar053-inventory-source-v1'
            or value['policyVersion'] != 'matrix-ar053-inventory-literals-v1'
            or not _id(value['sourceFileId']) or not _sha(value['sourceSha256'])
            or not _sha(value['textArtifactHash']) or not _member(value['stage'], {'PD', 'RD'})
            or not all(_integer(value[k], 1) for k in ('pageNumber', 'widthMilliPoints', 'heightMilliPoints'))
            or not _box(value['regionBoxMilliPoints'])
            or not _contains([0, 0, value['widthMilliPoints'], value['heightMilliPoints']], value['regionBoxMilliPoints'])
            or not all(_one_fragment(value[k]) for k in ('headerFragments', 'scopeFragments'))
            or type(value['featureRows']) is not list or len(value['featureRows']) > 64
            or type(value['unresolvedRows']) is not list or len(value['unresolvedRows']) > 128):
        return False
    for row in value['featureRows']:
        if (not _exact(row, {'featureKey', 'fragments'})
                or not _member(row['featureKey'], {'DAMPING_TAPE', 'ACOUSTIC_GASKET'})
                or not _one_fragment(row['fragments'])):
            return False
    for row in value['unresolvedRows']:
        if (not _exact(row, {'reasonCode', 'fragments'})
                or not _member(row['reasonCode'], {'UNSUPPORTED_ROW', 'DUPLICATE_FEATURE'})
                or not _one_fragment(row['fragments'])):
            return False
    fragments = value['headerFragments'] + value['scopeFragments']
    fragments += [f for row in value['featureRows'] + value['unresolvedRows'] for f in row['fragments']]
    return all(f['pageNumber'] == value['pageNumber'] and _contains(value['regionBoxMilliPoints'], f['bboxMilliPoints'])
               for f in fragments)


def _scope(value: Any) -> bool:
    if value is None:
        return True
    if (not _exact(value, {'schemaVersion', 'claims'}) or value['schemaVersion'] != 'matrix-inventory-review-v1'
            or type(value['claims']) is not list):
        return False
    for c in value['claims']:
        if (not _exact(c, _IDENTITY_KEYS | {'target', 'selection', 'assertion', 'reference', 'inventorySnapshot'})
                or not _identity(c, claim=True) or not _target(c['target']) or not _selection(c['selection'])
                or not _member(c['assertion'], {'UNKNOWN', 'HUMAN_ASSERTED_COMPLETE'})
                or type(c['reference']) is not str or not 8 <= len(c['reference']) <= 1000
                or c['reference'].strip() != c['reference'] or not _inventory(c['inventorySnapshot'])):
            return False
    return True


def _review(value: Any) -> bool:
    return (_exact(value, _REVIEW_KEYS)
            and all(_id(value[k]) for k in ('decisionId', 'objectId', 'sourceFileId', 'actorId'))
            and all(_sha(value[k]) for k in ('contentHash', 'sourceSha256'))
            and _member(value['revisionStatus'], {'CURRENT', 'SUPERSEDED', 'UNKNOWN'})
            and _member(value['approvalStatus'], {'APPROVED', 'UNAPPROVED', 'UNKNOWN'})
            and (value['sectionCode'] is None or _member(value['sectionCode'], _SECTIONS))
            and (value['linkGroupId'] is None or _id(value['linkGroupId'], 120))
            and _page_stages(value['pageStages']) and _scope(value['inventoryScope']))


def _source(value: Any) -> bool:
    if (not _exact(value, _SOURCE_KEYS) or not _id(value['sourceFileId']) or not _sha(value['sourceSha256'])
            or type(value['stages']) is not list or any(not _member(s, _STAGES) for s in value['stages'])
            or len(set(value['stages'])) != len(value['stages'])):
        return False
    snap, review = value['reviewSnapshot'], value['review']
    if snap is None or review is None:
        return snap is None and review is None
    return (_exact(snap, {'decisionId', 'contentHash'}) and _id(snap['decisionId'])
            and _sha(snap['contentHash']) and _review(review))


def _origin(value: Any) -> bool:
    return (_exact(value, _ORIGIN_KEYS) and _id(value['checkId'], 120)
            and all(_id(value[k]) for k in ('objectId', 'sourceFileId'))
            and all(_sha(value[k]) for k in ('sourceSha256', 'inputManifestHash', 'textStageContentHash', 'textArtifactHash'))
            and type(value['textArtifact']) is dict)


def _collection_limit(value: dict[str, Any]) -> bool:
    sources, origins = value.get('sources'), value.get('origins')
    if (type(sources) is list and len(sources) > 64) or (type(origins) is list and len(origins) > 128):
        return True
    total = 0
    for source in sources if type(sources) is list else []:
        if type(source) is not dict or type(source.get('review')) is not dict:
            continue
        scope = source['review'].get('inventoryScope')
        if type(scope) is dict and type(scope.get('claims')) is list:
            n = len(scope['claims'])
            if n > 16:
                return True
            total += n
            if total > 128:
                return True
    return False


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def _reference(source: dict[str, Any], claim: dict[str, Any]) -> dict[str, Any]:
    review = source['review']
    return {'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sourceSha256'],
            'reviewDecisionId': review['decisionId'], 'reviewContentHash': review['contentHash'],
            'inventoryContentHash': claim['target']['inventoryContentHash']}


def compare_ar053_inventories(input: Any) -> dict[str, Any]:
    """Return source-local declared-membership candidate or typed abstention.

    Does not mutate inputs, authenticate DB/actor existence, perform a latest
    lookup, infer closure, invent approved-change status or calibrate probability.
    """
    error = _portable_error(input)
    if error:
        return _abstain('INPUT_LIMIT' if error == 'LIMIT' else 'INVALID_INPUT')
    if type(input) is dict and _collection_limit(input):
        return _abstain('INPUT_LIMIT')
    if (not _exact(input, {'schemaVersion', 'objectId', 'inputManifestHash', 'identity', 'sources', 'origins'})
            or input['schemaVersion'] != INPUT_VERSION or not _id(input['objectId'])
            or not _sha(input['inputManifestHash']) or not _identity(input['identity'])
            or type(input['sources']) is not list or type(input['origins']) is not list):
        return _abstain('INVALID_INPUT')
    if any(not _source(s) for s in input['sources']) or any(not _origin(o) for o in input['origins']):
        return _abstain('INVALID_INPUT')
    source_ids = [s['sourceFileId'] for s in input['sources']]
    origin_ids = [(o['sourceFileId'], o['checkId']) for o in input['origins']]
    if len(set(source_ids)) != len(source_ids) or len(set(origin_ids)) != len(origin_ids):
        return _abstain('INVALID_INPUT')
    sources = {s['sourceFileId']: s for s in input['sources']}
    origins = {(o['sourceFileId'], o['checkId']): o for o in input['origins']}
    # Association checks cover all supplied projections, not only convenient pairs.
    for o in input['origins']:
        s = sources.get(o['sourceFileId'])
        if s is None or o['objectId'] != input['objectId'] or o['sourceSha256'] != s['sourceSha256']:
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
    matches = []
    for s in input['sources']:
        r = s['review']
        if r is None:
            continue
        snap = s['reviewSnapshot']
        if (r['objectId'] != input['objectId'] or r['sourceFileId'] != s['sourceFileId']
                or r['sourceSha256'] != s['sourceSha256'] or r['decisionId'] != snap['decisionId']
                or r['contentHash'] != snap['contentHash']):
            return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
        scope = r['inventoryScope']
        if scope is None:
            continue
        for c in scope['claims']:
            t = c['target']
            o = origins.get((s['sourceFileId'], t['checkId']))
            if (o is None or any(t[k] != o[k] for k in ('inputManifestHash', 'textStageContentHash', 'textArtifactHash'))):
                return _abstain('SOURCE_PROVENANCE_UNVERIFIED')
            if all(c[k] == input['identity'][k] for k in _IDENTITY_KEYS):
                matches.append((s, c, o))
    if any(len(s['stages']) != 1 or s['stages'][0] not in {'PD', 'RD'}
           or any(stage != s['stages'][0] for stage in s['review']['pageStages'].values())
           for s, c, o in matches):
        return _abstain('SOURCE_STAGE_UNVERIFIED')
    grouped = {'PD': [], 'RD': []}
    for match in matches:
        grouped[match[0]['stages'][0]].append(match)
    # Duplicate invalidity and ambiguity are stage-wide checks before pair selection.
    for group in grouped.values():
        hashes = [c['target']['inventoryContentHash'] for s, c, o in group]
        if len(set(hashes)) != len(hashes):
            return _abstain('INVALID_INPUT')
    if any(len(g) > 1 for g in grouped.values()):
        return _abstain('AMBIGUOUS_INVENTORY_SCOPE')
    if len(grouped['PD']) != 1 or len(grouped['RD']) != 1:
        return _abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    selected = [grouped['PD'][0], grouped['RD'][0]]
    if selected[0][0]['sourceFileId'] == selected[1][0]['sourceFileId']:
        return _abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED')
    reviews = [s['review'] for s, c, o in selected]
    if any(r['revisionStatus'] != 'CURRENT' or r['approvalStatus'] != 'APPROVED' for r in reviews):
        return _abstain('SOURCE_REVIEW_UNVERIFIED')
    if any(r['sectionCode'] != 'AR' for r in reviews):
        return _abstain('SOURCE_SECTION_UNVERIFIED')
    if reviews[0]['linkGroupId'] is None or reviews[0]['linkGroupId'] != reviews[1]['linkGroupId']:
        return _abstain('LINK_SCOPE_UNVERIFIED')
    reconstructed = []
    for s, c, o in selected:
        result = reconstruct_ar053_inventory_source({'sourceFileId': s['sourceFileId'],
            'sourceSha256': s['sourceSha256'], 'stage': s['stages'][0], 'pageStages': s['review']['pageStages'],
            'textArtifact': o['textArtifact'], 'selection': c['selection']})
        if result['status'] != 'RECONSTRUCTED':
            return _abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        body = result['inventory']
        if (body != c['inventorySnapshot'] or body['textArtifactHash'] != o['textArtifactHash']
                or _hash({'hashDomain': 'matrix-inventory-source-id-v1', 'inventory': body})
                != c['target']['inventoryContentHash']):
            return _abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED')
        reconstructed.append(body)
    if any(c['assertion'] != 'HUMAN_ASSERTED_COMPLETE' for s, c, o in selected):
        return _abstain('HUMAN_COMPLETENESS_UNVERIFIED')
    if any(not body['featureRows'] or body['unresolvedRows'] for body in reconstructed):
        return _abstain('NONEMPTY_CLOSED_REGION_UNVERIFIED')
    pd_keys, rd_keys = [{row['featureKey'] for row in body['featureRows']} for body in reconstructed]
    if 'DAMPING_TAPE' not in pd_keys:
        return _abstain('PD_REQUIREMENT_UNVERIFIED')
    if 'DAMPING_TAPE' in rd_keys:
        return _abstain('NEGATIVE_SCOPE_UNVERIFIED')
    return {'schemaVersion': RESULT_VERSION, 'status': 'CANDIDATE', 'ruleId': RULE_ID,
            'ruleVersion': RULE_VERSION, 'parameterCode': 'AR-053',
            'reasonCode': 'DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION',
            'calibratedProbability': None, 'comparisonScope': 'REVIEWED_DECLARED_REGIONS_ONLY',
            'identity': deepcopy(input['identity']), 'expected': _reference(*selected[0][:2]),
            'actual': _reference(*selected[1][:2]), 'missingFeatureKeys': ['DAMPING_TAPE']}
