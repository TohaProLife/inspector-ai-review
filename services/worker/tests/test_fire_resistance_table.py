"""Independent source-reference goldens and adversarial native fire table tests."""
import hashlib
import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from inspector_worker import fire_resistance_table as fire
from inspector_worker.table_row_binding import read_table_row_page

BASE=Path(__file__).parent/'fixtures'/'matrix-fire-table-v1'
GOLDEN=json.loads((BASE/'portable-goldens.json').read_text())


def apply(page,operations):
    for operation in operations:
        kind=operation['op']
        if kind=='replace-line':
            block=page['blocks'][operation['blockIndex']];parts=block['text'].split('\n')
            parts[operation['lineIndex']]=operation['rawText'];block['text']='\n'.join(parts)
        elif kind=='translate':
            for block in page['blocks']:
                for box in [block['bboxMilliPoints'],*block['lineBboxesMilliPoints']]:
                    box[0]+=operation['x'];box[2]+=operation['x'];box[1]+=operation['y'];box[3]+=operation['y']
        elif kind=='move-line':
            block=page['blocks'][operation['blockIndex']];block['lineBboxesMilliPoints'][operation['lineIndex']]=deepcopy(operation['box'])
            boxes=block['lineBboxesMilliPoints'];block['bboxMilliPoints']=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        elif kind=='append':page['blocks'].append(deepcopy(operation['block']));page['quality']['metrics']['blockCount']=len(page['blocks'])
        else:
            parent=page
            for key in operation['path'][:-1]:parent=parent[key]
            if kind=='set':parent[operation['path'][-1]]=deepcopy(operation['value'])
            elif kind=='delete':del parent[operation['path'][-1]]
            else:raise AssertionError(kind)


class FireTablePortableTest(unittest.TestCase):pass

def portable_test(vector):
    def test(self):
        page=deepcopy(GOLDEN['page']);apply(page,vector['operations']);before=deepcopy(page)
        self.assertEqual(fire.extract_fire_resistance_candidates(page,vector['stage']),vector['expected'])
        self.assertEqual(fire.extract_fire_resistance_candidates(page,vector['stage']),vector['expected'])
        self.assertEqual(page,before)
    return test

for i,vector in enumerate(GOLDEN['vectors']):
    setattr(FireTablePortableTest,f'test_{i:03d}',portable_test(vector))


