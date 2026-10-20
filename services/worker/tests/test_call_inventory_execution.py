"""Independent tests authored before first typed-wrapper execution."""
from pathlib import Path
from copy import deepcopy
import json,unittest,hashlib,tempfile
P=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-call-execution-v1'
from inspector_worker import call_inventory_execution as M
G=json.loads((P/'root-call-execution-goldens.json').read_text());R=G['capabilityRegistry'];BASE=G['baseCoverage']
PROBES=json.loads((P/'research-call-execution-independent-probes.json').read_text())['cases']
PROBES+=json.loads((P/'root-call-execution-cross-probes.json').read_text())['cases']
PROBES+=[c for c in json.loads((P/'research-call-execution-cross-added-probes.json').read_text())['cases'] if c['expected']!='OBSERVATION_ONLY_ROOT_CLARIFICATION_PENDING']
def package():return deepcopy(G['cases'][0]['package'])
def envelope():return deepcopy(G['cases'][0]['expectedEnvelope'])
class WholeOutputTests(unittest.TestCase):pass
for c in G['cases']:
 def test(self,c=c):
  value=deepcopy(c['package']);before=deepcopy(value)
  self.assertEqual(M.derive_call_inventory_identities(value['sources']),value['identities'])
  self.assertEqual(M.validate_call_inventory_loader_package(value),value)
  result=M.build_call_inventory_comparisons(value,R);self.assertEqual(result,c['expectedEnvelope'])
  self.assertEqual(M.validate_call_inventory_comparisons_envelope(result,R),result)
  base=deepcopy(BASE);base_before=deepcopy(base)
  merged=M.merge_call_inventory_coverage(base,result,R);self.assertEqual(merged,c['expectedCoverage'])
  self.assertEqual(value,before);self.assertEqual(base,base_before)
  self.assertEqual([r for r in merged if r['parameterCode']!='ODI-123'],[r for r in BASE if r['parameterCode']!='ODI-123'])
 setattr(WholeOutputTests,'test_'+c['name'].replace('-','_'),test)
class OriginalIntegrityTests(unittest.TestCase):pass
for c in G['integrityErrors']:
 def test(self,c=c):
  value=deepcopy(c['package']);before=deepcopy(value)
  with self.assertRaises(ValueError):M.build_call_inventory_comparisons(value,R)
  self.assertEqual(value,before)
 setattr(OriginalIntegrityTests,'test_'+c['name'].replace('-','_'),test)
class IndependentPortableTests(unittest.TestCase):pass
for index,c in enumerate(PROBES):
 def test(self,c=c):
  x=deepcopy(c['input']);before=deepcopy(x);operation=c['operation']
  def execute():
   if operation=='build':return M.build_call_inventory_comparisons(x,R)
   if operation=='validate':return M.validate_call_inventory_comparisons_envelope(x,R)
   if operation=='merge':return M.merge_call_inventory_coverage(x['coverage'],x['envelope'],R)
   if operation=='registry':return M.build_call_inventory_comparisons(package(),x)
   if operation=='derive':return M.derive_call_inventory_identities(x)
   raise AssertionError(operation)
  if c['expected']=='VALUE_ERROR':
   with self.assertRaises(ValueError):execute()
  else:self.assertEqual(execute(),c['expected'])
  self.assertEqual(x,before)
 setattr(IndependentPortableTests,'test_'+str(index)+'_'+c['name'].replace('-','_'),test)
