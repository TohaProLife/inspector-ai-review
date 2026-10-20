"""Source-bound room comparisons; manual transcription never becomes a verdict."""
from __future__ import annotations

import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest

import fitz


ROOT = Path(__file__).resolve().parents[2]
PROBE = runpy.run_path(str(ROOT / 'scripts/probe-room-ventilation-pairs-public.py'))


def digest(value):
    return hashlib.sha256(value).hexdigest()


class RoomPairProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / 'manifest.jsonl'
        self.bindings_path = self.root / 'bindings.json'
        self.rows, self.inputs, records = [], [], []
        for role, file_id, stage in [('PD', 'PD-A', 'PD'), ('RD', 'RD-A', 'RD_ID_MIXED')]:
            doc = fitz.open()
            page = doc.new_page(width=600, height=500)
            page.insert_font(fontname='Native', fontbuffer=fitz.Font('helv').buffer)
            texts = [(50, 80, '147 Лаборантская тип АВ' if role == 'PD' else '147'),
                     (50, 110, 'В2.10' if role == 'PD' else 'В2.2')]
            if role == 'RD':
                texts += [(50, 140, 'В2.3'), (100, 300, '147'),
                          (130, 300, 'Лаборантская тип АВ')]
            texts += [(500, 400, 'В2.99'), (500, 470, 'П' if role == 'PD' else 'РД')]
            for x, y, text in texts:
                page.insert_text((x, y), text, fontsize=10, fontname='Native')
            original = self.root / (file_id + '.pdf')
            doc.save(original, deflate=True)
            doc.close()
            original_hash = digest(original.read_bytes())
            with fitz.open(original) as source:
                page = source[0]
                blocks = []
                for block in page.get_text('dict')['blocks']:
                    for line in block.get('lines', []):
                        text = ''.join(span['text'] for span in line['spans'])
                        box = PROBE['pdf_box'](line['bbox'], 500000)
                        blocks.append({'text': text, 'bboxMilliPoints': box,
                                       'lineBboxesMilliPoints': [box]})
                artifact = {'schemaVersion': 'document-text-v2', 'sourceFileId': file_id,
                            'inputSha256': original_hash, 'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS',
                            'pageCount': 1, 'pages': [{'pageNumber': 1, 'widthMilliPoints': 600000,
                                                     'heightMilliPoints': 500000, 'blocks': blocks}]}
                png = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=fitz.Rect(10, 10, 450, 225), alpha=False).tobytes('png')
            crop_path = role + '.png'
            (self.root / crop_path).write_bytes(png)
            crop = {'path': crop_path, 'clipPt': [10, 10, 450, 225], 'scale': 2,
                    'sha256': digest(png)}
            canonical = self.root / (file_id + '.json')
            canonical.write_text(json.dumps(artifact, ensure_ascii=False))
            canonical_hash = digest(canonical.read_bytes())
            self.inputs.append(PROBE['SourceInput'](role, file_id, original, canonical, canonical_hash))
            self.rows.append({'file_id': file_id, 'object_id': 'OBJECT-A', 'split': 'TRAIN_PUBLIC',
                              'distribution_status': 'INCLUDE', 'label_visibility': 'PUBLIC_TRAIN',
                              'extension': '.pdf', 'stage': stage, 'section': 'OV', 'sha256': original_hash,
                              'size_bytes': original.stat().st_size, 'pdf_pages': 1})

            def quote(index):
                return {'blockIndex': index, 'lineIndex': 0, 'rawText': blocks[index]['text'],
                        'bboxMilliPoints': blocks[index]['bboxMilliPoints']}

            systems = [{'kind': 'NATIVE_TEXT_LAYER', **quote(1)}]
            if role == 'RD':
                systems = []
                for index, text in [(1, 'В2.2'), (2, 'В2.3')]:
                    box = blocks[index]['bboxMilliPoints']
                    pixels = [(box[0] - 10000) // 500, (500000 - box[3] - 10000) // 500,
                              (box[2] - 10000 + 499) // 500, (500000 - box[1] - 10000 + 499) // 500]
                    systems.append({'kind': 'MANUAL_VISUAL_TRANSCRIPTION', 'rawText': text,
                                    'cropPixelBox': pixels, 'bboxMilliPoints': PROBE['visual_box'](crop, pixels, 500000)})
            records.append({'roomId': '147', 'inputRole': role, 'fileId': file_id,
                            'sourceSha256': original_hash, 'canonicalSha256': canonical_hash, 'physicalPage': 1,
                            'pageWidthMilliPoints': 600000, 'pageHeightMilliPoints': 500000,
                            'revisionStatus': 'UNVERIFIED', 'revisionAlternatives': [], 'crop': crop,
                            'planRoomLabel': quote(0),
                            'roomNameKind': 'INLINE_ROOM_NAME' if role == 'PD' else 'EXPLICIT_EXPLICATION_ROW',
                            'roomNameQuotes': [quote(0)] if role == 'PD' else [quote(3), quote(4)],
                            'systemQuotes': systems,
                            'stageEvidence': {'kind': 'NATIVE_TEXT_LAYER', **quote(len(blocks) - 1)}})
        self.bindings = {'schemaVersion': 'room-ventilation-source-bindings-v1',
                         'provenance': 'SYNTHETIC_MANUAL_INPUT_NO_LABELS',
                         'reviewAuthority': 'UNAUTHENTICATED_SOURCE_TRANSCRIPTION_ONLY',
                         'entityBindingMethod': 'MANUAL_DRAWING_SCOPE_PLUS_EXACT_NATIVE_ROOM_NUMBER_AND_FUNCTION',
                         'declaredScope': 'selected_V2_series', 'completeConfiguration': False,
                         'systemScope': 'SELECTED_LOCAL_SYSTEM_TAGS_NO_WHOLE_RD_ABSENCE', 'records': records}
        self.manifest.write_text('\n'.join(json.dumps(row) for row in self.rows) + '\n')
        self.manifest_hash = digest(self.manifest.read_bytes())
        self.save_bindings()

    def save_bindings(self):
        self.bindings_path.write_text(json.dumps(self.bindings, ensure_ascii=False))
        self.binding_hash = digest(self.bindings_path.read_bytes())

    def report(self):
        return PROBE['build_report'](self.manifest, self.inputs, self.manifest_hash,
                                     self.bindings_path, self.binding_hash, self.root)

    def assert_refuses(self, reason):
        with self.assertRaisesRegex(ValueError, reason):
            self.report()

    def test_literal_two_sides_keep_manual_source_scope_and_null_probability(self):
        report = self.report()
        self.assertEqual(len(report['candidates']), 1)
        row = report['candidates'][0]
        self.assertEqual((row['roomId'], row['roomFunction']), ('147', 'Лаборантская тип АВ'))
        self.assertEqual((row['pdSystemNames'], row['rdSystemNames']), (['В2.10'], ['В2.2', 'В2.3']))
        self.assertEqual(row['removedSelectedTagNames'], ['В2.10'])
        self.assertEqual(row['addedSelectedTagNames'], ['В2.2', 'В2.3'])
        self.assertEqual(row['status'], 'SOURCE_CONFIGURATION_DIFFERENCE_CANDIDATE')
        self.assertIsNone(row['p']); self.assertIsNone(row['calibratedProbability'])
        self.assertFalse(row['engineeringQualification']); self.assertFalse(row['wholeRdAbsenceEstablished'])
        self.assertFalse(row['automaticRoomSystemAttribution']); self.assertFalse(row['matrixFinding'])
        self.assertEqual(row['declaredScope'], 'selected_V2_series')
        self.assertFalse(row['completeConfiguration'])
        self.assertEqual(row['revisionAuthority'], 'UNVERIFIED')
        self.assertEqual(report['runtime']['labelsRead'], 0)
        self.assertEqual(report['runtime']['OCR'], 0)
        self.assertEqual(row['rdEvidence']['systemQuotes'][0]['evidenceKind'], 'MANUAL_VISUAL_TRANSCRIPTION')
        self.assertEqual(row['pdEvidence']['stage'], 'PD'); self.assertEqual(row['rdEvidence']['stage'], 'RD')
        self.assertEqual(self.report(), report)

    def test_original_substitution_refuses(self):
        self.inputs[1].original.write_bytes(b'foreign')
        self.assert_refuses('ORIGINAL_SHA256_OR_SIZE_MISMATCH')

    def test_canonical_substitution_refuses(self):
        self.inputs[1].canonical.write_bytes(self.inputs[1].canonical.read_bytes() + b' ')
        self.assert_refuses('CANONICAL_CACHE_SHA256_MISMATCH')

    def test_transcription_substitution_without_new_trust_anchor_refuses(self):
        self.bindings['records'][1]['systemQuotes'][0]['rawText'] = 'В2.99'
        self.bindings_path.write_text(json.dumps(self.bindings, ensure_ascii=False))
        self.assert_refuses('BINDINGS_SHA256_MISMATCH')

    def test_changed_crop_file_refuses(self):
        (self.root / 'RD.png').write_bytes(b'forged image')
        self.assert_refuses('CROP_FILE_SHA256_MISMATCH')

    def test_changed_geometry_even_with_new_binding_anchor_refuses(self):
        self.bindings['records'][1]['crop']['clipPt'][0] = 11
        self.save_bindings(); self.assert_refuses('SOURCE_CROP_RENDER_MISMATCH')

    def test_wrong_source_binding_with_new_anchor_refuses(self):
        self.bindings['records'][1]['sourceSha256'] = 'f' * 64
        self.save_bindings(); self.assert_refuses('BINDING_SOURCE_IDENTITY_MISMATCH')

    def test_wrong_canonical_quote_with_new_anchor_refuses(self):
        self.bindings['records'][0]['planRoomLabel']['rawText'] = '198 Лаборантская тип АВ'
        self.save_bindings(); self.assert_refuses('CANONICAL_QUOTE_MISMATCH')

    def test_swapped_room_identity_refuses(self):
        self.bindings['records'][1]['roomId'] = '198'
        self.save_bindings(); self.assertEqual(self.report()['candidates'], [])
        self.assertTrue(all(r['reason'] == 'BOTH_SOURCE_ROLES_REQUIRED' for r in self.report()['refusedRooms']))

    def test_foreign_object_manifest_refuses(self):
        self.rows[1]['object_id'] = 'OTHER'
        self.manifest.write_text('\n'.join(json.dumps(row) for row in self.rows))
        self.manifest_hash = digest(self.manifest.read_bytes())
        self.assert_refuses('OBJECT_MISMATCH')

    def test_duplicate_entity_binding_refuses_instead_of_choosing_first(self):
        self.bindings['records'].append(copy.deepcopy(self.bindings['records'][1])); self.save_bindings()
        self.assertEqual(self.report()['candidates'], [])
        self.assertEqual(self.report()['refusedRooms'][0]['reason'], 'AMBIGUOUS_ENTITY_OR_REVISION_BINDING')

    def test_ambiguous_revision_refuses(self):
        self.bindings['records'][1]['revisionAlternatives'] = [2]; self.save_bindings()
        self.assertEqual(self.report()['candidates'], [])
        self.assertEqual(self.report()['refusedRooms'][0]['reason'], 'AMBIGUOUS_REVISION_SCOPE')

    def test_manual_revision_claim_cannot_create_authority(self):
        self.bindings['records'][1]['revisionStatus'] = 'APPROVED'; self.save_bindings()
        self.assert_refuses('UNAUTHENTICATED_REVISION_CLAIM')

    def test_manual_box_cannot_escape_selected_scope(self):
        self.bindings['records'][1]['systemQuotes'][0]['cropPixelBox'] = [-1, 0, 10, 10]
        self.save_bindings(); self.assert_refuses('VISUAL_QUOTE_SCOPE_MISMATCH')

    def test_manual_box_geometry_cannot_be_forged(self):
        self.bindings['records'][1]['systemQuotes'][0]['bboxMilliPoints'][0] += 1
        self.save_bindings(); self.assert_refuses('VISUAL_QUOTE_SCOPE_MISMATCH')

    def test_neighbor_system_outside_crop_refuses(self):
        blocks = json.loads(self.inputs[0].canonical.read_text())['pages'][0]['blocks']
        self.bindings['records'][0]['systemQuotes'][0] = {
            'kind': 'NATIVE_TEXT_LAYER', 'blockIndex': len(blocks) - 2, 'lineIndex': 0,
            'rawText': 'В2.99', 'bboxMilliPoints': blocks[-2]['bboxMilliPoints']}
        self.save_bindings(); self.assert_refuses('QUOTE_OUTSIDE_SELECTED_CROP')

    def test_native_quote_must_exist_in_actual_pdf_not_only_cache(self):
        data = json.loads(self.inputs[0].canonical.read_text())
        data['pages'][0]['blocks'][0]['text'] = '147 Another room'
        self.inputs[0].canonical.write_text(json.dumps(data))
        new_hash = digest(self.inputs[0].canonical.read_bytes())
        source = self.inputs[0]
        self.inputs[0] = PROBE['SourceInput'](source.role, source.file_id, source.original, source.canonical, new_hash)
        record = self.bindings['records'][0]; record['canonicalSha256'] = new_hash
        record['planRoomLabel']['rawText'] = '147 Another room'
        record['roomNameQuotes'][0]['rawText'] = '147 Another room'
        self.save_bindings(); self.assert_refuses('ORIGINAL_NATIVE_QUOTE_UNVERIFIED')

    def test_duplicate_manual_system_names_refuse(self):
        self.bindings['records'][1]['systemQuotes'].append(copy.deepcopy(self.bindings['records'][1]['systemQuotes'][0]))
        self.save_bindings(); self.assert_refuses('AMBIGUOUS_SYSTEM_TRANSCRIPTION')

    def test_latin_or_partial_system_name_refuses(self):
        for raw in ['B2.2', 'В2.2/В2.3', 'В2.02', 'В2.2 отсутствует']:
            self.bindings['records'][1]['systemQuotes'][0]['rawText'] = raw; self.save_bindings()
            with self.subTest(raw=raw): self.assert_refuses('INVALID_SYSTEM_NAME')

    def test_transcription_authority_cannot_be_promoted(self):
        self.bindings['reviewAuthority'] = 'INSPECTOR_APPROVED'; self.save_bindings()
        self.assert_refuses('BINDINGS_AUTHORITY_OR_SCOPE_UNVERIFIED')

    def test_crop_path_escape_refuses(self):
        self.bindings['records'][1]['crop']['path'] = '../RD.png'; self.save_bindings()
        self.assert_refuses('CROP_PATH_SCOPE_UNVERIFIED')

    def test_no_labels_file_read_even_if_present(self):
        (self.root / 'public_train_checks.jsonl').write_text('DO_NOT_PARSE_THIS')
        self.assertEqual(len(self.report()['candidates']), 1)
        self.assertEqual(self.report()['runtime']['labelsRead'], 0)

    def test_scope_cannot_be_promoted_to_complete_configuration(self):
        self.bindings['completeConfiguration'] = True; self.save_bindings()
        self.assert_refuses('BINDINGS_AUTHORITY_OR_SCOPE_UNVERIFIED')

    def test_stage_mark_conflict_refuses_even_with_valid_native_quote(self):
        self.bindings['records'][1]['stageEvidence'] = {
            'kind': 'NATIVE_TEXT_LAYER', **self.bindings['records'][1]['planRoomLabel']}
        self.save_bindings(); self.assert_refuses('SOURCE_PAGE_STAGE_CONFLICT')

    def test_stage_evidence_cannot_be_omitted(self):
        self.bindings['records'][1]['stageEvidence'] = None; self.save_bindings()
        self.assert_refuses('PAGE_STAGE_EVIDENCE_REQUIRED')

    def test_page_frame_substitution_refuses(self):
        self.bindings['records'][1]['pageHeightMilliPoints'] += 1; self.save_bindings()
        self.assert_refuses('BINDING_PAGE_FRAME_MISMATCH')

    def test_an_explication_room_number_cannot_be_used_as_plan_label(self):
        self.bindings['records'][1]['planRoomLabel'] = copy.deepcopy(self.bindings['records'][1]['roomNameQuotes'][0])
        self.save_bindings(); self.assert_refuses('ROOM_LABEL_OUTSIDE_SELECTED_CROP')

    def test_two_equal_room_numbers_inside_scope_refuse(self):
        # Enlarge scope to include the second real native number, with an honestly re-rendered crop.
        with fitz.open(self.inputs[1].original) as doc:
            png = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2), clip=fitz.Rect(10, 10, 450, 450), alpha=False).tobytes('png')
        (self.root / 'RD.png').write_bytes(png)
        self.bindings['records'][1]['crop'].update(clipPt=[10, 10, 450, 450], sha256=digest(png))
        self.save_bindings(); self.assert_refuses('AMBIGUOUS_PLAN_ROOM_LABEL')

    def test_actual_native_function_conflict_refuses_room_pair(self):
        source = self.inputs[1]
        changed = self.root / 'changed.pdf'
        with fitz.open(source.original) as doc:
            page = doc[0]
            rect = page.search_for('Лаборантская тип АВ')[0]
            page.add_redact_annot(rect)
            page.apply_redactions()
            page.insert_text((130, 300), 'Different laboratory', fontname='Native', fontsize=10)
            doc.save(changed, deflate=True)
        source.original.write_bytes(changed.read_bytes())
        source_sha = digest(source.original.read_bytes())
        data = json.loads(source.canonical.read_text()); data['inputSha256'] = source_sha
        with fitz.open(source.original) as doc:
            blocks = []
            for block in doc[0].get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    raw = ''.join(span['text'] for span in line['spans'])
                    box = PROBE['pdf_box'](line['bbox'], 500000)
                    blocks.append({'text': raw, 'bboxMilliPoints': box, 'lineBboxesMilliPoints': [box]})
        data['pages'][0]['blocks'] = blocks
        source.canonical.write_text(json.dumps(data, ensure_ascii=False))
        cache_sha = digest(source.canonical.read_bytes())
        self.inputs[1] = PROBE['SourceInput']('RD', 'RD-A', source.original, source.canonical, cache_sha)
        self.rows[1].update(sha256=source_sha, size_bytes=source.original.stat().st_size)
        self.manifest.write_text('\n'.join(json.dumps(row) for row in self.rows))
        self.manifest_hash = digest(self.manifest.read_bytes())
        record = self.bindings['records'][1]
        record.update(sourceSha256=source_sha, canonicalSha256=cache_sha)
        selectors = [record['planRoomLabel'], *record['roomNameQuotes'], record['stageEvidence']]
        for spec in selectors:
            raw = spec['rawText'] if spec['rawText'] != 'Лаборантская тип АВ' else 'Different laboratory'
            candidates = [(i, b) for i, b in enumerate(blocks) if b['text'] == raw]
            if len(candidates) > 1:
                candidates = [(i, b) for i, b in candidates if abs(b['bboxMilliPoints'][1] - spec['bboxMilliPoints'][1]) < 1000]
            self.assertEqual(len(candidates), 1)
            index, block = candidates[0]
            spec.update(blockIndex=index, lineIndex=0, rawText=raw, bboxMilliPoints=block['bboxMilliPoints'])
        self.save_bindings()
        result = self.report()
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['refusedRooms'][0]['reason'], 'ROOM_FUNCTION_CONFLICT')

    def cli_args(self, output):
        args = ['--offline-probe', '--manifest', str(self.manifest), '--expected-manifest-sha256', self.manifest_hash,
                '--bindings', str(self.bindings_path), '--expected-bindings-sha256', self.binding_hash,
                '--evidence-root', str(self.root), '--output', str(output)]
        for source in self.inputs:
            role = source.role.lower()
            args += ['--' + role + '-file-id', source.file_id, '--' + role + '-original', str(source.original),
                     '--' + role + '-canonical', str(source.canonical),
                     '--expected-' + role + '-canonical-sha256', source.expected_canonical_sha256]
        return args

    def test_cli_requires_explicit_opt_in_and_writes_nothing(self):
        output = self.root / 'result.json'
        args = self.cli_args(output); args.remove('--offline-probe')
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            PROBE['main'](args)
        self.assertEqual(error.exception.code, 2); self.assertFalse(output.exists())

    def test_cli_preserves_existing_output(self):
        output = self.root / 'result.json'; output.write_text('preserve')
        with redirect_stderr(io.StringIO()):
            status = PROBE['main'](self.cli_args(output))
        self.assertEqual(status, 2); self.assertEqual(output.read_text(), 'preserve')

    def test_cli_input_collision_refuses_before_mutation(self):
        before = self.bindings_path.read_bytes()
        with redirect_stderr(io.StringIO()):
            status = PROBE['main'](self.cli_args(self.bindings_path))
        self.assertEqual(status, 2); self.assertEqual(self.bindings_path.read_bytes(), before)

    def test_cli_writes_exact_report_and_does_not_overwrite_replay(self):
        output = self.root / 'result.json'
        with redirect_stdout(io.StringIO()):
            status = PROBE['main'](self.cli_args(output))
        self.assertEqual(status, 0); self.assertEqual(json.loads(output.read_text()), self.report())
        before = output.read_bytes()
        with redirect_stderr(io.StringIO()):
            self.assertEqual(PROBE['main'](self.cli_args(output)), 2)
        self.assertEqual(output.read_bytes(), before)


