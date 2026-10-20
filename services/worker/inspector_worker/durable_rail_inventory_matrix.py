"""Additive v7 durable release: scalar, AR053, ODI123 and ODI120 inventories.

The protected loader authenticates persisted reviews. This worker validates the
complete three-domain projection and every retained claim before any extraction.
No legacy release is fabricated or delegated for execution.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import time
from typing import Any
import urllib.parse

from inspector_worker import durable_inventory_matrix as _base
from inspector_worker import durable_call_inventory_matrix as _v6
from inspector_worker import rail_inventory_source, rail_inventory_comparison, rail_inventory_execution
from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose
from inspector_worker import rebar_prose, concrete_prose, source_declarations, source_declarations_v2
from inspector_worker import steel_prose, fire_resistance_table, table_row_binding
from inspector_worker import inventory_execution, call_inventory_execution, call_inventory_source
from inspector_worker import odi123_call_inventory_comparison
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.durable_text import download_text_artifact, TextArtifactLeaseLost

PROFILE_ID='matrix-text-facts-rail-inventory-v7'
ADAPTER_VERSION='7'
BASE_PROFILE_ID='matrix-text-facts-call-inventory-v6'
BASE_CONFIG_HASH='dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad'
LOADER_SCHEMA='matrix-reviewed-inventory-loader-inputs-v3'
MAX_LOADER_BYTES=67108864
LOADER_SOCKET_DEADLINE_SECONDS=60
_canonical=_base._canonical
_sha=_base._sha
_file=_base._file
_SHA=re.compile(r'[a-f0-9]{64}\Z')


def _rail_inventory_policy(registry:dict[str,Any])->dict[str,Any]:
    return {'schemaVersion':'matrix-rail-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
        'baseProfileId':BASE_PROFILE_ID,'baseConfigHash':BASE_CONFIG_HASH,
        'capabilityRegistry':registry,'capabilityRegistryHash':_sha(registry),
        'comparisonVersion':'matrix-odi120-rail-inventory-comparison-v1',
        'comparisonSourceSha256':_file(rail_inventory_comparison),
        'sourceReconstructionVersion':'matrix-odi120-rail-inventory-source-v1',
        'sourceReconstructionSourceSha256':_file(rail_inventory_source),
        'typedExecutionVersion':'matrix-rail-inventory-execution-v1',
        'typedExecutionSourceSha256':_file(rail_inventory_execution),
        'durableWrapperVersion':'matrix-rail-inventory-execution-v1',
        'durableWrapperSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coveragePolicyVersion':'matrix-rail-inventory-coverage-v1',
        'submissionPolicyVersion':'matrix-rail-inventory-submission-v1',
        'hashPolicyVersion':'matrix-rail-inventory-result-json-v1'}


def _load_capability_registries()->tuple[dict[str,Any],dict[str,Any],dict[str,Any]]:
    inventory,call=_v6._load_capability_registries()
    rules=Path(__file__).resolve().parents[1]/'rules'
    rail=json.loads((rules/'matrix-rail-inventory-capabilities-v1.json').read_text())
    return inventory,call,rail


def _validate_release(lease:dict[str,Any],inventory_registry:dict[str,Any],call_registry:dict[str,Any],
        rail_registry:dict[str,Any])->tuple[dict[str,Any],str]:
    if type(lease) is not dict:raise ValueError('invalid rail inventory lease')
    release=lease.get('release');slot=release.get('providerSlot') if type(release) is dict else None
    definitions=release.get('rules',{}).get('matrixDefinitions') if type(release) is dict and type(release.get('rules')) is dict else None
    if (type(slot) is not dict or release.get('lifecycle')!='DRAFT'
            or release.get('externalNetworkAllowed') is not False
            or slot.get('profileId')!=PROFILE_ID or slot.get('adapterVersion')!=ADAPTER_VERSION
            or slot.get('providerKind')!='RULE_ENGINE' or slot.get('stageJobType')!='RULE_EVALUATION'
            or slot.get('status')!='CONFIGURED' or type(definitions) is not dict):
        raise ValueError('invalid rail inventory matrix release')
    v6={k:v for k,v in definitions.items() if k!='railExecution'}
    if (_sha(v6)!=BASE_CONFIG_HASH
            or _canonical(definitions.get('railExecution'))!=_canonical(_rail_inventory_policy(rail_registry))
            or _canonical(v6.get('callInventoryExecution'))!=_canonical(_v6._call_inventory_policy(call_registry))):
        raise ValueError('rail inventory definitions differ from frozen v6 or typed policies')
    v5={k:v for k,v in v6.items() if k!='callInventoryExecution'}
    if (_sha(v5)!=_v6.BASE_CONFIG_HASH
            or _canonical(v5.get('inventoryExecution'))!=_canonical(_base._inventory_policy(inventory_registry))):
        raise ValueError('rail inventory base differs from frozen v5')
    v4={k:v for k,v in v5.items() if k!='inventoryExecution'}
    if _sha(v4)!=_base.BASE_CONFIG_HASH:raise ValueError('rail inventory base differs from frozen v4')
    direct=[(v4['engineSourceSha256'],matrix_engine),(v4['factScopeSourceSha256'],matrix_fact_scope),
        (v4['projectZeroProse']['sourceSha256'],project_zero_prose),
        (v4['rebarProse']['sourceSha256'],rebar_prose),(v4['concreteProse']['sourceSha256'],concrete_prose),
        (v4['projectConstraints']['sourceSha256'],project_constraints)]
    declaration=v4['sourceDeclarations']
    direct.extend([(declaration['sourceSha256'],source_declarations_v2),
        (declaration['legacySourceSha256'],source_declarations),(declaration['steelSourceSha256'],steel_prose),
        (declaration['fireSourceSha256'],fire_resistance_table),(declaration['tableBindingSourceSha256'],table_row_binding)])
    if any(expected!=_file(module) for expected,module in direct) or _canonical(v4['registry'])!=_canonical(matrix_engine.load_matrix_registry()):
        raise ValueError('rail inventory base runtime source differs from frozen release')
    inventory_execution._registry(inventory_registry)
    call_inventory_execution._registry(call_registry)
    rail_inventory_execution._registry(rail_registry)
    config_hash=_sha(definitions)
    if slot.get('configHash')!=config_hash:raise ValueError('rail inventory matrix config hash mismatch')
    return slot,config_hash


def _unique_object(pairs:list[tuple[str,Any]])->dict[str,Any]:
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate reviewed inventory loader JSON key')
        result[key]=value
    return result


def _reject_constant(value:str)->None:
    raise ValueError('non-JSON numeric constant in reviewed inventory loader')


def download_reviewed_inventory_comparison_inputs(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    job_id=lease.get('jobId');attempt_id=attempt.get('attemptId');fence=attempt.get('fencingToken')
    if type(job_id) is not str or not job_id or type(attempt_id) is not str or not attempt_id or type(fence) is not int or fence<1:
        raise ValueError('invalid reviewed inventory loader lease')
    api=urllib.parse.urlsplit(os.environ['INSPECTOR_API_INTERNAL_URL'])
    if api.scheme not in {'http','https'} or not api.hostname or api.username or api.password:raise ValueError('invalid internal API URL')
    path='/api/internal/v1/jobs/{}/rail-reviewed-inventory-comparison-inputs?{}'.format(urllib.parse.quote(job_id,safe=''),urllib.parse.urlencode({'attemptId':attempt_id,'fencingToken':fence}))
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
        result=json.loads(body.decode('utf-8'),object_pairs_hook=_unique_object,parse_constant=_reject_constant)
    finally:
        if response is not None:response.close()
        connection.close()
    if (type(result) is not dict or set(result)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory','railInventory'}
            or result.get('schemaVersion')!=LOADER_SCHEMA or result.get('objectId')!=lease.get('objectId')
            or result.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('reviewed inventory loader differs from current lease')
    return result


def _validate_loader(package:Any,lease:dict[str,Any])->dict[str,Any]:
    # Run all domain native/resource guards before any source projection or comparison.
    if (type(package) is not dict or set(package)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory','railInventory'}
            or package.get('schemaVersion')!=LOADER_SCHEMA or package.get('objectId')!=lease.get('objectId')
            or package.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('invalid rail reviewed inventory loader envelope')
    rail=rail_inventory_execution.validate_rail_inventory_loader_package(package['railInventory'])
    # Reuse the frozen two-domain input validator only. The actual v7 lease stays
    # intact; no old release identity is fabricated and no legacy worker executes.
    old_projection={k:package[k] for k in ['objectId','inputManifestHash','inventory','callInventory']}
    old_projection['schemaVersion']=_v6.LOADER_SCHEMA
    verified=_v6._validate_loader(old_projection,lease)
    if rail['objectId']!=package['objectId'] or rail['inputManifestHash']!=package['inputManifestHash']:
        raise ValueError('rail inventory package association mismatch')
    def common(sources:list[dict[str,Any]],sibling:str)->dict[str,Any]:
        result={}
        for source in sources:
            item=deepcopy(source)
            if item['review'] is not None:item['review'].pop(sibling)
            result[item['sourceFileId']]=item
        return result
    if _canonical(common(rail['sources'],'railInventoryScope'))!=_canonical(common(verified['callInventory']['sources'],'callInventoryScope')):
        raise ValueError('rail reviewed inventory source projections disagree')
    def origins(items:list[dict[str,Any]])->dict[str,Any]:
        return {_canonical([o['sourceFileId'],o['checkId']]):o for o in items}
    if _canonical(origins(rail['origins']))!=_canonical(origins(verified['callInventory']['origins'])):
        raise ValueError('rail reviewed inventory retained origin unions disagree')
    return {**verified,'schemaVersion':LOADER_SCHEMA,'railInventory':rail}


def execute_durable_rail_inventory_matrix(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    inventory_registry,call_registry,rail_registry=_load_capability_registries()
    slot,config_hash=_validate_release(lease,inventory_registry,call_registry,rail_registry)
    package=_validate_loader(download_reviewed_inventory_comparison_inputs(lease,attempt),lease)
    inventory=inventory_execution.build_inventory_comparisons(package['inventory'],inventory_registry)
    call=call_inventory_execution.build_call_inventory_comparisons(package['callInventory'],call_registry)
    rail=rail_inventory_execution.build_rail_inventory_comparisons(package['railInventory'],rail_registry)
    inputs=lease['inputs'];sources=[];artifacts=[]
    for source in inputs['sourceFiles']:
        decision=inputs.get('sourceDecisions',{}).get(source['sourceFileId'])
        sources.append({**source,**_reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
        if source.get('mediaType')=='application/pdf':artifacts.append(download_text_artifact(lease,source,attempt))
    execution=matrix_engine.build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=artifacts,registry=matrix_engine.load_matrix_registry())
    coverage=inventory_execution.merge_inventory_coverage(execution['coverage'],inventory,inventory_registry)
    coverage=call_inventory_execution.merge_call_inventory_coverage(coverage,call,call_registry)
    coverage=rail_inventory_execution.merge_rail_inventory_coverage(coverage,rail,rail_registry)
    return {'schemaVersion':'analysis-stage-result-v2','jobType':'RULE_EVALUATION','inputManifestHash':lease['inputManifestHash'],
        'disposition':'RULES_EVALUATED','providerKind':'RULE_ENGINE','providerProfileId':slot['profileId'],
        'providerConfigHash':config_hash,'outputCount':len(execution['results'])+len(inventory['results'])+len(call['results'])+len(rail['results']),
        'execution':execution,'projectConstraints':project_constraints.extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,artifacts),
        'sourceDeclarations':source_declarations_v2.extract_source_declarations({'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':artifacts}),
        'inventoryComparisons':inventory,'callInventoryComparisons':call,'railInventoryComparisons':rail,'effectiveCoverage':coverage}
