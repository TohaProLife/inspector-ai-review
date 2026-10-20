"""T83 wrapper integration. Expectations authored before wrapper from accepted v11
whole goldens plus explicit unbound atom. Mock transport is not durable PG proof.
"""
from copy import deepcopy
import hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID
import test_durable_steel_comparison_matrix_v11_owner as v11qa
from inspector_worker import durable_column_pylon_section_matrix_v12 as w
from inspector_worker import durable_steel_comparison_matrix_v11 as v11
ROOT=Path(__file__).resolve().parents[3]
T=json.loads((ROOT/'output/matrix-t83-20261018/root-v12-policy-template.json').read_text())
SCALAR_POLICY_EXTENSION=json.loads((ROOT/'fixtures/matrix-column-pylon-section-execution-v1/scalar-prepared-v12-policy-extension.json').read_text())
Q=json.loads((ROOT/'fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations.json').read_text())
sha=v11qa.old.sha
FIELDS=v11qa.old.FIELDS
INTERNAL_OBJECT_UUID='00000000-0000-4000-8000-000000000100'

# New v12 test-only identity adaptation. Original six-domain fixtures stay exact.
# Parent review hashes are opaque synthetic protected-loader assertions, not DB proof.
REVIEW_UUIDS={
 'SYNTHETIC-REVIEW-pd-both':'00000000-0000-4000-8000-000000000001',
 'SYNTHETIC-REVIEW-rd-gasket':'00000000-0000-4000-8000-000000000002',
 'SYNTHETIC-T44-DECISION-pd-button':'00000000-0000-4000-8000-000000000003',
 'SYNTHETIC-T44-DECISION-rd-system':'00000000-0000-4000-8000-000000000004',
 'SYNTHETIC-T46-REVIEW-pd-both':'00000000-0000-4000-8000-000000000005',
 'SYNTHETIC-T46-REVIEW-rd-basin':'00000000-0000-4000-8000-000000000006',
 'SYNTHETIC-DECISION-PD':'00000000-0000-4000-8000-000000000007',
 'SYNTHETIC-DECISION-RD':'00000000-0000-4000-8000-000000000008',
 'REVIEW-RD-named-fluorescent':'00000000-0000-4000-8000-000000000009',
 'REVIEW-PD-named-led':'00000000-0000-4000-8000-00000000000a',
 'SYNTHETIC-T70-REVIEW-PD':'00000000-0000-4000-8000-00000000000b',
 'SYNTHETIC-T70-REVIEW-RD':'00000000-0000-4000-8000-00000000000c',
}
LEGACY_DOMAINS=('inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison')
RESULT_DOMAINS={
 'inventoryComparisons':'matrix-inventory-execution-result-id-v1',
 'callInventoryComparisons':'matrix-call-inventory-execution-result-id-v1',
 'railInventoryComparisons':'matrix-rail-inventory-execution-result-id-v1',
 'waterNodeComparisons':'matrix-water-node-execution-result-id-v1',
 'lightingTechnologyComparisons':'matrix-lighting-technology-execution-result-id-v1',
 'steelComparisons':'matrix-steel-execution-result-id-v1',
}

def rehash_legacy_steel(package):
 decisions=package['steelComparison']['applicabilityDecisions']
 for decision in decisions:
  decision['contentHash']=sha({'hashDomain':'matrix-kr056-steel-applicability-decision-json-v1',
   'decision':{k:v for k,v in decision.items()if k!='contentHash'}})
 by_id={decision['decisionId']:decision for decision in decisions}
 snapshot=package['steelApplicabilitySnapshot']
 for entry in snapshot['entries']:
  if entry['included']:
   decision=by_id[entry['decisionId']]
   entry['projectionContentHash']=decision['contentHash']
   entry['pairKey']=sha({'hashDomain':'matrix-kr056-steel-applicability-pair-key-v1',
    'objectId':package['objectId'],'identity':decision['identity'],
    'expectedSourceFileId':decision['expected']['sourceFileId'],
    'actualSourceFileId':decision['actual']['sourceFileId']})
 snapshot['contentHash']=sha({'hashDomain':'matrix-kr056-steel-applicability-run-snapshot-json-v1',
  'snapshot':{k:v for k,v in snapshot.items()if k!='contentHash'}})

def rebind_legacy_object_id(lease,package,object_id):
 # Explicit metadata locations from the frozen116-path inspection; no raw-text walk.
 lease['objectId']=object_id;package['objectId']=object_id
 for domain in LEGACY_DOMAINS:
  child=package[domain];child['objectId']=object_id
  for source in child['sources']:
   if 'objectId'in source:source['objectId']=object_id
   if source['review']is not None and 'objectId'in source['review']:
    source['review']['objectId']=object_id
  for origin in child['origins']:
   if 'objectId'in origin:origin['objectId']=object_id
 for decision in package['steelComparison']['applicabilityDecisions']:decision['objectId']=object_id
 package['steelApplicabilitySnapshot']['objectId']=object_id
 rehash_legacy_steel(package)

