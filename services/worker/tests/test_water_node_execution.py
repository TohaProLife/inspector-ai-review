"""Independent frozen T53 execution oracle and native boundary regressions."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.water_node_execution import (
    WATER_NODE_CAPABILITY_REGISTRY, WATER_NODE_CAPABILITY_REGISTRY_HASH,
    build_water_node_comparisons, validate_water_node_loader_package,
    derive_water_node_identities, validate_water_node_comparisons,
    water_node_comparison_evidence, merge_water_node_coverage,
)

ROOT = Path(__file__).parents[3]
PACKET = json.loads((ROOT/'fixtures/matrix-water-node-execution-v1/research-manual-execution-goldens.json').read_text())

def invoke(f):
    op=f['operation'];registry=f.get('registry',WATER_NODE_CAPABILITY_REGISTRY)
    if op=='build':
        envelope=build_water_node_comparisons(f['package'],registry)
        if 'coverage' not in f:return envelope
        return {'envelope':envelope,'evidence':water_node_comparison_evidence(f['package'],envelope,registry),
                'coverage':merge_water_node_coverage(f['coverage'],envelope,registry)}
    if op=='validate':return validate_water_node_comparisons(f['envelope'])
    if op=='evidence':return water_node_comparison_evidence(f['package'],f['envelope'],registry)
    if op=='merge':return merge_water_node_coverage(f['coverage'],f['envelope'],registry)
    raise AssertionError(op)

class WaterNodeExecutionTests(unittest.TestCase):
    def test_all_frozen_manual_whole_outputs(self):
        for f in PACKET['fixtures']:
            with self.subTest(name=f['name']):
                before=deepcopy(f)
                if f.get('throws'):
                    with self.assertRaises(ValueError):invoke(f)
                else:self.assertEqual(invoke(f),f['expected'])
                self.assertEqual(f,before)

    def test_registry_exact(self):
        self.assertEqual(WATER_NODE_CAPABILITY_REGISTRY,PACKET['capabilityRegistry'])
        self.assertEqual(WATER_NODE_CAPABILITY_REGISTRY_HASH,PACKET['capabilityRegistryHash'])

    def test_native_callbacks_never_invoked(self):
        calls=[]
        class Hostile(dict):
            def __iter__(self):calls.append('iter');raise AssertionError()
            def items(self):calls.append('items');raise AssertionError()
            def __deepcopy__(self,memo):calls.append('copy');raise AssertionError()
            def __repr__(self):calls.append('repr');raise AssertionError()
        bad=Hostile()
        for fn,args in [(build_water_node_comparisons,[bad]),(validate_water_node_loader_package,[bad]),
                        (derive_water_node_identities,[bad]),(validate_water_node_comparisons,[bad]),
                        (water_node_comparison_evidence,[bad,bad]),(merge_water_node_coverage,[bad,bad])]:
            with self.subTest(fn=fn.__name__),self.assertRaises(ValueError):fn(*args)
        self.assertEqual(calls,[])

    def test_native_cycles_depth_float_surrogate_and_limits(self):
        cycle=[];cycle.append(cycle)
        deep=None
        for _ in range(66):deep=[deep]
        for value in [cycle,deep,1.0,2**53,'\ud800',{'x':'x'*2_000_001},[None]*32769,{'x':['x']*200001}]:
            with self.subTest(kind=type(value).__name__),self.assertRaises(ValueError):build_water_node_comparisons(value)

    def test_detached_outputs_and_reorder(self):
        p=deepcopy(PACKET['fixtures'][0]['package']);original=deepcopy(p)
        loaded=validate_water_node_loader_package(p);loaded['objectId']='changed'
        identities=derive_water_node_identities(p['sources']);identities[0]['entityKey']='changed'
        envelope=build_water_node_comparisons(p)
        detached=validate_water_node_comparisons(envelope);detached['results'][0]['identity']['entityKey']='changed'
        p['sources'].reverse();p['origins'].reverse()
        self.assertEqual(build_water_node_comparisons(p),envelope)
        self.assertEqual(water_node_comparison_evidence(p,envelope),PACKET['fixtures'][0]['expected']['evidence'])
        p['sources'].reverse();p['origins'].reverse();self.assertEqual(p,original)

    def test_unclaimed_original_page_stage_bound(self):
        p=deepcopy(PACKET['fixtures'][0]['package'])
        p['sources'][0]['review']['pageStages']={'999':'PD'}
        with self.assertRaises(ValueError):build_water_node_comparisons(p)

    def test_envelope_forgeries(self):
        original=PACKET['fixtures'][0]['expected']['envelope']
        for change in ['empty','duplicate','extra','probability','identity','integrity']:
            p=deepcopy(original)
            if change=='empty':p['results']=[]
            elif change=='duplicate':p['results']*=2
            elif change=='extra':p['results'][0]['extra']=1
            elif change=='probability':p['results'][0]['comparison']['calibratedProbability']=80
            elif change=='identity':p['results'][0]['comparison']['identity']['nodeKey']='other'
            else:p['results'][0]['comparison']={'schemaVersion':'matrix-zu129-water-node-comparison-v1','status':'ABSTAIN','reasonCode':'INVALID_INPUT','calibratedProbability':None}
            with self.subTest(change=change),self.assertRaises(ValueError):validate_water_node_comparisons(p)

    def test_collection_caps_and_missing_identity(self):
        base=PACKET['fixtures'][0]['package']
        for key,count in [('sources',65),('origins',129),('identities',129)]:
            p=deepcopy(base);p[key]=[deepcopy(p[key][0]) for _ in range(count)]
            with self.subTest(key=key),self.assertRaises(ValueError):build_water_node_comparisons(p)
        p=deepcopy(base);p['identities']=[]
        with self.assertRaises(ValueError):build_water_node_comparisons(p)

    def test_coverage_other_rows_dto_only_and_target_strict(self):
        envelope=PACKET['fixtures'][0]['expected']['envelope'];base=deepcopy(PACKET['baseCoverage'])
        base[0]['reason']='';base[0]['successfulComparisons']=99
        self.assertEqual(merge_water_node_coverage(base,envelope)[0],base[0])
        for change in ['order','negative','extra','status']:
            p=deepcopy(base)
            if change=='order':p.reverse()
            elif change=='negative':p[0]['failures']=-1
            elif change=='extra':p[0]['extra']=1
            else:p[0]['executionStatus']='SUCCESS'
            with self.subTest(change=change),self.assertRaises(ValueError):merge_water_node_coverage(p,envelope)

    def test_cumulative_native_budgets(self):
        for value in [{'bytes':['я'*1_000_000]*5}, {'nodes':[[None]*10000 for _ in range(21)]}]:
            with self.subTest(key=next(iter(value))),self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):
                build_water_node_comparisons(value)

    def test_bad_unclaimed_original_even_unbound(self):
        p=deepcopy(PACKET['fixtures'][2]['package'])
        p['origins'][0]['textArtifact']['pages'][0]['widthMilliPoints']=-1
        with self.assertRaises(ValueError):build_water_node_comparisons(p)

    def test_derive_global_duplicate_unknown_unrelated_identity(self):
        p=deepcopy(PACKET['fixtures'][0]['package']);source=p['sources'][0]
        claim=deepcopy(source['review']['waterNodeScope']['claims'][0])
        claim['identity']['entityKey']='UNRELATED';claim['identity']['buildingKey']='OTHER';claim['identity']['nodeKey']='OTHER'
        claim['assertion']='UNKNOWN';source['review']['waterNodeScope']['claims'].append(claim)
        with self.assertRaises(ValueError):derive_water_node_identities(p['sources'])
        with self.assertRaises(ValueError):build_water_node_comparisons(p)

    def test_total_claim_cap_with_individually_valid_sources(self):
        sources=[];original=PACKET['fixtures'][0]['package']['sources'][0]
        from inspector_worker.water_node_source import water_node_inventory_content_hash
        for si in range(9):
            source=deepcopy(original);source['sourceFileId']=f'SYNTHETIC-SOURCE-{si}'
            source['review']['sourceFileId']=source['sourceFileId'];claims=[]
            for ci in range(16):
                claim=deepcopy(original['review']['waterNodeScope']['claims'][0]);claim['inventorySnapshot']['sourceFileId']=source['sourceFileId']
                claim['inventorySnapshot']['buildingToken']=f'B{ci}'
                claim['target']['inventoryContentHash']=water_node_inventory_content_hash(claim['inventorySnapshot'])
                claims.append(claim)
            source['review']['waterNodeScope']['claims']=claims;sources.append(source)
        with self.assertRaisesRegex(ValueError,'INPUT_LIMIT'):derive_water_node_identities(sources)

    def test_hostile_registry_does_not_invoke_methods(self):
        calls=[]
        class Registry(dict):
            def items(self):calls.append('items');raise AssertionError()
            def __eq__(self,other):calls.append('eq');raise AssertionError()
        registry=Registry();p=PACKET['fixtures'][0]
        for fn,args in [(build_water_node_comparisons,[p['package'],registry]),
                        (water_node_comparison_evidence,[p['package'],p['expected']['envelope'],registry]),
                        (merge_water_node_coverage,[p['coverage'],p['expected']['envelope'],registry])]:
            with self.assertRaises(ValueError):fn(*args)
        self.assertEqual(calls,[])

    def test_malformed_abstain_reason_is_validation_error(self):
        p=deepcopy(PACKET['fixtures'][1]['expected']['envelope'])
        p['results'][0]['comparison']['reasonCode']=[]
        with self.assertRaises(ValueError):validate_water_node_comparisons(p)

    def test_every_retained_origin_bounds_even_unclaimed(self):
        p=deepcopy(PACKET['fixtures'][0]['package']);origin=deepcopy(p['origins'][0]);source=next(s for s in p['sources'] if s['sourceFileId']==origin['sourceFileId'])
        origin['checkId']='UNCLAIMED-ORIGIN';origin['textArtifact']['pages']=origin['textArtifact']['pages'][:1]
        artifact=origin['textArtifact'];artifact['pageCount']=1
        artifact['textPageCount']=sum(bool(page['blocks']) for page in artifact['pages'])
        from inspector_worker.water_node_comparison import _text_hash
        origin['textArtifactHash']=_text_hash(artifact);source['review']['pageStages']={'2':origin['textArtifact']['pages'][0].get('stage','PD')}
        p['origins'].append(origin)
        with self.assertRaises(ValueError):build_water_node_comparisons(p)

    def test_rehashed_same_source_candidate_rejected(self):
        envelope=deepcopy(PACKET['fixtures'][0]['expected']['envelope']);row=envelope['results'][0]
        row['comparison']['actual']['sourceFileId']=row['comparison']['expected']['sourceFileId']
        body={k:v for k,v in row.items() if k!='id'}
        row['id']=hashlib.sha256(json.dumps({'hashDomain':'matrix-water-node-execution-result-id-v1','objectId':envelope['objectId'],
            'inputManifestHash':envelope['inputManifestHash'],'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':body},
            ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with self.assertRaises(ValueError):validate_water_node_comparisons(envelope)

    def test_scalar_rule_namespace_collision(self):
        from unittest.mock import patch
        from inspector_worker import water_node_execution as module
        with patch.object(module,'_SCALAR_RULE_IDS',frozenset({module._RULE})):
            with self.assertRaises(ValueError):merge_water_node_coverage(PACKET['baseCoverage'],PACKET['fixtures'][0]['expected']['envelope'])

if __name__=='__main__':unittest.main()
