"""T51 independently frozen water-node whole-output/native regression, no peer TS import."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.water_node_source import (
    EXTRACTOR_VERSION, POLICY_VERSION,
    reconstruct_zu129_water_node_source, water_node_inventory_content_hash,
)

FIXTURES = Path(__file__).parent / 'fixtures' / 'matrix-water-node-v1'
PINS = {
    'research-authored-goldens.json': '48c84df4124fce90365c4964e8eae316b423bf7abadc4748b8f65a614a24b067',
    'research-layout-clarification-goldens.json': '58a75068d5c248192f1a49345c61365014fe64a8d9ec355ea3033057f256c020',
}
RESULT = 'matrix-zu129-water-node-source-result-v1'

def load_cases():
    result = []
    for name, digest in PINS.items():
        raw = (FIXTURES / name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest
        result.extend(json.loads(raw)['fixtures'])
    return result

CASES = load_cases()

def base():
    return copy.deepcopy(CASES[0]['input'])

def abstain(reason):
    return {'schemaVersion': RESULT, 'status': 'ABSTAIN', 'reasonCode': reason}

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def independent_hash(value):
    return hashlib.sha256(canonical({'hashDomain': 'matrix-zu129-water-node-source-id-v1', 'inventory': value}).encode()).hexdigest()

class WaterNodeSourceTests(unittest.TestCase):
    def test_53_frozen_whole_outputs_hashes_and_input_immutability(self):
        self.assertEqual(len(CASES), 53)
        for case in CASES:
            with self.subTest(case=case['name']):
                value = copy.deepcopy(case['input']); before = canonical(value)
                actual = reconstruct_zu129_water_node_source(value)
                self.assertEqual(actual, case['expected'])
                self.assertEqual(canonical(value), before)
                if actual['status'] == 'RECONSTRUCTED':
                    self.assertEqual(water_node_inventory_content_hash(actual['inventory']), case['expectedInventoryContentHash'])
                    self.assertEqual(independent_hash(actual['inventory']), case['expectedInventoryContentHash'])

    def test_version_constants(self):
        self.assertEqual(EXTRACTOR_VERSION, 'matrix-zu129-water-node-source-v1')
        self.assertEqual(POLICY_VERSION, 'matrix-zu129-cold-water-inlet-literals-v1')

    def test_no_approval_completeness_identity_or_comparison_inference(self):
        result = reconstruct_zu129_water_node_source(base())
        inv = result['inventory']
        self.assertEqual(set(inv), set(CASES[0]['expected']['inventory']))
        for key in ('entityKey', 'objectId', 'approvalStatus', 'completeness', 'qualified', 'calibratedProbability', 'parameterCode', 'ruleId'):
            self.assertNotIn(key, inv)
        self.assertEqual(inv['service'], 'COLD_WATER')
        self.assertEqual(inv['accountingScope'], 'COMMON_BUILDING_INLET')

    def test_output_is_deep_detached_from_source_and_next_invocation(self):
        value = base(); expected = copy.deepcopy(CASES[0]['expected'])
        out = reconstruct_zu129_water_node_source(value)
        out['inventory']['headerFragments'][0]['rawText'] = 'forged'
        out['inventory']['scopeFragments'][0]['bboxMilliPoints'][0] = 0
        out['inventory']['featureRows'][0]['fragments'][0]['rawText'] = 'forged'
        out['inventory']['regionBoxMilliPoints'][0] = 55
        self.assertEqual(value, CASES[0]['input'])
        self.assertEqual(reconstruct_zu129_water_node_source(value), expected)

    def test_native_scalar_shapes_nan_infinity_floats_unsafe_surrogate(self):
        values = [None, [], True, 1, 'input']
        for invalid in (float('nan'), float('inf'), -float('inf'), 1.0, 2**53):
            value = base(); value['selection']['pageNumber'] = invalid; values.append(value)
        value = base(); value['sourceFileId'] = '\ud800'; values.append(value)
        for value in values:
            with self.subTest(native=type(value).__name__):
                self.assertEqual(reconstruct_zu129_water_node_source(value), abstain('INVALID_INPUT'))

    def test_cycles_and_custom_native_callbacks_never_invoked(self):
        calls = []
        class HostileDict(dict):
            def __iter__(self): calls.append('iter'); raise AssertionError('callback')
            def items(self): calls.append('items'); raise AssertionError('callback')
            def __len__(self): calls.append('len'); raise AssertionError('callback')
            def get(self, *args): calls.append('get'); raise AssertionError('callback')
            def __getitem__(self, key): calls.append('getitem'); raise AssertionError('callback')
        class HostileList(list):
            def __iter__(self): calls.append('iter'); raise AssertionError('callback')
            def __len__(self): calls.append('len'); raise AssertionError('callback')
        class HostileString(str):
            def __str__(self): calls.append('str'); raise AssertionError('callback')
            def encode(self,*a): calls.append('encode'); raise AssertionError('callback')
        class HostileInt(int):
            def __int__(self): calls.append('int'); raise AssertionError('callback')
        values = [HostileDict(base()), HostileList([])]
        value = base(); value['sourceFileId'] = HostileString('source'); values.append(value)
        value = base(); value['selection']['pageNumber'] = HostileInt(1); values.append(value)
        value = base(); value['self'] = value; values.append(value)
        for value in values:
            self.assertEqual(reconstruct_zu129_water_node_source(value), abstain('INVALID_INPUT'))
        self.assertEqual(calls, [])
        for value in values:
            with self.assertRaises((ValueError, TypeError)):
                water_node_inventory_content_hash(value)
        self.assertEqual(calls, [])

    def test_native_limits_before_unknown_dto_keys(self):
        values = []
        nested = None
        for _ in range(66): nested = [nested]
        values.append({'deep': nested})
        values.append({'container': [None] * 32769})
        values.append({'nodes': [[None] * 30000 for _ in range(7)]})
        values.append({'string': 'a' * 2000001})
        values.append({'bytes': ['я' * 1500000 for _ in range(3)]})
        values.append({('я' * 1500000) + str(i): None for i in range(3)})
        for value in values:
            with self.subTest(cause=next(iter(value))[:20]):
                self.assertEqual(reconstruct_zu129_water_node_source(value), abstain('INPUT_LIMIT'))
                with self.assertRaises((ValueError, TypeError)):
                    water_node_inventory_content_hash(value)

    def test_hash_includes_every_fragment_full_source_token_and_raw_spelling(self):
        inv = copy.deepcopy(CASES[0]['expected']['inventory'])
        self.assertEqual(water_node_inventory_content_hash(inv), independent_hash(inv))
        for mutate in [lambda x: x['scopeFragments'][0].update(rawText='Здание: иное'),
                       lambda x: x.update(buildingToken='Б-102'), lambda x: x.update(nodeToken='ВУ-102'),
                       lambda x: x['featureRows'][0]['fragments'][0]['bboxMilliPoints'].__setitem__(0,60001),
                       lambda x: x.update(textArtifactHash='a'*64)]:
            value = copy.deepcopy(inv); mutate(value)
            self.assertNotEqual(water_node_inventory_content_hash(value), water_node_inventory_content_hash(inv))
            self.assertEqual(water_node_inventory_content_hash(value), independent_hash(value))

    def test_hash_native_validation_runs_before_canonical_json(self):
        values = [float('nan'), {'bad': 1.0}, {'bad': 2**53}, {'bad': '\ud800'}, {'bad': lambda: 1}]
        for value in values:
            with self.assertRaises((ValueError, TypeError)):
                water_node_inventory_content_hash(value)

    def test_selected_ocr_coarse_and_inconsistent_geometry_are_distinct(self):
        value=base();value['textArtifact']['pages'][0]['quality']['disposition']='OCR_REQUIRED'
        value['textArtifact']['qualitySummary']={'textLayerCandidatePageCount':0,'ocrRequiredPageCount':1}
        self.assertEqual(reconstruct_zu129_water_node_source(value),abstain('TEXT_LAYER_UNAVAILABLE'))
        value=base();value['textArtifact']['pages'][0]['blocks'][0].pop('lineBboxesMilliPoints')
        self.assertEqual(reconstruct_zu129_water_node_source(value),abstain('LINE_GEOMETRY_UNAVAILABLE'))
        value=base();value['textArtifact']['pages'][0]['blocks'][5]['bboxMilliPoints'][0]-=1
        self.assertEqual(reconstruct_zu129_water_node_source(value),abstain('LINE_GEOMETRY_INCONSISTENT'))

    def test_full_unselected_page_is_validated_and_included_in_hash(self):
        value=base();artifact=value['textArtifact'];page=copy.deepcopy(artifact['pages'][0]);page['pageNumber']=2
        page['quality']['disposition']='OCR_REQUIRED';artifact['pages'].append(page);artifact['pageCount']=2;artifact['textPageCount']=2
        artifact['qualitySummary']={'textLayerCandidatePageCount':1,'ocrRequiredPageCount':1}
        out=reconstruct_zu129_water_node_source(value)
        self.assertEqual(out['status'],'RECONSTRUCTED')
        expected_text_hash=hashlib.sha256(canonical({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact}).encode()).hexdigest()
        self.assertEqual(out['inventory']['textArtifactHash'],expected_text_hash)
        page['widthMilliPoints']=0
        self.assertEqual(reconstruct_zu129_water_node_source(value),abstain('INVALID_TEXT_ARTIFACT'))

    def test_full_page_header_and_scope_uniqueness_precedes_outside(self):
        for text,reason in [('Состав общедомового вводного узла холодной воды','HEADER_UNVERIFIED'),
                            ('Система:???','SCOPE_UNVERIFIED'),
                            ('Конец состава общедомового вводного узла холодной воды','END_UNVERIFIED'),
                            ('Неподдерживаемая приписка','OUTSIDE_BODY_ROW')]:
            value=base();page=value['textArtifact']['pages'][0]
            page['blocks'].append({'text':text,'bboxMilliPoints':[60000,10000,400000,22000],
                                   'lineBboxesMilliPoints':[[60000,10000,400000,22000]]})
            page['quality']['metrics']['blockCount']+=1
            self.assertEqual(reconstruct_zu129_water_node_source(value),abstain(reason))

    def test_body_vocabulary_is_exact_single_line_without_alias_or_quantity(self):
        for text in ['Счетчик холодной воды','счётчик холодной воды',' Счётчик холодной воды','Счётчик холодной воды ',
                     'Счётчик холодной воды 1 шт.','Счётчик ХВС','Демпферная лента','Кнопка вызова персонала',
                     'Поручень откидной у унитаза','Счётчик холодной воды / Фильтр сетчатый']:
            value=base();value['textArtifact']['pages'][0]['blocks'][5]['text']=text
            self.assertEqual(reconstruct_zu129_water_node_source(value),abstain('UNSUPPORTED_BODY_ROW'))

    def test_multiline_source_block_preserves_original_line_identity(self):
        value=base();page=value['textArtifact']['pages'][0];blocks=page['blocks']
        boxes=[b['lineBboxesMilliPoints'][0] for b in blocks]
        page['blocks']=[{'text':'\n'.join(b['text'] for b in blocks),
                        'bboxMilliPoints':[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)],
                        'lineBboxesMilliPoints':boxes}]
        page['quality']['metrics']['blockCount']=1
        selection=value['selection']
        for key in ('headerFragments','scopeFragments','endFragments'):
            for f in selection[key]: f['lineIndex']=f['blockIndex'];f['blockIndex']=0
        actual=reconstruct_zu129_water_node_source(value)
        self.assertEqual(actual['status'],'RECONSTRUCTED')
        self.assertEqual([r['fragments'][0]['lineIndex'] for r in actual['inventory']['featureRows']],[5,6])
        self.assertEqual([r['fragments'][0]['blockIndex'] for r in actual['inventory']['featureRows']],[0,0])

if __name__ == '__main__': unittest.main()
