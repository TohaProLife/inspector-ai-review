"""Frozen four original rotation/CropBox/native-origin whole artifacts."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,read_document_text_v3_artifact,document_text_v3_content_hash,get_document_text_v3_extractor_profile
R=Path(__file__).resolve().parents[3];p=R/'fixtures/document-text-v3-v1/qa-rotation-manual-goldens.json'
assert hashlib.sha256(p.read_bytes()).hexdigest()=="6eabbca0c2c53b03b145bd2b0a95f13f1365b16086943bce5fb0e7f5ad202c5a"
C=json.loads(p.read_text())['cases']
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class DocumentTextV3RotationTests(unittest.TestCase):
 def test_four_whole_reader_outputs_immutable(self):
  for c in C:
   with self.subTest(name=c['name']):
    a=copy.deepcopy(c['artifact']);before=copy.deepcopy(a);self.assertEqual(read_document_text_v3_artifact(a),c['expectedRead']);self.assertEqual(document_text_v3_content_hash(a),c['expectedRead']['contentHash']);self.assertEqual(a,before)
 def test_four_original_pdf_replays_only_profile_substitution(self):
  profile=get_document_text_v3_extractor_profile()
  for c in C:
   with self.subTest(name=c['name']):
    p=R/c['originalPath'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['originalSha256']);a=copy.deepcopy(c['artifact']);a['extractorProfile']=copy.deepcopy(profile);a['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile});self.assertEqual(extract_pdf_text_artifact_v3(p,a['sourceFileId'],a['inputSha256']),a)
