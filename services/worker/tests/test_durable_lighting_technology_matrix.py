"""T67 independent durable expectations frozen before the v9 implementation.

Existing four-domain authored bundles plus T65 whole manual lighting outputs;
network stubs only, no inferred original pair or invented human authority.
"""
from copy import deepcopy
import hashlib,json,socket,time,unittest
from pathlib import Path
from unittest.mock import patch
import test_durable_water_node_matrix as v8qa
from inspector_worker import durable_lighting_technology_matrix as w
from inspector_worker import durable_water_node_matrix as v8
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
ROOT=Path(__file__).resolve().parents[3]
MANUAL=ROOT/'fixtures/matrix-lighting-technology-execution-v1/qa-manual-execution-goldens.json'
assert hashlib.sha256(MANUAL.read_bytes()).hexdigest()=='264c3ed29f73f03a65e2e286b85ce6a6e91f8b4b76e42e019b6930fa6b85390e'
M=json.loads(MANUAL.read_text());L=M['capabilityRegistry']
V2=json.loads((ROOT/'fixtures/matrix-lighting-technology-source-v1/research-authored-goldens.json').read_text())
AR,CALL,RAIL,WATER=v8qa.AR,v8qa.CALL,v8qa.RAIL,v8qa.WATER
sha=v8qa.sha;canonical=v8qa.canonical;file_sha=v8qa.file_sha;ATTEMPT=v8qa.ATTEMPT
DOMAINS=[('inventory','inventoryScope'),('callInventory','callInventoryScope'),('railInventory','railInventoryScope'),('waterNode','waterNodeScope')]

def policy():
 return {'schemaVersion':'matrix-lighting-technology-comparisons-v1','purpose':'MACHINE_COMPARISON',
  'baseProfileId':'matrix-text-facts-water-node-v8','baseConfigHash':'784b5827e6215552756b8d4a669f4310f90a50e23251af961d7d3c988007df7c',
  'capabilityRegistry':deepcopy(L),'capabilityRegistryHash':'020d2f99baf12157095399264e667c74de08b863bb4af3d0a2e8d551c8d1e091',
  'comparisonVersion':'matrix-zu130-lighting-technology-comparison-v1','comparisonSourceSha256':file_sha(w.lighting_technology_comparison),
  'sourceReconstructionVersion':'matrix-zu130-lighting-technology-source-v3-v1','sourceReconstructionSourceSha256':file_sha(w.lighting_technology_source_v3),
  'documentTextV3ReaderSourceSha256':file_sha(w.document_text_v3),
  'typedExecutionVersion':'matrix-lighting-technology-execution-v1','typedExecutionSourceSha256':file_sha(w.lighting_technology_execution),
  'durableWrapperVersion':'matrix-lighting-technology-execution-v1','durableWrapperSourceSha256':file_sha(w),
  'coveragePolicyVersion':'matrix-lighting-technology-coverage-v1','submissionPolicyVersion':'matrix-lighting-technology-submission-v1',
  'hashPolicyVersion':'matrix-lighting-technology-result-json-v1','confidencePolicy':{'policyVersion':'machine-confidence-policy-v2',
   'warningThresholdBasisPoints':8000,'thresholdComparison':'STRICTLY_GREATER','expectedCalibrationVersion':None,
   'sourceSha256':'f3436ef404d494849e3a64affde3c6cf4e86e4336228b3dd7071eef1c0cc70d0'}}

