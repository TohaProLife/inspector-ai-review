"""Independent source/geometry/authority checks; no live OCR in the unit suite."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import runpy
import tempfile
import unittest

import fitz


ROOT = Path(__file__).resolve().parents[2]
PROBE = runpy.run_path(str(ROOT / 'scripts/ocr-full-source-gap-probe.py'))


class OcrGapProbeTests(unittest.TestCase):
    def response(self):
        return {'schemaVersion': 'document-ai-ocr-response-v1', 'profileId': PROBE['PROFILE_ID'],
                'script': 'eslav', 'results': [{'width': 1200, 'height': 1600,
                 'overall_ocr_res': {'rec_texts': ['Проверочная строка 12,5'], 'rec_scores': [0.99],
                                     'rec_boxes': [[100, 200, 300, 250]]}}]}

    def test_independent_manual_geometry_golden(self):
        golden = json.loads((ROOT / 'fixtures/full-source-ocr-gap-v1/manual-goldens.json').read_text())
        g = golden['geometry']
        self.assertEqual(PROBE['pixel_box_to_pdf'](g['pixelBox'], g['dpi'],
                         g['pageWidthMilliPoints'], g['pageHeightMilliPoints']),
                         g['expectedPdfBottomLeftMilliPoints'])

    def test_ocr_cannot_become_native_fact_probability_or_absence(self):
        lines = PROBE['normalize_response'](self.response(), 1200, 1600, 144, 600000, 800000)
        self.assertEqual(lines[0]['text'], 'Проверочная строка 12,5')
        self.assertEqual(lines[0]['bboxMilliPoints'], [50000, 675000, 150000, 700000])
        self.assertEqual(lines[0]['evidenceKind'], 'OCR')
        self.assertEqual(lines[0]['recognitionScore'], 0.99)
        self.assertIsNone(lines[0]['p']); self.assertFalse(lines[0]['factEligible'])
        self.assertFalse(lines[0]['absenceProof']); self.assertFalse(lines[0]['humanVerified'])

    def test_wrong_provider_profile_or_script_refuses(self):
        for key, value in [('profileId', 'foreign'), ('script', 'latin'), ('schemaVersion', 'native')]:
            with self.subTest(key=key):
                response = self.response(); response[key] = value
                with self.assertRaisesRegex(ValueError, 'PROVIDER_IDENTITY_MISMATCH'):
                    PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)

    def test_raster_dimension_substitution_refuses(self):
        response = self.response(); response['results'][0]['width'] = 1201
        with self.assertRaisesRegex(ValueError, 'OCR_RASTER_FRAME_MISMATCH'):
            PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)

    def test_mismatched_text_score_box_arrays_refuse(self):
        response = self.response(); response['results'][0]['overall_ocr_res']['rec_scores'] = []
        with self.assertRaisesRegex(ValueError, 'OCR_ARRAY_LENGTH_MISMATCH'):
            PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)

    def test_outside_inverted_or_nonfinite_box_refuses(self):
        for box in [[-1, 1, 10, 20], [1, 1, 1201, 20], [10, 20, 5, 30], [1, 1, float('nan'), 20]]:
            with self.subTest(box=box):
                response = self.response(); response['results'][0]['overall_ocr_res']['rec_boxes'] = [box]
                with self.assertRaisesRegex(ValueError, 'INVALID_OCR_BOX'):
                    PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)

    def test_nan_out_of_range_or_boolean_score_refuses(self):
        for score in [float('nan'), 1.01, -0.1, True]:
            response = self.response(); response['results'][0]['overall_ocr_res']['rec_scores'] = [score]
            with self.assertRaisesRegex(ValueError, 'INVALID_OCR_TEXT_OR_SCORE'):
                PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)

    def test_empty_ocr_is_explicit_not_successful_fact(self):
        response = self.response(); response['results'][0]['overall_ocr_res'] = {
            'rec_texts': [], 'rec_scores': [], 'rec_boxes': []}
        self.assertEqual(PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000), [])

    def test_detected_empty_image_region_is_not_a_text_line(self):
        response = self.response(); overall = response['results'][0]['overall_ocr_res']
        overall['rec_texts'].append(''); overall['rec_scores'].append(0.0)
        overall['rec_boxes'].append([500, 1000, 600, 1100])
        lines = PROBE['normalize_response'](response, 1200, 1600, 144, 600000, 800000)
        self.assertEqual(len(lines), 1); self.assertEqual(lines[0]['text'], 'Проверочная строка 12,5')
        self.assertFalse(lines[0]['factEligible'])

    def test_no_silent_source_prefix_sampling(self):
        a = {'schemaVersion': 'document-text-v4', 'pageCount': 13,
             'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pages': [
                 {'pageNumber': n, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                  'quality': {'disposition': 'OCR_REQUIRED'}, 'locatedLines': [], 'unlocatedLines': []}
                 for n in range(1, 14)]}
        with self.assertRaisesRegex(ValueError, 'OCR_GAP_PAGE_LIMIT'):
            PROBE['select_gaps'](a)

    def test_noncontiguous_page_sequence_refuses(self):
        a = {'schemaVersion': 'document-text-v4', 'pageCount': 1,
             'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pages': [
                 {'pageNumber': 2, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                  'quality': {'disposition': 'OCR_REQUIRED'}, 'locatedLines': [], 'unlocatedLines': []}]}
        with self.assertRaisesRegex(ValueError, 'NATIVE_PAGE_SEQUENCE_UNVERIFIED'):
            PROBE['select_gaps'](a)

    def test_selection_preserves_native_artifact_and_ignores_candidate_pages(self):
        a = {'schemaVersion': 'document-text-v4', 'pageCount': 2,
             'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pages': [
                 {'pageNumber': n, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                  'quality': {'disposition': 'OCR_REQUIRED' if n == 2 else 'TEXT_LAYER_CANDIDATE'},
                  'locatedLines': [], 'unlocatedLines': []} for n in [1, 2]]}
        before = copy.deepcopy(a)
        self.assertEqual([p['pageNumber'] for p in PROBE['select_gaps'](a)], [2])
        self.assertEqual(a, before)

    def test_live_gate_requires_cpu_loaded_script_image_and_memory(self):
        good = {'memAvailableKiB': 1800000, 'imageId': PROBE['IMAGE_ID'],
                'health': {'status': 'ok', 'profileId': PROBE['PROFILE_ID'], 'device': 'cpu', 'loadedScripts': ['eslav']}}
        PROBE['check_live_gate'](good)
        for field, value in [('memAvailableKiB', 1499999), ('imageId', 'sha256:foreign')]:
            bad = copy.deepcopy(good); bad[field] = value
            with self.assertRaises(ValueError): PROBE['check_live_gate'](bad)
        for field, value in [('device', 'gpu:0'), ('loadedScripts', []), ('profileId', 'foreign')]:
            bad = copy.deepcopy(good); bad['health'][field] = value
            with self.assertRaises(ValueError): PROBE['check_live_gate'](bad)

    def test_changed_raw_response_refuses_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'response.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'REPLAY_RESPONSE_SHA256_MISMATCH'):
                PROBE['read_replay_response'](root, {'responseSha256': '0' * 64})

    def test_full_page_render_checks_geometry_and_pixel_budget(self):
        with fitz.open() as doc:
            page = doc.new_page(width=600, height=800)
            png, width, height = PROBE['render_page'](page, {'widthMilliPoints': 600000, 'heightMilliPoints': 800000}, 144)
            self.assertTrue(png.startswith(b'\x89PNG')); self.assertEqual((width, height), (1200, 1600))
            with self.assertRaisesRegex(ValueError, 'SOURCE_NATIVE_FRAME_MISMATCH'):
                PROBE['render_page'](page, {'widthMilliPoints': 601000, 'heightMilliPoints': 800000}, 144)
            with self.assertRaisesRegex(ValueError, 'RENDER_PIXEL_LIMIT'):
                PROBE['render_page'](page, {'widthMilliPoints': 600000, 'heightMilliPoints': 800000}, 300)

    def test_rotation270_matches_visible_v4_frame_and_hand_computed_geometry(self):
        with fitz.open() as doc:
            page = doc.new_page(width=800, height=600)
            page.draw_rect(fitz.Rect(100, 50, 200, 100), color=None, fill=(0, 0, 0))
            page.set_rotation(270)
            png, width, height = PROBE['render_page'](page, {
                'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                'nativeFrame': {'visibleBoxPointStrings': ['0', '0', '600', '800']}}, 144)
            self.assertEqual((width, height), (1200, 1600))
            self.assertEqual(fitz.Pixmap(png).pixel(150, 1300), (0, 0, 0))
            self.assertEqual(PROBE['pixel_box_to_pdf']([100, 1200, 200, 1400], 144, 600000, 800000),
                             [50000, 100000, 100000, 200000])


class OcrGapEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.pdf = self.root / 'source.pdf'
        self.native = self.root / 'native.json'; self.manifest = self.root / 'manifest.jsonl'
        with fitz.open() as doc:
            doc.new_page(width=600, height=800); doc.new_page(width=600, height=800)
            doc.save(self.pdf)
        self.pdf_sha = PROBE['file_sha'](self.pdf)
        self.artifact = {'schemaVersion': 'document-text-v4', 'sourceFileId': 'SYNTHETIC-1',
                         'inputSha256': self.pdf_sha, 'pageCount': 2,
                         'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pages': [
                             {'pageNumber': n, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                              'quality': {'disposition': 'OCR_REQUIRED' if n == 2 else 'TEXT_LAYER_CANDIDATE'},
                              'locatedLines': [], 'unlocatedLines': []} for n in [1, 2]]}
        self.row = {'file_id': 'SYNTHETIC-1', 'object_id': 'SYNTHETIC-OBJECT', 'sha256': self.pdf_sha,
                    'size_bytes': self.pdf.stat().st_size, 'pdf_pages': 2, 'extension': '.pdf',
                    'split': 'TRAIN_PUBLIC', 'distribution_status': 'INCLUDE', 'label_visibility': 'PUBLIC_TRAIN'}
        self.save_inputs()
        response = OcrGapProbeTests().response()
        class FakeProvider:
            calls = 0
            def preflight(self):
                return {'memAvailableKiB': 1800000, 'imageId': PROBE['IMAGE_ID'],
                        'health': {'status': 'ok', 'profileId': PROBE['PROFILE_ID'], 'device': 'cpu', 'loadedScripts': ['eslav']}}
            def ocr(self, png):
                self.calls += 1
                assert png.startswith(b'\x89PNG')
                return json.dumps(response, ensure_ascii=False).encode()
        self.provider = FakeProvider()

    def save_inputs(self):
        self.native.write_text(json.dumps(self.artifact)); self.manifest.write_text(json.dumps(self.row) + '\n')
        self.native_sha = PROBE['file_sha'](self.native); self.manifest_sha = PROBE['file_sha'](self.manifest)

    def run_probe(self, output='live', **kwargs):
        return PROBE['run_probe'](self.manifest, self.pdf, self.native, self.root / output,
                                  manifest_sha=self.manifest_sha, pdf_sha=self.pdf_sha,
                                  native_sha=self.native_sha, **kwargs)

    def test_plan_has_all_gaps_without_render_or_provider_requests(self):
        result = self.run_probe()
        self.assertEqual(result['selectedPageNumbers'], [2]); self.assertEqual(result['pages'], [])
        self.assertEqual(result['status'], 'PLAN_ONLY_NO_OCR_EXECUTED')
        self.assertFalse((self.root / 'live/p002').exists()); self.assertEqual(self.provider.calls, 0)

    def test_source_bound_execution_and_zero_inference_replay(self):
        before = self.native.read_bytes()
        result = self.run_probe(execute=True, provider=self.provider)
        self.assertEqual(result['failures'], []); self.assertEqual(self.provider.calls, 1)
        self.assertEqual(result['pages'][0]['pageNumber'], 2)
        self.assertEqual(result['pages'][0]['lines'][0]['bboxMilliPoints'], [50000, 675000, 150000, 700000])
        self.assertEqual(self.native.read_bytes(), before)
        replay = self.run_probe('replay', replay=self.root / 'live',
                                expected_replay_report_sha=PROBE['file_sha'](self.root / 'live/report.json'))
        self.assertEqual(replay['runtime']['providerInferenceRequests'], 0)
        self.assertEqual(replay['status'], 'ALL_SELECTED_PAGES_REPLAYED_REVIEW_ONLY')
        self.assertEqual(replay['pages'][0]['lines'], result['pages'][0]['lines'])
        self.assertFalse(replay['factEligible']); self.assertIsNone(replay['p'])

    def test_replay_missing_page_refuses_before_creating_output(self):
        self.run_probe(execute=True, provider=self.provider)
        path = self.root / 'live/report.json'; receipt = json.loads(path.read_text())
        receipt['pages'] = []; path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'REPLAY_PAGE_SEQUENCE_INCOMPLETE_OR_AMBIGUOUS'):
            self.run_probe('replay', replay=self.root / 'live',
                           expected_replay_report_sha=PROBE['file_sha'](path))
        self.assertFalse((self.root / 'replay').exists()); self.assertEqual(self.provider.calls, 1)

    def test_replay_changed_render_frame_remains_unresolved_without_inference(self):
        self.run_probe(execute=True, provider=self.provider)
        path = self.root / 'live/report.json'; receipt = json.loads(path.read_text())
        receipt['pages'][0]['widthMilliPoints'] += 1; path.write_text(json.dumps(receipt))
        replay = self.run_probe('replay', replay=self.root / 'live',
                                expected_replay_report_sha=PROBE['file_sha'](path))
        self.assertEqual(replay['status'], 'INCOMPLETE_OCR_GAPS_UNRESOLVED')
        self.assertEqual(replay['failures'][0]['reason'], 'REPLAY_RENDER_OR_SOURCE_FRAME_MISMATCH')
        self.assertEqual(replay['runtime']['providerInferenceRequests'], 0)
        self.assertEqual(self.provider.calls, 1)

    def test_byte_substitution_refuses_before_creating_output(self):
        self.pdf.write_bytes(self.pdf.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'SOURCE_PDF_SHA256_MISMATCH'): self.run_probe()
        self.assertFalse((self.root / 'live').exists())

    def test_foreign_native_source_binding_refuses_even_with_new_native_hash(self):
        self.artifact['inputSha256'] = '0' * 64; self.save_inputs()
        with self.assertRaisesRegex(ValueError, 'PUBLIC_SOURCE_MANIFEST_OR_NATIVE_BINDING_UNVERIFIED'):
            self.run_probe()

    def test_hidden_source_refuses_even_with_new_manifest_hash(self):
        self.row['split'] = 'TEST_HIDDEN'; self.save_inputs()
        with self.assertRaisesRegex(ValueError, 'PUBLIC_SOURCE_MANIFEST_OR_NATIVE_BINDING_UNVERIFIED'):
            self.run_probe()

    def test_resource_failure_stops_and_preserves_unresolved_gap(self):
        self.provider.preflight = lambda: {'memAvailableKiB': 1}
        result = self.run_probe(execute=True, provider=self.provider)
        self.assertEqual(result['pages'], []); self.assertEqual(self.provider.calls, 0)
        self.assertEqual(result['failures'][0]['reason'], 'HOMESERVER_MEMORY_GATE')
        self.assertEqual(result['status'], 'INCOMPLETE_OCR_GAPS_UNRESOLVED')

    def test_output_is_never_overwritten(self):
        self.run_probe(); before = (self.root / 'live/report.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'OUTPUT_DIRECTORY_ALREADY_EXISTS'): self.run_probe()
        self.assertEqual((self.root / 'live/report.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
