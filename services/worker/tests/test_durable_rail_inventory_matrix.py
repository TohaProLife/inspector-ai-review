"""Independent v7 worker QA: manual frozen domain oracles, localhost transport only."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib,json,os,socket,time,unittest
from pathlib import Path
from unittest.mock import patch
import test_durable_call_inventory_matrix as v6qa
from inspector_worker import durable_rail_inventory_matrix as w
from inspector_worker import durable_call_inventory_matrix as v6
from inspector_worker import durable_inventory_matrix as v5
from inspector_worker import durable_matrix
ROOT=Path(__file__).resolve().parents[3]
R=json.loads((ROOT/'fixtures/matrix-rail-execution-v1/ts-rail-execution-wire-manual-goldens.json').read_text())
AR=v6qa.AR;CALL=v6qa.CALL;RAIL=R['capabilityRegistry'];ATTEMPT=deepcopy(v6qa.ATTEMPT)
canonical=v6qa.canonical;sha=v6qa.sha;file_sha=v6qa.file_sha
RECORDS=[]
def expected_policy():
 return {'schemaVersion':'matrix-rail-inventory-comparisons-v1','purpose':'MACHINE_COMPARISON',
  'baseProfileId':'matrix-text-facts-call-inventory-v6','baseConfigHash':'dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad',
  'capabilityRegistry':deepcopy(RAIL),'capabilityRegistryHash':'1a50046599c3c2c0965919a33615da4254dc9e0a1e05f4bedb723d94de2be409',
  'comparisonVersion':'matrix-odi120-rail-inventory-comparison-v1','comparisonSourceSha256':file_sha(w.rail_inventory_comparison),
  'sourceReconstructionVersion':'matrix-odi120-rail-inventory-source-v1','sourceReconstructionSourceSha256':file_sha(w.rail_inventory_source),
  'typedExecutionVersion':'matrix-rail-inventory-execution-v1','typedExecutionSourceSha256':file_sha(w.rail_inventory_execution),
  'durableWrapperVersion':'matrix-rail-inventory-execution-v1','durableWrapperSourceSha256':file_sha(w),
  'coveragePolicyVersion':'matrix-rail-inventory-coverage-v1','submissionPolicyVersion':'matrix-rail-inventory-submission-v1',
  'hashPolicyVersion':'matrix-rail-inventory-result-json-v1'}
def lease():
 l=v6qa.lease();d=l['release']['rules']['matrixDefinitions'];d['railExecution']=expected_policy()
 l['release']['providerSlot'].update(profileId='matrix-text-facts-rail-inventory-v7',adapterVersion='7',configHash=sha(d));return l
def rehash(l):l['release']['providerSlot']['configHash']=sha(l['release']['rules']['matrixDefinitions'])
def bundle(extras=False,rail_case=0):
 old,package,artifacts=v6qa.bundle(extras);l=lease();l['inputs']=old['inputs'];r=deepcopy(R['validCases'][rail_case]['package'])
 r['objectId']=l['objectId'];r['inputManifestHash']=l['inputManifestHash']
 for s in r['sources']:s['review']['objectId']=l['objectId']
 for o in r['origins']:o['objectId']=l['objectId']
 originals=deepcopy(r['sources'])
 for s in package['callInventory']['sources']:
  s=deepcopy(s)
  if s['review'] is not None:s['review'].pop('callInventoryScope');s['review']['railInventoryScope']=None
  r['sources'].append(s)
 for s in originals:
  for domain,key in [('inventory','inventoryScope'),('callInventory','callInventoryScope')]:
   ss=deepcopy(s);ss['review'].pop('railInventoryScope');ss['review'][key]=None;package[domain]['sources'].append(ss)
  sid=s['sourceFileId'];review=s['review']
  l['inputs']['sourceFiles'].append({'sourceFileId':sid,'sha256':s['sourceSha256'],'stages':deepcopy(s['stages']),
   'byteSize':1234,'mediaType':'application/pdf','sectionCode':review['sectionCode'],'downloadPath':'/api/internal/v1/jobs/local/inputs/'+sid})
  l['inputs']['sourceDecisions'][sid]={**deepcopy(review),'basis':{'reference':'Synthetic authored review; no database authority'}}
 origins=deepcopy(package['callInventory']['origins']+r['origins'])
 for domain in [package['inventory'],package['callInventory'],r]:domain['origins']=deepcopy(origins)
 for o in r['origins']:artifacts[o['sourceFileId']]=deepcopy(o['textArtifact'])
 package.update(schemaVersion='matrix-reviewed-inventory-loader-inputs-v3',railInventory=r)
 return l,package,artifacts

def manual_rail_envelope(l,rail_case=0):
 e=deepcopy(R['validCases'][rail_case]['expectedEnvelope']);e['objectId']=l['objectId'];e['inputManifestHash']=l['inputManifestHash']
 for row in e['results']:
  body={k:v for k,v in row.items()if k!='id'};row['id']=sha({'hashDomain':'matrix-rail-inventory-execution-result-id-v1',
   'objectId':e['objectId'],'inputManifestHash':e['inputManifestHash'],'capabilityRegistryHash':e['capabilityRegistryHash'],'result':body})
 return e
@contextmanager
def http_fixture(body=None,**options):
 if body is None:body=bundle()[1]
 headers={'X-Artifact-Schema-Version':'matrix-reviewed-inventory-loader-inputs-v3'};headers.update(options.pop('headers',{}) or {})
 with v6qa.http_fixture(body,headers=headers,**options)as state:yield state
ORIGINAL_LEASE=lease()

class PolicyTests(unittest.TestCase):
 def assert_rejected_before_network(self,l):
  with patch.object(w,'download_reviewed_inventory_comparison_inputs')as network,patch.object(w,'download_text_artifact')as text:
   with self.assertRaises(ValueError):w.execute_durable_rail_inventory_matrix(l,ATTEMPT)
   network.assert_not_called();text.assert_not_called()
 def test_manual_policy_and_unchanged_v6_v5_v4(self):
  l=lease();d=l['release']['rules']['matrixDefinitions'];self.assertEqual(w._rail_inventory_policy(RAIL),expected_policy())
  self.assertEqual(sha({k:v for k,v in d.items()if k!='railExecution'}),'dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad')
  self.assertEqual(w._load_capability_registries(),(AR,CALL,RAIL))
  with patch.object(v6,'_validate_release',side_effect=AssertionError('spoofed v6')),patch.object(v5,'_validate_release',side_effect=AssertionError('spoofed v5')):
   self.assertEqual(w._validate_release(l,AR,CALL,RAIL),(l['release']['providerSlot'],sha(d)))
 def test_v1_to_v6_profiles_adapters_and_slot_faults(self):
  profiles=['matrix-text-facts-v1','matrix-text-facts-constraints-v2','matrix-text-facts-evidence-v3','matrix-text-facts-evidence-v4','matrix-text-facts-inventory-v5','matrix-text-facts-call-inventory-v6']
  changes=[('profileId',x)for x in profiles]+[('adapterVersion',str(x))for x in range(1,7)]+[('adapterVersion',7),('providerKind','OCR_LAYOUT'),('stageJobType','TEXT_EXTRACTION'),('status','DISABLED'),('configHash','0'*64)]
  for key,value in changes:
   l=lease();l['release']['providerSlot'][key]=value
   with self.subTest(key=key,value=value):self.assert_rejected_before_network(l)
 def test_definition_every_leaf_missing_changed_extra_rehashed(self):
  paths=[]
  def walk(value,path=()):
   if type(value)is dict:
    for key,child in value.items():walk(child,path+(key,))
   else:paths.append(path)
  walk(ORIGINAL_LEASE['release']['rules']['matrixDefinitions'])
  for path in paths:
   for mode in ['missing','changed','extra']:
    l=deepcopy(ORIGINAL_LEASE);node=l['release']['rules']['matrixDefinitions']
    for key in path[:-1]:node=node[key]
    if mode=='missing':node.pop(path[-1])
    elif mode=='changed':node[path[-1]]='invalid'
    else:node['extraField']=True
    rehash(l)
    with self.subTest(path=path,mode=mode):self.assert_rejected_before_network(l)
  RECORDS.append({'case':'all-definition-leaves','mutations':len(paths)*3})
 def test_lifecycle_and_network_faults(self):
  for key,value in [('lifecycle','RELEASED'),('externalNetworkAllowed',True),('externalNetworkAllowed',0)]:
   l=lease();l['release'][key]=value
   with self.subTest(key=key,value=value):self.assert_rejected_before_network(l)
 def test_new_registry_native_bool_not_number(self):
  for value in [1,1.0]:
   l=lease();l['release']['rules']['matrixDefinitions']['railExecution']['capabilityRegistry']['entries'][0]['enabled']=value;rehash(l)
   with self.subTest(value=repr(value)):self.assert_rejected_before_network(l)
 def test_runtime_source_pins_before_network(self):
  modules=[w.matrix_engine,w.matrix_fact_scope,w.project_zero_prose,w.rebar_prose,w.concrete_prose,w.project_constraints,
   w.source_declarations,w.source_declarations_v2,w.steel_prose,w.fire_resistance_table,w.table_row_binding,
   v5.ar053_inventory_comparison,v5.inventory_source,v5._inventory_execution,w.odi123_call_inventory_comparison,w.call_inventory_source,w.call_inventory_execution,
   w.rail_inventory_comparison,w.rail_inventory_source,w.rail_inventory_execution]
  actual=w._file
  for module in modules:
   def corrupt(m):return '0'*64 if m is module else actual(m)
   with self.subTest(module=module.__name__),patch.object(w,'_file',side_effect=corrupt),patch.object(v5,'_file',side_effect=corrupt),patch.object(v6,'_file',side_effect=corrupt):self.assert_rejected_before_network(deepcopy(ORIGINAL_LEASE))
 def test_never_calls_old_execute_or_release_validator(self):
  l,p,artifacts=bundle()
  with patch.object(v6,'execute_durable_call_inventory_matrix',side_effect=AssertionError('legacy execute')),patch.object(v6,'_validate_release',side_effect=AssertionError('forged v6')),patch.object(v5,'execute_durable_inventory_matrix',side_effect=AssertionError('legacy execute')),patch.object(v5,'_validate_release',side_effect=AssertionError('forged v5')),patch.object(durable_matrix,'execute_durable_matrix',side_effect=AssertionError('legacy scalar execute')),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])):
   result=w.execute_durable_rail_inventory_matrix(l,ATTEMPT)
  self.assertEqual(result['providerProfileId'],'matrix-text-facts-rail-inventory-v7')

class ExecutionTests(unittest.TestCase):
 def test_full_original_scalar_constraints_declarations_and_three_candidates(self):
  l,p,artifacts=bundle(extras=True);before=deepcopy((l,p,artifacts));sources=[]
  for source in l['inputs']['sourceFiles']:
   decision=l['inputs']['sourceDecisions'].get(source['sourceFileId']);sources.append({**source,**w._reviewed_source(source,decision),'scopeProofs':(decision or{}).get('scopeProofs',{})})
  texts=list(artifacts.values())
  scalar=w.matrix_engine.build_matrix_execution(object_id=l['objectId'],input_manifest_hash=l['inputManifestHash'],sources=sources,text_artifacts=texts,registry=w.matrix_engine.load_matrix_registry())
  constraints=w.project_constraints.extract_project_constraints(l['objectId'],l['inputManifestHash'],sources,texts)
  declarations=w.source_declarations_v2.extract_source_declarations({'objectId':l['objectId'],'inputManifestHash':l['inputManifestHash'],'sources':sources,'textArtifacts':texts})
  with http_fixture(p,close=True),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']]))as text:result=w.execute_durable_rail_inventory_matrix(l,ATTEMPT)
  self.assertEqual(result['execution'],scalar);self.assertEqual(result['projectConstraints'],constraints);self.assertEqual(result['sourceDeclarations'],declarations)
  self.assertEqual(len(constraints['constraints']),1);self.assertEqual(len(declarations['declarations']),8)
  self.assertEqual(result['inventoryComparisons'],v6qa.manual_ar_envelope(l));self.assertEqual(result['callInventoryComparisons'],v6qa.C['cases'][0]['expectedEnvelope']);self.assertEqual(result['railInventoryComparisons'],manual_rail_envelope(l))
  self.assertEqual(result['outputCount'],len(scalar['results'])+3);self.assertEqual(text.call_count,len(artifacts))
  self.assertEqual(set(result),{'schemaVersion','jobType','inputManifestHash','disposition','providerKind','providerProfileId','providerConfigHash','outputCount','execution','projectConstraints','sourceDeclarations','inventoryComparisons','callInventoryComparisons','railInventoryComparisons','effectiveCoverage'})
  for a,b in zip(scalar['coverage'],result['effectiveCoverage']):
   if a['parameterCode']not in {'AR-053','ODI-123','ODI-120'}:self.assertEqual(canonical(a),canonical(b))
   else:self.assertEqual(tuple(b[k]for k in ['implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures','executionStatus']),(1,1,1,1,0,0,'PARTIAL'))
  for key in ['inventoryComparisons','callInventoryComparisons','railInventoryComparisons']:self.assertIsNone(result[key]['results'][0]['comparison']['calibratedProbability'])
  self.assertEqual((l,p,artifacts),before)
  RECORDS.append({'case':'actual-v7-full-originals','pages':sum(a['pageCount']for a in artifacts.values()),'scalarObservations':len(scalar['observations']),'scalarRows':len(scalar['results']),'typedRows':3,'constraints':1,'declarations':8,'configHash':result['providerConfigHash'],'scalarExecutionSha256':sha(scalar)})
 def test_frozen_unknown_ambiguity_withdrawal_and_restore_manual_envelopes(self):
  for index in [2,3,4,5,6,0]:
   with self.subTest(name=R['validCases'][index]['name']):
    l,p,artifacts=bundle(rail_case=index);before=deepcopy((l,p,artifacts))
    with patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=p),patch.object(w,'download_text_artifact',side_effect=lambda _l,s,_a:deepcopy(artifacts[s['sourceFileId']])):
     result=w.execute_durable_rail_inventory_matrix(l,ATTEMPT)
    self.assertEqual(result['railInventoryComparisons'],manual_rail_envelope(l,index));self.assertEqual(result['inventoryComparisons'],v6qa.manual_ar_envelope(l));self.assertEqual(result['callInventoryComparisons'],v6qa.C['cases'][0]['expectedEnvelope'])
    row=next(x for x in result['effectiveCoverage']if x['parameterCode']=='ODI-120');self.assertEqual((row['successfulComparisons'],row['abstentions'],row['failures']),(1,0,0)if index==0 else(0,1,0))
    self.assertEqual(result['outputCount'],len(result['execution']['results'])+3);self.assertEqual((l,p,artifacts),before)
 def test_actual_lease_source_shape_and_order_independence(self):
  l,p,_=bundle()
  for s in l['inputs']['sourceFiles']:self.assertEqual(set(s),{'sourceFileId','sha256','stages','sectionCode','byteSize','mediaType','downloadPath'})
  for domain in ['inventory','callInventory','railInventory']:p[domain]['sources'].reverse();p[domain]['origins'].reverse()
  self.assertEqual(w._validate_loader(p,l),p)
 def test_all_domains_projection_origin_lease_faults_before_text(self):
  l,p,_=bundle();faults=[]
  def add(name,f):q=deepcopy(p);ll=deepcopy(l);f(q,ll);faults.append((name,q,ll))
  for domain in ['inventory','callInventory','railInventory']:
   add(domain+'-missing-source',lambda q,l,d=domain:q[d]['sources'].pop());add(domain+'-origin-union',lambda q,l,d=domain:q[d]['origins'].pop());add(domain+'-object',lambda q,l,d=domain:q[d].update(objectId='wrong'))
   add(domain+'-retained-artifact',lambda q,l,d=domain:q[d]['origins'][-1]['textArtifact']['pages'][0]['blocks'][0].update(text='FORGED'))
  add('lease-source-sha',lambda q,l:l['inputs']['sourceFiles'][0].update(sha256='0'*64));add('lease-source-stage',lambda q,l:l['inputs']['sourceFiles'][0].update(stages=['RD']));add('duplicate-lease-source',lambda q,l:l['inputs']['sourceFiles'].append(deepcopy(l['inputs']['sourceFiles'][0])))
  add('missing-lease-review',lambda q,l:l['inputs']['sourceDecisions'].pop(l['inputs']['sourceFiles'][0]['sourceFileId']));add('unknown-lease-decision',lambda q,l:l['inputs']['sourceDecisions'].update(extra={}));add('wrong-optional-object-id',lambda q,l:l['inputs']['sourceFiles'][0].update(objectId='wrong'))
  for name,q,ll in faults:
   with self.subTest(name=name),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as text,patch.object(w.matrix_engine,'build_matrix_execution')as scalar:
    with self.assertRaises(ValueError):w.execute_durable_rail_inventory_matrix(ll,ATTEMPT)
    text.assert_not_called();scalar.assert_not_called()
  RECORDS.append({'case':'three-domain-projection-integrity','mutations':len(faults)})
 def test_unknown_claim_raw_forgery_all_domains_never_skipped(self):
  l,p,_=bundle()
  for domain,sibling in [('inventory','inventoryScope'),('callInventory','callInventoryScope'),('railInventory','railInventoryScope')]:
   q=deepcopy(p);source=next(s for s in q[domain]['sources']if s['review']and s['review'][sibling]);source['review']['approvalStatus']='UNKNOWN';source['review'][sibling]['claims'][0]['inventorySnapshot']['featureRows'][0]['fragments'][0]['rawText']='FORGED'
   with self.subTest(domain=domain),patch.object(w,'download_reviewed_inventory_comparison_inputs',return_value=q),patch.object(w,'download_text_artifact')as text:
    with self.assertRaises(ValueError):w.execute_durable_rail_inventory_matrix(l,ATTEMPT)
    text.assert_not_called()

class HttpTests(unittest.TestCase):
 def test_http_path_auth_and_connection_close(self):
  l,p,_=bundle()
  for close in [False,True]:
   with self.subTest(close=close),http_fixture(p,close=close)as state:
    self.assertEqual(w.download_reviewed_inventory_comparison_inputs(l,ATTEMPT),p)
    self.assertEqual(state['requests'],[{'path':'/api/internal/v1/jobs/local%20qa%2Fjob%3F/rail-reviewed-inventory-comparison-inputs?attemptId=local-qa-attempt+%2F%3F&fencingToken=7','token':'synthetic-local-qa-token'}])
 def test_status_401_409_and_no_redirect(self):
  for code,error in [(401,ValueError),(409,w.TextArtifactLeaseLost),(302,ValueError)]:
   with self.subTest(code=code),http_fixture(status=code,close=True),self.assertRaises(error):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_missing_and_forged_headers(self):
  for key in ['Content-Length','X-Content-SHA256','X-Artifact-Schema-Version','X-Input-Manifest-SHA256']:
   with self.subTest(missing=key),http_fixture(omit=[key],close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  for key,value in [('Content-Length','0'),('Content-Length','-1'),('Content-Length','2.0'),('Content-Length',str(w.MAX_LOADER_BYTES+1)),('X-Content-SHA256','0'*64),('X-Content-SHA256','BAD'),('X-Artifact-Schema-Version','matrix-ar053-loader-inputs-v1'),('X-Input-Manifest-SHA256','0'*64)]:
   with self.subTest(key=key,value=value),http_fixture(headers={key:value},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_exact_transport_cap_and_short_body(self):
  p=bundle()[1];body=canonical(p).encode()
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(body)-1),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  with http_fixture(p),patch.object(w,'MAX_LOADER_BYTES',len(body)):self.assertEqual(w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT),p)
  with http_fixture(raw_body=body[:-1],headers={'Content-Length':str(len(body)),'X-Content-SHA256':hashlib.sha256(body).hexdigest()},close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_duplicate_json_utf8_nan_and_exact_top_keys(self):
  body=canonical(bundle()[1]);bad=[('{"objectId":"wrong",'+body[1:]).encode(),body.replace('"schemaVersion":','"schemaVersion":"old","schemaVersion":',1).encode(),b'\xff',b'[]',b'not-json',b'{"x":NaN}']
  for raw in bad:
   with self.subTest(bodySha=hashlib.sha256(raw).hexdigest()),http_fixture(raw_body=raw,close=True),self.assertRaises((ValueError,UnicodeError)):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
  for key,value in [('objectId','wrong'),('inputManifestHash','0'*64),('schemaVersion','old'),('extra',True)]:
   p=bundle()[1];p[key]=value
   with self.subTest(field=key),http_fixture(p,close=True),self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
 def test_stall_header_body_and_drip_overall_deadline(self):
  for mode in ['header','body','drip']:
   started=time.monotonic()
   with self.subTest(mode=mode),http_fixture(delay_headers=.25 if mode=='header'else 0,delay_body=.25 if mode=='body'else 0,drip=mode=='drip',close=True),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.06),self.assertRaises((TimeoutError,socket.timeout)):
    w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertLess(time.monotonic()-started,.8)
 def test_cleanup_success_status_bad_header_timeout(self):
  actual=w.http.client.HTTPConnection
  for mode in ['success','401','header','timeout']:
   seen=[]
   class Track(actual):
    def __init__(self,*a,**kw):super().__init__(*a,**kw);self.response=None;self.closed=False;seen.append(self)
    def getresponse(self):self.response=super().getresponse();return self.response
    def close(self):self.closed=True;super().close()
   options={'close':True}
   if mode=='401':options['status']=401
   if mode=='header':options['headers']={'X-Content-SHA256':'bad'}
   if mode=='timeout':options['delay_body']=.2
   with self.subTest(mode=mode),http_fixture(**options),patch.object(w.http.client,'HTTPConnection',Track),patch.object(w,'LOADER_SOCKET_DEADLINE_SECONDS',.05):
    if mode=='success':w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
    else:
     with self.assertRaises((ValueError,TimeoutError)):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   self.assertEqual(len(seen),1);self.assertTrue(seen[0].closed);self.assertIsNone(seen[0].sock);self.assertTrue(seen[0].response.isclosed())
 def test_attempt_and_internal_url_fail_before_socket(self):
  for attempt in [{},dict(ATTEMPT,fencingToken=True),dict(ATTEMPT,fencingToken=0),dict(ATTEMPT,attemptId='')]:
   with self.subTest(attempt=attempt),patch.object(w.http.client,'HTTPConnection')as connect,self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),attempt)
   connect.assert_not_called()
  for url in ['file:///tmp/file','http://user:password@127.0.0.1','http:///absent']:
   with self.subTest(url=url),patch.dict(os.environ,{'INSPECTOR_API_INTERNAL_URL':url}),patch.object(w.http.client,'HTTPConnection')as connect,self.assertRaises(ValueError):w.download_reviewed_inventory_comparison_inputs(lease(),ATTEMPT)
   connect.assert_not_called()


if __name__=='__main__':unittest.main()
