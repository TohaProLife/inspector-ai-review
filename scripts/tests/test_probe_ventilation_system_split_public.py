"""Independent literals and provenance/refusal checks for the offline probe."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest

PROBE = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'probe-ventilation-system-split-public.py'))
PD = 'П17 (L=9060 м3/ч, Pc=350 Па)'
RD1 = 'Проект: П17.1 (L=3340 м3/ч, Pc=540 Па)'
RD2 = 'Проект: П17.2 (L=5720 м3/ч, Pc=540 Па)'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def artifact(file_id, sha, lines):
    return {'schemaVersion': 'document-text-v2', 'sourceFileId': file_id, 'inputSha256': sha,
            'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pageCount': 1,
            'pages': [{'pageNumber': 1, 'widthMilliPoints': 1000, 'heightMilliPoints': 1000,
                       'blocks': [{'text': line, 'bboxMilliPoints': [10, 10, 900, 30],
                                   'lineBboxesMilliPoints': [[10, 10, 900, 30]]} for line in lines]}]}


class SplitProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.manifest = self.base / 'document_manifest.jsonl'
        self.rows, self.artifacts, self.inputs = [], [], []
        for role, file_id, stage, lines in [('PD', 'PD-A', 'PD', [PD]),
                                          ('RD', 'RD-A', 'RD_ID_MIXED', [RD1, RD2])]:
            data = ('original-pdf-bytes-' + file_id).encode()
            original = self.base / (file_id + '.pdf'); original.write_bytes(data)
            cache = self.base / (file_id + '.json')
            self.rows.append({'file_id': file_id, 'object_id': 'OBJECT-A', 'split': 'TRAIN_PUBLIC',
                              'distribution_status': 'INCLUDE', 'label_visibility': 'PUBLIC_TRAIN',
                              'extension': '.pdf', 'stage': stage, 'section': 'OV',
                              'sha256': digest(data), 'size_bytes': len(data), 'pdf_pages': 1})
            self.artifacts.append(artifact(file_id, digest(data), lines))
            self.inputs.append(PROBE['SourceInput'](role, file_id, original, cache, ''))
        self.write_inputs()

    def write_inputs(self):
        self.manifest.write_text('\n'.join(json.dumps(row) for row in self.rows) + '\n')
        self.manifest_hash = digest(self.manifest.read_bytes())
        new = []
        for source, item in zip(self.inputs, self.artifacts):
            source.canonical.write_text(json.dumps(item, ensure_ascii=False))
            new.append(PROBE['SourceInput'](source.role, source.file_id, source.original, source.canonical,
                                            digest(source.canonical.read_bytes())))
        self.inputs = new

    def report(self):
        return PROBE['build_report'](self.manifest, self.inputs, self.manifest_hash)

    def refusal(self, reason):
        self.assertEqual([row['reason'] for row in self.report()['refusedGroups']], [reason])
        self.assertEqual(self.report()['candidates'], [])

    def test_hand_authored_real_three_quotes(self):
        report = self.report()
        self.assertEqual(len(report['candidates']), 1)
        row = report['candidates'][0]
        self.assertEqual((row['stem'], row['pdDeclaredFlowM3PerHour'], row['rdAggregateFlowM3PerHour']), ('П17', '9060', '9060'))
        self.assertEqual(row['pdBaseline']['freePressurePa'], '350')
        self.assertEqual([(member['system'], member['airflowM3PerHour'], member['freePressurePa'])
                          for member in row['rdMembers']], [('П17.1', '3340', '540'), ('П17.2', '5720', '540')])
        self.assertEqual([quote['rawText'] for quote in report['observations']], [PD, RD1, RD2])
        self.assertEqual(row['status'], 'SOURCE_ONLY_SPLIT_CANDIDATE')
        self.assertFalse(row['samePhysicalSystemEstablished'])
        self.assertEqual(row['humanPairIdentity'], 'UNVERIFIED')
        self.assertIsNone(row['p']); self.assertIsNone(row['calibratedProbability'])
        self.assertFalse(row['matrixFinding']); self.assertFalse(row['numericReductionEstablished'])
        self.assertFalse(row['pageStagesVerified'])
        self.assertEqual(row['stageReason'], 'PAGE_STAGE_UNVERIFIED')
        self.assertEqual(report['sources'][1]['stage'], 'UNRESOLVED')
        self.assertEqual(report['runtime']['labelsRead'], 0)

    def test_exact_decimal_aggregation(self):
        self.artifacts[0]['pages'][0]['blocks'][0]['text'] = 'П17 (L=0,3 м3/ч, Pc=350 Па)'
        self.artifacts[1]['pages'][0]['blocks'][0]['text'] = 'П17.1 (L=0.1 м3/ч, Pc=540 Па)'
        self.artifacts[1]['pages'][0]['blocks'][1]['text'] = 'П17.2 (L=0.2 м3/ч, Pc=540 Па)'
        self.write_inputs()
        self.assertEqual(self.report()['candidates'][0]['rdAggregateFlowM3PerHour'], '0.3')

    def test_repeated_equal_quotes_preserve_every_location_without_double_count(self):
        self.artifacts[0]['pages'][0]['blocks'].append(copy.deepcopy(self.artifacts[0]['pages'][0]['blocks'][0]))
        self.artifacts[1]['pages'][0]['blocks'].extend(copy.deepcopy(self.artifacts[1]['pages'][0]['blocks']))
        self.write_inputs(); row = self.report()['candidates'][0]
        self.assertEqual(len(row['pdBaseline']['sourceQuotes']), 2)
        self.assertEqual([len(member['sourceQuotes']) for member in row['rdMembers']], [2, 2])
        self.assertEqual(row['rdAggregateFlowM3PerHour'], '9060')
        self.assertEqual(len({quote['quoteId'] for quote in self.report()['observations']}), 6)

    def test_conflicting_repeat_flow_refuses(self):
        item = copy.deepcopy(self.artifacts[1]['pages'][0]['blocks'][0]); item['text'] = RD1.replace('3340', '3300')
        self.artifacts[1]['pages'][0]['blocks'].append(item); self.write_inputs()
        self.refusal('CONFLICTING_TAG_VALUES')

    def test_conflicting_repeat_pressure_refuses(self):
        item = copy.deepcopy(self.artifacts[1]['pages'][0]['blocks'][0]); item['text'] = RD1.replace('540', '350')
        self.artifacts[1]['pages'][0]['blocks'].append(item); self.write_inputs()
        self.refusal('CONFLICTING_TAG_VALUES')

    def test_equal_quotes_from_two_sources_are_ambiguous(self):
        observations = self.report()['observations']
        other = copy.deepcopy(observations[0]); other['fileId'] = 'PD-B'; other['quoteId'] = 'other'
        candidates, refusals = PROBE['evaluate_splits'](observations + [other])
        self.assertEqual(candidates, []); self.assertEqual(refusals[0]['reason'], 'AMBIGUOUS_SOURCE')

    def test_missing_baseline_refuses(self):
        self.artifacts[0]['pages'][0]['blocks'] = []; self.write_inputs(); self.refusal('PD_BASELINE_MISSING')

    def test_single_suffix_is_not_split(self):
        self.artifacts[1]['pages'][0]['blocks'].pop(); self.write_inputs(); self.refusal('RD_SPLIT_MEMBERS_MISSING')

    def test_different_stem_does_not_pair(self):
        for block in self.artifacts[1]['pages'][0]['blocks']:
            block['text'] = block['text'].replace('П17', 'П18')
        self.write_inputs(); self.assertEqual(self.report()['candidates'], [])

    def test_unequal_sum_refuses(self):
        self.artifacts[1]['pages'][0]['blocks'][1]['text'] = RD2.replace('5720', '5719.999')
        self.write_inputs(); self.refusal('AGGREGATE_FLOW_MISMATCH')

    def test_pd_parent_and_child_ambiguous(self):
        self.artifacts[0]['pages'][0]['blocks'].append(copy.deepcopy(self.artifacts[1]['pages'][0]['blocks'][0]))
        self.write_inputs(); self.refusal('AMBIGUOUS_PD_BASELINE_CONFIGURATION')

    def test_rd_parent_and_children_ambiguous(self):
        self.artifacts[1]['pages'][0]['blocks'].append(copy.deepcopy(self.artifacts[0]['pages'][0]['blocks'][0]))
        self.write_inputs(); self.refusal('AMBIGUOUS_RD_UNSPLIT_CONFIGURATION')

    def test_no_nearby_table_inference_or_numeric_widening(self):
        invalid = ['П17 L=9060 м3/ч, Pc=350 Па', 'Итого по ' + PD, PD + ' ещё 2 установки',
                   PD.replace('9060', '9 060'), PD.replace('9060', '09060'), PD.replace('9060', '9.06e3'),
                   PD.replace('9060', '0'), PD.replace('350', '0'), PD.replace('350', '-350'),
                   PD.replace('П17', 'P17'), PD.replace('П17', 'П017'), PD.replace('П17', 'П17/18'),
                   PD.replace('м3/ч', 'м3/с'), PD.replace('9060', '9060–9070')]
        for raw in invalid:
            with self.subTest(raw=raw):
                self.assertIsNone(PROBE['parse_system_line'](raw))

    def test_missing_exact_line_bbox_rejected(self):
        self.artifacts[1]['pages'][0]['blocks'][0].pop('lineBboxesMilliPoints')
        self.write_inputs(); report = self.report()
        self.assertEqual(len(report['rejectedQuotes']), 1)
        self.assertEqual(report['rejectedQuotes'][0]['reason'], 'EXACT_LINE_BBOX_UNVERIFIED')
        self.assertEqual(report['candidates'], [])

    def test_original_changed_refuses(self):
        self.inputs[0].original.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_SHA256_OR_SIZE_MISMATCH'):
            self.report()

    def test_manifest_changed_refuses(self):
        self.manifest.write_bytes(self.manifest.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'MANIFEST_SHA256_MISMATCH'):
            self.report()

    def test_cache_changed_refuses(self):
        path = self.inputs[1].canonical; path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'CANONICAL_CACHE_SHA256_MISMATCH'):
            self.report()

    def test_foreign_cache_source_sha_refuses_even_with_new_cache_anchor(self):
        self.artifacts[1]['inputSha256'] = 'a' * 64; self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'CANONICAL_SOURCE_IDENTITY_OR_COMPLETENESS_MISMATCH'):
            self.report()

    def test_missing_full_cache_page_refuses(self):
        self.artifacts[1]['pages'] = []; self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'CANONICAL_SOURCE_IDENTITY_OR_COMPLETENESS_MISMATCH'):
            self.report()

    def test_wrong_page_number_refuses(self):
        self.artifacts[1]['pages'][0]['pageNumber'] = 2; self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'CANONICAL_FULL_PAGE_SEQUENCE_UNVERIFIED'):
            self.report()

    def test_foreign_object_refuses(self):
        self.rows[1]['object_id'] = 'OBJECT-B'; self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'OBJECT_MISMATCH'):
            self.report()

    def test_unknown_and_id_stage_refuse(self):
        for stage in ['UNKNOWN', 'ID']:
            self.rows[1]['stage'] = stage; self.write_inputs()
            with self.subTest(stage=stage), self.assertRaisesRegex(ValueError, 'SOURCE_ROLE_STAGE_UNVERIFIED'):
                self.report()

    def test_duplicate_manifest_source_refuses(self):
        self.rows.append(copy.deepcopy(self.rows[0])); self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_MANIFEST_SOURCE'):
            self.report()

    def test_cli_requires_explicit_opt_in(self):
        with self.assertRaises(SystemExit) as error:
            PROBE['main'](['--manifest', str(self.manifest), '--pd-file-id', 'PD-A', '--rd-file-id', 'RD-A',
                           '--pd-original', str(self.inputs[0].original), '--rd-original', str(self.inputs[1].original),
                           '--pd-canonical', str(self.inputs[0].canonical), '--rd-canonical', str(self.inputs[1].canonical),
                           '--expected-pd-canonical-sha256', self.inputs[0].expected_canonical_sha256,
                           '--expected-rd-canonical-sha256', self.inputs[1].expected_canonical_sha256,
                           '--output', str(self.base / 'output.json')])
        self.assertEqual(error.exception.code, 2)
        self.assertFalse((self.base / 'output.json').exists())


if __name__ == '__main__':
    unittest.main()
