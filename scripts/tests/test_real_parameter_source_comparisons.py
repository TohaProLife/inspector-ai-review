"""Source-only comparisons: independent goldens, conflicts and provenance attacks."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[2]
PROBE = runpy.run_path(str(ROOT / 'scripts/real-parameter-source-comparisons.py'))
BINDING = json.loads((ROOT / 'fixtures/real-parameter-source-comparisons-v1/source-bindings.json').read_text())
GOLDEN = json.loads((ROOT / 'fixtures/real-parameter-source-comparisons-v1/manual-goldens.json').read_text())
VENT = PROBE['tool'](ROOT / 'scripts/probe-ventilation-system-split-public.py', BINDING['implementationPins']['ventilationProbeSha256'])
OCR = PROBE['tool'](ROOT / 'scripts/ocr-full-source-gap-probe.py', BINDING['implementationPins']['ocrProbeSha256'])


class SchoolComparisonTests(unittest.TestCase):
    def quotes(self, n=600):
        return [{'rawText': f'«Школа на {n} мест, р-н Богородское, ул. Тюменская, влд.5»'}]

    def compare(self, pd=None, rd=None, ocr=None):
        return PROBE['compare_school'](self.quotes() if pd is None else pd,
                                       self.quotes() if rd is None else rd,
                                       self.quotes() if ocr is None else ocr)

    def test_independent_real_capacity_golden_no_engineering_promotion(self):
        result = self.compare()
        self.assertEqual(result['pdValue'], GOLDEN['schoolPlacesPD'])
        self.assertEqual(result['rdValue'], GOLDEN['schoolPlacesRD'])
        self.assertEqual(result['deltaRdMinusPd'], GOLDEN['schoolDelta'])
        self.assertEqual(result['comparison'], 'EQUAL')
        for key in ['engineeringQualification', 'matrixFinding', 'complianceEstablished', 'violationEstablished', 'factEligible']:
            self.assertFalse(result[key])
        self.assertIsNone(result['p']); self.assertEqual(result['coverageDelta'], 0)
        self.assertEqual(result['baseGapRetained'], 'COMPOSITE_TRIGGER')

    def test_delta_is_rd_minus_pd_and_does_not_infer_verdict(self):
        decrease = self.compare(rd=self.quotes(550), ocr=self.quotes(550))
        self.assertEqual(decrease['deltaRdMinusPd'], -50); self.assertEqual(decrease['comparison'], 'DECREASE')
        self.assertFalse(decrease['violationEstablished'])
        increase = self.compare(rd=self.quotes(650), ocr=self.quotes(650))
        self.assertEqual(increase['deltaRdMinusPd'], 50); self.assertEqual(increase['comparison'], 'INCREASE')
        self.assertFalse(increase['complianceEstablished'])

    def test_missing_each_evidence_channel_refuses(self):
        for name in ['pd', 'rd', 'ocr']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'SCHOOL_CAPACITY_EVIDENCE_INCOMPLETE'):
                self.compare(**{name: []})

    def test_conflicting_same_source_declarations_refuse(self):
        for name in ['pd', 'rd', 'ocr']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'SCHOOL_CAPACITY_DECLARATIONS_CONFLICT'):
                self.compare(**{name: self.quotes(600) + self.quotes(550)})

    def test_conflicting_native_and_ocr_refuse(self):
        with self.assertRaisesRegex(ValueError, 'SCHOOL_RD_NATIVE_OCR_CONFLICT'):
            self.compare(ocr=self.quotes(60))

    def test_two_entities_in_one_quote_refuse(self):
        with self.assertRaisesRegex(ValueError, 'SCHOOL_CAPACITY_ENTITY_AMBIGUOUS'):
            self.compare(pd=[{'rawText': 'Школа на 600 мест и школа на 200 мест'}])

    def test_untyped_number_or_wrong_entity_not_a_school_capacity(self):
        for text in ['600 мест', 'Школа на 600 учеников', 'Зал на 600 мест', 'Школа на 0 мест', 'Школа на 0600 мест']:
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'SCHOOL_CAPACITY_ENTITY_AMBIGUOUS'):
                self.compare(pd=[{'rawText': text}])

    def test_repeated_equal_declarations_keep_all_citations(self):
        result = self.compare(pd=self.quotes() * 29, rd=self.quotes() * 9, ocr=self.quotes() * 2)
        self.assertEqual(len(result['sourceQuotes']['PD']), 29)
        self.assertEqual(len(result['sourceQuotes']['RD_NATIVE']), 9)
        self.assertEqual(len(result['sourceQuotes']['RD_OCR']), 2)
        self.assertEqual(result['pdValue'], 600)

    def test_native_capacity_requires_exact_line_box(self):
        artifact = {'pages': [{'pageNumber': 1, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                              'blocks': [{'text': 'Школа на 600 мест', 'lineBboxesMilliPoints': []}]}]}
        with self.assertRaisesRegex(ValueError, 'SCHOOL_NATIVE_EXACT_LINE_BBOX_UNVERIFIED'):
            PROBE['native_quotes'](artifact, 'PD')


class VentilationComparisonTests(unittest.TestCase):
    def setUp(self):
        self.binding = copy.deepcopy(BINDING['ventilation'])
        def quote(role, anchor, system, flow, pressure, suffix):
            return {**anchor, 'inputRole': role, 'fileId': 'PD' if role == 'PD' else 'RD',
                    'stem': 'П17', 'system': system, 'suffix': suffix,
                    'stage': 'PD' if role == 'PD' else 'UNRESOLVED',
                    'manifestStage': 'PD' if role == 'PD' else 'RD_ID_MIXED',
                    'airflowM3PerHour': flow, 'freePressurePa': pressure, 'quoteId': role + system}
        self.pd = quote('PD', self.binding['pdAnchor'], 'П17', '9060', '350', None)
        self.rd1 = quote('RD', self.binding['rdAnchors'][0], 'П17.1', '3340', '540', '1')
        self.rd2 = quote('RD', self.binding['rdAnchors'][1], 'П17.2', '5720', '540', '2')

    def compare(self, quotes=None):
        return PROBE['compare_ventilation']([self.pd, self.rd1, self.rd2] if quotes is None else quotes,
                                            self.binding, VENT['evaluate_splits'])

    def test_independent_real_flow_golden_and_unresolved_airchange(self):
        result = self.compare()
        self.assertEqual(result['pdValue'], GOLDEN['P17PDFlowM3PerHour'])
        self.assertEqual(result['rdValue'], GOLDEN['P17RDSumM3PerHour'])
        self.assertEqual(result['deltaRdMinusPd'], GOLDEN['flowDelta'])
        self.assertFalse(result['pressureAggregated']); self.assertFalse(result['airChangeRateEstablished'])
        self.assertFalse(result['samePhysicalSystemEstablished']); self.assertFalse(result['engineeringQualification'])
        self.assertEqual(result['baseGapRetained'], 'PUBLIC_MAPPING_CONFLICT')
        self.assertIsNone(result['p']); self.assertEqual(result['coverageDelta'], 0)
        self.assertEqual([m['freePressurePa'] for m in result['rdMembers']], ['540', '540'])

    def test_repeated_quote_is_not_double_counted(self):
        repeat = {**self.rd1, 'physicalPage': 646, 'quoteId': 'second-rd1'}
        result = self.compare([self.pd, self.rd1, repeat, self.rd2])
        self.assertEqual(result['rdValue'], '9060')
        self.assertEqual(len(result['rdMembers'][0]['sourceQuotes']), 2)

    def test_conflicting_repeated_value_refuses(self):
        with self.assertRaisesRegex(ValueError, 'CONFLICTING_TAG_VALUES'):
            self.compare([self.pd, self.rd1, {**self.rd1, 'airflowM3PerHour': '3341'}, self.rd2])

    def test_missing_member_refuses(self):
        with self.assertRaisesRegex(ValueError, 'RD_SPLIT_MEMBERS_MISSING'):
            self.compare([self.pd, self.rd1])

    def test_flow_mismatch_refuses_instead_of_violation(self):
        self.rd2['airflowM3PerHour'] = '5700'
        with self.assertRaisesRegex(ValueError, 'AGGREGATE_FLOW_MISMATCH'):
            self.compare()

    def test_foreign_rd_unsplit_mark_refuses(self):
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_RD_UNSPLIT_CONFIGURATION'):
            self.compare([self.pd, self.rd1, self.rd2, {**self.rd1, 'system': 'П17', 'suffix': None}])

    def test_member_scope_substitution_refuses_even_with_same_total(self):
        self.rd2.update(system='П17.3', suffix='3')
        with self.assertRaisesRegex(ValueError, 'VENTILATION_SELECTED_MEMBER_SCOPE_MISMATCH'):
            self.compare()

    def test_anchor_text_bbox_page_and_duplicate_substitution_refuse(self):
        for field, value in [('rawText', 'Проект: П17.1 (L=9999 м3/ч, Pc=540 Па)'),
                             ('bboxMilliPoints', [1, 2, 3, 4]), ('physicalPage', 300)]:
            q = {**self.rd1, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.compare([self.pd, q, self.rd2])
        with self.assertRaisesRegex(ValueError, 'EXACT_SOURCE_ANCHOR_MISSING_OR_AMBIGUOUS'):
            self.compare([self.pd, self.rd1, copy.deepcopy(self.rd1), self.rd2])


class OcrBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.pdf = self.root / 'source.pdf'
        with fitz.open() as document:
            p = document.new_page(width=600, height=800)
            p.draw_rect(fitz.Rect(100, 100, 200, 200), fill=(0, 0, 0)); document.save(self.pdf)
        self.sha = PROBE['file_sha'](self.pdf)
        page = {'pageNumber': 1, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                'quality': {'disposition': 'OCR_REQUIRED'}}
        self.artifact = {'sourceFileId': 'SYNTHETIC', 'inputSha256': self.sha, 'schemaVersion': 'document-text-v4',
                         'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pageCount': 1, 'pages': [page]}
        with fitz.open(self.pdf) as document:
            png, w, h = OCR['render_page'](document[0], page, 144)
        directory = self.root / 'p001'; directory.mkdir(); (directory / 'render.png').write_bytes(png)
        raw = {'schemaVersion': 'document-ai-ocr-response-v1', 'profileId': OCR['PROFILE_ID'], 'script': 'eslav',
               'results': [{'width': w, 'height': h, 'overall_ocr_res': {'rec_texts': ['Школа на 600 мест'],
                            'rec_scores': [0.95], 'rec_boxes': [[100, 200, 300, 250]]}}]}
        data = json.dumps(raw, ensure_ascii=False).encode(); (directory / 'response.json').write_bytes(data)
        evidence = {**page, 'sourcePdfSha256': self.sha, 'nativeV4Sha256': 'a' * 64,
                    'renderSha256': hashlib.sha256(png).hexdigest(), 'responseSha256': hashlib.sha256(data).hexdigest(),
                    'factEligible': False, 'absenceProof': False, 'p': None,
                    'lines': OCR['normalize_response'](raw, w, h, 144, 600000, 800000)}
        self.report = {'status': 'ALL_SELECTED_PAGES_OCR_EXECUTED_REVIEW_ONLY', 'sourceFileId': 'SYNTHETIC',
                       'sourcePdfSha256': self.sha, 'nativeV4Sha256': 'a' * 64,
                       'selectedPageNumbers': [1], 'pages': [evidence], 'failures': [],
                       'factEligible': False, 'engineeringQualification': False, 'coverageDelta': 0, 'p': None, 'dpi': 144}

    def verify(self):
        return PROBE['verified_ocr'](self.report, self.root, self.artifact, self.pdf, OCR)

    def test_real_render_and_synthetic_saved_ocr_preserve_source_binding(self):
        quote = self.verify()[0]
        self.assertEqual(quote['rawText'], 'Школа на 600 мест')
        self.assertEqual(quote['bboxMilliPoints'], [50000, 675000, 150000, 700000])
        self.assertEqual(quote['evidenceKind'], 'OCR'); self.assertFalse(quote['humanVerified'])

    def test_whole_ocr_selection_incomplete_or_duplicate_refuses(self):
        for pages in [[], self.report['pages'] * 2]:
            self.report['pages'] = pages
            with self.assertRaisesRegex(ValueError, 'OCR_SOURCE_SELECTION_OR_AUTHORITY_UNVERIFIED'):
                self.verify()

    def test_ocr_source_or_authority_promotion_refuses(self):
        for field, value in [('sourcePdfSha256', 'f' * 64), ('factEligible', True),
                             ('engineeringQualification', True), ('coverageDelta', 1), ('p', 0.95)]:
            before = self.report[field]; self.report[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'OCR_SOURCE_SELECTION_OR_AUTHORITY_UNVERIFIED'):
                self.verify()
            self.report[field] = before

    def test_ocr_page_source_frame_substitution_refuses(self):
        self.report['pages'][0]['widthMilliPoints'] += 1
        with self.assertRaisesRegex(ValueError, 'OCR_PAGE_SOURCE_OR_AUTHORITY_UNVERIFIED'):
            self.verify()

    def test_original_render_substitution_refuses(self):
        (self.root / 'p001/render.png').write_bytes(b'foreign image')
        with self.assertRaisesRegex(ValueError, 'OCR_ORIGINAL_RENDER_SHA256_MISMATCH'):
            self.verify()

    def test_raw_response_substitution_refuses(self):
        (self.root / 'p001/response.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'REPLAY_RESPONSE_SHA256_MISMATCH'):
            self.verify()

    def test_normalized_transcription_or_geometry_substitution_refuses(self):
        for field, value in [('text', 'Школа на 60 мест'), ('bboxMilliPoints', [1, 2, 3, 4])]:
            before = self.report['pages'][0]['lines'][0][field]
            self.report['pages'][0]['lines'][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'OCR_NORMALIZED_LINES_OR_GEOMETRY_MISMATCH'):
                self.verify()
            self.report['pages'][0]['lines'][0][field] = before

    def test_whole_bindings_file_substitution_refuses(self):
        path = self.root / 'bindings.json'; path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'BINDINGS_SHA256_OR_SIZE_MISMATCH'):
            PROBE['pinned_json'](path, PROBE['DEFAULT_BINDINGS_SHA256'], 'BINDINGS')

    def test_reused_code_substitution_refuses(self):
        path = self.root / 'helper.py'; path.write_text('raise RuntimeError("must not execute")')
        with self.assertRaisesRegex(ValueError, 'REUSED_IMPLEMENTATION_SHA256_MISMATCH'):
            PROBE['tool'](path, '0' * 64)


class ViewerCitationFixtureTests(unittest.TestCase):
    def test_selected_quotes_match_pinned_anchors_and_source_types(self):
        viewer = json.loads((ROOT / 'fixtures/real-parameter-source-comparisons-v1/viewer-bindings.json').read_text())
        self.assertEqual(viewer['schemaVersion'], 'real-parameter-source-viewer-bindings-v1')
        self.assertEqual(viewer['objectId'], BINDING['objectId'])
        self.assertEqual(viewer['bindingsSha256'], PROBE['DEFAULT_BINDINGS_SHA256'])
        self.assertFalse(viewer['engineeringQualification']); self.assertIsNone(viewer['p'])
        self.assertEqual(viewer['coverageDelta'], 0)
        expected = [BINDING['school']['pdAnchor'], *BINDING['school']['rdOcrAnchors'],
                    BINDING['ventilation']['pdAnchor'], *BINDING['ventilation']['rdAnchors']]
        actual = [q for selection in viewer['selections'] for q in selection['quotes']]
        self.assertEqual(len(actual), len(expected))
        for quote, anchor in zip(actual, expected):
            for key in ['physicalPage', 'rawText', 'bboxMilliPoints']:
                self.assertEqual(quote[key], anchor[key])
            self.assertEqual(quote['sourceSha256'], BINDING['sources'][quote['role']]['pdfSha256'])
            self.assertEqual(quote['coordinateSystem'], 'PDF_BOTTOM_LEFT_MILLI_POINTS')
            self.assertTrue(PROBE['box_valid'](quote['bboxMilliPoints'], {
                'widthMilliPoints': quote['pageWidthMilliPoints'], 'heightMilliPoints': quote['pageHeightMilliPoints']}))
            self.assertFalse(quote['factEligible']); self.assertIsNone(quote['p'])
            if quote['evidenceKind'] == 'OCR':
                self.assertEqual(quote['sourceArtifactSha256'], BINDING['sources']['RD']['ocrReportSha256'])
                self.assertFalse(quote['humanVerified'])
            else:
                self.assertEqual(quote['evidenceKind'], 'NATIVE')
                self.assertEqual(quote['sourceArtifactSha256'], BINDING['sources'][quote['role']]['canonicalSha256'])
            if quote['unit'] == 'мест':
                self.assertEqual(PROBE['CAPACITY'].findall(quote['rawText']), [quote['displayValue']])
            else:
                self.assertEqual(quote['unit'], 'м³/ч')
                self.assertEqual(VENT['parse_system_line'](quote['rawText'])['airflowM3PerHour'], quote['displayValue'])
        for selection in viewer['selections']:
            self.assertEqual(selection['scopeStatus'], 'SOURCE_ONLY_CANDIDATE')
            self.assertFalse(selection['completeConfiguration'])
            self.assertNotIn('verdict', selection)


if __name__ == '__main__':
    unittest.main()
