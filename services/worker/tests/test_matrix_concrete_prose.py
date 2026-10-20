"""Existing KR055: new independent stair prose, no extra atom or source approval."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target, portable_evidence_hash
from inspector_worker.text_layer import qualify_page_text

RULE = 'matrix-kr-055-concrete_class'
ATTRIBUTE = 'CONCRETE_CLASS'
ROLE = 'MONOLITHIC_LOAD_BEARING_STAIR'
MODE = 'CAST_IN_PLACE_LOAD_BEARING_STAIR'
BASIS = 'CONCRETE_COMPRESSIVE_STRENGTH_CLASS'
ENTITY = 'matched-underground-monolithic-stair'
FIXTURE = Path(__file__).parent / 'fixtures/rebar-F0106-F0139.json'


def concrete_facts(result):
    return [f for f in result['observations'] if f['attribute'] == ATTRIBUTE
            and any(p['role'] == 'MATERIAL_SCOPE' for p in f.get('contextFragments', []))]


def fixture_args(*, full=True, expected='В30', actual='В25'):
    sources, artifacts = [], []
    for item in json.loads(FIXTURE.read_text())['sources']:
        metadata, artifact = item['source'], copy.deepcopy(item['sourceArtifact'])
        stage = metadata['stage']
        source = {'sourceFileId': metadata['file_id'], 'sha256': metadata['sha256'],
                  'objectId': 'concrete-test-object', 'stages': [stage]}
        if not full:
            selected = [artifact['pages'][48], artifact['pages'][49]] if stage == 'PD' else [artifact['pages'][3]]
            for index, page in enumerate(selected):
                page['pageNumber'] = index + 1
            primary = selected[-1]['blocks'][3 if stage == 'PD' else 44]
            lines = primary['text'].split('\n')
            lines[0] = lines[0].replace('В30', expected if stage == 'PD' else actual)
            primary['text'] = '\n'.join(lines)
            for page in selected:
                page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
            digest = hashlib.sha256(('synthetic-concrete-' + stage + expected + actual).encode()).hexdigest()
            source.update(sourceFileId='SYNTHETIC-CONCRETE-' + stage, sha256=digest)
            artifact.update(sourceFileId=source['sourceFileId'], inputSha256=digest,
                            pageCount=len(selected), textPageCount=len(selected), pages=selected,
                            qualitySummary={'textLayerCandidatePageCount': len(selected), 'ocrRequiredPageCount': 0})
        sources.append(source); artifacts.append(artifact)
    return {'object_id': 'concrete-test-object', 'input_manifest_hash': 'a' * 64,
            'sources': sources, 'text_artifacts': artifacts}


def reviewed_args(*, expected='В30', actual='В25'):
    args = fixture_args(full=False, expected=expected, actual=actual)
    origin = build_matrix_execution(**args)
    facts = {f['stage']: f for f in concrete_facts(origin)}
    assert set(facts) == {'PD', 'RD'}, set(facts)
    args['input_manifest_hash'] = 'b' * 64
    for index, (source, artifact) in enumerate(zip(args['sources'], args['text_artifacts'])):
        target = derive_matrix_fact_target(facts[source['stages'][0]], artifact)
        assert target is not None
        target = {'checkId': 'synthetic-concrete-origin', 'executionContentHash': 'c' * 64,
                  **{key: target[key] for key in ('observationId', 'evidenceHash', 'textArtifactHash')}}
        contexts = {
            'ELEMENT_IDENTITY': {'reference': 'Inspector matched the same load-bearing monolithic underground stair member',
                'componentRole': ROLE, 'componentKey': ENTITY, 'zoneKey': 'underground-stair-flight-1',
                'operatingModeKey': MODE, 'measurementBasisKey': BASIS},
            'MATERIAL_CLASS_BASIS': {'reference': 'Inspector confirmed compressive strength class of this same concrete member',
                'attribute': ATTRIBUTE, 'canonicalUnit': 'B_CLASS', 'measurementBasisKey': BASIS}}
        binding = {'ruleId': RULE, 'ruleVersion': '1', 'parameterCode': 'KR-055', 'entityKey': ENTITY,
                   'reference': 'Authenticated original synthetic stair concrete review', 'target': target, 'contexts': contexts}
        source.update(sectionCode='KR', revisionStatus='CURRENT', approvalStatus='APPROVED', linkGroupId='concrete-reviewed-link')
        source['scopeProofs'] = {'FACT_BINDINGS': {'schemaVersion': 'matrix-fact-scopes-v1', 'status': 'VERIFIED',
            'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sha256'], 'objectId': args['object_id'],
            'inputManifestHash': args['input_manifest_hash'], 'reference': 'Server authenticated synthetic source review',
            'reviewContentHash': ('e' if index == 0 else 'f') * 64, 'bindings': [binding]}}
    return args


def binding(args, index):
    return args['sources'][index]['scopeProofs']['FACT_BINDINGS']['bindings'][0]


def concrete_rows(args):
    return [r for r in build_matrix_execution(**args)['results'] if r['ruleId'] == RULE
            and r['comparisonVariant'] == 'PD_RD' and r['entityKey'] == ENTITY]


class MatrixConcreteProseTests(unittest.TestCase):
    def test_full_public_adds_two_prose_facts_preserving_all_previous_payloads_and_ids(self):
        args = fixture_args(); before = copy.deepcopy(args); result = build_matrix_execution(**args)
        facts = concrete_facts(result)
        self.assertEqual([(f['stage'], f['pageNumber'], f['value']) for f in facts], [('PD', 50, 'В30'), ('RD', 4, 'В30')])
        self.assertEqual(sum(f['attribute'] == ATTRIBUTE for f in result['observations']), 8)
        self.assertEqual([len(f['contextFragments']) for f in facts], [3, 1])
        self.assertEqual([[p['pageNumber'] for p in f['contextFragments']] for f in facts], [[49, 49, 50], [4]])
        self.assertTrue(all(f['rawUnit'] == 'B_CLASS' and f['entityKey'] is None for f in facts))
        self.assertTrue(all('TABLE_CONTEXT_UNVERIFIED' not in f['sourceFlags'] for f in facts))
        old = [f for f in result['observations'] if f not in facts]
        self.assertEqual(len(old), 13)
        # Frozen before adding this integration; protects every old raw payload,
        # selector/id preimage, table flag and literal string, not just counts.
        self.assertEqual(hashlib.sha256(json.dumps(old, ensure_ascii=False, sort_keys=True,
            separators=(',', ':')).encode()).hexdigest(), 'c0330c3549497bfd21392fa4d0c64587fed1665f5009673f19d393fce87494cf')
        self.assertEqual(sum('TABLE_CONTEXT_UNVERIFIED' in f['sourceFlags'] for f in old if f['attribute'] == ATTRIBUTE), 6)
        self.assertFalse(any(r['qualified'] for r in result['results'] if r['ruleId'] == RULE))
        self.assertEqual(args, before)

    def test_reviewed_class_decrease_aliases_and_equality_stay_bounded(self):
        for actual in ('B25', 'В25'):
            row = concrete_rows(reviewed_args(actual=actual))[0]
            self.assertEqual((row['qualified'], row['machineStatus'], row['delta']), (True, 'CANDIDATE', '-5'))
            self.assertNotIn('probability', row)
        for expected, actual in [('В30', 'В30'), ('B30', 'В30'), ('В25', 'В30')]:
            row = concrete_rows(reviewed_args(expected=expected, actual=actual))[0]
            self.assertFalse(row['qualified']); self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')

    def test_every_identity_and_material_basis_is_required_and_matched(self):
        baseline = reviewed_args()
        for index in (0, 1):
            for key in ('ELEMENT_IDENTITY', 'MATERIAL_CLASS_BASIS'):
                args = copy.deepcopy(baseline); del binding(args, index)['contexts'][key]
                rows = concrete_rows(args); self.assertTrue(rows)
                self.assertFalse(any(r['qualified'] for r in rows)); self.assertEqual(rows[0]['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
            for field, value in [('componentRole', 'WORKING_REINFORCEMENT_POSITION'), ('componentKey', 'another-member'),
                                 ('zoneKey', 'above-ground'), ('operatingModeKey', 'CAST_IN_PLACE_NONLOAD_BEARING'),
                                 ('measurementBasisKey', 'SURFACE_FINISH_CLASS')]:
                args = copy.deepcopy(baseline); binding(args, index)['contexts']['ELEMENT_IDENTITY'][field] = value
                self.assertFalse(any(r['qualified'] for r in concrete_rows(args)), (index, field))
            for field, value in [('attribute', 'REBAR_CLASS'), ('canonicalUnit', 'm'), ('measurementBasisKey', 'STRIPPING_STRENGTH')]:
                args = copy.deepcopy(baseline); binding(args, index)['contexts']['MATERIAL_CLASS_BASIS'][field] = value
                self.assertFalse(any(r['qualified'] for r in concrete_rows(args)), (index, field))
            for field in ('componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey'):
                args = copy.deepcopy(baseline); del binding(args, index)['contexts']['ELEMENT_IDENTITY'][field]
                self.assertFalse(any(r['qualified'] for r in concrete_rows(args)), (index, field))

    def test_withdraw_restore_and_source_approval_do_not_mutate_old_execution(self):
        args = reviewed_args(); first = build_matrix_execution(**args)
        frozen = json.dumps(first, ensure_ascii=False, sort_keys=True)
        for index in (0, 1):
            changed = copy.deepcopy(args); del binding(changed, index)['contexts']['MATERIAL_CLASS_BASIS']
            self.assertFalse(any(r['qualified'] for r in concrete_rows(changed)))
            self.assertTrue(any(r['qualified'] for r in concrete_rows(args)))
            for field, value in [('approvalStatus', 'UNKNOWN'), ('revisionStatus', 'SUPERSEDED'), ('linkGroupId', 'other')]:
                changed = copy.deepcopy(args); changed['sources'][index][field] = value
                self.assertFalse(any(r['qualified'] for r in concrete_rows(changed)))
        self.assertEqual(json.dumps(first, ensure_ascii=False, sort_keys=True), frozen)

    def test_whole_file_legacy_context_cannot_substitute_for_fact_bindings(self):
        args = reviewed_args()
        # Remove unrelated synthetic table facts so ambiguity does not mask the
        # exact whole-file fallback boundary being exercised by this test.
        page = args['text_artifacts'][0]['pages'][1]
        for block_index in (1, 2):
            block = page['blocks'][block_index]
            block['text'] = '\n'.join('Чужой табличный элемент' for _ in block['text'].split('\n'))
        page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
        for source in args['sources']:
            envelope = source['scopeProofs']['FACT_BINDINGS']; b = envelope['bindings'][0]
            source['scopeProofs'] = {key: {**context, 'status': 'VERIFIED', 'sourceFileId': source['sourceFileId'],
                'sourceSha256': source['sha256'], 'objectId': args['object_id'], 'inputManifestHash': args['input_manifest_hash'],
                'entityKey': ENTITY} for key, context in {'ENTITY_SCOPE': {'reference': 'Whole-file legacy entity'}, **b['contexts']}.items()}
        rows = concrete_rows(args); self.assertTrue(rows)
        self.assertFalse(any(r['qualified'] for r in rows)); self.assertEqual(rows[0]['reasonCode'], 'CONTEXT_UNVERIFIED:ELEMENT_IDENTITY')

    def test_portable_selector_reconstructs_raw_class_headers_scope_and_order(self):
        args = fixture_args(full=False); facts = concrete_facts(build_matrix_execution(**args))
        for fact in facts:
            artifact = next(a for a in args['text_artifacts'] if a['sourceFileId'] == fact['sourceFileId'])
            self.assertIsNotNone(derive_matrix_fact_target(fact, artifact))
            variants = [('value', 'B30'), ('rawValue', 'B30'), ('rawUnit', None), ('parameterCodes', ['KR-055', 'KR-057']),
                        ('contextFragments', fact['contextFragments'][:-1]),
                        ('contextFragments', list(reversed(fact['contextFragments'])))]
            if len(fact['contextFragments']) == 1:
                variants = [v for v in variants if not (v[0] == 'contextFragments' and v[1] == fact['contextFragments'])]
            for key in ('applicationScope', 'concreteApplicationScope', 'concreteScope', 'materialClassBasis', 'workingRole',
                        'componentRole', 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey', 'loadBearing', 'memberIdentity'):
                variants.append((key, 'inferred'))
            for field, value in variants:
                forged = {**fact, field: value}; forged['id'] = hashlib.sha256(portable_evidence_hash(forged).encode()).hexdigest()
                self.assertIsNone(derive_matrix_fact_target(forged, artifact), (fact['stage'], field))
            forged = copy.deepcopy(fact); del forged['contextFragments']
            self.assertIsNone(derive_matrix_fact_target(forged, artifact))
            forged = copy.deepcopy(fact)
            for part in forged['contextFragments']: part['role'] = 'ATTRIBUTE_HEADER'
            self.assertIsNone(derive_matrix_fact_target(forged, artifact))

    def test_previous_page_is_same_source_authenticated_pd_stage_only(self):
        args = fixture_args(full=False)
        source = args['sources'][0]; source.update(stages=['PD', 'RD'], pageStages={'1': 'RD', '2': 'PD'})
        result = build_matrix_execution(**args)
        self.assertEqual([f['stage'] for f in concrete_facts(result)], ['RD'])
        args = fixture_args(full=False); args['sources'][0].update(stages=['PD', 'ID'], pageStages={'1': 'UNRESOLVED', '2': 'PD'})
        self.assertEqual([f['stage'] for f in concrete_facts(build_matrix_execution(**args))], ['RD'])
        args = fixture_args(full=False)
        moved = args['text_artifacts'][0]['pages'].pop(0)
        args['text_artifacts'][0]['pages'][0]['pageNumber'] = 1
        args['text_artifacts'][0].update(pageCount=1, textPageCount=1, qualitySummary={'textLayerCandidatePageCount': 1, 'ocrRequiredPageCount': 0})
        args['text_artifacts'][1]['pages'].append(moved)
        args['text_artifacts'][1]['pages'][-1]['pageNumber'] = 2
        args['text_artifacts'][1].update(pageCount=2, textPageCount=2, qualitySummary={'textLayerCandidatePageCount': 2, 'ocrRequiredPageCount': 0})
        self.assertEqual([f['stage'] for f in concrete_facts(build_matrix_execution(**args))], ['RD'])

    def test_mixed_table_prose_keeps_table_review_gate(self):
        args = reviewed_args()
        unreviewed = fixture_args(full=False)
        table = next(f for f in build_matrix_execution(**unreviewed)['observations']
                     if f['attribute'] == ATTRIBUTE and 'TABLE_CONTEXT_UNVERIFIED' in f['sourceFlags'])
        target = derive_matrix_fact_target(table, args['text_artifacts'][0])
        self.assertIsNotNone(target)
        b = binding(args, 0)
        b['target'].update({key: target[key] for key in ('observationId', 'evidenceHash', 'textArtifactHash')})
        row = concrete_rows(args)[0]
        self.assertFalse(row['qualified']); self.assertEqual(row['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
        b['tableContextReview'] = {'fragmentsHash': target['fragmentsHash'], 'reference': 'Inspector reviewed this synthetic table cell and material context'}
        self.assertTrue(concrete_rows(args)[0]['qualified'])
        for index in (0, 1):
            changed = copy.deepcopy(args); binding(changed, index)['contexts']['ELEMENT_IDENTITY']['componentRole'] = 'UNKNOWN'
            self.assertFalse(any(r['qualified'] for r in concrete_rows(changed)))

    def test_prose_cannot_qualify_an_id_stage_pair(self):
        args = reviewed_args(); source, artifact = args['sources'][1], args['text_artifacts'][1]
        source['stages'] = ['ID']
        page = artifact['pages'][0]
        page['blocks'][44]['text'] = 'Класс бетона: В25'
        page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
        b = binding(args, 1)
        b['contexts']['DRAWING_SECTION_VERIFIED'] = {'reference': 'Inspector checked actual synthetic ID drawing section', 'drawingSection': 'KR'}
        # Extract the authentic generic ID origin before attaching its binding.
        envelope = source['scopeProofs'].pop('FACT_BINDINGS')
        result = build_matrix_execution(**args)
        fact = next(f for f in result['observations'] if f['stage'] == 'ID' and f['attribute'] == ATTRIBUTE)
        target = derive_matrix_fact_target(fact, artifact); self.assertIsNotNone(target)
        b['target'].update({key: target[key] for key in ('observationId', 'evidenceHash', 'textArtifactHash')})
        source['scopeProofs']['FACT_BINDINGS'] = envelope
        row = next(r for r in build_matrix_execution(**args)['results']
                   if r['ruleId'] == RULE and r['comparisonVariant'] == 'PD_ID' and r['entityKey'] == ENTITY)
        self.assertFalse(row['qualified']); self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:ELEMENT_IDENTITY')

    def test_raw_context_spacing_and_changed_material_header_cannot_forge_selector(self):
        args = fixture_args(full=False)
        fact = next(f for f in concrete_facts(build_matrix_execution(**args)) if f['stage'] == 'PD')
        artifact = args['text_artifacts'][0]
        forged = copy.deepcopy(fact)
        forged['contextFragments'][0]['rawText'] = ' '.join(forged['contextFragments'][0]['rawText'].split())
        self.assertIsNone(derive_matrix_fact_target(forged, artifact))
        changed_artifact = copy.deepcopy(artifact)
        changed_artifact['pages'][0]['blocks'][10]['text'] = changed_artifact['pages'][0]['blocks'][10]['text'].replace('бетона', 'арматуры')
        forged = copy.deepcopy(fact)
        forged['contextFragments'][0]['rawText'] = changed_artifact['pages'][0]['blocks'][10]['text'].split('\n')[0]
        forged['id'] = hashlib.sha256(portable_evidence_hash(forged).encode()).hexdigest()
        self.assertIsNone(derive_matrix_fact_target(forged, changed_artifact))


if __name__ == '__main__':
    unittest.main()
