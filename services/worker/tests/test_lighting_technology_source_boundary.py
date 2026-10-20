"""Supplementary independently authored portable and native cases. No TS import."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.lighting_technology_source import reconstruct_lighting_technology_source as run,lighting_technology_declaration_content_hash as content_hash
F=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-lighting-technology-source-v1'
def load(name,pin):
 raw=(F/name).read_bytes();assert hashlib.sha256(raw).hexdigest()==pin;return json.loads(raw)['cases']
CORE=load('research-authored-goldens.json','e5340b5bd776432af6349436387298998df2d0da44b087932c681b30971be59a')
CASES=load('research-portable-boundary-goldens.json','6da10ec64f27ba107bce91ca6677308e8cc34103e3c618d62948f3bc5792b71f')
def base():return copy.deepcopy(CORE[0]['input'])
def abstain(reason='INVALID_INPUT'):return {'schemaVersion':'matrix-zu130-lighting-technology-source-result-v1','status':'ABSTAIN','reasonCode':reason}
class LightingBoundaryTests(unittest.TestCase):
 def test_frozen_29_portable_whole_outputs_and_no_mutation(self):
  self.assertEqual(len(CASES),29)
  for c in CASES:
   with self.subTest(name=c['name']):
    value=copy.deepcopy(c['input']);before=copy.deepcopy(value);actual=run(value);self.assertEqual(actual,c['expected']);self.assertEqual(value,before)
    if actual['status']=='RECONSTRUCTED':self.assertEqual(content_hash(actual['declaration']),c['expectedDeclarationContentHash'])
 def test_native_float_and_unsafe(self):
  for x in [1.0,float('nan'),float('inf'),2**53]:self.assertEqual(run(x),abstain())
 def test_native_surrogate(self):self.assertEqual(run('\ud800'),abstain())
 def test_native_cycle(self):
  x={};x['self']=x;self.assertEqual(run(x),abstain())
 def test_native_tuple_set_bytes(self):
  for x in [(),set(),b'x']:self.assertEqual(run(x),abstain())
 def test_subclasses_no_callbacks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
  x=Hostile(base());self.assertEqual(run(x),abstain());self.assertEqual(calls,[])
  with self.assertRaises(ValueError):content_hash(x)
  self.assertEqual(calls,[])
 def test_bool_not_integer_in_box(self):
  x=base();x['selection']['fragments'][0]['bboxMilliPoints'][0]=True;self.assertEqual(run(x),abstain('INVALID_SELECTION'))
 def test_container_limit(self):self.assertEqual(run([None]*32769),abstain('INPUT_LIMIT'))
 def test_string_limit(self):self.assertEqual(run('x'*2_000_001),abstain('INPUT_LIMIT'))
 def test_depth_limit(self):
  x=None
  for _ in range(66):x=[x]
  self.assertEqual(run(x),abstain('INPUT_LIMIT'))
 def test_no_output_aliases_and_no_comparison_authority(self):
  x=base();before=copy.deepcopy(x);r=run(x);self.assertEqual(r['status'],'RECONSTRUCTED');self.assertIsNone(r['declaration']['calibratedProbability']);self.assertNotIn('ruleId',r['declaration']);self.assertNotIn('entityKey',r['declaration']);r['declaration']['primaryFragments'][0]['rawText']='changed';r['declaration']['regionBoxMilliPoints'][0]=1;self.assertEqual(x,before)
 def test_hash_helper_rejects_native_invalid(self):
  for x in [1.0,float('nan'),2**53,'\ud800',b'x']:
   with self.assertRaises(ValueError):content_hash(x)
if __name__=='__main__':unittest.main()
