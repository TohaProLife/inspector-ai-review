"""Independent whole original stable-policy contract; no post-sort/relabel oracle."""
import copy,hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,get_document_text_v3_extractor_profile,read_document_text_v3_artifact,document_text_v3_content_hash
from pdfminer.layout import LTLayoutContainer,LTPage,LTFigure
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-stable-v1';P=F/'qa-whole-manual-goldens.json'
assert hashlib.sha256(P.read_bytes()).hexdigest()=='f4ecc2e66b67419b10782d577936975d337abd4a7337038e5874478d59272eb1'
C=json.loads(P.read_text());NEW=C['traversalPolicyVersion']
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class DocumentTextV3StableTests(unittest.TestCase):
 def test_three_whole_originals_exact_only_actual_profile_substitution(self):
  profile=get_document_text_v3_extractor_profile(traversal_policy_version=NEW)
  for c in C['cases']:
   with self.subTest(name=c['name']):
    path=R/c['originalPath'];self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),c['originalSha256']);a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a)
    self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(document_text_v3_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(a,before)
    a['extractorProfile']=profile;a['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile})
    self.assertEqual(extract_pdf_text_artifact_v3(path,a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW),a)
 def test_page_and_form_disable_hierarchical_grouping_use_once_native_analysis(self):
  page_calls=[];form_calls=[];page_orig=LTPage.analyze;form_orig=LTFigure.analyze
  def page_analyze(obj,params):page_calls.append((params.boxes_flow,params.all_texts));return page_orig(obj,params)
  def form_analyze(obj,params):
   if params.all_texts:form_calls.append((params.boxes_flow,params.all_texts))
   return form_orig(obj,params)
  with patch.object(LTLayoutContainer,'group_textboxes',side_effect=AssertionError('id-tied hierarchical grouping forbidden for NEW policy')),patch.object(LTPage,'analyze',page_analyze),patch.object(LTFigure,'analyze',form_analyze):
   for c in C['cases'][:2]:
    a=c['artifact'];extract_pdf_text_artifact_v3(R/c['originalPath'],a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW)
  self.assertEqual(page_calls,[(None,False),(None,False)]);self.assertEqual(form_calls,[(None,True)])
 def test_historical_whole_manual_profiles_remain_valid_without_relabel(self):
  for name in ['document-text-v3-v1/qa-core-manual-goldens.json','document-text-v3-figures-v1/qa-core-manual-goldens.json']:
   for c in json.loads((R/'fixtures'/name).read_text())['cases']:
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(a,before)
