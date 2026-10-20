"""Independent manually authored whole lighting comparison outputs."""
import copy
import hashlib
import json
import unittest
from pathlib import Path
from inspector_worker.lighting_technology_comparison import (
    compare_zu130_lighting_technologies,
    validate_lighting_technology_scope_request,
    project_lighting_technology_scope_decision,
)
P=Path(__file__).resolve().parents[3]/'fixtures/matrix-lighting-technology-comparison-v1/qa-manual-whole-goldens-v2.json'
assert hashlib.sha256(P.read_bytes()).hexdigest()=='cb901f74d68fdab8efbc26cfce51d120eeeb3f7f7d9862beeec0c75af75e05fe'
M=json.loads(P.read_text()); C=M['cases']; H=M['helperCases']
def rejected(reason):return {'schemaVersion':'matrix-zu130-lighting-technology-comparison-v1','status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}
class LightingTechnologyComparisonTests(unittest.TestCase):
 def test_twenty_one_manual_whole_outputs(self):
  self.assertEqual(len(C),21)
  for c in C:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_zu130_lighting_technologies(x),c['expected']);self.assertEqual(x,before)
 def test_six_manual_request_projection_cases(self):
  self.assertEqual(len(H),6)
  for c in H:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);fn=validate_lighting_technology_scope_request if c['operation']=='request' else project_lighting_technology_scope_decision;self.assertEqual(fn(x),c['expected']);self.assertEqual(x,before)
 def test_native_cycle_float_and_surrogate(self):
  cycle={};cycle['self']=cycle
  for x in [cycle,{'value':0.5},{'value':'\ud800'}]:self.assertEqual(compare_zu130_lighting_technologies(x),rejected('INVALID_INPUT'))
 def test_custom_native_callbacks_never_run(self):
  calls=[]
  class Hostile(dict):
   def __iter__(self):calls.append('iter');raise AssertionError('native callback')
   def items(self):calls.append('items');raise AssertionError('native callback')
  self.assertEqual(compare_zu130_lighting_technologies(Hostile(C[0]['input'])),rejected('INVALID_INPUT'));self.assertEqual(calls,[])
 def test_limits_precede_later_duplicate_shapes(self):
  self.assertEqual(compare_zu130_lighting_technologies({'oversize':[None]*32769}),rejected('INPUT_LIMIT'))
  x=copy.deepcopy(C[0]['input']);x['sources']=[copy.deepcopy(x['sources'][0]) for _ in range(65)];self.assertEqual(compare_zu130_lighting_technologies(x),rejected('INPUT_LIMIT'))
  x=copy.deepcopy(C[0]['input']);scope=x['sources'][0]['review']['lightingTechnologyScope'];scope['claims']=[copy.deepcopy(scope['claims'][0]) for _ in range(17)];self.assertEqual(compare_zu130_lighting_technologies(x),rejected('INPUT_LIMIT'))
 def test_outputs_and_staging_requests_are_detached(self):
  x=copy.deepcopy(C[0]['input']);before=copy.deepcopy(x);a=compare_zu130_lighting_technologies(x);a['identity']['entityKey']='mutated';a['expected']['sourceFileId']='mutated';self.assertEqual(x,before);self.assertEqual(compare_zu130_lighting_technologies(x),C[0]['expected'])
  x=copy.deepcopy(H[0]['input']);a=validate_lighting_technology_scope_request(x);a['claims'][0]['selection']['fragments'][0]['sourcePath'][0]=999;self.assertEqual(x,H[0]['input'])
