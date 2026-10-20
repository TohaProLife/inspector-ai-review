"""Independent v6 worker QA: frozen manual oracles, no stand or legacy execute."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib,json,os,socket,threading,time,unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch
from inspector_worker import durable_call_inventory_matrix as w
from inspector_worker import durable_inventory_matrix as old
from inspector_worker import durable_matrix

ROOT=Path(__file__).resolve().parents[3]
FIXTURES=ROOT/'services/worker/tests/fixtures'
A=json.loads((ROOT/'fixtures/matrix-inventory-execution-v1/reviewed-wrapper-goldens.json').read_text())
C=json.loads((ROOT/'fixtures/matrix-call-execution-v1/root-call-execution-goldens.json').read_text())
BASE=json.loads((ROOT/'fixtures/matrix-inventory-execution-v1/base-v4-definitions.json').read_text())
AR=A['capabilityRegistry'];CALL=C['capabilityRegistry']
ATTEMPT={'attemptId':'local-qa-attempt /?','fencingToken':7}
RECORDS=[]
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def sha(x):return hashlib.sha256(canonical(x).encode()).hexdigest()
def file_sha(module):return hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
def expected_policy():
 return {'schemaVersion':'matrix-call-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
  'baseProfileId':'matrix-text-facts-inventory-v5','baseConfigHash':'26f8a2d425296c27573c11358ad394c3c0cd911861bb9b2b11b88fe6c87fb060',
  'capabilityRegistry':deepcopy(CALL),'capabilityRegistryHash':'86b0c1fef9f55bf5a6802c1747c9e59fd0f5ebb16c230a74d685b30c307f6e2d',
  'comparisonVersion':'matrix-odi123-call-inventory-comparison-v1','comparisonSourceSha256':file_sha(w.odi123_call_inventory_comparison),
  'sourceReconstructionVersion':'matrix-odi123-call-inventory-source-v1','sourceReconstructionSourceSha256':file_sha(w.call_inventory_source),
  'typedExecutionVersion':'matrix-call-inventory-execution-v1','typedExecutionSourceSha256':file_sha(w.call_inventory_execution),
  'durableWrapperVersion':'matrix-call-inventory-execution-v1','durableWrapperSourceSha256':file_sha(w),
  'coveragePolicyVersion':'matrix-call-inventory-coverage-v1','submissionPolicyVersion':'matrix-call-inventory-submission-v1',
  'hashPolicyVersion':'matrix-call-inventory-result-json-v1'}
def lease():
 d=deepcopy(BASE);d['inventoryExecution']=deepcopy(old._inventory_policy(AR));d['callInventoryExecution']=expected_policy()
 return {'jobId':'local qa/job?','objectId':C['cases'][0]['package']['objectId'],
  'inputManifestHash':C['cases'][0]['package']['inputManifestHash'],'inputs':{'sourceFiles':[],'sourceDecisions':{}},
  'release':{'lifecycle':'DRAFT','externalNetworkAllowed':False,'rules':{'matrixDefinitions':d},
   'providerSlot':{'profileId':'matrix-text-facts-call-inventory-v6','adapterVersion':'6','providerKind':'RULE_ENGINE',
    'stageJobType':'RULE_EVALUATION','status':'CONFIGURED','configHash':sha(d)}}}
def rehash(l):l['release']['providerSlot']['configHash']=sha(l['release']['rules']['matrixDefinitions'])
def bundle(extras=False):
 l=lease();a=deepcopy(A['cases'][0]['package']);c=deepcopy(C['cases'][0]['package'])
 a['objectId']=l['objectId'];a['inputManifestHash']=l['inputManifestHash']
 for source in a['sources']:source['review']['objectId']=l['objectId']
 for origin in a['origins']:origin['objectId']=l['objectId']
 original_a=deepcopy(a['sources']);original_c=deepcopy(c['sources'])
 for source in original_c:
  source['review'].pop('callInventoryScope');source['review']['inventoryScope']=None;a['sources'].append(source)
 for source in original_a:
  source['review'].pop('inventoryScope');source['review']['callInventoryScope']=None;c['sources'].append(source)
 origins=deepcopy(a['origins']+c['origins']);a['origins']=deepcopy(origins);c['origins']=deepcopy(origins)
 artifacts={o['sourceFileId']:deepcopy(o['textArtifact']) for o in origins}
 for source in a['sources']:
  sid=source['sourceFileId'];review=source['review']
  l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':source['sourceSha256'],'stages':deepcopy(source['stages']),
   'byteSize':1234,'mediaType':'application/pdf','sectionCode':review['sectionCode'],'downloadPath':'/api/internal/v1/jobs/local/inputs/'+sid})
  l['inputs']['sourceDecisions'][sid]={**deepcopy(review),'basis':{'reference':'Synthetic authored review; no database authority'}}
 if extras:
  steel=json.loads((FIXTURES/'matrix-steel-v1/research-wrapper-golden.json').read_text())['input']
  extra=list(zip(steel['sources'],steel['textArtifacts']))
  fire=json.loads((FIXTURES/'matrix-fire-table-v1/F0106-full.text.json').read_text())
  extra.append(({'sourceFileId':fire['sourceFileId'],'sha256':fire['inputSha256'],'stages':['PD'],'sectionCode':'KR'},fire))
  door=json.loads((FIXTURES/'pd-door-bound-F0151-p22.json').read_text());extra.append((door['source'],door['sourceArtifact']))
  for metadata,artifact in extra:
   metadata={key:deepcopy(metadata[key])for key in ['sourceFileId','sha256','stages','sectionCode']if key in metadata};metadata.update(byteSize=1234,mediaType='application/pdf',downloadPath='/api/internal/v1/jobs/local/inputs/'+metadata['sourceFileId'])
   l['inputs']['sourceFiles'].append(metadata);artifacts[metadata['sourceFileId']]=deepcopy(artifact)
   for domain in [a,c]:domain['sources'].append({'sourceFileId':metadata['sourceFileId'],'sourceSha256':metadata['sha256'],
    'stages':metadata['stages'],'reviewSnapshot':None,'review':None})
 return l,{'schemaVersion':'matrix-reviewed-inventory-loader-inputs-v2','objectId':l['objectId'],
  'inputManifestHash':l['inputManifestHash'],'inventory':a,'callInventory':c},artifacts

def manual_ar_envelope(l):
 e=deepcopy(A['cases'][0]['expectedEnvelope']);e['objectId']=l['objectId'];e['inputManifestHash']=l['inputManifestHash']
 for row in e['results']:
  body={k:v for k,v in row.items() if k!='id'}
  row['id']=sha({'hashDomain':'matrix-inventory-execution-result-id-v1','objectId':e['objectId'],
   'inputManifestHash':e['inputManifestHash'],'capabilityRegistryHash':e['capabilityRegistryHash'],'result':body})
 return e

class Server(ThreadingHTTPServer):
 daemon_threads=True
 def handle_error(self,*args):pass
@contextmanager
def http_fixture(body=None,*,status=200,headers=None,omit=(),delay_headers=0,delay_body=0,close=False,raw_body=None,drip=False):
 if body is None:body=bundle()[1]
 body=canonical(body).encode() if raw_body is None else raw_body
 default={'Content-Length':str(len(body)),'X-Content-SHA256':hashlib.sha256(body).hexdigest(),
  'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v2',
  'X-Input-Manifest-SHA256':lease()['inputManifestHash']}
 default.update(headers or {})
 for key in omit:default.pop(key,None)
 state={'requests':[],'finished':0};done=threading.Event()
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*args):pass
  def do_GET(self):
   state['requests'].append({'path':self.path,'token':self.headers.get('X-Worker-Token')})
   try:
    if delay_headers:time.sleep(delay_headers)
    self.send_response(status)
    for key,value in default.items():self.send_header(key,value)
    if close:self.send_header('Connection','close');self.close_connection=True
    self.end_headers()
    if delay_body:time.sleep(delay_body)
    if drip:
     for part in [body[:1],body[1:2],body[2:]]:
      self.wfile.write(part);self.wfile.flush();time.sleep(.04)
    elif body:self.wfile.write(body);self.wfile.flush()
   except (OSError,ConnectionError):pass
   finally:state['finished']+=1;done.set()
 server=Server(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
 try:
  with patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':f'http://127.0.0.1:{server.server_port}',
   'INTERNAL_WORKER_TOKEN':'synthetic-local-qa-token'}):yield state
 finally:
  server.shutdown();server.server_close();thread.join(1)
  if not delay_headers and not delay_body and not drip:done.wait(.5)
  if thread.is_alive():raise AssertionError('local HTTP server leaked')

class PolicyTests(unittest.TestCase):
 def test_manual_exact_policy_and_frozen_four_and_v5_definitions(self):
  l=lease();d=l['release']['rules']['matrixDefinitions'];self.assertEqual(w._call_inventory_policy(CALL),expected_policy())
  self.assertEqual(sha({k:v for k,v in d.items() if k!='callInventoryExecution'}),'26f8a2d425296c27573c11358ad394c3c0cd911861bb9b2b11b88fe6c87fb060')
  self.assertEqual(sha(BASE),'aedbc793122525242dbdcd7b3b56c5ddf3e176869a1aa31137db11833d94181e')
  self.assertEqual(w._load_capability_registries(),(AR,CALL))
  with patch.object(old,'_validate_release',side_effect=AssertionError('spoofed validation')) as forbidden:
   self.assertEqual(w._validate_release(l,AR,CALL),(l['release']['providerSlot'],sha(d)))
  forbidden.assert_not_called()
 def assert_rejected_before_network(self,l):
  with patch.object(w,'download_reviewed_inventory_comparison_inputs') as network,patch.object(w,'download_text_artifact') as text:
   with self.assertRaises(ValueError):w.execute_durable_call_inventory_matrix(l,ATTEMPT)
   network.assert_not_called();text.assert_not_called()
 def test_v1_to_v5_slot_and_v6_slot_drift_before_network(self):
  changes=[('profileId',x)for x in ['matrix-text-facts-v1','matrix-text-facts-constraints-v2','matrix-text-facts-evidence-v3','matrix-text-facts-evidence-v4','matrix-text-facts-inventory-v5']]
  changes += [('adapterVersion',x)for x in ['1','2','3','4','5',6]]+[('providerKind','OCR_LAYOUT'),('stageJobType','TEXT_EXTRACTION'),('status','DISABLED'),('configHash','0'*64)]
  for key,value in changes:
   l=lease();l['release']['providerSlot'][key]=value
   with self.subTest(key=key,value=value):self.assert_rejected_before_network(l)
 def test_every_definition_leaf_missing_changed_extra_rehashed(self):
  d=lease()['release']['rules']['matrixDefinitions'];paths=[]
  def walk(value,path=()):
   if type(value)is dict:
    for key,child in value.items():walk(child,path+(key,))
   else:paths.append(path)
  walk(d)
  for path in paths:
   for mode in ['missing','changed','extra']:
    l=lease();node=l['release']['rules']['matrixDefinitions']
    for key in path[:-1]:node=node[key]
    if mode=='missing':node.pop(path[-1])
    elif mode=='changed':node[path[-1]]='incorrect'
    else:node['unexpectedExtra']=True
    rehash(l)
    with self.subTest(path=path,mode=mode):self.assert_rejected_before_network(l)
  RECORDS.append({'case':'all-definition-leaves','mutations':len(paths)*3,'status':'PASS'})
 def test_numeric_boolean_policy_aliases_rejected_before_network(self):
  for value in [1,1.0]:
   l=lease();l['release']['rules']['matrixDefinitions']['callInventoryExecution']['capabilityRegistry']['entries'][0]['enabled']=value;rehash(l)
   with self.subTest(value=repr(value)):self.assert_rejected_before_network(l)
 def test_lifecycle_network_and_missing_definition_blocks(self):
  for key,value in [('lifecycle','RELEASED'),('externalNetworkAllowed',True),('externalNetworkAllowed',0)]:
   l=lease();l['release'][key]=value
   with self.subTest(field=key):self.assert_rejected_before_network(l)
  for key in ['inventoryExecution','callInventoryExecution','projectConstraints','sourceDeclarations','engineSourceSha256']:
   l=lease();l['release']['rules']['matrixDefinitions'].pop(key);rehash(l)
   with self.subTest(field=key):self.assert_rejected_before_network(l)
 def test_all_runtime_file_pins_including_both_frozen_helpers(self):
  modules=[w.matrix_engine,w.matrix_fact_scope,w.project_zero_prose,w.rebar_prose,w.concrete_prose,w.project_constraints,
   w.source_declarations,w.source_declarations_v2,w.steel_prose,w.fire_resistance_table,w.table_row_binding,
   old.ar053_inventory_comparison,old.inventory_source,old._inventory_execution,w.odi123_call_inventory_comparison,w.call_inventory_source,w.call_inventory_execution]
  actual=w._file
  for module in modules:
   with self.subTest(module=module.__name__),patch.object(w,'_file',side_effect=lambda m:'0'*64 if m is module else actual(m)),patch.object(old,'_file',side_effect=lambda m:'0'*64 if m is module else actual(m)):
    self.assert_rejected_before_network(lease_original())
 def test_legacy_execute_and_legacy_validate_are_never_called(self):
  l,p,artifacts=bundle()
  with patch.object(old,'execute_durable_inventory_matrix',side_effect=AssertionError('legacy execute')),patch.object(old,'_validate_release',side_effect=AssertionError('spoofed lease')),patch.object(durable_matrix,'execute_durable_matrix',side_effect=AssertionError('legacy matrix')),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])):
   result=w.execute_durable_call_inventory_matrix(l,ATTEMPT)
  self.assertEqual(result['providerProfileId'],'matrix-text-facts-call-inventory-v6')

# Freeze a valid release before pin-drift mocks. Expected policy never calls new worker code.
ORIGINAL_LEASE=lease()
def lease_original():return deepcopy(ORIGINAL_LEASE)

class ExecutionTests(unittest.TestCase):
 def test_full_original_scalar_and_siblings_unchanged_both_typed_candidates(self):
  l,p,artifacts=bundle(extras=True);before=deepcopy((l,p,artifacts));sources=[]
  for source in l['inputs']['sourceFiles']:
   decision=l['inputs']['sourceDecisions'].get(source['sourceFileId'])
   sources.append({**source,**w._reviewed_source(source,decision),'scopeProofs':(decision or {}).get('scopeProofs',{})})
  texts=list(artifacts.values())
  scalar=w.matrix_engine.build_matrix_execution(object_id=l['objectId'],input_manifest_hash=l['inputManifestHash'],sources=sources,text_artifacts=texts,registry=w.matrix_engine.load_matrix_registry())
  constraints=w.project_constraints.extract_project_constraints(l['objectId'],l['inputManifestHash'],sources,texts)
  declarations=w.source_declarations_v2.extract_source_declarations({'objectId':l['objectId'],'inputManifestHash':l['inputManifestHash'],'sources':sources,'textArtifacts':texts})
  with patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])) as text,http_fixture(p,close=True):result=w.execute_durable_call_inventory_matrix(l,ATTEMPT)
  self.assertEqual(result['execution'],scalar);self.assertEqual(result['projectConstraints'],constraints);self.assertEqual(result['sourceDeclarations'],declarations)
  self.assertEqual(len(constraints['constraints']),1);self.assertEqual(len(declarations['declarations']),8)
  self.assertEqual(result['inventoryComparisons'],manual_ar_envelope(l));self.assertEqual(result['callInventoryComparisons'],C['cases'][0]['expectedEnvelope'])
  self.assertEqual(result['outputCount'],len(scalar['results'])+2);self.assertEqual(text.call_count,len(artifacts))
  self.assertEqual(set(result),{'schemaVersion','jobType','inputManifestHash','disposition','providerKind','providerProfileId','providerConfigHash','outputCount','execution','projectConstraints','sourceDeclarations','inventoryComparisons','callInventoryComparisons','effectiveCoverage'})
  self.assertEqual(result['providerConfigHash'],l['release']['providerSlot']['configHash'])
  for previous,current in zip(scalar['coverage'],result['effectiveCoverage']):
   if previous['parameterCode']not in {'AR-053','ODI-123'}:self.assertEqual(canonical(previous),canonical(current))
   else:self.assertEqual((current['implementedAtomicRules'],current['enabledAtomicRules'],current['evaluatedAtomicRules'],current['successfulComparisons'],current['abstentions'],current['failures'],current['executionStatus']),(1,1,1,1,0,0,'PARTIAL'))
  for envelope in [result['inventoryComparisons'],result['callInventoryComparisons']]:
   self.assertIsNone(envelope['results'][0]['comparison']['calibratedProbability'])
  self.assertEqual((l,p,artifacts),before)
  RECORDS.append({'case':'actual-v6-full-canonical','pages':sum(a['pageCount']for a in artifacts.values()),'observations':len(scalar['observations']),'scalarRows':len(scalar['results']),'arRows':1,'callRows':1,'constraints':1,'declarations':8,'scalarExecutionSha256':sha(scalar),'v6ConfigHash':result['providerConfigHash'],'status':'PASS'})
 def test_actual_joblease_contract_has_no_per_source_object_id(self):
  l,p,_=bundle()
  fields={'sourceFileId','sha256','stages','sectionCode','byteSize','mediaType','downloadPath'}
  for source in l['inputs']['sourceFiles']:self.assertEqual(set(source),fields)
  self.assertEqual(w._validate_loader(p,l),p)
 def test_optional_source_object_id_mismatch_rejected(self):
  l,p,_=bundle();l['inputs']['sourceFiles'][0]['objectId']='wrong-object'
  with self.assertRaises(ValueError):w._validate_loader(p,l)
 def test_reordered_source_and_origin_unions_remain_same_binding(self):
  l,p,artifacts=bundle();p['callInventory']['sources'].reverse();p['callInventory']['origins'].reverse()
  result=w._validate_loader(p,l);self.assertEqual(result,p)
 def test_union_review_lease_and_association_faults_before_text(self):
  l,p,_=bundle();faults=[]
  def add(name,mutate):q=deepcopy(p);ll=deepcopy(l);mutate(q,ll);faults.append((name,q,ll))
  add('top-extra',lambda q,l:q.update(extra=True));add('top-wrong-schema',lambda q,l:q.update(schemaVersion='old'))
  for domain in ['inventory','callInventory']:
   add(domain+'-object',lambda q,l,d=domain:q[d].update(objectId='other'))
   add(domain+'-manifest',lambda q,l,d=domain:q[d].update(inputManifestHash='0'*64))
   add(domain+'-missing-source',lambda q,l,d=domain:q[d]['sources'].pop())
   add(domain+'-origin-union',lambda q,l,d=domain:q[d]['origins'].pop())
   add(domain+'-corrupt-unrelated-origin',lambda q,l,d=domain:q[d]['origins'][-1]['textArtifact']['pages'][0]['blocks'][0].update(text='FORGED'))
  add('lease-missing-source',lambda q,l:l['inputs']['sourceFiles'].pop());add('lease-source-sha',lambda q,l:l['inputs']['sourceFiles'][0].update(sha256='0'*64))
  add('lease-source-stage',lambda q,l:l['inputs']['sourceFiles'][0].update(stages=['RD']))
  add('lease-duplicate-source',lambda q,l:l['inputs']['sourceFiles'].append(deepcopy(l['inputs']['sourceFiles'][0])))
  add('lease-review-withdrawn',lambda q,l:l['inputs']['sourceDecisions'].pop(l['inputs']['sourceFiles'][0]['sourceFileId']))
  add('lease-review-revision',lambda q,l:l['inputs']['sourceDecisions'][l['inputs']['sourceFiles'][0]['sourceFileId']].update(revisionStatus='UNKNOWN'))
  add('lease-unknown-decision',lambda q,l:l['inputs']['sourceDecisions'].update(extra={}))
  for name,q,ll in faults:
   with self.subTest(name=name),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as text,patch.object(w.matrix_engine,'build_matrix_execution')as scalar:
    with self.assertRaises(ValueError):w.execute_durable_call_inventory_matrix(ll,ATTEMPT)
    text.assert_not_called();scalar.assert_not_called()
  RECORDS.append({'case':'complete-projection-association','mutations':len(faults),'status':'PASS'})
 def test_all_unknown_claims_reconstruct_before_eligibility(self):
  l,p,_=bundle()
  for domain,sibling in [('inventory','inventoryScope'),('callInventory','callInventoryScope')]:
   q=deepcopy(p);source=next(s for s in q[domain]['sources']if s['review'][sibling]);source['review']['approvalStatus']='UNKNOWN'
   claim=source['review'][sibling]['claims'][0];claim['inventorySnapshot']['featureRows'][0]['fragments'][0]['rawText']='FORGED'
   with self.subTest(domain=domain),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as text:
    with self.assertRaises(ValueError):w.execute_durable_call_inventory_matrix(l,ATTEMPT)
    text.assert_not_called()

class HttpTests(unittest.TestCase):
 def test_http_path_auth_and_connection_close(self):
  l,p,_=bundle()
  for close in [False,True]:
   with self.subTest(close=close),http_fixture(p,close=close)as state:
    self.assertEqual(w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT),p)
    self.assertEqual(state['requests'],[{'path':'/api/internal/v1/jobs/local%20qa%2Fjob%3F/reviewed-inventory-comparison-inputs?attemptId=local-qa-attempt+%2F%3F&fencingToken=7','token':'synthetic-local-qa-token'}])
 def test_status_401_409_and_no_redirect(self):
  for code,error in [(401,ValueError),(409,w.TextArtifactLeaseLost),(302,ValueError)]:
   with self.subTest(code=code),http_fixture(status=code,close=True),self.assertRaises(error):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_missing_and_forged_headers(self):
  for key in ['Content-Length','X-Content-SHA256','X-Artifact-Schema-Version','X-Input-Manifest-SHA256']:
   with self.subTest(missing=key),http_fixture(omit=[key],close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  for key,value in [('Content-Length','0'),('Content-Length','-1'),('Content-Length','2.0'),('Content-Length',str(w.MAX_LOADER_BYTES+1)),('X-Content-SHA256','0'*64),('X-Content-SHA256','BAD'),('X-Artifact-Schema-Version','matrix-ar053-loader-inputs-v1'),('X-Input-Manifest-SHA256','0'*64)]:
   with self.subTest(key=key,value=value),http_fixture(headers={key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_exact_transport_cap_and_short_body(self):
  p=bundle()[1];body=canonical(p).encode()
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(body)-1),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(body)):self.assertEqual(w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT),p)
  with http_fixture(raw_body=body[:-1],headers={'Content-Length':str(len(body)),'X-Content-SHA256':hashlib.sha256(body).hexdigest()},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_duplicate_json_utf8_nan_and_exact_top_keys(self):
  body=canonical(bundle()[1]);bad=[('{"objectId":"wrong",'+body[1:]).encode(),body.replace('"schemaVersion":','"schemaVersion":"old","schemaVersion":',1).encode(),b'\xff',b'[]',b'not-json',b'{"x":NaN}']
  for raw in bad:
   with self.subTest(bodySha=hashlib.sha256(raw).hexdigest()),http_fixture(raw_body=raw,close=True),self.assertRaises((ValueError,UnicodeError)):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  for key,value in [('objectId','wrong'),('inputManifestHash','0'*64),('schemaVersion','old'),('extra',True)]:
   p=bundle()[1];p[key]=value
   with self.subTest(field=key),http_fixture(p,close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_stall_header_body_and_drip_overall_deadline(self):
  for mode in ['header','body','drip']:
   started=time.monotonic()
   with self.subTest(mode=mode),http_fixture(delay_headers=.25 if mode=='header'else 0,delay_body=.25 if mode=='body'else 0,drip=mode=='drip',close=True),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.06),self.assertRaises((TimeoutError,socket.timeout)):
    w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertLess(time.monotonic()-started,.8)
 def test_cleanup_success_status_bad_header_timeout(self):
  actual=w.http.client.HTTPConnection
  for mode in ['success','401','header','timeout']:
   seen=[]
   class Track(actual):
    def __init__(self,*a,**kw):super().__init__(*a,**kw);self.response=None;self.closed=False;seen.append(self)
    def getresponse(self):self.response=super().getresponse();return self.response
    def close(self):self.closed=True;super().close()
   options={'close':True}
   if mode=='401':options['status']=401
   if mode=='header':options['headers']={'X-Content-SHA256':'bad'}
   if mode=='timeout':options['delay_body']=.2
   with self.subTest(mode=mode),http_fixture(**options),patch.object(w.http.client,'HTTPConnection',Track),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.05):
    if mode=='success':w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
    else:
     with self.assertRaises((ValueError,TimeoutError)):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertEqual(len(seen),1);self.assertTrue(seen[0].closed);self.assertIsNone(seen[0].sock);self.assertTrue(seen[0].response.isclosed())
 def test_attempt_and_internal_url_fail_before_socket(self):
  for attempt in [{},dict(ATTEMPT,fencingToken=True),dict(ATTEMPT,fencingToken=0),dict(ATTEMPT,attemptId='')]:
   with self.subTest(attempt=attempt),patch.object(w.http.client,'HTTPConnection')as connect,self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),attempt)
   connect.assert_not_called()
  for url in ['file:///tmp/file','http://user:password@127.0.0.1','http:///absent']:
   with self.subTest(url=url),patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':url}),patch.object(w.http.client,'HTTPConnection')as connect,self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   connect.assert_not_called()

if __name__=='__main__':unittest.main()
