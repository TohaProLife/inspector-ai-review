"""Independent whole-output golden + native/boundary probes, staged T43 only.
Canonical mutations here are synthetic boundary probes, not original-PDF authority.
No TypeScript comparator or inventory implementation used as oracle.
"""
from pathlib import Path
from copy import deepcopy
import json,unittest
P=Path(__file__).resolve().parent/'fixtures'/'matrix-call-inventory-v1'
from inspector_worker.call_inventory_source import reconstruct_odi123_call_inventory_source as run
GOLDENS=json.loads((P/'research-call-authored-goldens.json').read_text())['fixtures']
BY={x['name']:x for x in GOLDENS}
RS='matrix-odi123-call-inventory-source-result-v1'
BUTTON='Кнопка вызова персонала';SYSTEM='Система двусторонней связи'
HEADER='Перечень оборудования системы вызова персонала'
END='Конец перечня оборудования системы вызова персонала'

def base(name='pd-button'):return deepcopy(BY[name]['input'])
def page(x):return x['textArtifact']['pages'][0]
def append_line(x,text,box):
 page(x)['blocks'].append({'text':text,'bboxMilliPoints':list(box),'lineBboxesMilliPoints':[list(box)]})
 page(x)['quality']['metrics']['blockCount']=len(page(x)['blocks'])
def insert_body(x,text):
 e=x['selection']['endFragments'][0];index=e['blockIndex'];original=list(e['bboxMilliPoints'])
 moved=[original[0],original[1]-35000,original[2],original[3]-35000]
 page(x)['blocks'][index]['bboxMilliPoints']=list(moved)
 page(x)['blocks'][index]['lineBboxesMilliPoints']=[list(moved)]
 e['bboxMilliPoints']=list(moved);x['selection']['regionBoxMilliPoints'][1]=moved[1]
 append_line(x,text,[60000,original[1],60000+len(text)*7200,original[3]])
def two_pages(x,ocr=False):
 a=x['textArtifact'];second=deepcopy(a['pages'][0]);second['pageNumber']=2
 if ocr:
  second['blocks']=[];second['quality']={'disposition':'OCR_REQUIRED','metrics':{k:0 for k in second['quality']['metrics']},'reasonCodes':['NO_TEXT_LAYER']}
 a['pages'].append(second);a['pageCount']=2;a['textPageCount']=1 if ocr else 2
 a['qualitySummary']={'textLayerCandidatePageCount':1 if ocr else 2,'ocrRequiredPageCount':1 if ocr else 0}
 return x

class GoldenTests(unittest.TestCase):pass
for f in GOLDENS:
 def test(self,f=f):
  before=deepcopy(f['input']);self.assertEqual(run(f['input']),f['expected']);self.assertEqual(f['input'],before)
 setattr(GoldenTests,'test_golden_'+f['name'].replace('-','_'),test)

