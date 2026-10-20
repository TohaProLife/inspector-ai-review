"""Actual pinned-library analysis calls are once per figure, not repeated by consumer."""
import hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from collections import Counter
from pdfminer.layout import LTFigure
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3
R=Path(__file__).resolve().parents[3];C=json.loads((R/'fixtures/document-text-v3-figures-v1/qa-original-manifest.json').read_text())['originals'][0];NEW='pdfminer-analyzed-figures-whole-lines-v1'
class DocumentTextV3FigureAnalysisTests(unittest.TestCase):
 def test_actual_original_outermost_analysis_does_not_repeat_descendants(self):
  p=R/C['path'];self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),C['sha256']);counts=Counter();original=LTFigure.analyze
  def counted(obj,params):
   if params.all_texts:counts[id(obj)]+=1
   return original(obj,params)
  with patch.object(LTFigure,'analyze',counted):a=extract_pdf_text_artifact_v3(p,C['sourceFileId'],C['sha256'],traversal_policy_version=NEW)
  self.assertEqual(len(counts),2);self.assertEqual(list(counts.values()),[1,1]);self.assertEqual(a['pages'][0]['locatedLines'][0]['sourcePath'],[0,0,0,0])
 def test_original_hash_mismatch_never_invokes_native_layout(self):
  with patch('inspector_worker.text_layer._visible_pdf_layouts',side_effect=AssertionError('MUST_NOT_PARSE')) as parser:
   with self.assertRaisesRegex(ValueError,'SOURCE_SHA256_MISMATCH'):extract_pdf_text_artifact_v3(R/C['path'],C['sourceFileId'],'0'*64,traversal_policy_version=NEW)
   self.assertEqual(parser.call_count,0)
