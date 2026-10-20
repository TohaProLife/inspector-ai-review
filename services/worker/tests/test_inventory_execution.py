"""Independent staged wrapper tests; frozen manual oracle predates wrapper import."""
from pathlib import Path
from copy import deepcopy
import hashlib,importlib.util,json,unittest
P=Path(__file__).resolve().parents[3]/'fixtures/matrix-inventory-execution-v1'
ORACLE=P/'reviewed-wrapper-goldens.json'
assert hashlib.sha256(ORACLE.read_bytes()).hexdigest()=='29d5e9ee744235db3a5bb75d0e040a62d7e59c6b369549b5ce6704c8e64bf470'
F=json.loads(ORACLE.read_text());CAP=F['capabilityRegistry'];CASES=F['cases'];BASE=F['baseCoverage']
from inspector_worker import inventory_execution as w
def case(index=0):return deepcopy(CASES[index]['package'])
def env(index=0):return deepcopy(CASES[index]['expectedEnvelope'])
def reid(envelope):
 for row in envelope['results']:
  body={k:v for k,v in row.items()if k!='id'};row['id']=hashlib.sha256(json.dumps({'hashDomain':'matrix-inventory-execution-result-id-v1','objectId':envelope['objectId'],'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':body},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return envelope
class WrapperTests(unittest.TestCase):
 def test_all14_manual_envelopes_and132coverage(self):
  for c in CASES:
   with self.subTest(case=c['name']):
    before=deepcopy(c);actual=w.build_inventory_comparisons(c['package'],CAP)
    self.assertEqual(actual,c['expectedEnvelope']);self.assertEqual(w.merge_inventory_coverage(BASE,actual,CAP),c['expectedCoverage']);self.assertEqual(c,before)
 def test_all_sources_origins_permutations_stable(self):
  for c in CASES:
   x=deepcopy(c['package']);x['sources'].reverse();x['origins'].reverse()
   self.assertEqual(w.build_inventory_comparisons(x,CAP),c['expectedEnvelope'])
 def test_zero_identites_empty_committed_package_exactly_one_unbound(self):
  x=case();x.update(sources=[],origins=[],identities=[]);r=w.build_inventory_comparisons(x,CAP)
  self.assertEqual(len(r['results']),1);self.assertEqual(r['results'][0]['kind'],'UNBOUND_ATOM_ABSTENTION');self.assertNotIn('identity',r['results'][0]);self.assertNotIn('comparison',r['results'][0])
 def test_no_claim_filtering_unknown_or_competing(self):
  c=next(c for c in CASES if c['name']=='unknown-competitor-cannot-be-filtered');r=w.build_inventory_comparisons(c['package'],CAP)
  self.assertEqual(r['results'][0]['comparison']['reasonCode'],'AMBIGUOUS_INVENTORY_SCOPE')
 def test_multiple_physical_identities_each_enumerated(self):
  c=next(c for c in CASES if c['name']=='unrelated-identity-does-not-union-or-block');r=w.build_inventory_comparisons(c['package'],CAP)
  self.assertEqual(len(r['results']),2);self.assertEqual([a['comparison']['status']for a in r['results']],['CANDIDATE','ABSTAIN'])
 def test_unicode_codepoints_not_locale_or_utf16(self):
  c=CASES[-1];self.assertEqual([i['entityKey']for i in c['package']['identities']],['\ue000','\U00010000']);self.assertEqual(w.build_inventory_comparisons(c['package'],CAP),c['expectedEnvelope'])
 def test_missing_extra_duplicate_unsorted_declared_identity_reject(self):
  c=next(c for c in CASES if c['name']=='unrelated-identity-does-not-union-or-block')
  for identities in [[],c['package']['identities'][:1],c['package']['identities']*2,list(reversed(c['package']['identities']))]:
   with self.subTest(identities=identities):
    x=deepcopy(c['package']);x['identities']=identities
    with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_unknown_extra_loader_or_registry_keys_reject(self):
  for target in ['package','registry','entry']:
   x=case();cap=deepcopy(CAP)
   if target=='package':x['__proto__']={}
   elif target=='registry':cap['proposedFile']='invented'
   else:cap['entries'][0]['validation']='invented'
   with self.assertRaises(ValueError):w.build_inventory_comparisons(x,cap)
 def test_capability_catalog_mismatch_bool_number_disabled_and_overlap(self):
  operations=[('enabled',False),('enabled',1),('ruleId','other'),('matrixCode','M-052'),('partialGap','FULL'),('parameterCode','AR-052')]
  for k,v in operations:
   cap=deepcopy(CAP);cap['entries'][0][k]=v
   with self.subTest(k=k,v=v),self.assertRaises(ValueError):w.build_inventory_comparisons(case(),cap)
  cap=deepcopy(CAP);cap['entries']*=2
  with self.assertRaises(ValueError):w.build_inventory_comparisons(case(),cap)
 def test_source_origin_and_review_pointer_tamper_fail_not_abstain(self):
  for mode in ['source','origin','review','missingorigin','duporigin','dupsource']:
   x=case()
   if mode=='source':x['sources'][0]['sourceSha256']='0'*64
   if mode=='origin':x['origins'][0]['textStageContentHash']='0'*64
   if mode=='review':x['sources'][0]['reviewSnapshot']['contentHash']='0'*64
   if mode=='missingorigin':x['origins']=[]
   if mode=='duporigin':x['origins'].append(deepcopy(x['origins'][0]))
   if mode=='dupsource':x['sources'].append(deepcopy(x['sources'][0]))
   with self.subTest(mode=mode),self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_corrupt_unrelated_unknown_origin_never_hidden(self):
  x=deepcopy(next(c for c in CASES if c['name']=='unrelated-identity-does-not-union-or-block')['package'])
  x['sources'][-1]['review']['inventoryScope']['claims'][0]['assertion']='UNKNOWN'
  x['origins'][-1]['textArtifact']={}
  with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_corrupt_retained_unused_origin_fails_trusted_wrapper(self):
  x=case();o=deepcopy(x['origins'][0]);o['checkId']='unused';o['textArtifact']={};x['origins'].append(o)
  with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_recomputed_forged_inventory_hash_rejected(self):
  x=case();claim=x['sources'][0]['review']['inventoryScope']['claims'][0];claim['inventorySnapshot']['featureRows']=claim['inventorySnapshot']['featureRows'][1:]
  claim['target']['inventoryContentHash']=w._hash({'hashDomain':'matrix-inventory-source-id-v1','inventory':claim['inventorySnapshot']})
  with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_ineligible_consumer_stage_still_pure_abstention(self):
  c=next(c for c in CASES if c['name']=='mixed-stages-rd');r=w.build_inventory_comparisons(c['package'],CAP)
  self.assertEqual(r['results'][0]['comparison']['reasonCode'],'SOURCE_STAGE_UNVERIFIED')
 def test_duplicate_identical_claim_is_failure(self):
  x=case();claims=x['sources'][0]['review']['inventoryScope']['claims'];claims.append(deepcopy(claims[0]))
  with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_no_alias_output_or_coverage(self):
  x=case();before=deepcopy(x);r=w.build_inventory_comparisons(x,CAP);r['results'][0]['identity']['entityKey']='mutated';self.assertEqual(x,before)
  b=deepcopy(BASE);e=env();m=w.merge_inventory_coverage(b,e,CAP);m[0]['reason']='mutated';m[-1]['reason']='mutated';self.assertEqual(b,BASE);self.assertEqual(e,env())
 def test_all131_other_rows_byte_equal(self):
  base=deepcopy(BASE);base[0].update(successfulComparisons=3,abstentions=4,reason='原文 Сохранить\t🙂')
  m=w.merge_inventory_coverage(base,env(),CAP)
  for a,b in zip(base,m):
   if a['parameterCode']!='AR-053':self.assertEqual(json.dumps(a,ensure_ascii=False,separators=(',',':')),json.dumps(b,ensure_ascii=False,separators=(',',':')))
 def test_base132_order_exact_keys_safe_ints(self):
  for mode in ['missing','extra','reorder','duplicate','bool','negative','unsafe','field']:
   b=deepcopy(BASE)
   if mode=='missing':b.pop()
   if mode=='extra':b.append(deepcopy(b[-1]))
   if mode=='reorder':b[0],b[1]=b[1],b[0]
   if mode=='duplicate':b[1]=deepcopy(b[0])
   if mode=='bool':b[0]['failures']=True
   if mode=='negative':b[0]['failures']=-1
   if mode=='unsafe':b[0]['failures']=2**53
   if mode=='field':b[0]['qualified']=True
   with self.subTest(mode=mode),self.assertRaises(ValueError):w.merge_inventory_coverage(b,env(),CAP)
 def test_ar053_overlap_any_count_or_status_rejected(self):
  for k,v in [('implementedAtomicRules',1),('enabledAtomicRules',1),('evaluatedAtomicRules',1),('successfulComparisons',1),('abstentions',1),('failures',1),('executionStatus','PARTIAL')]:
   b=deepcopy(BASE);next(r for r in b if r['parameterCode']=='AR-053')[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):w.merge_inventory_coverage(b,env(),CAP)
 def test_coverage_success_only_candidate_other_all_abstentions(self):
  for c in CASES:
   r=w.merge_inventory_coverage(BASE,c['expectedEnvelope'],CAP);t=next(r for r in r if r['parameterCode']=='AR-053')
   self.assertEqual(t['executionStatus'],'PARTIAL');self.assertEqual(t['implementedAtomicRules'],1);self.assertEqual(t['enabledAtomicRules'],1);self.assertEqual(t['evaluatedAtomicRules'],1);self.assertEqual(t['failures'],0)
   self.assertEqual(t['successfulComparisons']+t['abstentions'],len(c['expectedEnvelope']['results']))
 def test_result_id_binds_manifest_object_and_complete_body(self):
  for key,value in [('inputManifestHash','0'*64),('objectId','other-object')]:
   e=env();e[key]=value
   with self.assertRaises(ValueError):w.merge_inventory_coverage(BASE,e,CAP)
  e=env();e['results'][0]['comparison']['reasonCode']='invented';reid(e)
  with self.assertRaises(ValueError):w.merge_inventory_coverage(BASE,e,CAP)
 def test_recomputed_id_does_not_authorize_extra_fields_probability_or_missing_identity(self):
  for mode in ['probability','extra','comparisonextra','missingidentity','unboundidentity','reasonlist']:
   e=env(12)if mode=='unboundidentity'else env();r=e['results'][0]
   if mode=='probability':r['comparison']['calibratedProbability']=1
   if mode=='extra':r['qualified']=True
   if mode=='comparisonextra':r['comparison']['confidence']=1
   if mode=='missingidentity':r.pop('identity')
   if mode=='unboundidentity':r['identity']=case()['identities'][0]
   if mode=='reasonlist':r['comparison']={'schemaVersion':'matrix-ar053-inventory-comparison-v1','status':'ABSTAIN','reasonCode':[],'calibratedProbability':None}
   reid(e)
   with self.subTest(mode=mode),self.assertRaises(ValueError):w.merge_inventory_coverage(BASE,e,CAP)
 def test_duplicate_or_reordered_envelope_scopes_reject(self):
  e=deepcopy(CASES[9]['expectedEnvelope']);self.assertEqual(len(e['results']),2)
  e['results'].reverse()
  with self.assertRaises(ValueError):w.merge_inventory_coverage(BASE,e,CAP)
  e=env();e['results']*=2
  with self.assertRaises(ValueError):w.merge_inventory_coverage(BASE,e,CAP)
 def test_native_hostile_no_getter_execution(self):
  class Hostile(dict):
   def __iter__(self):raise AssertionError('must not execute')
   def __getitem__(self,k):raise AssertionError('must not execute')
  for bad in [Hostile(),object(),float('nan'),1.0,2**53,{'x':'\ud800'}]:
   with self.subTest(type=type(bad).__name__),self.assertRaises(ValueError):w.build_inventory_comparisons(bad,CAP)
  cycle={};cycle['x']=cycle
  with self.assertRaises(ValueError):w.build_inventory_comparisons(cycle,CAP)
 def test_native_depth_string_bytes_nodes_and_container_limits(self):
  deep=None
  for _ in range(65):deep={'x':deep}
  for bad in [deep,{'huge':'x'*2000001},{'a':'x'*2000000,'b':'x'*2000000,'c':'x'*2000000,'d':'x'*2000000},{str(i):[None]*30000 for i in range(7)},[None]*32769]:
   with self.assertRaises(ValueError):w.build_inventory_comparisons(bad,CAP)
 def test_collection_limits_and_identities_in_native_budget(self):
  for key,n in [('sources',65),('origins',129),('identities',129)]:
   x=case();x[key]=[None]*n
   with self.subTest(key=key),self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
  x=case();x['sources'][0]['review']['inventoryScope']['claims']*=17
  with self.assertRaises(ValueError):w.build_inventory_comparisons(x,CAP)
 def test_complete128_identities_boundary_no_truncation(self):
  original=json.loads(Path('services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json').read_text())['fixtures']
  x=case();x.update(sources=[],origins=[],identities=[])
  for index,f in enumerate(original[:8]):
   source=deepcopy(case()['sources'][0]);source.update(sourceFileId=f['input']['sourceFileId'],sourceSha256=f['input']['sourceSha256'],stages=[f['input']['stage']]);source['review'].update(sourceFileId=source['sourceFileId'],sourceSha256=source['sourceSha256'])
   claims=[];origin=deepcopy(case()['origins'][0]);origin.update(checkId='origin-'+str(index),sourceFileId=source['sourceFileId'],sourceSha256=source['sourceSha256'],textArtifact=f['input']['textArtifact'],textArtifactHash=f['expected']['inventory']['textArtifactHash'])
   for j in range(16):
    claim=deepcopy(case()['sources'][0]['review']['inventoryScope']['claims'][0]);claim.update(entityKey='identity-'+str(index)+'-'+str(j),inventorySnapshot=deepcopy(f['expected']['inventory']),selection=deepcopy(f['input']['selection']));claim['target'].update(checkId=origin['checkId'],textArtifactHash=origin['textArtifactHash'],inventoryContentHash=f['expectedInventoryContentHash']);claims.append(claim)
    x['identities'].append({k:claim[k]for k in w._IDENTITY_KEYS})
   source['review']['inventoryScope']['claims']=claims;x['sources'].append(source);x['origins'].append(origin)
  x['identities'].sort(key=lambda i:json.dumps(i,ensure_ascii=False,sort_keys=True,separators=(',',':')))
  r=w.build_inventory_comparisons(x,CAP);self.assertEqual(len(r['results']),128);self.assertTrue(all(row['comparison']['reasonCode']=='MATCHED_INVENTORY_PAIR_UNVERIFIED'for row in r['results']))
 def test_all32_cross_review_adversarial_expectations(self):
  vectors=json.loads((P/'research-wrapper-adversarial-vectors.json').read_text())['vectors']
  self.assertEqual(len(vectors),32)
  for v in vectors:
   with self.subTest(case=v['name']):
    def run():
     if v['operation']=='build':return w.build_inventory_comparisons(v['package'],CAP)
     return w.merge_inventory_coverage(v['baseCoverage'],v['envelope'],CAP)
    if v['expected']=='REJECT':
     with self.assertRaises(ValueError):run()
    else:
     result=run();self.assertEqual(result[0],v['baseCoverage'][0])
 def test_scalar_catalog_namespace_collision_rejects_without_engine_call(self):
  from unittest.mock import patch
  registry=json.loads(Path('services/worker/rules/matrix-execution-v1.json').read_text())
  registry['entries'][0]['atomicRules'].append({'ruleId':w.pure.RULE_ID})
  with patch.object(Path,'read_text',return_value=json.dumps(registry)):
   with self.assertRaisesRegex(ValueError,'collides with scalar namespace'):w.merge_inventory_coverage(BASE,env(),CAP)
 def test_overlay_aggregate_counts_derived_without_scalar_mutation(self):
  merged=w.merge_inventory_coverage(BASE,env(),CAP)
  before=(sum(r['implementedAtomicRules']>0 for r in BASE),sum(r['enabledAtomicRules']for r in BASE),sum(r['executionStatus']=='UNSUPPORTED'for r in BASE))
  after=(sum(r['implementedAtomicRules']>0 for r in merged),sum(r['enabledAtomicRules']for r in merged),sum(r['executionStatus']=='UNSUPPORTED'for r in merged))
  self.assertEqual(before,(55,63,77));self.assertEqual(after,(56,64,76));self.assertEqual(sum(r['failures']for r in merged),0)
if __name__=='__main__':unittest.main(verbosity=2)
