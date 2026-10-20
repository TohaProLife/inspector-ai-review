"""T79 owner independent literals/manual bodies frozen before implementation."""
import copy,hashlib,json,tempfile,unittest,os
from pathlib import Path
from unittest.mock import patch
from inspector_worker import durable_text_v3_large as p
from inspector_worker import durable_text_v3_large_cache as c
from inspector_worker.document_text_v3 import get_document_text_v3_extractor_profile
R=Path(__file__).resolve().parents[3];M=json.loads((R/'fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json').read_text())['cases'][0]
PROFILE='SOURCE_AUDIT_V3_LARGE_VERTICAL_V1';RESOURCE='document-text-v3-large-source-bounds-v1';TRAVERSAL='pdfminer-analyzed-figures-boxes-flow-none-vertical-v1';ATTEMPT={'attemptId':'attempt-1','fencingToken':1}
def canonical(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def sha(v):return hashlib.sha256(canonical(v)).hexdigest()
def artifact():
 a=copy.deepcopy(M['artifact']);a['extractorProfile']=get_document_text_v3_extractor_profile(traversal_policy_version=TRAVERSAL);a['extractorProfileHash']=sha({'hashDomain':'document-text-extractor-profile-v1','profile':a['extractorProfile']});return a
def release():
 a=artifact();return {'artifactSchemaVersion':'document-text-v3','purpose':'SOURCE_AUDIT_ONLY','sourceAuditProfileVersion':PROFILE,'resourcePolicyVersion':RESOURCE,'extractorProfile':a['extractorProfile'],'extractorProfileHash':a['extractorProfileHash'],'processorVersion':'durable-document-text-v3-large-vertical-v1','processorSourceSha256':hashlib.sha256((R/'services/worker/inspector_worker/durable_text_v3_large.py').read_bytes()).hexdigest(),'cachePolicyVersion':'durable-text-layer-v3-large-vertical-cache-v1','cacheSourceSha256':hashlib.sha256((R/'services/worker/inspector_worker/durable_text_v3_large_cache.py').read_bytes()).hexdigest()}
def lease():
 a=artifact();return {'release':{'textLayer':release(),'externalNetworkAllowed':False,'rules':{'executionStatus':'UNCONFIGURED'},'providerSlots':[],'providerSlot':None,'ocrLayoutSlot':None},'inputs':{'sourceFiles':[{'sourceFileId':a['sourceFileId'],'sha256':a['inputSha256'],'byteSize':(R/M['originalPath']).stat().st_size,'mediaType':'application/pdf','downloadPath':'/api/internal/v1/jobs/job/input/source'}]}}
def download(path,dest,source_hash,byte_size,attempt):
 b=(R/M['originalPath']).read_bytes();assert hashlib.sha256(b).hexdigest()==source_hash and len(b)==byte_size;dest.write_bytes(b)
def args(root):
 a=artifact();return a,{'cache_root':root/'cache','source_path':R/M['originalPath'],'source_file_id':a['sourceFileId'],'source_sha256':a['inputSha256'],'extractor_profile':a['extractorProfile'],'extractor_profile_hash':a['extractorProfileHash']}
class LargeAuditProcessorTests(unittest.TestCase):
 def test_exact_original_result_five_keys_detached(self):
  l=lease();before=copy.deepcopy(l);a=artifact()
  with patch.object(p,'_download_source',side_effect=download):got=p.process_document_text_layer_v3_large(l,ATTEMPT,'owner-worker')
  self.assertEqual(got,{'disposition':'DOCUMENT_TEXT_LAYER_COMPLETED','purpose':'SOURCE_AUDIT_ONLY','resourcePolicyVersion':RESOURCE,'sources':[{'sourceFileId':a['sourceFileId'],'inputSha256':a['inputSha256'],'status':'EXTRACTED','artifact':a}],'workerId':'owner-worker'});self.assertEqual(l,before)
 def test_all_pin_profile_and_rules_fail_before_io(self):
  cases=[]
  for key,value in [('purpose','OTHER'),('sourceAuditProfileVersion','SOURCE_AUDIT_V3'),('resourcePolicyVersion','small'),('processorSourceSha256','0'*64),('cacheSourceSha256','0'*64),('extra',None)]:
   l=lease();l['release']['textLayer'][key]=value;cases.append(l)
  l=lease();l['release']['rules']={'executionStatus':'CONFIGURED'};cases.append(l)
  l=lease();l['release']['textLayer']['extractorProfile']['traversalPolicyVersion']='pdfminer-analyzed-figures-boxes-flow-none-v1';cases.append(l)
  for l in cases:
   with patch.object(p,'_download_source')as fetch:
    with self.assertRaises(ValueError):p.process_document_text_layer_v3_large(l,ATTEMPT,'owner-worker')
    fetch.assert_not_called()
 def test_entire_metadata_attempt_native_before_io(self):
  for kind in ['duplicate','bad-last','fence','trap']:
   l=lease();attempt=ATTEMPT
   if kind=='duplicate':l['inputs']['sourceFiles']*=2
   elif kind=='bad-last':l['inputs']['sourceFiles'].append({'sourceFileId':'bad'})
   elif kind=='fence':attempt={'attemptId':'attempt-1','fencingToken':True}
   else:
    class Trap(dict):
     def get(self,*a):raise AssertionError('callback')
    l['release']['textLayer']=Trap()
   with patch.object(p,'_download_source')as fetch:
    with self.assertRaises(ValueError):p.process_document_text_layer_v3_large(l,attempt,'owner-worker')
    fetch.assert_not_called()
 def test_download_hash_recheck_and_cache_each_attempt(self):
  with patch.object(p,'_download_source',side_effect=lambda path,dest,*a:dest.write_bytes(b'wrong')):
   with self.assertRaises(ValueError):p.process_document_text_layer_v3_large(lease(),ATTEMPT,'owner-worker')
  with tempfile.TemporaryDirectory()as directory,patch.dict(os.environ,{'INSPECTOR_DURABLE_TEXT_CACHE_ROOT':directory}),patch.object(p,'_download_source',side_effect=download)as fetch,patch.object(p,'extract_pdf_text_artifact_v3_large',wraps=p.extract_pdf_text_artifact_v3_large)as extract:
   a=p.process_document_text_layer_v3_large(lease(),ATTEMPT,'owner-worker');b=p.process_document_text_layer_v3_large(lease(),ATTEMPT,'owner-worker');self.assertEqual(a,b);self.assertEqual((fetch.call_count,extract.call_count),(2,1))
class LargeAuditCacheTests(unittest.TestCase):
 def test_request_seven_namespace_hit_detached(self):
  with tempfile.TemporaryDirectory()as t:
   a,kw=args(Path(t));calls=[]
   def extract():calls.append(1);return copy.deepcopy(a)
   x,s1=c.cached_durable_text_layer_v3_large(**kw,extract=extract);x['pages'][0]['locatedLines'].clear();y,s2=c.cached_durable_text_layer_v3_large(**kw,extract=extract);self.assertEqual(y,a);self.assertEqual((s1,s2,len(calls)),('MISS_WRITTEN','HIT',1))
   path=next(kw['cache_root'].rglob('*.json'));v=json.loads(path.read_text());self.assertEqual(set(v['request']),{'schemaVersion','sourceAuditProfileVersion','resourcePolicyVersion','sourceFileId','sourceSha256','extractorProfile','extractorProfileHash'});self.assertEqual(v['request']['sourceAuditProfileVersion'],PROFILE);self.assertEqual(path.relative_to(kw['cache_root']).parts[0],'durable-text-layer-v3-large-vertical-cache-v1')
 def test_corrupt_duplicate_float_and_symlink_never_recompute(self):
  for mode in ['duplicate','float','hash','symlink']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory()as t:
    a,kw=args(Path(t));c.cached_durable_text_layer_v3_large(**kw,extract=lambda:copy.deepcopy(a));path=next(kw['cache_root'].rglob('*.json'));raw=path.read_bytes()
    if mode=='duplicate':path.write_bytes(b'{"schemaVersion":"wrong",'+raw[1:])
    elif mode=='float':path.write_bytes(raw.replace(b'"pageNumber":1',b'"pageNumber":1.0',1))
    elif mode=='hash':v=json.loads(raw);v['contentHash']='0'*64;path.write_bytes(canonical(v))
    else:other=Path(t)/'outside';other.write_bytes(raw);path.unlink();path.symlink_to(other)
    calls=[]
    with self.assertRaises(ValueError):c.cached_durable_text_layer_v3_large(**kw,extract=lambda:calls.append(1))
    self.assertEqual(calls,[])
 def test_original_sha_before_hit_and_foreign_artifact(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);a,kw=args(root);source=root/'original.pdf';source.write_bytes(kw['source_path'].read_bytes());kw['source_path']=source;c.cached_durable_text_layer_v3_large(**kw,extract=lambda:copy.deepcopy(a));source.write_bytes(b'changed');calls=[]
   with self.assertRaises(ValueError):c.cached_durable_text_layer_v3_large(**kw,extract=lambda:calls.append(1))
   self.assertEqual(calls,[])
  with tempfile.TemporaryDirectory()as t:
   a,kw=args(Path(t));a['sourceFileId']='foreign'
   with self.assertRaises(ValueError):c.cached_durable_text_layer_v3_large(**kw,extract=lambda:a)
class LargeAuditTransportTests(unittest.TestCase):
 def test_compact_utf8_only_new_route_timeout60(self):
  from inspector_worker import main
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self,*a):return b'{"status":"COMPLETED"}'
  payload={**ATTEMPT,'result':{'label':'🚧 Кириллица'}}
  with patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':'http://unit/api/internal/v1','INTERNAL_WORKER_TOKEN':'private'}),patch.object(main.urllib.request,'urlopen',return_value=Response())as open:
   main.post_worker_command('job','complete-source-audit-v3-large-v1',payload);req=open.call_args.args[0];self.assertTrue(req.full_url.endswith('/jobs/job/complete-source-audit-v3-large-v1'));self.assertEqual(req.data,json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode());self.assertEqual(open.call_args.kwargs['timeout'],60)
   main.post_worker_command('job','complete',payload);req=open.call_args.args[0];self.assertEqual(req.data,json.dumps(payload).encode());self.assertEqual(open.call_args.kwargs['timeout'],15)
 def test_native_before_transport_no_callbacks(self):
  from inspector_worker import main
  calls=[]
  class Trap(dict):
   def items(self):calls.append(1);raise AssertionError('callback')
  for value in [Trap(),{'attemptId':'x','fencingToken':True,'result':{}},{'attemptId':'x','fencingToken':1,'result':{},'extra':None}]:
   with patch.object(main.urllib.request,'urlopen')as open:
    with self.assertRaises((ValueError,main.WorkerControlError)):main.post_worker_command('job','complete-source-audit-v3-large-v1',value)
    open.assert_not_called()
  self.assertEqual(calls,[])

