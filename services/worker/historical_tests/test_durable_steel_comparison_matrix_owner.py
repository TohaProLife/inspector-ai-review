"""T73 owner tests frozen before new durable module; expected rows from T70 manual.

Only explicit identity/object/hash rebinding is canonical stdlib computation;
no new durable or comparator implementation produces expected semantics.
"""
from copy import deepcopy
import hashlib,json,re,socket,time,unittest
from pathlib import Path
from unittest.mock import patch
import test_durable_lighting_technology_matrix as v9qa
from inspector_worker import durable_steel_comparison_matrix as w
from inspector_worker import durable_lighting_technology_matrix as v9
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
ROOT=Path(__file__).resolve().parents[3]
M=json.loads((ROOT/'fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json').read_text())
S=json.loads((ROOT/'fixtures/matrix-steel-durable-v1/root-manual-snapshots.json').read_text())
P=json.loads((ROOT/'output/matrix-t73-20261018/python-steel-policy-before-code.json').read_text())['policy']
canonical=v9qa.canonical;sha=v9qa.sha;ATTEMPT=v9qa.ATTEMPT
DOMAINS=[('inventory','inventoryScope'),('callInventory','callInventoryScope'),('railInventory','railInventoryScope'),('waterNode','waterNodeScope'),('lightingTechnology','lightingTechnologyScope')]
FIELDS=['decisionId','contentHash','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages']
DECISION='33333333-3333-4333-8333-333333333333'

def policy():
 p=deepcopy(P);p['durableWrapperSourceSha256']=hashlib.sha256(Path(w.__file__).read_bytes()).hexdigest();return p

def pair_key(object_id,d):
 return sha({'hashDomain':'matrix-kr056-steel-applicability-pair-key-v1','objectId':object_id,'identity':d['identity'],'expectedSourceFileId':d['expected']['sourceFileId'],'actualSourceFileId':d['actual']['sourceFileId']})

def snapshot(object_id,manifest,decisions):
 entries=[{'pairKey':pair_key(object_id,d),'decisionId':d['decisionId'],'sequenceNo':'9223372036854775807','journalContentHash':'e'*64,'projectionContentHash':d['contentHash'],'included':True}for d in decisions]
 body={'schemaVersion':'matrix-steel-applicability-run-snapshot-v1','objectId':object_id,'inputManifestHash':manifest,'entries':sorted(entries,key=lambda e:e['pairKey'])}
 return {**body,'contentHash':sha({'hashDomain':'matrix-kr056-steel-applicability-run-snapshot-json-v1','snapshot':body})}

