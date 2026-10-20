"""Independent manual typed lighting execution oracle, frozen before consumer."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.lighting_technology_execution import (
 derive_lighting_technology_identities,validate_lighting_technology_loader_package,
 build_lighting_technology_comparisons,validate_lighting_technology_comparisons,
 lighting_technology_comparison_evidence,merge_lighting_technology_coverage,
 LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY,LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY_HASH)
P=Path(__file__).resolve().parents[3]/'fixtures/matrix-lighting-technology-execution-v1/qa-manual-execution-goldens.json'
assert hashlib.sha256(P.read_bytes()).hexdigest()=='264c3ed29f73f03a65e2e286b85ce6a6e91f8b4b76e42e019b6930fa6b85390e'
M=json.loads(P.read_text())
class LightingTechnologyExecutionTests(unittest.TestCase):
 def test_six_manual_whole_bundles_and_complete_coverage(self):
  self.assertEqual(len(M['validCases']),6)
  for c in M['validCases']:
   with self.subTest(name=c['name']):
    p=copy.deepcopy(c['package']);before=copy.deepcopy(p);e=build_lighting_technology_comparisons(p);self.assertEqual(e,c['expected']['envelope']);self.assertEqual(lighting_technology_comparison_evidence(p,e),c['expected']['evidence']);self.assertEqual(merge_lighting_technology_coverage(c['baseCoverage'],e),c['expected']['coverage']);self.assertEqual(p,before)
 def test_eight_integrity_failures_are_not_operational_abstentions(self):
  self.assertEqual(len(M['integrityErrors']),8)
  for c in M['integrityErrors']:
   with self.subTest(name=c['name']),self.assertRaises(ValueError):
    if c['operation']=='build':build_lighting_technology_comparisons(c['package'])
    elif c['operation']=='validate':validate_lighting_technology_comparisons(c['envelope'])
    elif c['operation']=='evidence':lighting_technology_comparison_evidence(c['package'],c['envelope'])
    elif c['operation']=='merge':merge_lighting_technology_coverage(c['baseCoverage'],c['envelope'])
    else:self.fail('unknown manual operation')
 def test_all_claim_identities_sorted_and_validators_detach(self):
  for c in M['validCases']:
   self.assertEqual(derive_lighting_technology_identities(c['package']['sources']),c['package']['identities']);self.assertEqual(validate_lighting_technology_loader_package(c['package']),c['package']);self.assertEqual(validate_lighting_technology_comparisons(c['expected']['envelope']),c['expected']['envelope'])
  p=copy.deepcopy(M['validCases'][0]['package']);out=validate_lighting_technology_loader_package(p);out['sources'][0]['review']['actorId']='changed';self.assertEqual(p,M['validCases'][0]['package'])
 def test_invalid_native_and_resource_inputs_throw(self):
  cycle={};cycle['self']=cycle
  for x in [cycle,{'value':0.5},{'value':'\ud800'},{'large':[None]*32769}]:
   with self.assertRaises(ValueError):build_lighting_technology_comparisons(x)
 def test_hostile_native_callbacks_zero(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
  with self.assertRaises(ValueError):build_lighting_technology_comparisons(Hostile(M['validCases'][0]['package']))
  with self.assertRaises(ValueError):derive_lighting_technology_identities([Hostile()])
  self.assertEqual(calls,[])
 def test_registry_pin_and_result_evidence_detachment(self):
  self.assertEqual(LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY_HASH,M['capabilityRegistryHash']);p=copy.deepcopy(M['validCases'][0]['package']);expected=M['validCases'][0]['expected'];e=build_lighting_technology_comparisons(p);e['results'][0]['identity']['entityKey']='changed';self.assertEqual(build_lighting_technology_comparisons(p),expected['envelope']);e=build_lighting_technology_comparisons(p);evidence=lighting_technology_comparison_evidence(p,e);evidence[0]['fragment']['rawText']='changed';self.assertEqual(lighting_technology_comparison_evidence(p,e),expected['evidence'])
  bad=copy.deepcopy(M['capabilityRegistry']);bad['entries'][0]['enabled']=False
  with self.assertRaises(ValueError):build_lighting_technology_comparisons(p,bad)
  original=copy.deepcopy(LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY)
  try:
   LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY['entries'][0]['enabled']=False
   self.assertEqual(build_lighting_technology_comparisons(p),expected['envelope'])
  finally:
   LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY.clear();LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY.update(original)
