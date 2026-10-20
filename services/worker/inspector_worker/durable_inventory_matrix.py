"""New v5 durable typed inventory profile. Never spoofs a legacy release."""
from __future__ import annotations
import hashlib
import http.client
import json
import os
from pathlib import Path
import time
from typing import Any
import urllib.parse

from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose
from inspector_worker import rebar_prose, concrete_prose, source_declarations, source_declarations_v2
from inspector_worker import steel_prose, fire_resistance_table, table_row_binding, inventory_source
from inspector_worker import ar053_inventory_comparison
# Relocation binds this import to the independently accepted typed wrapper.
from inspector_worker import inventory_execution as _inventory_execution
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.durable_text import download_text_artifact, TextArtifactLeaseLost

PROFILE_ID='matrix-text-facts-inventory-v5'
ADAPTER_VERSION='5'
BASE_PROFILE_ID='matrix-text-facts-evidence-v4'
BASE_CONFIG_HASH='aedbc793122525242dbdcd7b3b56c5ddf3e176869a1aa31137db11833d94181e'
MAX_LOADER_BYTES=67108864
LOADER_SOCKET_DEADLINE_SECONDS=60


def _canonical(value: Any) -> str:
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _file(module: Any) -> str:
    return hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()


def _inventory_policy(registry: dict[str, Any]) -> dict[str, Any]:
    return {'schemaVersion':'matrix-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
        'baseProfileId':BASE_PROFILE_ID,'baseConfigHash':BASE_CONFIG_HASH,
        'capabilityRegistry':registry,'capabilityRegistryHash':_sha(registry),
        'comparisonVersion':'matrix-ar053-inventory-comparison-v1',
        'comparisonSourceSha256':_file(ar053_inventory_comparison),
        'sourceReconstructionVersion':inventory_source.EXTRACTOR_VERSION,
        'sourceReconstructionSourceSha256':_file(inventory_source),
        'typedExecutionVersion':'matrix-inventory-execution-v1',
        'typedExecutionSourceSha256':_file(_inventory_execution),
        'durableWrapperVersion':'matrix-inventory-execution-v1',
        'durableWrapperSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coveragePolicyVersion':'matrix-inventory-coverage-v1',
        'submissionPolicyVersion':'matrix-inventory-submission-v1',
        'hashPolicyVersion':'matrix-inventory-result-json-v1'}


def _validate_release(lease: dict[str, Any], registry: dict[str, Any]) -> tuple[dict[str, Any],str]:
    release=lease.get('release',{});slot=release.get('providerSlot',{});definitions=release.get('rules',{}).get('matrixDefinitions')
    if (release.get('lifecycle')!='DRAFT' or release.get('externalNetworkAllowed') is not False
            or slot.get('profileId')!=PROFILE_ID or slot.get('adapterVersion')!=ADAPTER_VERSION
            or slot.get('providerKind')!='RULE_ENGINE' or slot.get('stageJobType')!='RULE_EVALUATION'
            or slot.get('status')!='CONFIGURED' or type(definitions) is not dict):
        raise ValueError('invalid inventory matrix release')
    base={key:value for key,value in definitions.items() if key!='inventoryExecution'}
    if _sha(base)!=BASE_CONFIG_HASH or definitions.get('inventoryExecution')!=_inventory_policy(registry):
        raise ValueError('inventory matrix definitions differ from pinned v4 base or typed policy')
    direct=[(base['engineSourceSha256'],matrix_engine),(base['factScopeSourceSha256'],matrix_fact_scope),
        (base['projectZeroProse']['sourceSha256'],project_zero_prose),
        (base['rebarProse']['sourceSha256'],rebar_prose),(base['concreteProse']['sourceSha256'],concrete_prose),
        (base['projectConstraints']['sourceSha256'],project_constraints)]
    declaration=base['sourceDeclarations']
    direct.extend([(declaration['sourceSha256'],source_declarations_v2),
        (declaration['legacySourceSha256'],source_declarations),(declaration['steelSourceSha256'],steel_prose),
        (declaration['fireSourceSha256'],fire_resistance_table),(declaration['tableBindingSourceSha256'],table_row_binding)])
    if any(expected!=_file(module) for expected,module in direct) or base['registry']!=matrix_engine.load_matrix_registry():
        raise ValueError('inventory matrix base runtime source differs from frozen release')
    config_hash=_sha(definitions)
    if slot.get('configHash')!=config_hash:raise ValueError('inventory matrix config hash mismatch')
    return slot,config_hash


def _unique_object(pairs:list[tuple[str,Any]]) -> dict[str,Any]:
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate inventory loader JSON key')
        result[key]=value
    return result