def bundle(case=0):
 l,p,a=v9qa.bundle();d=l['release']['rules']['matrixDefinitions'];d['steelExecution']=policy()
 l['release']['providerSlot'].update(profileId='matrix-text-facts-steel-comparison-v10',adapterVersion='10',configHash=sha(d))
 steel=deepcopy(M['validCases'][case]['package']);steel.update(objectId=l['objectId'],inputManifestHash=l['inputManifestHash'])
 for s in steel['sources']:s['objectId']=l['objectId']
 for dec in steel['applicabilityDecisions']:
  dec.update(objectId=l['objectId'],decisionId=DECISION)
  dec['contentHash']=sha({'hashDomain':'matrix-kr056-steel-applicability-decision-json-v1','decision':{k:v for k,v in dec.items()if k!='contentHash'}})
 own=deepcopy(steel['sources'])
 for s in p['waterNode']['sources']:
  r=s['review'];steel['sources'].append({'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'objectId':l['objectId'],'stages':deepcopy(s['stages']),'review':{**{k:deepcopy(r[k])for k in FIELDS},'steelComparisonScope':None}if r else None})
 for s in own:
  sid=s['sourceFileId'];r=s['review']
  for domain,key in DOMAINS:
   oldr={**deepcopy(r),'objectId':l['objectId'],'sourceFileId':sid,'sourceSha256':s['sourceSha256'],'actorId':'SYNTHETIC-T73-ACTOR',key:None}if r else None
   if oldr:oldr.pop('steelComparisonScope')
   p[domain]['sources'].append({'sourceFileId':sid,'sourceSha256':s['sourceSha256'],'stages':deepcopy(s['stages']),'reviewSnapshot':{'decisionId':r['decisionId'],'contentHash':r['contentHash']}if r else None,'review':oldr})
  l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':s['sourceSha256'],'stages':deepcopy(s['stages']),'byteSize':1234,'mediaType':'application/pdf','sectionCode':r['sectionCode']if r else None,'downloadPath':'/api/internal/v1/jobs/local/inputs/'+sid})
  if r:l['inputs']['sourceDecisions'][sid]={**deepcopy(r),'sourceFileId':sid,'sourceSha256':s['sourceSha256'],'objectId':l['objectId'],'basis':{'reference':'SYNTHETIC authored review only'}}
 for o in steel['origins']:a[o['sourceFileId']]=deepcopy(o['textArtifact'])
 for sid,review in list(l['inputs']['sourceDecisions'].items()):
  l['inputs']['sourceDecisions'][sid]={k:deepcopy(review[k])for k in ['sourceSha256','revisionStatus','approvalStatus','linkGroupId','sectionCode','pageStages','basis','scopeProofs']if k in review}
 p.update(schemaVersion='matrix-reviewed-inventory-loader-inputs-v6',steelComparison=steel,steelApplicabilitySnapshot=snapshot(l['objectId'],l['inputManifestHash'],steel['applicabilityDecisions']))
 return l,p,a

def expected_steel(l,p,case=0):
 e=deepcopy(M['validCases'][case]['expected']['envelope']);e.update(objectId=l['objectId'],inputManifestHash=l['inputManifestHash'])
 for r in e['results']:
  comp=r.get('comparison',{}).get('comparison')
  if comp:
   dec=p['steelComparison']['applicabilityDecisions'][0];comp.update(applicabilityDecisionId=dec['decisionId'],applicabilityDecisionContentHash=dec['contentHash'])
  r['id']=sha({'hashDomain':'matrix-steel-execution-result-id-v1','objectId':e['objectId'],'inputManifestHash':e['inputManifestHash'],'capabilityRegistryHash':e['capabilityRegistryHash'],'result':{k:v for k,v in r.items()if k!='id'}})
 return e

class SteelDurableOwnerTests(unittest.TestCase):
 def test_policy_exact_v9_and_six_registries(self):
  l,_,_=bundle();d=l['release']['rules']['matrixDefinitions'];self.assertEqual(sha({k:v for k,v in d.items()if k!='steelExecution'}),'c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84')
  self.assertEqual(w._steel_policy(M['capabilityRegistry']),policy());self.assertEqual(w._load_capability_registries(),(*v9._load_capability_registries(),M['capabilityRegistry']))
  with patch.object(v9,'_validate_release',side_effect=AssertionError('legacy release spoof')):self.assertEqual(w._validate_release(l,*w._load_capability_registries()),(l['release']['providerSlot'],sha(d)))
 def test_actual_v10_adapter_six_domains_scalar_coverage_and_immutability(self):
  l,p,a=bundle();before=deepcopy((l,p,a))
  with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])),patch.object(v9,'execute_durable_lighting_technology_matrix',side_effect=AssertionError('legacy execute')),patch.object(v9,'_validate_release',side_effect=AssertionError('legacy release spoof')):
   r=PilotPz002RuleAdapter().execute(l,ATTEMPT)
  self.assertEqual(r['providerProfileId'],'matrix-text-facts-steel-comparison-v10');self.assertEqual(r['steelComparisons'],expected_steel(l,p));self.assertEqual(r['steelApplicabilitySnapshot'],p['steelApplicabilitySnapshot']);self.assertEqual(r['lightingTechnologyComparisons'],v9qa.expected_lighting(l))
  for key,expected in [('waterNodeComparisons',v9qa.v8qa.expected_water(l)),('railInventoryComparisons',v9qa.v8qa.v7qa.manual_rail_envelope(l)),('inventoryComparisons',v9qa.v8qa.v7qa.v6qa.manual_ar_envelope(l)),('callInventoryComparisons',v9qa.v8qa.v7qa.v6qa.C['cases'][0]['expectedEnvelope'])]:self.assertEqual(r[key],expected)
  keys=['inventoryComparisons','callInventoryComparisons','railInventoryComparisons','waterNodeComparisons','lightingTechnologyComparisons','steelComparisons'];self.assertEqual(len(r['execution']['results']),63);self.assertEqual(r['outputCount'],63+sum(len(r[k]['results'])for k in keys))
  self.assertEqual(len(r['effectiveCoverage']),132);self.assertEqual((sum(x['implementedAtomicRules']>0 for x in r['effectiveCoverage']),sum(x['implementedAtomicRules']for x in r['effectiveCoverage']),sum(x['executionStatus']=='UNSUPPORTED' for x in r['effectiveCoverage'])),(61,69,71))
  for row,base in zip(r['effectiveCoverage'],r['execution']['coverage']):
   if row['parameterCode'] not in ['AR-053','ODI-123','ODI-120','ZU-129','ZU-130','KR-056']:self.assertEqual(row,base)
  for k in keys:
   for row in r[k]['results']:self.assertIsNone(row.get('calibratedProbability',row.get('comparison',{}).get('calibratedProbability')))
  self.assertEqual((l,p,a),before)
 def test_nine_frozen_t70_operational_semantics(self):
  for case,c in enumerate(M['validCases']):
   l,p,a=bundle(case)
   with self.subTest(name=c['name']),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(a[s['sourceFileId']])):r=w.execute_durable_steel_comparison_matrix(l,ATTEMPT)
   self.assertEqual(r['steelComparisons'],expected_steel(l,p,case));self.assertEqual(r['steelApplicabilitySnapshot'],p['steelApplicabilitySnapshot'])
 def test_independent_snapshot_five_whole_cases_and_invalid_sequence_values(self):
  for c in S['validCases']:
   with self.subTest(name=c['name']):self.assertEqual(w._validate_snapshot(c['expectedSnapshot'],c['package']),c['expectedSnapshot'])
  good=S['validCases'][0]
  for seq in S['invalidSequenceValues']:
   bad=deepcopy(good['expectedSnapshot']);bad['entries'][0]['sequenceNo']=seq;bad['contentHash']=sha({'hashDomain':'matrix-kr056-steel-applicability-run-snapshot-json-v1','snapshot':{k:v for k,v in bad.items()if k!='contentHash'}})
   with self.subTest(sequence=seq),self.assertRaises(ValueError):w._validate_snapshot(bad,good['package'])
 def test_snapshot_bijection_hash_order_pair_key_flags_fail_before_text(self):
  l,p,_=bundle()
  for mode in ['missing','excluded','projectionHash','pairKey','decisionId','bodyHash','object','manifest','duplicate','extra']:
   bad=deepcopy(p);s=bad['steelApplicabilitySnapshot'];entry=s['entries'][0]
   if mode=='missing':s['entries']=[]
   elif mode=='excluded':entry['included']=False
   elif mode in ['projectionHash','pairKey']:entry[mode]='0'*64
   elif mode=='decisionId':entry[mode]='44444444-4444-4444-8444-444444444444'
   elif mode=='bodyHash':s['contentHash']='0'*64
   elif mode=='object':s['objectId']='FOREIGN'
   elif mode=='manifest':s['inputManifestHash']='0'*64
   elif mode=='duplicate':s['entries'].append(deepcopy(entry))
   else:entry['extra']=True
   if mode!='bodyHash':s['contentHash']=sha({'hashDomain':'matrix-kr056-steel-applicability-run-snapshot-json-v1','snapshot':{k:v for k,v in s.items()if k!='contentHash'}})
   with self.subTest(mode=mode),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=bad),patch.object(w,'download_text_artifact')as download:
    with self.assertRaises(ValueError):w.execute_durable_steel_comparison_matrix(l,ATTEMPT)
    download.assert_not_called()
 def test_all_retained_reconstruction_cross_domain_sources_and_lease(self):
  l,p,_=bundle()
  for mode in ['scope','origin','source','review','lease']:
   q=deepcopy(p);lease=deepcopy(l)
   if mode=='scope':q['steelComparison']['sources'][0]['review']['steelComparisonScope']['claims'][0]['declarationSnapshot']['value']='С245'
   elif mode=='origin':q['steelComparison']['origins'][0]['textArtifact']['pages'][0]['blocks'][0]['text']='forged'
   elif mode=='source':q['steelComparison']['sources'].pop()
   elif mode=='review':q['steelComparison']['sources'][0]['review']['approvalStatus']='UNKNOWN'
   else:lease['inputs']['sourceFiles'][0]['sha256']='0'*64
   with self.subTest(mode=mode),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as download:
    with self.assertRaises(ValueError):w.execute_durable_steel_comparison_matrix(lease,ATTEMPT)
    download.assert_not_called()
 def test_actual_job_lease_review_metadata_before_text(self):
  l,p,_=bundle();expected={'sourceSha256','revisionStatus','approvalStatus','linkGroupId','sectionCode','pageStages','basis'}
  self.assertTrue(all(set(r) in [expected,expected|{'scopeProofs'}]for r in l['inputs']['sourceDecisions'].values()))
  self.assertEqual(w._validate_loader(p,l)['steelComparison'],p['steelComparison'])
  for field,value in [('sourceSha256','0'*64),('revisionStatus','UNKNOWN'),('approvalStatus','UNKNOWN'),('sectionCode','OV'),('linkGroupId','OTHER'),('pageStages',{'1':'RD'}),('basis',{'reference':''})]:
   q=deepcopy(l);sid=p['steelComparison']['sources'][0]['sourceFileId'];q['inputs']['sourceDecisions'][sid][field]=value
   with self.subTest(field=field),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact')as download:
    with self.assertRaises(ValueError):w.execute_durable_steel_comparison_matrix(q,ATTEMPT)
    download.assert_not_called()
 def test_rehashed_policy_and_slot_drift_no_network(self):
  l,_,_=bundle()
  for key in policy():
   q=deepcopy(l);d=q['release']['rules']['matrixDefinitions'];d['steelExecution'][key]='FORGED';q['release']['providerSlot']['configHash']=sha(d)
   with self.subTest(key=key),patch.object(w,'download_reviewed_inventory_comparison_inputs')as download:
    with self.assertRaises((ValueError,TypeError,KeyError)):w.execute_durable_steel_comparison_matrix(q,ATTEMPT)
    download.assert_not_called()
  q=deepcopy(l);q['release']['rules']['matrixDefinitions']['lightingTechnologyExecution']['typedExecutionVersion']='FORGED';q['release']['providerSlot']['configHash']=sha(q['release']['rules']['matrixDefinitions'])
  with patch.object(w,'download_reviewed_inventory_comparison_inputs')as download:
   with self.assertRaises(ValueError):w.execute_durable_steel_comparison_matrix(q,ATTEMPT)
   download.assert_not_called()
 def test_native_callbacks_zero_and_limits(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError()
   def __iter__(self):calls.append('iter');raise AssertionError()
  cycle={};cycle['cycle']=cycle;l,p,_=bundle()
  for raw in [Hostile(),cycle,{'n':.5},{'n':9007199254740992},{'x':'\ud800'},{'ключ':1}]:
   with self.assertRaises(ValueError):w._validate_loader(raw,l)
  self.assertEqual(calls,[])
  q=deepcopy(p);q['steelApplicabilitySnapshot']['entries']=[q['steelApplicabilitySnapshot']['entries'][0]]*17
  with self.assertRaises(ValueError):w._validate_loader(q,l)
 def test_transport_exact_v6_headers_statuses_json_and_cleanup(self):
  l,p,_=bundle();http=v9qa.v8qa.v7qa.v6qa.http_fixture;headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v6'}
  with http(p,headers=headers,close=True)as state:
   self.assertEqual(w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT),p);self.assertIn('/steel-reviewed-inventory-comparison-inputs?',state['requests'][0]['path'])
  for key,value in [('X-Artifact-Schema-Version','matrix-reviewed-inventory-loader-inputs-v5'),('X-Input-Manifest-SHA256','0'*64),('X-Content-SHA256','0'*64),('Content-Length','67108865')]:
   with self.subTest(key=key),http(p,headers={**headers,key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
  for status,exc in [(409,w.TextArtifactLeaseLost),(401,ValueError),(302,ValueError)]:
   with http(p,status=status,close=True),self.assertRaises(exc):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
  for body in [('{'+'"schemaVersion":"bad",'+canonical(p)[1:]).encode(),b'{"x":NaN}',b'{"x":0.5}',b'{"x":9007199254740992}',b'\xff']:
   with http(raw_body=body,headers=headers,close=True),self.assertRaises((ValueError,UnicodeError)):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)
 def test_transport_overall_deadline(self):
  l,p,_=bundle();http=v9qa.v8qa.v7qa.v6qa.http_fixture
  for mode in ['header','body','drip']:
   with self.subTest(mode=mode),http(p,headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v6'},delay_headers=.25 if mode=='header'else 0,delay_body=.25 if mode=='body'else 0,drip=mode=='drip',close=True),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.06),self.assertRaises((TimeoutError,socket.timeout)):w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT)

if __name__=='__main__':unittest.main()