class SuppliedPublicOriginalReplayTests(unittest.TestCase):
    def test_default_portable_bindings_and_source_pins_match(self):
        fixture = ROOT / 'fixtures/real-public-room-pairs-v1'
        pins = json.loads((fixture / 'source-pins.json').read_text())
        self.assertEqual(PROBE['DEFAULT_BINDINGS'], fixture / 'manual-source-bindings.json')
        self.assertEqual(digest(PROBE['DEFAULT_BINDINGS'].read_bytes()), PROBE['DEFAULT_BINDINGS_SHA256'])
        self.assertEqual(pins['bindingsSha256'], PROBE['DEFAULT_BINDINGS_SHA256'])
        bindings = PROBE['_read_bindings'](PROBE['DEFAULT_BINDINGS'], PROBE['DEFAULT_BINDINGS_SHA256'])
        for record in bindings['records']:
            for crop in [record['crop'], record['stageEvidence'].get('crop')]:
                if crop is not None:
                    self.assertEqual(digest((ROOT / crop['path']).read_bytes()), crop['sha256'])

    def test_both_real_room_candidates_from_full_verified_originals(self):
        supplied = os.environ.get('INSPECTOR_ROOM_VENTILATION_REPLAY_DIR')
        if not supplied:
            self.skipTest('set INSPECTOR_ROOM_VENTILATION_REPLAY_DIR to a directory of permitted original PDFs and full caches')
        supplied_dir = Path(supplied).resolve()
        fixture = ROOT / 'fixtures/real-public-room-pairs-v1'
        pins = json.loads((fixture / 'source-pins.json').read_text())
        inputs = [PROBE['SourceInput'](role, fid, supplied_dir / (fid + '.pdf'),
                                     supplied_dir / (fid + '-canonical.json'), pins['sources'][fid]['canonicalSha256'])
                  for role, fid in [('PD', 'F0171'), ('RD', 'F0201')]]
        manifest = supplied_dir / 'document_manifest.jsonl'
        report = PROBE['build_report'](manifest, inputs, PROBE['EXPECTED_MANIFEST_SHA256'],
                                       fixture / 'manual-source-bindings.json', pins['bindingsSha256'], ROOT)
        self.assertEqual(report['refusedRooms'], [])
        self.assertEqual([(r['roomId'], r['pdSystemNames'], r['rdSystemNames']) for r in report['candidates']],
                         [('147', ['В2.10'], ['В2.2', 'В2.3', 'В2.4']),
                          ('198', ['В2.2', 'В2.3'], ['В2.8', 'В2.9', 'В2.10'])])
        self.assertEqual(report['runtime']['sourceCropRenderCount'], 5)
        for pair in report['candidates']:
            self.assertEqual(pair['roomFunction'], 'Лаборантская тип АВ')
            self.assertEqual((pair['pdEvidence']['physicalPage'], pair['rdEvidence']['physicalPage']), (88, 18))
            self.assertEqual(pair['declaredScope'], 'selected_V2_series'); self.assertFalse(pair['completeConfiguration'])
            self.assertFalse(pair['engineeringQualification']); self.assertIsNone(pair['p'])
            self.assertTrue(all(q['evidenceKind'] == 'MANUAL_VISUAL_TRANSCRIPTION' and not q['transcriptionTextMachineVerified']
                                for q in pair['rdEvidence']['systemQuotes']))


if __name__ == '__main__':
    unittest.main()
