"""Actual v6 durable release: scalar, AR053 and ODI123 scoped inventories.

The protected loader authenticates persisted reviews. This worker validates the
complete two-domain projection and every retained claim before any extraction.
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
from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose
from inspector_worker import rebar_prose, concrete_prose, source_declarations, source_declarations_v2
from inspector_worker import steel_prose, fire_resistance_table, table_row_binding
from inspector_worker import inventory_execution, call_inventory_execution, call_inventory_source
from inspector_worker import odi123_call_inventory_comparison
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.durable_text import download_text_artifact, TextArtifactLeaseLost

PROFILE_ID='matrix-text-facts-call-inventory-v6'
ADAPTER_VERSION='6'
BASE_PROFILE_ID='matrix-text-facts-inventory-v5'
BASE_CONFIG_HASH='26f8a2d425296c27573c11358ad394c3c0cd911861bb9b2b11b88fe6c87fb060'
LOADER_SCHEMA='matrix-reviewed-inventory-loader-inputs-v2'
MAX_LOADER_BYTES=67108864
LOADER_SOCKET_DEADLINE_SECONDS=60
_canonical=_base._canonical
_sha=_base._sha
_file=_base._file
_SHA=re.compile(r'[a-f0-9]{64}\Z')


def _call_inventory_policy(registry:dict[str,Any])->dict[str,Any]:
    return {'schemaVersion':'matrix-call-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
        'baseProfileId':BASE_PROFILE_ID,'baseConfigHash':BASE_CONFIG_HASH,
        'capabilityRegistry':registry,'capabilityRegistryHash':_sha(registry),
        'comparisonVersion':'matrix-odi123-call-inventory-comparison-v1',
        'comparisonSourceSha256':_file(odi123_call_inventory_comparison),
        'sourceReconstructionVersion':'matrix-odi123-call-inventory-source-v1',
        'sourceReconstructionSourceSha256':_file(call_inventory_source),
        'typedExecutionVersion':'matrix-call-inventory-execution-v1',
        'typedExecutionSourceSha256':_file(call_inventory_execution),
        'durableWrapperVersion':'matrix-call-inventory-execution-v1',
        'durableWrapperSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'coveragePolicyVersion':'matrix-call-inventory-coverage-v1',
        'submissionPolicyVersion':'matrix-call-inventory-submission-v1',
        'hashPolicyVersion':'matrix-call-inventory-result-json-v1'}


def _load_capability_registries()->tuple[dict[str,Any],dict[str,Any]]:
    rules=Path(__file__).resolve().parents[1]/'rules'
    return (json.loads((rules/'matrix-inventory-capabilities-v1.json').read_text()),
            json.loads((rules/'matrix-call-inventory-capabilities-v1.json').read_text()))


def _validate_release(lease:dict[str,Any],inventory_registry:dict[str,Any],call_registry:dict[str,Any])->tuple[dict[str,Any],str]:
    if type(lease) is not dict:raise ValueError('invalid call inventory lease')
    release=lease.get('release');slot=release.get('providerSlot') if type(release) is dict else None
    definitions=release.get('rules',{}).get('matrixDefinitions') if type(release) is dict and type(release.get('rules')) is dict else None
    if (type(slot) is not dict or release.get('lifecycle')!='DRAFT'
            or release.get('externalNetworkAllowed') is not False
            or slot.get('profileId')!=PROFILE_ID or slot.get('adapterVersion')!=ADAPTER_VERSION
            or slot.get('providerKind')!='RULE_ENGINE' or slot.get('stageJobType')!='RULE_EVALUATION'
            or slot.get('status')!='CONFIGURED' or type(definitions) is not dict):
        raise ValueError('invalid call inventory matrix release')
    v5={k:v for k,v in definitions.items() if k!='callInventoryExecution'}
    if (_sha(v5)!=BASE_CONFIG_HASH
            or _canonical(definitions.get('callInventoryExecution'))!=_canonical(_call_inventory_policy(call_registry))
            or v5.get('inventoryExecution')!=_base._inventory_policy(inventory_registry)):
        raise ValueError('call inventory definitions differ from frozen v5 base or typed policies')
    v4={k:v for k,v in v5.items() if k!='inventoryExecution'}
    if _sha(v4)!=_base.BASE_CONFIG_HASH:raise ValueError('call inventory base differs from frozen v4')
    direct=[(v4['engineSourceSha256'],matrix_engine),(v4['factScopeSourceSha256'],matrix_fact_scope),
        (v4['projectZeroProse']['sourceSha256'],project_zero_prose),
        (v4['rebarProse']['sourceSha256'],rebar_prose),(v4['concreteProse']['sourceSha256'],concrete_prose),
        (v4['projectConstraints']['sourceSha256'],project_constraints)]
    declaration=v4['sourceDeclarations']
    direct.extend([(declaration['sourceSha256'],source_declarations_v2),
        (declaration['legacySourceSha256'],source_declarations),(declaration['steelSourceSha256'],steel_prose),
        (declaration['fireSourceSha256'],fire_resistance_table),(declaration['tableBindingSourceSha256'],table_row_binding)])
    if any(expected!=_file(module) for expected,module in direct) or v4['registry']!=matrix_engine.load_matrix_registry():
        raise ValueError('call inventory base runtime source differs from frozen release')
    # Both independently accepted wrappers enforce their immutable registry and
    # scalar rule namespace pins even when a loader contains no identities.
    inventory_execution._registry(inventory_registry)
    call_inventory_execution._registry(call_registry)
    config_hash=_sha(definitions)
    if slot.get('configHash')!=config_hash:raise ValueError('call inventory matrix config hash mismatch')
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
    path='/api/internal/v1/jobs/{}/reviewed-inventory-comparison-inputs?{}'.format(urllib.parse.quote(job_id,safe=''),urllib.parse.urlencode({'attemptId':attempt_id,'fencingToken':fence}))
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
    if (type(result) is not dict or set(result)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory'}
            or result.get('schemaVersion')!=LOADER_SCHEMA or result.get('objectId')!=lease.get('objectId')
            or result.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('reviewed inventory loader differs from current lease')
    return result


def _validate_loader(package:Any,lease:dict[str,Any])->dict[str,Any]:
    if (type(package) is not dict or set(package)!={'schemaVersion','objectId','inputManifestHash','inventory','callInventory'}
            or package.get('schemaVersion')!=LOADER_SCHEMA or package.get('objectId')!=lease.get('objectId')
            or package.get('inputManifestHash')!=lease.get('inputManifestHash')):
        raise ValueError('invalid reviewed inventory loader envelope')
    inventory_execution._validate_package(package['inventory'])
    inventory=deepcopy(package['inventory'])
    call=call_inventory_execution.validate_call_inventory_loader_package(package['callInventory'])
    for child in [inventory,call]:
        if child['objectId']!=package['objectId'] or child['inputManifestHash']!=package['inputManifestHash']:
            raise ValueError('reviewed inventory package association mismatch')
    # Domain siblings are independently validated above. Everything else is the
    # same protected run-snapshot projection, including inactive/unknown reviews.
    def source_projection(source:dict[str,Any],sibling:str)->dict[str,Any]:
        result=deepcopy(source)
        if result['review'] is not None:result['review'].pop(sibling)
        return result
    left={s['sourceFileId']:source_projection(s,'inventoryScope') for s in inventory['sources']}
    right={s['sourceFileId']:source_projection(s,'callInventoryScope') for s in call['sources']}
    if left!=right:raise ValueError('reviewed inventory source projections disagree')
    left_origins={(o['sourceFileId'],o['checkId']):o for o in inventory['origins']}
    right_origins={(o['sourceFileId'],o['checkId']):o for o in call['origins']}
    if left_origins!=right_origins:raise ValueError('reviewed inventory retained origin unions disagree')
    inputs=lease.get('inputs')
    if type(inputs) is not dict or type(inputs.get('sourceFiles')) is not list or type(inputs.get('sourceDecisions',{})) is not dict:
        raise ValueError('invalid reviewed inventory committed manifest')
    manifest={}
    for source in inputs['sourceFiles']:
        if (type(source) is not dict or type(source.get('sourceFileId')) is not str
                or not source['sourceFileId'] or source['sourceFileId'] in manifest
                or ('objectId' in source and source['objectId']!=lease['objectId'])):
            raise ValueError('invalid or duplicate committed source')
        manifest[source['sourceFileId']]=source
    decisions=inputs.get('sourceDecisions',{})
    if set(manifest)!=set(left) or set(decisions)-set(manifest):raise ValueError('reviewed inventory source enumeration differs from lease')
    for sid,source in manifest.items():
        projected=left[sid];review=projected['review'];decision=decisions.get(sid)
        if projected['sourceSha256']!=source.get('sha256') or projected['stages']!=source.get('stages'):
            raise ValueError('reviewed inventory source bytes or stages differ from lease')
        if (decision is None)!=(review is None):raise ValueError('reviewed inventory review presence differs from lease')
        if decision is not None:
            if type(decision) is not dict or any(decision.get(k)!=review[k] for k in ['sourceSha256','revisionStatus','approvalStatus','linkGroupId','sectionCode','pageStages']):
                raise ValueError('reviewed inventory review interpretation differs from lease')
    return {'schemaVersion':LOADER_SCHEMA,'objectId':package['objectId'],'inputManifestHash':package['inputManifestHash'],'inventory':inventory,'callInventory':call}


def execute_durable_call_inventory_matrix(lease:dict[str,Any],attempt:dict[str,Any])->dict[str,Any]:
    inventory_registry,call_registry=_load_capability_registries()
    slot,config_hash=_validate_release(lease,inventory_registry,call_registry)
    package=_validate_loader(download_reviewed_inventory_comparison_inputs(lease,attempt),lease)
    inventory=inventory_execution.build_inventory_comparisons(package['inventory'],inventory_registry)
    call=call_inventory_execution.build_call_inventory_comparisons(package['callInventory'],call_registry)
    inputs=lease['inputs'];sources=[];artifacts=[]
    for source in inputs['sourceFiles']:
        decision=inputs.get('sourceDecisions',{}).get(source['sourceFileId'])
        sources.append({**source,**_reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
        if source.get('mediaType')=='application/pdf':artifacts.append(download_text_artifact(lease,source,attempt))
    execution=matrix_engine.build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=artifacts,registry=matrix_engine.load_matrix_registry())
    coverage=inventory_execution.merge_inventory_coverage(execution['coverage'],inventory,inventory_registry)
    coverage=call_inventory_execution.merge_call_inventory_coverage(coverage,call,call_registry)
    return {'schemaVersion':'analysis-stage-result-v2','jobType':'RULE_EVALUATION','inputManifestHash':lease['inputManifestHash'],
        'disposition':'RULES_EVALUATED','providerKind':'RULE_ENGINE','providerProfileId':slot['profileId'],
        'providerConfigHash':config_hash,'outputCount':len(execution['results'])+len(inventory['results'])+len(call['results']),
        'execution':execution,'projectConstraints':project_constraints.extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,artifacts),
        'sourceDeclarations':source_declarations_v2.extract_source_declarations({'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':artifacts}),
        'inventoryComparisons':inventory,'callInventoryComparisons':call,'effectiveCoverage':coverage}