class NativeBoundaryTests(unittest.TestCase):
 def test_hostile_subclass_no_getter_execution(self):
  calls=[]
  class Trap(dict):
   def items(self):calls.append('items');raise AssertionError
   def __len__(self):calls.append('len');raise AssertionError
   def __getitem__(self,key):calls.append('get');raise AssertionError
  with self.assertRaises(ValueError):M.validate_call_inventory_loader_package(Trap())
  self.assertEqual(calls,[])
 def test_cycle_rejected(self):
  x=package();x['cycle']=x
  with self.assertRaises(ValueError):M.build_call_inventory_comparisons(x,R)
 def test_native_float_nan_inf_unsafe(self):
  for v in (0.0,float('nan'),float('inf'),2**53,-2**53):
   with self.subTest(repr(v)):
    x=package();x['native']=v
    with self.assertRaises(ValueError):M.build_call_inventory_comparisons(x,R)
 def test_surrogate_and_nonstring_keys(self):
  for v in ('\ud800',{'\udfff':0},{1:0}):
   with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json(v)
 def test_portable_nonascii_key_lexical_numeric_order(self):
  v={'2':0,'10':1,'\U00010000':2,'\ue000':3}
  self.assertEqual(M.canonical_call_inventory_execution_json(v),'{"10":1,"2":0,"\ue000":3,"\U00010000":2}')
 def test_native_bool_allowed_numeric_dto_forbidden(self):
  self.assertEqual(M.canonical_call_inventory_execution_json([True,False]),'[true,false]')
  x=envelope();x['results'][0]['comparison']['calibratedProbability']=False
  with self.assertRaises(ValueError):M.validate_call_inventory_comparisons_envelope(x,R)
 def test_string_limit(self):
  self.assertEqual(len(M.canonical_call_inventory_execution_json('x'*2000000)),2000002)
  with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json('x'*2000001)
 def test_exact8m_values_and_keys(self):
  v={k:'x'*1999999 for k in 'abcd'};M.canonical_call_inventory_execution_json(v);v['a']+='x'
  with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json(v)
 def test_depth_limit(self):
  v=None
  for _ in range(64):v=[v]
  M.canonical_call_inventory_execution_json(v)
  with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json([v])
 def test_node_limit(self):
  with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json({str(i):[0]*6 for i in range(30000)})
 def test_container_limit(self):
  M.canonical_call_inventory_execution_json([None]*32768)
  with self.assertRaises(ValueError):M.canonical_call_inventory_execution_json([None]*32769)
 def test_package_collection_limits(self):
  values=[{'sources':[{}]*65},{'origins':[{}]*129},{'sources':[{'review':{'callInventoryScope':{'claims':[{}]*17}}}]}]
  for x in values:
   with self.assertRaises(ValueError):M.validate_call_inventory_loader_package(x)
 def test_derive_identites_all_unknown_no_filter(self):
  x=deepcopy(next(c for c in G['cases'] if c['name']=='unknown-competing-rd-inventory')['package'])
  self.assertEqual(M.derive_call_inventory_identities(x['sources']),x['identities'])
  self.assertTrue(any(s['review']['approvalStatus']=='UNKNOWN' for s in x['sources']))
 def test_derive_output_detached(self):
  x=package();before=deepcopy(x);a=M.derive_call_inventory_identities(x['sources']);a[0]['floorKey']='MUTATED'
  self.assertEqual(x,before)
 def test_validated_package_detached(self):
  x=package();before=deepcopy(x);a=M.validate_call_inventory_loader_package(x);a['origins'][0]['textArtifact']['pages'].clear();self.assertEqual(x,before)
 def test_envelope_output_detached_and_repeat(self):
  x=package();a=M.build_call_inventory_comparisons(x,R);a['results'][0]['comparison']['expected']['sourceFileId']='MUTATED'
  self.assertEqual(M.build_call_inventory_comparisons(x,R),envelope())
 def test_envelope_validation_detached(self):
  x=envelope();a=M.validate_call_inventory_comparisons_envelope(x,R);a['results'][0]['identity']['floorKey']='MUTATED';self.assertEqual(x,envelope())
 def test_coverage_outputs_detached(self):
  x=deepcopy(BASE);a=M.merge_call_inventory_coverage(x,envelope(),R);a[0]['reason']='MUTATED';self.assertEqual(x,BASE)
 def test_scalar_namespace_collision(self):
  old=M._RULES
  with tempfile.TemporaryDirectory() as d:
   q=Path(d);(q/'matrix-call-inventory-capabilities-v1.json').write_bytes((old/'matrix-call-inventory-capabilities-v1.json').read_bytes())
   scalar=json.loads((old/'matrix-execution-v1.json').read_text());scalar['entries'][0]['atomicRules']=[{'ruleId':M._RULE}]
   (q/'matrix-execution-v1.json').write_text(json.dumps(scalar))
   try:
    M._RULES=q
    with self.assertRaises(ValueError):M.build_call_inventory_comparisons(package(),R)
   finally:M._RULES=old
 def test_source_origin_order_invariant(self):
  x=package();x['sources'].reverse();x['origins'].reverse();self.assertEqual(M.build_call_inventory_comparisons(x,R),envelope())
 def test_own_proto_in_full_artifact_never_stripped(self):
  x=package();x['origins'][0]['textArtifact']['__proto__']={}
  with self.assertRaises(ValueError):M.validate_call_inventory_loader_package(x)
class CrossRegressions(unittest.TestCase):
 def test_standalone_derive_hostile_root_list_zero_user_code(self):
  calls=[]
  class Trap(list):
   def __len__(self):calls.append('len');raise AssertionError
   def __iter__(self):calls.append('iter');raise AssertionError
   def __getitem__(self,k):calls.append('get');raise AssertionError
  with self.assertRaises(ValueError):M.derive_call_inventory_identities(Trap())
  self.assertEqual(calls,[])
 def test_standalone_derive_hostile_nested_review_zero_user_code(self):
  calls=[]
  class Trap(dict):
   def items(self):calls.append('items');raise AssertionError
   def __getitem__(self,k):calls.append('get');raise AssertionError
  sources=deepcopy(G['cases'][0]['package']['sources']);sources[0]['review']=Trap()
  with self.assertRaises(ValueError):M.derive_call_inventory_identities(sources)
  self.assertEqual(calls,[])
for c in json.loads((P/'research-call-execution-duplicate-review-amendment-probes.json').read_text())['cases']:
 def test(self,c=c):
  value=deepcopy(c['input']);before=deepcopy(value)
  with self.assertRaises(ValueError):
   if c['operation']=='derive':M.derive_call_inventory_identities(value)
   else:M.build_call_inventory_comparisons(value,R)
  self.assertEqual(value,before)
 setattr(CrossRegressions,'test_'+c['name'].replace('-','_'),test)

if __name__=='__main__':unittest.main(verbosity=2)