class NativeBoundaryTests(unittest.TestCase):
 def abstain(self,x,reason):
  r=run(x);self.assertEqual(r,{'schemaVersion':RS,'status':'ABSTAIN','reasonCode':reason});self.assertNotIn('inventory',r)
 def test_hostile_object_and_container_subclasses_not_touched(self):
  class Hostile:
   @property
   def sourceFileId(self):raise AssertionError('property executed')
  class BadDict(dict):
   def items(self):raise AssertionError('items executed')
   def get(self,*a):raise AssertionError('get executed')
  class BadList(list):
   def __iter__(self):raise AssertionError('iterator executed')
  for value in [Hostile(),BadDict(base()),BadList([base()]),object(),(base(),)]:
   with self.subTest(kind=type(value).__name__):self.abstain(value,'INVALID_INPUT')
 def test_cycle_native_rejected(self):
  x=base();x['selection']['cycle']=x;self.abstain(x,'INVALID_INPUT')
 def test_native_scalar_float_nan_inf_bigint_surrogate(self):
  for v in [1.0,float('nan'),float('inf'),2**53,-2**53,'\ud800','\udfff']:
   x=base();x['probe']=v
   with self.subTest(value=repr(v)):self.abstain(x,'INVALID_INPUT')
 def test_portable_extra_key_proto_shapes(self):
  for target,reason in [('outer','INVALID_INPUT'),('artifact','INVALID_TEXT_ARTIFACT'),('page','INVALID_TEXT_ARTIFACT'),('fragment','INVALID_SELECTION')]:
   x=base();d={'outer':x,'artifact':x['textArtifact'],'page':page(x),'fragment':x['selection']['scopeFragments'][0]}[target];d['__proto__']={}
   with self.subTest(target=target):self.abstain(x,reason)
 def test_source_key_exact_controls_and_bounds(self):
  for sid in ['', ' X','X\n','X\r','X\x00','X\u2028','X\ufffd','X'*201]:
   x=base();x['sourceFileId']=sid;x['textArtifact']['sourceFileId']=sid
   with self.subTest(sid=repr(sid)):self.abstain(x,'INVALID_INPUT')
 def test_source_identity_is_not_an_allowlist(self):
  x=base();sid='Источник-😀';x['sourceFileId']=sid;x['textArtifact']['sourceFileId']=sid
  r=run(x);self.assertEqual(r['status'],'RECONSTRUCTED');self.assertEqual(r['inventory']['sourceFileId'],sid)
 def test_source_mismatch_and_sha_shape(self):
  for k in ['sourceFileId','inputSha256']:
   x=base();x['textArtifact'][k]='OTHER'if k=='sourceFileId'else'a'*64
   with self.subTest(k=k):self.abstain(x,'SOURCE_MISMATCH')
  for s in ['A'*64,'a'*63,'a'*64+'\n',True,None]:
   x=base();x['sourceSha256']=s
   with self.subTest(s=repr(s)):self.abstain(x,'INVALID_INPUT')
 def test_stage_strings_no_inference_and_nonstrings(self):
  for s in ['ID','UNRESOLVED','unknown','PD_RD','']:
   x=base();x['stage']=s
   with self.subTest(s=s):self.abstain(x,'STAGE_UNRESOLVED')
  for s in [None,[],True,1]:
   x=base();x['stage']=s
   with self.subTest(s=repr(s)):self.abstain(x,'INVALID_INPUT')
 def test_page_stages_grammar_and_safe_integer(self):
  for key,value in [('0','PD'),('01','PD'),('+1','PD'),('1\n','PD'),('9999999999999999','PD'),('9007199254740992','PD'),('2','PD'),('1','BAD'),('1',None)]:
   x=base();x['pageStages']={key:value}
   with self.subTest(key=key,value=value):self.abstain(x,'INVALID_INPUT')
 def test_authenticated_stage_conflict(self):
  for s in ['RD','ID','UNRESOLVED']:
   x=base();x['pageStages']={'1':s}
   with self.subTest(s=s):self.abstain(x,'STAGE_UNRESOLVED')
  x=base();x['pageStages']={'1':'PD'};self.assertEqual(run(x)['status'],'RECONSTRUCTED')
 def test_whole_envelope_shape_and_summary(self):
  changes=[lambda a:a.__setitem__('pageCount',2),lambda a:a.__setitem__('textPageCount',0),lambda a:a['qualitySummary'].__setitem__('ocrRequiredPageCount',1),lambda a:a.__setitem__('coordinateSystem','TOP_LEFT'),lambda a:a.__setitem__('schemaVersion','document-text-v1')]
  for i,change in enumerate(changes):
   x=base();change(x['textArtifact'])
   with self.subTest(i=i):self.abstain(x,'INVALID_TEXT_ARTIFACT')
 def test_unselected_page_corruption_full_envelope(self):
  changes=[lambda p:p.__setitem__('heightMilliPoints',0),lambda p:p.__setitem__('pageNumber',3),lambda p:p['blocks'][0].__setitem__('bboxMilliPoints',[0,0,9999999,9999999]),lambda p:p['quality']['metrics'].__setitem__('blockCount','x')]
  for i,change in enumerate(changes):
   x=two_pages(base());change(x['textArtifact']['pages'][1])
   with self.subTest(i=i):self.abstain(x,'INVALID_TEXT_ARTIFACT')
 def test_legitimate_unselected_ocr_remains_allowed(self):
  x=two_pages(base(),ocr=True);r=run(x);self.assertEqual(r['status'],'RECONSTRUCTED')
  x['pageStages']={'2':'RD'};self.abstain(x,'STAGE_UNRESOLVED')
 def test_unselected_source_does_not_supply_selected_anchor(self):
  x=two_pages(base());x['selection']['headerFragments'][0]['pageNumber']=2;self.abstain(x,'HEADER_UNVERIFIED')
 def test_selected_ocr_quality(self):
  x=base();page(x)['quality']['disposition']='OCR_REQUIRED';x['textArtifact']['qualitySummary']={'textLayerCandidatePageCount':0,'ocrRequiredPageCount':1};self.abstain(x,'TEXT_LAYER_UNAVAILABLE')
 def test_selected_geometry_missing_and_union(self):
  x=base();page(x)['blocks'][2].pop('lineBboxesMilliPoints');self.abstain(x,'LINE_GEOMETRY_UNAVAILABLE')
  x=base();page(x)['blocks'][2]['bboxMilliPoints'][2]+=1;self.abstain(x,'LINE_GEOMETRY_INCONSISTENT')
 def test_selected_quality_block_count_before_literal(self):
  x=base();page(x)['quality']['metrics']['blockCount']+=1;self.abstain(x,'INVALID_TEXT_ARTIFACT')
 def test_selection_strict_numeric_frame_and_controls(self):
  for change in [lambda s:s.__setitem__('pageNumber',True),lambda s:s.__setitem__('pageNumber',0),lambda s:s['regionBoxMilliPoints'].__setitem__(0,-1),lambda s:s['regionBoxMilliPoints'].__setitem__(2,842001),lambda s:s['scopeFragments'][0].__setitem__('rawText',''),lambda s:s['scopeFragments'][0].__setitem__('rawText','X\nY'),lambda s:s['scopeFragments'][0].__setitem__('rawText','X'*8193)]:
   x=base();change(x['selection']);self.abstain(x,'INVALID_SELECTION')
 def test_selected_out_of_frame_anchor_is_invalid_selection(self):
  x=base();x['selection']['scopeFragments'][0]['bboxMilliPoints'][2]=842001;self.abstain(x,'INVALID_SELECTION')
 def test_full_page_unique_header_scope_and_end_outside_region(self):
  for text,reason in [(HEADER,'HEADER_UNVERIFIED'),('Санузел МГН: ДРУГОЙ','SCOPE_UNVERIFIED'),(END,'END_UNVERIFIED')]:
   x=base();append_line(x,text,[60000,100000,700000,112000])
   with self.subTest(text=text):self.abstain(x,reason)
 def test_duplicate_feature_and_unknown_precedence(self):
  x=base('rd-contains-button');insert_body(x,BUTTON);self.abstain(x,'DUPLICATE_FEATURE')
  insert_body(x,'Неизвестная строка');self.abstain(x,'UNSUPPORTED_BODY_ROW')
 def test_all_literal_alias_compound_and_qualifier_rows_fail_closed(self):
  variants=[BUTTON+' ', ' '+BUTTON, BUTTON.lower(),BUTTON+'; '+SYSTEM,'Кнопка вызова помощника','Система двухсторонней связи','Система двусторонней связи со встроенной кнопкой вызова персонала','Кнопка\tвызова персонала','Кнопка\u00a0вызова персонала','Кнопка вызова персонала\u0085','Кнопка вызова персонала (вариант)','Кнопка вызова персонала отсутствует']
  for text in variants:
   x=base();page(x)['blocks'][2]['text']=text
   with self.subTest(text=text):self.abstain(x,'UNSUPPORTED_BODY_ROW')
 def test_region_boundary_crossing_before_header(self):
  x=base();top=x['selection']['regionBoxMilliPoints'][3];append_line(x,'UNKNOWN',[0,top-1,10000,top+10000]);self.abstain(x,'REGION_BOUNDARY_CROSSED')
 def test_boundary_tangency_outside_is_not_intersection(self):
  x=base();top=x['selection']['regionBoxMilliPoints'][3];append_line(x,'OUTSIDE',[0,top,10000,top+10000]);self.assertEqual(run(x)['status'],'RECONSTRUCTED')
 def test_y_overlap_separate_columns_and_duplicate_geometry(self):
  for box in [[700000,427600,800000,439600],list(base()['selection']['scopeFragments'][0]['bboxMilliPoints'])]:
   x=base();append_line(x,'UNKNOWN',box);self.abstain(x,'AMBIGUOUS_LAYOUT')
 def test_gap_geometry_before_forged_header(self):
  x=base();b=page(x)['blocks'][2]
  for box in [b['bboxMilliPoints'],b['lineBboxesMilliPoints'][0]]:box[1]+=10000;box[3]+=10000
  x['selection']['headerFragments'][0]['rawText']='BAD';self.abstain(x,'AMBIGUOUS_LAYOUT')
 def test_region_line_cap_before_overlap(self):
  x=base();
  for i in range(129):append_line(x,'X',[0,450000,1000,451000])
  self.abstain(x,'REGION_LINE_LIMIT')
 def test_room_grammar_strict_no_global_mapping(self):
  for raw in ['Санузел МГН: СУ 101','Санузел МГН: СУ/101','Санузел МГН: '+('X'*81),'Санузел: СУ-101','Санузел МГН: СУ-101 ']:
   x=base();page(x)['blocks'][1]['text']=raw;x['selection']['scopeFragments'][0]['rawText']=raw
   with self.subTest(raw=raw):self.abstain(x,'SCOPE_UNVERIFIED')
 def test_full_tree_string_resource_bounds_before_dto(self):
  x=base();x['probe']='X'*2000001;self.abstain(x,'INPUT_LIMIT')
  x=base();x['probe']='X'*2000000;self.abstain(x,'INVALID_INPUT')
 def test_full_tree_utf8_budget_counts_keys_and_values(self):
  x=base();x['probe']=['😀'*1000000,'😀'*1000000];self.abstain(x,'INPUT_LIMIT')
  x=base();x['probe']={('K'*1999999+str(i)):None for i in range(4)};self.abstain(x,'INPUT_LIMIT')
 def test_full_tree_nodes_containers_and_depth(self):
  x=base();x['probe']=[None]*32769;self.abstain(x,'INPUT_LIMIT')
  x=base();x['probe']=[[None]*30000 for _ in range(7)];self.abstain(x,'INPUT_LIMIT')
  x=base();v=None
  for _ in range(66):v=[v]
  x['probe']=v;self.abstain(x,'INPUT_LIMIT')
 def test_output_copied_no_alias_and_no_hidden_authority(self):
  x=base('rd-contains-button');before=deepcopy(x);a=run(x);b=run(x);self.assertEqual(x,before);self.assertEqual(a,b)
  inv=a['inventory'];inv['featureRows'][0]['fragments'][0]['bboxMilliPoints'][0]=0;inv['headerFragments'][0]['rawText']='MUTATED';inv['regionBoxMilliPoints'][0]=1
  self.assertEqual(x,before);self.assertNotEqual(a,b);self.assertEqual(run(x),b)
  for key in ['entityKey','complete','assertion','approved','qualified','ruleId','parameterCode','confidence','calibratedProbability','physicalAbsence','coverage']:self.assertNotIn(key,b['inventory'])
 def test_complete_whole_expected_output_repeat_and_pair_probability_oracle(self):
  for name in ['pd-button','rd-system','rd-contains-button','pd-no-requirement','rd-unrelated-room']:
   x=base(name);self.assertEqual(run(x),BY[name]['expected']);self.assertEqual(run(x),run(x))
  pairs=json.loads((P/'research-call-authored-goldens.json').read_text())['manualPairExpectationsNotProtectedAuthority']
  self.assertTrue(all(p['calibratedProbability']is None for p in pairs))

