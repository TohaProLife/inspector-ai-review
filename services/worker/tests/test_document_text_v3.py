"""T60 independent whole original-backed goldens frozen before v3 production."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3,read_document_text_v3_artifact,document_text_v3_content_hash,get_document_text_v3_extractor_profile
R=Path(__file__).resolve().parents[3];F=R/'fixtures/document-text-v3-v1/qa-core-manual-goldens.json'
assert hashlib.sha256(F.read_bytes()).hexdigest()=='ae21c102629e8e2d88edd54b113cd25d2d62fb2dbb599788731ce1dd0b204e28'
M=json.loads(F.read_text())
def h(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class DocumentTextV3Tests(unittest.TestCase):
 def test_full_historical_manual_artifacts_hash_and_no_mutation(self):
  for c in M['cases']:
   with self.subTest(name=c['name']):
    before=copy.deepcopy(c['artifact']);self.assertEqual(read_document_text_v3_artifact(c['artifact']),c['expectedRead']);self.assertEqual(document_text_v3_content_hash(c['artifact']),c['expectedRead']['contentHash']);self.assertEqual(c['artifact'],before)
 def test_original_producer_replay_only_profile_substitution(self):
  profile=get_document_text_v3_extractor_profile();self.assertEqual(profile['documentTextV3SourceSha256'],hashlib.sha256((R/'services/worker/inspector_worker/document_text_v3.py').read_bytes()).hexdigest());self.assertEqual(profile['textLayerSourceSha256'],'391563da89d8e1ac07c457b25cfaf64fe2a997412544d64c1e929caa8c1d1aa9')
  for c in M['cases']:
   with self.subTest(name=c['name']):
    path=R/c['originalPath'];self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),c['originalSha256']);expected=copy.deepcopy(c['artifact']);expected['extractorProfile']=copy.deepcopy(profile);expected['extractorProfileHash']=h({'hashDomain':'document-text-extractor-profile-v1','profile':profile});actual=extract_pdf_text_artifact_v3(path,expected['sourceFileId'],expected['inputSha256']);self.assertEqual(actual,expected);self.assertEqual(document_text_v3_content_hash(actual),h({'hashDomain':'document-text-v3-content-v1','artifact':expected}))
 def test_mixed_positive_line_zero_glyph_fails_without_splicing(self):
  for c in M['producerErrors']:
   with self.subTest(name=c['name']):
    path=R/c['originalPath'];self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),c['originalSha256'])
    with self.assertRaisesRegex(ValueError,c['reasonCode']):extract_pdf_text_artifact_v3(path,'SYNTHETIC-T60-mixed',c['originalSha256'])
 def test_unlocated_line_cannot_publish_invented_selectable_bbox(self):
  a=copy.deepcopy(M['cases'][1]['artifact']);a['pages'][0]['unlocatedLines'][0]['bboxMilliPoints']=[80000,120000,80001,120001];self.assertEqual(read_document_text_v3_artifact(a),{'status':'ABSTAIN','reasonCode':'INVALID_TEXT_ARTIFACT'})
  with self.assertRaises(ValueError):document_text_v3_content_hash(a)
if __name__=='__main__':unittest.main()
