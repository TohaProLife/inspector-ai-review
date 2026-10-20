"""T80 tests frozen before new module. Exact policy from pre-DUT whole proposal.

Existing T73 manual builders rebind only release metadata; no old test edits.
"""
from copy import deepcopy
import hashlib,json,unittest
from pathlib import Path
from unittest.mock import patch
import test_durable_steel_comparison_matrix_owner as old
from inspector_worker import durable_steel_comparison_matrix_v11 as w
from inspector_worker import durable_steel_comparison_matrix as v10
from inspector_worker import durable_lighting_technology_matrix as v9
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
ROOT=Path(__file__).resolve().parents[3]
POLICY=json.loads((ROOT/'output/matrix-t80-20261018/python-v11-policy-proposal.json').read_text())
CONFIG='3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7'
assert POLICY['configHash']==CONFIG

def bundle(index=0):
 lease,package,artifacts=old.bundle(index)
 lease['release']['rules']['matrixDefinitions']=deepcopy(POLICY['definitions'])
 lease['release']['providerSlot'].update(profileId='matrix-text-facts-steel-comparison-v11',adapterVersion='11',configHash=CONFIG)
 return lease,package,artifacts

class CurrentSteelDurableTests(unittest.TestCase):
 def test_independently_frozen_policy_whole_and_current_reader(self):
  lease,_,_=bundle();definitions=lease['release']['rules']['matrixDefinitions']
  self.assertEqual(old.sha(definitions),CONFIG)
  self.assertEqual(old.sha({k:v for k,v in definitions.items()if k!='steelExecution'}),'a72fec74e2a3a176a23af200d3c4ab59e853c823783af53accbba8df43c4db91')
  self.assertEqual(w._steel_policy(old.M['capabilityRegistry']),definitions['steelExecution'])
  self.assertEqual(w._validate_release(lease,*w._load_capability_registries()),(lease['release']['providerSlot'],CONFIG))
  self.assertEqual(definitions['lightingTechnologyExecution']['documentTextV3ReaderSourceSha256'],'034fb41687342fae405e11de4648856fa1e271b0a2178ca9f35d8dd50bb19361')
 def test_nine_frozen_operational_cases_actual_dispatch_no_legacy_execution(self):
  for index,case in enumerate(old.M['validCases']):
   lease,package,artifacts=bundle(index);before=deepcopy((lease,package,artifacts))
   with self.subTest(case=case['name']),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=package),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])),patch.object(v10,'execute_durable_steel_comparison_matrix',side_effect=AssertionError('old v10 execute')),patch.object(v9,'execute_durable_lighting_technology_matrix',side_effect=AssertionError('old v9 execute')),patch.object(v9,'_validate_release',side_effect=AssertionError('old release spoof')):
    result=PilotPz002RuleAdapter().execute(lease,old.ATTEMPT)
   self.assertEqual(result['providerProfileId'],'matrix-text-facts-steel-comparison-v11');self.assertEqual(result['providerConfigHash'],CONFIG)
   expected={'steelComparisons':old.expected_steel(lease,package,index),'lightingTechnologyComparisons':old.v9qa.expected_lighting(lease),'waterNodeComparisons':old.v9qa.v8qa.expected_water(lease),'railInventoryComparisons':old.v9qa.v8qa.v7qa.manual_rail_envelope(lease),'inventoryComparisons':old.v9qa.v8qa.v7qa.v6qa.manual_ar_envelope(lease),'callInventoryComparisons':old.v9qa.v8qa.v7qa.v6qa.C['cases'][0]['expectedEnvelope']}
   for key,value in expected.items():self.assertEqual(result[key],value,(case['name'],key))
   self.assertEqual(result['steelApplicabilitySnapshot'],package['steelApplicabilitySnapshot']);self.assertEqual(len(result['execution']['results']),63)
   self.assertEqual(result['outputCount'],63+sum(len(result[k]['results'])for k in expected))
   coverage=result['effectiveCoverage'];self.assertEqual(len(coverage),132)
   self.assertEqual((sum(x['implementedAtomicRules']>0 for x in coverage),sum(x['implementedAtomicRules']for x in coverage),sum(x['executionStatus']=='UNSUPPORTED'for x in coverage)),(61,69,71))
   for row,base in zip(coverage,result['execution']['coverage']):
    if row['parameterCode']not in ['AR-053','ODI-123','ODI-120','ZU-129','ZU-130','KR-056']:self.assertEqual(row,base)
   for key in expected:
    for row in result[key]['results']:self.assertIsNone(row.get('calibratedProbability',row.get('comparison',{}).get('calibratedProbability')))
   self.assertEqual((lease,package,artifacts),before)
 def test_historical_profiles_explicitly_unavailable_before_any_network(self):
  for profile in ['matrix-text-facts-lighting-technology-v9','matrix-text-facts-steel-comparison-v10']:
   lease,_,_=old.bundle();lease['release']['providerSlot']['profileId']=profile
   with patch.object(v10,'execute_durable_steel_comparison_matrix')as ten,patch.object(v9,'execute_durable_lighting_technology_matrix')as nine:
    with self.assertRaisesRegex(ValueError,'historical matrix runtime unavailable'):PilotPz002RuleAdapter().execute(lease,old.ATTEMPT)
    ten.assert_not_called();nine.assert_not_called()
 def test_rehashed_wrong_runtime_policy_and_adapter_before_loader(self):
  lease,_,_=bundle();cases=[]
  for field in POLICY['definitions']['steelExecution']:
   bad=deepcopy(lease);bad['release']['rules']['matrixDefinitions']['steelExecution'][field]='FORGED';cases.append(bad)
  for field,value in [('profileId','matrix-text-facts-steel-comparison-v10'),('adapterVersion','10')]:
   bad=deepcopy(lease);bad['release']['providerSlot'][field]=value;cases.append(bad)
  bad=deepcopy(lease);bad['release']['rules']['matrixDefinitions']['lightingTechnologyExecution']['documentTextV3ReaderSourceSha256']='9890c816bb1d8e424ed17424f9bae65b2393543b879640abfaab60606fb64314';cases.append(bad)
  for bad in cases:
   bad['release']['providerSlot']['configHash']=old.sha(bad['release']['rules']['matrixDefinitions'])
   with patch.object(w,'download_reviewed_inventory_comparison_inputs')as fetch:
    with self.assertRaises((ValueError,TypeError,KeyError)):w.execute_durable_steel_comparison_matrix_v11(bad,old.ATTEMPT)
    fetch.assert_not_called()
 def test_retained_claim_snapshot_source_lease_corruption_before_text(self):
  lease,package,_=bundle()
  for mode in ['claim','original','snapshot','source','lease']:
   q=deepcopy(package);l=deepcopy(lease)
   if mode=='claim':q['steelComparison']['sources'][0]['review']['steelComparisonScope']['claims'][0]['declarationSnapshot']['value']='С245'
   elif mode=='original':q['steelComparison']['origins'][0]['textArtifact']['pages'][0]['blocks'][0]['text']='forged'
   elif mode=='snapshot':q['steelApplicabilitySnapshot']['contentHash']='0'*64
   elif mode=='source':q['steelComparison']['sources'].pop()
   else:l['inputs']['sourceFiles'][0]['sha256']='0'*64
   with self.subTest(mode=mode),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as download:
    with self.assertRaises(ValueError):w.execute_durable_steel_comparison_matrix_v11(l,old.ATTEMPT)
    download.assert_not_called()
 def test_transport_unchanged_route_v6_headers_and_fence(self):
  lease,package,_=bundle();http=old.v9qa.v8qa.v7qa.v6qa.http_fixture;headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v6'}
  with http(package,headers=headers,close=True)as state:
   self.assertEqual(w.download_reviewed_inventory_comparison_inputs(lease,old.ATTEMPT),package)
   self.assertIn('/steel-reviewed-inventory-comparison-inputs?',state['requests'][0]['path'])
  for key,value in [('X-Artifact-Schema-Version','matrix-reviewed-inventory-loader-inputs-v5'),('X-Input-Manifest-SHA256','0'*64),('X-Content-SHA256','0'*64),('Content-Length','67108865')]:
   with self.subTest(key=key),http(package,headers={**headers,key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease,old.ATTEMPT)
  with http(package,status=409,headers=headers,close=True),self.assertRaises(w.TextArtifactLeaseLost):w.download_reviewed_inventory_comparison_inputs(lease,old.ATTEMPT)
 def test_native_callbacks_zero_and_snapshot_manual_unchanged(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError()
  lease,package,_=bundle();cycle={};cycle['cycle']=cycle
  for raw in [Hostile(),cycle,{'n':0.5},{'n':9007199254740992},{'bad':'\ud800'},{'ключ':1}]:
   with self.assertRaises(ValueError):w._validate_loader(raw,lease)
  self.assertEqual(calls,[])
  for case in old.S['validCases']:self.assertEqual(w._validate_snapshot(case['expectedSnapshot'],case['package']),case['expectedSnapshot'])
