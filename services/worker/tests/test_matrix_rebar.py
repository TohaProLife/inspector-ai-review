"""Directed catalog example: a literal class is never a numeric plasticity scale."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.matrix_engine import build_matrix_execution, load_matrix_registry
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target
from inspector_worker.text_layer import qualify_page_text

RULE = 'matrix-kr-057-catalog_a500c_to_a400'
ATTRIBUTE = 'WORKING_REINFORCEMENT_CLASS'
MODE = 'WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED'
BASIS = 'DECLARED_REINFORCEMENT_CLASS'
FIXTURE = Path(__file__).parent / 'fixtures/rebar-F0106-F0139.json'


def fixture_args(*, full=True, expected='А500C', actual='А400'):
    sources, artifacts = [], []
    public = json.loads(FIXTURE.read_text())
    for index, item in enumerate(public['sources']):
        metadata, artifact = item['source'], copy.deepcopy(item['sourceArtifact'])
        source = {'sourceFileId': metadata['file_id'], 'sha256': metadata['sha256'],
                  'objectId': 'rebar-test-object', 'stages': [metadata['stage']]}
        if not full:
            page = artifact['pages'][49 if index == 0 else 3]
            page['pageNumber'] = 1
            for block in page['blocks']:
                old = 'Арматура  для  железобетонных  конструкций  предусмотрена  класса  А500C' if index == 0 else 'Арматура всех конструкций класса А500С'
                new = ('Арматура  для  железобетонных  конструкций  предусмотрена  класса  ' + expected) if index == 0 else ('Арматура всех конструкций класса ' + actual)
                block['text'] = block['text'].replace(old, new)
            page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
            digest = hashlib.sha256(('synthetic-rebar-' + str(index) + expected + actual).encode()).hexdigest()
            source.update(sourceFileId='SYNTHETIC-REBAR-' + metadata['stage'], sha256=digest)
            artifact.update(sourceFileId=source['sourceFileId'], inputSha256=digest,
                            pageCount=1, textPageCount=1, pages=[page], qualitySummary={
                                'textLayerCandidatePageCount': 1, 'ocrRequiredPageCount': 0})
        sources.append(source); artifacts.append(artifact)
    return {'object_id': 'rebar-test-object', 'input_manifest_hash': 'a' * 64,
            'sources': sources, 'text_artifacts': artifacts}


def rebar_facts(result):
    return [f for f in result['observations'] if f['attribute'] == ATTRIBUTE]


def rebar_rows(args):
    return [r for r in build_matrix_execution(**args)['results'] if r['ruleId'] == RULE]


def reviewed_args(*, expected='А500C', actual='А400'):
    args = fixture_args(full=False, expected=expected, actual=actual)
    origin = build_matrix_execution(**args)
    facts = rebar_facts(origin)
    assert len(facts) == 2, [(f['stage'], f['value']) for f in facts]
    args['input_manifest_hash'] = 'b' * 64
    for index, (source, artifact, fact) in enumerate(zip(args['sources'], args['text_artifacts'], facts)):
        target = derive_matrix_fact_target(fact, artifact)
        assert target is not None
        target = {'checkId': 'synthetic-rebar-origin', 'executionContentHash': 'c' * 64,
                  **{k: target[k] for k in ('observationId', 'evidenceHash', 'textArtifactHash')}}
        contexts = {
            'APPROVED_CHANGE_STATUS': {'reference': 'Inspector reviewed explicit approved changes', 'approvedChangePresent': False},
            'REINFORCEMENT_APPLICATION_SCOPE': {'reference': 'Inspector matched broad PD clause to the same working stair member, not guide wall or embedded bars'},
            'ATOMIC_SUBRULE_SCOPE:' + RULE: {'reference': 'Inspector reviewed original working reinforcement member and application',
                'parameterCode': 'KR-057', 'attribute': ATTRIBUTE, 'canonicalUnit': 'rebar_catalog_example',
                'componentRole': 'WORKING_REINFORCEMENT_POSITION', 'componentKey': 'stair-working-member',
                'zoneKey': 'underground-stair-flight-1', 'operatingModeKey': MODE, 'measurementBasisKey': BASIS}}
        binding = {'ruleId': RULE, 'ruleVersion': '1', 'parameterCode': 'KR-057',
                   'entityKey': 'stair-working-member', 'reference': 'Authenticated original synthetic working reinforcement review',
                   'target': target, 'contexts': contexts}
        source.update(sectionCode='KR', revisionStatus='CURRENT', approvalStatus='APPROVED', linkGroupId='rebar-reviewed-link')
        source['scopeProofs'] = {'FACT_BINDINGS': {'schemaVersion': 'matrix-fact-scopes-v1', 'status': 'VERIFIED',
            'sourceFileId': source['sourceFileId'], 'sourceSha256': source['sha256'], 'objectId': args['object_id'],
            'inputManifestHash': args['input_manifest_hash'], 'reference': 'Server authenticated source review',
            'reviewContentHash': ('e' if index == 0 else 'f') * 64, 'bindings': [binding]}}
    return args


def binding(args, index):
    return args['sources'][index]['scopeProofs']['FACT_BINDINGS']['bindings'][0]


class MatrixRebarTests(unittest.TestCase):
    def test_full_public_originals_preserve_categorical_values_scope_and_abstention(self):
        args = fixture_args(); before = copy.deepcopy(args); result = build_matrix_execution(**args)
        self.assertEqual([a['pageCount'] for a in args['text_artifacts']], [139, 22])
        facts = rebar_facts(result)
        self.assertEqual([(f['stage'], f['pageNumber'], f['value']) for f in facts], [('PD', 50, 'А500С'), ('RD', 4, 'А500С')])
        self.assertEqual([f['rawValue'] for f in facts], ['А500C', 'А500С'])
        self.assertTrue(all(f['rawUnit'] is None and f['unit'] == 'rebar_catalog_example' for f in facts))
        self.assertEqual([len(f['evidenceFragments']) for f in facts], [2, 1])
        self.assertTrue(all(p['role'] == 'MATERIAL_SCOPE' for f in facts for p in f['contextFragments']))
        self.assertEqual([len(f['contextFragments']) for f in facts], [2, 3])
        self.assertFalse(any(r['qualified'] for r in result['results'] if r['ruleId'] == RULE))
        self.assertEqual(args, before)

    def test_only_explicit_directed_example_can_trigger_without_ordinal_delta(self):
        rows = rebar_rows(reviewed_args())
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['qualified'], rows[0]['machineStatus'], rows[0]['delta']), (True, 'CANDIDATE', None))
        for expected, actual, reason in [('А500C', 'А500С', 'NEGATIVE_SCOPE_UNVERIFIED'),
                                          ('А400', 'А500С', 'UNSUPPORTED_CATEGORY_TRANSITION'),
                                          ('А400', 'А400', 'NEGATIVE_SCOPE_UNVERIFIED')]:
            with self.subTest(expected=expected, actual=actual):
                row = rebar_rows(reviewed_args(expected=expected, actual=actual))[0]
                self.assertFalse(row['qualified']); self.assertEqual(row['reasonCode'], reason)
                self.assertIsNone(row['delta'])

    def test_each_identity_and_application_proof_is_required(self):
        base = reviewed_args()
        for index in (0, 1):
            for key in ('APPROVED_CHANGE_STATUS', 'REINFORCEMENT_APPLICATION_SCOPE', 'ATOMIC_SUBRULE_SCOPE:' + RULE):
                args = copy.deepcopy(base); del binding(args, index)['contexts'][key]
                self.assertFalse(any(r['qualified'] for r in rebar_rows(args)), (index, key))
            for key, value in [('componentKey', 'guide-wall'), ('zoneKey', 'another-floor'),
                               ('operatingModeKey', 'ASSEMBLY'), ('measurementBasisKey', 'NUMERIC_GRADE_RANK')]:
                args = copy.deepcopy(base); binding(args, index)['contexts']['ATOMIC_SUBRULE_SCOPE:' + RULE][key] = value
                self.assertFalse(any(r['qualified'] for r in rebar_rows(args)), (index, key))
            args = copy.deepcopy(base); binding(args, index)['contexts']['APPROVED_CHANGE_STATUS']['approvedChangePresent'] = True
            self.assertFalse(any(r['qualified'] for r in rebar_rows(args)))

    def test_source_statuses_and_targets_never_derive_from_a_class(self):
        base = reviewed_args()
        for index in (0, 1):
            for key, value in [('approvalStatus', 'UNKNOWN'), ('revisionStatus', 'UNKNOWN'), ('linkGroupId', 'foreign')]:
                args = copy.deepcopy(base); args['sources'][index][key] = value
                self.assertFalse(any(r['qualified'] for r in rebar_rows(args)))
            args = copy.deepcopy(base); binding(args, index)['target']['textArtifactHash'] = '0' * 64
            self.assertFalse(any(r['qualified'] for r in rebar_rows(args)))

    def test_other_classes_and_generic_labels_do_not_enter_this_grammar(self):
        for actual in ('А240', 'А400С', 'А500В', 'А500', '500', 'А400/А500С'):
            args = fixture_args(full=False, actual=actual)
            result = build_matrix_execution(**args)
            self.assertEqual(len(rebar_facts(result)), 1, actual)
            self.assertFalse(any(r['qualified'] for r in result['results'] if r['ruleId'] == RULE))
        args = fixture_args(full=False)
        args['text_artifacts'][1]['pages'][0]['blocks'][45]['text'] = 'Класс рабочей арматуры: А400'
        page = args['text_artifacts'][1]['pages'][0]
        page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
        self.assertEqual(len(rebar_facts(build_matrix_execution(**args))), 1)

    def test_registry_cannot_expand_directed_example_or_drop_scope(self):
        registry = load_matrix_registry(); entry = next(e for e in registry['entries'] if e['parameterCode'] == 'KR-057')
        self.assertIsNone(entry['family']); self.assertIn('OTHER_GRADES_PLASTICITY_SCALE', entry['gap'])
        for key, value in [('family', 'DIFFERENT'), ('allowedValues', ['А500С', 'А400', 'А240']),
                           ('canonicalUnit', 'class'), ('requiredContext', []), ('subruleContext', None)]:
            changed = copy.deepcopy(registry); rule = next(e for e in changed['entries'] if e['parameterCode'] == 'KR-057')['atomicRules'][0]
            rule[key] = value
            with self.assertRaises(ValueError): build_matrix_execution(**fixture_args(full=False), registry=changed)

    def test_portable_selector_reconstructs_class_and_complete_material_scope(self):
        args = fixture_args(full=False)
        facts = rebar_facts(build_matrix_execution(**args))
        for fact, artifact in zip(facts, args['text_artifacts']):
            self.assertIsNotNone(derive_matrix_fact_target(fact, artifact))
            mutations = [('value', 'А400' if fact['value'] == 'А500С' else 'А500С'),
                         ('rawValue', 'A400' if fact['rawValue'] != 'A400' else 'А400'),
                         ('rawUnit', ''), ('parameterCodes', ['KR-057', 'KR-056']),
                         ('contextFragments', fact['contextFragments'][:-1])]
            mutations += [(key, 'inferred-from-class') for key in ('applicationScope', 'workingRole',
                'reinforcementApplicationScope', 'componentKey', 'zoneKey')]
            for key, value in mutations:
                forged = {**fact, key: value}
                self.assertIsNone(derive_matrix_fact_target(forged, artifact), (fact['stage'], key))
            forged = copy.deepcopy(fact)
            forged['contextFragments'].reverse()
            self.assertIsNone(derive_matrix_fact_target(forged, artifact))


if __name__ == '__main__': unittest.main()
