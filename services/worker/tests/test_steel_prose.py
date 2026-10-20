"""Independent steel declaration goldens; no engine/registry or approval mutations."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.steel_prose import (
    EXTRACTOR_VERSION, compare_steel_catalog_example, extract_steel_candidates,
    normalize_steel_catalog_grade,
)

_ROOT = Path(__file__).resolve().parents[3]
_BASE = Path(__file__).resolve().parent / 'fixtures/matrix-steel-v1'
_GOLDEN = json.loads((_BASE / 'research-parser-golden.json').read_text())
_PAGES = {x['sourceFileId']: x['page'] for x in _GOLDEN['sources']}


def _apply(page, operations):
    result = deepcopy(page)
    for op in operations:
        if op['op'] == 'set':
            node = result
            for key in op['path'][:-1]:
                node = node[key]
            node[op['path'][-1]] = deepcopy(op['value'])
        elif op['op'] == 'replaceText':
            node = result['blocks'][op['blockIndex']]
            assert op['old'] in node['text']
            node['text'] = node['text'].replace(op['old'], op['new'])
        elif op['op'] == 'appendBlock':
            result['blocks'].append(deepcopy(op['value']))
        elif op['op'] == 'swapBlocks':
            a, b = op['indices']
            result['blocks'][a], result['blocks'][b] = result['blocks'][b], result['blocks'][a]
        else:
            raise AssertionError('Unknown portable operation')
    return result


class SteelProseTests(unittest.TestCase):
    def test_full_authentic_43_pages_exactly_two_evidence_only_declarations(self):
        receipts = json.loads((_BASE / 'research-extraction-receipts.json').read_text())
        found = []
        for row in receipts:
            source = row['source']
            raw = (_BASE / row['artifactPath']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), row['fullTextArtifactSha256'])
            artifact = json.loads(raw)
            self.assertEqual(artifact['inputSha256'], source['sha256'])
            self.assertEqual(len(artifact['pages']), source['pdf_pages'])
            self.assertEqual((source['split'], source['distribution_status'], source['label_visibility']),
                             ('TRAIN_PUBLIC', 'INCLUDE', 'PUBLIC_TRAIN'))
            before = deepcopy(artifact)
            for page in artifact['pages']:
                for item in extract_steel_candidates(page, source['stage']):
                    found.append((source['file_id'], page['pageNumber'], source['section'], item['value']))
                    self.assertFalse(set(item) & {'entityId', 'probability', 'approved', 'sourceReview', 'section'})
            self.assertEqual(artifact, before)
        self.assertEqual(found, [('F0105', 14, 'KR', 'С245'), ('F0145', 4, 'OTHER', 'С245')])
        self.assertEqual(sum(x['pageCount'] for x in receipts), 43)

    def test_catalog_predicate_domain_and_direction_no_numerical_rank(self):
        self.assertEqual(EXTRACTOR_VERSION, 'matrix-steel-prose-v1')
        for case in _GOLDEN['predicateCases']:
            self.assertIs(compare_steel_catalog_example(case['expected'], case['actual']), case['result'])
        for invalid in ['С235', 'С255', 'С355', 'С345С', 'c345', ' С345', 'С345 ', 'C345\u200b',
                        '', None, True, 345, 345.0, ['С345'], {'value': 'С345'}]:
            self.assertIsNone(normalize_steel_catalog_grade(invalid))
            self.assertIsNone(compare_steel_catalog_example(invalid, 'С245'))
            self.assertIsNone(compare_steel_catalog_example('С345', invalid))

    def test_no_input_bbox_aliasing_and_no_shared_output_product_scope(self):
        for sid, stage in [('F0105', 'PD'), ('F0145', 'RD')]:
            page = deepcopy(_PAGES[sid]);before = deepcopy(page)
            first = extract_steel_candidates(page, stage);second = extract_steel_candidates(page, stage)
            first[0]['productScope']['profile'] = 'forged'
            for line in first[0]['primaryFragments'] + first[0]['scopeFragments']:
                line['bboxMilliPoints'][0] = -1
            self.assertEqual(page, before)
            self.assertEqual(extract_steel_candidates(page, stage), second)
            self.assertNotEqual(first, second)

    def test_native_invalid_host_shapes(self):
        for bad in [None, [], True, 1, 'page', ()]:
            self.assertEqual(extract_steel_candidates(bad, 'PD'), [])
        for stage in [None, [], {}, (), True, 1]:
            self.assertEqual(extract_steel_candidates(_PAGES['F0105'], stage), [])
        for sid, stage, bi in [('F0105', 'PD', 30), ('F0145', 'RD', 40)]:
            for number in [float('nan'), float('inf'), float('-inf'), 1.0, 2**53]:
                page = deepcopy(_PAGES[sid]);page['pageNumber'] = number
                self.assertEqual(extract_steel_candidates(page, stage), [])
                page = deepcopy(_PAGES[sid]);page['blocks'][bi]['lineBboxesMilliPoints'][0][0] = number
                self.assertEqual(extract_steel_candidates(page, stage), [])
            page = deepcopy(_PAGES[sid]);page['blocks'][bi]['text'] += '\ud800'
            self.assertEqual(extract_steel_candidates(page, stage), [])
            page = deepcopy(_PAGES[sid]);page['blocks'][bi]['lineBboxesMilliPoints'][0] = tuple(page['blocks'][bi]['lineBboxesMilliPoints'][0])
            self.assertEqual(extract_steel_candidates(page, stage), [])
            page = deepcopy(_PAGES[sid]);page['blocks'].append(page)
            self.assertEqual(extract_steel_candidates(page, stage), [])

    def test_pd_height_boundary_and_mixed_height_reject(self):
        page = deepcopy(_PAGES['F0105'])
        # Adjust both real line and block union. This is meaningful layout, not
        # rejection caused by a deliberately inconsistent redundant bbox.
        page['blocks'][30]['lineBboxesMilliPoints'][0][3] += 1000
        page['blocks'][30]['bboxMilliPoints'][3] += 1000
        self.assertEqual(len(extract_steel_candidates(page, 'PD')), 1)
        page['blocks'][30]['lineBboxesMilliPoints'][0][3] += 1
        page['blocks'][30]['bboxMilliPoints'][3] += 1
        self.assertEqual(extract_steel_candidates(page, 'PD'), [])

    def test_geometry_gap_boundary_valid_then_invalid_with_consistent_union(self):
        page = deepcopy(_PAGES['F0105'])
        # Last observed gap8880; translating primary down1120 reaches10000.
        for target in ['bboxMilliPoints']:
            page['blocks'][30][target][1] -= 1120;page['blocks'][30][target][3] -= 1120
        page['blocks'][30]['lineBboxesMilliPoints'][0][1] -= 1120
        page['blocks'][30]['lineBboxesMilliPoints'][0][3] -= 1120
        self.assertEqual(len(extract_steel_candidates(page, 'PD')), 1)
        page['blocks'][30]['bboxMilliPoints'][1] -= 1;page['blocks'][30]['bboxMilliPoints'][3] -= 1
        page['blocks'][30]['lineBboxesMilliPoints'][0][1] -= 1;page['blocks'][30]['lineBboxesMilliPoints'][0][3] -= 1
        self.assertEqual(extract_steel_candidates(page, 'PD'), [])

    def test_pd_role_is_only_explicit_second_tier_70b3_not_70b2(self):
        item = extract_steel_candidates(_PAGES['F0105'], 'PD')[0]
        self.assertEqual(item['productScope']['profile'], '70Б3')
        self.assertEqual(item['productScope']['tier'], 2)
        self.assertEqual(item['productScope']['count'], 3)
        rd = extract_steel_candidates(_PAGES['F0145'], 'RD')[0]
        self.assertIsNone(rd['productScope']['profile'])
        self.assertIsNone(rd['productScope']['tier'])
        self.assertNotEqual(item['productScope'], rd['productScope'])
        # Same grade is equality only. There is no same-member proof here.
        self.assertIs(compare_steel_catalog_example(item['value'], rd['value']), False)


def _portable_method(case):
    def method(self):
        page = _apply(_PAGES[case['sourceFileId']], case['operations'])
        before = deepcopy(page)
        actual = extract_steel_candidates(page, case['stage'])
        self.assertEqual(actual, case['expected'], case['name'])
        self.assertEqual(page, before, case['name'])
        self.assertEqual(extract_steel_candidates(page, case['stage']), actual, case['name'])
    return method


for _index, _case in enumerate(_GOLDEN['cases']):
    setattr(SteelProseTests, f'test_portable_{_index:03d}_{_case["sourceFileId"]}', _portable_method(_case))

if __name__ == '__main__':
    unittest.main()
