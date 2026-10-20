"""v8 additive production dispatch, original-backed manual expectations."""
from copy import deepcopy
import json,unittest
from pathlib import Path
from unittest.mock import patch
import test_durable_rail_inventory_matrix as v7qa
from inspector_worker import durable_water_node_matrix as w
from inspector_worker import durable_rail_inventory_matrix as v7
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
ROOT=Path(__file__).resolve().parents[3]
M=json.loads((ROOT/'fixtures/matrix-water-node-execution-v1/research-manual-execution-goldens.json').read_text())
AR,CALL,RAIL=v7qa.AR,v7qa.CALL,v7qa.RAIL
WATER=M['capabilityRegistry'];sha=v7qa.sha;canonical=v7qa.canonical;file_sha=v7qa.file_sha
ATTEMPT=v7qa.ATTEMPT

def policy():
 return {'schemaVersion':'matrix-water-node-comparisons-v1','purpose':'MACHINE_COMPARISON',
  'baseProfileId':'matrix-text-facts-rail-inventory-v7','baseConfigHash':'35be151bd0eff262bb7e19feb2b91c6d6e5e0f70ea41dee43f05ea331ebdcd36',
  'capabilityRegistry':deepcopy(WATER),'capabilityRegistryHash':'15bebe6faf9fe0f6ce75ad7399f46fad582356ce175cbdbaffa0eaea7dab2f88',
  'comparisonVersion':'matrix-zu129-water-node-comparison-v1','comparisonSourceSha256':file_sha(w.water_node_comparison),
  'sourceReconstructionVersion':'matrix-zu129-water-node-source-v1','sourceReconstructionSourceSha256':file_sha(w.water_node_source),
  'typedExecutionVersion':'matrix-water-node-execution-v1','typedExecutionSourceSha256':file_sha(w.water_node_execution),
  'durableWrapperVersion':'matrix-water-node-execution-v1','durableWrapperSourceSha256':file_sha(w),
  'coveragePolicyVersion':'matrix-water-node-coverage-v1','submissionPolicyVersion':'matrix-water-node-submission-v1','hashPolicyVersion':'matrix-water-node-result-json-v1'}

def bundle(case=0):
 l,p,a=v7qa.bundle();d=l['release']['rules']['matrixDefinitions'];d['waterNodeExecution']=policy()
 l['release']['providerSlot'].update(profileId='matrix-text-facts-water-node-v8',adapterVersion='8',configHash=sha(d))
 water=deepcopy(M['fixtures'][case]['package']);water['objectId']=l['objectId'];water['inputManifestHash']=l['inputManifestHash']
 for s in water['sources']:
  if s['stages']==['UNRESOLVED']:s['stages']=['PD','RD']
  if s['review']is not None:s['review']['objectId']=l['objectId']
 for o in water['origins']:o['objectId']=l['objectId']
 own=deepcopy(water['sources'])
 for s in p['railInventory']['sources']:
  item=deepcopy(s)
  if item['review']is not None:item['review'].pop('railInventoryScope');item['review']['waterNodeScope']=None
  water['sources'].append(item)
 for s in own:
  for domain,key in [('inventory','inventoryScope'),('callInventory','callInventoryScope'),('railInventory','railInventoryScope')]:
   item=deepcopy(s)
   if item['review']is not None:item['review'].pop('waterNodeScope');item['review'][key]=None
   p[domain]['sources'].append(item)
  r=s['review'];sid=s['sourceFileId'];l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':s['sourceSha256'],'stages':deepcopy(s['stages']),'byteSize':1234,'mediaType':'application/pdf','sectionCode':r['sectionCode']if r else None,'downloadPath':'/api/internal/v1/jobs/local/inputs/'+sid})
  if r:l['inputs']['sourceDecisions'][sid]={**deepcopy(r),'basis':{'reference':'Synthetic authored review; no database authority'}}
 origins=deepcopy(p['railInventory']['origins']+water['origins'])
 for child in [p['inventory'],p['callInventory'],p['railInventory'],water]:child['origins']=deepcopy(origins)
 for o in origins:a[o['sourceFileId']]=deepcopy(o['textArtifact'])
 p.update(schemaVersion='matrix-reviewed-inventory-loader-inputs-v4',waterNode=water)
 return l,p,a

