"""Independent T52 water-node projection/comparison tests; frozen manual oracle."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import unittest
from inspector_worker.water_node_comparison import (
    compare_zu129_water_node_inventories,
    validate_water_node_scope_request,
    project_water_node_scope_decision,
)

ROOT = Path(__file__).parents[3]
PACKET = ROOT / 'fixtures/matrix-water-node-comparison-v1/research-manual-projection-goldens-final.json'
PIN = '302e6fcad47c07352769f8550f4e4ce3713f9a1c39c9f7b34a9a1a14efe61797'
assert hashlib.sha256(PACKET.read_bytes()).hexdigest() == PIN
MANUAL = json.loads(PACKET.read_text())
CASES = MANUAL['fixtures']
HELPERS = MANUAL['helperCases']

def base(): return copy.deepcopy(CASES[0]['input'])
def abstain(reason): return {'schemaVersion':'matrix-zu129-water-node-comparison-v1','status':'ABSTAIN','reasonCode':reason,'calibratedProbability':None}
def scope(v,index=0): return v['sources'][index]['review']['waterNodeScope']
def claim(v,index=0): return scope(v,index)['claims'][0]
def request(v): return {**copy.deepcopy(v),'claims':[{k:copy.deepcopy(z) for k,z in c.items() if k!='inventorySnapshot'} for c in v['claims']]}
def canonical(v): return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def apply_helper(case): return (validate_water_node_scope_request if case['operation']=='validate' else project_water_node_scope_decision)(case['input'])

class WaterNodeComparisonTests(unittest.TestCase):
    def test_all40_independent_manual_whole_outputs_and_immutability(self):
        self.assertEqual(len(CASES),40)
        for case in CASES:
            with self.subTest(name=case['name']):
                v=copy.deepcopy(case['input']); before=canonical(v)
                self.assertEqual(compare_zu129_water_node_inventories(v),case['expected'])
                self.assertEqual(canonical(v),before)

    def test_all8_independent_scope_helper_whole_outputs(self):
        self.assertEqual(len(HELPERS),8)
        for case in HELPERS:
            with self.subTest(name=case['name']):
                before=canonical(case['input'])
                self.assertEqual(apply_helper(case),case['expected'])
                self.assertEqual(canonical(case['input']),before)

    def test_success_and_helpers_return_fully_detached_objects(self):
        v=base();before=canonical(v);r=compare_zu129_water_node_inventories(v)
        r['identity']['nodeKey']='mutated';r['expected']['sourceFileId']='mutated';r['missingFeatureKeys'].clear()
        self.assertEqual(canonical(v),before)
        self.assertEqual(compare_zu129_water_node_inventories(v),CASES[0]['expected'])
        decision=scope(v);out=project_water_node_scope_decision(decision)
        out['claims'][0]['selection']['scopeFragments'][0]['bboxMilliPoints'][0]=1
        self.assertEqual(canonical(v),before)
        self.assertNotIn('inventorySnapshot',project_water_node_scope_decision(decision)['claims'][0])
        req=request(decision);copied=validate_water_node_scope_request(req)
        copied['claims'][0]['nodeMapping']['sourceNodeToken']='mutated'
        self.assertNotEqual(copied,req)

    def test_native_invalid_scalars_and_numeric_dtos(self):
        for bad in (None,[],True,1,'value',float('nan'),float('inf')):
            self.assertEqual(compare_zu129_water_node_inventories(bad),abstain('INVALID_INPUT'))
            self.assertIsNone(validate_water_node_scope_request(bad));self.assertIsNone(project_water_node_scope_decision(bad))
        for bad in (1.0,True,2**53):
            v=base();claim(v)['selection']['pageNumber']=bad
            self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INVALID_INPUT'))
        v=base();v['objectId']='\ud800'
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INVALID_INPUT'))

    def test_native_custom_callbacks_and_cycles_are_never_invoked(self):
        calls=[]
        class Mapping(dict):
            def items(self):calls.append('items');raise AssertionError()
            def __iter__(self):calls.append('iter');raise AssertionError()
            def __len__(self):calls.append('len');raise AssertionError()
            def __getitem__(self,k):calls.append('getitem');raise AssertionError()
        class Text(str):
            def encode(self,*a):calls.append('encode');raise AssertionError()
            def __str__(self):calls.append('str');raise AssertionError()
        class Number(int):
            def __int__(self):calls.append('int');raise AssertionError()
        class Array(list):
            def __iter__(self):calls.append('iter');raise AssertionError()
            def __len__(self):calls.append('len');raise AssertionError()
        values=[Mapping(base()),Array([])]
        v=base();v['objectId']=Text('object');values.append(v)
        v=base();claim(v)['selection']['pageNumber']=Number(1);values.append(v)
        v=base();v['cycle']=v;values.append(v)
        for v in values:
            self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INVALID_INPUT'))
            self.assertIsNone(validate_water_node_scope_request(v));self.assertIsNone(project_water_node_scope_decision(v))
        self.assertEqual(calls,[])

    def test_native_budget_limits_precede_unknown_keys(self):
        nested=None
        for _ in range(66):nested=[nested]
        values=[{'deep':nested},{'container':[None]*32769},{'nodes':[[None]*30000 for _ in range(7)]},
                {'text':'x'*2000001},{'bytes':['я'*1500000 for _ in range(3)]},
                {('я'*1500000)+str(i):None for i in range(3)}]
        for v in values:
            self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INPUT_LIMIT'))
            self.assertIsNone(validate_water_node_scope_request(v));self.assertIsNone(project_water_node_scope_decision(v))

    def test_collection_caps_before_exact_projection(self):
        v=base();v['sources']=[None]*65
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INPUT_LIMIT'))
        v=base();v['origins']=[None]*129
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INPUT_LIMIT'))
        v=base();scope(v)['claims']=[copy.deepcopy(claim(v)) for _ in range(17)]
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INPUT_LIMIT'))
        self.assertIsNone(validate_water_node_scope_request(request(scope(v))))

    def test_no_claim_sources_need_no_origin_and_null_scope_is_valid(self):
        v=base();v['sources'].append({'sourceFileId':'unused','sourceSha256':'a'*64,'stages':['UNRESOLVED'],'reviewSnapshot':None,'review':None})
        self.assertEqual(compare_zu129_water_node_inventories(v),CASES[0]['expected'])
        v=base();v['sources'][0]['review']['waterNodeScope']=None
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED'))
        self.assertEqual(project_water_node_scope_decision({'schemaVersion':'matrix-zu129-water-node-review-v1','claims':[]}),{'schemaVersion':'matrix-zu129-water-node-review-v1','claims':[]})

    def test_unrelated_duplicate_claims_are_not_selected_duplicates(self):
        v=base();c=copy.deepcopy(claim(v));c['identity'].update(entityKey='unrelated',buildingKey='elsewhere',nodeKey='other')
        scope(v)['claims'] += [c,copy.deepcopy(c)]
        self.assertEqual(compare_zu129_water_node_inventories(v),CASES[0]['expected'])
        self.assertIsNone(project_water_node_scope_decision(scope(v)))

    def test_all_supplied_origins_precede_identity_or_review_eligibility(self):
        v=base();v['identity']['nodeKey']='no-match';v['identity']['buildingKey']='no-match';v['identity']['entityKey']='no-match'
        v['origins'][0]['textArtifact']['pages'][0]['widthMilliPoints']=0
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('SOURCE_PROVENANCE_UNVERIFIED'))
        v=base();v['sources'][0]['review']['approvalStatus']='UNKNOWN';v['origins'][1]['textArtifactHash']='a'*64
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('SOURCE_PROVENANCE_UNVERIFIED'))

    def test_project_helper_hash_selection_and_same_source_snapshot_consistency(self):
        v=base();s=copy.deepcopy(scope(v));s['claims'].append(copy.deepcopy(claim(v,1)))
        self.assertIsNone(project_water_node_scope_decision(s))
        for alter in ('targetHash','snapshotRaw','selection','textHash'):
            s=copy.deepcopy(scope(v));c=s['claims'][0]
            if alter=='targetHash':c['target']['inventoryContentHash']='a'*64
            if alter=='snapshotRaw':c['inventorySnapshot']['featureRows'][0]['fragments'][0]['rawText']='forged'
            if alter=='selection':c['selection']['headerFragments'][0]['rawText']='forged'
            if alter=='textHash':c['target']['textArtifactHash']='a'*64
            self.assertIsNone(project_water_node_scope_decision(s))
        s=copy.deepcopy(scope(v));s['claims'][0]['nodeMapping']['sourceNodeToken']='different-but-shaped'
        self.assertEqual(project_water_node_scope_decision(s),request(s))

    def test_reference_key_and_frozen_section_catalog(self):
        for reference in (' short','short   ',' '*8,'a'*1001,'good\nline'):
            v=base();claim(v)['reference']=reference
            self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INVALID_INPUT'))
        v=base();v['sources'][0]['review']['sectionCode']='OTHER'
        self.assertEqual(compare_zu129_water_node_inventories(v),abstain('INVALID_INPUT'))
        for section in ('KR','OV',None):
            v=base();v['sources'][0]['review']['sectionCode']=section
            self.assertEqual(compare_zu129_water_node_inventories(v),abstain('SOURCE_SECTION_UNVERIFIED'))
        v=base();v['objectId']='🙂'*200
        for s in v['sources']:s['review']['objectId']=v['objectId']
        for o in v['origins']:o['objectId']=v['objectId']
        self.assertEqual(compare_zu129_water_node_inventories(v),CASES[0]['expected'])

if __name__=='__main__':unittest.main()
