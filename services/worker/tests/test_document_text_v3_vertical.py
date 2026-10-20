"""Independent T78 authored whole native lines; no rendered/unit/member authority."""
import copy,hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from pdfminer.layout import LTPage,LTFigure,LTLayoutContainer,LTRect
from inspector_worker import document_text_v3 as d
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-vertical-v1';B=(F/'qa-whole-manual-goldens.json').read_bytes()
assert hashlib.sha256(B).hexdigest()=='acea8244f1c29256b4df0ca7ab8573c334ae6b196d24eb0b3f6a4abdb5f8735b'
C=json.loads(B);NEW=C['traversalPolicyVersion'];LARGE='document-text-v3-large-source-bounds-v1'
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def profile_body(a,profile):
 a=copy.deepcopy(a);a['extractorProfile']=copy.deepcopy(profile);a['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile});return a
class DocumentTextV3VerticalTests(unittest.TestCase):
 def test_five_whole_manual_hashes_both_resource_policies_immutable(self):
  for c in C['cases']:
   a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a)
   with self.subTest(name=c['name']):
    self.assertEqual(d.read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(d.read_document_text_v3_large_artifact(a),{**c['expectedRead'],'resourcePolicyVersion':LARGE});self.assertEqual(d.document_text_v3_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(d.document_text_v3_large_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(a,before)
 def test_five_originals_exact_new_profile_only_standard_large_and_unlocated_controls(self):
  profile=d.get_document_text_v3_extractor_profile(traversal_policy_version=NEW)
  cases=C['cases']+json.loads((R/'fixtures/document-text-v3-v1/qa-core-manual-goldens.json').read_text())['cases']
  for c in cases:
   with self.subTest(name=c['name']):
    p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256']);a=profile_body(c['artifact'],profile)
    for extract in [d.extract_pdf_text_artifact_v3,d.extract_pdf_text_artifact_v3_large]:self.assertEqual(extract(p,a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW),a)
 def test_actual_page_form_recipe_once_no_hierarchical_grouping(self):
  pages=[];forms=[];po=LTPage.analyze;fo=LTFigure.analyze
  def page(obj,p):pages.append((p.boxes_flow,p.all_texts,p.detect_vertical));return po(obj,p)
  def form(obj,p):
   if p.all_texts:forms.append((obj,p.boxes_flow,p.all_texts,p.detect_vertical))
   return fo(obj,p)
  with patch.object(LTLayoutContainer,'group_textboxes',side_effect=AssertionError('NEW policy hierarchical grouping forbidden')),patch.object(LTPage,'analyze',page),patch.object(LTFigure,'analyze',form):
   for c in C['cases']:
    a=c['artifact'];d.extract_pdf_text_artifact_v3(R/c['originalPath'],a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW)
  self.assertEqual(pages,[(None,False,True)]*5);self.assertEqual(len(forms),10);self.assertEqual(len({id(x[0]) for x in forms}),10);self.assertTrue(all(x[1:]==(None,True,True) for x in forms))
 def test_preflight_exact_depth_and_figure_object_limits_before_analyze(self):
  c=C['cases'][0];a=c['artifact'];p=R/c['originalPath']
  class Reached(Exception):pass
  def run(page,allowed):
   calls=[]
   def analyze(*_):calls.append(1);raise Reached()
   with patch.object(d,'_stable_visible_pdf_layouts',side_effect=lambda *args,**kw:iter([(page,(0.,0.,200.,160.))])),patch.object(LTFigure,'analyze',analyze):
    with self.assertRaises(Reached if allowed else ValueError) as e:d.extract_pdf_text_artifact_v3(p,a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW)
   self.assertEqual(calls,[1] if allowed else[])
   if not allowed:self.assertEqual(str(e.exception),'INPUT_LIMIT')
  for depth in [64,65]:
   page=LTPage(1,(0,0,200,160));node=page
   for _ in range(depth):child=LTFigure('nested',(0,0,1,1),(1,0,0,1,0,0));node.add(child);node=child
   run(page,depth==64)
  for count in [200000,200001]:
   page=LTPage(1,(0,0,200,160));figure=LTFigure('many',(0,0,1,1),(1,0,0,1,0,0));figure._objs=[LTRect(1,(0,0,1,1))]*(count-1);page.add(figure);run(page,count==200000)
 def test_historical_three_whole_profiles_default_and_nested_invalid_glyph_unchanged(self):
  for directory,file in [('document-text-v3-v1','qa-core-manual-goldens.json'),('document-text-v3-figures-v1','qa-core-manual-goldens.json'),('document-text-v3-stable-v1','qa-whole-manual-goldens.json')]:
   for c in json.loads((R/'fixtures'/directory/file).read_text())['cases']:
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(d.read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(d.document_text_v3_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(a,before)
  self.assertEqual(d.get_document_text_v3_extractor_profile()['traversalPolicyVersion'],'pdfminer-top-level-whole-lines-v1')
  old=json.loads((R/'fixtures/document-text-v3-figures-v1/qa-core-manual-goldens.json').read_text())
  for c in old['producerErrors']:
   with self.assertRaisesRegex(ValueError,c['reasonCode']):d.extract_pdf_text_artifact_v3(R/c['originalPath'],'SYNTHETIC-T78-INVALID',c['originalSha256'],traversal_policy_version=NEW)
 def test_wrong_selector_or_original_hash_and_native_traps_zero_callbacks(self):
  c=C['cases'][0];a=c['artifact'];p=R/c['originalPath'];callbacks=[]
  with patch.object(d,'_stable_visible_pdf_layouts',side_effect=lambda *a,**kw:callbacks.append(1)),patch('inspector_worker.text_layer._visible_pdf_layouts',side_effect=lambda *a,**kw:callbacks.append(1)):
   for selector in ['guessed',None,True]:
    with self.assertRaisesRegex(ValueError,'EXTRACTOR_PROFILE_MISMATCH'):d.extract_pdf_text_artifact_v3(p,a['sourceFileId'],a['inputSha256'],traversal_policy_version=selector)
   with self.assertRaisesRegex(ValueError,'SOURCE_SHA256_MISMATCH'):d.extract_pdf_text_artifact_v3(p,a['sourceFileId'],'f'*64,traversal_policy_version=NEW)
  class Trap(dict):
   def items(self):callbacks.append(1);raise AssertionError('custom iteration')
  cycle={};cycle['x']=cycle
  for v in [Trap(),cycle,(1,),.5,float('nan'),'\ud800']:
   self.assertEqual(d.read_document_text_v3_artifact(v),{'status':'ABSTAIN','reasonCode':'INVALID_INPUT'})
  self.assertEqual(callbacks,[])
