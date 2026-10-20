"""Independent QA of staged v5 durable worker. No stand/network beyond loopback."""
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import hashlib, importlib.util, json, os, socket, threading, time, unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
P=ROOT/'fixtures/matrix-inventory-execution-v1'
FIXTURES=ROOT/'services/worker/tests/fixtures'
DRAFT=ROOT/'services/worker/inspector_worker/durable_inventory_matrix.py'
from inspector_worker import durable_inventory_matrix as w
from inspector_worker import durable_matrix
F=json.loads((P/'reviewed-wrapper-goldens.json').read_text())
CAP=F['capabilityRegistry'];BASE=json.loads((P/'base-v4-definitions.json').read_text())
ATTEMPT={'attemptId':'local-qa-attempt /?', 'fencingToken':7}
RECORDS=[]
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(x):return hashlib.sha256(canonical(x).encode()).hexdigest()
def lease():
 d=deepcopy(BASE);d['inventoryExecution']=w._inventory_policy(CAP)
 return {'jobId':'local qa/job?', 'objectId':F['cases'][0]['package']['objectId'],
  'inputManifestHash':F['cases'][0]['package']['inputManifestHash'],'inputs':{'sourceFiles':[],'sourceDecisions':{}},
  'release':{'lifecycle':'DRAFT','externalNetworkAllowed':False,'rules':{'matrixDefinitions':d},
    'providerSlot':{'profileId':w.PROFILE_ID,'adapterVersion':'5','providerKind':'RULE_ENGINE',
      'stageJobType':'RULE_EVALUATION','status':'CONFIGURED','configHash':digest(d)}}}
def rehash(x):x['release']['providerSlot']['configHash']=digest(x['release']['rules']['matrixDefinitions'])
def bundle():
 package=deepcopy(F['cases'][0]['package']);artifacts={o['sourceFileId']:deepcopy(o['textArtifact']) for o in package['origins']}
 steel=json.loads((FIXTURES/'matrix-steel-v1/research-wrapper-golden.json').read_text())['input']
 extras=list(zip(steel['sources'],steel['textArtifacts']))
 fire=json.loads((FIXTURES/'matrix-fire-table-v1/F0106-full.text.json').read_text())
 extras.append(({'sourceFileId':fire['sourceFileId'],'sha256':fire['inputSha256'],'stages':['PD'],'sectionCode':'KR'},fire))
 door=json.loads((FIXTURES/'pd-door-bound-F0151-p22.json').read_text());extras.append((door['source'],door['sourceArtifact']))
 l=lease()
 for source in package['sources']:
  review=source['review'];sid=source['sourceFileId']
  l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':source['sourceSha256'],'stages':source['stages'],
    'objectId':l['objectId'],'mediaType':'application/pdf','sectionCode':review['sectionCode']})
  l['inputs']['sourceDecisions'][sid]={**review,'basis':{'reference':'Synthetic authored fixture review; no DB authority claim'}}
 for metadata,artifact in extras:
  metadata=deepcopy(metadata);metadata.update(objectId=l['objectId'],mediaType='application/pdf')
  l['inputs']['sourceFiles'].append(metadata);artifacts[metadata['sourceFileId']]=deepcopy(artifact)
  package['sources'].append({'sourceFileId':metadata['sourceFileId'],'sourceSha256':metadata['sha256'],
    'stages':metadata['stages'],'reviewSnapshot':None,'review':None})
 return l,package,artifacts

class Server(ThreadingHTTPServer):
 daemon_threads=True
 def handle_error(self,*args):pass
@contextmanager
def http_fixture(body=None,*,status=200,headers=None,omit=(),delay_headers=0,delay_body=0,close=False,raw_body=None):
 body=canonical(body if body is not None else F['cases'][0]['package']).encode() if raw_body is None else raw_body
 default={'Content-Length':str(len(body)),'X-Content-SHA256':hashlib.sha256(body).hexdigest(),
  'X-Artifact-Schema-Version':'matrix-ar053-loader-inputs-v1',
  'X-Input-Manifest-SHA256':F['cases'][0]['package']['inputManifestHash']}
 default.update(headers or {})
 for key in omit:default.pop(key,None)
 state={'requests':[],'accepted':0,'finished':0};finished=threading.Event()
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*args):pass
  def do_GET(self):
   state['accepted']+=1;state['requests'].append({'path':self.path,'token':self.headers.get('X-Worker-Token')})
   try:
    if delay_headers:time.sleep(delay_headers)
    self.send_response(status)
    for k,v in default.items():self.send_header(k,v)
    if close:self.send_header('Connection','close');self.close_connection=True
    self.end_headers()
    if delay_body:time.sleep(delay_body)
    if body:self.wfile.write(body);self.wfile.flush()
   except (BrokenPipeError,ConnectionResetError,OSError):pass
   finally:state['finished']+=1;finished.set()
 server=Server(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
 try:
  with patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':f'http://127.0.0.1:{server.server_port}',
                              'INTERNAL_WORKER_TOKEN':'synthetic-local-qa-token'}):yield state
 finally:
  server.shutdown();server.server_close();thread.join(timeout=1)
  if not delay_body and not delay_headers:finished.wait(.5)
  if thread.is_alive():raise AssertionError('local HTTP server thread leaked')

