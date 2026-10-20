"""Optional real F0201 queue acceptance used by smoke-cpu-normal.py.

This verifies source processing and durable transport, not engineering validity.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlencode

SOURCE_SHA = '0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd'
SOURCE_BYTES = 43033348
PROFILE = 'SOURCE_AUDIT_V4_FULL_SOURCE_V1'
POLICY = 'document-text-v4-full-source-bounds-v1'


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_original(path: Path):
    require(path.is_file() and path.stat().st_size == SOURCE_BYTES, 'F0201 original size')
    with path.open('rb') as stream:
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == SOURCE_SHA, 'F0201 original SHA')


def run_full_source_probe(*, original, owner, images, created, http, post, sql, call,
                          write, checks, remaining, api_ready, wait_until):
    verify_original(original)
    _, raw_release = call('api-installed-v4-release', ['run', '--rm', '--network', 'none',
        '--read-only', '--cap-drop', 'ALL', '--memory', '768m', '--pids-limit', '128',
        '--tmpfs', '/tmp:rw,nosuid,size=64m', '--env', 'TSX_DISABLE_CACHE=1', images['api'],
        'node', '--import', 'tsx', '--input-type=module', '-e',
        "import {buildDocumentTextV4FullAuditReleaseTextLayer as build} from './apps/api/src/document-text-v4-full-audit-release.ts';process.stdout.write(JSON.stringify(build()))"])
    installed_release = json.loads(raw_release)
    require(installed_release['sourceAuditProfileVersion'] == PROFILE, 'Installed V4 source profile')
    obj = post('full-object', '/api/objects', canonical({
        'name': 'Real public F0201: full-source CPU transport acceptance',
        'address': 'PUBLIC TRAIN source only; revisions and engineering authority remain unverified'}))
    object_id = obj['id']
    require(re.fullmatch('[A-Za-z0-9-]{1,100}', object_id), 'Full source object ID')
    boundary = owner + '-full-' + secrets.token_hex(8)
    body = ('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="F0201.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+original.read_bytes()+('\r\n--'+boundary+'--\r\n').encode()
    upload = post('full-upload', '/api/objects/'+object_id+'/files?stage=RD', body,
                  'multipart/form-data; boundary='+boundary, timeout=120)
    del body
    require(upload['objectId'] == object_id and len(upload['files']) == 1, 'Full source upload association')
    file = upload['files'][0]
    require(file['sha256'] == SOURCE_SHA and file['size'] == SOURCE_BYTES
            and file['scanStatus'] == 'CLEAN' and file['status'] == 'STORED', 'Full source actual CLEAN original')
    source_id = file['id']
    require(re.fullmatch('[A-Za-z0-9-]{1,100}', source_id), 'Full source ID')
    check = post('full-start', '/api/objects/'+object_id+'/source-audit-v4-full-source-v1', b'{}')
    check_id = check['id']
    require(re.fullmatch('[A-Za-z0-9-]{1,100}', check_id) and check['mode'] == 'NORMAL'
            and check['objectId'] == object_id, 'Full source NORMAL check')
    where = "run.api_id='"+check_id+"'"
    poll_query = "SELECT json_agg(json_build_object('id',job.id,'type',job.job_type,'state',job.state,'attempts',job.attempt_count)) FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE "+where
    while True:
        jobs = sql('full-poll-'+str(time.monotonic_ns()), poll_query, persist=False)
        require(jobs and len(jobs) == 9 and not any(j['type'] == 'DOCUMENT_OCR_LAYOUT' for j in jobs),
                'Source audit schedules exactly nine jobs without OCR')
        require(not any(j['state'] in ['FAILED', 'DEAD', 'CANCELLED', 'RETRY_WAIT'] or j['attempts'] > 1 for j in jobs),
                'Full source job failed or retried: STOP')
        current = json.loads(http('full-check-poll', '/api/checks/'+check_id, persist=False)[0])
        require(current['status'] != 'FAILED', 'Full source check failed')
        if all(j['state'] == 'SUCCEEDED' for j in jobs) and current['status'] == 'PARTIAL':
            break
        time.sleep(min(5, remaining(5)))
    prefix = '/api/checks/'+check_id+'/source-text-v4-full-source-v1'
    path = prefix+'?'+urlencode({'sourceFileId': source_id})
    full_bytes = http('full-source-saved', path, max_bytes=33554432, timeout=120)[0]
    full = json.loads(full_bytes)
    artifact = full['textArtifact']
    artifact_bytes = canonical(artifact)
    domain_hash = sha(canonical({'hashDomain': 'document-text-v4-content-v1', 'artifact': artifact}))
    require(full['purpose'] == 'SOURCE_AUDIT_ONLY' and full['sourceAuditProfileVersion'] == PROFILE
            and full['resourcePolicyVersion'] == POLICY and full['sourceSha256'] == SOURCE_SHA
            and full['authorityStatus'] == 'SOURCE_DECLARED_UNVERIFIED'
            and full['renderedVisibility'] == 'UNVERIFIED' and full['calibratedProbability'] is None
            and full['latestReviewHash'] is None and full['pageStages'] == {}, 'Full source evidence boundaries')
    require(artifact['schemaVersion'] == 'document-text-v4' and artifact['sourceFileId'] == source_id
            and artifact['inputSha256'] == SOURCE_SHA and artifact['pageCount'] == 676
            and [p['pageNumber'] for p in artifact['pages']] == list(range(1, 677))
            and full['textArtifactContentHash'] == domain_hash
            and full['textArtifactByteSha256'] == sha(artifact_bytes), 'Whole canonical F0201 artifact integrity')
    require(artifact['extractorProfile'] == installed_release['extractorProfile']
            and artifact['extractorProfileHash'] == installed_release['extractorProfileHash'], 'Actual installed producer binding')
    # Native quality is reported, not interpreted as a visual/OCR accuracy measurement.
    require(artifact['qualitySummary']['ocrRequiredPages'] > 0, 'Real F0201 preserves native text gaps')
    evidence = sql('full-native-proof', """SELECT json_build_object(
      'run',json_build_object('id',run.id,'apiId',run.api_id,'state',run.run_state,'mode',run.mode,'sealed',run.sealed_at IS NOT NULL,'releaseId',run.release_id),
      'release',rel.content_json,
      'manifestHash',trim(manifest.sha256),
      'text', (SELECT json_build_object('hash',trim(t.content_hash),'bytes',t.byte_size,'pages',t.page_count,'schema',t.schema_version,'policy',t.resource_policy_version,'inputSha',trim(t.input_sha256),'jobId',t.job_id) FROM analysis_text_artifacts t WHERE t.run_id=run.id),
      'attempts',(SELECT json_agg(json_build_object('jobId',a.job_id,'state',a.state)) FROM job_attempts a JOIN analysis_jobs j ON j.id=a.job_id WHERE j.run_id=run.id),
      'outbox',(SELECT json_agg(json_build_object('state',o.state,'jobId',o.payload->>'job_id')) FROM domain_outbox o WHERE o.event_type='job.ready' AND o.payload->>'job_id' IN (SELECT id::text FROM analysis_jobs WHERE run_id=run.id)))
      FROM analysis_runs run JOIN analysis_releases rel ON rel.release_id=run.release_id
      JOIN input_manifests manifest ON manifest.id=run.manifest_id WHERE """+where)
    require(evidence['run']['sealed'] and evidence['run']['state'] == 'PARTIAL'
            and evidence['release']['textLayer'] == installed_release
            and evidence['release']['purpose'] == 'SOURCE_AUDIT_ONLY'
            and evidence['manifestHash'] == full['inputManifestHash'], 'Native full-source run/release/manifest')
    require(evidence['text'] == {'hash': sha(artifact_bytes), 'bytes': len(artifact_bytes), 'pages': 676,
            'schema': 'document-text-v4', 'policy': POLICY, 'inputSha': SOURCE_SHA,
            'jobId': next(j['id'] for j in jobs if j['type'] == 'DOCUMENT_TEXT_LAYER')}, 'Native stored full artifact byte identity')
    require(len(evidence['attempts']) == 9 and all(a['state'] == 'SUCCEEDED' for a in evidence['attempts']), 'Nine full-source successful real attempts')
    require(len(evidence['outbox']) == 9 and all(o['state'] == 'PUBLISHED' for o in evidence['outbox']), 'Nine full-source confirmed dispatches')
    write('full-native-proof.json', evidence)
    pages, next_page, batches = [], 1, []
    while next_page is not None:
        query = {'sourceFileId': source_id, 'startPage': next_page, 'pageLimit': 128}
        if next_page > 1:
            query['expectedArtifactContentHash'] = domain_hash
        b = json.loads(http('full-batch-'+str(next_page), prefix+'/pages?'+urlencode(query), timeout=120)[0])
        require(b['wholeArtifactPageCount'] == 676 and b['textArtifactContentHash'] == domain_hash
                and b['sourceSha256'] == SOURCE_SHA, 'Whole origin pinned on every full-source batch')
        require(b['pages'] == artifact['pages'][next_page-1:next_page+127], 'Exact absolute source page batch')
        pages.extend(p['pageNumber'] for p in b['pages'])
        batches.append({'startPage': next_page, 'count': len(b['pages'])})
        next_page = b['nextPage']
    require(pages == list(range(1, 677)) and len(batches) == 6, 'All 676 pages in six non-overlapping batches')
    for name, query in [('full-unpinned-continuation', {'sourceFileId':source_id,'startPage':129,'pageLimit':128}),
                        ('full-wrong-hash', {'sourceFileId':source_id,'startPage':129,'pageLimit':128,'expectedArtifactContentHash':'0'*64})]:
        http(name, prefix+'/pages?'+urlencode(query), status=409, timeout=120)
    http('full-oversize-batch', prefix+'/pages?'+urlencode({'sourceFileId':source_id,'startPage':1,'pageLimit':129}), status=400)
    # Persist and reread this large profile after a real process/database restart too.
    restart_roles = ['postgres', 'api', 'relay', 'rules', 'render', 'extract', 'link']
    call('full-restart-own-runtime', ['restart', '--time', '10']+[created[r][0] for r in restart_roles], cap=90)
    wait_until('API after full source restart', api_ready, 120)
    after = http('full-source-after-restart', path, max_bytes=33554432, timeout=120)[0]
    require(after == full_bytes, 'Whole 676-page authenticated read byte exact after restart')
    checks.append({'fullSourceRealQueue': True, 'sourceSha256': SOURCE_SHA, 'sourceBytes': SOURCE_BYTES,
        'pageCount': 676, 'lastPage': 676, 'canonicalBytes': len(artifact_bytes),
        'artifactByteSha256': sha(artifact_bytes), 'artifactContentHash': domain_hash,
        'qualitySummary': artifact['qualitySummary'], 'batches': batches, 'successfulAttempts':9,
        'ocrExecuted':False,'calibratedProbability':None,'engineeringQualified':False,
        'wholeReadByteExactAfterRestart':True,
        'stageDeclarationBoundary':'Upload stage RD is test input only; pageStages stay empty, authority unverified; no claim all676 pages are RD.'})
