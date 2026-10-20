"""Independent original-backed T59 root-policy v2 regression; first RED v1 retained."""
from __future__ import annotations
import copy,hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from pdfminer.layout import LTChar,LTTextContainer,LTTextLine,LTTextBoxHorizontal,LTPage
from inspector_worker import text_layer
from inspector_worker.source_declarations import _valid_artifact
F=Path(__file__).resolve().parents[3]/'fixtures'/'text-layer-degenerate-geometry-v1'
PLAN=json.loads((F/'research-policy-v2-manual-plan.json').read_text())
assert hashlib.sha256((F/'research-policy-v2-manual-plan.json').read_bytes()).hexdigest()=='fd63657eb49665af47b07f017dd4a2f0411ca7108e873e988d83d437f0af3816'
MANIFEST={x['name']:x for x in json.loads((F/'research-policy-v2-original-manifest.json').read_text())['originals']}
for m in MANIFEST.values():assert hashlib.sha256((F/m['file']).read_bytes()).hexdigest()==m['sha256']
def extract(name):
 m=MANIFEST[name];return text_layer.extract_pdf_text_artifact(F/m['file'],m['sourceFileId'],m['sha256'])
def layout(name):return list(text_layer._visible_pdf_layouts(F/MANIFEST[name]['file']))
def texts(page):return [b['text'] for b in page['blocks']]
def all_boxes(page):return [box for block in page['blocks'] for box in [block['bboxMilliPoints'],*block.get('lineBboxesMilliPoints',[])]]
def descendants(item):
 yield item
 if hasattr(item,'__iter__'):
  for child in item:yield from descendants(child)
def controlled(layout_page,visible):
 m=MANIFEST['zero-safe']
 with patch.object(text_layer,'_visible_pdf_layouts',return_value=iter([(layout_page,visible)])):
  return text_layer.extract_pdf_text_artifact(F/m['file'],m['sourceFileId'],m['sha256'])
class TextLayerDegenerateGeometryTests(unittest.TestCase):
 def test_zero_font_original_keeps_only_complete_visible_neighbor(self):
  page=extract('zero-safe')['pages'][0];self.assertEqual(texts(page),['VISIBLE BODY']);self.assertEqual(page['quality']['metrics']['nonWhitespaceCharacterCount'],11)
 def test_zero_only_page_stays_present_and_requires_ocr(self):
  a=extract('zero-safe');self.assertEqual(a['pageCount'],3);self.assertEqual([p['pageNumber'] for p in a['pages']],[1,2,3]);self.assertEqual(texts(a['pages'][1]),['SECOND BODY']);self.assertEqual(a['pages'][2]['blocks'],[]);self.assertEqual(a['pages'][2]['quality']['disposition'],'OCR_REQUIRED');self.assertEqual(a['pages'][2]['quality']['reasonCodes'],['EMPTY_TEXT_LAYER']);self.assertEqual(a['textPageCount'],2)
 def test_positive_native_submillipoint_collapse_fails_entire_source(self):
  with self.assertRaises(ValueError):extract('collapsed-positive')
 def test_positive_one_millipoint_control_retained_exact_without_padding(self):
  p=extract('positive-micro')['pages'][0];matches=[b for b in p['blocks'] if b['text']=='MICRO'];self.assertEqual(len(matches),1);self.assertEqual(matches[0]['bboxMilliPoints'],[60000,120000,60003,120001]);self.assertIn('SECOND BODY',texts(p));self.assertTrue(_valid_artifact(extract('positive-micro')))
 def test_positive_original_line_with_zero_font_char_fails_entire_source(self):
  with self.assertRaises(ValueError):extract('mixed-zero-child')
 def test_fixtures_actually_exercise_native_zero_rounding_and_mixed_char(self):
  z=layout('zero-safe')[0][0];self.assertTrue(any(isinstance(x,LTChar) and x.x0==x.x1 and x.y0==x.y1 for x in descendants(z)))
  tiny=[x for x in descendants(layout('collapsed-positive')[0][0]) if isinstance(x,LTTextLine) and x.get_text().strip()=='SUBMILLI'];self.assertTrue(tiny);self.assertTrue(all(x.x0<x.x1 and x.y0<x.y1 for x in tiny));self.assertTrue(all(round(x.x0*1000)==round(x.x1*1000) and round(x.y0*1000)==round(x.y1*1000) for x in tiny))
  mixed=[x for x in descendants(layout('mixed-zero-child')[0][0]) if isinstance(x,LTTextLine) and x.x0<x.x1 and x.y0<x.y1 and any(isinstance(c,LTChar) and (c.x0==c.x1 or c.y0==c.y1) for c in x)];self.assertTrue(mixed,'Original PDF must create real positive lines containing zero-area glyphs')
 def test_zero_line_inside_positive_parent_preserves_neighbor_full_line(self):
  native,visible=layout('zero-safe')[0];useful=next(x for x in descendants(native) if isinstance(x,LTTextLine) and x.get_text().strip()=='VISIBLE BODY');bad=next(x for x in native if isinstance(x,LTTextLine) and x.x0==x.x1 and x.y0==x.y1)
  parent=LTTextBoxHorizontal();parent.add(copy.deepcopy(useful));parent.add(copy.deepcopy(bad));self.assertTrue(parent.x0<parent.x1 and parent.y0<parent.y1);page=LTPage(1,(0,0,200,160));page.add(parent)
  result=controlled(page,visible);self.assertEqual(texts(result['pages'][0]),['VISIBLE BODY']);self.assertTrue(_valid_artifact(result))
 def test_nonfinite_native_geometry_raises_instead_of_silent_skip(self):
  native,visible=layout('positive-micro')[0];block=next(x for x in native if isinstance(x,LTTextContainer));block.set_bbox((float('nan'),block.y0,block.x1,block.y1))
  with self.assertRaises(ValueError):controlled(native,visible)
 def test_inverted_native_geometry_raises_instead_of_normalizing(self):
  native,visible=layout('positive-micro')[0];block=next(x for x in native if isinstance(x,LTTextContainer));block.set_bbox((block.x1,block.y0,block.x0,block.y1))
  with self.assertRaises(ValueError):controlled(native,visible)
 def test_valid_artifact_exact_schema_positive_geometry_and_repeated_extraction(self):
  a=extract('zero-safe');self.assertEqual(a,extract('zero-safe'));self.assertTrue(_valid_artifact(a));self.assertEqual(set(a),{'schemaVersion','sourceFileId','inputSha256','coordinateSystem','pageCount','textPageCount','qualityPolicyVersion','qualitySummary','pages'})
  for p in a['pages']:
   for b in all_boxes(p):self.assertTrue(0<=b[0]<b[2]<=p['widthMilliPoints'] and 0<=b[1]<b[3]<=p['heightMilliPoints'])
if __name__=='__main__':unittest.main()