class WorkerTests(unittest.TestCase):
 def test_actual_v5_full226_pages_scalar_v4_identical_and_all_siblings(self):
  l,p,artifacts=bundle();before=deepcopy((l,p,artifacts))
  legacy=deepcopy(l);legacy['release']['providerSlot'].update(profileId=w.BASE_PROFILE_ID,adapterVersion='4')
  legacy['release']['rules']['matrixDefinitions']=deepcopy(BASE);rehash(legacy)
  with patch('inspector_worker.durable_matrix.download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])):
   baseline=durable_matrix.execute_durable_matrix(legacy,ATTEMPT)
  with patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])) as text,patch.object(durable_matrix,'execute_durable_matrix',side_effect=AssertionError('forged v4 delegation')) as delegate,http_fixture(p,close=True):
   result=w.execute_durable_inventory_matrix(l,ATTEMPT)
  delegate.assert_not_called();self.assertEqual(text.call_count,len(artifacts));self.assertEqual(canonical(result['execution']),canonical(baseline['execution']))
  self.assertEqual(result['projectConstraints'],baseline['projectConstraints']);self.assertEqual(result['sourceDeclarations'],baseline['sourceDeclarations'])
  self.assertEqual(len(result['projectConstraints']['constraints']),1);self.assertEqual(len(result['sourceDeclarations']['declarations']),8)
  self.assertEqual(result['inventoryComparisons'],F['cases'][0]['expectedEnvelope'])
  self.assertEqual(result['outputCount'],len(result['execution']['results'])+1)
  for old,new in zip(result['execution']['coverage'],result['effectiveCoverage']):
   if old['parameterCode']!='AR-053':self.assertEqual(canonical(old),canonical(new))
  row=next(r for r in result['effectiveCoverage'] if r['parameterCode']=='AR-053')
  self.assertEqual((row['successfulComparisons'],row['abstentions'],row['failures'],row['executionStatus']),(1,0,0,'PARTIAL'))
  self.assertNotIn('inventoryComparisons',result['execution']);self.assertEqual((l,p,artifacts),before)
  RECORDS.append({'case':'actual-v5-full-canonical','pages':sum(a['pageCount'] for a in artifacts.values()),'observations':len(result['execution']['observations']),
    'scalarRows':len(result['execution']['results']),'typedRows':len(result['inventoryComparisons']['results']),
    'constraints':1,'declarations':8,'scalarExecutionSha256':digest(result['execution']),'baseConfigHash':legacy['release']['providerSlot']['configHash'],
    'v5ConfigHash':result['providerConfigHash'],'status':'PASS'})
 def test_profiles_v1_to_v4_and_slot_drift_fail_before_network(self):
  changes=[('profileId',p)for p in ['matrix-text-facts-v1','matrix-text-facts-constraints-v2','matrix-text-facts-evidence-v3','matrix-text-facts-evidence-v4']]
  changes += [('adapterVersion',v)for v in ['1','2','3','4',5]]+[('providerKind','OCR_LAYOUT'),('stageJobType','TEXT_EXTRACTION'),('status','DISABLED'),('configHash','0'*64)]
  for k,v in changes:
   l=lease();l['release']['providerSlot'][k]=v
   with self.subTest(key=k,value=v),patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_inventory_comparison_inputs') as network,patch.object(w,'download_text_artifact') as text:
    with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(l,ATTEMPT)
    network.assert_not_called();text.assert_not_called()
 def test_every_policy_pin_missing_changed_extra_rehashed_fail_before_network(self):
  original=lease()['release']['rules']['matrixDefinitions'];paths=[]
  for k,v in original.items():
   if k=='registry':continue
   if type(v)is dict:
    for child in v:paths.append((k,child))
   else:paths.append((k,))
  paths+=[('registry','catalogSha256')]
  tested=0
  for path in paths:
   for mode in ['missing','changed','extra']:
    l=lease();node=l['release']['rules']['matrixDefinitions']
    for key in path[:-1]:node=node[key]
    if mode=='missing':node.pop(path[-1])
    elif mode=='changed':node[path[-1]]='incorrect'
    else:node['unexpectedExtra']=True
    rehash(l)
    with self.subTest(path=path,mode=mode),patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_inventory_comparison_inputs') as network,patch.object(w,'download_text_artifact') as text:
     with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(l,ATTEMPT)
     network.assert_not_called();text.assert_not_called()
    tested+=1
  RECORDS.append({'case':'pin-body-before-network','vectors':tested,'status':'PASS'})
 def test_lifecycle_external_network_and_missing_policy_fail_before_network(self):
  for field,value in [('lifecycle','RELEASED'),('externalNetworkAllowed',True),('externalNetworkAllowed',0)]:
   l=lease();l['release'][field]=value
   with self.subTest(field=field,value=value),patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_inventory_comparison_inputs') as network:
    with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(l,ATTEMPT)
    network.assert_not_called()
  for field in ['inventoryExecution','projectConstraints','sourceDeclarations','engineSourceSha256']:
   l=lease();l['release']['rules']['matrixDefinitions'].pop(field);rehash(l)
   with self.subTest(field=field),patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_inventory_comparison_inputs') as network:
    with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(l,ATTEMPT)
    network.assert_not_called()
 def test_runtime_file_drift_blocks_before_network(self):
  real=w._file
  for module in [w.matrix_engine,w.matrix_fact_scope,w.project_zero_prose,w.rebar_prose,w.concrete_prose,w.project_constraints,w.source_declarations,w.source_declarations_v2,w.steel_prose,w.fire_resistance_table,w.table_row_binding]:
   l=lease()
   with self.subTest(module=module.__name__),patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'_file',side_effect=lambda m:'0'*64 if m is module else real(m)),patch.object(w,'download_inventory_comparison_inputs') as network:
    with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(l,ATTEMPT)
    network.assert_not_called()
 def test_execute_corrupt_trusted_package_fails_before_text_or_scalar(self):
  p=deepcopy(F['cases'][0]['package']);p['origins'][0]['textArtifact']['pages'][0]['blocks'][0]['text']+='FORGED'
  with patch.object(w,'_load_capability_registry',return_value=CAP),patch.object(w,'download_text_artifact') as text,patch.object(w.matrix_engine,'build_matrix_execution') as scalar,http_fixture(p):
   with self.assertRaises(ValueError):w.execute_durable_inventory_matrix(lease(),ATTEMPT)
   text.assert_not_called();scalar.assert_not_called()

