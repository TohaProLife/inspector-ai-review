"""Independent fixed whole-output oracle; no producer/comparator as expected-value oracle."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.steel_execution import derive_steel_comparison_identities,validate_steel_comparison_loader_package,build_steel_comparisons,validate_steel_comparisons,steel_comparison_evidence,merge_steel_comparison_coverage,STEEL_COMPARISON_CAPABILITY_REGISTRY,STEEL_COMPARISON_CAPABILITY_REGISTRY_HASH
ROOT=Path(__file__).resolve().parents[3]
_b=(ROOT/'fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json').read_bytes()
assert hashlib.sha256(_b).hexdigest()=='4a5dfdb7fb40eb95f619d88eace539e46224cdc3caea90fab0ef2e348d123a94'
M=json.loads(_b);V=M['validCases'];E=M['integrityErrors']
def positive():return copy.deepcopy(next(c for c in V if c['name']=='authored-original-directed-positive'))
def operation(c):
 op=c['operation']
 if op=='build':return build_steel_comparisons(c['package'],c['registry']) if 'registry' in c else build_steel_comparisons(c['package'])
 if op=='validate':return validate_steel_comparisons(c['envelope'])
 if op=='evidence':return steel_comparison_evidence(c['package'],c['envelope'])
 if op=='merge':return merge_steel_comparison_coverage(c['coverage'],c['envelope'])
 raise AssertionError('unknown manual operation')
class SteelExecutionTests(unittest.TestCase):
 def test_nine_whole_packages_identities_envelopes_evidence_coverage(self):
  self.assertEqual(len(V),9)
  for c in V:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c);before=copy.deepcopy(x);e=c['expected'];self.assertEqual(derive_steel_comparison_identities(x['package']['sources']),e['identities']);self.assertEqual(validate_steel_comparison_loader_package(x['package']),e['loaderPackage']);envelope=build_steel_comparisons(x['package']);self.assertEqual(envelope,e['envelope']);self.assertEqual(validate_steel_comparisons(envelope),e['envelope']);self.assertEqual(steel_comparison_evidence(x['package'],envelope),e['evidence']);self.assertEqual(merge_steel_comparison_coverage(x['baseCoverage'],envelope),e['coverage']);self.assertEqual(x,before)
  c=positive();self.assertEqual(len(c['expected']['evidence']),13);self.assertIsNone(c['expected']['envelope']['results'][0]['comparison']['calibratedProbability'])
 def test_twelve_whole_integrity_faults_including_masked_stage_forgery(self):
  self.assertEqual(len(E),12)
  for c in E:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c);before=copy.deepcopy(x)
    with self.assertRaises(Exception):operation(x)
    self.assertEqual(x,before)
 def test_canonical_identity_order_independent_source_order_no_caller_filter(self):
  for c in V:
   x=copy.deepcopy(c['package']);x['sources'].reverse();x['origins'].reverse();x['applicabilityDecisions'].reverse();self.assertEqual(derive_steel_comparison_identities(x['sources']),c['expected']['identities']);self.assertEqual(build_steel_comparisons(x),c['expected']['envelope'])
  c=positive();c['package']['identities']=[]
  with self.assertRaises(Exception):validate_steel_comparison_loader_package(c['package'])
 def test_all_six_exports_return_detached_data(self):
  c=positive();before=copy.deepcopy(c);ids=derive_steel_comparison_identities(c['package']['sources']);ids[0]['memberKey']='changed';self.assertEqual(c,before);pkg=validate_steel_comparison_loader_package(c['package']);pkg['sources'][0]['review']['steelComparisonScope']['claims'][0]['declarationSnapshot']['primaryFragments'][0]['rawText']='changed';self.assertEqual(c,before);env=build_steel_comparisons(c['package']);env['results'][0]['comparison']['comparison']['expected']['productScope']['gradeStandard']='changed';self.assertEqual(c,before);checked=validate_steel_comparisons(c['expected']['envelope']);checked['results'][0]['identity']['memberKey']='changed';self.assertEqual(c,before);evidence=steel_comparison_evidence(c['package'],c['expected']['envelope']);evidence[0]['fragment']['bboxMilliPoints'][0]=1;evidence[0]['target']['checkId']='changed';self.assertEqual(c,before);coverage=merge_steel_comparison_coverage(c['baseCoverage'],c['expected']['envelope']);coverage[0]['reason']='changed';self.assertEqual(c,before);self.assertEqual(build_steel_comparisons(c['package']),c['expected']['envelope'])
 def test_native_invalid_without_callbacks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
  cycle={};cycle['self']=cycle;envelope=positive()['expected']['envelope'];funcs=[derive_steel_comparison_identities,validate_steel_comparison_loader_package,build_steel_comparisons,validate_steel_comparisons,lambda x:steel_comparison_evidence(x,envelope),lambda x:merge_steel_comparison_coverage(x,envelope)]
  for f in funcs:
   for x in [Hostile(),cycle,{'n':.5},{'s':'\ud800'},{'n':9007199254740992},{'s':'x'*2000001}]:
    with self.assertRaises(Exception):f(x)
  self.assertEqual(calls,[]);c=positive();c['package']['лишнее']=None
  with self.assertRaises(Exception):build_steel_comparisons(c['package'])
 def test_private_registry_and_131_unrelated_coverage_rows_preserved(self):
  c=positive();self.assertEqual(STEEL_COMPARISON_CAPABILITY_REGISTRY_HASH,M['capabilityRegistryHash']);self.assertEqual(STEEL_COMPARISON_CAPABILITY_REGISTRY,M['capabilityRegistry'])
  previous=STEEL_COMPARISON_CAPABILITY_REGISTRY['entries'][0]['enabled']
  try:
   try:STEEL_COMPARISON_CAPABILITY_REGISTRY['entries'][0]['enabled']=False
   except TypeError:pass
   self.assertEqual(build_steel_comparisons(c['package']),c['expected']['envelope'])
  finally:
   try:STEEL_COMPARISON_CAPABILITY_REGISTRY['entries'][0]['enabled']=previous
   except TypeError:pass
  bad=copy.deepcopy(M['capabilityRegistry']);bad['entries'][0]['ruleVersion']='changed'
  with self.assertRaises(Exception):build_steel_comparisons(c['package'],bad)
  result=merge_steel_comparison_coverage(c['baseCoverage'],c['expected']['envelope']);self.assertEqual([r for r in result if r['parameterCode']!='KR-056'],[r for r in c['baseCoverage']if r['parameterCode']!='KR-056']);self.assertEqual(next(r for r in result if r['parameterCode']=='KR-056'),next(r for r in c['expected']['coverage']if r['parameterCode']=='KR-056'));u=next(c for c in V if c['expected']['envelope']['results'][0]['kind']=='UNBOUND_ATOM_ABSTENTION');self.assertEqual(u['expected']['evidence'],[])

 def test_explicit_null_registry_is_rejected_but_omission_uses_default(self):
  c=positive();before=copy.deepcopy(c)
  with self.assertRaises(Exception):build_steel_comparisons(c['package'],None)
  with self.assertRaises(Exception):steel_comparison_evidence(c['package'],c['expected']['envelope'],None)
  with self.assertRaises(Exception):merge_steel_comparison_coverage(c['baseCoverage'],c['expected']['envelope'],None)
  self.assertEqual(build_steel_comparisons(c['package']),c['expected']['envelope']);self.assertEqual(c,before)