class FireTableNativeTest(unittest.TestCase):
    def test_full139_page_original_scan_exactly_six_on_one_page(self):
        path=BASE/'F0106-full.text.json';artifact=json.loads(path.read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),'1aa99c72405982a5e67f7a669d3df297f7379c61738f99cc01ab1db4715b5473')
        self.assertEqual(artifact['inputSha256'],'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655')
        self.assertEqual(artifact['pageCount'],139)
        found=[]
        for page in artifact['pages']:
            result=fire.extract_fire_resistance_candidates(page,'PD')
            if result:found.append((page['pageNumber'],result))
        self.assertEqual(found,[(51,GOLDEN['vectors'][0]['expected'])])

    def test_outputs_preserve_all_original_raw_boxes_and_page_numbers(self):
        page=deepcopy(GOLDEN['page']);expected=deepcopy(page)
        result=fire.extract_fire_resistance_candidates(page,'PD')
        for candidate in result:
            for field in ['primaryFragments','scopeFragments','headerFragments','unitFragments']:
                for fragment in candidate[field]:
                    block=page['blocks'][fragment['blockIndex']]
                    self.assertEqual(fragment['pageNumber'],page['pageNumber'])
                    self.assertEqual(fragment['rawText'].encode(),block['text'].split('\n')[fragment['lineIndex']].encode())
                    self.assertEqual(fragment['bboxMilliPoints'],block['lineBboxesMilliPoints'][fragment['lineIndex']])
        result[0]['scopeFragments'][0]['bboxMilliPoints'][0]+=10
        self.assertEqual(page,expected)
        self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),GOLDEN['vectors'][0]['expected'])

    def test_no_mutable_boxes_shared_between_candidates(self):
        result=fire.extract_fire_resistance_candidates(deepcopy(GOLDEN['page']),'PD')
        # Each candidate must be independently editable without corrupting its siblings.
        before=deepcopy(result[1]);result[0]['headerFragments'][0]['bboxMilliPoints'][0]+=1
        self.assertEqual(result[1],before)

    def test_policy_never_depends_on_value_text_or_value_geometry(self):
        page=deepcopy(GOLDEN['page']);policies=[]
        def capture(_page,policy):
            policies.append(deepcopy(policy));return {'status':'ABSTAIN','reasonCode':'UNASSIGNED_CONTENT','rows':[]}
        with patch.object(fire,'bind_table_rows',side_effect=capture):
            self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[])
            apply(page,[{'op':'replace-line','blockIndex':0,'lineIndex':2,'rawText':'not a resistance value'}, {'op':'move-line','blockIndex':0,'lineIndex':2,'box':[450000,750000,500000,762000]}])
            self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[])
        self.assertEqual(len(policies),2);self.assertEqual(policies[0],policies[1])
        self.assertEqual(policies[0]['rows'][0]['valueLineCounts'],{'resistance':1})

    def test_declared_semantic_boundary_has_no_qualification_or_member_fields(self):
        result=fire.extract_fire_resistance_candidates(deepcopy(GOLDEN['page']),'PD')
        keys={'criterion','minutes','rawValue','rawUnit','canonicalUnit','constructionLabelLines','primaryFragments','scopeFragments','headerFragments','unitFragments','bindingPolicyVersion','tableBoxMilliPoints'}
        for candidate in result:
            self.assertEqual(set(candidate),keys)
            self.assertNotIn('value',candidate);self.assertNotIn('entityKey',candidate)
            self.assertNotIn('confidence',candidate);self.assertNotIn('rule',candidate)
        self.assertEqual([c['criterion'] for c in result],['R','REI','REI','REI','REI','REI'])

    def test_native_hostile_objects_and_subclasses_never_invoked(self):
        class Hostile(dict):
            def items(self):raise AssertionError('hostile source executed')
        class HostileStage:
            def __str__(self):raise AssertionError('stage coerced')
        page=deepcopy(GOLDEN['page'])
        self.assertEqual(fire.extract_fire_resistance_candidates(Hostile(page),'PD'),[])
        self.assertEqual(fire.extract_fire_resistance_candidates(page,HostileStage()),[])
        class StringSubclass(str):pass
        self.assertEqual(fire.extract_fire_resistance_candidates(page,StringSubclass('PD')),[])

    def test_native_cycles_nonportable_and_surrogates_abstain(self):
        for kind in ['cycle','tuple','nan','integralFloat','unsafe','surrogate']:
            page=deepcopy(GOLDEN['page'])
            if kind=='cycle':page['blocks'].append(page)
            elif kind=='tuple':page['blocks']=tuple(page['blocks'])
            elif kind=='nan':page['pageNumber']=float('nan')
            elif kind=='integralFloat':page['pageNumber']=51.0
            elif kind=='unsafe':page['pageNumber']=2**53
            else:page['blocks'][0]['text']='\ud800'
            self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[],kind)

    def test_native_depth_and_width_rejected_before_discovery(self):
        page=deepcopy(GOLDEN['page']);page['extra']=[None]*32769
        self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[])
        page=deepcopy(GOLDEN['page']);cursor={};page['extra']=cursor
        for _ in range(65):cursor['next']={};cursor=cursor['next']
        self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[])

    def test_unknown_stage_does_not_read_or_discover_source(self):
        with patch.object(fire,'read_table_row_page',side_effect=AssertionError('source read')):
            self.assertEqual(fire.extract_fire_resistance_candidates(None,'ID'),[])

    def test_reader_runs_before_any_discovery(self):
        page=deepcopy(GOLDEN['page']);page['blocks'][-1]['lineBboxesMilliPoints']=[]
        self.assertEqual(read_table_row_page(page)['status'],'ABSTAIN')
        with patch.object(fire,'bind_table_rows',side_effect=AssertionError('binder received invalid source')):
            self.assertEqual(fire.extract_fire_resistance_candidates(page,'PD'),[])

    def test_supported_height_bounds_are_inclusive(self):
        selected=[(2,0),(0,0),(0,1),(4,0),(4,1),(4,2),(4,3),(4,4),(4,5),(4,6),(0,2),(6,0),(8,0),(8,1),(8,2),(8,3)]
        for height in [11000,13000]:
            page=deepcopy(GOLDEN['page'])
            for bi,li in selected:
                box=page['blocks'][bi]['lineBboxesMilliPoints'][li][:];box[1]=box[3]-height
                apply(page,[{'op':'move-line','blockIndex':bi,'lineIndex':li,'box':box}])
            self.assertEqual(len(fire.extract_fire_resistance_candidates(page,'PD')),6,height)


if __name__=='__main__':unittest.main()