class HttpTests(unittest.TestCase):
 def test_actual_http_valid_headers_path_and_connection_close(self):
  p=F['cases'][0]['package']
  for close in [False,True]:
   with self.subTest(close=close),http_fixture(p,close=close) as state:
    self.assertEqual(w.download_inventory_comparison_inputs(lease(),ATTEMPT),p)
    self.assertEqual(state['requests'][0],{'path':'/api/internal/v1/jobs/local%20qa%2Fjob%3F/inventory-comparison-inputs?attemptId=local-qa-attempt+%2F%3F&fencingToken=7','token':'synthetic-local-qa-token'})
 def test_http_401_and_409_are_distinct(self):
  for code,error in [(401,ValueError),(409,w.TextArtifactLeaseLost)]:
   with self.subTest(status=code),http_fixture(status=code,close=True):
    with self.assertRaises(error):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_missing_and_forged_headers_rejected(self):
  required=['Content-Length','X-Content-SHA256','X-Artifact-Schema-Version','X-Input-Manifest-SHA256']
  for key in required:
   with self.subTest(missing=key),http_fixture(omit=[key],close=True):
    with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
  for k,v in [('Content-Length','0'),('Content-Length','-1'),('Content-Length',str(w.MAX_LOADER_BYTES+1)),('Content-Length','2.0'),('X-Content-SHA256','0'*64),('X-Content-SHA256','notsha'),('X-Artifact-Schema-Version','old'),('X-Input-Manifest-SHA256','0'*64)]:
   with self.subTest(key=k,value=v),http_fixture(headers={k:v},close=True):
    with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_actual_bytebound_and_short_body_no_giant_allocations(self):
  p=F['cases'][0]['package'];b=canonical(p).encode()
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(b)-1):
   with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(b)):
   self.assertEqual(w.download_inventory_comparison_inputs(lease(),ATTEMPT),p)
  with http_fixture(raw_body=b[:-1],headers={'Content-Length':str(len(b)),'X-Content-SHA256':hashlib.sha256(b).hexdigest()},close=True):
   with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_duplicate_json_utf8_and_wrong_current_package_reject(self):
  p=F['cases'][0]['package'];body=canonical(p)
  data=[('{"objectId":"wrong",'+body[1:]).encode(),body.replace('"schemaVersion":','"schemaVersion":"fake","schemaVersion":',1).encode(),b'\xff',b'not-json',b'[]']
  for raw in data:
   with self.subTest(rawSha=hashlib.sha256(raw).hexdigest()),http_fixture(raw_body=raw,close=True):
    with self.assertRaises((ValueError,UnicodeError)):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
  for key in ['objectId','inputManifestHash']:
   bad=deepcopy(p);bad[key]='wrong'
   with self.subTest(field=key),http_fixture(bad,close=True):
    with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_stalled_headers_and_body_obey_socket_timeout_and_cleanup(self):
  for where in ['headers','body']:
   started=time.monotonic()
   with self.subTest(stall=where),http_fixture(delay_headers=.35 if where=='headers' else 0,delay_body=.35 if where=='body' else 0,close=True),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.08):
    with self.assertRaises((TimeoutError,socket.timeout)):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertLess(time.monotonic()-started,.8)
 def test_response_and_connection_closed_success_failure_timeout(self):
  real=w.http.client.HTTPConnection
  for mode in ['success','401','invalid-header','body-timeout']:
   seen=[]
   class TrackingConnection(real):
    def __init__(self,*a,**kw):super().__init__(*a,**kw);self.qa_response=None;self.qa_closed=False;seen.append(self)
    def getresponse(self):self.qa_response=super().getresponse();return self.qa_response
    def close(self):self.qa_closed=True;super().close()
   options={'close':True}
   if mode=='401':options['status']=401
   if mode=='invalid-header':options['headers']={'X-Content-SHA256':'bad'}
   if mode=='body-timeout':options['delay_body']=.2
   with self.subTest(mode=mode),http_fixture(**options),patch.object(w.http.client,'HTTPConnection',TrackingConnection),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.05):
    if mode=='success':w.download_inventory_comparison_inputs(lease(),ATTEMPT)
    else:
     with self.assertRaises((ValueError,TimeoutError)):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertEqual(len(seen),1);self.assertTrue(seen[0].qa_closed);self.assertIsNone(seen[0].sock)
   self.assertTrue(seen[0].qa_response.isclosed())
 def test_bad_attempt_and_credentialed_url_before_socket(self):
  for attempt in [{},dict(ATTEMPT,fencingToken=True),dict(ATTEMPT,fencingToken=0),dict(ATTEMPT,attemptId='')]:
   with self.subTest(attempt=attempt),patch.object(w.http.client,'HTTPConnection') as connect:
    with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),attempt)
    connect.assert_not_called()
  for url in ['file:///tmp/source','http://user:password@127.0.0.1','http:///absent']:
   with self.subTest(url=url),patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':url}),patch.object(w.http.client,'HTTPConnection') as connect:
    with self.assertRaises(ValueError):w.download_inventory_comparison_inputs(lease(),ATTEMPT)
    connect.assert_not_called()

class ProductionBindingTests(unittest.TestCase):
 def test_actual_production_capability_registry_body(self):
  self.assertEqual(w._load_capability_registry(),CAP)
 def test_real_adapter_dispatches_v5_without_legacy_execution(self):
  from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
  marker={'synthetic':'dispatch-proof'}
  with patch.object(w,'execute_durable_inventory_matrix',return_value=marker) as new,patch.object(durable_matrix,'execute_durable_matrix',side_effect=AssertionError('legacy dispatch')):
   l=lease();self.assertIs(PilotPz002RuleAdapter().execute(l,ATTEMPT),marker);new.assert_called_once_with(l,ATTEMPT)

if __name__=='__main__':unittest.main()
