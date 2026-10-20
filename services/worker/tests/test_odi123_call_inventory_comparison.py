"""Independent expected whole-output/manual/native tests fixed before first run."""
from pathlib import Path
from copy import deepcopy
import json,unittest,hashlib
D=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-call-comparison-v1'
from inspector_worker.odi123_call_inventory_comparison import compare_odi123_call_inventories as COMPARE
G=json.loads((D/'research-call-comparison-manual-goldens-v2.json').read_text())['cases']
G+=json.loads((D/'research-call-comparison-manual-section-supplement.json').read_text())['cases']
BY={c['name']:c for c in G}
ALL_CASES=G+json.loads((D/'research-odi123-independent-portable-probes.json').read_text())['cases']
ALL_CASES+=json.loads((D/'ts-independent-vectors-v2.json').read_text())['cases']
ASSOCIATION_CASES=json.loads((D/'ts-snapshot-association-vectors.json').read_text())['cases']
ALL_CASES+=ASSOCIATION_CASES


def base(name='pd-button-rd-system'):return deepcopy(BY[name]['input'])
def expected(name='pd-button-rd-system'):return deepcopy(BY[name]['expected'])
def pd(x):return next(s for s in x['sources'] if s['stages']==['PD'])
def rd(x):return next(s for s in x['sources'] if s['stages']==['RD'])
def claim(source):return source['review']['callInventoryScope']['claims'][0]
def origin(x,source):return next(o for o in x['origins'] if o['sourceFileId']==source['sourceFileId'])
def abstain(reason):return {'schemaVersion':'matrix-odi123-call-inventory-comparison-v1','status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}
def rehash(c):c['target']['inventoryContentHash']=hashlib.sha256(json.dumps({'hashDomain':'matrix-odi123-call-inventory-source-id-v1','inventory':c['inventorySnapshot']},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class Probe(unittest.TestCase):
 def assert_reason(self,value,reason):self.assertEqual(COMPARE(value),abstain(reason))
 def test_all_169_frozen_wholeoutputs(self):
  self.assertEqual(len(ALL_CASES),169)
  for c in ALL_CASES:
   with self.subTest(c['name']):
    x=deepcopy(c['input']);before=deepcopy(x);self.assertEqual(COMPARE(x),c['expected']);self.assertEqual(x,before)
 def test_noalias_repeated_output(self):
  x=base();before=deepcopy(x);a=COMPARE(x);self.assertEqual(a,expected());a['identity']['floorKey']='MUTATED';a['missingFeatureKeys'].append('MUTATED');a['actual']['sourceFileId']='MUTATED';self.assertEqual(x,before);self.assertEqual(COMPARE(x),expected())
 def test_candidate_always_null(self):
  x=base();self.assertIsNone(COMPARE(x)['calibratedProbability']);x['confidence']=0.99;self.assert_reason(x,'INVALID_INPUT')
 def test_hostile_containers_not_executed(self):
  calls=[]
  class Trap(dict):
   def items(self):calls.append('items');raise AssertionError
   def __len__(self):calls.append('length');raise AssertionError
   def __getitem__(self,k):calls.append('get');raise AssertionError
  x=base();x['hostile']=Trap();self.assert_reason(x,'INVALID_INPUT');self.assertEqual(calls,[])
 def test_native_cycles(self):
  x=base();x['cycle']=x;self.assert_reason(x,'INVALID_INPUT')
 def test_nonportable_numbers(self):
  for value in (1.0,float('nan'),float('inf'),2**53,-2**53):
   with self.subTest(repr(value)):
    x=base();x['padding']=value;self.assert_reason(x,'INVALID_INPUT')
 def test_surrogates_and_nonstring_keys(self):
  for value in ('\ud800',{'\udfff':0},{1:'wrong'}):
   x=base();x['padding']=value;self.assert_reason(x,'INVALID_INPUT')
 def test_exact_outer_proto(self):
  x=base();x['__proto__']={'evil':True};self.assert_reason(x,'INVALID_INPUT')
 def test_exact_nested_scope_proto(self):
  x=base();rd(x)['review']['callInventoryScope']['__proto__']={};self.assert_reason(x,'INVALID_INPUT')
 def test_source_cap_precedes_invalid_dto(self):self.assert_reason({'sources':[{} for _ in range(65)]},'INPUT_LIMIT')
 def test_origins_cap_precedes_invalid_dto(self):self.assert_reason({'origins':[{} for _ in range(129)]},'INPUT_LIMIT')
 def test_claim_cap_precedes_invalid_dto(self):self.assert_reason({'sources':[{'review':{'callInventoryScope':{'claims':[{} for _ in range(17)]}}}]},'INPUT_LIMIT')
 def test_total_claim_cap(self):self.assert_reason({'sources':[{'review':{'callInventoryScope':{'claims':[{} for _ in range(15)]}}} for _ in range(9)]},'INPUT_LIMIT')
 def test_string_cap(self):self.assert_reason({'padding':'x'*2000001},'INPUT_LIMIT')
 def test_exact_string_2m_allowed_native(self):self.assert_reason({'padding':'x'*2000000},'INVALID_INPUT')
 def test_exact_8m_nativebytes(self):self.assert_reason({k:'x'*1999999 for k in 'abcd'},'INVALID_INPUT')
 def test_over_8m_nativebytes(self):
  x={k:'x'*1999999 for k in 'abcd'};x['a']+='x';self.assert_reason(x,'INPUT_LIMIT')
 def test_node_cap(self):self.assert_reason({str(i):[0]*6 for i in range(30000)},'INPUT_LIMIT')
 def test_depth_bound(self):
  x=None
  for _ in range(64):x=[x]
  self.assert_reason(x,'INVALID_INPUT');self.assert_reason([x],'INPUT_LIMIT')
 def test_container_bound(self):self.assert_reason([None]*32768,'INVALID_INPUT');self.assert_reason([None]*32769,'INPUT_LIMIT')
 def test_tuple_rejected(self):self.assert_reason((1,2),'INVALID_INPUT')
 def test_nativeboolean_numeric_selection_invalid_shape(self):
  x=base();claim(rd(x))['selection']['pageNumber']=True;self.assert_reason(x,'INVALID_INPUT')
 def test_selection_shape_precedes_artifactstructure(self):
  x=base();claim(rd(x))['selection']['pageNumber']=True;origin(x,rd(x))['textArtifact']={};self.assert_reason(x,'INVALID_INPUT')
 def test_unknown_claim_shape_cannot_be_filtered(self):
  x=base('unknown-competing-rd-inventory');s=x['sources'][-1];claim(s)['reference']={'invalid':True};self.assert_reason(x,'INVALID_INPUT')
 def test_selected_origin_artifact_plainobject_then_late_reconstruction(self):
  x=base();origin(x,rd(x))['textArtifact']={};self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_selected_origin_artifact_nonobject_invalid(self):
  x=base();origin(x,rd(x))['textArtifact']=[];self.assert_reason(x,'INVALID_INPUT')
 def test_selected_artifact_proto_not_stripped(self):
  x=base();origin(x,rd(x))['textArtifact']['__proto__']={};self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_retained_unselected_artifact_split_not_db_auth(self):
  x=base('withdrawn-rd-no-fallback');extra=deepcopy(x['sources'][-1]);extra['sourceFileId']='SYNTHETIC-UNRELATED';extra['review']=None;extra['reviewSnapshot']=None;x['sources'].append(extra);o=deepcopy(x['origins'][-1]);o['sourceFileId']=extra['sourceFileId'];o['textArtifact']={};x['origins'].append(o)
  # Pure has no DB authority: exact DTO/association only for retained unselected
  # artifact. Future protected loader MUST reject malformed fulltext before pure.
  self.assert_reason(x,'MATCHED_INVENTORY_PAIR_UNVERIFIED')
 def test_unselected_origin_extra_key_invalid_shape(self):
  x=base('withdrawn-rd-no-fallback');x['origins'][-1]['complete']=True;self.assert_reason(x,'INVALID_INPUT')
 def test_duplicate_sources_invalid(self):
  x=base();x['sources'].append(deepcopy(x['sources'][0]));self.assert_reason(x,'INVALID_INPUT')
 def test_duplicate_origins_invalid(self):
  x=base();x['origins'].append(deepcopy(x['origins'][0]));self.assert_reason(x,'INVALID_INPUT')
 def test_review_null_snapshot_iff(self):
  for key in ('review','reviewSnapshot'):
   x=base();rd(x)[key]=None;self.assert_reason(x,'INVALID_INPUT')
 def test_parent_source_sha_mismatch_review(self):
  x=base();rd(x)['sourceSha256']='0'*64;self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
 def test_target_hash_mismatch_provenance(self):
  x=base();claim(rd(x))['target']['textStageContentHash']='0'*64;self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
 def test_review_decision_id_mismatch(self):
  x=base();rd(x)['review']['decisionId']='SYNTHETIC-OTHER';self.assert_reason(x,'SOURCE_PROVENANCE_UNVERIFIED')
 def test_pagestages_invalid_keys(self):
  for k in ('01','+1','1.0','0','9999999999999999'):
   x=base();rd(x)['review']['pageStages']={k:'RD'};self.assert_reason(x,'INVALID_INPUT')
 def test_pagestages_own_proto(self):
  x=base();rd(x)['review']['pageStages']={'__proto__':'RD'};self.assert_reason(x,'INVALID_INPUT')
 def test_unknown_stage_enum_is_invalid_shape(self):
  x=base();rd(x)['stages']=['OTHER'];self.assert_reason(x,'INVALID_INPUT')
 def test_id_stage_is_unverified(self):
  x=base();rd(x)['stages']=['ID'];self.assert_reason(x,'SOURCE_STAGE_UNVERIFIED')
 def test_duplicate_stage_enum_is_invalid(self):
  x=base();rd(x)['stages']=['RD','RD'];self.assert_reason(x,'INVALID_INPUT')
 def test_null_section_valid_offrole(self):
  x=base();rd(x)['review']['sectionCode']=None;self.assert_reason(x,'SOURCE_SECTION_UNVERIFIED')
 def test_reference_limits_and_scalars(self):
  for value,ok in [('Проверка',True),('🙂'*1000,True),('\ufeff'+'a'*7,True),(' '*8,False),('a'*7,False),('a'*1001,False),(' abcdefgh',False),('abcdefgh\n',False)]:
   x=base();claim(rd(x))['reference']=value
   with self.subTest(repr(value[:15])):
    if ok:self.assertEqual(COMPARE(x),expected())
    else:self.assert_reason(x,'INVALID_INPUT')
 def test_source_room_token_generic_late_not_earlyregex(self):
  for value in ('🙂room','СУ\t101','СУ\u0085-101','different_token','x'*200):
   x=base();claim(rd(x))['roomMapping']['sourceRoomToken']=value;self.assert_reason(x,'ROOM_MAPPING_UNVERIFIED')
 def test_source_room_token_bad_key_shape(self):
  for value in (' x','x'*201,'','\ninvalid'):
   x=base();claim(rd(x))['roomMapping']['sourceRoomToken']=value;self.assert_reason(x,'INVALID_INPUT')
 def test_mapping_unknown_precedes_humancomplete(self):
  x=base();claim(rd(x))['roomMapping']['assertion']='UNKNOWN';claim(rd(x))['assertion']='UNKNOWN';self.assert_reason(x,'ROOM_MAPPING_UNVERIFIED')
 def test_identity_conflict_precedes_source_stage(self):
  x=base();claim(rd(x))['identity']['floorKey']='OTHER-FLOOR';rd(x)['stages']=['ID'];self.assert_reason(x,'ROOM_IDENTITY_CONFLICT')
 def test_source_review_precedes_reconstruction(self):
  x=base();rd(x)['review']['approvalStatus']='UNKNOWN';origin(x,rd(x))['textArtifact']={};self.assert_reason(x,'SOURCE_REVIEW_UNVERIFIED')
 def test_stage_precedes_inventory_duplicates(self):
  x=base('duplicate-rd-claim');rd(x)['stages']=['ID'];self.assert_reason(x,'SOURCE_STAGE_UNVERIFIED')
 def test_recomputed_forgery_drop_button(self):
  x=base('rd-contains-button');c=claim(rd(x));c['inventorySnapshot']['featureRows']=c['inventorySnapshot']['featureRows'][1:];rehash(c);self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_recomputed_forgery_raw_line(self):
  x=base();c=claim(rd(x));c['inventorySnapshot']['featureRows'][0]['fragments'][0]['rawText']='Кнопка вызова персонала';rehash(c);self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_recomputed_forgery_frame(self):
  x=base();c=claim(rd(x));c['inventorySnapshot']['widthMilliPoints']+=1;rehash(c);self.assert_reason(x,'INVENTORY_RECONSTRUCTION_UNVERIFIED')
 def test_snapshot_invalid_frame_early(self):
  x=base();claim(rd(x))['inventorySnapshot']['widthMilliPoints']=1;self.assert_reason(x,'INVALID_INPUT')
 def test_snapshot_empty_rows_structural_invalid(self):
  x=base();claim(rd(x))['inventorySnapshot']['featureRows']=[];self.assert_reason(x,'INVALID_INPUT')
 def test_snapshot_extra_semantic_field_invalid(self):
  x=base();claim(rd(x))['inventorySnapshot']['confidence']=0;self.assert_reason(x,'INVALID_INPUT')
 def test_source_and_origin_order_invariance(self):
  x=base();x['sources'].reverse();x['origins'].reverse();self.assertEqual(COMPARE(x),expected())
 def test_renumbering_explicit_human_identity_only(self):self.assertEqual(COMPARE(base('explicit-human-mapped-renumbered-room')),expected('explicit-human-mapped-renumbered-room'))

class SnapshotAssociationRegression(unittest.TestCase):pass
for case in ASSOCIATION_CASES:
 def test(self,case=case):
  value=deepcopy(case['input']);before=deepcopy(value)
  self.assertEqual(COMPARE(value),case['expected']);self.assertEqual(value,before)
 setattr(SnapshotAssociationRegression,'test_'+case['name'].replace('-','_'),test)

if __name__=='__main__':unittest.main(verbosity=2)