class OriginalProvenanceTests(unittest.TestCase):
 def test_all13_original_pdf_bytes_and_full_canonical_artifacts(self):
  import hashlib
  manifest=json.loads((P/'research-call-original-manifest-before-extraction.json').read_text())
  extraction=json.loads((P/'research-call-extraction-first-receipt.json').read_text())
  self.assertEqual(len(manifest['originals']),13);self.assertEqual(extraction['status'],'PASS')
  for source in manifest['originals']:
   with self.subTest(source=source['name']):
    pdf=(P/source['originalPdf']).read_bytes();self.assertEqual(len(pdf),source['originalBytes'])
    self.assertEqual(hashlib.sha256(pdf).hexdigest(),source['originalSha256'])
    artifact=next(x for x in extraction['originals'] if x['name']==source['name'])
    full=(P/artifact['fullCanonicalFile']).read_bytes()
    self.assertEqual(hashlib.sha256(full).hexdigest(),artifact['fullCanonicalFileSha256'])
    self.assertEqual(json.loads(full),BY[source['name']]['input']['textArtifact'])

class PortableCrossOracleTests(unittest.TestCase):pass
for packet_name in ['research-odi123-independent-portable-probes-second.json','root-source-baseline-v2.json','research-odi123-mixed-gate-vectors-first.json']:
 for fixture in json.loads((P/packet_name).read_text())['cases']:
  def portable_test(self,fixture=fixture):
   value=deepcopy(fixture['input']);before=deepcopy(value)
   self.assertEqual(run(value),fixture['expected']);self.assertEqual(value,before)
  setattr(PortableCrossOracleTests,'test_'+packet_name.replace('-','_').replace('.','_')+'_'+fixture['name'].replace('-','_'),portable_test)

if __name__=='__main__':unittest.main(verbosity=2)
