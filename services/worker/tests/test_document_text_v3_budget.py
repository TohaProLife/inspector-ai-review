"""Literal budget/page/traversal controls frozen before execution."""
import json,unittest,hashlib
from pathlib import Path
from unittest.mock import patch
from pdfminer.layout import LTPage,LTFigure
from inspector_worker.document_text_v3 import read_document_text_v3_artifact,document_text_v3_content_hash,extract_pdf_text_artifact_v3
R=Path(__file__).resolve().parents[3]
def nested(depth,end=None):
 for _ in range(depth):end=[end]
 return end
def size(v):return len(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
class DocumentTextV3BudgetTests(unittest.TestCase):
 def assertRejected(self,a,reason='INPUT_LIMIT'):
  self.assertEqual(read_document_text_v3_artifact(a),{'status':'ABSTAIN','reasonCode':reason})
  with self.assertRaises(ValueError):document_text_v3_content_hash(a)
 def pair(self,a,b):self.assertRejected(a,'INVALID_TEXT_ARTIFACT');self.assertRejected(b)
 def test_depth64_vs65(self):self.pair(nested(64),nested(65))
 def test_object_keys_have_depth(self):self.pair(nested(63,{'x':None}),nested(64,{'x':None}))
 def test_object_keys_count_in_exact200000nodes(self):
  a=[*[{f'k{i}':None for i in range(24999)} for _ in range(4)],[None,None]];self.pair(a,a+[None])
 def test_exact_full_serialized_ascii_budget(self):
  a=['X'*2000000,'X'*2000000,'X'*2000000,'X'*1999987];b=a.copy();b[3]+='X';self.assertEqual(size(a),8000000);self.assertEqual(size(b),8000001);self.pair(a,b)
 def test_json_control_escapes_count_in_serialized_budget(self):
  a=['\0'*1333332+'AAAA'];b=[a[0]+'A'];self.assertEqual(size(a),8000000);self.assertEqual(size(b),8000001);self.pair(a,b)
 def test_utf8_exact_budget(self):
  a=['😀'*1999999];b=[a[0]+'A'];self.assertEqual(size(a),8000000);self.assertEqual(size(b),8000001);self.pair(a,b)
 def test_actual513_pages_before_incomplete_or_bad_dto(self):
  for page_count in [513,'malformed']:
   with self.subTest(count=page_count):self.assertRejected({'pageCount':page_count,'pages':[None]*513})
 def test_deep_unsupported_layout_must_be_bounded_not_recursion_error(self):
  page=LTPage(1,(0,0,200,160));node=page
  for _ in range(1100):
   child=LTFigure('nested',(0,0,1,1),(1,0,0,1,0,0));node.add(child);node=child
  p=R/'fixtures/text-layer-degenerate-geometry-v1/research-positive-micro.pdf';sha=hashlib.sha256(p.read_bytes()).hexdigest()
  with patch('inspector_worker.text_layer._visible_pdf_layouts',return_value=iter([(page,(0.0,0.0,200.0,160.0))])):
   with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):extract_pdf_text_artifact_v3(p,'SYNTHETIC-T60-DEEP',sha)
if __name__=='__main__':unittest.main()
