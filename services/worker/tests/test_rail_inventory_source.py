"""Frozen independent whole-output rail oracles and native probes; no review authority."""
from pathlib import Path
from copy import deepcopy
import collections,hashlib,json,math,unittest
P=Path(__file__).resolve().parent/'fixtures'/'matrix-rail-inventory-v1'
FIXTURE=P/'research-rail-authored-goldens.json'
G=json.loads(FIXTURE.read_text())['fixtures'];BY={f['name']:f for f in G}
RS='matrix-odi120-rail-inventory-source-result-v1';V='matrix-odi120-rail-inventory-source-v1'
H='Перечень поручней доступного санузла';E='Конец перечня поручней доступного санузла'
F=['Поручень стационарный','для унитаза'];L=['Поручень откидной','с бумагодержателем','для унитаза'];B=['Поручень для раковины']
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def base(name='pd-both'):return deepcopy(BY[name]['input'])
def fragment(x,bi,li=0):
 b=x['textArtifact']['pages'][0]['blocks'][bi]
 return {'pageNumber':1,'blockIndex':bi,'lineIndex':li,'rawText':b['text'].split('\n')[li],'bboxMilliPoints':deepcopy(b['lineBboxesMilliPoints'][li])}
def union(boxes):return [min(b[0]for b in boxes),min(b[1]for b in boxes),max(b[2]for b in boxes),max(b[3]for b in boxes)]
def sync_anchors(x,endblock=None):
 pg=x['textArtifact']['pages'][0]
 if endblock is None:endblock=next(i for i,b in enumerate(pg['blocks'])if b['text']==E)
 s=x['selection'];s['headerFragments']=[fragment(x,0)];s['scopeFragments']=[fragment(x,1)];s['endFragments']=[fragment(x,endblock)]
 s['regionBoxMilliPoints']=[0,s['endFragments'][0]['bboxMilliPoints'][1],pg['widthMilliPoints'],s['headerFragments'][0]['bboxMilliPoints'][3]]
def synthetic(groups,height=595000):
 x=base();pg=x['textArtifact']['pages'][0];pg['heightMilliPoints']=height
 allgroups=[[H],['Санузел МГН: СУ-101']]+deepcopy(groups)+[[E]];blocks=[];last=0
 for bi,lines in enumerate(allgroups):
  y=80 if bi==0 else 110 if bi==1 else 145 if bi==2 else last+31
  boxes=[[60000,height-2400-(y+14*i)*1000,60000+len(t)*7200,height+9600-(y+14*i)*1000]for i,t in enumerate(lines)]
  blocks.append({'text':'\n'.join(lines),'lineBboxesMilliPoints':boxes,'bboxMilliPoints':union(boxes)})
  last=y+14*(len(lines)-1)
 pg['blocks']=blocks;pg['quality']['metrics']['blockCount']=len(blocks);sync_anchors(x)
 return x