def bundle(case=0):
 l,p,a=v8qa.bundle();d=l['release']['rules']['matrixDefinitions'];d['lightingTechnologyExecution']=policy()
 l['release']['providerSlot'].update(profileId='matrix-text-facts-lighting-technology-v9',adapterVersion='9',configHash=sha(d))
 lighting=deepcopy(M['validCases'][case]['package']);lighting['objectId']=l['objectId'];lighting['inputManifestHash']=l['inputManifestHash']
 for s in lighting['sources']:
  if s['review'] is not None:s['review']['objectId']=l['objectId']
 for o in lighting['origins']:o['objectId']=l['objectId']
 own=deepcopy(lighting['sources'])
 for s in p['waterNode']['sources']:
  item=deepcopy(s)
  if item['review'] is not None:item['review'].pop('waterNodeScope');item['review']['lightingTechnologyScope']=None
  lighting['sources'].append(item)
 for s in own:
  for domain,key in DOMAINS:
   item=deepcopy(s)
   if item['review'] is not None:item['review'].pop('lightingTechnologyScope');item['review'][key]=None
   p[domain]['sources'].append(item)
  sid=s['sourceFileId'];r=s['review']
  l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':s['sourceSha256'],'stages':deepcopy(s['stages']),
   'byteSize':1234,'mediaType':'application/pdf','sectionCode':r['sectionCode']if r else None,'downloadPath':'/api/internal/v1/jobs/local/inputs/'+sid})
  if r:l['inputs']['sourceDecisions'][sid]={**deepcopy(r),'basis':{'reference':'SYNTHETIC authored manual mapping; no stored authority'}}
  original=next(c['input']['textArtifact']for c in V2['cases']if c['input']['sourceSha256']==s['sourceSha256'])
  a[sid]=deepcopy(original)
 p.update(schemaVersion='matrix-reviewed-inventory-loader-inputs-v5',lightingTechnology=lighting)
 return l,p,a

def expected_lighting(l,case=0):
 e=deepcopy(M['validCases'][case]['expected']['envelope']);e.update(objectId=l['objectId'],inputManifestHash=l['inputManifestHash'])
 for r in e['results']:r['id']=sha({'hashDomain':'matrix-lighting-technology-execution-result-id-v1','objectId':e['objectId'],
  'inputManifestHash':e['inputManifestHash'],'capabilityRegistryHash':e['capabilityRegistryHash'],'result':{k:v for k,v in r.items()if k!='id'}})
 return e

