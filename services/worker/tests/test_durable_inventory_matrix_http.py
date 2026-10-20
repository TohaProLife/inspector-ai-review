"""Bounded HTTP/execute edges after immutable first RED and repaired root draft."""
from pathlib import Path
import importlib.util, json, hashlib, os, socket, threading, time, unittest
from contextlib import contextmanager
from copy import deepcopy
from http.server import BaseHTTPRequestHandler
from unittest.mock import patch
P=Path(__file__).resolve().parent
import test_durable_inventory_matrix as q
INITIAL_DRAFT_SHA=hashlib.sha256(q.DRAFT.read_bytes()).hexdigest()
CASES=[]
@contextmanager
def drip_server():
 body=q.canonical(q.F['cases'][0]['package']).encode();done=threading.Event();state={'writes':0}
 class Handler(BaseHTTPRequestHandler):
  protocol_version='HTTP/1.1'
  def log_message(self,*a):pass
  def do_GET(self):
   try:
    self.send_response(200)
    for k,v in {'Content-Length':str(len(body)),'X-Content-SHA256':hashlib.sha256(body).hexdigest(),
      'X-Artifact-Schema-Version':'matrix-ar053-loader-inputs-v1','X-Input-Manifest-SHA256':q.lease()['inputManifestHash'],'Connection':'close'}.items():self.send_header(k,v)
    self.end_headers()
    for b in body:
     self.wfile.write(bytes([b]));self.wfile.flush();state['writes']+=1;time.sleep(.025)
   except (OSError,BrokenPipeError):pass
   finally:self.close_connection=True;done.set()
 server=q.Server(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
 try:
  with patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':f'http://127.0.0.1:{server.server_port}','INTERNAL_WORKER_TOKEN':'local-qa-token'}):yield state
 finally:
  server.shutdown();server.server_close();thread.join(1);assert done.wait(.5),'drip request handler leaked'

class ExtraTests(unittest.TestCase):
 def test_absolute_deadline_beats_slow_drip_not_idle_timeout(self):
  with drip_server() as state,patch.object(q.w,'LOADER_SOCKET_DEADLINE_SECONDS',.12):
   start=time.monotonic()
   with self.assertRaises(TimeoutError):q.w.download_inventory_comparison_inputs(q.lease(),q.ATTEMPT)
   elapsed=time.monotonic()-start
   self.assertGreaterEqual(state['writes'],3);self.assertLess(elapsed,.35)
  CASES.append({'case':'slow-drip-absolute-deadline','deadlineSeconds':.12,'elapsedSeconds':elapsed,'writes':state['writes'],'status':'PASS'})
 def test_stalled_headers_close_connection_without_response(self):
  real=q.w.http.client.HTTPConnection;connections=[]
  class Tracking(real):
   def __init__(self,*a,**k):super().__init__(*a,**k);self.closed=False;self.response=None;connections.append(self)
   def close(self):self.closed=True;super().close()
   def getresponse(self):self.response=super().getresponse();return self.response
  with q.http_fixture(delay_headers=.2,close=True),patch.object(q.w,'LOADER_SOCKET_DEADLINE_SECONDS',.05),patch.object(q.w.http.client,'HTTPConnection',Tracking):
   with self.assertRaises(TimeoutError):q.w.download_inventory_comparison_inputs(q.lease(),q.ATTEMPT)
  self.assertEqual(len(connections),1);self.assertIsNone(connections[0].response);self.assertTrue(connections[0].closed);self.assertIsNone(connections[0].sock)
 def test_repeated_actual_http_failure_success_no_file_descriptor_growth(self):
  before=len(list(Path('/proc/self/fd').iterdir()))
  for status in [200,401]:
   with q.http_fixture(status=status,close=True):
    for i in range(12):
     if status==200:q.w.download_inventory_comparison_inputs(q.lease(),q.ATTEMPT)
     else:
      with self.assertRaises(ValueError):q.w.download_inventory_comparison_inputs(q.lease(),q.ATTEMPT)
  after=len(list(Path('/proc/self/fd').iterdir()));self.assertLessEqual(after,before)
  CASES.append({'case':'24-loopback-connections-no-fd-growth','before':before,'after':after,'status':'PASS'})
 def test_execute_all14_authored_typed_outputs_no_silent_candidate_count(self):
  for case in q.F['cases']:
   p=deepcopy(case['package']);l=q.lease();l.update(objectId=p['objectId'],inputManifestHash=p['inputManifestHash'])
   artifacts={o['sourceFileId']:deepcopy(o['textArtifact'])for o in p['origins']}
   for source in p['sources']:
    review=source['review'];sid=source['sourceFileId'];l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':source['sourceSha256'],
      'stages':source['stages'],'objectId':l['objectId'],'mediaType':'application/pdf','sectionCode':review['sectionCode'] if review else 'AR'})
    if review:l['inputs']['sourceDecisions'][sid]={**review,'basis':{'reference':'Synthetic fixture review; no DB authority'}}
   with self.subTest(case=case['name']),patch.object(q.w,'_load_capability_registry',return_value=q.CAP),patch.object(q.w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])),q.http_fixture(p,close=True,headers={'X-Input-Manifest-SHA256':p['inputManifestHash']}):
    r=q.w.execute_durable_inventory_matrix(l,q.ATTEMPT)
   self.assertEqual(r['inventoryComparisons'],case['expectedEnvelope']);self.assertEqual(r['outputCount'],len(r['execution']['results'])+len(case['expectedEnvelope']['results']))
   row=next(c for c in r['effectiveCoverage']if c['parameterCode']=='AR-053');rows=case['expectedEnvelope']['results']
   candidates=sum(v.get('comparison',{}).get('status')=='CANDIDATE'for v in rows)
   self.assertEqual((row['successfulComparisons'],row['abstentions'],row['failures']),(candidates,len(rows)-candidates,0))
   CASES.append({'case':case['name'],'rows':len(rows),'successfulComparisons':candidates,'abstentions':len(rows)-candidates,'status':'PASS'})
 def test_empty_inventory_committed_inputs_produce_one_unbound_atom(self):
  l=q.lease();p={'schemaVersion':'matrix-ar053-loader-inputs-v1','objectId':l['objectId'],'inputManifestHash':l['inputManifestHash'],
    'sources':[],'origins':[],'identities':[]}
  with patch.object(q.w,'_load_capability_registry',return_value=q.CAP),patch.object(q.w,'download_text_artifact') as text,q.http_fixture(p,close=True):
   r=q.w.execute_durable_inventory_matrix(l,q.ATTEMPT)
  text.assert_not_called();self.assertEqual(len(r['inventoryComparisons']['results']),1)
  self.assertEqual(r['inventoryComparisons']['results'][0]['kind'],'UNBOUND_ATOM_ABSTENTION')
  self.assertEqual(r['outputCount'],len(r['execution']['results'])+1)
  self.assertEqual(r['projectConstraints']['constraints'],[]);self.assertEqual(r['sourceDeclarations']['declarations'],[])
  row=next(c for c in r['effectiveCoverage']if c['parameterCode']=='AR-053');self.assertEqual((row['successfulComparisons'],row['abstentions']),(0,1))

if __name__=='__main__':unittest.main()
