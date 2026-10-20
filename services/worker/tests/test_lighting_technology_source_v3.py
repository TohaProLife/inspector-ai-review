"""Independent whole source manual, not v2 coercion or consumer-derived oracle."""
import copy,json,hashlib,unittest
from pathlib import Path
from inspector_worker.lighting_technology_source_v3 import reconstruct_lighting_technology_source_v3,lighting_technology_v3_declaration_content_hash
R=Path(__file__).resolve().parents[3];F=R/'fixtures/matrix-lighting-technology-source-v3-v1'
def load(n,digest):
 p=F/n;assert hashlib.sha256(p.read_bytes()).hexdigest()==digest;return json.loads(p.read_text())
C=load('qa-whole-manual-goldens.json','8e4c79db22f8b97864129a6b1d55868c277821cc3c1b776074364d39e6342feb')['cases']
V=load('qa-portable-boundary-goldens.json','dbda36639a3d5a2f7a4037aade04ff4e179a349724ebc85d617249dae4ccceb3')['cases']
RES='matrix-zu130-lighting-technology-source-v3-result-v1'
class LightingTechnologySourceV3Tests(unittest.TestCase):
 def test_thirteen_original_backed_whole_outputs_hashes_and_immutability(self):
  self.assertEqual(len(C),13)
  for c in C:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);out=reconstruct_lighting_technology_source_v3(x);self.assertEqual(out,c['expected']);self.assertEqual(x,before)
    if out['status']=='RECONSTRUCTED':self.assertEqual(lighting_technology_v3_declaration_content_hash(out['declaration']),c['expectedDeclarationContentHash'])
 def test_seventeen_manual_full_native_profile_range_unlocated_boundaries(self):
  self.assertEqual(len(V),17)
  for c in V:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(reconstruct_lighting_technology_source_v3(x),c['expected']);self.assertEqual(x,before)
 def test_native_exact_builtins_before_callbacks(self):
  calls=[]
  class Hostile(dict):
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
   def items(self):calls.append('items');raise AssertionError('callback')
  cycle={};cycle['self']=cycle
  cases=[(Hostile(C[0]['input']),'INVALID_INPUT'),(cycle,'INVALID_INPUT'),({'float':0.5},'INVALID_INPUT'),({'surrogate':'\ud800'},'INVALID_INPUT'),({'oversize':[None]*32769},'INPUT_LIMIT')]
  for value,reason in cases:self.assertEqual(reconstruct_lighting_technology_source_v3(value),{'schemaVersion':RES,'status':'ABSTAIN','reasonCode':reason})
  self.assertEqual(calls,[])
 def test_hash_helper_rejects_exact_DTO_range_and_authority_forgeries(self):
  valid=C[0]['expected']['declaration'];bad=[]
  for k,v in [('extra',None),('calibratedProbability',0.99),('pageWidthMilliPoints',0),('authorityStatus','APPROVED')]:d=copy.deepcopy(valid);d[k]=v;bad.append(d)
  d=copy.deepcopy(valid);d['primaryFragments'][0]['usedTextRange']['end']=len(d['primaryFragments'][0]['rawText'])+1;bad.append(d)
  d=copy.deepcopy(valid);d['primaryFragments'][0]['usedTextRange']['start']=True;bad.append(d)
  for d in bad:
   before=copy.deepcopy(d)
   with self.assertRaises(ValueError):lighting_technology_v3_declaration_content_hash(d)
   self.assertEqual(d,before)
 def test_real_full38_original_ranges_unbound_unverified_and_null(self):
  c=C[-1];self.assertEqual(c['input']['textArtifact']['pageCount'],38);out=reconstruct_lighting_technology_source_v3(copy.deepcopy(c['input']));self.assertEqual(out,c['expected']);d=out['declaration'];self.assertEqual(d['textArtifactHash'],'4af1b87c575376089edd997387a8737e4c1178bf216241559616a01e26e215ba');self.assertEqual([x['usedTextRange'] for x in d['primaryFragments']],[{'start':1,'end':83},{'start':0,'end':51}]);self.assertEqual(d['scopeStatus'],'UNBOUND_GROUP_DECLARATION');self.assertIsNone(d['positionLabel']);self.assertIsNone(d['calibratedProbability']);self.assertEqual(d['renderedVisibility'],'UNVERIFIED')
 def test_output_is_detached_and_cannot_mutate_source_or_next_result(self):
  x=copy.deepcopy(C[0]['input']);before=copy.deepcopy(x);out=reconstruct_lighting_technology_source_v3(x);out['declaration']['primaryFragments'][0]['sourcePath'][0]=999;out['declaration']['nativeFrame']['visibleBoxPointStrings'][0]='999';self.assertEqual(x,before);self.assertEqual(reconstruct_lighting_technology_source_v3(x),C[0]['expected'])
