"""Independent original-backed whole analyzed-figure profile expectations."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,read_document_text_v3_artifact,document_text_v3_content_hash,get_document_text_v3_extractor_profile
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-figures-v1';p=F/'qa-core-manual-goldens.json'
assert hashlib.sha256(p.read_bytes()).hexdigest()=='fd74d2d5dfd1ce782bb1e874928f754a48cdb37ccfb064ff226b15cfd2b2ff48'
C=json.loads(p.read_text());NEW=C['traversalPolicyVersion']
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class DocumentTextV3FigureTests(unittest.TestCase):
 def test_five_whole_reader_outputs_immutable(self):
  for c in C['cases']:
   with self.subTest(name=c['name']):
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(document_text_v3_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(a,before)
 def test_five_original_pdf_full_replays_only_profile_substitution(self):
  profile=get_document_text_v3_extractor_profile(traversal_policy_version=NEW)
  for c in C['cases']:
   with self.subTest(name=c['name']):
    p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256']);a=copy.deepcopy(c['artifact']);a['extractorProfile']=copy.deepcopy(profile);a['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile});self.assertEqual(extract_pdf_text_artifact_v3(p,a['sourceFileId'],a['inputSha256'],traversal_policy_version=NEW),a)
 def test_nested_invalid_glyph_rejects_whole_not_partial(self):
  for c in C['producerErrors']:
   p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256'])
   with self.assertRaisesRegex(ValueError,c['reasonCode']):extract_pdf_text_artifact_v3(p,'SYNTHETIC-T61-INVALID',c['originalSha256'],traversal_policy_version=NEW)
 def test_default_remains_explicitly_unsupported(self):
  for c in C['cases']+C['producerErrors']:
   with self.subTest(name=c['name']):
    with self.assertRaisesRegex(ValueError,c['defaultExpectedError']):extract_pdf_text_artifact_v3(R/c['originalPath'],'SYNTHETIC-T61-DEFAULT',c['originalSha256'])
