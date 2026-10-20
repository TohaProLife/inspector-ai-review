"""Independent typed ODI120 execution wrapper. Metadata consistency is not DB authority.

All retained origins and every stored claim are checked before any operational outcome.
Separate capability overlay leaves scalar execution and other typed domains untouched.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import hashlib,json
from typing import Any
from inspector_worker import rail_inventory_comparison as C
from inspector_worker.source_declarations import _valid_artifact
from inspector_worker.table_row_binding import _portable_error
from inspector_worker.rail_inventory_source import reconstruct_odi120_rail_inventory_source

VERSION='matrix-rail-inventory-execution-v1'
ENVELOPE='matrix-rail-inventory-comparisons-v1'
ROW='matrix-rail-inventory-execution-result-v1'
LOADER='matrix-odi120-rail-loader-inputs-v1'
RULE='matrix-odi-120-declared_accessible_room_wc_rails_omission'
GAP='PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_ACCESSIBLE_ROOM_BOTH_WC_RAIL_TYPES_MEMBERSHIP_OMISSION_ONLY;QUANTITIES_MOUNTING_LOAD_DIMENSIONS_OTHER_ROOMS_GLOBAL_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED'
_APPROVED_REGISTRY={'schemaVersion':'matrix-rail-inventory-capabilities-v1','entries':[{'parameterCode':'ODI-120','matrixCode':'M-120','ruleId':RULE,'ruleVersion':'1','enabled':True,'comparisonVariant':'PD_RD','family':'PRESENCE_SET','executionKind':'REVIEWED_NAMED_ROOM_RAIL_INVENTORY','resultSchemaVersion':C.SCHEMA,'partialGap':GAP}]}
REGISTRY_HASH='1a50046599c3c2c0965919a33615da4254dc9e0a1e05f4bedb723d94de2be409'
_RULES=Path(__file__).resolve().parents[1]/'rules'/'matrix-execution-v1.json'
_OPERATIONAL={'ROOM_IDENTITY_CONFLICT','SOURCE_STAGE_UNVERIFIED','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','ROOM_MAPPING_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED','NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED'}
_BASE_ROW={'schemaVersion':ROW,'ruleId':RULE,'ruleVersion':'1','parameterCode':'ODI-120','comparisonVariant':'PD_RD'}
_REF={'sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','inventoryContentHash'}
_CANDIDATE={'schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode','calibratedProbability','comparisonScope','identity','expected','actual','missingFeatureKeys'}
_COVER={'parameterCode','implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures','executionStatus','reason'}
_COUNTERS={'implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'}

def _fail(message: str)->None:raise ValueError(message)
def _guard(raw: Any)->None:
    error=_portable_error(raw)
    if error:_fail('rail execution input exceeds portable limits' if error=='LIMIT' else 'rail execution input is not portable')
def _canonical(raw: Any)->str:
    return json.dumps(raw,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def _hash(raw: Any)->str:return hashlib.sha256(_canonical(raw).encode('utf-8')).hexdigest()
def _catalog()->list[dict[str,Any]]:
    raw=json.loads(_RULES.read_text(encoding='utf-8'));entries=raw.get('entries')
    if (type(entries)is not list or len(entries)!=132 or any(type(e)is not dict or not C._k(e.get('parameterCode')) or type(e.get('atomicRules'))is not list for e in entries)
            or len({e['parameterCode']for e in entries})!=132):_fail('invalid frozen scalar catalog')
    target=[e for e in entries if e['parameterCode']=='ODI-120']
    if len(target)!=1 or target[0]['atomicRules']:_fail('rail capability overlaps scalar parameter')
    if any(type(a)is not dict or a.get('ruleId')==RULE for e in entries for a in e['atomicRules']):_fail('rail ruleId overlaps scalar rule namespace')
    return entries

def validate_rail_inventory_capability_registry(raw: Any=None)->dict[str,Any]:
    if raw is None:raw=_APPROVED_REGISTRY
    _guard(raw)
    if _canonical(raw)!=_canonical(_APPROVED_REGISTRY) or _hash(raw)!=REGISTRY_HASH:_fail('unsupported rail capability registry')
    _catalog()
    return deepcopy(raw)
_registry=validate_rail_inventory_capability_registry

def _sources(raw: Any)->None:
    _guard(raw)
    if type(raw)is not list or C._caps({'sources':raw}):_fail('invalid rail source collection')
    if not all(C._source(s)for s in raw):_fail('invalid rail source DTO')
    ids=set()
    for s in raw:
        if s['sourceFileId'] in ids:_fail('duplicate rail source')
        ids.add(s['sourceFileId']);r=s['review'];rs=s['reviewSnapshot']
        if r is not None and (r['sourceFileId']!=s['sourceFileId'] or r['sourceSha256']!=s['sourceSha256'] or r['decisionId']!=rs['decisionId'] or r['contentHash']!=rs['contentHash']):_fail('rail review/source association mismatch')
        seen=set()
        for c in C._claims(s):
            snap=c['inventorySnapshot'];h=c['target']['inventoryContentHash']
            if snap['sourceFileId']!=s['sourceFileId'] or snap['sourceSha256']!=s['sourceSha256']:_fail('rail snapshot/source mismatch')
            if h in seen:_fail('duplicate per-review rail inventory hash')
            seen.add(h)

def derive_rail_inventory_identities(sources: Any)->list[dict[str,Any]]:
    _sources(sources)
    values={_canonical(c['identity']):c['identity']for s in sources for c in C._claims(s)}
    if len(values)>128:_fail('too many rail identities')
    return [deepcopy(values[k])for k in sorted(values)]

def validate_rail_inventory_loader_package(raw: Any)->dict[str,Any]:
    _guard(raw)
    if C._caps(raw) or (type(raw)is dict and type(raw.get('identities'))is list and len(raw['identities'])>128):_fail('rail loader collection limit')
    if (not C._exact(raw,{'schemaVersion','objectId','inputManifestHash','sources','origins','identities'}) or raw['schemaVersion']!=LOADER
            or not C._k(raw['objectId']) or not C._sha(raw['inputManifestHash']) or type(raw['origins'])is not list or not all(C._origin(o)for o in raw['origins'])
            or type(raw['identities'])is not list or not all(C._identity(i)for i in raw['identities'])):_fail('invalid rail loader DTO')
    _sources(raw['sources']);sources={s['sourceFileId']:s for s in raw['sources']};origins={}
    for s in raw['sources']:
        if s['review']is not None and s['review']['objectId']!=raw['objectId']:_fail('rail review object mismatch')
    for o in raw['origins']:
        key=(o['sourceFileId'],o['checkId']);s=sources.get(o['sourceFileId']);a=o['textArtifact']
        if key in origins or s is None or o['objectId']!=raw['objectId'] or o['sourceSha256']!=s['sourceSha256']:_fail('rail origin source/object mismatch')
        if (not _valid_artifact(a) or a['sourceFileId']!=s['sourceFileId'] or a['inputSha256']!=s['sourceSha256']
                or _hash({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':a})!=o['textArtifactHash']):_fail('rail full origin artifact integrity failure')
        if s['review'] is not None and any(int(page)>a['pageCount']for page in s['review']['pageStages']):_fail('rail consumer page stage outside full original')
        origins[key]=o
    for s in raw['sources']:
        for c in C._claims(s):
            t=c['target'];o=origins.get((s['sourceFileId'],t['checkId']))
            if o is None or any(t[k]!=o[k]for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):_fail('rail target/origin mismatch')
            snap=c['inventorySnapshot']
            # Preserve original authored classification. Consumer conflicts abstain later.
            result=reconstruct_odi120_rail_inventory_source({'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'stage':snap['stage'],'pageStages':{},'textArtifact':o['textArtifact'],'selection':c['selection']})
            if (result.get('status')!='RECONSTRUCTED' or result['inventory']!=snap
                    or _hash({'hashDomain':'matrix-odi120-rail-inventory-source-id-v1','inventory':snap})!=t['inventoryContentHash']):_fail('rail stored inventory reconstruction failure')
    derived=derive_rail_inventory_identities(raw['sources'])
    if raw['identities']!=derived:_fail('rail identity enumeration mismatch')
    return deepcopy(raw)

def _id(envelope: dict[str,Any],body: dict[str,Any])->str:
    return _hash({'hashDomain':'matrix-rail-inventory-execution-result-id-v1','objectId':envelope['objectId'],'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':{k:v for k,v in body.items()if k!='id'}})
def _reference(v: Any)->bool:
    return C._exact(v,_REF) and C._k(v['sourceFileId']) and C._k(v['reviewDecisionId']) and all(C._sha(v[k])for k in ('sourceSha256','reviewContentHash','inventoryContentHash'))
def _comparison(raw: Any,identity: dict[str,Any])->bool:
    if type(raw)is not dict or raw.get('schemaVersion')!=C.SCHEMA or raw.get('calibratedProbability')is not None:return False
    if raw.get('status')=='ABSTAIN':return C._exact(raw,{'schemaVersion','status','reasonCode','calibratedProbability'}) and C._enum(raw['reasonCode'],_OPERATIONAL)
    return (C._exact(raw,_CANDIDATE) and raw['status']=='CANDIDATE' and raw['ruleId']==RULE and raw['ruleVersion']=='1' and raw['parameterCode']=='ODI-120'
            and raw['reasonCode']=='BOTH_WC_RAIL_TYPES_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY' and raw['comparisonScope']=='REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY'
            and C._identity(raw['identity']) and raw['identity']==identity and _reference(raw['expected']) and _reference(raw['actual'])
            and raw['expected']['sourceFileId']!=raw['actual']['sourceFileId'] and raw['missingFeatureKeys']==['WC_FIXED_RAIL','WC_FOLDING_RAIL'])

def validate_rail_inventory_comparisons_envelope(raw: Any,capability_registry: Any=None)->dict[str,Any]:
    _guard(raw);validate_rail_inventory_capability_registry(capability_registry)
    if (not C._exact(raw,{'schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'}) or raw['schemaVersion']!=ENVELOPE or raw['purpose']!='MACHINE_COMPARISON'
            or not C._k(raw['objectId']) or not C._sha(raw['inputManifestHash']) or raw['capabilityRegistryHash']!=REGISTRY_HASH
            or type(raw['results'])is not list or not 1<=len(raw['results'])<=128):_fail('invalid rail comparisons envelope')
    identities=[];unbound=0
    for row in raw['results']:
        if type(row)is not dict or any(row.get(k)!=v for k,v in _BASE_ROW.items()) or not C._sha(row.get('id')):_fail('invalid rail result common fields')
        if row.get('kind')=='UNBOUND_ATOM_ABSTENTION':
            if (not C._exact(row,set(_BASE_ROW)|{'id','kind','reasonCode','calibratedProbability'}) or row['reasonCode']!='REVIEWED_RAIL_INVENTORY_IDENTITY_MISSING' or row['calibratedProbability']is not None):_fail('invalid rail unbound row')
            unbound+=1
        elif row.get('kind')=='SCOPED_COMPARISON':
            if not C._exact(row,set(_BASE_ROW)|{'id','kind','identity','comparison'}) or not C._identity(row['identity']) or not _comparison(row['comparison'],row['identity']):_fail('invalid rail scoped row')
            identities.append(_canonical(row['identity']))
        else:_fail('unknown rail result kind')
        if _id(raw,row)!=row['id']:_fail('rail result id mismatch')
    if unbound and (unbound!=1 or len(raw['results'])!=1):_fail('mixed rail unbound/scoped results')
    if identities!=sorted(set(identities)):_fail('rail identity result order/uniqueness mismatch')
    return deepcopy(raw)

def build_rail_inventory_comparisons(package: Any,capability_registry: Any=None)->dict[str,Any]:
    validate_rail_inventory_capability_registry(capability_registry);p=validate_rail_inventory_loader_package(package)
    out={'schemaVersion':ENVELOPE,'purpose':'MACHINE_COMPARISON','objectId':p['objectId'],'inputManifestHash':p['inputManifestHash'],'capabilityRegistryHash':REGISTRY_HASH,'results':[]}
    for identity in p['identities']:
        comparison=C.compare_odi120_rail_inventories({'schemaVersion':C.INPUT_SCHEMA,'objectId':p['objectId'],'inputManifestHash':p['inputManifestHash'],'identity':identity,'sources':p['sources'],'origins':p['origins']})
        if comparison['status']=='ABSTAIN' and comparison['reasonCode']not in _OPERATIONAL:_fail('rail comparison integrity failure')
        out['results'].append({**_BASE_ROW,'kind':'SCOPED_COMPARISON','identity':deepcopy(identity),'comparison':comparison})
    if not out['results']:out['results']=[{**_BASE_ROW,'kind':'UNBOUND_ATOM_ABSTENTION','reasonCode':'REVIEWED_RAIL_INVENTORY_IDENTITY_MISSING','calibratedProbability':None}]
    for row in out['results']:row['id']=_id(out,row)
    return validate_rail_inventory_comparisons_envelope(out,capability_registry)

def merge_rail_inventory_coverage(base_coverage: Any,envelope: Any,capability_registry: Any=None)->list[dict[str,Any]]:
    _guard(base_coverage);validated=validate_rail_inventory_comparisons_envelope(envelope,capability_registry);entries=_catalog()
    if type(base_coverage)is not list or len(base_coverage)!=132:_fail('invalid rail base coverage length')
    for row,entry in zip(base_coverage,entries):
        if (not C._exact(row,_COVER) or row['parameterCode']!=entry['parameterCode'] or not all(C._int(row[k])for k in _COUNTERS)
                or not C._enum(row['executionStatus'],{'UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'}) or type(row['reason'])is not str):_fail('invalid rail base coverage row/order')
    at=next(i for i,r in enumerate(base_coverage)if r['parameterCode']=='ODI-120');old=base_coverage[at]
    if old['executionStatus']!='UNSUPPORTED' or any(old[k]!=0 for k in _COUNTERS):_fail('rail base coverage already implemented')
    results=validated['results'];success=sum(r['kind']=='SCOPED_COMPARISON' and r['comparison']['status']=='CANDIDATE'for r in results)
    output=deepcopy(base_coverage);output[at]={'parameterCode':'ODI-120','implementedAtomicRules':1,'enabledAtomicRules':1,'evaluatedAtomicRules':1,'successfulComparisons':success,'abstentions':len(results)-success,'failures':0,'executionStatus':'PARTIAL','reason':GAP}
    return output
