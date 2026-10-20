"""Independent approved manual envelopes and authored probes; no peer wrapper read."""
from pathlib import Path
from copy import deepcopy
from unittest.mock import patch
import json,hashlib,unittest,tempfile
P=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-rail-execution-v1'
D=json.loads((P/'ts-rail-execution-wire-manual-goldens.json').read_text());PROBES=json.loads((P/'researchpy-rail-execution-independent-probes.json').read_text())['fixtures']
for name in ['researchpy-rail-execution-cross-added-manual-probes.json','researchpy-rail-execution-cross-clarified-manual-probes.json','ts-rail-execution-boundary-clarification-probes.json']:PROBES+=json.loads((P/name).read_text())['fixtures']
BASE=D['validCases'][0]
from inspector_worker import rail_inventory_execution as W
def base():return deepcopy(BASE['package'])
def native_assert(self,v):
 with self.assertRaises(ValueError):W.build_rail_inventory_comparisons(v)
def execute(c):
 x=c['input'];reg=c.get('registry');op=c['operation']
 if op=='build':return W.build_rail_inventory_comparisons(x,reg)
 if op=='derive':return W.derive_rail_inventory_identities(x)
 if op=='validateEnvelope':return W.validate_rail_inventory_comparisons_envelope(x,reg)
 if op=='merge':return W.merge_rail_inventory_coverage(x['baseCoverage'],x['envelope'],reg)
 raise AssertionError('unknown probe operation')
class WholeOutputs(unittest.TestCase):
 def test9_manual_envelopes_and132coverage(self):
  for case in D['validCases']:
   with self.subTest(name=case['name']):
    x=deepcopy(case['package']);before=deepcopy(x);coverage=deepcopy(D['baseV6EffectiveCoverage']);old=deepcopy(coverage)
    actual=W.build_rail_inventory_comparisons(x);merged=W.merge_rail_inventory_coverage(coverage,actual)
    self.assertEqual(actual,case['expectedEnvelope']);self.assertEqual(merged,case['expectedCoverage']);self.assertEqual(x,before);self.assertEqual(coverage,old)
    self.assertEqual(W.validate_rail_inventory_loader_package(x),x);self.assertEqual(W.validate_rail_inventory_comparisons_envelope(actual),actual)
    self.assertEqual(W.derive_rail_inventory_identities(x['sources']),x['identities']);self.assertEqual(len(merged),132)
    self.assertEqual([r for r in merged if r['parameterCode']!='ODI-120'],[r for r in old if r['parameterCode']!='ODI-120'])

 def test6_manual_integrity_throws(self):
  for case in D['integrityErrors']:
   with self.subTest(name=case['name']):
    x=deepcopy(case['package']);before=deepcopy(x)
    with self.assertRaises(ValueError):W.build_rail_inventory_comparisons(x)
    self.assertEqual(x,before)
 def test54_independent_frozen_probes(self):
  for case in PROBES:
   with self.subTest(name=case['name']):
    c=deepcopy(case);before=deepcopy(c)
    if c['throws']:
     with self.assertRaises(ValueError):execute(c)
    else:self.assertEqual(execute(c),c['expected'])
    self.assertEqual(c,before)
 def test55_typescript_frozen_probes(self):
  for c in json.loads((P/'ts-rail-execution-adversarial-probes.json').read_text())['probes']:
   with self.subTest(name=c['name']):
    before=deepcopy(c);op=c['operation'];pkg=c.get('package',BASE['package']);env=c.get('envelope',BASE['expectedEnvelope']);reg=c.get('registry')
    def run():
     if op=='build':return W.build_rail_inventory_comparisons(pkg,reg)
     if op=='registry':return W.build_rail_inventory_comparisons(BASE['package'],reg)
     if op=='validate':return W.validate_rail_inventory_comparisons_envelope(env)
     if op=='merge':return W.merge_rail_inventory_coverage(c.get('coverage',D['baseV6EffectiveCoverage']),env,reg)
     if op=='evidence':
      rebuilt=W.build_rail_inventory_comparisons(W.validate_rail_inventory_loader_package(pkg),reg);W.validate_rail_inventory_comparisons_envelope(env)
      if rebuilt!=env:raise ValueError('evidence reconstruction mismatch')
      return None
     raise AssertionError('unsupported operation')
    if c['expected']=='THROW_INTEGRITY':
     with self.assertRaises(ValueError):run()
    else:self.assertEqual(run(),env)
    self.assertEqual(c,before)
 def test5_typescript_schema_and_unicode_supplement(self):
  for c in json.loads((P/'ts-rail-execution-schema-amendment-expectations.json').read_text())['probes']:
   with self.subTest(name=c['name']):
    before=deepcopy(c)
    if c['operation']=='build':self.assertEqual(W.build_rail_inventory_comparisons(c['package']),c['expectedEnvelope'])
    elif c['operation']=='merge-throw':
     with self.assertRaises(ValueError):W.merge_rail_inventory_coverage(c['coverage'],c.get('envelope',BASE['expectedEnvelope']))
    else:self.assertEqual(W.merge_rail_inventory_coverage(c['coverage'],c.get('envelope',BASE['expectedEnvelope'])),c['expectedCoverage'])
    self.assertEqual(c,before)
