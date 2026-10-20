"""Independent additive complete-output/native/original layout probes."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,read_document_text_v3_artifact,document_text_v3_content_hash,get_document_text_v3_extractor_profile
from inspector_worker.source_declarations import _valid_artifact
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-v1'
def corpus(name,sha):
 p=F/name;assert hashlib.sha256(p.read_bytes()).hexdigest()==sha;return json.loads(p.read_text())
L=corpus('qa-layout-manual-goldens.json','623d3e9e84885a11d140d816d0d569b18eea7da441b74d934cb6ca3100119b03');P=corpus('qa-portable-boundary-goldens.json','e9a56c23d475bb8c5abcd66f761a3af66cb71c61022528684189b07f8c519778')
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class DocumentTextV3BoundaryTests(unittest.TestCase):
 def test_whole_portable_33_outputs_hashes_and_immutability(self):
  for c in L['cases']+P['cases']:
   with self.subTest(name=c['name']):
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead'])
    if c['expectedRead']['status']=='VALID':self.assertEqual(document_text_v3_content_hash(a),c['expectedRead']['contentHash'])
    else:
     with self.assertRaises(ValueError):document_text_v3_content_hash(a)
    self.assertEqual(a,before)
 def test_layout_originals_replay_only_actual_profile_substitution(self):
  profile=get_document_text_v3_extractor_profile()
  for c in L['cases']:
   with self.subTest(name=c['name']):
    p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256']);expected=copy.deepcopy(c['artifact']);expected['extractorProfile']=copy.deepcopy(profile);expected['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile});self.assertEqual(extract_pdf_text_artifact_v3(p,expected['sourceFileId'],expected['inputSha256']),expected)
 def test_visible_nested_form_is_explicitly_unsupported_not_silently_empty(self):
  for c in L['producerErrors']:
   with self.subTest(name=c['name']):
    p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256'])
    with self.assertRaisesRegex(ValueError,c['reasonCode']):extract_pdf_text_artifact_v3(p,'SYNTHETIC-T60-Form',c['originalSha256'])
 def test_legacy_v2_validator_rejects_every_valid_v3(self):
  for c in L['cases']+P['cases']:
   if c['expectedRead']['status']=='VALID':self.assertFalse(_valid_artifact(c['artifact']))
 def reject(self,a,reason='INVALID_INPUT'):
  self.assertEqual(read_document_text_v3_artifact(a),{'status':'ABSTAIN','reasonCode':reason})
  with self.assertRaises(ValueError):document_text_v3_content_hash(a)
 def test_dict_subclass_never_runs_user_callbacks(self):
  calls=[]
  class Trap(dict):
   def items(self):calls.append('items');raise AssertionError('TRAP')
   def __getitem__(self,k):calls.append('get');raise AssertionError('TRAP')
  self.reject(Trap(L['cases'][0]['artifact']));self.assertEqual(calls,[])
 def test_cycle_invalid(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['cycle']=a;self.reject(a)
 def test_nonfinite_float_invalid(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['pages'][0]['heightMilliPoints']=float('nan');self.reject(a)
 def test_unsafe_int_invalid(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['pages'][0]['heightMilliPoints']=2**53;self.reject(a)
 def test_surrogate_invalid(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['pages'][0]['locatedLines'][0]['rawText']='\ud800';self.reject(a)
 def test_string_cap_before_schema(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['pages'][0]['locatedLines'][0]['rawText']='X'*2000001;self.reject(a,'INPUT_LIMIT')
 def test_container_cap_before_schema(self):
  a=copy.deepcopy(L['cases'][0]['artifact']);a['pages']=[None]*32769;self.reject(a,'INPUT_LIMIT')
if __name__=='__main__':unittest.main()