class LightingDurableTests(unittest.TestCase):
 def test_manual_policy_all_five_registries_and_frozen_v8(self):
  l,_,_=bundle();d=l['release']['rules']['matrixDefinitions'];self.assertEqual(sha({k:v for k,v in d.items()if k!='lightingTechnologyExecution'}),'784b5827e6215552756b8d4a669f4310f90a50e23251af961d7d3c988007df7c')
  self.assertEqual(w._lighting_technology_policy(L),policy());self.assertEqual(w._load_capability_registries(),(AR,CALL,RAIL,WATER,L))
  with patch.object(v8,'_validate_release',side_effect=AssertionError('fake v8 release')):self.assertEqual(w._validate_release(l,AR,CALL,RAIL,WATER,L),(l['release']['providerSlot'],sha(d)))
 def test_direct_historical_v9_executor_five_domains_scalar_and_total_output_count(self):
  l,p,a=bundle();before=deepcopy((l,p,a))
  with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])),patch.object(v8,'execute_durable_water_node_matrix',side_effect=AssertionError('legacy execute')),patch.object(v8,'_validate_release',side_effect=AssertionError('fake release')):
   r=w.execute_durable_lighting_technology_matrix(l,ATTEMPT)
  self.assertEqual(r['providerProfileId'],'matrix-text-facts-lighting-technology-v9');self.assertEqual(r['lightingTechnologyComparisons'],expected_lighting(l));self.assertEqual(r['waterNodeComparisons'],v8qa.expected_water(l));self.assertEqual(r['railInventoryComparisons'],v8qa.v7qa.manual_rail_envelope(l));self.assertEqual(r['inventoryComparisons'],v8qa.v7qa.v6qa.manual_ar_envelope(l));self.assertEqual(r['callInventoryComparisons'],v8qa.v7qa.v6qa.C['cases'][0]['expectedEnvelope'])
  keys=['inventoryComparisons','callInventoryComparisons','railInventoryComparisons','waterNodeComparisons','lightingTechnologyComparisons']
  self.assertEqual(r['outputCount'],len(r['execution']['results'])+sum(len(r[k]['results'])for k in keys));self.assertEqual(len(r['execution']['results']),63)
  self.assertEqual(len(r['effectiveCoverage']),132);self.assertIn('projectConstraints',r);self.assertIn('sourceDeclarations',r)
  for k in keys:
   for result in r[k]['results']:self.assertIsNone(result.get('comparison',{}).get('calibratedProbability'))
  for row,base in zip(r['effectiveCoverage'],r['execution']['coverage']):
   if row['parameterCode']not in ['AR-053','ODI-123','ODI-120','ZU-129','ZU-130']:self.assertEqual(row,base)
  target=next(row for row in r['effectiveCoverage']if row['parameterCode']=='ZU-130');self.assertEqual((target['successfulComparisons'],target['abstentions'],target['executionStatus']),(1,0,'PARTIAL'));self.assertEqual((l,p,a),before)
 def test_current_adapter_rejects_historical_v9_reader_before_network_without_mutation(self):
  l,_,_=bundle();before=deepcopy((l,ATTEMPT))
  self.assertNotEqual(file_sha(w.document_text_v3),'9890c816bb1d8e424ed17424f9bae65b2393543b879640abfaab60606fb64314')
  with patch.object(w,'download_reviewed_inventory_comparison_inputs')as loader,patch.object(w,'download_text_artifact')as text:
   with self.assertRaisesRegex(ValueError,'^historical matrix runtime unavailable in current worker$'):
    PilotPz002RuleAdapter().execute(l,ATTEMPT)
   loader.assert_not_called();text.assert_not_called()
  self.assertEqual((l,ATTEMPT),before)
 def test_all_six_manual_semantics_unknown_unbound_equal_multiple(self):
  for index,c in enumerate(M['validCases']):
   l,p,a=bundle(index)
   with self.subTest(name=c['name']),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])):
    r=w.execute_durable_lighting_technology_matrix(l,ATTEMPT)
   self.assertEqual(r['lightingTechnologyComparisons'],expected_lighting(l,index))
   self.assertEqual(r['outputCount'],len(r['execution']['results'])+4+len(c['expected']['envelope']['results']))
 def test_slot_policy_every_leaf_rehashed_drift_rejects_before_network(self):
  l,_,_=bundle();paths=[]
  def walk(v,path=()):
   if type(v)is dict:
    for k,x in v.items():walk(x,path+(k,))
   else:paths.append(path)
  walk(l['release']['rules']['matrixDefinitions'])
  for path in paths:
   bad=deepcopy(l);node=bad['release']['rules']['matrixDefinitions']
   for k in path[:-1]:node=node[k]
   node[path[-1]]='FORGED';bad['release']['providerSlot']['configHash']=sha(bad['release']['rules']['matrixDefinitions'])
   with self.subTest(path=path),patch.object(w,'download_reviewed_inventory_comparison_inputs')as network:
    with self.assertRaises((ValueError,TypeError,KeyError)):w.execute_durable_lighting_technology_matrix(bad,ATTEMPT)
    network.assert_not_called()
  for key,value in [('profileId','matrix-text-facts-water-node-v8'),('adapterVersion','8'),('adapterVersion',9),('configHash','0'*64),('status','DISABLED')]:
   bad=deepcopy(l);bad['release']['providerSlot'][key]=value
   with self.subTest(field=key),patch.object(w,'download_reviewed_inventory_comparison_inputs')as network:
    with self.assertRaises(ValueError):w.execute_durable_lighting_technology_matrix(bad,ATTEMPT)
    network.assert_not_called()
 def test_all_common_source_maps_and_separate_valid_v3_origin_union(self):
  l,p,_=bundle();self.assertNotEqual(p['lightingTechnology']['origins'],p['waterNode']['origins']);self.assertEqual(w._validate_loader(p,l),p)
  for domain in ['inventory','callInventory','railInventory','waterNode','lightingTechnology']:
   bad=deepcopy(p);bad[domain]['sources'].pop()
   with self.subTest(domain=domain),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=bad),patch.object(w,'download_text_artifact')as text:
    with self.assertRaises(ValueError):w.execute_durable_lighting_technology_matrix(l,ATTEMPT)
    text.assert_not_called()
 def test_unknown_unrelated_reconstruction_and_origin_hash_fail_before_scalar_text(self):
  l,p,_=bundle()
  for mode in ['unknown','origin','object','sourceSha','review']:
   q=deepcopy(p);light=q['lightingTechnology'];source=light['sources'][0]
   if mode=='unknown':source['review']['lightingTechnologyScope']['claims'][0]['declarationSnapshot']['rawTechnology']='FLUORESCENT'
   elif mode=='origin':light['origins'][0]['textArtifact']['pages'][0]['locatedLines'][0]['rawText']='FORGED\n'
   elif mode=='object':light['objectId']='FOREIGN'
   elif mode=='sourceSha':source['sourceSha256']='0'*64
   else:source['review']['approvalStatus']='UNKNOWN'
   if mode=='review':
    # A valid but different interpretation cannot be hidden in just one package.
    source['review']['lightingTechnologyScope']=None
   with self.subTest(mode=mode),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as text:
    with self.assertRaises(ValueError):w.execute_durable_lighting_technology_matrix(l,ATTEMPT)
    text.assert_not_called()
 def test_transport_v5_exact_auth_path_and_fence(self):
  l,p,_=bundle()
  with v8qa.v7qa.v6qa.http_fixture(p,headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v5'},close=True)as state:
   self.assertEqual(w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT),p)
   self.assertEqual(state['requests'],[{'path':'/api/internal/v1/jobs/local%20qa%2Fjob%3F/lighting-technology-reviewed-inventory-comparison-inputs?attemptId=local-qa-attempt+%2F%3F&fencingToken=7','token':'synthetic-local-qa-token'}])
 def test_transport_status_headers_64mib_and_malformed_json_failclosed(self):
  l,p,_=bundle();http=v8qa.v7qa.v6qa.http_fixture
  for status,exception in [(401,ValueError),(409,w.TextArtifactLeaseLost),(302,ValueError)]:
   with self.subTest(status=status),http(p,status=status,close=True),self.assertRaises(exception):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
  for key in ['Content-Length','X-Content-SHA256','X-Artifact-Schema-Version','X-Input-Manifest-SHA256']:
   with self.subTest(header=key),http(p,omit=[key],close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
  for key,value in [('Content-Length',str(67108865)),('X-Content-SHA256','0'*64),('X-Artifact-Schema-Version','matrix-reviewed-inventory-loader-inputs-v4'),('X-Input-Manifest-SHA256','0'*64)]:
   with self.subTest(key=key,value=value),http(p,headers={key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
  raw=canonical(p);bad=[('{"schemaVersion":"bad",'+raw[1:]).encode(),b'{"x":NaN}',b'{"x":0.5}',b'\xff']
  for body in bad:
   with self.subTest(body=hashlib.sha256(body).hexdigest()),http(raw_body=body,headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v5'},close=True),self.assertRaises((ValueError,UnicodeError)):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
 def test_transport_overall_deadline_and_response_cleanup(self):
  l,p,_=bundle();http=v8qa.v7qa.v6qa.http_fixture
  for mode in ['header','body','drip']:
   started=time.monotonic()
   with self.subTest(mode=mode),http(p,headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v5'},delay_headers=.25 if mode=='header'else 0,delay_body=.25 if mode=='body'else 0,drip=mode=='drip',close=True),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.06),self.assertRaises((TimeoutError,socket.timeout)):
    w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
   self.assertLess(time.monotonic()-started,.9)
if __name__=='__main__':unittest.main()