def rebind_legacy_review_ids(package,mapping):
 for domain in LEGACY_DOMAINS:
  for source in package[domain]['sources']:
   if source['review'] is not None:
    source['review']['decisionId']=mapping[source['review']['decisionId']]
   if source.get('reviewSnapshot') is not None:
    source['reviewSnapshot']['decisionId']=mapping[source['reviewSnapshot']['decisionId']]
 for decision in package['steelComparison']['applicabilityDecisions']:
  for role in ('expected','actual'):
   decision[role]['reviewDecisionId']=mapping[decision[role]['reviewDecisionId']]
 rehash_legacy_steel(package)

def historical_six_expected(lease,package):
 # Manual old expectations only; no production comparator/result-ID helper calls.
 result={'steelComparisons':v11qa.old.expected_steel(lease,package),
  'lightingTechnologyComparisons':v11qa.old.v9qa.expected_lighting(lease),
  'waterNodeComparisons':v11qa.old.v9qa.v8qa.expected_water(lease),
  'railInventoryComparisons':v11qa.old.v9qa.v8qa.v7qa.manual_rail_envelope(lease),
  'inventoryComparisons':v11qa.old.v9qa.v8qa.v7qa.v6qa.manual_ar_envelope(lease),
  'callInventoryComparisons':deepcopy(v11qa.old.v9qa.v8qa.v7qa.v6qa.C['cases'][0]['expectedEnvelope'])}
 for envelope in result.values():
  envelope['objectId']=lease['objectId'];envelope['inputManifestHash']=lease['inputManifestHash']
 return result

def rebind_manual_six(envelopes,mapping,steel_projection_hash,object_id=None):
 result=deepcopy(envelopes)
 for key,envelope in result.items():
  if object_id is not None:envelope['objectId']=object_id
  for row in envelope['results']:
   comparison=row['comparison']
   if key=='steelComparisons':
    comparison=comparison['comparison']
    comparison['applicabilityDecisionContentHash']=steel_projection_hash
   for role in ('expected','actual'):
    comparison[role]['reviewDecisionId']=mapping[comparison[role]['reviewDecisionId']]
   row['id']=sha({'hashDomain':RESULT_DOMAINS[key],'objectId':envelope['objectId'],
    'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],
    'result':{k:v for k,v in row.items()if k!='id'}})
 return result

def manual_six_expected(lease,package):
 return rebind_manual_six(historical_six_expected(lease,package),REVIEW_UUIDS,
  package['steelComparison']['applicabilityDecisions'][0]['contentHash'])

def resolve(value):
 if type(value) is dict:
  if set(value)=={'$SOURCE_SHA256'}:return hashlib.sha256((ROOT/value['$SOURCE_SHA256']).read_bytes()).hexdigest()
  if set(value)=={'$JSON_FILE'}:return json.loads((ROOT/value['$JSON_FILE']).read_text())
  return {k:resolve(v) for k,v in value.items()}
 if type(value) is list:return [resolve(v)for v in value]
 return value

def bundle():
 lease,package,artifacts=v11qa.bundle()
 rebind_legacy_object_id(lease,package,INTERNAL_OBJECT_UUID)
 rebind_legacy_review_ids(package,REVIEW_UUIDS)
 policy=resolve({**T['columnPylonSectionExecution'],**SCALAR_POLICY_EXTENSION})
 lease['release']['rules']['matrixDefinitions']['columnPylonSectionExecution']=policy
 lease['release']['providerSlot'].update(profileId=T['profileId'],adapterVersion='12',configHash=sha(lease['release']['rules']['matrixDefinitions']))
 public='OBJ-T83-WRAPPER'
 sources=[]
 for source in package['waterNode']['sources']:
  review=source['review'];sources.append({'sourceFileId':source['sourceFileId'],'sourceSha256':source['sourceSha256'],'stages':deepcopy(source['stages']),'review':{k:deepcopy(review[k])for k in FIELDS}if review else None})
 sources.sort(key=lambda s:s['sourceFileId'])
 snapshot={'schemaVersion':'matrix-kr060-column-pylon-run-snapshot-v1','objectId':lease['objectId'],'objectApiId':public,'inputManifestHash':lease['inputManifestHash'],'entries':[]}
 snapshot['contentHash']=sha({'hashDomain':'matrix-kr060-column-pylon-run-snapshot-json-v1','snapshot':deepcopy(snapshot)})
 package.update(schemaVersion='matrix-reviewed-inventory-loader-inputs-v7',objectApiId=public,columnPylonSection={'schemaVersion':'matrix-kr060-column-pylon-loader-inputs-v1','objectId':public,'inputManifestHash':lease['inputManifestHash'],'sources':sources,'origins':[],'reviews':[]},columnPylonSectionSnapshot=snapshot)
 return lease,package,artifacts

