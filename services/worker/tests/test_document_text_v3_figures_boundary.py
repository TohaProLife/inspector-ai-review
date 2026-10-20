"""Independent profile, original path and bounded preanalysis controls."""
import copy,hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from pdfminer.layout import LTPage,LTFigure,LTAnno
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,get_document_text_v3_extractor_profile,read_document_text_v3_artifact,document_text_v3_content_hash
R=Path(__file__).resolve().parents[3];p=R/'fixtures/document-text-v3-figures-v1/qa-portable-profile-path-goldens.json'
assert hashlib.sha256(p.read_bytes()).hexdigest()=='079e9293fc78faf4554dddc96e5f6b8bfdede40df47ea6800f1dedbc65efd140'
C=json.loads(p.read_text())['cases'];NEW='pdfminer-analyzed-figures-whole-lines-v1';OLD='pdfminer-top-level-whole-lines-v1';M=json.loads((R/'fixtures/document-text-v3-figures-v1/qa-original-manifest.json').read_text())['originals'][0]
class DocumentTextV3FigureBoundaryTests(unittest.TestCase):
 def test_eight_whole_portable_outputs(self):
  for c in C:
   with self.subTest(name=c['name']):
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(a,before)
    if c['expectedRead']['status']=='VALID':self.assertEqual(document_text_v3_content_hash(a),c['expectedRead']['contentHash'])
    else:
     with self.assertRaises(ValueError):document_text_v3_content_hash(a)
 def test_old_default_profile_equals_explicit_old(self):self.assertEqual(get_document_text_v3_extractor_profile(),get_document_text_v3_extractor_profile(traversal_policy_version=OLD))
 def test_unknown_profile_selector_rejected(self):
  for bad in ('','pdfminer-unknown',None,True):
   with self.subTest(selector=bad):
    with self.assertRaisesRegex(ValueError,'EXTRACTOR_PROFILE_MISMATCH'):get_document_text_v3_extractor_profile(traversal_policy_version=bad)
    with self.assertRaisesRegex(ValueError,'EXTRACTOR_PROFILE_MISMATCH'):extract_pdf_text_artifact_v3(R/M['path'],M['sourceFileId'],M['sha256'],traversal_policy_version=bad)
 def test_native_deep_forms_bounded_before_library_analysis(self):
  page=LTPage(1,(0,0,200,160));parent=page
  for _ in range(1100):
   child=LTFigure('nested',(0,0,1,1),(1,0,0,1,0,0));parent.add(child);parent=child
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(page,(0.0,0.0,200.0,160.0))])):
   with patch.object(LTFigure,'analyze',side_effect=AssertionError('MUST_PREFLIGHT_FIRST')) as analyze:
    with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3(R/M['path'],M['sourceFileId'],M['sha256'],traversal_policy_version=NEW)
    self.assertEqual(analyze.call_count,0)
 def test_native_object_page_budget_before_library_analysis(self):
  page=LTPage(1,(0,0,200,160));figure=LTFigure('many',(0,0,1,1),(1,0,0,1,0,0));page.add(figure)
  for _ in range(200001):figure.add(LTAnno(''))
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(page,(0.0,0.0,200.0,160.0))])):
   with patch.object(LTFigure,'analyze',side_effect=AssertionError('MUST_PREFLIGHT_FIRST')) as analyze:
    with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3(R/M['path'],M['sourceFileId'],M['sha256'],traversal_policy_version=NEW)
    self.assertEqual(analyze.call_count,0)