def expected(x,rows):
 pg=x['textArtifact']['pages'][0]
 inv={'schemaVersion':V,'extractorVersion':V,'policyVersion':'matrix-odi120-rail-inventory-literals-v1','sourceFileId':x['sourceFileId'],'sourceSha256':x['sourceSha256'],'textArtifactHash':sha(canonical({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':x['textArtifact']})),'stage':x['stage'],'pageNumber':1,'widthMilliPoints':pg['widthMilliPoints'],'heightMilliPoints':pg['heightMilliPoints'],**{k:deepcopy(v)for k,v in x['selection'].items()if k!='pageNumber'},'roomToken':x['selection']['scopeFragments'][0]['rawText'][13:],'featureRows':[{'featureKey':key,'fragments':[fragment(x,bi,li)for li in indices]}for key,bi,indices in rows]}
 # Exact prefix length, manually retained token rather than interpreted identity.
 inv['roomToken']=x['selection']['scopeFragments'][0]['rawText'][len('Санузел МГН: '):]
 return {'schemaVersion':RS,'status':'RECONSTRUCTED','inventory':inv}
def append_outside(x,text):
 pg=x['textArtifact']['pages'][0];box=[60000,30000,60000+len(text)*7200,42000]
 pg['blocks'].append({'text':text,'bboxMilliPoints':box,'lineBboxesMilliPoints':[box.copy()]});pg['quality']['metrics']['blockCount']+=1
def multi(x,count=2):
 a=x['textArtifact'];template=deepcopy(a['pages'][0]);template['blocks']=[];template['quality']['disposition']='OCR_REQUIRED';template['quality']['metrics']['blockCount']=0
 for i in range(2,count+1):p=deepcopy(template);p['pageNumber']=i;a['pages'].append(p)
 a['pageCount']=count;a['qualitySummary']['ocrRequiredPageCount']=count-1
 return x

PROBES=[]
for _name in ['researchpy-independent-portable-probes.json','researchpy-cross-added-manual-probes.json','ts-adversarial-vectors.json','ts-cross-extra-probes.json','ts-manual-goldens.json']:
 _data=json.loads((P/_name).read_text());PROBES.extend(_data.get('fixtures',_data.get('vectors',_data.get('cases',[]))))
from inspector_worker.rail_inventory_source import reconstruct_odi120_rail_inventory_source as call

class RailSourceTests(unittest.TestCase):
 def assert_reason(self,x,reason):self.assertEqual(call(x),{'schemaVersion':RS,'status':'ABSTAIN','reasonCode':reason})
 def test_frozen37_whole_outputs(self):
  for f in G:
   with self.subTest(name=f['name']):
    x=deepcopy(f['input']);before=deepcopy(x);actual=call(x);self.assertEqual(actual,f['expected']);self.assertEqual(x,before)
 def test_independent_portable_probes(self):
  for f in PROBES:
   with self.subTest(name=f['name']):
    x=deepcopy(f['input']);before=deepcopy(x);actual=call(x);self.assertEqual(actual,f['expected']);self.assertEqual(x,before)
 def test_input_not_mutated(self):
  x=base();before=deepcopy(x);call(x);self.assertEqual(x,before)
 def test_no_output_aliases(self):
  x=base();out=call(x);self.assertEqual(out['status'],'RECONSTRUCTED');before=deepcopy(x);out['inventory']['featureRows'][0]['fragments'][0]['bboxMilliPoints'][0]=777;out['inventory']['headerFragments'][0]['rawText']='Changed';out['inventory']['regionBoxMilliPoints'][0]=1;self.assertEqual(x,before)
 def test_repeated_extraction_detached(self):
  x=base();a=call(x);b=call(x);a['inventory']['featureRows'].clear();self.assertEqual(b,BY['pd-both']['expected'])
 def test_no_authority_output(self):
  keys=set();out=call(base())
  def walk(v):
   if type(v)is dict:
    keys.update(v)
    for x in v.values():walk(x)
   elif type(v)is list:
    for x in v:walk(x)
  walk(out);self.assertFalse(keys&{'complete','assertion','approved','qualified','entityKey','ruleId','parameterCode','confidence','calibratedProbability','physicalAbsence','coverage'})
 def test_custom_dict_no_hooks(self):
  calls=[]
  class Hostile(dict):
   def items(self):calls.append('items');raise AssertionError('trap')
   def __iter__(self):calls.append('iter');raise AssertionError('trap')
   def __len__(self):calls.append('len');raise AssertionError('trap')
  self.assert_reason(Hostile(base()),'INVALID_INPUT');self.assertEqual(calls,[])
 def test_custom_scalar_no_coercion(self):
  class Trap:
   def __str__(self):raise AssertionError('coerced')
   def __iter__(self):raise AssertionError('iterated')
  x=base();x['selection']=Trap();self.assert_reason(x,'INVALID_INPUT')
 def test_custom_list_no_iteration(self):
  class Trap(list):
   def __iter__(self):raise AssertionError('iterated')
   def __len__(self):raise AssertionError('len')
  x=base();x['selection']['headerFragments']=Trap([]);self.assert_reason(x,'INVALID_INPUT')
 def test_native_cycle(self):
  x=base();x['cycle']=x;self.assert_reason(x,'INVALID_INPUT')
 def test_native_shared_alias_not_cycle(self):
  x=base();shared=[];x['extra']=[shared,shared];self.assert_reason(x,'INVALID_INPUT')
 def test_valid_shared_line_box_alias_allowed(self):
  x=base();x['selection']['headerFragments'][0]['bboxMilliPoints']=x['textArtifact']['pages'][0]['blocks'][0]['lineBboxesMilliPoints'][0];self.assertEqual(call(x),BY['pd-both']['expected'])
 def test_native_nan_inf_float(self):
  for v in [float('nan'),float('inf'),1.0]:
   with self.subTest(value=str(v)):
    x=base();x['selection']['pageNumber']=v;self.assert_reason(x,'INVALID_INPUT')
 def test_unsafe_integer(self):
  x=base();x['selection']['pageNumber']=2**53;self.assert_reason(x,'INVALID_INPUT')
 def test_numeric_bool_source(self):
  x=base();x['stage']=True;self.assert_reason(x,'INVALID_INPUT')
 def test_lone_surrogate(self):
  x=base();x['sourceFileId']='\ud800';self.assert_reason(x,'INVALID_INPUT')
 def test_nonstring_native_key(self):
  x=base();x[7]='bad';self.assert_reason(x,'INVALID_INPUT')
 def test_depth_limit(self):
  x=base();v=[];x['extra']=v
  for _ in range(65):n=[];v.append(n);v=n
  self.assert_reason(x,'INPUT_LIMIT')
 def test_container_limit(self):
  x=base();x['extra']=[None]*32769;self.assert_reason(x,'INPUT_LIMIT')
 def test_string_codepoint_limit(self):
  x=base();x['extra']='a'*2000001;self.assert_reason(x,'INPUT_LIMIT')
 def test_multibyte_utf8_budget(self):
  x=base();x['extra']='😀'*2000000;self.assert_reason(x,'INPUT_LIMIT')
 def test_aggregate_values_budget(self):
  x=base();x['extra']=['x'*2000000]*4;self.assert_reason(x,'INPUT_LIMIT')
 def test_aggregate_object_key_bytes(self):
  x=base();x['extra']={('x'*1999999)+str(i):None for i in range(4)};self.assert_reason(x,'INPUT_LIMIT')
 def test_nodes_include_keys(self):
  x=base();x['extra']=[{str(i):None for i in range(20000)}for _ in range(5)];self.assert_reason(x,'INPUT_LIMIT')
 def test_bad_fragment_line_controls(self):
  for char in ['\n','\r','\x00','\u2028','\u2029','\ufffd']:
   with self.subTest(char=repr(char)):
    x=base();x['selection']['headerFragments'][0]['rawText']+=char;self.assert_reason(x,'INVALID_SELECTION')
 def test_stage_strings_abstain(self):
  for stage in ['', 'ID','UNRESOLVED','UNKNOWN']:
   with self.subTest(stage=stage):
    x=base();x['stage']=stage;self.assert_reason(x,'STAGE_UNRESOLVED')
 def test_python_host_float_after_json_parse(self):
  x=base();s=json.dumps(x).replace('842000','842000.0');parsed=json.loads(s);self.assert_reason(parsed,'INVALID_INPUT')

class OriginalFixtureIntegrityTests(unittest.TestCase):
 def test_all47_frozen_fixture_bytes(self):
  provenance=P/'provenance.json'
  self.assertEqual(sha(provenance.read_bytes()),'6314810f0359a6e66699ac6e10d7b281f03c3e1166b50287fb61fcb89cf95bbd')
  pins=json.loads(provenance.read_text())['files'];self.assertEqual(len(pins),46)
  for pin in pins:
   with self.subTest(file=pin['file']):
    data=(P/pin['file']).read_bytes();self.assertEqual(len(data),pin['bytes']);self.assertEqual(sha(data),pin['sha256'])
 def test20_complete_original_pdf_and_text_envelopes(self):
  manifest=json.loads((P/'research-rail-original-manifest-before-extraction.json').read_text())
  extracted=json.loads((P/'research-rail-extraction-first-receipt.json').read_text());self.assertEqual(len(manifest['originals']),20);self.assertEqual(extracted['status'],'PASS')
  for original in manifest['originals']:
   with self.subTest(name=original['name']):
    data=(P/original['originalPdf']).read_bytes();self.assertEqual(len(data),original['originalBytes']);self.assertEqual(sha(data),original['originalSha256'])
    canonical=next(x for x in extracted['originals']if x['name']==original['name']);data=(P/canonical['canonicalFile']).read_bytes();self.assertEqual(sha(data),canonical['canonicalFileSha256']);self.assertEqual(json.loads(data),BY[original['name']]['input']['textArtifact'])

if __name__=='__main__':unittest.main(verbosity=2)
