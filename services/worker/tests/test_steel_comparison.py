"""Independent pre-code source/manual steel comparison oracle. No comparator-derived expectation."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.steel_comparison import compare_kr056_steel_declarations,validate_steel_comparison_scope_request,project_steel_comparison_scope_decision
ROOT=Path(__file__).resolve().parents[3]
def load(name,pin):
 b=(ROOT/'fixtures/matrix-steel-comparison-v1'/name).read_bytes();assert hashlib.sha256(b).hexdigest()==pin;return json.loads(b)
C=load('qa-manual-whole-goldens.json','ce67d3f673f286d3432903f1382db1ae46c64f0254ae0e933db2fd0b63157f4c')['cases']
H=load('qa-review-projection-manual-goldens.json','7ab47b66eef119eca587006820194f0a47eb44dbbe4710bc7ab7e49247fd3488')['cases']
def named(n):return copy.deepcopy(next(c for c in C if c['name']==n))
def reject(reason):return {'schemaVersion':'matrix-kr056-steel-comparison-v1','status':'ABSTAIN','reasonCode':reason,'identity':None,'comparison':None,'calibratedProbability':None}
class SteelComparisonTests(unittest.TestCase):
 def assertRejected(self,x,reason):
  a=compare_kr056_steel_declarations(x);self.assertEqual((a['status'],a['reasonCode'],a['comparison'],a['calibratedProbability']),('ABSTAIN',reason,None,None))
 def test_23_complete_manual_results_and_full_input_immutability(self):
  self.assertEqual(len(C),23)
  for c in C:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_kr056_steel_declarations(x),c['expected']);self.assertEqual(x,before)
 def test_2_whole_request_projections_without_snapshot_or_alias(self):
  self.assertEqual(len(H),2)
  for c in H:
   x=copy.deepcopy(c['decision']);before=copy.deepcopy(x);a=project_steel_comparison_scope_decision(x);self.assertEqual(a,c['expectedRequest']);self.assertEqual(validate_steel_comparison_scope_request(c['expectedRequest']),c['expectedRequest']);self.assertEqual(x,before)
   for claim in a['claims']:self.assertNotIn('declarationSnapshot',claim)
   if a['claims']:a['claims'][0]['memberMapping']['scopeFragments'][0]['rawText']='changed';self.assertEqual(x,before)
 def test_native_cycle_float_surrogate_bool_and_custom_callbacks(self):
  cycle={};cycle['x']=cycle;calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
  for x in [cycle,{'n':.5},{'n':float('nan')},{'s':'\ud800'},Hostile(),{'n':9007199254740992}]:self.assertEqual(compare_kr056_steel_declarations(x),reject('INVALID_INPUT'))
  self.assertEqual(calls,[]);x=named('synthetic-directed-C345-C245')['input'];x['sources'][0]['review']['steelComparisonScope']['claims'][0]['declarationSnapshot']['pageNumber']=True;self.assertRejected(x,'INVALID_INPUT')
 def test_depth_node_container_collection_and_encoded_key_byte_limits(self):
  depth=None
  for _ in range(64):depth=[depth]
  self.assertRejected(depth,'INVALID_INPUT');self.assertRejected([depth],'INPUT_LIMIT');self.assertRejected({'x':[None]*32769},'INPUT_LIMIT');self.assertRejected([[None]*25000 for _ in range(8)],'INPUT_LIMIT');self.assertRejected({'k'*1600001+str(i):None for i in range(5)},'INPUT_LIMIT')
  for key,n in [('sources',65),('origins',129),('applicabilityDecisions',17)]:
   x=named('synthetic-directed-C345-C245')['input'];x[key]=[copy.deepcopy(x[key][0])for _ in range(n)];self.assertRejected(x,'INPUT_LIMIT')
 def test_retained_full_origin_and_all_claim_before_operational_state(self):
  x=named('unrelated-origin-corrupt-box')['input']
  for s in x['sources']:
   if s['review']:s['review']['steelComparisonScope']={'schemaVersion':'matrix-kr056-steel-review-v1','claims':[]}
  x['applicabilityDecisions']=[];self.assertRejected(x,'SOURCE_PROVENANCE_UNVERIFIED')
  x=named('rehashed-forged-declaration')['input'];x['sources'][0]['stages']=['UNRESOLVED'];self.assertRejected(x,'DECLARATION_RECONSTRUCTION_UNVERIFIED')
 def test_original_current_stage_and_unequal_standards_never_authority(self):
  x=named('synthetic-directed-C345-C245')['input'];x['sources'][1]['stages']=['PD'];self.assertRejected(x,'SOURCE_STAGE_UNVERIFIED')
  equal=named('synthetic-reviewed-equal-C245');self.assertEqual(compare_kr056_steel_declarations(equal['input']),equal['expected']);a=compare_kr056_steel_declarations(named('synthetic-directed-C345-C245')['input']);self.assertIsNotNone(a['identity']);self.assertIsNone(a['calibratedProbability']);self.assertNotEqual(a['comparison']['expected']['productScope']['gradeStandard'],a['comparison']['actual']['productScope']['gradeStandard'])
 def test_candidate_result_is_detached(self):
  c=named('synthetic-directed-C345-C245');before=copy.deepcopy(c['input']);a=compare_kr056_steel_declarations(c['input']);a['identity']['entityKey']='changed';a['comparison']['expected']['productScope']['gradeStandard']='changed';a['comparison']['actual']['target']['declarationId']='f'*64;self.assertEqual(c['input'],before);self.assertEqual(compare_kr056_steel_declarations(c['input']),c['expected'])
 def test_canonical_candidate_identity_reference_is_nonnullable(self):
  path=ROOT/'packages/contracts/src/matrix-steel-comparison.schema.json';schema=json.loads(path.read_text());self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),'cb3a8f8041a3b808c7c7e4fb26f6d8d4b0c6cdd23b8515cfa065dbdd508e6f11');candidate=schema['definitions']['result']['oneOf'][0];self.assertEqual(candidate['properties']['status'],{'const':'CANDIDATE'});self.assertIn('identity',candidate['required']);self.assertEqual(candidate['properties']['identity'],{'$ref':'#/definitions/identity'});self.assertEqual(schema['definitions']['identity']['type'],'object');self.assertIsNotNone(named('synthetic-directed-C345-C245')['expected']['identity'])

 def test_additive_helpers_null_boundary_without_callbacks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
   def __iter__(self):calls.append('iter');raise AssertionError('callback')
  for f in [validate_steel_comparison_scope_request,project_steel_comparison_scope_decision]:
   for x in [Hostile(),None,{'schemaVersion':'wrong','claims':[]},{'n':.5}]:self.assertIsNone(f(x))
  self.assertEqual(calls,[]);h=copy.deepcopy(H[0]);h['expectedRequest']['claims'].append(copy.deepcopy(h['expectedRequest']['claims'][0]));self.assertIsNone(validate_steel_comparison_scope_request(h['expectedRequest']));h['decision']['claims'].append(copy.deepcopy(h['decision']['claims'][0]));self.assertIsNone(project_steel_comparison_scope_decision(h['decision']));bad=copy.deepcopy(H[0]['decision']);bad['claims'][0]['target']['declarationId']='f'*64;self.assertIsNone(project_steel_comparison_scope_decision(bad))

 def test_five_frozen_retained_integrity_regressions(self):
  def hash_(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  def rehash(d):d['contentHash']=hash_({'hashDomain':'matrix-kr056-steel-applicability-decision-json-v1','decision':{k:v for k,v in d.items()if k!='contentHash'}})
  x=named('synthetic-directed-C345-C245')['input'];d=copy.deepcopy(x['sources'][0]['review']['steelComparisonScope']['claims'][0]);d['identity']['entityKey']='other-unselected-member';d['memberMapping']['identity']=copy.deepcopy(d['identity']);x['sources'][0]['review']['steelComparisonScope']['claims'].append(d);self.assertRejected(x,'DUPLICATE_DECLARATION')
  x=named('synthetic-directed-C345-C245')['input'];s=copy.deepcopy(x['sources'][0]);o=copy.deepcopy(x['origins'][0]);s['sourceFileId']='SYNTHETIC-RETAINED-UNSELECTED';s['review']['decisionId']='SR-RETAINED-UNSELECTED';s['review']['steelComparisonScope']['claims']=[];o['sourceFileId']=s['sourceFileId'];o['textArtifact']['sourceFileId']=s['sourceFileId'];o['artifactContentSha256']=hash_(o['textArtifact']);o['target']['textStageContentHash']=o['artifactContentSha256'];o['target']['textArtifactHash']=hash_({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':o['textArtifact']});s['review']['pageStages']={str(o['textArtifact']['pageCount']+1):'PD'};x['sources'].append(s);x['origins'].append(o);self.assertRejected(x,'SOURCE_PROVENANCE_UNVERIFIED')
  x=named('synthetic-directed-C345-C245')['input'];x['origins'][0]['pageStages']={str(x['origins'][0]['textArtifact']['pageCount']+1):'PD'};self.assertRejected(x,'SOURCE_PROVENANCE_UNVERIFIED')
  x=named('synthetic-directed-C345-C245')['input'];d=copy.deepcopy(x['applicabilityDecisions'][0]);d['decisionId']='PAIR-UNKNOWN-SWAPPED-ROLES';d['status']='UNKNOWN';d['expected'],d['actual']=d['actual'],d['expected'];d['basis']['expectedScopeFragments'],d['basis']['actualScopeFragments']=d['basis']['actualScopeFragments'],d['basis']['expectedScopeFragments'];rehash(d);x['applicabilityDecisions'].append(d);self.assertRejected(x,'APPLICABILITY_DECISION_UNVERIFIED')
  x=named('synthetic-directed-C345-C245')['input'];old=x['origins'][0]['target']['textStageContentHash'];x['origins'][0]['target']['textStageContentHash']='f'*64
  for s in x['sources']:
   for c in (s['review'] or {}).get('steelComparisonScope',{}).get('claims',[]):
    if c['target']['textStageContentHash']==old:c['target']['textStageContentHash']='f'*64
  for d in x['applicabilityDecisions']:
   for role in ['expected','actual']:
    if d[role]['target']['textStageContentHash']==old:d[role]['target']['textStageContentHash']='f'*64
   rehash(d)
  self.assertRejected(x,'SOURCE_PROVENANCE_UNVERIFIED')

 def test_other_original_page_single_line_fallback_and_native_ascii_keys(self):
  def hash_(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  def rehash(d):d['contentHash']=hash_({'hashDomain':'matrix-kr056-steel-applicability-decision-json-v1','decision':{k:v for k,v in d.items()if k!='contentHash'}})
  def otherpage():
   c=named('synthetic-directed-C345-C245');x=c['input'];s=x['sources'][0];claim=s['review']['steelComparisonScope']['claims'][0];o=next(o for o in x['origins']if o['sourceFileId']==s['sourceFileId']);f=None
   for page in o['textArtifact']['pages']:
    if page['pageNumber']==claim['declarationSnapshot']['pageNumber']:continue
    for bi,b in enumerate(page['blocks']):
     raw=b['text'].split('\n')
     for li,box in enumerate(b.get('lineBboxesMilliPoints',[])):
      if raw[li].strip():f={'pageNumber':page['pageNumber'],'blockIndex':bi,'lineIndex':li,'rawText':raw[li],'bboxMilliPoints':box};break
     if f:break
    if f:break
   self.assertIsNotNone(f);claim['memberMapping']['scopeFragments']=[copy.deepcopy(f)];d=x['applicabilityDecisions'][0];d['basis']['expectedScopeFragments']=[copy.deepcopy(f)];rehash(d);c['expected']['comparison']['applicabilityDecisionContentHash']=d['contentHash'];return c,claim,o,f,d
  c,claim,o,f,d=otherpage();before=copy.deepcopy(c['input']);self.assertEqual(compare_kr056_steel_declarations(c['input']),c['expected']);self.assertEqual(c['input'],before)
  c,claim,o,f,d=otherpage();page=next(p for p in o['textArtifact']['pages']if p['pageNumber']==f['pageNumber']);b=page['blocks'][f['blockIndex']];self.assertNotIn('\n',b['text']);self.assertEqual(len(b['lineBboxesMilliPoints']),1);self.assertEqual(b['bboxMilliPoints'],f['bboxMilliPoints']);del b['lineBboxesMilliPoints'];o['artifactContentSha256']=hash_(o['textArtifact']);o['target']['textStageContentHash']=o['artifactContentSha256'];o['target']['textArtifactHash']=hash_({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':o['textArtifact']});claim['target'].update(o['target']);snap=claim['declarationSnapshot'];snap['textArtifactHash']=o['target']['textArtifactHash'];snap['id']=hash_({'hashDomain':'matrix-source-declaration-id-v1','declaration':{k:v for k,v in snap.items()if k!='id'}});claim['target']['declarationId']=snap['id'];d['expected']['target']=copy.deepcopy(claim['target']);rehash(d);c['expected']['comparison']['expected']['target']=copy.deepcopy(claim['target']);c['expected']['comparison']['applicabilityDecisionContentHash']=d['contentHash'];before=copy.deepcopy(c['input']);self.assertEqual(compare_kr056_steel_declarations(c['input']),c['expected']);self.assertEqual(c['input'],before)
  x=named('synthetic-directed-C345-C245')['input'];x['лишнее']=None;self.assertEqual(compare_kr056_steel_declarations(x),reject('INVALID_INPUT'))
