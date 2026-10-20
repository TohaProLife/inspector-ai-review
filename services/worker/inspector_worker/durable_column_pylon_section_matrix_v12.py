"""Own v12 durable execution: scalar plus seven reviewed typed domains.

Full immutable v11 dependency definitions are retained; no archived lease or
execution entrypoint is fabricated. New child uses public object ID, while
normal run, old six children and lease retain internal object UUID.
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
from inspector_worker import durable_steel_comparison_matrix_v11 as _v11
from inspector_worker import column_pylon_section_execution, column_pylon_section_run_snapshot
from inspector_worker import column_pylon_section_v2, column_pylon_dimension_literals
from inspector_worker import lighting_technology_source_v3, lighting_technology_comparison, lighting_technology_execution, document_text_v3
from inspector_worker import durable_call_inventory_matrix as _v6
from inspector_worker import durable_rail_inventory_matrix as _v7
from inspector_worker import water_node_source, water_node_comparison, water_node_execution
from inspector_worker import rail_inventory_source, rail_inventory_comparison, rail_inventory_execution
from inspector_worker import matrix_scalar_prepared_v12
from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose
from inspector_worker import rebar_prose, concrete_prose, source_declarations, source_declarations_v2
from inspector_worker import steel_prose, fire_resistance_table, table_row_binding
from inspector_worker import inventory_execution, call_inventory_execution, call_inventory_source
from inspector_worker import odi123_call_inventory_comparison
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.durable_text import download_text_artifact, TextArtifactLeaseLost

PROFILE_ID='matrix-text-facts-column-pylon-section-v12'
ADAPTER_VERSION='12'
# This is a dependency-definition shape, never permission to execute archived v9.
BASE_PROFILE_ID='matrix-text-facts-lighting-technology-v9'
BASE_CONFIG_HASH='a72fec74e2a3a176a23af200d3c4ab59e853c823783af53accbba8df43c4db91'
LOADER_SCHEMA='matrix-reviewed-inventory-loader-inputs-v7'
COLUMN_BASE_PROFILE_ID='matrix-text-facts-steel-comparison-v11'
COLUMN_BASE_CONFIG_HASH='3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7'
COLUMN_REGISTRY_HASH='50ebdb13ca09160bf8214acc9adf6e1bb8b3e5c6735e1511a1302c5354c5d499'
MAX_LOADER_BYTES=67108864
LOADER_SOCKET_DEADLINE_SECONDS=60
_canonical=_base._canonical
_sha=_base._sha
_file=_base._file
_SHA=re.compile(r'[a-f0-9]{64}\Z')
_UUID=re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z')
PARENT_KEYS={'schemaVersion','objectId','objectApiId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot','columnPylonSection','columnPylonSectionSnapshot'}
_REVIEW_FIELDS=('decisionId','contentHash','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages')
_SNAPSHOT_DOMAIN='matrix-kr056-steel-applicability-run-snapshot-json-v1'


def _native_json(value:Any,*,snapshot:bool=False,lease_metadata:bool=False)->None:
    """Descriptor-free native boundary; outer composes seven independent children.

    Exact child budgets remain enforced by each frozen validator. The outer
    transport budget deliberately is not the smaller single-child budget.
    """
    active:set[int]=set()
    nodes=0
    def walk(item:Any,depth:int)->None:
        nonlocal nodes
        nodes+=1
        if nodes>(200000 if snapshot else 4500018) or depth>(64 if snapshot else 69):raise ValueError('INPUT_LIMIT')
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


_steel_policy=_v11._steel_policy

def _column_pylon_section_policy(registry:dict[str,Any])->dict[str,Any]:
    if _sha(registry)!=COLUMN_REGISTRY_HASH:raise ValueError('column/pylon capability registry mismatch')
    result={'schemaVersion': 'matrix-column-pylon-section-comparisons-v1', 'purpose': 'MACHINE_COMPARISON', 'baseProfileId': 'matrix-text-facts-steel-comparison-v11', 'baseConfigHash': '3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7', 'capabilityRegistry': None, 'capabilityRegistryHash': '50ebdb13ca09160bf8214acc9adf6e1bb8b3e5c6735e1511a1302c5354c5d499', 'comparisonVersion': 'matrix-kr060-column-pylon-comparison-v2', 'comparisonSourceSha256': None, 'literalExtractorSourceSha256': None, 'sourceReconstructionVersion': 'document-text-v3-large-source-bounds-v1', 'sourceReconstructionSourceSha256': None, 'typedExecutionVersion': 'matrix-column-pylon-section-execution-v1', 'typedExecutionSourceSha256': None, 'runSnapshotPolicyVersion': 'matrix-kr060-column-pylon-run-snapshot-v1', 'runSnapshotSourceSha256': None, 'durableWrapperVersion': 'matrix-column-pylon-section-durable-v12', 'durableWrapperSourceSha256': None, 'loaderSchemaVersion': 'matrix-reviewed-inventory-loader-inputs-v7', 'loaderResourcePolicy': {'canonicalUtf8Bytes': 67108864, 'nodesIncludingKeys': 4500018, 'maximumDepth': 69, 'containerItems': 32768, 'scalarStringCodePoints': 2000000}, 'coveragePolicyVersion': 'matrix-column-pylon-section-coverage-v1', 'submissionPolicyVersion': 'matrix-column-pylon-section-submission-v1', 'hashPolicyVersion': 'matrix-column-pylon-section-execution-result-id-v1', 'confidencePolicy': {'policyVersion': 'machine-confidence-policy-v2', 'warningThresholdBasisPoints': 8000, 'thresholdComparison': 'STRICTLY_GREATER', 'expectedCalibrationVersion': None, 'sourceSha256': 'f3436ef404d494849e3a64affde3c6cf4e86e4336228b3dd7071eef1c0cc70d0'}}
    result['capabilityRegistry']=deepcopy(registry)
    result['comparisonSourceSha256']=_file(column_pylon_section_v2)
    result['literalExtractorSourceSha256']=_file(column_pylon_dimension_literals)
    result['sourceReconstructionSourceSha256']=_file(document_text_v3)
    result['typedExecutionSourceSha256']=_file(column_pylon_section_execution)
    result['runSnapshotSourceSha256']=_file(column_pylon_section_run_snapshot)
    result['scalarExecutionVersion']='matrix-scalar-prepared-v12-operation-local-v1'
    result['scalarExecutionSourceSha256']=_file(matrix_scalar_prepared_v12)
    result['scalarLegacyEngineSourceSha256']=_file(matrix_engine)
    result['durableWrapperSourceSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return result

def _load_capability_registries()->tuple[dict[str,Any],...]:
    old=_v9._load_capability_registries()
    steel=json.loads((Path(__file__).resolve().parents[1]/'rules'/'matrix-steel-comparison-capabilities-v1.json').read_text())
    column=json.loads((Path(__file__).resolve().parents[1]/'rules'/'matrix-column-pylon-section-capabilities-v1.json').read_text())
    return (*old,steel,column)


def _validate_release(lease:dict[str,Any],inventory_registry:dict[str,Any],call_registry:dict[str,Any],
        rail_registry:dict[str,Any],water_registry:dict[str,Any],lighting_registry:dict[str,Any],steel_registry:dict[str,Any],column_registry:dict[str,Any])->tuple[dict[str,Any],str]:
    _native_json(lease,lease_metadata=True)
    for registry in (inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry,column_registry):_native_json(registry)
    if type(lease) is not dict:raise ValueError('invalid steel lease')
    release=lease.get('release');slot=release.get('providerSlot') if type(release) is dict else None
    definitions=release.get('rules',{}).get('matrixDefinitions') if type(release) is dict and type(release.get('rules')) is dict else None
    if (type(slot) is not dict or release.get('lifecycle')!='DRAFT'
            or release.get('externalNetworkAllowed') is not False
            or slot.get('profileId')!=PROFILE_ID or slot.get('adapterVersion')!=ADAPTER_VERSION
            or slot.get('providerKind')!='RULE_ENGINE' or slot.get('stageJobType')!='RULE_EVALUATION'
            or slot.get('status')!='CONFIGURED' or type(definitions) is not dict):
        raise ValueError('invalid lighting technology matrix release')
    base={k:v for k,v in definitions.items() if k!='columnPylonSectionExecution'}
    if (_sha(base)!=COLUMN_BASE_CONFIG_HASH
            or _canonical(definitions.get('columnPylonSectionExecution'))!=_canonical(_column_pylon_section_policy(column_registry))):
        raise ValueError('column/pylon definitions differ from frozen v11 or typed policy')
    v9={k:v for k,v in base.items() if k!='steelExecution'}
    if (_sha(v9)!=BASE_CONFIG_HASH
            or _canonical(base.get('steelExecution'))!=_canonical(_steel_policy(steel_registry))
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
    path='/api/internal/v1/jobs/{}/column-pylon-section-reviewed-inventory-comparison-inputs?{}'.format(urllib.parse.quote(job_id,safe=''),urllib.parse.urlencode({'attemptId':attempt_id,'fencingToken':fence}))
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
    if (type(result) is not dict or set(result)!={'schemaVersion','objectId','objectApiId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot','columnPylonSection','columnPylonSectionSnapshot'}
            or result.get('schemaVersion')!=LOADER_SCHEMA or result.get('objectId')!=lease.get('objectId')
            or result.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('reviewed inventory loader differs from current lease')
    return result


def _validate_loader(package:Any,lease:dict[str,Any])->dict[str,Any]:
    _native_json(package)
    _native_json(lease,lease_metadata=True)
    if (type(package) is not dict or set(package)!=PARENT_KEYS
            or package['schemaVersion']!=LOADER_SCHEMA or package['objectId']!=lease.get('objectId')
            or package['inputManifestHash']!=lease.get('inputManifestHash')):
        raise ValueError('invalid column/pylon reviewed loader envelope')
    # Pure input validation only: actual v12 lease stays intact.
    old={k:package[k] for k in PARENT_KEYS if k not in {'objectApiId','columnPylonSection','columnPylonSectionSnapshot'}}
    old['schemaVersion']=_v11.LOADER_SCHEMA
    verified=_v11._validate_loader(old,lease)
    column=column_pylon_section_execution.validate_column_pylon_section_loader_package(package['columnPylonSection'],package['columnPylonSectionSnapshot'])
    snapshot=column_pylon_section_run_snapshot.validate_column_pylon_section_run_snapshot(package['columnPylonSectionSnapshot'])
    if (column['objectId']!=package['objectApiId'] or column['inputManifestHash']!=package['inputManifestHash']
            or snapshot['objectId']!=package['objectId'] or snapshot['objectApiId']!=package['objectApiId']):
        raise ValueError('column/pylon internal/public run identity mismatch')
    def common(sources:list[dict[str,Any]])->dict[str,Any]:
        return {s['sourceFileId']:{'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],
            'stages':s['stages'],'review':{k:s['review'][k]for k in _REVIEW_FIELDS}if s['review']is not None else None}for s in sources}
    if _canonical(common(column['sources']))!=_canonical(common(verified['waterNode']['sources'])):
        raise ValueError('column/pylon current sources disagree with six-domain projection')
    return {**verified,'schemaVersion':LOADER_SCHEMA,'objectApiId':package['objectApiId'],
        'columnPylonSection':column,'columnPylonSectionSnapshot':snapshot}


def execute_durable_column_pylon_section_matrix_v12(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry,column_registry=_load_capability_registries()
    slot,config_hash=_validate_release(lease,inventory_registry,call_registry,rail_registry,water_registry,lighting_registry,steel_registry,column_registry)
    package=_validate_loader(download_reviewed_inventory_comparison_inputs(lease,attempt),lease)
    inventory=inventory_execution.build_inventory_comparisons(package['inventory'],inventory_registry)
    call=call_inventory_execution.build_call_inventory_comparisons(package['callInventory'],call_registry)
    rail=rail_inventory_execution.build_rail_inventory_comparisons(package['railInventory'],rail_registry)
    water=water_node_execution.build_water_node_comparisons(package['waterNode'],water_registry)
    lighting=lighting_technology_execution.build_lighting_technology_comparisons(package['lightingTechnology'],lighting_registry)
    steel=steel_execution.build_steel_comparisons(package['steelComparison'],steel_registry)
    column=column_pylon_section_execution.build_column_pylon_section_comparisons(package['columnPylonSection'],package['columnPylonSectionSnapshot'],column_registry)
    inputs=lease['inputs'];sources=[];artifacts=[]
    for source in inputs['sourceFiles']:
        decision=inputs.get('sourceDecisions',{}).get(source['sourceFileId'])
        sources.append({**source,**_reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
        if source.get('mediaType')=='application/pdf':artifacts.append(download_text_artifact(lease,source,attempt))
    execution=matrix_scalar_prepared_v12.build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=artifacts,registry=matrix_engine.load_matrix_registry())
    coverage=inventory_execution.merge_inventory_coverage(execution['coverage'],inventory,inventory_registry)
    coverage=call_inventory_execution.merge_call_inventory_coverage(coverage,call,call_registry)
    coverage=rail_inventory_execution.merge_rail_inventory_coverage(coverage,rail,rail_registry)
    coverage=water_node_execution.merge_water_node_coverage(coverage,water,water_registry)
    coverage=lighting_technology_execution.merge_lighting_technology_coverage(coverage,lighting,lighting_registry)
    coverage=steel_execution.merge_steel_comparison_coverage(coverage,steel,steel_registry)
    coverage=column_pylon_section_execution.merge_column_pylon_section_coverage(coverage,column,column_registry)
    return {'schemaVersion':'analysis-stage-result-v2','jobType':'RULE_EVALUATION','inputManifestHash':lease['inputManifestHash'],
        'disposition':'RULES_EVALUATED','providerKind':'RULE_ENGINE','providerProfileId':slot['profileId'],
        'providerConfigHash':config_hash,'outputCount':len(execution['results'])+len(inventory['results'])+len(call['results'])+len(rail['results'])+len(water['results'])+len(lighting['results'])+len(steel['results'])+len(column['results']),
        'execution':execution,'projectConstraints':project_constraints.extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,artifacts),
        'sourceDeclarations':source_declarations_v2.extract_source_declarations({'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':artifacts}),
        'inventoryComparisons':inventory,'callInventoryComparisons':call,'railInventoryComparisons':rail,'waterNodeComparisons':water,'lightingTechnologyComparisons':lighting,'steelComparisons':steel,'steelApplicabilitySnapshot':deepcopy(package['steelApplicabilitySnapshot']),'columnPylonSectionComparisons':column,'columnPylonSectionSnapshot':deepcopy(package['columnPylonSectionSnapshot']),'effectiveCoverage':coverage}
