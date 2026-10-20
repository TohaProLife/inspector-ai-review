"""Independent staged typed ODI123 execution wrapper, not database authority.

Protected loader authenticates original source bytes and persisted review/origin
preimages. This wrapper validates all projected records, full retained artifacts
and every stored claim before independent frozen pure comparison.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
from typing import Any
import hashlib,json
from inspector_worker import odi123_call_inventory_comparison as C
from inspector_worker.call_inventory_source import reconstruct_odi123_call_inventory_source
from inspector_worker.source_declarations import _valid_artifact
from inspector_worker.table_row_binding import _portable_error

_RULES=Path(__file__).resolve().parents[1]/'rules'
REGISTRY_HASH='86b0c1fef9f55bf5a6802c1747c9e59fd0f5ebb16c230a74d685b30c307f6e2d'
ENVELOPE_VERSION='matrix-call-inventory-comparisons-v1'
ROW_VERSION='matrix-call-inventory-execution-result-v1'
LOADER_VERSION='matrix-odi123-call-loader-inputs-v1'
_RULE='matrix-odi-123-declared_sanitary_room_personnel_call_button_omission'
_ROW_BASE={'schemaVersion':ROW_VERSION,'ruleId':_RULE,'ruleVersion':'1','parameterCode':'ODI-123','comparisonVariant':'PD_RD'}
_ERROR_REASONS={'INVALID_INPUT','INPUT_LIMIT','SOURCE_PROVENANCE_UNVERIFIED','INVENTORY_RECONSTRUCTION_UNVERIFIED'}
_ABSTENTIONS={'ROOM_IDENTITY_CONFLICT','SOURCE_STAGE_UNVERIFIED','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','ROOM_MAPPING_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED','NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED'}
_COUNTERS={'implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'}
_COVERAGE={'parameterCode','executionStatus','reason'}|_COUNTERS
_REF={'sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','inventoryContentHash'}


def _native(value:Any)->None:
    if _portable_error(value):raise ValueError('call inventory execution input is not bounded portable JSON')


def _canonical_unchecked(value:Any)->str:
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def canonical_call_inventory_execution_json(value:Any)->str:
    _native(value);return _canonical_unchecked(value)


def _hash(value:Any)->str:
    return hashlib.sha256(_canonical_unchecked(value).encode('utf-8')).hexdigest()


def _registry(value:Any=None)->dict[str,Any]:
    pinned=json.loads((_RULES/'matrix-call-inventory-capabilities-v1.json').read_text())
    _native(pinned)
    if _hash(pinned)!=REGISTRY_HASH:raise ValueError('call capability registry pin mismatch')
    if value is not None:
        _native(value)
        if _canonical_unchecked(value)!=_canonical_unchecked(pinned):raise ValueError('call capability registry differs from approved registry')
    # Namespace isolation is checked directly against the immutable scalar file.
    scalar=json.loads((_RULES/'matrix-execution-v1.json').read_text())
    if any(a.get('ruleId')==_RULE for e in scalar['entries'] for a in e['atomicRules']):
        raise ValueError('call capability rule overlaps scalar registry')
    return pinned


def _unique_review_inventories(sources:list[dict[str,Any]])->None:
    for source in sources:
        hashes=[claim['target']['inventoryContentHash'] for claim in C._claims(source)]
        if len(set(hashes))!=len(hashes):raise ValueError('duplicate inventory within call source review')


def _derived(sources:list[dict[str,Any]])->list[dict[str,Any]]:
    identities={_canonical_unchecked(c['identity']):c['identity'] for s in sources for c in C._claims(s)}
    if len(identities)>128:raise ValueError('call identity limit exceeded')
    return [deepcopy(identities[key]) for key in sorted(identities)]


def derive_call_inventory_identities(sources:Any)->list[dict[str,Any]]:
    _native(sources)
    if (type(sources) is not list or C._collection_limit({'sources':sources})
            or not all(C._source(s) for s in sources)):
        raise ValueError('invalid call inventory sources')
    _unique_review_inventories(sources)
    return _derived(sources)


def validate_call_inventory_loader_package(package:Any)->dict[str,Any]:
    _native(package)
    if (C._collection_limit(package)
            or not C._exact(package,{'schemaVersion','objectId','inputManifestHash','sources','origins','identities'})
            or package['schemaVersion']!=LOADER_VERSION or not C._key(package['objectId'])
            or not C._sha(package['inputManifestHash']) or type(package['sources']) is not list
            or not all(C._source(s) for s in package['sources']) or type(package['origins']) is not list
            or not all(C._origin(o) for o in package['origins']) or type(package['identities']) is not list
            or len(package['identities'])>128 or not all(C._identity(i) for i in package['identities'])):
        raise ValueError('invalid call inventory loader package')
    sources=package['sources'];origins=package['origins']
    _unique_review_inventories(sources)
    source_map={s['sourceFileId']:s for s in sources}
    origin_map={(o['sourceFileId'],o['checkId']):o for o in origins}
    if len(source_map)!=len(sources) or len(origin_map)!=len(origins):raise ValueError('duplicate call source or origin')
    for origin in origins:
        source=source_map.get(origin['sourceFileId']);artifact=origin['textArtifact']
        if (source is None or origin['objectId']!=package['objectId'] or origin['sourceSha256']!=source['sourceSha256']
                or not _valid_artifact(artifact) or artifact['sourceFileId']!=source['sourceFileId']
                or artifact['inputSha256']!=source['sourceSha256']
                or _hash({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact})!=origin['textArtifactHash']):
            raise ValueError('unverified full call inventory origin')
    for source in sources:
        review=source['review']
        if review is None:continue
        snapshot=source['reviewSnapshot']
        if (review['objectId']!=package['objectId'] or review['sourceFileId']!=source['sourceFileId']
                or review['sourceSha256']!=source['sourceSha256'] or review['decisionId']!=snapshot['decisionId']
                or review['contentHash']!=snapshot['contentHash']):
            raise ValueError('unverified call source review')
        for claim in C._claims(source):
            target=claim['target'];inventory=claim['inventorySnapshot']
            origin=origin_map.get((source['sourceFileId'],target['checkId']))
            if (origin is None or inventory['sourceFileId']!=source['sourceFileId']
                    or inventory['sourceSha256']!=source['sourceSha256']
                    or any(target[k]!=origin[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash'))):
                raise ValueError('unverified call inventory claim association')
            rebuilt=reconstruct_odi123_call_inventory_source({'sourceFileId':source['sourceFileId'],
                'sourceSha256':source['sourceSha256'],'stage':inventory['stage'],'pageStages':{},
                'textArtifact':origin['textArtifact'],'selection':claim['selection']})
            if (rebuilt['status']!='RECONSTRUCTED' or rebuilt['inventory']!=inventory
                    or C._inventory_hash(inventory)!=target['inventoryContentHash']
                    or inventory['textArtifactHash']!=origin['textArtifactHash']):
                raise ValueError('unverified call inventory snapshot reconstruction')
    if package['identities']!=_derived(sources):raise ValueError('call inventory identity enumeration mismatch')
    return deepcopy(package)


def _id(body:dict[str,Any],envelope:dict[str,Any])->str:
    return _hash({'hashDomain':'matrix-call-inventory-execution-result-id-v1','objectId':envelope['objectId'],
                  'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],
                  'result':body})


def _ref(value:Any)->bool:
    return (C._exact(value,_REF) and C._key(value['sourceFileId']) and C._key(value['reviewDecisionId'])
            and all(C._sha(value[k]) for k in ('sourceSha256','reviewContentHash','inventoryContentHash')))


def _comparison(value:Any,identity:dict[str,Any])->bool:
    if (type(value) is not dict or value.get('schemaVersion')!='matrix-odi123-call-inventory-comparison-v1'
            or value.get('calibratedProbability') is not None):return False
    if value.get('status')=='ABSTAIN':
        return (C._exact(value,{'schemaVersion','status','reasonCode','calibratedProbability'})
                and type(value['reasonCode']) is str and value['reasonCode'] in _ABSTENTIONS)
    keys={'schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode','calibratedProbability','comparisonScope','identity','expected','actual','missingFeatureKeys'}
    return (C._exact(value,keys) and value['status']=='CANDIDATE' and value['ruleId']==_RULE
            and value['ruleVersion']=='1' and value['parameterCode']=='ODI-123'
            and value['reasonCode']=='PERSONNEL_CALL_BUTTON_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY'
            and value['comparisonScope']=='REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY'
            and C._identity(value['identity']) and value['identity']==identity
            and _ref(value['expected']) and _ref(value['actual'])
            and value['expected']['sourceFileId']!=value['actual']['sourceFileId']
            and value['missingFeatureKeys']==['PERSONNEL_CALL_BUTTON'])


def validate_call_inventory_comparisons_envelope(raw:Any,capability_registry:Any=None)->dict[str,Any]:
    _native(raw);_registry(capability_registry)
    if (not C._exact(raw,{'schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'})
            or raw['schemaVersion']!=ENVELOPE_VERSION or raw['purpose']!='MACHINE_COMPARISON'
            or not C._key(raw['objectId']) or not C._sha(raw['inputManifestHash'])
            or raw['capabilityRegistryHash']!=REGISTRY_HASH or type(raw['results']) is not list
            or not 1<=len(raw['results'])<=128):raise ValueError('invalid call comparisons envelope')
    identities=[];unbound=False
    for row in raw['results']:
        if type(row) is not dict or any(row.get(k)!=v for k,v in _ROW_BASE.items()) or not C._sha(row.get('id')):
            raise ValueError('invalid call comparison result common fields')
        kind=row.get('kind')
        if kind=='UNBOUND_ATOM_ABSTENTION':
            if (not C._exact(row,set(_ROW_BASE)|{'id','kind','reasonCode','calibratedProbability'})
                    or len(raw['results'])!=1 or row['reasonCode']!='REVIEWED_CALL_INVENTORY_IDENTITY_MISSING'
                    or row['calibratedProbability'] is not None):raise ValueError('invalid unbound call result')
            unbound=True
        elif kind=='SCOPED_COMPARISON':
            if (not C._exact(row,set(_ROW_BASE)|{'id','kind','identity','comparison'})
                    or not C._identity(row['identity']) or not _comparison(row['comparison'],row['identity'])):
                raise ValueError('invalid scoped call result')
            identities.append(_canonical_unchecked(row['identity']))
        else:raise ValueError('invalid call result kind')
        body={k:v for k,v in row.items() if k!='id'}
        if _id(body,raw)!=row['id']:raise ValueError('call result ID mismatch')
    if identities!=sorted(set(identities)) or (unbound and identities):raise ValueError('duplicate or unsorted call result identity')
    return deepcopy(raw)


def build_call_inventory_comparisons(package:Any,capability_registry:Any=None)->dict[str,Any]:
    checked=validate_call_inventory_loader_package(package);_registry(capability_registry)
    envelope={'schemaVersion':ENVELOPE_VERSION,'purpose':'MACHINE_COMPARISON','objectId':checked['objectId'],
              'inputManifestHash':checked['inputManifestHash'],'capabilityRegistryHash':REGISTRY_HASH,'results':[]}
    if not checked['identities']:
        bodies=[{**_ROW_BASE,'kind':'UNBOUND_ATOM_ABSTENTION','reasonCode':'REVIEWED_CALL_INVENTORY_IDENTITY_MISSING','calibratedProbability':None}]
    else:
        bodies=[]
        for identity in checked['identities']:
            comparison=C.compare_odi123_call_inventories({'schemaVersion':'matrix-odi123-call-inventory-input-v1',
                'objectId':checked['objectId'],'inputManifestHash':checked['inputManifestHash'],'sources':checked['sources'],
                'origins':checked['origins'],'identity':identity})
            if comparison['status']=='ABSTAIN' and comparison['reasonCode'] in _ERROR_REASONS:
                raise ValueError('call comparison reported evidence integrity failure')
            bodies.append({**_ROW_BASE,'kind':'SCOPED_COMPARISON','identity':deepcopy(identity),'comparison':comparison})
    envelope['results']=[{**body,'id':_id(body,envelope)} for body in bodies]
    return validate_call_inventory_comparisons_envelope(envelope,capability_registry)


def merge_call_inventory_coverage(base_coverage:Any,envelope:Any,capability_registry:Any=None)->list[dict[str,Any]]:
    _native(base_coverage);registry=_registry(capability_registry)
    checked=validate_call_inventory_comparisons_envelope(envelope,capability_registry)
    codes=[json.loads(line)['parameter_code'] for line in (_RULES/'parameter_catalog_132.jsonl').read_text().splitlines() if line.strip()]
    if (type(base_coverage) is not list or len(base_coverage)!=132 or len(codes)!=132
            or [row.get('parameterCode') if type(row) is dict else None for row in base_coverage]!=codes):
        raise ValueError('invalid ordered call coverage catalog')
    for row in base_coverage:
        if (not C._exact(row,_COVERAGE) or not all(C._integer(row[k]) for k in _COUNTERS)
                or not C._enum(row['executionStatus'],{'UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'})
                or type(row['reason']) is not str):raise ValueError('invalid call coverage row')
    baseline=next(row for row in base_coverage if row['parameterCode']=='ODI-123')
    if baseline['executionStatus']!='UNSUPPORTED' or any(baseline[k]!=0 for k in _COUNTERS):
        raise ValueError('call coverage overlaps existing capability')
    success=sum(row['kind']=='SCOPED_COMPARISON' and row['comparison']['status']=='CANDIDATE' for row in checked['results'])
    replacement={'parameterCode':'ODI-123','implementedAtomicRules':1,'enabledAtomicRules':1,'evaluatedAtomicRules':1,
                 'successfulComparisons':success,'abstentions':len(checked['results'])-success,'failures':0,
                 'executionStatus':'PARTIAL','reason':registry['entries'][0]['partialGap']}
    return [deepcopy(replacement if row['parameterCode']=='ODI-123' else row) for row in base_coverage]
