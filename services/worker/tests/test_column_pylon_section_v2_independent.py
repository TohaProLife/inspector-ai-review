"""Frozen independent whole outputs; no DUT used to author expected values."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.column_pylon_section_v2 import (compare_kr060_column_pylon_section,parse_column_pylon_section_review_input,validate_column_pylon_section_review_decision,project_column_pylon_section_review_decision,column_pylon_section_pair_key,materialize_column_pylon_section_review)
ROOT=Path(__file__).resolve().parents[3]
B=(ROOT/'fixtures/matrix-column-pylon-section-v2-v1/qa-independent-whole-goldens.json').read_bytes()
assert hashlib.sha256(B).hexdigest()=='e2ef856b9976f23f408044652f94e2cb18aac16f719c07d0742ae2d9f26efbed'
M=json.loads(B);CASES=M['portCases']+M['nativeCases']
class ColumnPylonSectionV2IndependentTests(unittest.TestCase):
 def test_all32_whole_outputs_and_input_immutability(self):
  self.assertEqual(len(CASES),32)
  for c in CASES:
   with self.subTest(name=c['name']):
    value=copy.deepcopy(c['input']);before=copy.deepcopy(value)
    self.assertEqual(compare_kr060_column_pylon_section(value),c['expected']);self.assertEqual(value,before)

 def test_projection_statuses_pair_keys_and_detachment(self):
  data=(ROOT/'fixtures/matrix-column-pylon-section-v2-v1/qa-independent-helper-goldens.json').read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),'72edfb08632920b75381c54d46a62a854b6d549598beaffcfaac9c33ea2f6746')
  for c in json.loads(data)['cases']:
   with self.subTest(name=c['name']):
    before=copy.deepcopy(c);self.assertEqual(validate_column_pylon_section_review_decision(c['journal']),c['journal']);self.assertEqual(project_column_pylon_section_review_decision(c['journal']),c['expectedRequest']);self.assertEqual(parse_column_pylon_section_review_input(c['expectedRequest']),c['expectedRequest']);self.assertEqual(column_pylon_section_pair_key(c['pairKeyInput']),c['expectedPairKey'])
    p=project_column_pylon_section_review_decision(c['journal']);encoded=json.dumps(p);self.assertNotIn('literalSnapshot',encoded);self.assertNotIn('selectionContentHash',encoded);self.assertNotIn('nativeBoxPointStrings',encoded);p['reference']='changed';request=parse_column_pylon_section_review_input(c['expectedRequest']);request['reference']='changed';j=validate_column_pylon_section_review_decision(c['journal']);j['projection']['reference']='changed';self.assertEqual(c,before)
 def test_frozen_mixed_projection_and_exact_prior_withdrawal(self):
  data=(ROOT/'fixtures/matrix-column-pylon-section-v2-v1/qa-review-v2-goldens.json').read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),'f8f55140d12b268342df73b65d98efe72eb207169e77325ef1e24248d08c38d2');m=json.loads(data)
  for c in m['projectionCases']:self.assertEqual(project_column_pylon_section_review_decision(c['input']),c['expected'])
  for c in m['materializationCases']:
   before=copy.deepcopy(c);self.assertEqual(materialize_column_pylon_section_review(c['input'],c['context']),c['expected']);self.assertEqual(c,before)
 def test_native_invalid_zero_user_callbacks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
   def __getitem__(self,k):calls.append('get');raise AssertionError('callback')
  cycle={};cycle['self']=cycle
  for value in [Hostile(),cycle,{'x':True},{'x':1.0},{'x':float('nan')},{'x':float('inf')},{'x':9007199254740992},{'x':'\ud800'},{'x':set()}]:
   result=compare_kr060_column_pylon_section(value);self.assertEqual(result['status'],'ABSTAIN');self.assertEqual(result['reasonCode'],'INVALID_INPUT');self.assertIsNone(result['identity']);self.assertIsNone(result['comparison']);self.assertIsNone(result['calibratedProbability']);self.assertIsNone(parse_column_pylon_section_review_input(value));self.assertIsNone(project_column_pylon_section_review_decision(value))
   with self.assertRaises(Exception):validate_column_pylon_section_review_decision(value)
   with self.assertRaises(Exception):column_pylon_section_pair_key(value)
   with self.assertRaises(Exception):materialize_column_pylon_section_review(value,{})
  self.assertEqual(calls,[])
 def test_native_limit_before_shape_no_partial_output(self):
  deep=None
  for _ in range(69):deep={'x':deep}
  for value in [{'x':'a'*2000001},{'x':[0]*32769},deep]:
   result=compare_kr060_column_pylon_section(value);self.assertEqual(result['status'],'ABSTAIN');self.assertEqual(result['reasonCode'],'INPUT_LIMIT');self.assertIsNone(result['identity']);self.assertIsNone(result['comparison']);self.assertIsNone(result['calibratedProbability'])