class NativeBoundary(unittest.TestCase):
 def test_root_custom_dict_no_hooks(self):
  hits=[]
  class Trap(dict):
   def items(self):hits.append(1);raise AssertionError('trap')
   def __iter__(self):hits.append(1);raise AssertionError('trap')
   def __len__(self):hits.append(1);raise AssertionError('trap')
  native_assert(self,Trap(base()));self.assertEqual(hits,[])
 def test_nested_custom_dict_no_hooks(self):
  hits=[]
  class Trap(dict):
   def items(self):hits.append(1);raise AssertionError('trap')
  x=base();x['origins'][0]['textArtifact']=Trap({});native_assert(self,x);self.assertEqual(hits,[])
 def test_customlist_no_iteration(self):
  class Trap(list):
   def __iter__(self):raise AssertionError('trap')
   def __len__(self):raise AssertionError('trap')
  x=base();x['sources']=Trap();native_assert(self,x)
 def test_cycle(self):
  x=base();x['cycle']=x;native_assert(self,x)
 def test_nan(self):
  x=base();x['extra']=float('nan');native_assert(self,x)
 def test_infinity(self):
  x=base();x['extra']=float('inf');native_assert(self,x)
 def test_fractional(self):
  x=base();x['extra']=0.5;native_assert(self,x)
 def test_unsafeinteger(self):
  x=base();x['extra']=2**53;native_assert(self,x)
 def test_bool_numeric_snapshot(self):
  x=base();x['sources'][1]['review']['railInventoryScope']['claims'][0]['inventorySnapshot']['pageNumber']=True;native_assert(self,x)
 def test_surrogate(self):
  x=base();x['objectId']='\ud800';native_assert(self,x)
 def test_nonstringkey(self):
  x=base();x[1]=None;native_assert(self,x)
 def test_depth65(self):
  x=base();q=x
  for i in range(65):n={};q['extra']=n;q=n
  native_assert(self,x)
 def test_container32769(self):
  x=base();x['extra']=[None]*32769;native_assert(self,x)
 def test_string2000001(self):
  x=base();x['extra']='x'*2000001;native_assert(self,x)
 def test_UTF8keyvalue8000001(self):
  x=base();x['extra']='😀'*2000000;native_assert(self,x)
 def test_nodes200001(self):
  x=base();x['extra']=[{str(i):None for i in range(20000)}for _ in range(5)];native_assert(self,x)
 def test_derive_standalone_hostile(self):
  class Trap(list):
   def __iter__(self):raise AssertionError('trap')
  with self.assertRaises(ValueError):W.derive_rail_inventory_identities(Trap())
 def test_derive64_128caps(self):
  for sources in [[None]*65,[{'review':{'railInventoryScope':{'claims':[None]*17}}}]]:
   with self.assertRaises(ValueError):W.derive_rail_inventory_identities(sources)
 def test_packagecopy(self):
  x=base();before=deepcopy(x);a=W.validate_rail_inventory_loader_package(x);a['sources'][0]['review']['railInventoryScope']['claims'].clear();self.assertEqual(x,before)
 def test_envelopecopy(self):
  x=base();before=deepcopy(x);a=W.build_rail_inventory_comparisons(x);b=W.validate_rail_inventory_comparisons_envelope(a);b['results'][0]['comparison']['identity']['roomKey']='MUTATED';self.assertEqual(x,before);self.assertEqual(a,BASE['expectedEnvelope'])
 def test_coveragecopy(self):
  b=deepcopy(D['baseV6EffectiveCoverage']);e=deepcopy(BASE['expectedEnvelope']);old=deepcopy(b);ee=deepcopy(e);a=W.merge_rail_inventory_coverage(b,e);a[0]['reason']='MUTATED';self.assertEqual(b,old);self.assertEqual(e,ee)
 def test_identity_codepoint_order_and_detachment(self):
  s=deepcopy(base()['sources'][0]);claims=s['review']['railInventoryScope']['claims'];template=deepcopy(claims[0]);claims.clear()
  for i,key in enumerate(['😀','\ue000','A']):
   c=deepcopy(template);c['identity']['entityKey']=key;c['target']['inventoryContentHash']=str(i+1)*64;claims.append(c)
  result=W.derive_rail_inventory_identities([s]);self.assertEqual([i['entityKey']for i in result],['A','\ue000','😀']);result[0]['roomKey']='MUTATED';self.assertNotEqual(claims[2]['identity']['roomKey'],'MUTATED')
 def test_scalar_ruleid_collision(self):
  catalog=json.loads(W._RULES.read_text());next(e for e in catalog['entries']if e['atomicRules'])['atomicRules'][0]['ruleId']=W.RULE
  with tempfile.TemporaryDirectory()as d:
   q=Path(d)/'registry.json';q.write_text(json.dumps(catalog))
   with patch.object(W,'_RULES',q):
    with self.assertRaises(ValueError):W.validate_rail_inventory_capability_registry()
 def test_registry_copy_and_true_not_one(self):
  a=W.validate_rail_inventory_capability_registry();a['entries'][0]['enabled']=False;self.assertTrue(W.validate_rail_inventory_capability_registry()['entries'][0]['enabled']);r=deepcopy(D['capabilityRegistry']);r['entries'][0]['enabled']=1
  with self.assertRaises(ValueError):W.validate_rail_inventory_capability_registry(r)
 def test_pagebounds_loader_even_unbound(self):
  c=json.loads((P/'ts-rail-execution-boundary-clarification-probes.json').read_text())['fixtures'][2]
  self.assertEqual(c['input']['identities'],[])
  with self.assertRaises(ValueError):W.validate_rail_inventory_loader_package(c['input'])
 def test_pagebounds_loader_unknown_before_ambiguity(self):
  c=json.loads((P/'ts-rail-execution-boundary-clarification-probes.json').read_text())['fixtures'][3]
  with self.assertRaises(ValueError):W.validate_rail_inventory_loader_package(c['input'])
 def test_no_scalar_or_approval_authority_fields(self):
  out=W.build_rail_inventory_comparisons(base());self.assertIsNone(out['results'][0]['comparison']['calibratedProbability']);self.assertEqual(out['results'][0]['comparison']['status'],'CANDIDATE');self.assertFalse(set(out['results'][0])&{'physicalMissing','confidence','severity','expectedValue','actualValue','complete','coverage'})
if __name__=='__main__':unittest.main()
