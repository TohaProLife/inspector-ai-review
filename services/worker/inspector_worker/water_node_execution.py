"""Typed water-node comparisons over complete supplied immutable projections.

Byte consistency is verified here; database provenance, actor authorization and
original PDF byte authentication remain the repository loader's responsibility.
No old scalar observations, profiles or confidence probabilities are changed.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any
from . import water_node_comparison as c
from .table_row_binding import _portable_error, _text
from .source_declarations import canonical_source_declaration_json, _valid_artifact
from .water_node_source import reconstruct_zu129_water_node_source, water_node_inventory_content_hash

_RULE='matrix-zu-129-declared_cold_water_inlet_meter_omission'
_COMMON={'schemaVersion':'matrix-water-node-execution-result-v1','ruleId':_RULE,'ruleVersion':'1','parameterCode':'ZU-129','comparisonVariant':'PD_RD'}
_INTEGRITY={'INVALID_INPUT','INPUT_LIMIT','SOURCE_PROVENANCE_UNVERIFIED','INVENTORY_RECONSTRUCTION_UNVERIFIED'}
_OPERATIONAL={'SOURCE_STAGE_UNVERIFIED','NODE_IDENTITY_CONFLICT','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','NODE_MAPPING_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED','NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED'}
_RESOURCE=Path(__file__).parent.parent/'rules'
WATER_NODE_CAPABILITY_REGISTRY=json.loads((_RESOURCE/'matrix-water-node-capabilities-v1.json').read_text())
# A detached public constant is convenient for callers; the private canonical
# pin also prevents mutation of that object from redefining the approved atom.
_REGISTRY_JSON=canonical_source_declaration_json(WATER_NODE_CAPABILITY_REGISTRY)
WATER_NODE_CAPABILITY_REGISTRY_HASH=hashlib.sha256(_REGISTRY_JSON.encode()).hexdigest()
_SCALAR_ENTRIES=json.loads((_RESOURCE/'matrix-execution-v1.json').read_text())['entries']
_SCALAR_CODES=tuple(r['parameterCode'] for r in _SCALAR_ENTRIES)
_SCALAR_RULE_IDS=frozenset(rule['ruleId'] for entry in _SCALAR_ENTRIES for rule in entry['atomicRules'])
_COVERAGE_COUNTERS={'implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'}


def _fail(reason: str='INVALID_INPUT') -> None:
    raise ValueError(reason)


def _native(value: Any) -> None:
    error=_portable_error(value)
    if error:_fail('INPUT_LIMIT' if error=='LIMIT' else 'INVALID_INPUT')


def _canonical(value: Any) -> str:
    return canonical_source_declaration_json(value)


def _registry(value: Any) -> None:
    _native(value)
    if _canonical(value)!=_REGISTRY_JSON:_fail()


def _identity_list(sources: list[dict]) -> list[dict]:
    unique={_canonical(claim['identity']):claim['identity'] for source in sources for claim in c._claims(source)}
    return [deepcopy(unique[key]) for key in sorted(unique)]


def _sources(sources: Any, object_id: str|None=None) -> None:
    if type(sources) is not list:_fail()
    if len(sources)>64:_fail('INPUT_LIMIT')
    if not all(c._source(source) for source in sources):_fail()
    seen=set();total=0
    for source in sources:
        sid=source['sourceFileId'];review=source['review'];pointer=source['reviewSnapshot']
        if sid in seen:_fail('SOURCE_PROVENANCE_UNVERIFIED')
        seen.add(sid)
        if review is not None:
            if (review['sourceFileId']!=sid or review['sourceSha256']!=source['sourceSha256']
                    or review['decisionId']!=pointer['decisionId'] or review['contentHash']!=pointer['contentHash']
                    or object_id is not None and review['objectId']!=object_id):_fail('SOURCE_PROVENANCE_UNVERIFIED')
            scope=review['waterNodeScope']
            if scope is not None:
                if c.project_water_node_scope_decision(scope) is None:_fail('SOURCE_PROVENANCE_UNVERIFIED')
                for claim in scope['claims']:
                    snap=claim['inventorySnapshot']
                    if snap['sourceFileId']!=sid or snap['sourceSha256']!=source['sourceSha256']:_fail('SOURCE_PROVENANCE_UNVERIFIED')
        total+=len(c._claims(source))
        if total>128:_fail('INPUT_LIMIT')


def derive_water_node_identities(sources: Any) -> list[dict]:
    """Strict stored-scope consistency only; no original or DB authentication."""
    _native(sources);_sources(sources)
    return _identity_list(sources)


def validate_water_node_loader_package(value: Any) -> dict:
    _native(value)
    if (not c._exact(value,{'schemaVersion','objectId','inputManifestHash','sources','origins','identities'})
            or value['schemaVersion']!='matrix-zu129-water-node-loader-inputs-v1'
            or not c._k(value['objectId']) or not c._sha(value['inputManifestHash'])
            or type(value['origins']) is not list or type(value['identities']) is not list):_fail()
    if len(value['origins'])>128 or len(value['identities'])>128:_fail('INPUT_LIMIT')
    _sources(value['sources'],value['objectId'])
    if not all(c._identity(i) for i in value['identities']):_fail()
    if value['identities']!=_identity_list(value['sources']):_fail()
    sources={s['sourceFileId']:s for s in value['sources']};origins={}
    for origin in value['origins']:
        if not c._origin(origin):_fail()
        key=(origin['sourceFileId'],origin['checkId']);source=sources.get(origin['sourceFileId'])
        if key in origins or source is None or origin['objectId']!=value['objectId'] or origin['sourceSha256']!=source['sourceSha256']:_fail('SOURCE_PROVENANCE_UNVERIFIED')
        artifact=origin['textArtifact']
        if (not _valid_artifact(artifact) or artifact['pageCount']>512 or artifact['sourceFileId']!=origin['sourceFileId']
                or artifact['inputSha256']!=origin['sourceSha256'] or c._text_hash(artifact)!=origin['textArtifactHash']):_fail('SOURCE_PROVENANCE_UNVERIFIED')
        review=source['review']
        if review is not None and any(int(page)>artifact['pageCount'] for page in review['pageStages']):_fail('SOURCE_PROVENANCE_UNVERIFIED')
        origins[key]=origin
    for source in value['sources']:
        for claim in c._claims(source):
            target=claim['target'];snap=claim['inventorySnapshot'];origin=origins.get((source['sourceFileId'],target['checkId']))
            if origin is None or any(target[k]!=origin[k] for k in ('inputManifestHash','textStageContentHash','textArtifactHash')):_fail('SOURCE_PROVENANCE_UNVERIFIED')
            rebuilt=reconstruct_zu129_water_node_source({'sourceFileId':source['sourceFileId'],'sourceSha256':source['sourceSha256'],
                'stage':snap['stage'],'pageStages':{},'textArtifact':origin['textArtifact'],'selection':claim['selection']})
            if (rebuilt['status']!='RECONSTRUCTED' or rebuilt['inventory']!=snap
                    or water_node_inventory_content_hash(snap)!=target['inventoryContentHash']):_fail('INVENTORY_RECONSTRUCTION_UNVERIFIED')
    return deepcopy(value)


def _result_id(envelope: dict, body: dict) -> str:
    return hashlib.sha256(_canonical({'hashDomain':'matrix-water-node-execution-result-id-v1',
        'objectId':envelope['objectId'],'inputManifestHash':envelope['inputManifestHash'],
        'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':body}).encode()).hexdigest()


def build_water_node_comparisons(value: Any, registry: Any=WATER_NODE_CAPABILITY_REGISTRY) -> dict:
    _registry(registry);package=validate_water_node_loader_package(value)
    envelope={'schemaVersion':'matrix-water-node-comparisons-v1','purpose':'MACHINE_COMPARISON','objectId':package['objectId'],
        'inputManifestHash':package['inputManifestHash'],'capabilityRegistryHash':WATER_NODE_CAPABILITY_REGISTRY_HASH,'results':[]}
    for identity in package['identities']:
        comparison=c.compare_zu129_water_node_inventories({'schemaVersion':'matrix-zu129-water-node-input-v1',
            'objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],'identity':identity,
            'sources':package['sources'],'origins':package['origins']})
        if comparison['status']=='ABSTAIN' and comparison['reasonCode'] in _INTEGRITY:_fail(comparison['reasonCode'])
        body={**_COMMON,'kind':'SCOPED_COMPARISON','identity':identity,'comparison':comparison}
        envelope['results'].append({'id':_result_id(envelope,body),**body})
    if not envelope['results']:
        body={**_COMMON,'kind':'UNBOUND_ATOM_ABSTENTION','reasonCode':'REVIEWED_WATER_NODE_IDENTITY_MISSING','calibratedProbability':None}
        envelope['results'].append({'id':_result_id(envelope,body),**body})
    return envelope


def _reference(value: Any) -> bool:
    return (c._exact(value,{'sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','inventoryContentHash'})
        and c._k(value['sourceFileId']) and c._k(value['reviewDecisionId'])
        and all(c._sha(value[k]) for k in ('sourceSha256','reviewContentHash','inventoryContentHash')))


def _comparison(value: Any, identity: dict) -> bool:
    if type(value) is not dict:return False
    if value.get('status')=='ABSTAIN':
        return c._exact(value,{'schemaVersion','status','reasonCode','calibratedProbability'}) and value['schemaVersion']==c._SCHEMA and c._enum(value['reasonCode'],_OPERATIONAL) and value['calibratedProbability'] is None
    return (c._exact(value,{'schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode','calibratedProbability','comparisonScope','identity','expected','actual','missingFeatureKeys'})
        and value['schemaVersion']==c._SCHEMA and value['status']=='CANDIDATE' and value['ruleId']==_RULE and value['ruleVersion']=='1'
        and value['parameterCode']=='ZU-129' and value['reasonCode']=='WATER_METER_NOT_LISTED_IN_REVIEWED_RD_NODE_COMPONENTS'
        and value['calibratedProbability'] is None and value['comparisonScope']=='REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS_ONLY'
        and value['identity']==identity and _reference(value['expected']) and _reference(value['actual'])
        and value['expected']['sourceFileId']!=value['actual']['sourceFileId'] and value['missingFeatureKeys']==['WATER_METER'])


def validate_water_node_comparisons(value: Any) -> dict:
    _native(value)
    if (not c._exact(value,{'schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'})
        or value['schemaVersion']!='matrix-water-node-comparisons-v1' or value['purpose']!='MACHINE_COMPARISON'
        or not c._k(value['objectId']) or not c._sha(value['inputManifestHash']) or value['capabilityRegistryHash']!=WATER_NODE_CAPABILITY_REGISTRY_HASH
        or type(value['results']) is not list or not 1<=len(value['results'])<=128):_fail()
    ids=set();identities=[]
    for row in value['results']:
        if type(row) is not dict or any(row.get(k)!=v for k,v in _COMMON.items()) or not c._sha(row.get('id')):_fail()
        if row.get('kind')=='UNBOUND_ATOM_ABSTENTION':
            if (len(value['results'])!=1 or set(row)!=set(_COMMON)|{'id','kind','reasonCode','calibratedProbability'}
                or row['reasonCode']!='REVIEWED_WATER_NODE_IDENTITY_MISSING' or row['calibratedProbability'] is not None):_fail()
        elif row.get('kind')=='SCOPED_COMPARISON':
            if set(row)!=set(_COMMON)|{'id','kind','identity','comparison'} or not c._identity(row['identity']) or not _comparison(row['comparison'],row['identity']):_fail()
            identities.append(_canonical(row['identity']))
        else:_fail()
        body={k:v for k,v in row.items() if k!='id'}
        if row['id'] in ids or _result_id(value,body)!=row['id']:_fail()
        ids.add(row['id'])
    if identities!=sorted(set(identities)):_fail()
    return deepcopy(value)

validate_water_node_comparisons_envelope=validate_water_node_comparisons


def water_node_comparison_evidence(value: Any, envelope: Any, registry: Any=WATER_NODE_CAPABILITY_REGISTRY) -> list[dict]:
    _native(envelope);expected=build_water_node_comparisons(value,registry)
    if expected!=envelope:_fail('INVENTORY_RECONSTRUCTION_UNVERIFIED')
    output=[]
    for row in expected['results']:
        if row['kind']!='SCOPED_COMPARISON' or row['comparison']['status']!='CANDIDATE':continue
        for role,key in [('EXPECTED','expected'),('ACTUAL','actual')]:
            ref=row['comparison'][key]
            matches=[(s,claim) for s in value['sources'] for claim in c._claims(s)
                if claim['identity']==row['identity'] and s['sourceFileId']==ref['sourceFileId']
                and s['sourceSha256']==ref['sourceSha256'] and s['review']['decisionId']==ref['reviewDecisionId']
                and s['review']['contentHash']==ref['reviewContentHash'] and claim['target']['inventoryContentHash']==ref['inventoryContentHash']]
            if len(matches)!=1:_fail('SOURCE_PROVENANCE_UNVERIFIED')
            source,claim=matches[0];snap=claim['inventorySnapshot'];seen=set()
            groups=[('HEADER',snap['headerFragments']),('SCOPE',snap['scopeFragments']),('END',snap['endFragments'])]
            groups.extend(('FEATURE',feature['fragments']) for feature in snap['featureRows'])
            for fragment_role,fragments in groups:
                for fragment in fragments:
                    unique=(fragment_role,_canonical(fragment))
                    if unique in seen:continue
                    seen.add(unique)
                    output.append({'resultId':row['id'],'role':role,**ref,'originCheckId':claim['target']['checkId'],
                        'pageNumber':snap['pageNumber'],'pageFrame':{k:snap[k] for k in ('widthMilliPoints','heightMilliPoints')},
                        'fragmentRole':fragment_role,'fragment':deepcopy(fragment)})
    return output


def merge_water_node_coverage(coverage: Any, envelope: Any, registry: Any=WATER_NODE_CAPABILITY_REGISTRY) -> list[dict]:
    _registry(registry);_native(coverage);validated=validate_water_node_comparisons(envelope)
    if type(coverage) is not list or len(coverage)!=132 or len(_SCALAR_CODES)!=132 or _RULE in _SCALAR_RULE_IDS:_fail()
    for index,row in enumerate(coverage):
        if (not c._exact(row,_COVERAGE_COUNTERS|{'parameterCode','executionStatus','reason'})
            or row['parameterCode']!=_SCALAR_CODES[index] or not all(c._int(row[k]) for k in _COVERAGE_COUNTERS)
            or not c._enum(row['executionStatus'],{'UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'}) or type(row['reason']) is not str):_fail()
    index=_SCALAR_CODES.index('ZU-129');target=coverage[index]
    if target['executionStatus']!='UNSUPPORTED' or any(target[k]!=0 for k in _COVERAGE_COUNTERS):_fail()
    output=deepcopy(coverage);success=sum(row['kind']=='SCOPED_COMPARISON' and row['comparison']['status']=='CANDIDATE' for row in validated['results'])
    output[index]={'parameterCode':'ZU-129','implementedAtomicRules':1,'enabledAtomicRules':1,'evaluatedAtomicRules':1,
        'successfulComparisons':success,'abstentions':len(validated['results'])-success,'failures':0,'executionStatus':'PARTIAL',
        'reason':json.loads(_REGISTRY_JSON)['entries'][0]['partialGap']}
    return output
