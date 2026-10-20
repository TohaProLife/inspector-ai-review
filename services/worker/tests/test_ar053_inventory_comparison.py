"""Staged independent comparator tests; fixtures are hypothetical loader projections."""
from pathlib import Path
from copy import deepcopy
import hashlib
import json
import math
import unittest

BASE=Path(__file__).resolve().parent/'fixtures'/'matrix-ar053-inventory-v1'
from inspector_worker import ar053_inventory_comparison as comparison
compare=comparison.compare_ar053_inventories
CASES=json.loads((BASE/'paired-fixtures.json').read_text())['cases']
POSITIVE=deepcopy(CASES[0]['input'])


def claim(x,i=1):return x['sources'][i]['review']['inventoryScope']['claims'][0]
def review(x,i=1):return x['sources'][i]['review']
def sha(x):return hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def set_identity(x,key,value):
 x['identity'][key]=value
 for s in x['sources']:
  if s['review'] is not None and s['review']['inventoryScope']:
   for c in s['review']['inventoryScope']['claims']:c[key]=value

class ComparisonTests(unittest.TestCase):
 def assert_reason(self,value,reason):
  self.assertEqual(compare(value),{'schemaVersion':comparison.RESULT_VERSION,'status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None})
 def test_all60_authored_expected_full_results(self):
  self.assertEqual(len(CASES),60)
  for c in CASES:
   with self.subTest(case=c['name']):
    before=deepcopy(c['input']);actual=compare(c['input'])
    self.assertEqual(actual,c['expected']);self.assertEqual(c['input'],before)
 def test_candidate_only_null_probability_and_exact_output_keys(self):
  r=compare(deepcopy(POSITIVE));self.assertEqual(r['status'],'CANDIDATE');self.assertIsNone(r['calibratedProbability'])
  self.assertEqual(set(r),{'schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode','calibratedProbability','comparisonScope','identity','expected','actual','missingFeatureKeys'})
  self.assertEqual(r['missingFeatureKeys'],['DAMPING_TAPE']);self.assertNotIn('approvedChangePresent',r)
 def test_no_input_output_alias_or_cross_call_state(self):
  x=deepcopy(POSITIVE);saved=deepcopy(x);a=compare(x)
  a['identity']['componentKey']='MUTATED';a['expected']['sourceFileId']='MUTATED';a['missingFeatureKeys'].append('MUTATED')
  self.assertEqual(x,saved);self.assertEqual(compare(x),CASES[0]['expected'])
  self.assert_reason(None,'INVALID_INPUT');self.assertEqual(compare(x),CASES[0]['expected'])
 def test_source_and_origin_permutations(self):
  for sr in (False,True):
   for or_ in (False,True):
    x=deepcopy(POSITIVE)
    if sr:x['sources'].reverse()
    if or_:x['origins'].reverse()
    self.assertEqual(compare(x),CASES[0]['expected'])
 def test_hostile_native_objects_not_traversed(self):
  hits=[]
  class HostileDict(dict):
   def items(self):hits.append('items');raise AssertionError('executed')
   def __getitem__(self,k):hits.append('getitem');raise AssertionError('executed')
  class HostileList(list):
   def __iter__(self):hits.append('iter');raise AssertionError('executed')
  class Hostile:
   @property
   def sources(self):hits.append('getter');raise AssertionError('executed')
  for v in (HostileDict(POSITIVE),HostileList([POSITIVE]),Hostile()):self.assert_reason(v,'INVALID_INPUT')
  self.assertEqual(hits,[])
 def test_native_cycles_unpaired_surrogate_nonstring_keys_and_floats(self):
  cyclic=[];cyclic.append(cyclic)
  for v in (cyclic,{'x':'\ud800'},{0:'bad'},1.0,float('nan'),float('inf'),-float('inf'),2**53):
   with self.subTest(valueType=type(v).__name__):self.assert_reason(v,'INVALID_INPUT')
  x=deepcopy(POSITIVE);x['origins'][0]['textArtifact']['pageCount']=2.0;self.assert_reason(x,'INVALID_INPUT')
 def test_numeric_boolean_not_geometry_integer(self):
  for section in ('selection','inventorySnapshot'):
   x=deepcopy(POSITIVE);claim(x)[section]['pageNumber']=True;self.assert_reason(x,'INVALID_INPUT')
 def test_portable_depth64_and65(self):
  def deep(n):
   v=None
   for _ in range(n):v=[v]
   return v
  self.assert_reason(deep(64),'INVALID_INPUT');self.assert_reason(deep(65),'INPUT_LIMIT')
 def test_portable_container32768_and32769(self):
  self.assert_reason([None]*32768,'INVALID_INPUT');self.assert_reason([None]*32769,'INPUT_LIMIT')
 def test_portable_string2million_and_over(self):
  self.assert_reason('x'*2000000,'INVALID_INPUT');self.assert_reason('x'*2000001,'INPUT_LIMIT')
  # Length precedence inherited from T40, even when an overlong string has a surrogate.
  self.assert_reason('x'*2000000+'\ud800','INPUT_LIMIT')
 def test_portable_utf8_exact8million_values(self):
  self.assert_reason(['x'*2000000]*4,'INVALID_INPUT')
  self.assert_reason(['x'*2000000]*4+['x'],'INPUT_LIMIT')
  self.assert_reason(['Ж'*2000000]*2,'INVALID_INPUT')
  self.assert_reason(['Ж'*2000000]*2+['Ж'],'INPUT_LIMIT')
 def test_portable_utf8_object_keys_count_but_json_punctuation_not(self):
  # 4 strings of 2M each plus zero-byte values: exactly 8M native UTF8.
  # Use distinct trailing ASCII characters; equality of dictionary keys is not allowed to collapse them.
  d={('x'*1999999)+str(i):None for i in range(4)}
  self.assert_reason(d,'INVALID_INPUT');d['x']=None;self.assert_reason(d,'INPUT_LIMIT')
 def test_portable_node_count_includes_containers_but_no_array_index_keys(self):
  # root +7 child arrays +199992 leaves =200000 nodes. No array-index strings.
  v=[[None]*32768 for _ in range(6)]+[[None]*3384]
  self.assert_reason(v,'INVALID_INPUT');v[-1].append(None);self.assert_reason(v,'INPUT_LIMIT')
 def test_portable_object_key_nodes_counted(self):
  # 3 dictionaries x32768 key/value pairs =196608 key/value nodes.
  # root+4 containers+196608+3386=199999; adding one pair crosses200000.
  v=[{str(i):None for i in range(32768)}for _ in range(3)]+[{str(i):None for i in range(1693)}]
  self.assert_reason(v,'INVALID_INPUT');v[-1]['extra']=None;self.assert_reason(v,'INPUT_LIMIT')
 def test_projection_sources64_and65(self):
  x=deepcopy(POSITIVE)
  for i in range(62):x['sources'].append({'sourceFileId':'SYNTHETIC-UNREVIEWED-'+str(i),'sourceSha256':'a'*64,'stages':[],'reviewSnapshot':None,'review':None})
  self.assertEqual(compare(x),CASES[0]['expected'])
  x['sources'].append(deepcopy(x['sources'][-1]));self.assert_reason(x,'INPUT_LIMIT')
 def test_projection_origins128_and129(self):
  x=deepcopy(POSITIVE)
  for i in range(126):
   o=deepcopy(x['origins'][1]);o['checkId']='SYNTHETIC-UNUSED-'+str(i);o['textArtifact']={};x['origins'].append(o)
  self.assertEqual(compare(x),CASES[0]['expected'])
  x['origins'].append(deepcopy(x['origins'][-1]));self.assert_reason(x,'INPUT_LIMIT')
 def test_claims16_and17(self):
  x=deepcopy(POSITIVE)
  for i in range(15):
   c=deepcopy(claim(x));c['componentKey']='SYNTHETIC-UNRELATED-'+str(i);review(x)['inventoryScope']['claims'].append(c)
  self.assertEqual(compare(x),CASES[0]['expected'])
  review(x)['inventoryScope']['claims'].append(deepcopy(claim(x)));self.assert_reason(x,'INPUT_LIMIT')
 def test_total_claims128_and129_before_provenance(self):
  x=deepcopy(POSITIVE);x['sources']=[]
  for i in range(8):
   s=deepcopy(POSITIVE['sources'][1]);s['sourceFileId']='SYNTHETIC-'+str(i);s['review']['sourceFileId']=s['sourceFileId']
   s['review']['inventoryScope']['claims']=[deepcopy(s['review']['inventoryScope']['claims'][0])for _ in range(16)];x['sources'].append(s)
  self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
  s=deepcopy(POSITIVE['sources'][1]);s['sourceFileId']='SYNTHETIC-EXTRA';x['sources'].append(s);self.assert_reason(x,'INPUT_LIMIT')
 def test_selected_malformed_artifact_is_reconstruction_failure(self):
  for a in ({},{'schemaVersion':'document-text-v2'},{**deepcopy(POSITIVE['origins'][1]['textArtifact']),'extra':True}):
   x=deepcopy(POSITIVE);x['origins'][1]['textArtifact']=a;self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
  x=deepcopy(POSITIVE);x['origins'][1]['textArtifact']=[];self.assert_reason(x,'INVALID_INPUT')
 def test_unreferenced_retained_malformed_artifact_not_claimed_authentic(self):
  x=deepcopy(POSITIVE);o=deepcopy(x['origins'][1]);o['checkId']='SYNTHETIC-UNREFERENCED';o['textArtifact']={};x['origins'].append(o)
  self.assertEqual(compare(x),CASES[0]['expected'])
  # Core only permits plain metadata retention. Protected loader must authenticate it.
  x['origins'][-1]['objectId']='SYNTHETIC-FOREIGN';self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
 def test_dto_shapes_before_provenance_and_selected_reconstruction(self):
  x=deepcopy(POSITIVE);x['sources'][1]['reviewSnapshot']['contentHash']='a'*64;claim(x)['inventorySnapshot']['featureRows'][0]['fragments'][0]['rawText']='bad\nline'
  self.assert_reason(x,'INVALID_INPUT')
 def test_review_then_section_then_link_precedence(self):
  x=deepcopy(POSITIVE);review(x,0)['approvalStatus']='UNKNOWN';review(x)['sectionCode']='KR';review(x)['linkGroupId']=None
  self.assert_reason(x,'SOURCE_REVIEW_UNVERIFIED');review(x,0)['approvalStatus']='APPROVED'
  self.assert_reason(x,'SOURCE_SECTION_UNVERIFIED');review(x)['sectionCode']='AR';self.assert_reason(x,'LINK_SCOPE_UNVERIFIED')
 def test_reconstruction_before_human_and_nonempty_gate(self):
  x=deepcopy(POSITIVE);claim(x)['assertion']='UNKNOWN';x['origins'][1]['textArtifact']={}
  self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_duplicate_before_ambiguity_across_stages(self):
  x=deepcopy(next(c['input']for c in CASES if c['name']=='competing-different-inventory-same-physical-identity'))
  r=review(x,0);r['inventoryScope']['claims'].append(deepcopy(r['inventoryScope']['claims'][0]));self.assert_reason(x,'INVALID_INPUT')
 def test_no_todays_latest_or_approved_change_field_in_input(self):
  x=deepcopy(POSITIVE);x['latestReviewHash']='a'*64;self.assert_reason(x,'INVALID_INPUT')
  x=deepcopy(POSITIVE);review(x)['approvedChangePresent']=False;self.assert_reason(x,'INVALID_INPUT')
  self.assertEqual(compare(deepcopy(POSITIVE)),CASES[0]['expected'])
 def test_origin_consumer_manifest_distinct_allowed_origin_pointer_tamper_rejected(self):
  x=deepcopy(POSITIVE);self.assertNotEqual(x['inputManifestHash'],x['origins'][0]['inputManifestHash'])
  self.assertEqual(compare(x),CASES[0]['expected']);claim(x)['target']['inputManifestHash']=x['inputManifestHash'];self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
 def test_page_stages_malformed_conflict_and_outside_artifact(self):
  for m in ({'0':'RD'},{'01':'RD'},{'10000000000000000':'RD'},{'2':'OTHER'},{'2':True}):
   x=deepcopy(POSITIVE);review(x)['pageStages']=m;self.assert_reason(x,'INVALID_INPUT')
  x=deepcopy(POSITIVE);review(x)['pageStages']={'2':'PD'};self.assert_reason(x,'SOURCE_STAGE_UNVERIFIED')
  x=deepcopy(POSITIVE);review(x)['pageStages']={'3':'RD'};self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_full_source_projection_extra_keys_forbidden(self):
  for where in ('input','source','review','claim','snapshot','origin'):
   x=deepcopy(POSITIVE)
   target={'input':x,'source':x['sources'][1],'review':review(x),'claim':claim(x),'snapshot':claim(x)['inventorySnapshot'],'origin':x['origins'][1]}[where]
   target['extra']=True;self.assert_reason(x,'INVALID_INPUT')
 def test_unicode_identity_exact_without_normalization(self):
  for value in ('SYNTHETIC-Узел-𐀀','SYNTHETIC-\ufeff-NODE','SYNTHETIC-\x85-NODE','SYNTHETIC-\t-NODE'):
   x=deepcopy(POSITIVE);set_identity(x,'componentKey',value);r=compare(x)
   self.assertEqual(r['status'],'CANDIDATE');self.assertEqual(r['identity']['componentKey'],value)
  x=deepcopy(POSITIVE);claim(x)['componentKey']='SYNTHETIC-é';x['identity']['componentKey']='SYNTHETIC-e\u0301';self.assert_reason(x,'MATCHED_INVENTORY_PAIR_UNVERIFIED')
 def test_identity_controls_trim_length_and_codepoints(self):
  for value in (' leading','trailing\x85','bad\nline','bad\x00key','x'*201):
   x=deepcopy(POSITIVE);set_identity(x,'componentKey',value);self.assert_reason(x,'INVALID_INPUT')
  x=deepcopy(POSITIVE);set_identity(x,'componentKey','𐀀'*200);self.assertEqual(compare(x)['status'],'CANDIDATE')
 def test_unrelated_stage_conflict_does_not_create_or_expand_pair(self):
  x=deepcopy(next(c['input']for c in CASES if c['name']=='unrelated-identity-does-not-union-or-block'))
  x['sources'][2]['stages']=['PD','RD'];x['sources'][2]['review']['pageStages']={'2':'ID'}
  self.assertEqual(compare(x),CASES[0]['expected'])
 def test_snapshot_full_body_rehash_cannot_replace_committed_original(self):
  x=deepcopy(POSITIVE);c=claim(x);c['inventorySnapshot']['featureRows'][0]['featureKey']='DAMPING_TAPE';c['target']['inventoryContentHash']=sha({'hashDomain':'matrix-inventory-source-id-v1','inventory':c['inventorySnapshot']})
  self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_fully_fabricated_db_authority_is_not_claimed_by_pure_core(self):
  # A pure projection cannot prove DB existence; arbitrary self-consistent opaque review hashes
  # may reach CANDIDATE only under the explicit protected-loader prerequisite.
  x=deepcopy(POSITIVE);review(x)['actorId']='SYNTHETIC-NONEXISTENT-ACTOR';review(x)['contentHash']='b'*64;x['sources'][1]['reviewSnapshot']['contentHash']='b'*64
  self.assertEqual(compare(x)['status'],'CANDIDATE')
  self.assertNotIn('authenticated',compare(x))

if __name__=='__main__':unittest.main(verbosity=2)