def download_inventory_comparison_inputs(lease:dict[str,Any],attempt:dict[str,Any]) -> dict[str,Any]:
    job_id=lease.get('jobId');attempt_id=attempt.get('attemptId');fence=attempt.get('fencingToken')
    if not isinstance(job_id,str) or not job_id or not isinstance(attempt_id,str) or not attempt_id or type(fence) is not int or fence<1:
        raise ValueError('invalid inventory loader lease')
    api=urllib.parse.urlsplit(os.environ['INSPECTOR_API_INTERNAL_URL'])
    if api.scheme not in {'http','https'} or not api.hostname or api.username or api.password:raise ValueError('invalid internal API URL')
    path='/api/internal/v1/jobs/{}/inventory-comparison-inputs?{}'.format(urllib.parse.quote(job_id,safe=''),urllib.parse.urlencode({'attemptId':attempt_id,'fencingToken':fence}))
    constructor=http.client.HTTPSConnection if api.scheme=='https' else http.client.HTTPConnection
    deadline=time.monotonic()+LOADER_SOCKET_DEADLINE_SECONDS
    connection=constructor(api.hostname,port=api.port,timeout=LOADER_SOCKET_DEADLINE_SECONDS)
    response=None
    try:
        connection.request('GET',path,headers={'X-Worker-Token':os.environ['INTERNAL_WORKER_TOKEN']})
        stream_socket=connection.sock
        stream_socket.settimeout(max(.001,deadline-time.monotonic()))
        response=connection.getresponse()
        if response.status==409:raise TextArtifactLeaseLost('inventory loader attempt is stale or terminal')
        if response.status!=200:raise ValueError('inventory loader returned HTTP {}'.format(response.status))
        length=response.getheader('Content-Length');digest=response.getheader('X-Content-SHA256')
        if not length or not length.isdecimal() or not 0<int(length)<=MAX_LOADER_BYTES:raise ValueError('invalid inventory loader length')
        if not ar053_inventory_comparison._sha(digest):raise ValueError('invalid inventory loader content hash')
        if (response.getheader('X-Artifact-Schema-Version')!='matrix-ar053-loader-inputs-v1'
                or response.getheader('X-Input-Manifest-SHA256')!=lease.get('inputManifestHash')):
            raise ValueError('inventory loader headers differ from lease')
        chunks=[];size=0
        while size<int(length):
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('inventory loader deadline exceeded')
            # Keep the native socket reference across HTTP Connection: close;
            # HTTPResponse retains its file while this body is being consumed.
            stream_socket.settimeout(remaining)
            chunk=response.read1(min(65536,int(length)-size))
            if not chunk:break
            size+=len(chunk)
            if size>int(length) or size>MAX_LOADER_BYTES:raise ValueError('inventory loader oversized body')
            chunks.append(chunk)
        body=b''.join(chunks)
        if len(body)!=int(length) or hashlib.sha256(body).hexdigest()!=digest:raise ValueError('inventory loader body hash/size mismatch')
        result=json.loads(body.decode('utf-8'),object_pairs_hook=_unique_object)
    finally:
        if response is not None:response.close()
        connection.close()
    if type(result) is not dict or result.get('objectId')!=lease.get('objectId') or result.get('inputManifestHash')!=lease.get('inputManifestHash'):
        raise ValueError('inventory loader package differs from current lease')
    return result


def _load_capability_registry() -> dict[str,Any]:
    return json.loads((Path(__file__).resolve().parents[1]/'rules/matrix-inventory-capabilities-v1.json').read_text())


def execute_durable_inventory_matrix(lease:dict[str,Any],attempt:dict[str,Any]) -> dict[str,Any]:
    registry=_load_capability_registry()
    slot,config_hash=_validate_release(lease,registry)
    package=download_inventory_comparison_inputs(lease,attempt)
    inventory=_inventory_execution.build_inventory_comparisons(package,registry)
    inputs=lease['inputs'];sources=[];artifacts=[]
    for source in inputs['sourceFiles']:
        decision=inputs.get('sourceDecisions',{}).get(source['sourceFileId'])
        sources.append({**source,**_reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
        if source.get('mediaType')=='application/pdf':artifacts.append(download_text_artifact(lease,source,attempt))
    execution=matrix_engine.build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=artifacts,registry=matrix_engine.load_matrix_registry())
    return {'schemaVersion':'analysis-stage-result-v2','jobType':'RULE_EVALUATION','inputManifestHash':lease['inputManifestHash'],'disposition':'RULES_EVALUATED','providerKind':'RULE_ENGINE','providerProfileId':slot['profileId'],'providerConfigHash':config_hash,'outputCount':len(execution['results'])+len(inventory['results']),'execution':execution,
        'projectConstraints':project_constraints.extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,artifacts),
        'sourceDeclarations':source_declarations_v2.extract_source_declarations({'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':artifacts}),
        'inventoryComparisons':inventory,'effectiveCoverage':_inventory_execution.merge_inventory_coverage(execution['coverage'],inventory,registry)}
