"""T77 independent stdlib manual whole-output tests. No producer/reader oracle."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.column_pylon_dimension_literals import extract_column_pylon_dimension_literals as extract
R=Path(__file__).resolve().parents[3];B=(R/'fixtures/column-pylon-dimension-literals-v1/qa-manual-whole-expectations-v2.json').read_bytes()
assert hashlib.sha256(B).hexdigest()=='9c625ad63366bdaa426754e52cce7962886590bbb6b69f6cba946373748d69e0'
M=json.loads(B)
class ColumnPylonDimensionLiteralTests(unittest.TestCase):
 def test_both_complete_originals_all_six_and_zero_full_outputs_and_immutable(self):
  for c in M['wholeCases']:
   b=(R/c['inputFile']).read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),c['inputFileSha256']);a=json.loads(b);before=copy.deepcopy(a);self.assertEqual(extract(a),c['expected']);self.assertEqual(a,before)
 def test_original_order_duplicate_raw_signs_astral_ranges_and_detachment(self):
  c=M['syntheticCases'][0];a=copy.deepcopy(c['input']);before=copy.deepcopy(a);got=extract(a);self.assertEqual(got,c['expected']);self.assertEqual([x['sourcePath']for x in got['literals']],[[1,0],[2,0],[8,0],[9,0]]);self.assertEqual(got['literals'][0]['tokens']['scope']['raw'],'🚧\u00a0Корпус');self.assertEqual([x['tokens']['level']['raw']for x in got['literals']],['-0','+0','0','0']);got['literals'][0]['sourcePath'][0]=777;got['extractorProfile']['pdfminerVersion']='forged';self.assertEqual(a,before)
 def test_unsupported_raw8193_skips_exact128_and129_whole_refusal(self):
  for i in [1,3,4]:
   c=M['syntheticCases'][i];self.assertEqual(extract(c['input']),c['expected'])
 def test_page_eligibility_unlocated_first_empty_ocr_no_absence(self):
  c=M['syntheticCases'][2];self.assertEqual(extract(c['input']),c['expected'])
 def test_unrelated_last_page_quality_path_and_profile_whole_validation(self):
  for c in M['invalidWholeCases']:self.assertEqual(extract(c['input']),c['expected'])
 def test_native_exact_builtins_zero_callbacks_limits_before_semantics(self):
  callbacks=[]
  class Trap(dict):
   def items(self):callbacks.append(1);raise AssertionError('callback')
  cycle={};cycle['x']=cycle
  for value in [Trap(),cycle,0.5,float('nan'),float('inf'),9007199254740992,'\ud800',(1,),{1:'badkey'}]:self.assertEqual(extract(value),M['nativeExpected'])
  self.assertEqual(callbacks,[])
  for value in [{'pages':[None]*513},'a'*2000001,[0]*32769]:self.assertEqual(extract(value),M['limitExpected'])
