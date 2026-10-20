"""Independent audit-only worker contract; expectations precede producer implementation."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from inspector_worker.durable_text_v3 import process_document_text_layer_v3
from inspector_worker.document_text_v3 import get_document_text_v3_extractor_profile

ROOT=Path(__file__).resolve().parents[3]
POLICY='pdfminer-analyzed-figures-whole-lines-v1'
MANUAL=json.loads((ROOT/'fixtures/document-text-v3-figures-v1/qa-core-manual-goldens.json').read_text())['cases'][0]
def digest(value):
 return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def expected_artifact():
 value=copy.deepcopy(MANUAL['artifact'])
 value['extractorProfile']=get_document_text_v3_extractor_profile(traversal_policy_version=POLICY)
 value['extractorProfileHash']=digest({'hashDomain':'document-text-extractor-profile-v1','profile':value['extractorProfile']})
 return value
def release():
 artifact=expected_artifact()
 return {'artifactSchemaVersion':'document-text-v3','purpose':'SOURCE_AUDIT_ONLY','extractorProfile':artifact['extractorProfile'],'extractorProfileHash':artifact['extractorProfileHash'],'processorVersion':'durable-document-text-v3-v1','processorSourceSha256':hashlib.sha256((ROOT/'services/worker/inspector_worker/durable_text_v3.py').read_bytes()).hexdigest(),'cachePolicyVersion':'durable-text-layer-v3-cache-v1','cacheSourceSha256':hashlib.sha256((ROOT/'services/worker/inspector_worker/durable_text_v3_cache.py').read_bytes()).hexdigest()}
def lease():
 p=ROOT/MANUAL['originalPath'];a=expected_artifact()
 return {'release':{'textLayer':release()},'inputs':{'sourceFiles':[{'sourceFileId':a['sourceFileId'],'sha256':a['inputSha256'],'byteSize':p.stat().st_size,'mediaType':'application/pdf','downloadPath':'/api/internal/v1/jobs/job/input/source'}]}}
ATTEMPT={'attemptId':'attempt-1','fencingToken':1}
def download(_path,destination,source_hash,byte_size,attempt):
 data=(ROOT/MANUAL['originalPath']).read_bytes()
 assert hashlib.sha256(data).hexdigest()==source_hash and len(data)==byte_size
 destination.write_bytes(data)

class DurableTextV3Tests(unittest.TestCase):
 def test_exact_whole_original_result_no_authority_or_legacy_output(self):
  request=lease();before=copy.deepcopy(request);a=expected_artifact()
  with patch('inspector_worker.durable_text_v3._download_source',side_effect=download) as fetch:
   result=process_document_text_layer_v3(request,ATTEMPT,'qa-worker')
  self.assertEqual(result,{'disposition':'DOCUMENT_TEXT_LAYER_COMPLETED','purpose':'SOURCE_AUDIT_ONLY','sources':[{'sourceFileId':a['sourceFileId'],'inputSha256':a['inputSha256'],'status':'EXTRACTED','artifact':a}],'workerId':'qa-worker'})
  self.assertEqual(request,before);self.assertEqual(fetch.call_count,1)
 def test_release_mismatches_fail_before_download_or_extraction(self):
  changes=[('purpose','ENGINEERING'),('artifactSchemaVersion','document-text-v2'),('processorVersion','old'),('cachePolicyVersion','old'),('processorSourceSha256','0'*64),('cacheSourceSha256','0'*64),('extractorProfileHash','0'*64)]
  requests=[]
  for key,value in changes:
   request=lease();request['release']['textLayer'][key]=value;requests.append((key,request))
  request=lease();request['release']['textLayer']['extractorProfile']['documentTextV3SourceSha256']='0'*64;request['release']['textLayer']['extractorProfileHash']=digest({'hashDomain':'document-text-extractor-profile-v1','profile':request['release']['textLayer']['extractorProfile']});requests.append(('rehashed foreign producer',request))
  request=lease();request['release']['textLayer']['extra']=None;requests.append(('extra release key',request))
  for name,request in requests:
   with self.subTest(name=name),patch('inspector_worker.durable_text_v3._download_source') as fetch,patch('inspector_worker.durable_text_v3.extract_pdf_text_artifact_v3') as extract:
    with self.assertRaises(ValueError):process_document_text_layer_v3(request,ATTEMPT,'qa-worker')
    self.assertEqual((fetch.call_count,extract.call_count),(0,0))
 def test_duplicate_source_and_native_attempt_controls_precede_download(self):
  vectors=[]
  request=lease();request['inputs']['sourceFiles']*=2;vectors.append(('duplicate',request,ATTEMPT))
  request=lease();request['inputs']['sourceFiles'][0]['byteSize']=True;vectors.append(('boolean byteSize',request,ATTEMPT))
  for name,attempt in [('boolean fence',{'attemptId':'attempt-1','fencingToken':True}),('zero fence',{'attemptId':'attempt-1','fencingToken':0}),('blank attempt',{'attemptId':'','fencingToken':1})]:vectors.append((name,lease(),attempt))
  for name,request,attempt in vectors:
   with self.subTest(name=name),patch('inspector_worker.durable_text_v3._download_source') as fetch:
    with self.assertRaises(ValueError):process_document_text_layer_v3(request,attempt,'qa-worker')
    self.assertEqual(fetch.call_count,0)
 def test_worker_cache_reuses_full_original_but_downloads_each_attempt(self):
  with tempfile.TemporaryDirectory() as d:
   from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3
   with patch.dict('os.environ',{'INSPECTOR_DURABLE_TEXT_CACHE_ROOT':d}),patch('inspector_worker.durable_text_v3._download_source',side_effect=download) as fetch,patch('inspector_worker.durable_text_v3.extract_pdf_text_artifact_v3',wraps=extract_pdf_text_artifact_v3) as extract:
    first=process_document_text_layer_v3(lease(),ATTEMPT,'qa-worker');second=process_document_text_layer_v3(lease(),ATTEMPT,'qa-worker')
   self.assertEqual(first,second);self.assertEqual(first['sources'][0]['artifact'],expected_artifact());self.assertEqual((fetch.call_count,extract.call_count),(2,1))