class LargeAuditDispatchTests(unittest.TestCase):
 def test_explicit_large_only_uses_new_completion(self):
  from inspector_worker import main
  envelope={'schema_version':'1.0','event_id':'event','event_type':'job.ready','run_id':'run','job_id':'job','job_type':'DOCUMENT_TEXT_LAYER','scope_type':'ANALYSIS','input_manifest_hash':'a'*64}
  for mode in ['large','standard','legacy']:
   current=lease();current.update(ATTEMPT)
   if mode=='standard':current['release']['textLayer'].pop('sourceAuditProfileVersion');current['release']['textLayer'].pop('resourcePolicyVersion')
   elif mode=='legacy':current['release']['textLayer']={}
   expected={'sentinel':mode}
   with patch.object(main,'post_with_retry',side_effect=[{'status':'ACQUIRED','lease':current},{'status':'COMPLETED'}])as post,patch.object(main,'LeaseHeartbeat')as heartbeat,patch.object(p,'process_document_text_layer_v3_large',return_value=expected)as large,patch('inspector_worker.durable_text_v3.process_document_text_layer_v3',return_value=expected)as standard,patch.object(main,'process_document_text_layer',return_value=expected)as legacy:
    self.assertEqual(main.execute_durable_job(envelope),{'status':'COMPLETED'})
    self.assertEqual(post.call_args_list[-1].args[1],'complete-source-audit-v3-large-v1'if mode=='large'else'complete')
    self.assertEqual(post.call_args_list[-1].args[2],{**ATTEMPT,'result':expected})
    self.assertEqual((large.call_count,standard.call_count,legacy.call_count),{'large':(1,0,0),'standard':(0,1,0),'legacy':(0,0,1)}[mode]);heartbeat.return_value.stop.assert_called_once()
 def test_other_normal_eight_and_optional_seal_keep_old_completion(self):
  from inspector_worker import main
  kinds=['ANALYSIS_INVENTORY','ANALYSIS_SEAL_UNSUPPORTED',*sorted(k for k in main.SCAFFOLD_JOB_TYPES if k!='DOCUMENT_TEXT_LAYER')]
  self.assertEqual(len(kinds),9)  # Eight other NORMAL jobs plus optional unsupported seal.
  for kind in kinds:
   envelope={'schema_version':'1.0','event_id':'event','event_type':'job.ready','run_id':'run','job_id':'job','job_type':kind,'scope_type':'ANALYSIS','input_manifest_hash':'a'*64}
   with patch.object(main,'post_with_retry',side_effect=[{'status':'ACQUIRED','lease':{**ATTEMPT}},{'status':'COMPLETED'}])as post,patch.object(main,'LeaseHeartbeat'),patch.object(main,'inventory_manifest',return_value={}),patch.object(main.DEFAULT_STAGE_PROVIDER_REGISTRY,'execute',return_value={}):
    self.assertEqual(main.execute_durable_job(envelope),{'status':'COMPLETED'});self.assertEqual(post.call_args_list[-1].args[1],'complete')
 def test_fixed_native_budgets_cycles_shared_and_callbacks(self):
  for scope,maxdepth in [('cache',65),('result',67),('complete',68)]:
   value=0
   for _ in range(maxdepth):value=[value]
   c._bounded_native(value,scope)
   with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):c._bounded_native([value],scope)
  v=[];v.append(v)
  with self.assertRaisesRegex(ValueError,'INVALID_INPUT'):c._bounded_native(v,'cache')
  calls=[]
  class Trap(list):
   def __iter__(self):calls.append(1);raise AssertionError('callback')
  with self.assertRaisesRegex(ValueError,'INVALID_INPUT'):c._bounded_native(Trap(),'cache')
  self.assertEqual(calls,[])
  shared=['raw'];c._bounded_native([shared,shared],'cache')
  with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):c._bounded_native(['x'*2000000]*17,'result')
 def test_response_limit_duplicate_keys_and_nonobjects_reject(self):
  from inspector_worker import main
  class Response:
   def __init__(self,raw):self.raw=raw
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self,*a):return self.raw
  for raw in [b'x'*1048577,b'{"a":1,"a":2}',b'[]',b'{"a":1.0}']:
   with patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':'http://unit/api/internal/v1','INTERNAL_WORKER_TOKEN':'private'}),patch.object(main.urllib.request,'urlopen',return_value=Response(raw)):
    with self.assertRaises(main.WorkerControlError):main.post_worker_command('job','complete-source-audit-v3-large-v1',{**ATTEMPT,'result':{}})