def expected_water(l,case=0):
 e=deepcopy(M['fixtures'][case]['expected']['envelope']);e['objectId']=l['objectId'];e['inputManifestHash']=l['inputManifestHash']
 for r in e['results']:r['id']=sha({'hashDomain':'matrix-water-node-execution-result-id-v1','objectId':e['objectId'],'inputManifestHash':e['inputManifestHash'],'capabilityRegistryHash':e['capabilityRegistryHash'],'result':{k:v for k,v in r.items()if k!='id'}})
 return e
class WaterDurableTests(unittest.TestCase):
 def test_frozen_v7_policy_and_all_four_registries(self):
  l,_,_=bundle();d=l['release']['rules']['matrixDefinitions'];self.assertEqual(sha({k:v for k,v in d.items()if k!='waterNodeExecution'}),'35be151bd0eff262bb7e19feb2b91c6d6e5e0f70ea41dee43f05ea331ebdcd36');self.assertEqual(w._water_node_policy(WATER),policy());self.assertEqual(w._load_capability_registries(),(AR,CALL,RAIL,WATER));self.assertEqual(w._validate_release(l,AR,CALL,RAIL,WATER),(l['release']['providerSlot'],sha(d)))
 def test_actual_dispatch_four_domains_and_null_probability(self):
  l,p,a=bundle();before=deepcopy((l,p,a))
  with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])),patch.object(v7,'execute_durable_rail_inventory_matrix',side_effect=AssertionError('legacy execute')),patch.object(v7,'_validate_release',side_effect=AssertionError('forged old release')):
   result=PilotPz002RuleAdapter().execute(l,ATTEMPT)
  self.assertEqual(result['providerProfileId'],'matrix-text-facts-water-node-v8');self.assertEqual(result['waterNodeComparisons'],expected_water(l));self.assertEqual(result['railInventoryComparisons'],v7qa.manual_rail_envelope(l));self.assertEqual(result['outputCount'],len(result['execution']['results'])+4)
  for key in ['inventoryComparisons','callInventoryComparisons','railInventoryComparisons','waterNodeComparisons']:self.assertIsNone(result[key]['results'][0]['comparison']['calibratedProbability'])
  for row,original in zip(result['effectiveCoverage'],result['execution']['coverage']):
   if row['parameterCode']not in ['AR-053','ODI-123','ODI-120','ZU-129']:self.assertEqual(row,original)
  row=next(r for r in result['effectiveCoverage']if r['parameterCode']=='ZU-129');self.assertEqual((row['successfulComparisons'],row['abstentions'],row['executionStatus']),(1,0,'PARTIAL'));self.assertEqual((l,p,a),before)
 def test_unknown_stage_retains_scoped_abstention(self):
  l,p,a=bundle(1)
  with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])):r=w.execute_durable_water_node_matrix(l,ATTEMPT)
  self.assertEqual(r['waterNodeComparisons'],expected_water(l,1))
 def test_all_policy_leaves_rehashed_faults_before_network(self):
  l,_,_=bundle();paths=[]
  def walk(v,p=()):
   if type(v)is dict:
    for k,x in v.items():walk(x,p+(k,))
   else:paths.append(p)
  walk(l['release']['rules']['matrixDefinitions'])
  for path in paths:
   bad=deepcopy(l);node=bad['release']['rules']['matrixDefinitions']
   for k in path[:-1]:node=node[k]
   node[path[-1]]='FORGED';bad['release']['providerSlot']['configHash']=sha(bad['release']['rules']['matrixDefinitions'])
   with self.subTest(path=path),patch.object(w,'download_reviewed_inventory_comparison_inputs')as network:
    with self.assertRaises((ValueError,KeyError,TypeError)):w.execute_durable_water_node_matrix(bad,ATTEMPT)
    network.assert_not_called()
 def test_all_domain_origins_and_sources_match_before_text(self):
  l,p,_=bundle()
  for domain in ['inventory','callInventory','railInventory','waterNode']:
   for fault in ['source','origin']:
    bad=deepcopy(p);bad[domain]['sources'if fault=='source'else'origins'].pop()
    with self.subTest(domain=domain,fault=fault),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=bad),patch.object(w,'download_text_artifact')as text:
     with self.assertRaises(ValueError):w.execute_durable_water_node_matrix(l,ATTEMPT)
     text.assert_not_called()
 def test_transport_exact_path_and_four_domain_schema(self):
  l,p,_=bundle()
  with v7qa.v6qa.http_fixture(p,headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v4'},close=True)as state:
   self.assertEqual(w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT),p)
   self.assertIn('/water-node-reviewed-inventory-comparison-inputs?',state['requests'][0]['path'])
if __name__=='__main__':unittest.main()
