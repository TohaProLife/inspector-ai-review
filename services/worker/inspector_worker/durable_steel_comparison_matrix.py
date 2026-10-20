"""Additive v10 durable release: scalar plus six reviewed typed domains.

The protected loader authenticates persisted reviews. This worker validates the
complete six-domain projection and every retained claim before any extraction.
No legacy release is fabricated or delegated for execution.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import time
from typing import Any
import urllib.parse

from inspector_worker import durable_inventory_matrix as _base
from inspector_worker import durable_water_node_matrix as _v8
from inspector_worker import durable_lighting_technology_matrix as _v9
from inspector_worker import steel_execution, steel_comparison
from inspector_worker import lighting_technology_source_v3, lighting_technology_comparison, lighting_technology_execution, document_text_v3
from inspector_worker import durable_call_inventory_matrix as _v6
from inspector_worker import durable_rail_inventory_matrix as _v7
from inspector_worker import water_node_source, water_node_comparison, water_node_execution
from inspector_worker import rail_inventory_source, rail_inventory_comparison, rail_inventory_execution
from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose
from inspector_worker import rebar_prose, concrete_prose, source_declarations, source_declarations_v2
from inspector_worker import steel_prose, fire_resistance_table, table_row_binding
from inspector_worker import inventory_execution, call_inventory_execution, call_inventory_source
from inspector_worker import odi123_call_inventory_comparison
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.durable_text import download_text_artifact, TextArtifactLeaseLost

PROFILE_ID='matrix-text-facts-steel-comparison-v10'
ADAPTER_VERSION='10'
BASE_PROFILE_ID='matrix-text-facts-lighting-technology-v9'
BASE_CONFIG_HASH='c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84'
LOADER_SCHEMA='matrix-reviewed-inventory-loader-inputs-v6'
MAX_LOADER_BYTES=67108864
LOADER_SOCKET_DEADLINE_SECONDS=60
_canonical=_base._canonical
_sha=_base._sha
_file=_base._file
_SHA=re.compile(r'[a-f0-9]{64}\Z')
_UUID=re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z')
_REVIEW_FIELDS=('decisionId','contentHash','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages')
_SNAPSHOT_DOMAIN='matrix-kr056-steel-applicability-run-snapshot-json-v1'


def _native_json(value:Any,*,snapshot:bool=False,lease_metadata:bool=False)->None:
    """Descriptor-free native boundary; outer duplicates six independent children.

    Exact child budgets remain enforced by each frozen validator. The outer
    transport budget deliberately is not the smaller single-child budget.
    """
    active:set[int]=set()
    nodes=0
    def walk(item:Any,depth:int)->None:
        nonlocal nodes
        nodes+=1
        if nodes>(200000 if snapshot else 1400064) or depth>(64 if snapshot else 66):raise ValueError('INPUT_LIMIT')
        kind=type(item)
        if kind is str:
            if len(item)>2000000:raise ValueError('INPUT_LIMIT')
            if any(0xd800<=ord(c)<=0xdfff for c in item):raise ValueError('INVALID_INPUT')
        elif kind is int:
            if abs(item)>9007199254740991:raise ValueError('INVALID_INPUT')
        elif kind is float and lease_metadata:
            if not math.isfinite(item) or abs(item)>9007199254740991:raise ValueError('INVALID_INPUT')
        elif kind is bool or item is None:return
        elif kind is dict or kind is list:
            if len(item)>32768:raise ValueError('INPUT_LIMIT')
            ident=id(item)
            if ident in active:raise ValueError('INVALID_INPUT')
            active.add(ident)
            if kind is dict:
                for key,child in dict.items(item):
                    if type(key) is not str or not key.isascii():raise ValueError('INVALID_INPUT')
                    walk(key,depth+1);walk(child,depth+1)
            else:
                for child in item:walk(child,depth+1)
            active.remove(ident)
        else:raise ValueError('INVALID_INPUT')
    walk(value,0)
    if len(_canonical(value).encode('utf-8'))>(524288 if snapshot else MAX_LOADER_BYTES):raise ValueError('INPUT_LIMIT')


def _validate_snapshot(value:Any,steel:dict[str,Any])->dict[str,Any]:
    """Run pointer integrity, not independent authentication of journal actors.

    The protected loader authenticates complete stored journals and excluded
    historical contexts. This boundary verifies their pinned pointer bijection.
    """
    _native_json(value,snapshot=True)
    if (type(value) is not dict or set(value)!={'schemaVersion','objectId','inputManifestHash','entries','contentHash'}
            or value['schemaVersion']!='matrix-steel-applicability-run-snapshot-v1'
            or value['objectId']!=steel['objectId'] or value['inputManifestHash']!=steel['inputManifestHash']
            or type(value['contentHash']) is not str or not _SHA.fullmatch(value['contentHash'])
            or type(value['entries']) is not list or len(value['entries'])>16):
        raise ValueError('invalid steel applicability run snapshot')
    body={k:v for k,v in value.items() if k!='contentHash'}
    if value['contentHash']!=_sha({'hashDomain':_SNAPSHOT_DOMAIN,'snapshot':body}):raise ValueError('steel applicability snapshot hash mismatch')
    decisions={d['decisionId']:d for d in steel['applicabilityDecisions']}
    seen:set[str]=set();included:set[str]=set();previous=None
    for entry in value['entries']:
        if (type(entry) is not dict or set(entry)!={'pairKey','decisionId','sequenceNo','journalContentHash','projectionContentHash','included'}
                or any(type(entry[k]) is not str or not _SHA.fullmatch(entry[k]) for k in ('pairKey','journalContentHash','projectionContentHash'))
                or type(entry['decisionId']) is not str or not _UUID.fullmatch(entry['decisionId'])
                or type(entry['included']) is not bool):raise ValueError('invalid steel applicability snapshot entry')
        sequence=entry['sequenceNo']
        if (type(sequence) is not str or re.fullmatch(r'[1-9][0-9]*',sequence) is None
                or len(sequence)>19 or len(sequence)==19 and sequence>'9223372036854775807'):
            raise ValueError('invalid steel applicability snapshot sequence')
        key,ident=entry['pairKey'],entry['decisionId']
        if ident in seen or previous is not None and key<=previous:raise ValueError('steel applicability snapshot order or duplicate')
        seen.add(ident);previous=key
        decision=decisions.get(ident)
        if entry['included']:
            if decision is None or decision['contentHash']!=entry['projectionContentHash']:raise ValueError('steel applicability projection mismatch')
            expected_key=_sha({'hashDomain':'matrix-kr056-steel-applicability-pair-key-v1','objectId':steel['objectId'],
                'identity':decision['identity'],'expectedSourceFileId':decision['expected']['sourceFileId'],
                'actualSourceFileId':decision['actual']['sourceFileId']})
            if key!=expected_key:raise ValueError('steel applicability pair key mismatch')
            included.add(ident)
        elif decision is not None:raise ValueError('excluded steel applicability projection present')
    if included!=set(decisions):raise ValueError('steel applicability snapshot projection omission')
    return deepcopy(value)


def _steel_policy(registry:dict[str,Any])->dict[str,Any]:
    return {'schemaVersion':'matrix-steel-comparisons-v1','purpose':'MACHINE_COMPARISON',
        'baseProfileId':BASE_PROFILE_ID,'baseConfigHash':BASE_CONFIG_HASH,
        'capabilityRegistry':registry,'capabilityRegistryHash':_sha(registry),
        'comparisonVersion':'matrix-kr056-steel-comparison-v1','comparisonSourceSha256':_file(steel_comparison),
        'sourceReconstructionVersion':'matrix-source-declarations-v1','sourceReconstructionSourceSha256':_file(source_declarations),
        'typedExecutionVersion':'matrix-steel-execution-v1','typedExecutionSourceSha256':_file(steel_execution),
        'durableWrapperVersion':'matrix-steel-execution-v1','durableWrapperSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coveragePolicyVersion':'matrix-steel-coverage-v1','submissionPolicyVersion':'matrix-steel-submission-v1',
        'hashPolicyVersion':'matrix-steel-comparison-result-json-v1',
        'applicabilitySnapshotPolicyVersion':'matrix-steel-applicability-run-snapshot-v1',
        'confidencePolicy':{'policyVersion':'machine-confidence-policy-v2','warningThresholdBasisPoints':8000,
            'thresholdComparison':'STRICTLY_GREATER','expectedCalibrationVersion':None,
            'sourceSha256':'f3436ef404d494849e3a64affde3c6cf4e86e4336228b3dd7071eef1c0cc70d0'}}


def _load_capability_registries()->tuple[dict[str,Any],...]:
    old=_v9._load_capability_registries()
    steel=json.loads((Path(__file__).resolve().parents[1]/'rules'/'matrix-steel-comparison-capabilities-v1.json').read_text())
    return (*old,steel)


def _validate_release(lease:dict[str,Any],inventory_registry:dict[str,Any],call_registry:dict[str,Any],
        rail_registry:dict[str,Any],water_registry:dict[str,Any],lighting_registry:dict[str,Any],steel_registry:dict[str,Any])->tuple[dict[str,Any],str]:
    _native_json(lease,lease_metadata=True)
    for registry in (inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry):_native_json(registry)
    if type(lease) is not dict:raise ValueError('invalid steel lease')
    release=lease.get('release');slot=release.get('providerSlot') if type(release) is dict else None
    definitions=release.get('rules',{}).get('matrixDefinitions') if type(release) is dict and type(release.get('rules')) is dict else None
    if (type(slot) is not dict or release.get('lifecycle')!='DRAFT'
            or release.get('externalNetworkAllowed') is not False
            or slot.get('profileId')!=PROFILE_ID or slot.get('adapterVersion')!=ADAPTER_VERSION
            or slot.get('providerKind')!='RULE_ENGINE' or slot.get('stageJobType')!='RULE_EVALUATION'
            or slot.get('status')!='CONFIGURED' or type(definitions) is not dict):
        raise ValueError('invalid lighting technology matrix release')
    v9={k:v for k,v in definitions.items() if k!='steelExecution'}
    if (_sha(v9)!=BASE_CONFIG_HASH
            or _canonical(definitions.get('steelExecution'))!=_canonical(_steel_policy(steel_registry))
            or _canonical(v9.get('lightingTechnologyExecution'))!=_canonical(_v9._lighting_technology_policy(lighting_registry))):
        raise ValueError('steel definitions differ from frozen v9 or typed policies')
    v8={k:v for k,v in v9.items() if k!='lightingTechnologyExecution'}
    if (_sha(v8)!=_v9.BASE_CONFIG_HASH
            or _canonical(v9.get('lightingTechnologyExecution'))!=_canonical(_v9._lighting_technology_policy(lighting_registry))
            or _canonical(v8.get('waterNodeExecution'))!=_canonical(_v8._water_node_policy(water_registry))):
        raise ValueError('lighting definitions differ from frozen v8 or typed policies')
    v7={k:v for k,v in v8.items() if k!='waterNodeExecution'}
    if (_sha(v7)!=_v8.BASE_CONFIG_HASH
            or _canonical(v7.get('railExecution'))!=_canonical(_v7._rail_inventory_policy(rail_registry))):
        raise ValueError('lighting base differs from frozen v7')
    v6={k:v for k,v in v7.items() if k!='railExecution'}
    if (_sha(v6)!=_v7.BASE_CONFIG_HASH
            or _canonical(v7.get('railExecution'))!=_canonical(_v7._rail_inventory_policy(rail_registry))
            or _canonical(v6.get('callInventoryExecution'))!=_canonical(_v6._call_inventory_policy(call_registry))):
        raise ValueError('rail inventory definitions differ from frozen v6 or typed policies')
    v5={k:v for k,v in v6.items() if k!='callInventoryExecution'}
    if (_sha(v5)!=_v6.BASE_CONFIG_HASH
            or _canonical(v5.get('inventoryExecution'))!=_canonical(_base._inventory_policy(inventory_registry))):
        raise ValueError('lighting technology base differs from frozen v5')
    v4={k:v for k,v in v5.items() if k!='inventoryExecution'}
    if _sha(v4)!=_base.BASE_CONFIG_HASH:raise ValueError('lighting technology base differs from frozen v4')
    direct=[(v4['engineSourceSha256'],matrix_engine),(v4['factScopeSourceSha256'],matrix_fact_scope),
        (v4['projectZeroProse']['sourceSha256'],project_zero_prose),
        (v4['rebarProse']['sourceSha256'],rebar_prose),(v4['concreteProse']['sourceSha256'],concrete_prose),
        (v4['projectConstraints']['sourceSha256'],project_constraints)]
    declaration=v4['sourceDeclarations']
    direct.extend([(declaration['sourceSha256'],source_declarations_v2),
        (declaration['legacySourceSha256'],source_declarations),(declaration['steelSourceSha256'],steel_prose),
        (declaration['fireSourceSha256'],fire_resistance_table),(declaration['tableBindingSourceSha256'],table_row_binding)])
    if any(expected!=_file(module) for expected,module in direct) or _canonical(v4['registry'])!=_canonical(matrix_engine.load_matrix_registry()):
        raise ValueError('lighting technology base runtime source differs from frozen release')
    inventory_execution._registry(inventory_registry)
    call_inventory_execution._registry(call_registry)
    rail_inventory_execution._registry(rail_registry)
    water_node_execution._registry(water_registry)
    lighting_technology_execution._registry(lighting_registry)
    steel_execution._registry(steel_registry)
    config_hash=_sha(definitions)
    if slot.get('configHash')!=config_hash:raise ValueError('lighting technology matrix config hash mismatch')
    return slot,config_hash


def _unique_object(pairs:list[tuple[str,Any]])->dict[str,Any]:
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate reviewed inventory loader JSON key')
        result[key]=value
    return result


def _reject_constant(value:str)->None:
    raise ValueError('non-JSON numeric constant in reviewed inventory loader')


def _safe_json_int(value:str)->int:
    parsed=int(value)
    if abs(parsed)>9007199254740991:raise ValueError('unsafe integer in reviewed inventory loader')
    return parsed


def download_reviewed_inventory_comparison_inputs(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    job_id=lease.get('jobId');attempt_id=attempt.get('attemptId');fence=attempt.get('fencingToken')
    if type(job_id) is not str or not job_id or type(attempt_id) is not str or not attempt_id or type(fence) is not int or fence<1:
        raise ValueError('invalid reviewed inventory loader lease')
    api=urllib.parse.urlsplit(os.environ['INSPECTOR_API_INTERNAL_URL'])
    if api.scheme not in {'http','https'} or not api.hostname or api.username or api.password:raise ValueError('invalid internal API URL')
    path='/api/internal/v1/jobs/{}/steel-reviewed-inventory-comparison-inputs?{}'.format(urllib.parse.quote(job_id,safe=''),urllib.parse.urlencode({'attemptId':attempt_id,'fencingToken':fence}))
    constructor=http.client.HTTPSConnection if api.scheme=='https' else http.client.HTTPConnection
    deadline=time.monotonic()+LOADER_SOCKET_DEADLINE_SECONDS
    connection=constructor(api.hostname,port=api.port,timeout=LOADER_SOCKET_DEADLINE_SECONDS)
    response=None
    try:
        connection.request('GET',path,headers={'X-Worker-Token':os.environ['INTERNAL_WORKER_TOKEN']})
        stream_socket=connection.sock
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('reviewed inventory loader deadline exceeded')
        stream_socket.settimeout(remaining)
        response=connection.getresponse()
        if response.status==409:raise TextArtifactLeaseLost('reviewed inventory loader attempt is stale or terminal')
        if response.status!=200:raise ValueError('reviewed inventory loader returned HTTP {}'.format(response.status))
        length=response.getheader('Content-Length');digest=response.getheader('X-Content-SHA256')
        if not length or re.fullmatch(r'[0-9]+',length) is None or not 0<int(length)<=MAX_LOADER_BYTES:raise ValueError('invalid reviewed inventory loader length')
        if type(digest) is not str or not _SHA.fullmatch(digest):raise ValueError('invalid reviewed inventory loader content hash')
        if (response.getheader('X-Artifact-Schema-Version')!=LOADER_SCHEMA
                or response.getheader('X-Input-Manifest-SHA256')!=lease.get('inputManifestHash')):
            raise ValueError('reviewed inventory loader headers differ from lease')
        chunks=[];size=0
        while size<int(length):
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('reviewed inventory loader deadline exceeded')
            stream_socket.settimeout(remaining)
            chunk=response.read1(min(65536,int(length)-size))
            if not chunk:break
            size+=len(chunk)
            if size>int(length) or size>MAX_LOADER_BYTES:raise ValueError('reviewed inventory loader oversized body')
            chunks.append(chunk)
        body=b''.join(chunks)
        if len(body)!=int(length) or hashlib.sha256(body).hexdigest()!=digest:raise ValueError('reviewed inventory loader body hash/size mismatch')
        result=json.loads(body.decode('utf-8'),object_pairs_hook=_unique_object,parse_constant=_reject_constant,parse_float=_reject_constant,parse_int=_safe_json_int)
    finally:
        if response is not None:response.close()
        connection.close()
    if (type(result) is not dict or set(result)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot'}
            or result.get('schemaVersion')!=LOADER_SCHEMA or result.get('objectId')!=lease.get('objectId')
            or result.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('reviewed inventory loader differs from current lease')
    return result


def _validate_loader(package:Any,lease:dict[str,Any])->dict[str,Any]:
    _native_json(package)
    _native_json(lease,lease_metadata=True)
    if (type(package) is not dict or set(package)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot'}
            or package.get('schemaVersion')!=LOADER_SCHEMA or package.get('objectId')!=lease.get('objectId')
            or package.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('invalid steel reviewed inventory loader envelope')
    steel=steel_execution.validate_steel_comparison_loader_package(package['steelComparison'])
    # Frozen pure five-domain input validation only. The v10 lease and release
    # remain intact. No legacy release execution or qualification is delegated.
    old_projection={k:package[k] for k in ['objectId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology']}
    old_projection['schemaVersion']=_v9.LOADER_SCHEMA
    verified=_v9._validate_loader(old_projection,lease)
    if steel['objectId']!=package['objectId'] or steel['inputManifestHash']!=package['inputManifestHash']:
        raise ValueError('steel package association mismatch')
    def common(sources:list[dict[str,Any]])->dict[str,Any]:
        result={}
        for source in sources:
            review=source['review']
            result[source['sourceFileId']]={'sourceFileId':source['sourceFileId'],'sourceSha256':source['sourceSha256'],
                'stages':source['stages'],'review':{k:review[k] for k in _REVIEW_FIELDS} if review is not None else None}
        return result
    shared=common(steel['sources'])
    if _canonical(shared)!=_canonical(common(verified['waterNode']['sources'])):
        raise ValueError('steel reviewed source projections disagree')
    inputs=lease.get('inputs')
    if type(inputs) is not dict or type(inputs.get('sourceFiles')) is not list or type(inputs.get('sourceDecisions',{})) is not dict:
        raise ValueError('steel lease has no immutable source inputs')
    committed={}
    decisions=inputs.get('sourceDecisions',{})
    lease_review_fields=('revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages')
    for source in inputs['sourceFiles']:
        sid=source.get('sourceFileId')
        if type(sid) is not str or sid in committed:raise ValueError('duplicate or invalid committed source')
        decision=decisions.get(sid)
        _reviewed_source(source,decision)
        committed[sid]={'sourceFileId':sid,'sourceSha256':source.get('sha256'),'stages':source.get('stages'),
            'review':{k:decision[k] for k in lease_review_fields} if type(decision) is dict else None}
    if any(sid not in committed for sid in decisions):raise ValueError('orphan immutable lease source decision')
    # JobLease deliberately carries scalar metadata, not review IDs/hashes.
    # The protected loader and each typed package bind complete frozen review
    # pointers; compare only the actual lease fields, never fabricate pointers.
    shared_lease={sid:{**row,'review':{k:row['review'][k] for k in lease_review_fields} if row['review'] is not None else None} for sid,row in shared.items()}
    if _canonical(committed)!=_canonical(shared_lease):raise ValueError('steel loader differs from immutable lease sources')
    snapshot=_validate_snapshot(package['steelApplicabilitySnapshot'],steel)
    return {**verified,'schemaVersion':LOADER_SCHEMA,'steelComparison':steel,'steelApplicabilitySnapshot':snapshot}


def execute_durable_steel_comparison_matrix(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry=_load_capability_registries()
    slot,config_hash=_validate_release(lease,inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry)
    package=_validate_loader(download_reviewed_inventory_comparison_inputs(lease,attempt),lease)
    inventory=inventory_execution.build_inventory_comparisons(package['inventory'],inventory_registry)
    call=call_inventory_execution.build_call_inventory_comparisons(package['callInventory'],call_registry)
    rail=rail_inventory_execution.build_rail_inventory_comparisons(package['railInventory'],rail_registry)
    water=water_node_execution.build_water_node_comparisons(package['waterNode'],water_registry)
    lighting=lighting_technology_execution.build_lighting_technology_comparisons(package['lightingTechnology'],lighting_registry)
    steel=steel_execution.build_steel_comparisons(package['steelComparison'],steel_registry)
    inputs=lease['inputs'];sources=[];artifacts=[]
    for source in inputs['sourceFiles']:
        decision=inputs.get('sourceDecisions',{}).get(source['sourceFileId'])
        sources.append({**source,**_reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
        if source.get('mediaType')=='application/pdf':artifacts.append(download_text_artifact(lease,source,attempt))
    execution=matrix_engine.build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=artifacts,registry=matrix_engine.load_matrix_registry())
    coverage=inventory_execution.merge_inventory_coverage(execution['coverage'],inventory,inventory_registry)
    coverage=call_inventory_execution.merge_call_inventory_coverage(coverage,call,call_registry)
    coverage=rail_inventory_execution.merge_rail_inventory_coverage(coverage,rail,rail_registry)
    coverage=water_node_execution.merge_water_node_coverage(coverage,water,water_registry)
    coverage=lighting_technology_execution.merge_lighting_technology_coverage(coverage,lighting,lighting_registry)
    coverage=steel_execution.merge_steel_comparison_coverage(coverage,steel,steel_registry)
    return {'schemaVersion':'analysis-stage-result-v2','jobType':'RULE_EVALUATION','inputManifestHash':lease['inputManifestHash'],
        'disposition':'RULES_EVALUATED','providerKind':'RULE_ENGINE','providerProfileId':slot['profileId'],
        'providerConfigHash':config_hash,'outputCount':len(execution['results'])+len(inventory['results'])+len(call['results'])+len(rail['results'])+len(water['results'])+len(lighting['results'])+len(steel['results']),
        'execution':execution,'projectConstraints':project_constraints.extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,artifacts),
        'sourceDeclarations':source_declarations_v2.extract_source_declarations({'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':artifacts}),
        'inventoryComparisons':inventory,'callInventoryComparisons':call,'railInventoryComparisons':rail,'waterNodeComparisons':water,'lightingTechnologyComparisons':lighting,'steelComparisons':steel,'steelApplicabilitySnapshot':deepcopy(package['steelApplicabilitySnapshot']),'effectiveCoverage':coverage}
