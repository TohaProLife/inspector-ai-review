"""Independent authored original-PDF inventory oracles and native boundaries."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.inventory_source import reconstruct_ar053_inventory_source as reconstruct

B = Path(__file__).resolve().parent / 'fixtures' / 'matrix-inventory-v1'
ORACLE = json.loads((B / 'portable-goldens.json').read_text())
FIXTURES = {item['name']: item for item in ORACLE['fixtures']}


class InventorySourceTests(unittest.TestCase):
    def base(self):
        return deepcopy(FIXTURES['pd-both']['input'])

    def reason(self, value, reason):
        self.assertEqual(reconstruct(value), {'schemaVersion': 'matrix-inventory-source-result-v1',
                                              'status': 'ABSTAIN', 'reasonCode': reason})

    def test_authored_original_bytes_and_full_canonical_provenance(self):
        manifest = json.loads((B / 'authored-manifest.json').read_text())
        self.assertEqual(len(manifest), 15)
        for source in manifest:
            with self.subTest(source=source['name']):
                original = (B / source['pdf']).read_bytes()
                canonical = (B / source['artifact']).read_bytes()
                self.assertEqual(len(original), source['pdfBytes'])
                self.assertEqual(hashlib.sha256(original).hexdigest(), source['sourceSha256'])
                self.assertEqual(hashlib.sha256(canonical).hexdigest(), source['artifactFileSha256'])
                artifact = json.loads(canonical)
                self.assertEqual(artifact, FIXTURES[source['name']]['input']['textArtifact'])
                self.assertEqual(artifact['inputSha256'], source['sourceSha256'])
                self.assertEqual(artifact['sourceFileId'], source['sourceFileId'])
                self.assertEqual(artifact['pageCount'], 2)

    def test_all15_authored_full_original_oracles(self):
        for name, fixture in FIXTURES.items():
            with self.subTest(name=name):
                before = deepcopy(fixture['input'])
                result = reconstruct(fixture['input'])
                self.assertEqual(result, fixture['expected'])
                self.assertEqual(fixture['input'], before)
                canonical = json.dumps({'hashDomain': 'matrix-inventory-source-id-v1',
                                        'inventory': result['inventory']}, ensure_ascii=False,
                                       sort_keys=True, separators=(',', ':'))
                self.assertEqual(hashlib.sha256(canonical.encode()).hexdigest(),
                                 fixture['expectedInventoryContentHash'])

    def test_all21_approved_validation_vectors(self):
        for vector in ORACLE['validationVectors']:
            with self.subTest(name=vector['name']):
                value = deepcopy(FIXTURES[vector['base']]['input'])
                for operation in vector['operations']:
                    parent = value
                    for key in operation['path'][:-1]:
                        parent = parent[key]
                    parent[operation['path'][-1]] = deepcopy(operation['value'])
                self.assertEqual(reconstruct(value), vector['expected'])

    def test_native_values_never_invoke_custom_accessors(self):
        class Hostile(dict):
            calls = 0
            def items(self):
                self.calls += 1
                raise AssertionError('getter invoked')
            def get(self, key, default=None):
                self.calls += 1
                raise AssertionError('getter invoked')
        hostile = Hostile(self.base())
        self.reason(hostile, 'INVALID_INPUT')
        self.assertEqual(hostile.calls, 0)
        nested = self.base()
        nested['selection'] = Hostile(nested['selection'])
        self.reason(nested, 'INVALID_INPUT')
        self.assertEqual(nested['selection'].calls, 0)
        class Foreign:
            @property
            def selection(self):
                raise AssertionError('property invoked')
        self.reason(Foreign(), 'INVALID_INPUT')

    def test_native_numeric_cycle_and_surrogate_attacks(self):
        for value in [120.0, float('nan'), float('inf'), True]:
            with self.subTest(value=repr(value)):
                data = self.base()
                data['selection']['regionBoxMilliPoints'][0] = value
                self.reason(data, 'INVALID_INPUT')
        data = self.base()
        data['cycle'] = data
        self.reason(data, 'INVALID_INPUT')
        for key, value in [('invalid', '\ud800'), ('\udfff', 'invalid')]:
            data = self.base()
            data[key] = value
            self.reason(data, 'INVALID_INPUT')

    def test_portable_caps_are_explicit_before_application_shape(self):
        data = self.base()
        data['extra'] = [''] * 32769
        self.reason(data, 'INPUT_LIMIT')
        data = self.base()
        data['extra'] = 'x' * 2000001
        self.reason(data, 'INPUT_LIMIT')
        data = self.base()
        data['extra'] = ['x' * 2000000] * 4
        self.reason(data, 'INPUT_LIMIT')
        data = self.base()
        data['extra'] = [[''] * 25000 for _ in range(9)]
        self.reason(data, 'INPUT_LIMIT')
        data = self.base()
        nested = None
        for _ in range(66):
            nested = [nested]
        data['extra'] = nested
        self.reason(data, 'INPUT_LIMIT')

    def test_no_input_or_output_aliases(self):
        data = deepcopy(FIXTURES['rd-duplicate-feature']['input'])
        before = deepcopy(data)
        output = reconstruct(data)['inventory']
        output['headerFragments'][0]['bboxMilliPoints'][0] = 123
        output['scopeFragments'][0]['bboxMilliPoints'][0] = 123
        output['regionBoxMilliPoints'][0] = 123
        output['featureRows'][1]['fragments'][0]['rawText'] = 'changed'
        self.assertEqual(data, before)
        self.assertEqual(output['unresolvedRows'][0]['fragments'][0]['rawText'], 'Демпферная лента')
        self.assertEqual(reconstruct(data), FIXTURES['rd-duplicate-feature']['expected'])

    def test_stage_guards_include_unselected_page(self):
        data = self.base()
        data['pageStages'] = {'1': 'PD', '2': 'PD'}
        self.assertEqual(reconstruct(data), FIXTURES['pd-both']['expected'])
        for stage in ['RD', 'ID', 'UNRESOLVED']:
            data['pageStages'] = {'1': stage, '2': 'PD'}
            self.reason(data, 'STAGE_UNRESOLVED')
        for stages in [[], {'0': 'PD'}, {'01': 'PD'}, {'1': 'KR'}, {'3': 'PD'}]:
            data['pageStages'] = stages
            self.reason(data, 'INVALID_INPUT')

    def test_unknown_rows_and_empty_are_evidence_without_closure(self):
        for name in ['rd-explicit-empty', 'rd-no-rows', 'rd-unknown-only', 'rd-negated',
                     'rd-compound', 'rd-plural', 'rd-single-letter', 'rd-wrapped']:
            result = reconstruct(FIXTURES[name]['input'])
            self.assertEqual(result, FIXTURES[name]['expected'])
            self.assertEqual(result['inventory']['featureRows'], [])
            self.assertFalse(set(result['inventory']) & {
                'complete', 'approved', 'qualified', 'absence', 'probability', 'confidence',
                'entityKey', 'ruleId', 'parameterCode', 'coverage', 'assertion'})

    def test_original_raw_preserved_not_trimmed_or_substring_matched(self):
        for raw in [' Демпферная лента', 'Демпферная лента ', 'демпферная лента',
                    'Демпферная\tлента', 'Демпферная\u00a0лента', 'Демпферная лента?',
                    'л', 'Демпферная лента не предусмотрена', 'Демпферная лента\u0085']:
            data = self.base()
            data['textArtifact']['pages'][1]['blocks'][2]['text'] = raw
            output = reconstruct(data)['inventory']
            self.assertEqual([row['featureKey'] for row in output['featureRows']], ['ACOUSTIC_GASKET'])
            self.assertEqual(output['unresolvedRows'][0]['fragments'][0]['rawText'], raw)

    def test_reader_quality_geometry_and_controls(self):
        data = self.base()
        page = data['textArtifact']['pages'][1]
        page['quality']['disposition'] = 'OCR_REQUIRED'
        data['textArtifact']['qualitySummary'] = {'textLayerCandidatePageCount': 1, 'ocrRequiredPageCount': 1}
        self.reason(data, 'TEXT_LAYER_UNAVAILABLE')
        data = self.base()
        del data['textArtifact']['pages'][1]['blocks'][2]['lineBboxesMilliPoints']
        self.reason(data, 'LINE_GEOMETRY_UNAVAILABLE')
        data = self.base()
        data['textArtifact']['pages'][1]['blocks'][2]['bboxMilliPoints'][0] -= 1
        self.reason(data, 'LINE_GEOMETRY_INCONSISTENT')
        for control in ['\r', '\x00', '\u2028', '\u2029', '\ufffd']:
            data = self.base()
            data['textArtifact']['pages'][1]['blocks'][2]['text'] += control
            self.reason(data, 'INVALID_TEXT_ARTIFACT')
        for c1 in ['\x7f', '\x85', '\x9f']:
            data = self.base()
            data['textArtifact']['pages'][1]['blocks'][2]['text'] += c1
            self.assertEqual(reconstruct(data)['status'], 'RECONSTRUCTED')

    def test_region_tangency_overlap_and_closed_line_accounting(self):
        data = self.base()
        # Body line outside region is tangent only; its complete exclusion is
        # mechanically allowed but never proves region closure.
        data['selection']['regionBoxMilliPoints'][1] = 399180
        result = reconstruct(data)['inventory']
        self.assertEqual([row['featureKey'] for row in result['featureRows']], ['DAMPING_TAPE'])
        data = self.base()
        block = data['textArtifact']['pages'][1]['blocks'][3]
        block['bboxMilliPoints'] = [300000, 422180, 400000, 434180]
        block['lineBboxesMilliPoints'] = [list(block['bboxMilliPoints'])]
        self.reason(data, 'AMBIGUOUS_LAYOUT')
        data = self.base()
        data['textArtifact']['pages'][1]['blocks'][3] = deepcopy(data['textArtifact']['pages'][1]['blocks'][2])
        self.reason(data, 'AMBIGUOUS_LAYOUT')

    def test_duplicate_anchors_and_excess_gap_rejected(self):
        for index, expected in [(0, 'HEADER_UNVERIFIED'), (1, 'SCOPE_UNVERIFIED')]:
            data = self.base()
            data['textArtifact']['pages'][1]['blocks'][2]['text'] = data['textArtifact']['pages'][1]['blocks'][index]['text']
            self.reason(data, expected)
        data = self.base()
        block = data['textArtifact']['pages'][1]['blocks'][3]
        for box in [block['bboxMilliPoints'], block['lineBboxesMilliPoints'][0]]:
            box[1] -= 15000
            box[3] -= 15000
        data['selection']['regionBoxMilliPoints'][1] = 350000
        self.reason(data, 'AMBIGUOUS_LAYOUT')

    def test_page_and_source_id_are_not_allowlists(self):
        data = self.base()
        data['sourceFileId'] = 'Другой-источник-😀'
        data['textArtifact']['sourceFileId'] = data['sourceFileId']
        # A copied immutable envelope here is a synthetic pure-input test;
        # actual source/bytes authorization belongs to the future API boundary.
        self.assertEqual(reconstruct(data)['inventory']['sourceFileId'], data['sourceFileId'])
        data['textArtifact']['pages'] = [data['textArtifact']['pages'][1]]
        data['textArtifact']['pages'][0]['pageNumber'] = 1
        data['textArtifact']['pageCount'] = data['textArtifact']['textPageCount'] = 1
        data['textArtifact']['qualitySummary']['textLayerCandidatePageCount'] = 1
        data['selection']['pageNumber'] = 1
        for group in ('headerFragments', 'scopeFragments'):
            data['selection'][group][0]['pageNumber'] = 1
        output = reconstruct(data)['inventory']
        self.assertEqual(output['pageNumber'], 1)
        self.assertTrue(all(f['pageNumber'] == 1 for row in output['featureRows'] for f in row['fragments']))

    def rows_input(self, raws):
        data = self.base()
        page = data['textArtifact']['pages'][1]
        texts = [data['selection']['headerFragments'][0]['rawText'],
                 data['selection']['scopeFragments'][0]['rawText'], *raws]
        page['blocks'] = []
        for index, raw in enumerate(texts):
            bottom = 590000 - index * 2000
            box = [60000, bottom, 500000, bottom + 1000]
            page['blocks'].append({'text': raw, 'bboxMilliPoints': list(box),
                                   'lineBboxesMilliPoints': [list(box)]})
        page['quality']['metrics']['blockCount'] = len(texts)
        for index, key in enumerate(('headerFragments', 'scopeFragments')):
            data['selection'][key] = [{'pageNumber': 2, 'blockIndex': index, 'lineIndex': 0,
                                      'rawText': texts[index],
                                      'bboxMilliPoints': list(page['blocks'][index]['bboxMilliPoints'])}]
        data['selection']['regionBoxMilliPoints'] = [50000, 0, 790000, 595000]
        return data

    def test_region_and_recognized_row_caps_have_no_truncation(self):
        data = self.rows_input(['Демпферная лента'] * 64)
        inventory = reconstruct(data)['inventory']
        self.assertEqual(len(inventory['featureRows']), 64)
        self.assertEqual(len(inventory['unresolvedRows']), 63)
        self.reason(self.rows_input(['Демпферная лента'] * 65), 'REGION_LINE_LIMIT')
        data = self.rows_input(['Неизвестное мероприятие'] * 126)
        inventory = reconstruct(data)['inventory']
        self.assertEqual(len(inventory['featureRows']), 0)
        self.assertEqual(len(inventory['unresolvedRows']), 126)
        self.reason(self.rows_input(['Неизвестное мероприятие'] * 127), 'REGION_LINE_LIMIT')

    def test_512_page_limit_validates_whole_envelope(self):
        data = self.base()
        empty = deepcopy(data['textArtifact']['pages'][0])
        empty['blocks'] = []
        empty['quality']['metrics'] = {key: 0 for key in empty['quality']['metrics']}
        empty['quality']['disposition'] = 'OCR_REQUIRED'
        empty['quality']['reasonCodes'] = []
        artifact = data['textArtifact']
        for count in [512, 513]:
            artifact['pages'] = [deepcopy(empty) for _ in range(count)]
            artifact['pages'][1] = deepcopy(FIXTURES['pd-both']['input']['textArtifact']['pages'][1])
            for index, page in enumerate(artifact['pages'], 1):
                page['pageNumber'] = index
            artifact['pageCount'] = count
            artifact['textPageCount'] = 1
            artifact['qualitySummary'] = {'textLayerCandidatePageCount': 1, 'ocrRequiredPageCount': count - 1}
            if count == 512:
                self.assertEqual(reconstruct(data)['status'], 'RECONSTRUCTED')
            else:
                self.reason(data, 'INPUT_LIMIT')

    def test_container_boundary_distinguished_from_extra_shape(self):
        data = self.base()
        data['extra'] = [''] * 32768
        self.reason(data, 'INVALID_INPUT')
        data['extra'].append('')
        self.reason(data, 'INPUT_LIMIT')

    def test_repeated_extraction_is_deterministic(self):
        data = self.base()
        expected = deepcopy(FIXTURES['pd-both']['expected'])
        for _ in range(4):
            self.assertEqual(reconstruct(data), expected)

    def test_gap_geometry_precedes_header_authentication(self):
        data = self.base()
        block = data['textArtifact']['pages'][1]['blocks'][3]
        for box in [block['bboxMilliPoints'], block['lineBboxesMilliPoints'][0]]:
            box[1] -= 15000
            box[3] -= 15000
        data['selection']['regionBoxMilliPoints'][1] = 350000
        data['selection']['headerFragments'][0]['rawText'] = 'forged header'
        self.reason(data, 'AMBIGUOUS_LAYOUT')

    def test_gap_geometry_precedes_scope_authentication(self):
        data = self.base()
        block = data['textArtifact']['pages'][1]['blocks'][3]
        for box in [block['bboxMilliPoints'], block['lineBboxesMilliPoints'][0]]:
            box[1] -= 15000
            box[3] -= 15000
        data['selection']['regionBoxMilliPoints'][1] = 350000
        data['selection']['scopeFragments'][0]['rawText'] = 'forged scope'
        self.reason(data, 'AMBIGUOUS_LAYOUT')

    def test_authentic_header_must_be_first_before_scope_authentication(self):
        data = self.base()
        page = data['textArtifact']['pages'][1]
        boxes = [deepcopy(page['blocks'][index]['bboxMilliPoints']) for index in (0, 1)]
        for index, other in [(0, 1), (1, 0)]:
            page['blocks'][index]['bboxMilliPoints'] = deepcopy(boxes[other])
            page['blocks'][index]['lineBboxesMilliPoints'] = [deepcopy(boxes[other])]
            key = 'headerFragments' if index == 0 else 'scopeFragments'
            data['selection'][key][0]['bboxMilliPoints'] = deepcopy(boxes[other])
        self.reason(data, 'HEADER_UNVERIFIED')

    def test_authentic_scope_must_be_second_after_valid_header(self):
        data = self.base()
        page = data['textArtifact']['pages'][1]
        boxes = [deepcopy(page['blocks'][index]['bboxMilliPoints']) for index in (1, 2)]
        for index, other in [(1, 1), (2, 0)]:
            page['blocks'][index]['bboxMilliPoints'] = deepcopy(boxes[other])
            page['blocks'][index]['lineBboxesMilliPoints'] = [deepcopy(boxes[other])]
        data['selection']['scopeFragments'][0]['bboxMilliPoints'] = deepcopy(boxes[1])
        self.reason(data, 'SCOPE_UNVERIFIED')

    def test_perstring_limit_precedes_scalar_failure_in_same_string(self):
        data = self.base()
        data['sourceFileId'] = '\ud800' + 'x' * 2000000
        self.reason(data, 'INPUT_LIMIT')


if __name__ == '__main__':
    unittest.main(verbosity=2)
