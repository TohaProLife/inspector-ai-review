"""Independent T76 full-source large bounds. stdlib only; no admission authority."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.document_text_v3 import (read_document_text_v3_artifact,document_text_v3_content_hash,read_document_text_v3_large_artifact,document_text_v3_large_content_hash,extract_pdf_text_artifact_v3,extract_pdf_text_artifact_v3_large,get_document_text_v3_extractor_profile)
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-large-v1';B=(F/'qa-manual-expectations.json').read_bytes()
assert hashlib.sha256(B).hexdigest()=='d9fd434efb171c49b4d46493b544a5f91d3724c9df46fe11f6c57e772dfadcf8'
M=json.loads(B);POLICY='document-text-v3-large-source-bounds-v1'
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def reject(reason):return dict(status='ABSTAIN',resourcePolicyVersion=POLICY,reasonCode=reason)
def nodes(n):
 remaining=n-1;root=[]
 while remaining>0:
  remaining-=1;count=min(32768,remaining);root.append([0]*count);remaining-=count
 return root
def byte_tree(n):
 count=20;payload=n-(3*count+1);q,odd=divmod(payload,2);values=[]
 for _ in range(count):
  take=min(q,1999999);values.append('\n'*take);q-=take
 if odd:values[-1]+='a'
 assert q==0 and len(json.dumps(values,ensure_ascii=False,separators=(',',':')).encode())==n
 return values
def whole():
 for c in M['wholeCases']:
  b=(F/c['file']).read_bytes();assert hashlib.sha256(b).hexdigest()==c['fileSha256'];yield c,json.loads(b)
class DocumentTextV3LargeTests(unittest.TestCase):
 def test_small_whole_original_hash_and_explicit_label(self):
  for c in M['smallCases']:
   a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a)
   self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(read_document_text_v3_large_artifact(a),{**c['expectedRead'],'resourcePolicyVersion':POLICY});self.assertEqual(document_text_v3_large_content_hash(a),document_text_v3_content_hash(a));self.assertEqual(a,before)
 def test_both_full_originals_large_only_every_page_and_immutable(self):
  for c,a in whole():
   before=copy.deepcopy(a);self.assertEqual(len(a['pages']),c['pageCount']);self.assertEqual(sum(len(p['locatedLines'])for p in a['pages']),c['locatedLines']);self.assertEqual(read_document_text_v3_artifact(a),dict(status='ABSTAIN',reasonCode='INPUT_LIMIT'))
   with self.assertRaises(ValueError):document_text_v3_content_hash(a)
   self.assertEqual(read_document_text_v3_large_artifact(a),dict(status='VALID',resourcePolicyVersion=POLICY,contentHash=c['expectedContentHash']));self.assertEqual(document_text_v3_large_content_hash(a),c['expectedContentHash']);self.assertEqual(a,before)
 def test_all_retained_last_page_profile_raw_quality_frame_path(self):
  _,base=next(whole())
  def profile(a):a['extractorProfileHash']='f'*64
  def quality(a):a['pages'][-1]['quality']['metrics']['cidPlaceholders']+=1
  def frame(a):a['pages'][-1]['widthMilliPoints']=0
  def path(a):a['pages'][-1]['locatedLines'][0]['sourcePath']=[]
  def raw(a):a['pages'][-1]['locatedLines'][0]['rawText']+='\ufffd'
  for mutate in [profile,quality,frame,path,raw]:
   a=copy.deepcopy(base);mutate(a);self.assertEqual(read_document_text_v3_large_artifact(a),reject('INVALID_TEXT_ARTIFACT'))
   with self.assertRaises(ValueError):document_text_v3_large_content_hash(a)
 def test_nodes_including_keys_exact_standard_and_large(self):
  for n in [200000,200001]:
   a={'k':nodes(n-2)};self.assertEqual(read_document_text_v3_artifact(a),dict(status='ABSTAIN',reasonCode='INVALID_TEXT_ARTIFACT'if n==200000 else'INPUT_LIMIT'));self.assertEqual(read_document_text_v3_large_artifact(a),reject('INVALID_TEXT_ARTIFACT'))
  for n in [1400000,1400001]:self.assertEqual(read_document_text_v3_large_artifact({'k':nodes(n-2)}),reject('INVALID_TEXT_ARTIFACT'if n==1400000 else'INPUT_LIMIT'))
 def test_serialized_escaping_and_punctuation_byte_edges(self):
  for n in [8000000,8000001]:
   a=byte_tree(n);self.assertEqual(read_document_text_v3_artifact(a),dict(status='ABSTAIN',reasonCode='INVALID_TEXT_ARTIFACT'if n==8000000 else'INPUT_LIMIT'));self.assertEqual(read_document_text_v3_large_artifact(a),reject('INVALID_TEXT_ARTIFACT'))
  for n in [32000000,32000001]:self.assertEqual(read_document_text_v3_large_artifact(byte_tree(n)),reject('INVALID_TEXT_ARTIFACT'if n==32000000 else'INPUT_LIMIT'))
 def test_common_depth_container_string_pages_records_unchanged(self):
  for d in [64,65]:
   a=0
   for _ in range(d):a=[a]
   self.assertEqual(read_document_text_v3_large_artifact(a),reject('INVALID_TEXT_ARTIFACT'if d==64 else'INPUT_LIMIT'))
  for a in [[0]*32769,'a'*2000001,{'pages':[None]*513},{'pages':[{'locatedLines':[None]*25001,'unlocatedLines':[]}for _ in range(4)]}]:self.assertEqual(read_document_text_v3_large_artifact(a),reject('INPUT_LIMIT'))
 def test_native_exact_builtins_zero_callbacks(self):
  callbacks=[]
  class Trap(dict):
   def items(self):callbacks.append(1);raise AssertionError('custom iteration')
  cycle={};cycle['x']=cycle
  for v in [Trap(),cycle,0.5,float('nan'),float('inf'),9007199254740992,'\ud800',(1,),{1:'not string key'}]:
   self.assertEqual(read_document_text_v3_large_artifact(v),reject('INVALID_INPUT'))
   with self.assertRaises(ValueError):document_text_v3_large_content_hash(v)
  self.assertEqual(callbacks,[])
 def test_original_producer_explicit_large_preserves_whole_small_body_profile_substitution_only(self):
  for c in M['smallCases']:
   p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256']);a=copy.deepcopy(c['artifact']);profile=get_document_text_v3_extractor_profile(traversal_policy_version=a['extractorProfile']['traversalPolicyVersion']);a['extractorProfile']=profile;a['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile})
   args=(p,a['sourceFileId'],a['inputSha256']);kw={'traversal_policy_version':profile['traversalPolicyVersion']};self.assertEqual(extract_pdf_text_artifact_v3(*args,**kw),a);self.assertEqual(extract_pdf_text_artifact_v3_large(*args,**kw),a)
 def test_producer_early_raw_policy_and_final_whole_guard_without_default_retry(self):
  # Mock native layout only: not a claimed authored PDF transcript. Original SHA still verified.
  from unittest.mock import patch
  from pdfminer.layout import LTPage,LTTextLineHorizontal,LTAnno,LTContainer
  p=R/'fixtures/text-layer-degenerate-geometry-v1/research-positive-micro.pdf';sha=hashlib.sha256(p.read_bytes()).hexdigest();raw='a'*1999998
  def layout(count):
   page=LTPage(1,(0,0,200,160))
   for _ in range(count):
    line=LTTextLineHorizontal(0.1);LTContainer.add(line,LTAnno(raw));line.set_bbox((1,1,101,11));page.add(line)
   return page
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(layout(5),(0.0,0.0,200.0,160.0))])):
   with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3(p,'SYNTHETIC-LARGE-RAW',sha)
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(layout(5),(0.0,0.0,200.0,160.0))])):
   a=extract_pdf_text_artifact_v3_large(p,'SYNTHETIC-LARGE-RAW',sha)
  self.assertEqual([line['rawText']for line in a['pages'][0]['locatedLines']],[raw]*5)
  self.assertEqual(read_document_text_v3_artifact(a),dict(status='ABSTAIN',reasonCode='INPUT_LIMIT'));self.assertEqual(read_document_text_v3_large_artifact(a)['status'],'VALID')
  # Each raw JSON string exactly2,000,000bytes:16 fits early budget but complete metadata does not.
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(layout(16),(0.0,0.0,200.0,160.0))])):
   with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3_large(p,'SYNTHETIC-LARGE-RAW',sha)
  calls=[];original=LTTextLineHorizontal.get_text
  def counted(line):calls.append(1);return original(line)
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(layout(18),(0.0,0.0,200.0,160.0))])),patch.object(LTTextLineHorizontal,'get_text',counted):
   with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3_large(p,'SYNTHETIC-LARGE-RAW',sha)
  self.assertEqual(len(calls),17)