def expected_column(lease,package):
 envelope={'schemaVersion':'matrix-column-pylon-section-comparisons-v1','purpose':'MACHINE_COMPARISON','objectId':package['objectApiId'],'inputManifestHash':lease['inputManifestHash'],'capabilityRegistryHash':Q['registryHash'],'pairReviewSnapshotHash':package['columnPylonSectionSnapshot']['contentHash']}
 row={'schemaVersion':'matrix-column-pylon-section-execution-result-v1','ruleId':'matrix-kr-060-reviewed_rectangular_gross_section_area_decrease','ruleVersion':'1','parameterCode':'KR-060','comparisonVariant':'PD_RD','kind':'UNBOUND_ATOM_ABSTENTION','reasonCode':'REVIEWED_COLUMN_PYLON_PAIR_MISSING','calibratedProbability':None}
 ident=sha({'hashDomain':'matrix-column-pylon-section-execution-result-id-v1',**{k:envelope[k]for k in ['objectId','inputManifestHash','capabilityRegistryHash','pairReviewSnapshotHash']},'result':row})
 return {**envelope,'results':[{**row,'id':ident}]}

class ColumnPylonDurableOwnerTests(unittest.TestCase):
 def test_full_policy_and_v12_release_own_identity(self):
  lease,_,_=bundle();policy=resolve({**T['columnPylonSectionExecution'],**SCALAR_POLICY_EXTENSION})
  self.assertEqual(w._column_pylon_section_policy(Q['registry']),policy)
  self.assertEqual(w._validate_release(lease,*w._load_capability_registries()),(lease['release']['providerSlot'],sha(lease['release']['rules']['matrixDefinitions'])))
  self.assertEqual(sha({k:v for k,v in lease['release']['rules']['matrixDefinitions'].items()if k!='columnPylonSectionExecution'}),T['baseConfigHash'])
 def test_actual_seven_domains_unchanged_six_whole_outputs_and_scalar_no_archived_execution(self):
  lease,package,artifacts=bundle();before=deepcopy((lease,package,artifacts))
  with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=package),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])),patch.object(v11,'execute_durable_steel_comparison_matrix_v11',side_effect=AssertionError('archived execute')),patch.object(v11,'_validate_release',side_effect=AssertionError('archived lease spoof')):
   result=w.execute_durable_column_pylon_section_matrix_v12(lease,v11qa.old.ATTEMPT)
  expected={**manual_six_expected(lease,package),'columnPylonSectionComparisons':expected_column(lease,package)}
  for key,value in expected.items():self.assertEqual(result[key],value,key)
  self.assertEqual(result['providerProfileId'],T['profileId']);self.assertEqual(result['columnPylonSectionSnapshot'],package['columnPylonSectionSnapshot'])
  self.assertEqual(result['steelApplicabilitySnapshot'],package['steelApplicabilitySnapshot']);self.assertEqual(len(result['execution']['results']),63)
  self.assertEqual(result['outputCount'],63+sum(len(x['results'])for x in expected.values()))
  coverage=result['effectiveCoverage'];self.assertEqual((sum(x['implementedAtomicRules']>0 for x in coverage),sum(x['implementedAtomicRules']for x in coverage),sum(x['executionStatus']=='UNSUPPORTED'for x in coverage)),(62,70,70))
  new=next(x for x in coverage if x['parameterCode']=='KR-060');self.assertEqual((new['executionStatus'],new['successfulComparisons'],new['abstentions'],new['failures']),('PARTIAL',0,1,0))
  for row,base in zip(coverage,result['execution']['coverage']):
   if row['parameterCode']not in ['AR-053','ODI-123','ODI-120','ZU-129','ZU-130','KR-056','KR-060']:self.assertEqual(row,base)
  self.assertEqual((lease,package,artifacts),before)
 def test_explicit_uuid_map_and_inverse_whole_fixture_preservation(self):
  old_lease,old_package,old_artifacts=v11qa.bundle()
  old_before=deepcopy((old_lease,old_package,old_artifacts))
  old_expected=historical_six_expected(old_lease,old_package)
  expected_before=deepcopy(old_expected)
  lease,package,artifacts=bundle()
  self.assertEqual(set(REVIEW_UUIDS),{s['review']['decisionId']for s in old_package['waterNode']['sources']})
  self.assertEqual(len(REVIEW_UUIDS),12);self.assertEqual(len(set(REVIEW_UUIDS.values())),12)
  for value in REVIEW_UUIDS.values():self.assertEqual(str(UUID(value)),value);self.assertEqual(UUID(value).version,4)
  restored={k:deepcopy(v)for k,v in package.items()if k not in {'objectApiId','columnPylonSection','columnPylonSectionSnapshot'}}
  restored['schemaVersion']=old_package['schemaVersion']
  inverse={value:key for key,value in REVIEW_UUIDS.items()}
  rebind_legacy_review_ids(restored,inverse)
  restored_lease=deepcopy(lease)
  rebind_legacy_object_id(restored_lease,restored,old_lease['objectId'])
  self.assertEqual(restored,old_package)
  self.assertEqual(lease['objectId'],INTERNAL_OBJECT_UUID)
  self.assertEqual({k:v for k,v in restored_lease.items()if k!='release'},
   {k:v for k,v in old_lease.items()if k!='release'})
  self.assertEqual(lease['inputs'],old_lease['inputs']);self.assertEqual(artifacts,old_artifacts)
  adapted=manual_six_expected(lease,package)
  restored_expected=rebind_manual_six(adapted,inverse,old_package['steelComparison']['applicabilityDecisions'][0]['contentHash'],old_lease['objectId'])
  self.assertEqual(restored_expected,old_expected)
  self.assertEqual(old_expected,expected_before)
  self.assertEqual((old_lease,old_package,old_artifacts),old_before)
 def test_rehashed_mutated_policy_profile_adapter_base_before_loader(self):
  lease,_,_=bundle();cases=[]
  for field in {**T['columnPylonSectionExecution'],**SCALAR_POLICY_EXTENSION}:
   bad=deepcopy(lease);bad['release']['rules']['matrixDefinitions']['columnPylonSectionExecution'][field]='FORGED';cases.append(bad)
  for field,value in [('profileId',T['baseProfileId']),('adapterVersion','11')]:
   bad=deepcopy(lease);bad['release']['providerSlot'][field]=value;cases.append(bad)
  bad=deepcopy(lease);bad['release']['rules']['matrixDefinitions']['steelExecution']['comparisonVersion']='FORGED';cases.append(bad)
  for bad in cases:
   bad['release']['providerSlot']['configHash']=sha(bad['release']['rules']['matrixDefinitions'])
   with patch.object(w,'download_reviewed_inventory_comparison_inputs')as fetch:
    with self.assertRaises((ValueError,TypeError,KeyError)):w.execute_durable_column_pylon_section_matrix_v12(bad,v11qa.old.ATTEMPT)
    fetch.assert_not_called()
 def test_parent_snapshot_source_or_lease_corruption_before_text_download(self):
  lease,package,_=bundle()
  for mode in ['snapshot','source','public','manifest','extra','lease']:
   l=deepcopy(lease);p=deepcopy(package)
   if mode=='snapshot':p['columnPylonSectionSnapshot']['contentHash']='0'*64
   elif mode=='source':p['columnPylonSection']['sources'].pop()
   elif mode=='public':p['objectApiId']='OBJ-FORGED'
   elif mode=='manifest':p['columnPylonSection']['inputManifestHash']='0'*64
   elif mode=='extra':p['extra']=True
   else:l['inputs']['sourceFiles'][0]['sha256']='0'*64
   with self.subTest(mode=mode),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact')as text:
    with self.assertRaises((ValueError,TypeError)):w.execute_durable_column_pylon_section_matrix_v12(l,v11qa.old.ATTEMPT)
    text.assert_not_called()
 def test_transport_v7_route_digest_fence_and_exact_headers(self):
  lease,package,_=bundle();http=v11qa.old.v9qa.v8qa.v7qa.v6qa.http_fixture;headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v7'}
  with http(package,headers=headers,close=True)as state:
   self.assertEqual(w.download_reviewed_inventory_comparison_inputs(lease,v11qa.old.ATTEMPT),package)
   self.assertIn('/column-pylon-section-reviewed-inventory-comparison-inputs?',state['requests'][0]['path'])
  for key,value in [('X-Artifact-Schema-Version','matrix-reviewed-inventory-loader-inputs-v6'),('X-Input-Manifest-SHA256','0'*64),('X-Content-SHA256','0'*64),('Content-Length','67108865')]:
   with http(package,headers={**headers,key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease,v11qa.old.ATTEMPT)
  with http(package,status=409,headers=headers,close=True),self.assertRaises(w.TextArtifactLeaseLost):w.download_reviewed_inventory_comparison_inputs(lease,v11qa.old.ATTEMPT)
 def test_native_parent_aggregate_exact_nodes_and_callbacks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('callback')
  for value in [Hostile(),{'x':0.5},{'x':9007199254740992},{'x':'\ud800'}]:
   with self.assertRaises((ValueError,TypeError)):w._native_json(value)
  self.assertEqual(calls,[])
  chunk=[0]*32768;raw=[chunk]*137+[[0]*10663];w._native_json(raw);raw[-1].append(0)
  with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):w._native_json(raw)

if __name__=='__main__':unittest.main()
