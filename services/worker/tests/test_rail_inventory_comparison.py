"""Frozen independent ODI120 comparison oracles; supplied projections are not DB authority."""
from pathlib import Path
from copy import deepcopy
import hashlib,json,unittest
from inspector_worker.rail_inventory_comparison import compare_odi120_rail_inventories as run
P=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-rail-comparison-v1'
MANUAL=json.loads((P/'ts-rail-comparison-manual-goldens.json').read_text())['fixtures'];BY={f['name']:f for f in MANUAL}
OWN=json.loads((P/'researchpy-independent-portable-probes.json').read_text())['fixtures']
TS=json.loads((P/'ts-additional-portable-expectations-clarified-v2.json').read_text())['vectors']
SCHEMA='matrix-odi120-rail-inventory-comparison-v1'
def base(name='pd-both-rd-basin'):return deepcopy(BY[name]['input'])
def claim(x,i=1):return x['sources'][i]['review']['railInventoryScope']['claims'][0]
class WholeOutputs(unittest.TestCase):
 def check_cases(self,cases):
  for c in cases:
   with self.subTest(name=c['name']):
    x=deepcopy(c['input']);before=deepcopy(x);self.assertEqual(run(x),c['expected']);self.assertEqual(x,before)
 def test58_frozen_manual_whole_outputs(self):self.check_cases(MANUAL)
 def test46_python_independent_whole_outputs(self):self.check_cases(OWN)
 def test52_typescript_clarified_whole_outputs(self):self.check_cases(TS)
 def test_fixture_hashes_and_historical_diagnostics_preserved(self):
  provenance=json.loads((P/'provenance.json').read_text())
  for name,h in provenance['files'].items():self.assertEqual(hashlib.sha256((P/name).read_bytes()).hexdigest(),h)
  old=json.loads((P/'ts-additional-portable-expectations.json').read_text())['vectors'];self.assertEqual(len(old),52)
  changed=[]
  for a,b in zip(old,TS):
   self.assertEqual(a['name'],b['name']);self.assertEqual(a['input'],b['input'])
   if a['expected']!=b['expected']:changed.append(a['name']);self.assertEqual(a['expected']['reasonCode'],'INVALID_INPUT');self.assertEqual(b['expected']['reasonCode'],'SOURCE_PROVENANCE_UNVERIFIED')
  self.assertEqual(changed,['duplicate committed source','duplicate retained origin'])

class NativeBoundary(unittest.TestCase):
 def abstain(self,x,reason='INVALID_INPUT'):
  self.assertEqual(run(x),{'schemaVersion':SCHEMA,'status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None})
 def test_custom_dict_zero_hooks(self):
  touched=[]
  class Trap(dict):
   def items(self):touched.append('items');raise AssertionError('hook')
   def __iter__(self):touched.append('iter');raise AssertionError('hook')
   def __len__(self):touched.append('len');raise AssertionError('hook')
  self.abstain(Trap(base()));self.assertEqual(touched,[])
 def test_nested_custom_dict_zero_hooks(self):
  touched=[]
  class Trap(dict):
   def items(self):touched.append('items');raise AssertionError('hook')
  x=base();x['origins'][1]['textArtifact']=Trap({});self.abstain(x);self.assertEqual(touched,[])
 def test_custom_list_no_iteration(self):
  class Trap(list):
   def __iter__(self):raise AssertionError('hook')
   def __len__(self):raise AssertionError('hook')
  x=base();x['sources']=Trap([]);self.abstain(x)
 def test_custom_scalar_no_coercion(self):
  class Trap:
   def __str__(self):raise AssertionError('coercion')
  x=base();x['identity']=Trap();self.abstain(x)
 def test_cycle(self):
  x=base();x['extra']=x;self.abstain(x)
 def test_shared_alias_is_not_cycle(self):
  x=base();claim(x)['identity']=x['identity'];self.assertEqual(run(x),BY['pd-both-rd-basin']['expected'])
 def test_native_float(self):
  x=base();claim(x)['selection']['pageNumber']=1.0;self.abstain(x)
 def test_native_nan_inf(self):
  for v in [float('nan'),float('inf'),-float('inf')]:
   x=base();claim(x)['selection']['pageNumber']=v;self.abstain(x)
 def test_native_unsafe_int(self):
  x=base();claim(x)['selection']['pageNumber']=2**53;self.abstain(x)
 def test_native_surrogate(self):
  x=base();x['objectId']='\ud800';self.abstain(x)
 def test_native_nonstring_key(self):
  x=base();x[1]='bad';self.abstain(x)
 def test_native_depth_limit(self):
  x=base();v=[];x['extra']=v
  for i in range(65):n=[];v.append(n);v=n
  self.abstain(x,'INPUT_LIMIT')
 def test_native_container_limit(self):
  x=base();x['extra']=[None]*32769;self.abstain(x,'INPUT_LIMIT')
 def test_native_string_codepoint_limit(self):
  x=base();x['extra']='x'*2000001;self.abstain(x,'INPUT_LIMIT')
 def test_native_utf8_values_limit(self):
  x=base();x['extra']='😀'*2000000;self.abstain(x,'INPUT_LIMIT')
 def test_native_utf8_key_limit(self):
  x=base();x['extra']={('x'*1999999)+str(i):None for i in range(4)};self.abstain(x,'INPUT_LIMIT')
 def test_native_nodes_include_keys(self):
  x=base();x['extra']=[{str(i):None for i in range(20000)}for _ in range(5)];self.abstain(x,'INPUT_LIMIT')
 def test_input_immutable_all_provenance(self):
  for c in MANUAL+OWN:
   x=deepcopy(c['input']);before=deepcopy(x);run(x);self.assertEqual(x,before)
 def test_output_no_aliases(self):
  x=base();before=deepcopy(x);a=run(x);b=run(x);a['identity']['roomKey']='MUTATED';a['expected']['sourceFileId']='MUTATED';a['missingFeatureKeys'].clear();self.assertEqual(x,before);self.assertEqual(b,BY['pd-both-rd-basin']['expected'])
 def test_candidate_null_not_definitive(self):
  r=run(base());self.assertEqual(r['status'],'CANDIDATE');self.assertIsNone(r['calibratedProbability']);self.assertFalse(set(r)&{'confidence','severity','physicalMissing','NO_VIOLATION','delta','coverage'})
 def test_snapshot_null_pair_both_absent_valid(self):
  x=base();x['sources'][1]['review']=x['sources'][1]['reviewSnapshot']=None;self.abstain(x,'MATCHED_INVENTORY_PAIR_UNVERIFIED')
 def test_unknown_native_bool_as_extra_reject_shape(self):
  x=base();x['extra']=False;self.abstain(x)
 def test_source_key_unchanged_whitespace(self):
  for text in [' space','space ','\u0085space','\x1cspace']:
   x=base();x['objectId']=text;self.abstain(x)
 def test_reference_controls(self):
  for text in ['reference\rtext','reference\x00text','reference\u2028text','reference\ufffdtext']:
   x=base();claim(x)['reference']=text;self.abstain(x)


if __name__=='__main__':unittest.main()
