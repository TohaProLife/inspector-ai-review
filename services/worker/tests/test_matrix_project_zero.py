"""PZ009 declared project datum integration; public facts do not confer authority."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.matrix_engine import build_matrix_execution, load_matrix_registry
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target
from inspector_worker.text_layer import qualify_page_text

RULE = 'matrix-pz-009-declared_project_zero_absolute_elevation'
ATTRIBUTE = 'PROJECT_ZERO_ABSOLUTE_ELEVATION'
BASIS = 'FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM'
OBJECT = 'project-zero-test-object'
MANIFEST = 'a' * 64
REVIEW = 'e' * 64
FIXTURE = Path(__file__).parent / 'fixtures/project-zero-F0101-F0139.json'
PUBLIC = json.loads(FIXTURE.read_text())


def fixture_args(*, full: bool = True, actual: str = '159.95') -> dict:
    """Full unchanged public inputs by default; compact mutations are synthetic only."""
    sources, artifacts = [], []
    for index, item in enumerate(PUBLIC['sources']):
        metadata, art = item['source'], copy.deepcopy(item['sourceArtifact'])
        src = {'sourceFileId': metadata['file_id'], 'sha256': metadata['sha256'],
               'objectId': OBJECT, 'stages': [metadata['stage']]}
        if not full:
            page = art['pages'][12 if index == 0 else 3]
            page['pageNumber'] = 1
            if index == 1:
                page['blocks'][40]['text'] = page['blocks'][40]['text'].replace('159.95', actual)
            page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
            art.update(pageCount=1, textPageCount=1, pages=[page], qualitySummary={
                'textLayerCandidatePageCount': 1, 'ocrRequiredPageCount': 0})
            src['sourceFileId'] = 'SYNTHETIC-PD' if index == 0 else 'SYNTHETIC-RD'
            src['sha256'] = hashlib.sha256(('synthetic project-zero source ' + str(index) + actual).encode()).hexdigest()
            art.update(sourceFileId=src['sourceFileId'], inputSha256=src['sha256'])
        sources.append(src); artifacts.append(art)
    return {'object_id': OBJECT, 'input_manifest_hash': MANIFEST, 'sources': sources, 'text_artifacts': artifacts}


def zero_facts(result: dict) -> list[dict]:
    return [fact for fact in result['observations'] if fact['attribute'] == ATTRIBUTE]


def zero_row(args: dict) -> dict:
    return next(row for row in build_matrix_execution(**args)['results'] if row['ruleId'] == RULE)


def reviewed_args(*, actual: str = '159.96') -> dict:
    args = fixture_args(full=False, actual=actual)
    origin = build_matrix_execution(**args)
    facts = zero_facts(origin)
    assert len(facts) == 2
    targets = []
    for fact, artifact in zip(facts, args['text_artifacts']):
        target = derive_matrix_fact_target(fact, artifact)
        assert target is not None
        targets.append({'checkId': 'synthetic-zero-origin', 'executionContentHash': 'd' * 64,
                        **{key: target[key] for key in ['observationId', 'evidenceHash', 'textArtifactHash']}})
    args['input_manifest_hash'] = 'b' * 64
    pd = args['sources'][0]
    authority = {'kind': 'APPROVED_PD_GEODETIC_BASIS', 'sourceFileId': pd['sourceFileId'],
                 'sourceSha256': pd['sha256'], 'pageNumber': 1, 'target': targets[0]}
    for index, src in enumerate(args['sources']):
        src.update(sectionCode='PZ' if index == 0 else 'KR', revisionStatus='CURRENT',
                   approvalStatus='APPROVED', linkGroupId='reviewed-zero-project')
        claim = copy.deepcopy(authority)
        if index == 1:
            claim['reviewContentHash'] = REVIEW
        contexts = {
            'APPROVED_CHANGE_STATUS': {'reference': 'Inspector reviewed approved project changes', 'approvedChangePresent': False},
            'PROJECT_ZERO_GEODETIC_AUTHORITY': {'reference': 'Inspector classified actual approved PD geodetic basis', 'projectZeroAuthority': claim},
            'ATOMIC_SUBRULE_SCOPE:' + RULE: {'reference': 'Inspector matched actual building floor and vertical datum',
                'parameterCode': 'PZ-009', 'attribute': ATTRIBUTE, 'canonicalUnit': 'm',
                'componentRole': 'PROJECT_ZERO_DATUM', 'componentKey': 'building-1',
                'zoneKey': 'reviewed-same-local-zero-finished-floor', 'operatingModeKey': 'reviewed-approved-vertical-datum',
                'measurementBasisKey': BASIS}}
        binding = {'ruleId': RULE, 'ruleVersion': '1', 'parameterCode': 'PZ-009', 'entityKey': 'building-1',
                   'reference': 'Authenticated inspector exact project zero scope', 'target': targets[index], 'contexts': contexts}
        src['scopeProofs'] = {'FACT_BINDINGS': {'schemaVersion': 'matrix-fact-scopes-v1', 'status': 'VERIFIED',
            'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'], 'objectId': OBJECT,
            'inputManifestHash': args['input_manifest_hash'], 'reference': 'Authenticated immutable source review snapshot',
            'reviewContentHash': REVIEW if index == 0 else 'f' * 64, 'bindings': [binding]}}
    return args


def envelope(args, index):
    return args['sources'][index]['scopeProofs']['FACT_BINDINGS']


def contexts(args, index):
    return envelope(args, index)['bindings'][0]['contexts']


class MatrixProjectZeroTests(unittest.TestCase):
    def test_full_real_pair_has_two_exact_unapproved_facts_and_preserved_full_inputs(self):
        args = fixture_args(); before = copy.deepcopy(args)
        output = build_matrix_execution(**args)
        pd, rd = zero_facts(output)
        self.assertEqual([(f['stage'], f['pageNumber'], f['value'], f['rawUnit']) for f in [pd, rd]],
                         [('PD', 13, '159.95', 'м'), ('RD', 4, '159.95', 'метрах')])
        self.assertEqual([p['blockId'] for p in pd['evidenceFragments']], ['0:8', '0:9'])
        self.assertTrue(pd['evidenceFragments'][0]['rawText'].endswith('соответствует '))
        self.assertEqual([p['blockId'] for p in rd['evidenceFragments']], ['40:0'])
        self.assertEqual([(p['blockId'], p['role']) for p in rd['contextFragments']],
                         [('32:18', 'UNIT_DECLARATION'), ('32:19', 'UNIT_DECLARATION')])
        self.assertTrue(rd['contextFragments'][0]['rawText'].endswith('Все размеры даны в миллиметрах,'))
        self.assertEqual(rd['bbox'], rd['evidenceFragments'][0]['bbox'])
        self.assertNotIn('contextFragments', pd)
        for fact in [pd, rd]:
            self.assertIsNone(fact['entityKey'])
            self.assertNotIn('TABLE_CONTEXT_UNVERIFIED', fact['sourceFlags'])
            self.assertFalse(any(k in fact for k in ['localZero', 'datumName', 'projectZeroAuthority', 'calibratedProbability']))
        self.assertTrue(all(not r['qualified'] for r in output['results']))
        self.assertEqual(args, before)
        self.assertEqual([a['pageCount'] for a in args['text_artifacts']], [13, 22])

    def test_positive_changed_and_equal_negative_abstention_with_typed_authority(self):
        for actual, expected_status, qualified in [('159.96', 'CANDIDATE', True), ('159.95', 'CLARIFICATION_REQUIRED', False)]:
            args = reviewed_args(actual=actual); before = copy.deepcopy(args)
            row = zero_row(args)
            self.assertEqual((row['machineStatus'], row['qualified']), (expected_status, qualified))
            self.assertEqual(row['reasonCode'], 'CATALOG_TRIGGER_MATCHED' if qualified else 'NEGATIVE_SCOPE_UNVERIFIED')
            self.assertNotIn('calibratedProbability', row)
            self.assertEqual(args, before)

    def test_equal_fact_scopes_cannot_accept_whole_file_completeness_proofs(self):
        args = reviewed_args(actual='159.95')
        for src in args['sources']:
            src['scopeProofs']['RULE_SCOPE_COMPLETE:' + RULE] = {
                'status':'VERIFIED', 'reference':'Generic whole-file completion must not close an atomic fact scope',
                'sourceFileId':src['sourceFileId'], 'sourceSha256':src['sha256'],
                'objectId':OBJECT, 'inputManifestHash':args['input_manifest_hash'], 'entityKey':'building-1'}
        row = zero_row(args)
        self.assertEqual((row['qualified'],row['reasonCode']),(False,'NEGATIVE_SCOPE_UNVERIFIED'))

    def test_actual_stage_mark_cannot_be_inferred_from_prose_or_filename(self):
        for index in [0,1]:
            for stages in [['ID'],['PD','RD']]:
                args=fixture_args(full=False);args['sources'][index]['stages']=stages
                with self.subTest(index=index,stages=stages):
                    self.assertEqual(len(zero_facts(build_matrix_execution(**args))),1)
        args=reviewed_args(actual='-159.96')
        row=zero_row(args)
        self.assertEqual((row['qualified'],row['machineStatus'],row['actualValue']),(True,'CANDIDATE','-159.96'))

    def test_signed_values_only_in_frozen_project_zero_grammar(self):
        for actual, canonical in [('-159.96', '-159.96'), ('+159,9600', '159.96'), ('-0.000', '0')]:
            args = fixture_args(full=False, actual=actual)
            self.assertEqual(zero_facts(build_matrix_execution(**args))[1]['value'], canonical)
        args = fixture_args(full=False)
        args['text_artifacts'][0]['pages'][0]['blocks'][0]['text'] = 'Абсолютная отметка проектного нуля: -159.95 м'
        # Invalid declared line count is rejected by the immutable artifact validator.
        with self.assertRaises(ValueError):
            build_matrix_execution(**args)

    def test_no_generic_label_or_unitless_bypass(self):
        for stage_index in [0, 1]:
            args = fixture_args(full=False)
            page = args['text_artifacts'][stage_index]['pages'][0]
            for block in page['blocks']:
                block['text'] = block['text'].replace('За относительную отметку', 'Абсолютная отметка проектного нуля:')
            page['quality'] = qualify_page_text([b['text'] for b in page['blocks']])
            self.assertEqual(len(zero_facts(build_matrix_execution(**args))), 1)

    def test_required_contexts_and_identity_fields_each_side(self):
        for index in [0, 1]:
            for key in ['APPROVED_CHANGE_STATUS', 'PROJECT_ZERO_GEODETIC_AUTHORITY', 'ATOMIC_SUBRULE_SCOPE:' + RULE]:
                args = reviewed_args(); contexts(args, index).pop(key)
                with self.subTest(index=index, key=key): self.assertFalse(zero_row(args)['qualified'])
            for field in ['componentRole', 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']:
                args = reviewed_args(); contexts(args, index)['ATOMIC_SUBRULE_SCOPE:' + RULE][field] = 'wrong'
                with self.subTest(index=index, field=field): self.assertFalse(zero_row(args)['qualified'])
        args = reviewed_args()
        for index in [0, 1]: contexts(args, index)['ATOMIC_SUBRULE_SCOPE:' + RULE]['measurementBasisKey'] = 'wrong-on-both'
        self.assertFalse(zero_row(args)['qualified'])

    def test_generic_reference_and_whole_file_scope_proofs_never_supply_authority(self):
        args = reviewed_args(); contexts(args, 0)['PROJECT_ZERO_GEODETIC_AUTHORITY'].pop('projectZeroAuthority')
        self.assertFalse(zero_row(args)['qualified'])
        for index in [0, 1]:
            args = reviewed_args(); src = args['sources'][index]; binding = envelope(args,index)['bindings'][0]
            proofs = {key: dict(detail, status='VERIFIED', sourceFileId=src['sourceFileId'], sourceSha256=src['sha256'],
                               objectId=OBJECT, inputManifestHash=args['input_manifest_hash'], entityKey='building-1')
                      for key, detail in binding['contexts'].items()}
            proofs['ENTITY_SCOPE'] = {**next(iter(proofs.values())), 'reference': 'Whole file generic fixture review'}
            src['scopeProofs'] = proofs
            self.assertFalse(zero_row(args)['qualified'])

    def test_wrong_or_stale_authority_pointer_rejected(self):
        changes = [('sourceFileId', 'another-source'), ('sourceSha256', '0' * 64), ('pageNumber', 2),
                   ('reviewContentHash', '0' * 64)]
        for index in [0, 1]:
            for key, value in changes:
                args = reviewed_args(); claim = contexts(args,index)['PROJECT_ZERO_GEODETIC_AUTHORITY']['projectZeroAuthority']
                claim[key] = value
                with self.subTest(index=index,key=key): self.assertFalse(zero_row(args)['qualified'])
            for key in ['checkId', 'executionContentHash', 'observationId', 'evidenceHash', 'textArtifactHash']:
                args = reviewed_args(); claim = contexts(args,index)['PROJECT_ZERO_GEODETIC_AUTHORITY']['projectZeroAuthority']
                claim['target'][key] = 'foreign-origin' if key == 'checkId' else '0' * 64
                with self.subTest(index=index,key=key): self.assertFalse(zero_row(args)['qualified'])
        args = reviewed_args(); envelope(args,0).pop('reviewContentHash')
        self.assertFalse(zero_row(args)['qualified'])
        args = reviewed_args(); contexts(args,1)['PROJECT_ZERO_GEODETIC_AUTHORITY']['projectZeroAuthority'].pop('reviewContentHash')
        self.assertFalse(zero_row(args)['qualified'])

    def test_approval_revision_stage_section_change_and_entity_are_explicit(self):
        for index in [0, 1]:
            for key,value in [('approvalStatus','UNKNOWN'),('revisionStatus','SUPERSEDED'),('sectionCode','OTHER')]:
                args=reviewed_args();args['sources'][index][key]=value
                with self.subTest(index=index,key=key):self.assertFalse(zero_row(args)['qualified'])
            args=reviewed_args();contexts(args,index)['APPROVED_CHANGE_STATUS']['approvedChangePresent']=True
            self.assertFalse(zero_row(args)['qualified'])
        args=reviewed_args();envelope(args,1)['bindings'][0]['entityKey']='other-building'
        self.assertFalse(zero_row(args)['qualified'])

    def test_binding_selector_staleness_and_unit_authority_alteration(self):
        for index in [0, 1]:
            for key in ['evidenceHash','textArtifactHash','observationId']:
                args=reviewed_args();envelope(args,index)['bindings'][0]['target'][key]='0'*64
                with self.subTest(index=index,key=key):self.assertFalse(zero_row(args)['qualified'])
        args=reviewed_args();page=args['text_artifacts'][1]['pages'][0]
        page['blocks'][0]['text'] += ' '
        self.assertFalse(zero_row(args)['qualified'], 'Even unselected source text participates in artifact hash')
        for replacement in ['отметки - в миллиметрах.', 'отметки - в метрах. ', 'отметки - в МЕТРАХ.']:
            args=reviewed_args();b=args['text_artifacts'][1]['pages'][0]['blocks'][32]
            b['text']=b['text'].replace('отметки - в метрах.',replacement)
            args['text_artifacts'][1]['pages'][0]['quality'] = qualify_page_text([x['text'] for x in args['text_artifacts'][1]['pages'][0]['blocks']])
            self.assertFalse(zero_row(args)['qualified'])

    def test_nested_authority_schema_strict_and_protected_metadata_unforgeable(self):
        bad=[{'extra':'field'}, {'pageNumber':True}, {'pageNumber':9007199254740992}, {'kind':'PROJECT_NOTE'},
             {'sourceSha256':'bad'}, {'reviewContentHash':None}]
        for patch in bad:
            args=reviewed_args();contexts(args,0)['PROJECT_ZERO_GEODETIC_AUTHORITY']['projectZeroAuthority'].update(patch)
            with self.subTest(patch=patch),self.assertRaises(ValueError):build_matrix_execution(**args)
        for key in ['serverReviewContentHash','bindingTarget']:
            args=reviewed_args();contexts(args,0)['PROJECT_ZERO_GEODETIC_AUTHORITY'][key]=REVIEW
            with self.assertRaises(ValueError):build_matrix_execution(**args)
        args=reviewed_args();envelope(args,0)['reviewContentHash']=None
        with self.assertRaises(ValueError):build_matrix_execution(**args)
        args=reviewed_args();binding=envelope(args,0)['bindings'][0];binding['ruleId']='other-rule'
        with self.assertRaises(ValueError):build_matrix_execution(**args)
        args=reviewed_args();claim=contexts(args,0)['PROJECT_ZERO_GEODETIC_AUTHORITY'].pop('projectZeroAuthority')
        contexts(args,0)['APPROVED_CHANGE_STATUS']['projectZeroAuthority']=claim
        with self.assertRaises(ValueError):build_matrix_execution(**args)

    def test_rule_identity_and_definition_cannot_strip_or_widen_typed_gate(self):
        for retained in ['both','ruleId','attribute']:
            for change in ['remove-policy','remove-gate','different-threshold','different-units']:
                registry=load_matrix_registry();entry=next(e for e in registry['entries'] if e['parameterCode']=='PZ-009');rule=entry['atomicRules'][0]
                if retained=='ruleId':rule['attribute']='OTHER_ATTRIBUTE'
                if retained=='attribute':rule['ruleId']='other-rule'
                if change=='remove-policy':rule.pop('subruleContext')
                if change=='remove-gate':rule['requiredContext']=[]
                if change=='different-threshold':rule['threshold']={'value':'1','unit':'m','strict':True}
                if change=='different-units':rule['unitAliases']=['m']
                with self.subTest(retained=retained,change=change),self.assertRaises(ValueError):
                    build_matrix_execution(object_id=OBJECT,input_manifest_hash=MANIFEST,sources=[],text_artifacts=[],registry=registry)

    def test_old_fact_payloads_and_ids_unchanged_with_old_registry(self):
        args=fixture_args(full=False)
        # Independent pre-existing exact numeric fact makes legacy-ID equality non-vacuous.
        page=args['text_artifacts'][0]['pages'][0]
        box=[10000,10000,250000,20000]
        page['blocks'].append({'text':'Общая площадь здания: 150 м²','bboxMilliPoints':box,
                               'lineBboxesMilliPoints':[box.copy()]})
        page['quality']=qualify_page_text([b['text'] for b in page['blocks']])
        current=build_matrix_execution(**args)
        self.assertTrue([o for o in current['observations'] if o['attribute']!=ATTRIBUTE])
        old=load_matrix_registry();entry=next(e for e in old['entries'] if e['parameterCode']=='PZ-009');entry.update(atomicRules=[],gap='GEOMETRY_OR_TOPOLOGY')
        legacy=build_matrix_execution(**args,registry=old)
        self.assertEqual([o for o in current['observations'] if o['attribute']!=ATTRIBUTE],legacy['observations'])
        coverage=next(c for c in current['coverage'] if c['parameterCode']=='PZ-009')
        self.assertEqual((coverage['executionStatus'],coverage['implementedAtomicRules']),('PARTIAL',1))


if __name__ == '__main__':
    unittest.main()
