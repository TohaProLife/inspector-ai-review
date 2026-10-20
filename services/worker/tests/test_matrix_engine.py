from __future__ import annotations

import copy
import hashlib
import json
from decimal import Decimal
from pathlib import Path
import unittest

from inspector_worker.matrix_engine import build_matrix_execution, load_matrix_registry, canonical_registry_hash
from inspector_worker.family_rule_evaluator import _canonical_numeric
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
from inspector_worker.matrix_fact_scope import derive_matrix_fact_target

OBJECT = 'matrix-object'
MANIFEST = 'b' * 64
T07_CODES = {'IOS2-073', 'IOS4-077', 'PPM-112', 'SPZU-032'}


def source(identity: str, stage: str, section: str, *, approved: bool = True, entity: str = 'building-1') -> dict:
    value = {'sourceFileId': identity, 'objectId': OBJECT, 'sha256': hashlib.sha256(identity.encode()).hexdigest(),
             'stages': [stage], 'sectionCode': section,
             'revisionStatus': 'CURRENT' if approved else 'UNKNOWN',
             'approvalStatus': 'APPROVED' if approved else 'UNKNOWN',
             'linkGroupId': 'reviewed-document-group', 'pageStages': {}, 'scopeProofs': {}}
    for entry in load_matrix_registry()['entries']:
        for rule in entry['atomicRules']:
            for key in ['ENTITY_SCOPE', *rule['requiredContext'], 'RULE_SCOPE_COMPLETE:' + rule['ruleId'],
                        'PARAMETER_SCOPE_COMPLETE:' + entry['parameterCode']]:
                value['scopeProofs'][key] = {'status': 'VERIFIED', 'reference': 'explicit fixture review',
                    'sourceFileId': identity, 'sourceSha256': value['sha256'], 'inputManifestHash': MANIFEST,
                    'objectId': OBJECT, 'entityKey': entity, 'approvedChangePresent': False, 'reductionConfirmed': True,
                    'limitValue': '100', 'canonicalUnit': 'kW'}
                if key.startswith('ATOMIC_SUBRULE_SCOPE:') and rule.get('subruleContext'):
                    policy = rule['subruleContext']
                    value['scopeProofs'][key].update(parameterCode=entry['parameterCode'],
                        attribute=rule['attribute'], canonicalUnit=rule['canonicalUnit'],
                        componentRole=policy['componentRole'],
                        **{field: 'fixture-' + field for field in policy['identityFields']})
                    if policy['componentRole'] in {'EVACUATION_CORRIDOR_CLEARANCE', 'EVACUATION_DOOR_CLEARANCE'}:
                        value['scopeProofs'][key].update(operatingModeKey='EVACUATION',
                            measurementBasisKey={'EVACUATION_CORRIDOR_CLEARANCE': 'CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION',
                                'EVACUATION_DOOR_CLEARANCE': 'CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD'}[policy['componentRole']])
                    if policy['componentRole'] in {'STAIR_TREAD', 'STAIR_RISER'}:
                        value['scopeProofs'][key].update(operatingModeKey='EVACUATION',
                            measurementBasisKey={'STAIR_TREAD': 'FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH',
                                'STAIR_RISER': 'FINISHED_VERTICAL_RISER_HEIGHT'}[policy['componentRole']])
                    if policy['componentRole'] == 'TERRITORY_FENCE_SEGMENT':
                        value['scopeProofs'][key].update(operatingModeKey='TERRITORY_BOUNDARY',
                            measurementBasisKey='FINISHED_GROUND_TO_FENCE_TOP')
    return value


def artifact(src: dict, lines: list[str], *, blocks: list[dict] | None = None) -> dict:
    if blocks is None:
        blocks = [{'text': line, 'bboxMilliPoints': [1000, 20000 + i * 15000, 550000, 30000 + i * 15000]}
                  for i, line in enumerate(lines)]
    quality = qualify_page_text([b['text'] for b in blocks])
    return {'schemaVersion': 'document-text-v2', 'sourceFileId': src['sourceFileId'], 'inputSha256': src['sha256'],
            'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pageCount': 1, 'textPageCount': int(bool(blocks)),
            'qualityPolicyVersion': TEXT_QUALITY_POLICY_VERSION,
            'qualitySummary': {'textLayerCandidatePageCount': int(quality['disposition'] == 'TEXT_LAYER_CANDIDATE'),
                               'ocrRequiredPageCount': int(quality['disposition'] != 'TEXT_LAYER_CANDIDATE')},
            'pages': [{'pageNumber': 1, 'widthMilliPoints': 600000, 'heightMilliPoints': 800000,
                       'blocks': blocks, 'quality': quality}]}


def refresh_artifact_quality(value: dict) -> dict:
    """Recalculate canonical counts after a fixture changes source text/pages."""
    for number, page in enumerate(value['pages'], 1):
        page['pageNumber'] = number
        page['quality'] = qualify_page_text([block['text'] for block in page['blocks']])
    candidates = sum(p['quality']['disposition'] == 'TEXT_LAYER_CANDIDATE' for p in value['pages'])
    value.update(pageCount=len(value['pages']), textPageCount=sum(bool(p['blocks']) for p in value['pages']),
                 qualitySummary={'textLayerCandidatePageCount': candidates,
                                 'ocrRequiredPageCount': len(value['pages']) - candidates})
    return value


def pd_concrete_table_artifact(src: dict, *, previous_header: bool = True,
                               only_slab: bool = False) -> dict:
    """Public F0106 exact table fragments, with compact, reusable PDF page IDs.

    The original header is PDF49/block10; scope and table are PDF50/blocks0..2.
    No status, entity, or table interpretation is supplied by this fixture.
    """
    header = {'text': ('Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона\n'
                       'по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:'),
              'bboxMilliPoints': [70800, 311328, 559542, 337008],
              'lineBboxesMilliPoints': [[106320, 325008, 559542, 337008],
                                       [70800, 311328, 559415, 323328]]}
    scope = {'text': 'Подземная часть', 'bboxMilliPoints': [106320, 800208, 192336, 812208]}
    labels = ['· фундаментная плита', '· пилоны, колонны -3 по +1', 'стены -3го по +1', '·',
              '· плита -2го этажа', '· плита -1го этажа', '· плита покрытия']
    label_boxes = [[124320, 785280, 248519, 797328], [124320, 770640, 276827, 782688],
                   [142320, 756048, 228167, 768048], [124320, 756000, 129839, 768000],
                   [124320, 741360, 228295, 753408], [124320, 726720, 228295, 738768],
                   [124320, 712080, 224452, 724128]]
    values = ['B40;', 'В60;', 'В60;', 'В40;', 'В40;', 'В40;']
    value_boxes = [[466800, 785328, 490139, 797328], [466800, 770688, 490055, 782688],
                   [466800, 756048, 490055, 768048], [466800, 741408, 490055, 753408],
                   [466800, 726768, 490055, 738768], [466800, 712128, 490055, 724128]]
    if only_slab:
        labels, label_boxes, values, value_boxes = [labels[4]], [label_boxes[4]], [values[3]], [value_boxes[3]]
    def block(lines, boxes):
        return {'text': '\n'.join(lines), 'lineBboxesMilliPoints': boxes,
                'bboxMilliPoints': [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                    max(b[2] for b in boxes), max(b[3] for b in boxes)]}
    table = [scope, block(labels, label_boxes), block(values, value_boxes),
             {'text': 'Лестницы, лестничные площадки всех корпусов В30.',
              'bboxMilliPoints': [106320, 698448, 380184, 710448]}]
    value = artifact(src, [], blocks=table)
    value['pages'][0].update(widthMilliPoints=595200, heightMilliPoints=841920)
    if previous_header:
        value['pages'].insert(0, {**copy.deepcopy(value['pages'][0]), 'blocks': [header]})
    else:
        # Same page uses the same exact wording at a physically preceding position.
        header['bboxMilliPoints'] = [70800, 815328, 559542, 841008]
        header['lineBboxesMilliPoints'] = [[106320, 829008, 559542, 841008],
                                         [70800, 815328, 559415, 827328]]
        value['pages'][0]['blocks'].insert(0, header)
    return refresh_artifact_quality(value)


def pd_slab_table_artifact(src: dict, *, only_slab: bool = False) -> dict:
    """Exact public F0106 PDF53 blocks2..8, without inferred floor/entity scope."""
    labels = ['- Толщина фундаментной плиты', '- Перекрытия -2 и -1 этажей',
              '- Капители -2 и -1 этажей', '- Плита покрытия (стилобата)',
              '- Капители покрытия (стилобата)']
    label_boxes = [[117120, 675888, 295147, 687888], [117120, 662208, 271919, 674208],
                   [117120, 648288, 258714, 660288], [117120, 634608, 281195, 646608],
                   [117120, 620688, 298715, 632688]]
    values = ['-1000, 1200мм', '-  250мм', '-  500мм']
    value_boxes = [[466800, 675888, 549191, 687888], [502800, 662208, 546071, 674208],
                   [502800, 648288, 546071, 660288]]
    if only_slab:
        labels, label_boxes, values, value_boxes = [labels[1]], [label_boxes[1]], [values[1]], [value_boxes[1]]
    def block(lines, boxes):
        return {'text': '\n'.join(lines), 'lineBboxesMilliPoints': boxes,
                'bboxMilliPoints': [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                    max(b[2] for b in boxes), max(b[3] for b in boxes)]}
    blocks = [
        block(['Толщина фундаментной плиты определена по расчету, составляет 1000мм и 1200мм.',
               'Описание конструкции подземной части здания', 'Толщины перекрытий подземной части'],
              [[104880, 745008, 541560, 757008], [104880, 731088, 367237, 743088],
               [106320, 717408, 324415, 729408]]),
        block(['Толщины перекрытия и покрытия:'], [[106320, 689808, 284375, 701808]]),
        block(labels, label_boxes), block(values, value_boxes),
    ]
    if not only_slab:
        blocks.extend([block(['-  300, 400мм'], [[466800, 634608, 554915, 646608]]),
                       block(['- 900мм'], [[502800, 620688, 542951, 632688]])])
    blocks.append(block(['В корпусах К1 и К2 предусмотрены переходные плиты в уровне 1 этажа толщиной 800'],
                        [[106320, 593088, 559319, 605088]]))
    value = artifact(src, [], blocks=blocks)
    value['pages'][0].update(widthMilliPoints=595200, heightMilliPoints=841920)
    return value


def rd_slab_statement(value: str = '250', unit: str = 'мм', capital: str = '500',
                      capital_unit: str = 'мм') -> str:
    return ('Толщина ж/б плиты перекрытия подземного этажа - ' + value + unit +
            ', ж/б капители толщиной - ' + capital + capital_unit + '.')


def run(pd_text: str, rd_text: str, *, pd_section: str = 'PZ', rd_section: str = 'AR',
        approved: bool = True, entity: str = 'building-1') -> dict:
    pd = source('pd', 'PD', pd_section, approved=approved)
    rd = source('rd', 'RD', rd_section, approved=approved, entity=entity)
    return build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
                                  text_artifacts=[artifact(pd, pd_text.splitlines()), artifact(rd, rd_text.splitlines())])


def result(output: dict, code: str) -> dict:
    return next(row for row in output['results'] if row['parameterCode'] == code)


def fact_binding_fixture(*, parameter_code: str = 'KR-055', review_table: bool = True,
                         actual_value: str | None = None) -> dict:
    """Reusable T13 golden input: bind one original PD table row and one RD fact.

    Portable targets come from the previous immutable extraction. The new manifest
    differs, while source bytes/artifacts and observation IDs remain unchanged.
    Old whole-file proofs are deliberately retained to detect accidental fallback.
    """
    pd, rd = source('pd', 'PD', 'KR'), source('rd', 'RD', 'KR')
    if parameter_code == 'KR-055':
        arts = [pd_concrete_table_artifact(pd), artifact(rd, ['Класс бетона: ' + (actual_value or 'B35')])]
    elif parameter_code == 'KR-059':
        arts = [pd_slab_table_artifact(pd), artifact(rd, [rd_slab_statement(actual_value or '240')])]
    else:
        raise ValueError('unsupported fact binding fixture parameter')
    origin = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                    sources=[pd, rd], text_artifacts=arts)
    entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == parameter_code)
    rule = entry['atomicRules'][0]
    new_manifest = 'c' * 64
    for src, art in zip([pd, rd], arts):
        fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                    and parameter_code in o['parameterCodes'])
        target = derive_matrix_fact_target(fact, art)
        if target is None:
            raise AssertionError('fixture original evidence must have a portable target')
        binding = {'ruleId': rule['ruleId'], 'ruleVersion': rule['version'], 'parameterCode': parameter_code,
                   'entityKey': 'reviewed-component-1', 'reference': 'Inspector selected this exact component',
                   'target': {'checkId': 'immutable-origin-check', 'executionContentHash': 'd' * 64,
                              **{k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']}},
                   'contexts': {key: {'reference': 'Reviewed original component and measurement basis'}
                                for key in rule['requiredContext']}}
        if review_table and target.get('fragmentsHash'):
            binding['tableContextReview'] = {'fragmentsHash': target['fragmentsHash'],
                                             'reference': 'Inspector checked original table header and scope'}
        src['scopeProofs']['FACT_BINDINGS'] = {
            'schemaVersion': 'matrix-fact-scopes-v1', 'bindings': [binding], 'status': 'VERIFIED',
            'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'],
            'objectId': OBJECT, 'inputManifestHash': new_manifest,
            'reference': 'Authenticated inspector source review snapshot'}
    return {'object_id': OBJECT, 'input_manifest_hash': new_manifest, 'sources': [pd, rd], 'text_artifacts': arts}


class MatrixExecutionTests(unittest.TestCase):
    def slab_table_output(self, *, mutate=None, only_slab=False, stage='PD', proofs=False):
        src = source('slab-table', stage, 'KR', approved=proofs)
        if not proofs:
            src.pop('scopeProofs')
        value = pd_slab_table_artifact(src, only_slab=only_slab)
        if mutate:
            mutate(src, value)
            refresh_artifact_quality(value)
        return build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                       sources=[src], text_artifacts=[value]), value

    def test_pd_slab_table_extracts_only_single_value_slab_not_foundation_capitals_or_alternatives(self):
        output, value = self.slab_table_output()
        obs, = output['observations']
        self.assertEqual((obs['attribute'], obs['rawValue'], obs['rawUnit'], obs['value'], obs['unit']),
                         ('SLAB_THICKNESS', '250', 'мм', '250', 'mm'))
        self.assertEqual(obs['rawText'], '- Перекрытия -2 и -1 этажей -  250мм')
        self.assertEqual([f['blockId'] for f in obs['evidenceFragments']], ['2:1', '3:1'])
        self.assertEqual([(f['blockId'], f['role']) for f in obs['contextFragments']],
                         [('1:0', 'ATTRIBUTE_HEADER'), ('0:2', 'TABLE_SCOPE')])
        self.assertEqual(obs['bbox'], {'x': 117120 / 595200, 'y': 1 - 674208 / 841920,
                                       'width': (546071 - 117120) / 595200, 'height': 12000 / 841920})
        self.assertIsNone(obs['entityKey'])
        self.assertEqual(obs['sourceFlags'], ['SOURCE_APPROVAL_UNKNOWN', 'SOURCE_REVISION_UNKNOWN',
                                             'TABLE_CONTEXT_UNVERIFIED'])
        self.assertFalse(result(output, 'KR-059')['qualified'])

    def test_pd_slab_table_units_are_exact_and_floor_text_never_approves_an_entity(self):
        for raw, unit in [('250', 'мм'), ('250', 'mm'), ('0.25', 'м'), ('0,25', 'm'),
                          ('25', 'см'), ('25', 'cm')]:
            with self.subTest(unit=unit):
                output, _ = self.slab_table_output(only_slab=True, mutate=lambda s, a:
                    a['pages'][0]['blocks'][3].update(text='- ' + raw + unit))
                obs, = output['observations']
                self.assertEqual(obs['value'], '250')
                self.assertEqual(obs['rawUnit'], unit)
                self.assertIsNone(obs['entityKey'])
        output, _ = self.slab_table_output(proofs=True)
        self.assertEqual(output['observations'][0]['sourceFlags'], ['TABLE_CONTEXT_UNVERIFIED'])
        pd, rd = source('slab-table', 'PD', 'KR'), source('rd', 'RD', 'KR')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[pd, rd], text_artifacts=[pd_slab_table_artifact(pd), artifact(rd, [rd_slab_statement()])])
        self.assertEqual(result(output, 'KR-059')['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
        self.assertFalse(result(output, 'KR-059')['qualified'])

    def test_pd_slab_table_rejects_ambiguous_headers_scope_cells_grammar_and_coarse_boxes(self):
        mutations = [
            lambda s, a: a['pages'][0]['blocks'][1].update(text='Толщины покрытия:'),
            lambda s, a: a['pages'][0]['blocks'][0].update(text=a['pages'][0]['blocks'][0]['text'].replace(
                'Толщины перекрытий подземной части', 'Толщины перекрытий надземной части')),
            lambda s, a: a['pages'][0]['blocks'].append(copy.deepcopy(a['pages'][0]['blocks'][1])),
            lambda s, a: a['pages'][0]['blocks'].append(copy.deepcopy(a['pages'][0]['blocks'][0])),
            lambda s, a: a['pages'][0]['blocks'].append(copy.deepcopy(a['pages'][0]['blocks'][2])),
            lambda s, a: a['pages'][0]['blocks'][2].update(text='- Перекрытия -2 и -2 этажей'),
            lambda s, a: a['pages'][0]['blocks'][2].update(text='- Перекрытия -02 и -2 этажей'),
            lambda s, a: a['pages'][0]['blocks'][2].update(text='- Капители -2 и -1 этажей'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='- 250, 300мм'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='- 250/300мм'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='-250мм'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='- -250мм'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='- 250MM'),
            lambda s, a: a['pages'][0]['blocks'][3].update(text='- 1 000мм'),
            lambda s, a: a['pages'][0]['blocks'][0].pop('lineBboxesMilliPoints'),
            lambda s, a: a['pages'][0]['blocks'].append({
                'text': 'альтернатива', 'bboxMilliPoints': [555000, 662208, 590000, 674208]}),
            lambda s, a: a['pages'][0]['blocks'].append({
                'text': '·\n ', 'bboxMilliPoints': [100000, 662208, 110000, 674208]}),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                output, _ = self.slab_table_output(only_slab=True, mutate=mutation)
                self.assertFalse(output['observations'])
        for stage in ['RD', 'ID']:
            output, _ = self.slab_table_output(stage=stage)
            self.assertFalse(output['observations'])
        output, _ = self.slab_table_output(mutate=lambda s, a: s.update(stages=['PD', 'RD']))
        self.assertFalse(output['observations'])

    def test_pd_slab_table_alignment_gap_and_stop_have_exact_inclusive_boundaries(self):
        def move_value(a, dy=0, dx=0):
            block = a['pages'][0]['blocks'][3]
            for box in [block['bboxMilliPoints'], *block['lineBboxesMilliPoints']]:
                box[0] += dx; box[2] += dx; box[1] += dy; box[3] += dy
        for delta, count in [(3000, 1), (3001, 0)]:
            output, _ = self.slab_table_output(only_slab=True, mutate=lambda s, a: move_value(a, dy=delta))
            self.assertEqual(len(output['observations']), count)
        for gap, count in [(384000, 1), (384001, 0)]:
            def mutation(src, a):
                a['pages'][0]['widthMilliPoints'] = 900000
                move_value(a, dx=271919 + gap - 502800)
            output, _ = self.slab_table_output(only_slab=True, mutate=mutation)
            self.assertEqual(len(output['observations']), count)
        for stop, count in [(662208, 1), (662209, 0)]:
            def mutation(src, a):
                block = a['pages'][0]['blocks'][-1]
                block['bboxMilliPoints'] = [106320, stop - 12000, 559319, stop]
                block['lineBboxesMilliPoints'] = [block['bboxMilliPoints'].copy()]
            output, _ = self.slab_table_output(only_slab=True, mutate=mutation)
            self.assertEqual(len(output['observations']), count)
        for gap, count in [(240000, 1), (240001, 0)]:
            def mutation(src, a):
                a['pages'][0]['blocks'].pop()  # No later prose at the moved row.
                delta = 15600 - gap
                for block in a['pages'][0]['blocks'][2:4]:
                    for box in [block['bboxMilliPoints'], *block['lineBboxesMilliPoints']]:
                        box[1] += delta; box[3] += delta
            output, _ = self.slab_table_output(only_slab=True, mutate=mutation)
            self.assertEqual(len(output['observations']), count)

    def test_pd_slab_context_enters_identity_and_cannot_be_replaced_by_another_component(self):
        output, _ = self.slab_table_output()
        obs, = output['observations']
        identity = {key: obs[key] for key in ['sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'attribute', 'value', 'unit']}
        identity.update(blockIds=[f['blockId'] for f in obs['evidenceFragments']], contextFragments=obs['contextFragments'])
        self.assertEqual(obs['id'], hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False,
                                                              separators=(',', ':')).encode()).hexdigest())
        changed, _ = self.slab_table_output(mutate=lambda s, a:
            a['pages'][0]['blocks'][1].update(text=a['pages'][0]['blocks'][1]['text'].upper()))
        self.assertNotEqual(obs['id'], changed['observations'][0]['id'])
        output, _ = self.slab_table_output(mutate=lambda s, a:
            a['pages'][0]['blocks'][3].update(text=a['pages'][0]['blocks'][3]['text'].replace('250', '250, 300')))
        self.assertFalse(output['observations'])

    def test_rd_slab_compound_statement_uses_named_slab_value_and_preserves_capital_raw_text(self):
        src = source('rd', 'RD', 'KR', approved=False); src.pop('scopeProofs')
        values = []
        for capital in ['500', '800', '500,5']:
            statement = rd_slab_statement(capital=capital)
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                sources=[src], text_artifacts=[artifact(src, [statement])])
            obs, = output['observations']
            self.assertEqual((obs['attribute'], obs['rawValue'], obs['value'], obs['rawUnit']),
                             ('SLAB_THICKNESS', '250', '250', 'мм'))
            self.assertEqual(obs['rawText'], statement)
            self.assertEqual(obs['evidenceFragments'][0]['rawText'], statement)
            self.assertNotIn('contextFragments', obs)
            self.assertIsNone(obs['entityKey'])
            values.append(obs['value'])
        self.assertEqual(values, ['250'] * 3)
        statement = rd_slab_statement().replace('Толщина ж/б плиты перекрытия подземного этажа',
                                                'ТОЛЩИНА Ж/Б ПЛИТЫ ПЕРЕКРЫТИЯ ПОДЗЕМНОГО ЭТАЖА')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[src], text_artifacts=[artifact(src, [statement])])
        self.assertEqual(output['observations'][0]['value'], '250')

    def test_rd_slab_units_and_decimal_comparator_keep_existing_floor_and_basis_proof_gates(self):
        for value, unit in [('250', 'мм'), ('250', 'mm'), ('0.25', 'м'), ('0,25', 'm'), ('25', 'см'), ('25', 'cm')]:
            with self.subTest(unit=unit):
                output = run('Толщина плиты перекрытия: 250 мм', rd_slab_statement(value, unit),
                             pd_section='KR', rd_section='KR')
                row = result(output, 'KR-059')
                self.assertEqual((row['expectedValue'], row['actualValue']), ('250', '250'))
                self.assertTrue(row['qualified'])
                self.assertEqual(row['machineStatus'], 'NEGATIVE_VERIFIED')
        for value, status in [('249.999', 'CANDIDATE'), ('250', 'NEGATIVE_VERIFIED'),
                              ('250.001', 'NEGATIVE_VERIFIED'), ('0', 'CANDIDATE')]:
            row = result(run('Толщина плиты перекрытия: 250 мм', rd_slab_statement(value),
                             pd_section='KR', rd_section='KR'), 'KR-059')
            self.assertEqual(row['machineStatus'], status)
        for key in ['SLAB_FLOOR_ZONE_IDENTITY', 'THICKNESS_MEASUREMENT_BASIS']:
            pd, rd = source('pd', 'PD', 'KR'), source('rd', 'RD', 'KR')
            rd['scopeProofs'].pop(key)
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                sources=[pd, rd], text_artifacts=[artifact(pd, ['Толщина плиты перекрытия: 250 мм']),
                                                 artifact(rd, [rd_slab_statement()])])
            self.assertEqual(result(output, 'KR-059')['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
            self.assertFalse(result(output, 'KR-059')['qualified'])
        output = run('Толщина плиты перекрытия: 250 мм', rd_slab_statement(),
                     pd_section='KR', rd_section='KR', approved=False)
        self.assertFalse(result(output, 'KR-059')['qualified'])
        output = run('Толщина плиты перекрытия: 250 мм', rd_slab_statement(),
                     pd_section='KR', rd_section='KR', entity='different-floor')
        self.assertEqual(result(output, 'KR-059')['reasonCode'], 'ENTITY_SCOPE_MISMATCH')

    def test_rd_slab_rejects_ranges_alternatives_unknown_suffixes_roles_units_and_wrong_stage(self):
        invalid = [
            rd_slab_statement(value='250/300'), rd_slab_statement(value='250-300'),
            rd_slab_statement(value='250, 300'), rd_slab_statement(value='-250'),
            rd_slab_statement(value='1 000'), rd_slab_statement(capital='500/800'),
            rd_slab_statement(capital='-500'), rd_slab_statement(unit='MM'), rd_slab_statement(capital_unit='ММ'),
            rd_slab_statement(unit='кВт'), rd_slab_statement() + ' По расчету.',
            rd_slab_statement().replace('плиты перекрытия', 'капители перекрытия'),
            rd_slab_statement().replace('ж/б капители толщиной', 'ж/б плиты толщиной'),
            rd_slab_statement().replace(', ж/б капители толщиной - 500мм', ''),
            'Не ' + rd_slab_statement(), 'Требуется ' + rd_slab_statement(),
        ]
        src = source('rd', 'RD', 'KR')
        for statement in invalid:
            with self.subTest(statement=statement):
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[src], text_artifacts=[artifact(src, [statement])])
                self.assertFalse(output['observations'])
        for stage in ['PD', 'ID', 'UNRESOLVED']:
            src = source('document', stage if stage != 'UNRESOLVED' else 'PD', 'KR')
            if stage == 'UNRESOLVED':
                src['stages'] = ['PD', 'RD']
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                sources=[src], text_artifacts=[artifact(src, [rd_slab_statement()])])
            self.assertFalse(output['observations'])

    def test_rd_slab_multiline_block_preserves_exact_line_box_and_legacy_identity_shape(self):
        src = source('rd', 'RD', 'KR')
        statement = rd_slab_statement()
        concrete = ('Класс  бетона  по  прочности  на  сжатие  В40,  марка  по  морозостойкости  F150,  '
                    'марка  по  водонепроницаемости  W8.')
        boxes = [[1862581, 1397692, 2222846, 1409572], [1862762, 1381133, 2345651, 1393013]]
        value = artifact(src, [], blocks=[{'text': statement + '\n' + concrete,
            'bboxMilliPoints': [1862581, 1381133, 2345651, 1409572], 'lineBboxesMilliPoints': boxes}])
        value['pages'][0].update(widthMilliPoints=2384000, heightMilliPoints=1684000)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                         sources=[src], text_artifacts=[value])
        slab = next(o for o in output['observations'] if o['attribute'] == 'SLAB_THICKNESS')
        self.assertEqual(slab['blockId'], '0:0')
        self.assertEqual(slab['bbox']['height'], 11880 / 1684000)
        self.assertEqual(slab['rawText'], statement)
        self.assertNotIn('contextFragments', slab)
        payload = {key: slab[key] for key in ['sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'attribute', 'value', 'unit']}
        payload['blockIds'] = ['0:0']
        self.assertEqual(slab['id'], hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                                               separators=(',', ':')).encode()).hexdigest())

    def table_output(self, *, mutate=None, previous_header=True, only_slab=False, stage='PD', proofs=False):
        src = source('table', stage, 'KR', approved=proofs)
        if not proofs:
            src.pop('scopeProofs')
        value = pd_concrete_table_artifact(src, previous_header=previous_header, only_slab=only_slab)
        if mutate:
            mutate(src, value)
            refresh_artifact_quality(value)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                         sources=[src], text_artifacts=[value])
        return output, value

    def test_pd_concrete_table_preserves_six_real_rows_and_separate_cross_page_context(self):
        output, value = self.table_output()
        self.assertEqual(len(output['observations']), 6)
        self.assertEqual([o['value'] for o in output['observations']], ['B40', 'В60', 'В60', 'В40', 'В40', 'В40'])
        for obs in output['observations']:
            self.assertEqual(obs['pageNumber'], 2)
            self.assertEqual(obs['attribute'], 'CONCRETE_CLASS')
            self.assertEqual(obs['unit'], 'B_CLASS')
            self.assertIsNone(obs['entityKey'])
            self.assertIn('TABLE_CONTEXT_UNVERIFIED', obs['sourceFlags'])
            self.assertEqual(len(obs['evidenceFragments']), 2)
            self.assertEqual([(c['pageNumber'], c['role']) for c in obs['contextFragments']],
                             [(1, 'ATTRIBUTE_HEADER'), (1, 'ATTRIBUTE_HEADER'), (2, 'TABLE_SCOPE')])
        slab = next(o for o in output['observations'] if o['blockId'] == '1:4')
        self.assertEqual(slab['rawText'], '· плита -2го этажа В40;')
        self.assertEqual(slab['bbox'], {'x': 124320 / 595200, 'y': 1 - 753408 / 841920,
                                       'width': (490055 - 124320) / 595200,
                                       'height': (753408 - 741360) / 841920})
        self.assertEqual(slab['contextFragments'][0]['rawText'], value['pages'][0]['blocks'][0]['text'].splitlines()[0])
        self.assertFalse(any(r['qualified'] for r in output['results']))

    def test_pd_concrete_table_supports_same_page_without_inventing_entity_or_approval(self):
        output, _ = self.table_output(previous_header=False)
        self.assertEqual(len(output['observations']), 6)
        self.assertTrue(all(c['pageNumber'] == 1 for o in output['observations'] for c in o['contextFragments']))
        output, _ = self.table_output(only_slab=True, proofs=True)
        obs, = output['observations']
        rd = source('rd', 'RD', 'KR')
        pd = source('table', 'PD', 'KR')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[pd, rd], text_artifacts=[pd_concrete_table_artifact(pd, only_slab=True),
                                             artifact(rd, ['Класс бетона: В35'])])
        row = result(output, 'KR-055')
        self.assertFalse(row['qualified'])
        self.assertEqual(row['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
        self.assertEqual(obs['sourceFlags'], ['TABLE_CONTEXT_UNVERIFIED'])

    def test_pd_concrete_table_rejects_missing_competing_distant_and_wrong_stage_headers(self):
        mutations = [
            lambda s, a: a['pages'][0]['blocks'].clear(),
            lambda s, a: a['pages'][0]['blocks'].append(copy.deepcopy(a['pages'][0]['blocks'][0])),
            lambda s, a: a['pages'][1]['blocks'].append(copy.deepcopy(a['pages'][0]['blocks'][0])),
            lambda s, a: a['pages'].insert(1, {**copy.deepcopy(a['pages'][0]), 'blocks': []}),
            lambda s, a: s.update(stages=['PD', 'RD'], pageStages={'1': 'RD', '2': 'PD'}),
            lambda s, a: s.update(stages=['PD', 'RD']),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                output, _ = self.table_output(mutate=mutation)
                self.assertFalse(output['observations'])
        for stage in ['RD', 'ID']:
            output, _ = self.table_output(stage=stage)
            self.assertFalse(output['observations'])

    def test_pd_concrete_table_rejects_ambiguous_scope_class_extra_cell_and_coarse_geometry(self):
        def cell(text):
            return {'text': text, 'bboxMilliPoints': [500000, 741408, 520000, 753408]}
        mutations = [
            lambda s, a: a['pages'][-1]['blocks'][0].update(text='Подземная часть (предварительно)'),
            lambda s, a: a['pages'][-1]['blocks'].append(copy.deepcopy(a['pages'][-1]['blocks'][0])),
            lambda s, a: a['pages'][-1]['blocks'][2].update(text='В35/В40'),
            lambda s, a: a['pages'][-1]['blocks'][2].update(text='А6'),
            lambda s, a: a['pages'][-1]['blocks'][2].update(text='B1 000'),
            lambda s, a: a['pages'][-1]['blocks'].append(cell('В35')),
            lambda s, a: a['pages'][-1]['blocks'].append(cell('альтернатива')),
            lambda s, a: a['pages'][-1]['blocks'].append({
                'text': '·\n ', 'bboxMilliPoints': [110000, 741408, 115000, 753408]}),
            lambda s, a: a['pages'][0]['blocks'][0].pop('lineBboxesMilliPoints'),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                output, _ = self.table_output(mutate=mutation, only_slab=True)
                self.assertFalse(output['observations'])
        output, _ = self.table_output(mutate=lambda s, a:
            a['pages'][-1]['blocks'][1].pop('lineBboxesMilliPoints'))
        self.assertFalse(output['observations'])

    def test_pd_concrete_table_stops_at_prose_and_uses_strict_row_alignment(self):
        def move_value(a, dy=0, dx=0):
            b = a['pages'][-1]['blocks'][2]
            for box in [b['bboxMilliPoints'], *b['lineBboxesMilliPoints']]:
                box[0] += dx; box[2] += dx; box[1] += dy; box[3] += dy
        for delta, accepted in [(2988, True), (2989, False)]:
            # Real label height12048; original center delta24. 3012 is exact boundary.
            output, _ = self.table_output(only_slab=True,
                mutate=lambda s, a: move_value(a, dy=delta))
            self.assertEqual(len(output['observations']), int(accepted))
        output, _ = self.table_output(only_slab=True, mutate=lambda s, a:
            a['pages'][-1]['blocks'].append({'text': 'Далее иной раздел конструкций',
                                            'bboxMilliPoints': [100000, 760000, 500000, 772000]}))
        self.assertFalse(output['observations'])

    def test_pd_concrete_table_context_changes_identity_and_legacy_identity_stays_unchanged(self):
        output, _ = self.table_output(only_slab=True)
        obs, = output['observations']
        identity = {key: obs[key] for key in ['sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'attribute', 'value', 'unit']}
        identity.update(blockIds=[f['blockId'] for f in obs['evidenceFragments']], contextFragments=obs['contextFragments'])
        expected = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False,
                                              separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(obs['id'], expected)
        changed, _ = self.table_output(only_slab=True, mutate=lambda s, a:
            a['pages'][0]['blocks'][0].update(text=a['pages'][0]['blocks'][0]['text'].replace('7473-2010', '7473-2011')))
        self.assertNotEqual(obs['id'], changed['observations'][0]['id'])
        legacy = run('Класс бетона: B40', 'Класс бетона: В35', pd_section='KR', rd_section='KR')
        for fact in legacy['observations']:
            self.assertNotIn('contextFragments', fact)
            identity = {key: fact[key] for key in ['sourceFileId', 'sourceSha256', 'stage', 'pageNumber', 'attribute', 'value', 'unit']}
            identity['blockIds'] = [f['blockId'] for f in fact['evidenceFragments']]
            self.assertEqual(fact['id'], hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False,
                                                                   separators=(',', ':')).encode()).hexdigest())

    def test_pd_concrete_table_inherits_context_page_ocr_requirement(self):
        output, value = self.table_output(only_slab=True, mutate=lambda s, a:
            a['pages'][0]['blocks'].append({'text': '\ufffd' * 300,
                                            'bboxMilliPoints': [1000, 1000, 10000, 11000]}))
        self.assertNotEqual(value['pages'][0]['quality']['disposition'], 'TEXT_LAYER_CANDIDATE')
        obs, = output['observations']
        self.assertIn('PAGE_TEXT_REQUIRES_OCR', obs['sourceFlags'])

    def t07_rules(self):
        rules = [(entry, rule) for entry in load_matrix_registry()['entries']
                 if entry['parameterCode'] in T07_CODES for rule in entry['atomicRules']]
        self.assertEqual(len(rules), 8)
        return rules

    def t07_output(self, entry, rule, expected='100', actual='90', *,
                   expected_unit=None, actual_unit=None, mutate=None):
        pd = source('pd', 'PD', rule['expectedSections'][0])
        rd = source('rd', 'RD', rule['actualSections'][0])
        if mutate:
            mutate(pd, rd)
        label = rule['labels'][0]
        expected_text = label + ': ' + expected + ' ' + (expected_unit or rule['unitAliases'][0])
        actual_text = label + ': ' + actual + ' ' + (actual_unit or rule['unitAliases'][0])
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[pd, rd], text_artifacts=[artifact(pd, [expected_text]), artifact(rd, [actual_text])])
        row = next(row for row in output['results'] if row['ruleId'] == rule['ruleId']
                   and row['comparisonVariant'] == 'PD_RD')
        return output, row

    def test_t07_installs_eight_decrease_subrules_without_claiming_complete_parameters(self):
        for entry, rule in self.t07_rules():
            self.assertTrue(entry['gap'].startswith('PARTIAL_SUBRULES_ONLY:'))
            self.assertEqual(rule['family'], 'DECREASE')
            self.assertIsNone(rule['threshold'])
            self.assertEqual(rule['requiredContext'], ['ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']])
            self.assertEqual(rule['subruleContext']['identityFields'],
                             ['componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey'])
            self.assertEqual(rule['allowedStagePairs'],
                             [['PD', 'RD'], ['PD', 'ID'], ['RD', 'ID']]
                             if entry['parameterCode'] == 'SPZU-032' else [['PD', 'RD']])
        roof = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'AR-044')
        self.assertFalse(roof['atomicRules'])

    def test_t07_decrease_equality_and_increase_obey_the_exact_comparator(self):
        for entry, rule in self.t07_rules():
            for actual, status in [('90', 'CANDIDATE'), ('100', 'NEGATIVE_VERIFIED'), ('110', 'NEGATIVE_VERIFIED')]:
                with self.subTest(rule=rule['ruleId'], actual=actual):
                    output, row = self.t07_output(entry, rule, actual=actual)
                    self.assertEqual(row['machineStatus'], status)
                    self.assertTrue(row['qualified'])
                    coverage = next(c for c in output['coverage'] if c['parameterCode'] == entry['parameterCode'])
                    self.assertEqual(coverage['executionStatus'], 'PARTIAL')
                    self.assertEqual(coverage['reason'], entry['gap'])

    def test_t07_units_preserve_dimensions_and_exact_pressure_conversion(self):
        cases = {
            'PUMP_FLOW_RATE': ('м³/ч', 'м3/ч', '100', '90', '100', '90'),
            'PUMP_HEAD': ('м', 'мм', '1', '999', '1', '0.999'),
            'RADIATOR_SECTION_COUNT': ('шт.', 'шт', '10', '9', '10', '9'),
            'RADIATOR_HEAT_OUTPUT': ('Вт', 'кВт', '1000', '0.999', '1', '0.999'),
            'SMOKE_CONTROL_FAN_FLOW_RATE': ('м3/ч', 'м³/ч', '100', '90', '100', '90'),
            'SMOKE_CONTROL_FAN_PRESSURE': ('кПа', 'Па', '1', '999.999', '1000', '999.999'),
            'ASPHALT_LAYER_THICKNESS': ('см', 'мм', '10', '99.999', '100', '99.999'),
            'CRUSHED_STONE_LAYER_THICKNESS': ('м', 'мм', '0.1', '99.999', '100', '99.999'),
        }
        for entry, rule in self.t07_rules():
            with self.subTest(attribute=rule['attribute']):
                expected_unit, actual_unit, expected, actual, normalized_expected, normalized_actual = cases[rule['attribute']]
                _, row = self.t07_output(entry, rule, expected, actual,
                    expected_unit=expected_unit, actual_unit=actual_unit)
                self.assertEqual((row['expectedValue'], row['actualValue']),
                                 (normalized_expected, normalized_actual))
                self.assertEqual(row['machineStatus'], 'CANDIDATE')
                _, bad = self.t07_output(entry, rule, actual_unit='кг')
                self.assertEqual(bad['machineStatus'], 'MISSING_EVIDENCE')

    def test_t07_context_requires_identical_bound_component_zone_mode_and_measurement_basis(self):
        for entry, rule in self.t07_rules():
            key = rule['requiredContext'][0]
            for field in ['parameterCode', 'attribute', 'canonicalUnit', 'componentRole',
                          'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']:
                with self.subTest(rule=rule['ruleId'], field=field):
                    for value in [None, '', 'different-reviewed-context']:
                        _, row = self.t07_output(entry, rule, mutate=lambda pd, rd:
                            rd['scopeProofs'][key].update({field: value}))
                        self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
                        self.assertFalse(row['qualified'])
            _, row = self.t07_output(entry, rule, mutate=lambda pd, rd: rd['scopeProofs'].pop(key))
            self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
            _, row = self.t07_output(entry, rule, mutate=lambda pd, rd:
                rd['scopeProofs'][key].update(sourceSha256=pd['sha256']))
            self.assertFalse(row['qualified'])

    def test_t07_missing_facts_wrong_entity_and_unknown_review_never_become_decreases(self):
        for entry, rule in self.t07_rules():
            with self.subTest(rule=rule['ruleId']):
                _, row = self.t07_output(entry, rule, mutate=lambda pd, rd:
                    [p.update(entityKey='other-component') for p in rd['scopeProofs'].values()])
                self.assertEqual(row['reasonCode'], 'ENTITY_SCOPE_MISMATCH')
                _, row = self.t07_output(entry, rule, mutate=lambda pd, rd:
                    rd.update(revisionStatus='UNKNOWN', approvalStatus='UNKNOWN'))
                self.assertFalse(row['qualified'])
                pd = source('pd', 'PD', rule['expectedSections'][0]); rd = source('rd', 'RD', rule['actualSections'][0])
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[pd, rd], text_artifacts=[artifact(pd, [rule['labels'][0] + ': 100 ' + rule['unitAliases'][0]]),
                                                     artifact(rd, ['Требуется уточнить спецификацию'])])
                row = next(r for r in output['results'] if r['ruleId'] == rule['ruleId'])
                self.assertEqual(row['machineStatus'], 'MISSING_EVIDENCE')
                self.assertFalse(row['qualified'])

    def test_t07_full_atomic_fixtures_still_have_explicit_parameter_gaps(self):
        for code in sorted(T07_CODES):
            entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == code)
            self.assertEqual(len(entry['atomicRules']), 2)
            first = entry['atomicRules'][0]
            pd = source('pd', 'PD', first['expectedSections'][0]); rd = source('rd', 'RD', first['actualSections'][0])
            lines = [r['labels'][0] + ': 100 ' + r['unitAliases'][0] for r in entry['atomicRules']]
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                sources=[pd, rd], text_artifacts=[artifact(pd, lines), artifact(rd, lines)])
            coverage = next(c for c in output['coverage'] if c['parameterCode'] == code)
            self.assertEqual(coverage['successfulComparisons'], 2)
            self.assertEqual(coverage['executionStatus'], 'PARTIAL')
            self.assertEqual(coverage['reason'], entry['gap'])

    def test_t07_zero_thickness_and_fractional_sections_do_not_claim_missing_layers(self):
        for entry, rule in self.t07_rules():
            if entry['parameterCode'] == 'SPZU-032':
                _, row = self.t07_output(entry, rule, actual='0')
                self.assertEqual(row['machineStatus'], 'CANDIDATE')
                self.assertEqual(row['reasonCode'], 'CATALOG_TRIGGER_MATCHED')
            if rule['attribute'] == 'RADIATOR_SECTION_COUNT':
                _, row = self.t07_output(entry, rule, actual='9.5')
                self.assertEqual(row['machineStatus'], 'MISSING_EVIDENCE')
                for unit in ['секций', 'ед.', 'ед', 'count', 'pcs']:
                    _, row = self.t07_output(entry, rule, actual_unit=unit)
                    self.assertEqual(row['machineStatus'], 'MISSING_EVIDENCE')

    def test_t07_pressure_aliases_use_exact_dimension_preserving_decimal_factors(self):
        for unit, value in [('Pa', '1000'), ('Па', '1000'), ('kPa', '1'), ('кПа', '1')]:
            with self.subTest(unit=unit):
                self.assertEqual(_canonical_numeric({'rawValue': value, 'rawUnit': unit}, 'Pa'), Decimal('1000'))
        value = '1.' + '0' * 90 + '1'
        normalized = _canonical_numeric({'rawValue': value, 'rawUnit': 'кПа'}, 'Pa')
        self.assertEqual(normalized, Decimal('1000.' + '0' * 87 + '1'))
        for unit in ['кпа', 'KPA', 'мПа', 'МПа', 'bar', 'м', 'Вт']:
            self.assertIsNone(_canonical_numeric({'rawValue': '1', 'rawUnit': unit}, 'Pa'))

    def test_t07_layer_id_comparisons_require_their_own_section_and_context(self):
        self.t07_rules()
        entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'SPZU-032')
        rule = entry['atomicRules'][0]; label = rule['labels'][0]
        pd, rd, actual = source('pd', 'PD', 'SPZU'), source('rd', 'RD', 'PP'), source('id', 'ID', 'OTHER')
        args = dict(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd, actual],
            text_artifacts=[artifact(pd, [label + ': 100 мм']), artifact(rd, [label + ': 90 мм']),
                            artifact(actual, [label + ': 80 мм'])])
        output = build_matrix_execution(**args)
        rows = [r for r in output['results'] if r['ruleId'] == rule['ruleId']]
        self.assertEqual(next(r for r in rows if r['comparisonVariant'] == 'PD_ID')['reasonCode'],
                         'SOURCE_SECTION_UNVERIFIED')
        actual['scopeProofs']['DRAWING_SECTION_VERIFIED'] = {
            **actual['scopeProofs']['ENTITY_SCOPE'], 'drawingSection': 'PP'}
        output = build_matrix_execution(**args)
        rows = [r for r in output['results'] if r['ruleId'] == rule['ruleId']]
        self.assertEqual({r['comparisonVariant'] for r in rows}, {'PD_RD', 'PD_ID', 'RD_ID'})
        self.assertTrue(all(r['qualified'] and r['machineStatus'] == 'CANDIDATE' for r in rows))
        actual['scopeProofs'][rule['requiredContext'][0]]['zoneKey'] = 'another-road-zone'
        output = build_matrix_execution(**args)
        rows = [r for r in output['results'] if r['ruleId'] == rule['ruleId']]
        self.assertTrue(next(r for r in rows if r['comparisonVariant'] == 'PD_RD')['qualified'])
        self.assertTrue(all(not r['qualified'] for r in rows if r['comparisonVariant'].endswith('_ID')))
        for parameter in ['IOS2-073', 'IOS4-077', 'PPM-112']:
            self.assertEqual({r['comparisonVariant'] for r in output['results'] if r['parameterCode'] == parameter},
                             {'PD_RD'})

    def test_t07_registry_rejects_dropped_or_widened_context_policy(self):
        self.t07_rules()
        for field, value in [('schemaVersion', 'unknown'), ('identityFields', ['componentKey']),
                             ('componentRole', 'UNIVERSAL_EQUIPMENT')]:
            with self.subTest(field=field):
                registry = load_matrix_registry()
                entry = next(e for e in registry['entries'] if e['parameterCode'] == 'IOS2-073')
                entry['atomicRules'][0]['subruleContext'][field] = value
                with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                    build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                        sources=[], text_artifacts=[], registry=registry)
        for missing in ['subruleContext', 'gap']:
            registry = load_matrix_registry()
            entry = next(e for e in registry['entries'] if e['parameterCode'] == 'IOS2-073')
            if missing == 'gap':
                entry['gap'] = None
            else:
                entry['atomicRules'][0].pop('subruleContext')
            with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[], text_artifacts=[], registry=registry)

    def test_registry_has_132_unique_honest_entries_and_stable_hash(self):
        registry = load_matrix_registry()
        self.assertEqual(len(registry['entries']), 132)
        self.assertEqual(len({r['parameterCode'] for r in registry['entries']}), 132)
        self.assertEqual(canonical_registry_hash(registry), canonical_registry_hash(copy.deepcopy(registry)))
        self.assertTrue(all(r['gap'] for r in registry['entries'] if not r['atomicRules']))

    def test_unknown_sources_still_extract_facts_and_metadata_but_never_qualify(self):
        output = run('Общая площадь здания: 100 м²', 'Общая площадь здания: 103 м²', approved=False)
        self.assertEqual(len([o for o in output['observations'] if 'PZ-002' in o['parameterCodes']]), 2)
        self.assertEqual(result(output, 'PZ-002')['machineStatus'], 'CLARIFICATION_REQUIRED')
        self.assertFalse(result(output, 'PZ-002')['qualified'])
        self.assertEqual(len(output['coverage']), 132)
        self.assertEqual(output['metadata'][0]['revisionStatus'], 'UNKNOWN')

    def test_area_threshold_strict_decimal_without_display_rounding(self):
        for actual, expected in [('101', 'NEGATIVE_VERIFIED'), ('101.0001', 'CANDIDATE'), ('100.9999', 'NEGATIVE_VERIFIED')]:
            with self.subTest(actual=actual):
                output = run('Общая площадь здания: 100 м²', f'Общая площадь здания: {actual} м²')
                row = result(output, 'PZ-002')
                self.assertEqual(row['machineStatus'], expected)
                self.assertTrue(row['qualified'])

    def test_zero_relative_baseline_abstains(self):
        row = result(run('Общая площадь здания: 0 м²', 'Общая площадь здания: 103 м²'), 'PZ-002')
        self.assertEqual(row['reasonCode'], 'ZERO_BASELINE')
        self.assertFalse(row['qualified'])

    def test_unit_conversion_matches_dimension_before_comparing(self):
        output = run('Толщина фундаментной плиты: 0,30 м', 'Толщина фундаментной плиты: 300 мм', pd_section='KR', rd_section='KR')
        row = result(output, 'KR-058')
        self.assertEqual(row['machineStatus'], 'NEGATIVE_VERIFIED')
        self.assertEqual((row['expectedValue'], row['actualValue']), ('300', '300'))
        row = result(run('Толщина фундаментной плиты: 300 мм', 'Толщина фундаментной плиты: 300 кВт', pd_section='KR', rd_section='KR'), 'KR-058')
        self.assertEqual(row['machineStatus'], 'MISSING_EVIDENCE')

    def test_wrong_entity_cannot_compare_even_identical_values(self):
        row = result(run('Общая площадь здания: 100 м²', 'Общая площадь здания: 103 м²', entity='building-2'), 'PZ-002')
        self.assertEqual(row['reasonCode'], 'ENTITY_SCOPE_MISMATCH')
        self.assertFalse(row['qualified'])

    def test_conflicting_values_do_not_select_convenient_pair(self):
        row = result(run('Общая площадь здания: 100 м²\nОбщая площадь здания: 110 м²', 'Общая площадь здания: 103 м²'), 'PZ-002')
        self.assertEqual(row['reasonCode'], 'AMBIGUOUS_FACTS')

    def test_missing_negative_scope_never_becomes_no_violation(self):
        pd, rd = source('pd', 'PD', 'PZ'), source('rd', 'RD', 'AR')
        pd['scopeProofs'] = {k: v for k, v in pd['scopeProofs'].items() if not k.startswith('RULE_SCOPE_COMPLETE:')}
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
            text_artifacts=[artifact(pd, ['Общая площадь здания: 100 м²']), artifact(rd, ['Общая площадь здания: 100 м²'])])
        row = result(output, 'PZ-002')
        self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
        self.assertFalse(row['qualified'])

    def test_link_group_alone_cannot_establish_building_identity(self):
        pd, rd = source('pd', 'PD', 'PZ'), source('rd', 'RD', 'AR')
        pd.pop('scopeProofs'); rd.pop('scopeProofs')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
            text_artifacts=[artifact(pd, ['Общая площадь здания: 100 м²']), artifact(rd, ['Общая площадь здания: 103 м²'])])
        self.assertIsNone(output['observations'][0]['entityKey'])
        self.assertFalse(result(output, 'PZ-002')['qualified'])

    def test_concrete_class_numeric_order_and_fire_prefix_not_interchangeable(self):
        row = result(run('Класс бетона: B35', 'Класс бетона: В30', pd_section='KR', rd_section='KR'), 'KR-055')
        self.assertEqual(row['machineStatus'], 'CANDIDATE')
        row = result(run('Пределы огнестойкости противопожарных дверей и ворот (EI): EI-60',
                         'Пределы огнестойкости противопожарных дверей и ворот (EI): E-30', pd_section='PPM'), 'PPM-103')
        self.assertEqual(row['reasonCode'], 'CLASS_DOMAIN_NOT_COMPARABLE')

    def test_rd_compressive_class_statement_accepts_only_named_optional_material_marks(self):
        prefix = 'Класс бетона по прочности на сжатие '
        cases = [('В40', ''), ('B40', ', марка по морозостойкости F150'),
                 ('В40', ', марка по водонепроницаемости W8'),
                 ('В40', ', марка по морозостойкости F150, марка по водонепроницаемости W8.'),
                 ('B7,5', '.'), ('B7.5', ', марка по морозостойкости F150.')]
        src = source('rd', 'RD', 'KR', approved=False); src.pop('scopeProofs')
        for value, tail in cases:
            with self.subTest(value=value, tail=tail):
                statement = prefix + value + tail
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[src], text_artifacts=[artifact(src, [statement])])
                obs, = output['observations']
                self.assertEqual((obs['attribute'], obs['rawValue'], obs['value'], obs['unit']),
                                 ('CONCRETE_CLASS', value, value, 'B_CLASS'))
                self.assertEqual(obs['rawText'], statement)
                self.assertEqual(obs['evidenceFragments'][0]['rawText'], statement)
                self.assertIsNone(obs['entityKey'])
                self.assertEqual(obs['sourceFlags'], ['SOURCE_APPROVAL_UNKNOWN', 'SOURCE_REVISION_UNKNOWN'])
                self.assertFalse(result(output, 'KR-055')['qualified'])

    def test_rd_compressive_class_rejects_surface_classes_ranges_alternatives_and_unknown_tails(self):
        prefix = 'Класс бетона по прочности на сжатие '
        invalid = [
            'Класс бетонных поверхностей не более А6 (СП 70.13330.2012, приложение Х).',
            prefix + 'B35-B40', prefix + 'B35–B40', prefix + 'B35 или B40',
            prefix + 'B35/B40', prefix + 'B35, B40', prefix + 'B35 (B40)',
            prefix + '-B40', prefix + 'B40 по ГОСТ 26633',
            prefix + 'B40, марка по водонепроницаемости W8, марка по морозостойкости F150',
            prefix + 'B40, марка по морозостойкости F150/F200',
            prefix + 'B40, марка по морозостойкости F150, марка по морозостойкости F200',
            prefix + 'B40, марка по водонепроницаемости W8 и W10',
            'Не ' + prefix + 'B40', 'Требуется ' + prefix + 'B40',
            prefix + 'B40. ' + prefix + 'B35.', prefix + 'А6',
        ]
        src = source('rd', 'RD', 'KR')
        for statement in invalid:
            with self.subTest(statement=statement):
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[src], text_artifacts=[artifact(src, [statement])])
                self.assertFalse(output['observations'])

    def test_compressive_statement_is_rd_only_and_never_resolves_mixed_source_stage(self):
        statement = ('Класс бетона по прочности на сжатие В40, марка по морозостойкости F150, '
                     'марка по водонепроницаемости W8.')
        for stage in ['PD', 'ID', 'UNRESOLVED']:
            with self.subTest(stage=stage):
                src = source('document', stage if stage != 'UNRESOLVED' else 'PD', 'KR')
                if stage == 'UNRESOLVED':
                    src['stages'] = ['PD', 'RD']
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[src], text_artifacts=[artifact(src, [statement])])
                self.assertFalse(output['observations'])

    def test_rd_compressive_class_preserves_exact_line_fragment_in_multiline_original_block(self):
        src = source('rd', 'RD', 'KR', approved=False); src.pop('scopeProofs')
        # Exact text and line geometry from public F0144, PDF page 3, block 50.
        slab = 'Толщина ж/б плиты перекрытия подземного этажа - 250мм, ж/б капители толщиной - 500мм.'
        statement = ('Класс  бетона  по  прочности  на  сжатие  В40,  марка  по  морозостойкости  F150,  '
                     'марка  по  водонепроницаемости  W8.')
        boxes = [[1862581, 1397692, 2222846, 1409572], [1862762, 1381133, 2345651, 1393013]]
        block = {'text': slab + '\n' + statement,
                 'bboxMilliPoints': [1862581, 1381133, 2345651, 1409572],
                 'lineBboxesMilliPoints': boxes}
        art = artifact(src, [], blocks=[block])
        art['pages'][0].update(widthMilliPoints=2384000, heightMilliPoints=1684000)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[src], text_artifacts=[art])
        self.assertEqual(len(output['observations']), 2)
        obs = next(o for o in output['observations'] if o['attribute'] == 'CONCRETE_CLASS')
        self.assertEqual(obs['rawText'], statement)
        self.assertEqual(obs['blockId'], '0:1')
        self.assertEqual(obs['evidenceFragments'], [{'blockId': '0:1', 'rawText': statement, 'bbox': obs['bbox']}])
        self.assertEqual(obs['bbox']['x'], boxes[1][0] / 2384000)
        self.assertEqual(obs['bbox']['height'], (boxes[1][3] - boxes[1][1]) / 1684000)

    def test_rd_compressive_class_decimal_boundary_uses_same_scoped_comparator(self):
        for value, status in [('39.999', 'CANDIDATE'), ('40', 'NEGATIVE_VERIFIED'),
                              ('40.001', 'NEGATIVE_VERIFIED')]:
            with self.subTest(value=value):
                output = run('Класс бетона: B40', 'Класс бетона по прочности на сжатие В' + value + '.',
                             pd_section='KR', rd_section='KR')
                row = result(output, 'KR-055')
                self.assertEqual(row['machineStatus'], status)
                self.assertTrue(row['qualified'])

    def test_normative_boundary_needs_explicit_applicability(self):
        pd, rd = source('pd', 'PD', 'AR'), source('rd', 'RD', 'AR')
        for src in [pd, rd]:
            src['scopeProofs'].pop('NORM_APPLICABILITY_VERIFIED', None)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
            text_artifacts=[artifact(pd, ['Ширина эвакуационного коридора: 1.5 м']), artifact(rd, ['Ширина эвакуационного коридора: 1.1 м'])])
        self.assertEqual(result(output, 'AR-040')['reasonCode'], 'CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED')

    def test_aligned_three_cell_table_preserves_all_original_fragments(self):
        src = source('pd', 'PD', 'PZ', approved=False)
        blocks = [{'text': 'Общая площадь здания', 'bboxMilliPoints': [1000, 10000, 220000, 22000]},
                  {'text': 'м ²', 'bboxMilliPoints': [240000, 10000, 270000, 22000]},
                  {'text': '11 618,27', 'bboxMilliPoints': [320000, 10000, 390000, 22000]}]
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
                                        text_artifacts=[artifact(src, [], blocks=blocks)])
        obs = next(o for o in output['observations'] if 'PZ-002' in o['parameterCodes'])
        self.assertEqual(obs['value'], '11618.27')
        self.assertEqual(len(obs['evidenceFragments']), 3)
        self.assertEqual({f['blockId'] for f in obs['evidenceFragments']}, {'0:0', '1:0', '2:0'})

    def test_provenance_mismatch_rejected_and_input_order_deterministic(self):
        pd, rd = source('pd', 'PD', 'PZ'), source('rd', 'RD', 'AR')
        arts = [artifact(pd, ['Общая площадь здания: 100 м²']), artifact(rd, ['Общая площадь здания: 103 м²'])]
        args = dict(object_id=OBJECT, input_manifest_hash=MANIFEST)
        a = build_matrix_execution(**args, sources=[pd, rd], text_artifacts=arts)
        self.assertEqual(a, build_matrix_execution(**args, sources=[rd, pd], text_artifacts=arts[::-1]))
        arts[0]['inputSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'provenance'):
            build_matrix_execution(**args, sources=[pd, rd], text_artifacts=arts)

    def test_every_installed_atomic_rule_extracts_and_executes_qualified_fixture(self):
        failures = []
        for entry in load_matrix_registry()['entries']:
            for rule in entry['atomicRules']:
                if rule['ruleId'] in ('matrix-pz-009-declared_project_zero_absolute_elevation',
                                       'matrix-kr-057-catalog_a500c_to_a400'):
                    # Source-authored prose needs its dedicated exact-fact review
                    # fixture. A generic label must not bypass either grammar.
                    if rule['ruleId'].startswith('matrix-pz-009-'):
                        from test_matrix_project_zero import reviewed_args
                    else:
                        from test_matrix_rebar import reviewed_args
                    scoped = build_matrix_execution(**reviewed_args())
                    row = next(row for row in scoped['results'] if row['ruleId'] == rule['ruleId'])
                    if row['machineStatus'] != 'CANDIDATE' or not row['qualified']:
                        failures.append((rule['ruleId'], row['reasonCode']))
                    continue
                pd = source('pd', 'PD', rule['expectedSections'][0])
                rd = source('rd', 'RD', rule['actualSections'][0])
                family, unit = rule['family'], rule['canonicalUnit']
                if rule['valueKind'] == 'CONCRETE_CLASS':
                    a, b = 'B35', 'B30'
                elif rule['valueKind'] == 'CATEGORY':
                    a, b = {'reliability_category': ('I', 'III'), 'energy_class': ('A', 'B'),
                            'fire_resistance_degree': ('I', 'II'), 'structural_fire_hazard_class': ('С0', 'С1'),
                            'finish_fire_class': ('КМ0', 'КМ1'), 'fire_rating': ('EI-60', 'EI-30')}[unit]
                elif family in {'LOWER_BOUND', 'UPPER_BOUND'}:
                    bound = Decimal(rule['threshold']['value'])
                    a, b = str(bound), str(bound - Decimal('0.001') if family == 'LOWER_BOUND' else bound + Decimal('0.001'))
                    for src in [pd, rd]:
                        src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'].update(applicable=True,
                            parameterCode=entry['parameterCode'], attribute=rule['attribute'],
                            threshold=rule['threshold']['value'], canonicalUnit=unit)
                else:
                    a, b = '100', '90' if family == 'DECREASE' else '111'
                suffix = '' if rule['valueKind'] in {'CATEGORY', 'CONCRETE_CLASS'} else ' ' + rule['unitAliases'][0]
                label = rule['labels'][0]
                output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[pd, rd], text_artifacts=[artifact(pd, [label + ': ' + a + suffix]),
                                                     artifact(rd, [label + ': ' + b + suffix])])
                row = next(row for row in output['results'] if row['ruleId'] == rule['ruleId'])
                if row['machineStatus'] != 'CANDIDATE' or not row['qualified']:
                    failures.append((rule['ruleId'], row['reasonCode']))
        self.assertEqual(failures, [])

    def test_partial_scope_coverage_never_promoted_by_one_success(self):
        pd = source('pd', 'PD', 'PZ'); rd = source('rd', 'RD', 'AR')
        pd['scopeProofs'].pop('PARAMETER_SCOPE_COMPLETE:PZ-002')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[pd, rd], text_artifacts=[artifact(pd, ['Общая площадь здания: 100 м²']),
                                             artifact(rd, ['Общая площадь здания: 103 м²'])])
        coverage = next(row for row in output['coverage'] if row['parameterCode'] == 'PZ-002')
        self.assertEqual(coverage['successfulComparisons'], 1)
        self.assertEqual(coverage['executionStatus'], 'PARTIAL')
        self.assertEqual(sum(row['executionStatus'] == 'UNSUPPORTED' for row in output['coverage']), 77)

    def test_no_table_choice_when_multiple_numeric_columns_or_nearby_row(self):
        src = source('pd', 'PD', 'PZ')
        for boxes in [[(1000, 'Общая площадь здания'), (240000, 'м²'), (320000, '100'), (420000, '103')],
                      [(1000, 'Общая площадь здания'), (240000, 'м²'), (320000, '100 - 103')]]:
            blocks = [{'text': t, 'bboxMilliPoints': [x, 10000, x + (210000 if x == 1000 else 40000), 22000]} for x, t in boxes]
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                sources=[src], text_artifacts=[artifact(src, [], blocks=blocks)])
            self.assertFalse(output['observations'])

    def test_metadata_candidates_do_not_override_review_or_resolve_mixed_stages(self):
        src = source('mixed', 'PD', 'OTHER', approved=False)
        src['stages'] = ['PD', 'RD']; src['pageStages'] = {}
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[src], text_artifacts=[artifact(src, ['Стадия: РД', 'Изм. 3', 'Дата 17.10.2026',
                                                           'Раздел АР', 'Общая площадь здания: 100 м²'])])
        self.assertEqual(output['metadata'][0]['stage'], 'UNRESOLVED')
        self.assertEqual(output['metadata'][0]['revisionStatus'], 'UNKNOWN')
        self.assertEqual({s['field'] for s in output['metadata'][0]['stampCandidates']}, {'stage','revision','date','section'})
        self.assertTrue(all(o['stage'] == 'UNRESOLVED' for o in output['observations']))

    def test_registry_hash_and_proof_cannot_be_reused_for_different_source(self):
        pd, rd = source('pd', 'PD', 'PZ'), source('rd', 'RD', 'AR')
        rd['scopeProofs']['ENTITY_SCOPE']['sourceSha256'] = pd['sha256']
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
            sources=[pd, rd], text_artifacts=[artifact(pd, ['Общая площадь здания: 100 м²']),
                                             artifact(rd, ['Общая площадь здания: 103 м²'])])
        self.assertFalse(result(output, 'PZ-002')['qualified'])
        self.assertIsNone(next(o for o in output['observations'] if o['sourceFileId'] == 'rd')['entityKey'])

    def test_header_unit_remains_candidate_and_needs_own_original_fragment(self):
        src = source('pd', 'PD', 'SPZU', approved=False)
        src.pop('scopeProofs')
        blocks = [
            {'text': 'В гр. ГПЗУ, м2', 'bboxMilliPoints': [320000, 70000, 430000, 80000]},
            {'text': 'Площадь твердых покрытий в.т.ч:', 'bboxMilliPoints': [1000, 10000, 220000, 22000]},
            {'text': '6302,42', 'bboxMilliPoints': [320000, 10000, 390000, 22000]}]
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
            text_artifacts=[artifact(src, [], blocks=blocks)])
        obs = next(o for o in output['observations'] if 'SPZU-025' in o['parameterCodes'])
        self.assertEqual((obs['value'], obs['unit']), ('6302.42', 'm2'))
        self.assertIn('TABLE_HEADER_UNIT_SCOPE_UNVERIFIED', obs['sourceFlags'])
        self.assertEqual(len(obs['evidenceFragments']), 3)
        self.assertIsNone(obs['entityKey'])

    def test_approved_change_and_unrelated_tu_limit_cannot_trigger(self):
        for code, text, pd_section, rd_section, key, changes in [
            ('PZ-004', 'Строительный объем здания', 'PZ', 'AR', 'APPROVED_CHANGE_STATUS', {'approvedChangePresent': True}),
            ('PZ-014', 'Расчетная электрическая мощность', 'PZ', 'EOM', 'TECHNICAL_CONDITIONS_LIMIT', {'limitValue': '120'})]:
            pd, rd = source('pd', 'PD', pd_section), source('rd', 'RD', rd_section)
            rd['scopeProofs'][key].update(changes)
            unit = 'м³' if code == 'PZ-004' else 'кВт'
            output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
                text_artifacts=[artifact(pd, [text + ': 100 ' + unit]), artifact(rd, [text + ': 111 ' + unit])])
            self.assertEqual(result(output, code)['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
            self.assertFalse(result(output, code)['qualified'])

    def test_source_review_does_not_override_immutable_stage_identity(self):
        src = source('pd', 'PD', 'PZ')
        src['review'] = {'stages': ['RD'], 'sourceFileId': 'forged', 'sha256': '0' * 64}
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
            text_artifacts=[artifact(src, ['Общая площадь здания: 100 м²'])])
        self.assertEqual(output['observations'][0]['stage'], 'PD')
        self.assertEqual(output['observations'][0]['sourceFileId'], 'pd')

    def test_pd_id_pair_uses_own_source_proof_and_never_borrows_rd_context(self):
        pd, actual = source('pd', 'PD', 'PZ'), source('id', 'ID', 'OTHER')
        line = 'Общая площадь здания: '
        args = dict(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, actual],
                    text_artifacts=[artifact(pd, [line + '100 м²']), artifact(actual, [line + '103 м²'])])
        output = build_matrix_execution(**args)
        row = next(r for r in output['results'] if r['parameterCode'] == 'PZ-002' and r['comparisonVariant'] == 'PD_ID')
        self.assertEqual(row['reasonCode'], 'SOURCE_SECTION_UNVERIFIED')
        actual['scopeProofs']['DRAWING_SECTION_VERIFIED'] = {
            **actual['scopeProofs']['ENTITY_SCOPE'], 'drawingSection': 'AR'}
        output = build_matrix_execution(**args)
        row = next(r for r in output['results'] if r['parameterCode'] == 'PZ-002' and r['comparisonVariant'] == 'PD_ID')
        self.assertEqual(row['machineStatus'], 'CANDIDATE')
        self.assertTrue(row['qualified'])
        self.assertFalse(any(r['comparisonVariant'] == 'RD_ID' for r in output['results'] if r['parameterCode'] == 'PZ-002'))

    def test_rd_id_concrete_comparison_uses_rd_project_baseline(self):
        rd, actual = source('rd', 'RD', 'KJ'), source('id', 'ID', 'OTHER')
        actual['scopeProofs']['DRAWING_SECTION_VERIFIED'] = {
            **actual['scopeProofs']['ENTITY_SCOPE'], 'drawingSection': 'KJ'}
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[rd, actual],
            text_artifacts=[artifact(rd, ['Класс бетона: B35']), artifact(actual, ['Класс бетона: B30'])])
        row = next(r for r in output['results'] if r['parameterCode'] == 'KR-055' and r['comparisonVariant'] == 'RD_ID')
        self.assertEqual(row['machineStatus'], 'CANDIDATE')
        self.assertTrue(row['qualified'])

    def test_optional_id_stage_missing_fact_is_abstention_and_never_default_negative(self):
        pd, rd, actual = source('pd', 'PD', 'PZ'), source('rd', 'RD', 'AR'), source('id', 'ID', 'OTHER')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd, actual],
            text_artifacts=[artifact(pd, ['Общая площадь здания: 100 м²']), artifact(rd, ['Общая площадь здания: 100 м²']),
                            artifact(actual, ['Исполнительный журнал работ'])])
        rows = [r for r in output['results'] if r['parameterCode'] == 'PZ-002']
        self.assertEqual(next(r for r in rows if r['comparisonVariant'] == 'PD_ID')['machineStatus'], 'MISSING_EVIDENCE')
        self.assertEqual(next(r for r in output['coverage'] if r['parameterCode'] == 'PZ-002')['executionStatus'], 'PARTIAL')
        self.assertEqual({r['comparisonVariant'] for r in rows}, {'PD_RD', 'PD_ID'})

    def test_existing_bad_pd_cannot_become_new_normative_violation(self):
        pd, rd = source('pd', 'PD', 'AR'), source('rd', 'RD', 'AR')
        for src in [pd, rd]:
            src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'].update(applicable=True, parameterCode='AR-040',
                attribute='EVACUATION_CORRIDOR_WIDTH', threshold='1.2', canonicalUnit='m')
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[pd, rd],
            text_artifacts=[artifact(pd, ['Ширина эвакуационного коридора: 1.0 м']),
                            artifact(rd, ['Ширина эвакуационного коридора: 1.1 м'])])
        self.assertEqual(result(output, 'AR-040')['reasonCode'], 'PROJECT_BASELINE_OUTSIDE_BOUND')
        self.assertFalse(result(output, 'AR-040')['qualified'])

    def test_actual_project_class_sentence_extracts_two_separate_facts_without_identity_inference(self):
        src = source('pd', 'PD', 'OTHER', approved=False); src.pop('scopeProofs')
        sentence = 'Комплекс запроектирован II степени огнестойкости С0 класса конструктивной пожарной опасности.'
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
            text_artifacts=[artifact(src, [sentence])])
        self.assertEqual({(o['attribute'], o['value']) for o in output['observations']}, {
            ('FIRE_RESISTANCE_DEGREE','II'), ('STRUCTURAL_FIRE_HAZARD_CLASS','С0')})
        self.assertTrue(all(o['rawText'] == sentence and o['entityKey'] is None for o in output['observations']))
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
            text_artifacts=[artifact(src, [sentence.replace('запроектирован', 'не запроектирован')])])
        self.assertFalse(output['observations'])


class MatrixFactBindingIntegrationTests(unittest.TestCase):
    def test_only_selected_concrete_row_binds_and_unbound_rows_remain_visible(self):
        args = fact_binding_fixture()
        original = copy.deepcopy(args)
        output = build_matrix_execution(**args)
        facts = [o for o in output['observations'] if o['sourceFileId'] == 'pd']
        self.assertEqual(len(facts), 6)
        self.assertEqual(sum(o['entityKey'] == 'reviewed-component-1' for o in facts), 1)
        self.assertEqual(sum(o['entityKey'] is None for o in facts), 5)
        self.assertTrue(all('TABLE_CONTEXT_UNVERIFIED' in o['sourceFlags'] for o in facts))
        rows = [r for r in output['results'] if r['parameterCode'] == 'KR-055']
        self.assertEqual({r['entityKey'] for r in rows}, {None, 'reviewed-component-1'})
        selected = next(r for r in rows if r['entityKey'])
        self.assertEqual(selected['machineStatus'], 'CANDIDATE')
        self.assertTrue(selected['qualified'])
        self.assertFalse(next(r for r in rows if r['entityKey'] is None)['qualified'])
        self.assertEqual(next(c for c in output['coverage'] if c['parameterCode'] == 'KR-055')['executionStatus'], 'PARTIAL')
        self.assertEqual(args, original)

    def test_slab_binding_uses_exact_fact_and_required_floor_basis_contexts(self):
        args = fact_binding_fixture(parameter_code='KR-059')
        output = build_matrix_execution(**args)
        row = result(output, 'KR-059')
        self.assertEqual((row['expectedValue'], row['actualValue'], row['delta']), ('250', '240', '-10'))
        self.assertTrue(row['qualified'])
        self.assertIn('TABLE_CONTEXT_UNVERIFIED', next(o for o in output['observations'] if o['sourceFileId'] == 'pd')['sourceFlags'])
        args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts'].pop('SLAB_FLOOR_ZONE_IDENTITY')
        row = result(build_matrix_execution(**args), 'KR-059')
        self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:SLAB_FLOOR_ZONE_IDENTITY')
        self.assertFalse(row['qualified'])

    def test_table_review_only_removes_effective_table_flag_for_selected_rule(self):
        for changes in ['absent', 'wrong_hash']:
            with self.subTest(changes=changes):
                args = fact_binding_fixture(review_table=changes != 'absent')
                binding = args['sources'][0]['scopeProofs']['FACT_BINDINGS']['bindings'][0]
                if changes == 'wrong_hash':
                    binding['tableContextReview']['fragmentsHash'] = '0' * 64
                row = next(r for r in build_matrix_execution(**args)['results'] if r['parameterCode'] == 'KR-055' and r['entityKey'])
                self.assertEqual(row['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
                self.assertFalse(row['qualified'])

    def test_reviewed_table_never_clears_unknown_source_or_ocr_flags(self):
        for field, value in [('revisionStatus', 'UNKNOWN'), ('approvalStatus', 'UNKNOWN')]:
            with self.subTest(field=field):
                args = fact_binding_fixture(parameter_code='KR-059')
                args['sources'][0][field] = value
                output = build_matrix_execution(**args)
                row = result(output, 'KR-059')
                self.assertFalse(row['qualified'])
                self.assertIn('SOURCE_' + ('REVISION' if field == 'revisionStatus' else 'APPROVAL') + '_UNKNOWN',
                              next(o for o in output['observations'] if o['sourceFileId'] == 'pd')['sourceFlags'])

        args = fact_binding_fixture()
        src, art = args['sources'][0], args['text_artifacts'][0]
        envelope = src['scopeProofs'].pop('FACT_BINDINGS')
        # Header lies on the previous page. Its OCR disposition must survive table review.
        art['pages'][0]['blocks'].append({'text': '(cid:1)' * 200,
            'bboxMilliPoints': [1000, 1000, 2000, 2000]})
        refresh_artifact_quality(art)
        original = build_matrix_execution(**args)
        fact = next(o for o in original['observations'] if o['id'] == envelope['bindings'][0]['target']['observationId'])
        target = derive_matrix_fact_target(fact, art)
        envelope['bindings'][0]['target'].update({k: target[k] for k in ['evidenceHash', 'textArtifactHash']})
        src['scopeProofs']['FACT_BINDINGS'] = envelope
        output = build_matrix_execution(**args)
        row = next(r for r in output['results'] if r['parameterCode'] == 'KR-055' and r['entityKey'])
        self.assertEqual(row['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
        self.assertFalse(row['qualified'])
        self.assertIn('PAGE_TEXT_REQUIRES_OCR', next(o for o in output['observations'] if o['sourceFileId'] == 'pd')['sourceFlags'])

    def test_changed_artifact_or_binding_identity_cannot_reuse_review(self):
        for field in ['frame', 'text', 'geometry', 'extractor', 'evidenceHash', 'textArtifactHash',
                      'observationId', 'ruleId', 'ruleVersion', 'parameterCode']:
            with self.subTest(field=field):
                args = fact_binding_fixture(parameter_code='KR-059')
                binding = args['sources'][0]['scopeProofs']['FACT_BINDINGS']['bindings'][0]
                art = args['text_artifacts'][0]
                if field == 'frame':
                    art['pages'][0]['rotationDegrees'] = 90
                elif field == 'text':
                    art['pages'][0]['blocks'][-1]['text'] += ' (изменено)'
                    refresh_artifact_quality(art)
                elif field == 'geometry':
                    art['pages'][0]['widthMilliPoints'] += 1
                elif field == 'extractor':
                    # Rehash the previous target under a different extractor version.
                    origin = build_matrix_execution(**args)
                    fact = next(o for o in origin['observations'] if o['sourceFileId'] == 'pd')
                    fact['extractorVersion'] += '-other'
                    target = derive_matrix_fact_target(fact, art)
                    binding['target']['evidenceHash'] = target['evidenceHash']
                elif field in ['evidenceHash', 'textArtifactHash', 'observationId']:
                    binding['target'][field] = '0' * 64
                else:
                    binding[field] = {'ruleId': 'matrix-other', 'ruleVersion': '2', 'parameterCode': 'KR-055'}[field]
                output = build_matrix_execution(**args)
                self.assertIsNone(next(o for o in output['observations'] if o['sourceFileId'] == 'pd')['entityKey'])
                self.assertFalse(any(r['qualified'] for r in output['results']))

    def test_invalid_envelope_provenance_fails_closed_even_without_facts(self):
        for field, value in [('sourceFileId', 'other'), ('sourceSha256', '0' * 64), ('objectId', 'foreign'),
                             ('inputManifestHash', '0' * 64), ('status', 'CANDIDATE'), ('reference', ' '),
                             ('schemaVersion', 'unknown')]:
            with self.subTest(field=field):
                args = fact_binding_fixture()
                args['sources'][0]['scopeProofs']['FACT_BINDINGS'][field] = value
                with self.assertRaisesRegex(ValueError, 'fact scope'):
                    build_matrix_execution(**args)

    def test_explicit_empty_bindings_disable_every_legacy_proof(self):
        args = fact_binding_fixture(parameter_code='KR-059')
        for src in args['sources']:
            src['scopeProofs']['FACT_BINDINGS']['bindings'] = []
        output = build_matrix_execution(**args)
        self.assertTrue(all(o['entityKey'] is None for o in output['observations']))
        self.assertFalse(any(r['qualified'] for r in output['results']))
        self.assertEqual(result(output, 'KR-059')['reasonCode'], 'ENTITY_SCOPE_UNVERIFIED')

    def test_nonempty_bindings_require_original_artifact_but_empty_scope_does_not(self):
        args = fact_binding_fixture()
        args['text_artifacts'] = args['text_artifacts'][1:]
        with self.assertRaisesRegex(ValueError, 'fact scope original text artifact missing'):
            build_matrix_execution(**args)
        args['sources'][0]['scopeProofs']['FACT_BINDINGS']['bindings'] = []
        output = build_matrix_execution(**args)
        self.assertFalse(any(r['qualified'] for r in output['results']))

    def test_v2_fact_review_is_available_in_source_review_snapshot(self):
        args = fact_binding_fixture(parameter_code='KR-059')
        for src in args['sources']:
            src['review'] = {'scopeProofs': copy.deepcopy(src['scopeProofs'])}
            src.pop('scopeProofs')
        self.assertTrue(result(build_matrix_execution(**args), 'KR-059')['qualified'])

    def test_negative_result_cannot_borrow_legacy_completeness(self):
        args = fact_binding_fixture(parameter_code='KR-059', actual_value='250')
        row = result(build_matrix_execution(**args), 'KR-059')
        self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
        self.assertFalse(row['qualified'])
        self.assertEqual(row['delta'], '0')

    def test_strict_binding_schema_rejects_duplicate_conflict_and_completeness(self):
        for mutation in ['duplicate', 'conflict', 'completeness', 'unknown', 'target_unknown',
                         'context_unknown', 'too_many', 'not_array', 'bad_table_review', 'bad_context_type',
                         'bad_context_key', 'too_many_contexts', 'long_entity', 'short_reference', 'invalid_limit']:
            with self.subTest(mutation=mutation):
                args = fact_binding_fixture()
                envelope = args['sources'][0]['scopeProofs']['FACT_BINDINGS']
                binding = envelope['bindings'][0]
                if mutation in ['duplicate', 'conflict']:
                    other = copy.deepcopy(binding)
                    if mutation == 'conflict':
                        other.update(ruleId='other-rule', entityKey='other-entity')
                    envelope['bindings'].append(other)
                elif mutation == 'completeness':
                    binding['contexts']['RULE_SCOPE_COMPLETE:' + binding['ruleId']] = {'reference': 'complete scope claim'}
                elif mutation == 'unknown':
                    binding['approved'] = True
                elif mutation == 'target_unknown':
                    binding['target']['foreign'] = True
                elif mutation == 'context_unknown':
                    binding['contexts']['ELEMENT_IDENTITY']['status'] = 'VERIFIED'
                elif mutation == 'too_many':
                    envelope['bindings'] = [copy.deepcopy(binding) for _ in range(501)]
                elif mutation == 'not_array':
                    envelope['bindings'] = {}
                elif mutation == 'bad_table_review':
                    binding['tableContextReview']['fragmentsHash'] = 'invalid'
                elif mutation == 'bad_context_type':
                    binding['contexts']['ELEMENT_IDENTITY']['applicable'] = 'true'
                elif mutation == 'bad_context_key':
                    binding['contexts']['lower_case'] = {'reference': 'invalid context key'}
                elif mutation == 'too_many_contexts':
                    binding['contexts'] = {'CONTEXT_' + str(i): {'reference': 'reviewed context'} for i in range(101)}
                elif mutation == 'long_entity':
                    binding['entityKey'] = 'x' * 201
                elif mutation == 'short_reference':
                    binding['reference'] = ' short '
                elif mutation == 'invalid_limit':
                    binding['contexts']['ELEMENT_IDENTITY']['limitValue'] = '1e3'
                with self.assertRaisesRegex(ValueError, 'fact scope'):
                    build_matrix_execution(**args)

    def test_two_selected_rows_keep_distinct_entities_and_contexts(self):
        args = fact_binding_fixture()
        output = build_matrix_execution(**args)
        src = args['sources'][0]
        neighbor = next(o for o in output['observations'] if o['sourceFileId'] == 'pd' and o['entityKey'] is None)
        target = derive_matrix_fact_target(neighbor, args['text_artifacts'][0])
        binding = copy.deepcopy(src['scopeProofs']['FACT_BINDINGS']['bindings'][0])
        binding.update(entityKey='reviewed-component-2', target={**binding['target'],
            **{k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']}})
        src['scopeProofs']['FACT_BINDINGS']['bindings'].append(binding)
        output = build_matrix_execution(**args)
        rows = [r for r in output['results'] if r['parameterCode'] == 'KR-055']
        self.assertEqual({r['entityKey'] for r in rows}, {None, 'reviewed-component-1', 'reviewed-component-2'})
        self.assertTrue(next(r for r in rows if r['entityKey'] == 'reviewed-component-1')['qualified'])
        self.assertFalse(next(r for r in rows if r['entityKey'] == 'reviewed-component-2')['qualified'])

    def test_same_source_mixed_stage_pages_use_each_facts_own_binding_context(self):
        # One immutable PDF may contain explicitly reviewed PD and RD pages.
        args = fact_binding_fixture(parameter_code='KR-059')
        pd, rd = args['sources']
        combined = pd
        combined['stages'] = ['PD', 'RD']
        combined['pageStages'] = {'1': 'PD', '2': 'RD'}
        art = args['text_artifacts'][0]
        art['pages'].append(copy.deepcopy(args['text_artifacts'][1]['pages'][0]))
        refresh_artifact_quality(art)
        envelope = combined['scopeProofs'].pop('FACT_BINDINGS')
        args.update(sources=[combined], text_artifacts=[art])
        original = build_matrix_execution(**args)
        bindings = []
        for fact in original['observations']:
            target = derive_matrix_fact_target(fact, art)
            binding = copy.deepcopy(envelope['bindings'][0])
            binding['target'].update({k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']})
            if 'fragmentsHash' in target:
                binding['tableContextReview']['fragmentsHash'] = target['fragmentsHash']
            else:
                binding.pop('tableContextReview', None)
            bindings.append(binding)
        envelope['bindings'] = bindings
        combined['scopeProofs']['FACT_BINDINGS'] = envelope
        output = build_matrix_execution(**args)
        self.assertTrue(result(output, 'KR-059')['qualified'])
        bindings[1]['contexts'].pop('SLAB_FLOOR_ZONE_IDENTITY')
        self.assertFalse(result(build_matrix_execution(**args), 'KR-059')['qualified'])


def sidewalk_fixture(*, expected: str = '100', actual: str = '110', approved_change_present=False,
                     approved: bool = True, fact_scopes: bool = False) -> dict:
    """Bounded T14 single-line original facts; no completeness is asserted.

    Fact-scope mode deliberately reuses immutable targets in a new manifest.
    Other context judgments do not inherit the atomic identity fields.
    """
    entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'SPZU-026')
    rule = entry['atomicRules'][0]
    pd, rd = source('pd', 'PD', 'SPZU', approved=approved), source('rd', 'RD', 'PP', approved=approved)
    sources = [pd, rd]
    arts = [artifact(pd, ['Площадь тротуарного плиточного покрытия: ' + expected + ' м²']),
            artifact(rd, ['Площадь тротуаров из бетонной плитки: ' + actual + ' м²'])]
    for src in sources:
        src['scopeProofs']['APPROVED_CHANGE_STATUS']['approvedChangePresent'] = approved_change_present
        for key in ['RULE_SCOPE_COMPLETE:' + rule['ruleId'], 'PARAMETER_SCOPE_COMPLETE:SPZU-026']:
            src['scopeProofs'].pop(key)
    args = {'object_id': OBJECT, 'input_manifest_hash': MANIFEST, 'sources': sources, 'text_artifacts': arts}
    if fact_scopes:
        origin = build_matrix_execution(**args)
        new_manifest = 'c' * 64
        for src, art in zip(sources, arts):
            fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId'])
            target = derive_matrix_fact_target(fact, art)
            contexts = {key: {'reference': 'Inspector separately verified this original condition'}
                        for key in rule['requiredContext']}
            contexts['APPROVED_CHANGE_STATUS']['approvedChangePresent'] = approved_change_present
            key = 'ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']
            contexts[key].update(parameterCode='SPZU-026', attribute=rule['attribute'], canonicalUnit='m2',
                                 componentRole='SIDEWALK_TILE_PAVING',
                                 **{field: 'fixture-' + field for field in rule['subruleContext']['identityFields']})
            binding = {'ruleId': rule['ruleId'], 'ruleVersion': rule['version'], 'parameterCode': 'SPZU-026',
                       'entityKey': 'building-1', 'reference': 'Inspector selected exact sidewalk surface',
                       'target': {'checkId': 'immutable-origin-check', 'executionContentHash': 'd' * 64,
                                  **{k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']}},
                       'contexts': contexts}
            src['scopeProofs']['FACT_BINDINGS'] = {
                'schemaVersion': 'matrix-fact-scopes-v1', 'bindings': [binding], 'status': 'VERIFIED',
                'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'],
                'objectId': OBJECT, 'inputManifestHash': new_manifest,
                'reference': 'Authenticated inspector review snapshot'}
        args['input_manifest_hash'] = new_manifest
    return args


class MatrixSidewalkAreaTests(unittest.TestCase):
    def test_sidewalk_rule_installs_one_exact_partial_atom(self):
        registry = load_matrix_registry()
        entry = next(e for e in registry['entries'] if e['parameterCode'] == 'SPZU-026')
        rule = entry['atomicRules'][0]
        self.assertEqual(entry['gap'], 'PARTIAL_SUBRULES_ONLY:SIDEWALK_TILE_AREA_ONLY;OTHER_PAVING_QUANTITIES_AND_FULL_SCOPE_UNSUPPORTED')
        self.assertEqual(rule['ruleId'], 'matrix-spzu-026-sidewalk_tile_area')
        self.assertEqual(rule['family'], 'DIFFERENT')
        self.assertEqual(rule['allowedStagePairs'], [['PD', 'RD']])
        self.assertEqual(rule['requiredContext'], ['APPROVED_CHANGE_STATUS', 'SURFACE_TYPE_IDENTITY', 'ZONE_IDENTITY',
                         'ATOMIC_SUBRULE_SCOPE:matrix-spzu-026-sidewalk_tile_area'])
        self.assertEqual(rule['subruleContext']['componentRole'], 'SIDEWALK_TILE_PAVING')
        self.assertEqual(sum(bool(e['atomicRules']) for e in registry['entries']), 55)
        self.assertEqual(sum(len(e['atomicRules']) for e in registry['entries']), 63)
        self.assertEqual(sum(len(r['allowedStagePairs']) for e in registry['entries'] for r in e['atomicRules']), 92)

    def test_sidewalk_difference_in_both_directions_and_equality_abstains(self):
        for fact_scopes in [False, True]:
            for actual, status, delta in [('110', 'CANDIDATE', '10'), ('90', 'CANDIDATE', '-10'),
                                          ('100', 'CLARIFICATION_REQUIRED', '0')]:
                with self.subTest(actual=actual, fact_scopes=fact_scopes):
                    output = build_matrix_execution(**sidewalk_fixture(actual=actual, fact_scopes=fact_scopes))
                    row = result(output, 'SPZU-026')
                    self.assertEqual(row['machineStatus'], status)
                    self.assertEqual(row['qualified'], actual != '100')
                    self.assertEqual(row['delta'], delta)
                    if actual == '100':
                        self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
                    coverage = next(c for c in output['coverage'] if c['parameterCode'] == 'SPZU-026')
                    self.assertEqual(coverage['executionStatus'], 'PARTIAL')
                    self.assertEqual(coverage['successfulComparisons'], int(actual != '100'))

    def test_sidewalk_approved_change_must_be_explicitly_absent_in_both_facts(self):
        for fact_scopes in [False, True]:
            for index in [0, 1]:
                for value in [True, None, 'false', 0]:
                    with self.subTest(fact_scopes=fact_scopes, index=index, value=value):
                        args = sidewalk_fixture(fact_scopes=fact_scopes)
                        src = args['sources'][index]
                        context = (src['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts']
                                   if fact_scopes else src['scopeProofs'])['APPROVED_CHANGE_STATUS']
                        if value is None:
                            context.pop('approvedChangePresent')
                        elif fact_scopes and not isinstance(value, bool):
                            # V2 rejects malformed typed input before rule evaluation.
                            context['approvedChangePresent'] = value
                            with self.assertRaises(ValueError):
                                build_matrix_execution(**args)
                            continue
                        else:
                            context['approvedChangePresent'] = value
                        row = result(build_matrix_execution(**args), 'SPZU-026')
                        self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:APPROVED_CHANGE_STATUS')
                        self.assertFalse(row['qualified'])

    def test_sidewalk_separate_conditions_and_atomic_identity_are_all_required(self):
        args = sidewalk_fixture(fact_scopes=True)
        key = 'ATOMIC_SUBRULE_SCOPE:matrix-spzu-026-sidewalk_tile_area'
        contexts = args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts']
        for missing in list(contexts):
            with self.subTest(missing=missing):
                changed = copy.deepcopy(args)
                changed['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts'].pop(missing)
                row = result(build_matrix_execution(**changed), 'SPZU-026')
                self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + missing)
                self.assertFalse(row['qualified'])
        for field in ['componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey',
                      'componentRole', 'parameterCode', 'attribute', 'canonicalUnit']:
            with self.subTest(field=field):
                changed = copy.deepcopy(args)
                changed['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['contexts'][key][field] = 'other'
                row = result(build_matrix_execution(**changed), 'SPZU-026')
                self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
                self.assertFalse(row['qualified'])

    def test_sidewalk_unknown_status_or_foreign_entity_never_qualifies(self):
        args = sidewalk_fixture(approved=False, fact_scopes=True)
        output = build_matrix_execution(**args)
        self.assertEqual(len([o for o in output['observations'] if 'SPZU-026' in o['parameterCodes']]), 2)
        self.assertFalse(result(output, 'SPZU-026')['qualified'])
        self.assertEqual(result(output, 'SPZU-026')['reasonCode'], 'SOURCE_REVISION_UNRESOLVED')
        args = sidewalk_fixture(fact_scopes=True)
        args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['entityKey'] = 'another-sidewalk'
        row = result(build_matrix_execution(**args), 'SPZU-026')
        self.assertEqual(row['reasonCode'], 'ENTITY_SCOPE_MISMATCH')
        self.assertFalse(row['qualified'])

    def test_sidewalk_approval_section_and_stage_gates_remain_independent(self):
        for index in [0, 1]:
            for field, value, reason in [('approvalStatus', 'UNKNOWN', 'SOURCE_APPROVAL_UNRESOLVED'),
                                         ('approvalStatus', 'UNAPPROVED', 'SOURCE_UNAPPROVED'),
                                         ('revisionStatus', 'SUPERSEDED', 'SOURCE_REVISION_SUPERSEDED'),
                                         ('sectionCode', 'OTHER', 'SOURCE_SECTION_UNVERIFIED')]:
                with self.subTest(index=index, field=field, value=value):
                    args = sidewalk_fixture(fact_scopes=True)
                    args['sources'][index][field] = value
                    row = result(build_matrix_execution(**args), 'SPZU-026')
                    self.assertEqual(row['reasonCode'], reason)
                    self.assertFalse(row['qualified'])
        args = sidewalk_fixture()
        for src in args['sources']:
            src['sectionCode'] = 'GP'
        self.assertTrue(result(build_matrix_execution(**args), 'SPZU-026')['qualified'])
        args['sources'][1]['stages'] = ['ID']
        output = build_matrix_execution(**args)
        rows = [r for r in output['results'] if r['parameterCode'] == 'SPZU-026']
        self.assertEqual({r['comparisonVariant'] for r in rows}, {'PD_RD'})
        self.assertFalse(any(r['qualified'] for r in rows))

    def test_sidewalk_fact_review_cannot_inherit_complete_scope_from_legacy_proofs(self):
        args = sidewalk_fixture(actual='100', fact_scopes=True)
        key = 'RULE_SCOPE_COMPLETE:matrix-spzu-026-sidewalk_tile_area'
        for src in args['sources']:
            src['scopeProofs'][key] = {**src['scopeProofs']['ENTITY_SCOPE'],
                'inputManifestHash': args['input_manifest_hash']}
            src['scopeProofs']['PARAMETER_SCOPE_COMPLETE:SPZU-026'] = copy.deepcopy(src['scopeProofs'][key])
        output = build_matrix_execution(**args)
        row = result(output, 'SPZU-026')
        self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
        self.assertFalse(row['qualified'])
        self.assertEqual(next(c for c in output['coverage'] if c['parameterCode'] == 'SPZU-026')['executionStatus'], 'PARTIAL')

    def test_sidewalk_literals_units_and_single_line_provenance(self):
        for unit in ['м²', 'м2', 'm²', 'm2', 'кв.м', 'кв. м']:
            with self.subTest(unit=unit):
                args = sidewalk_fixture()
                args['text_artifacts'][1] = artifact(args['sources'][1], ['Площадь тротуаров из бетонной плитки: 100,001 ' + unit])
                output = build_matrix_execution(**args)
                row = result(output, 'SPZU-026')
                self.assertTrue(row['qualified'])
                self.assertEqual(row['actualValue'], '100.001')
                self.assertEqual(row['delta'], '0.001')
                fact = next(o for o in output['observations'] if o['id'] == row['actualObservationId'])
                self.assertEqual(len(fact['evidenceFragments']), 1)
                self.assertEqual(fact['rawText'], 'Площадь тротуаров из бетонной плитки: 100,001 ' + unit)

    def test_sidewalk_decoys_ranges_alternatives_and_split_table_do_not_extract(self):
        invalid = ['Площадь твёрдых покрытий: 100 м²', 'Толщина тротуарной плитки: 80 мм',
                   'Площадь тротуаров из бетонной плитки: 100-110 м²',
                   'Площадь тротуаров из бетонной плитки: 100 / 110 м²',
                   'Площадь тротуаров из бетонной плитки: 100 или 110 м²',
                   'Площадь тротуаров из бетонной плитки: 100 м², толщина 80 мм',
                   'Площадь тротуаров из бетонной плитки: 100 м² ГОСТ 17608-2017',
                   'Площадь тротуаров из бетонной плитки: 100 см²',
                   'Площадь тротуаров из бетонной плитки: 100 М2']
        for line in invalid:
            with self.subTest(line=line):
                args = sidewalk_fixture()
                args['text_artifacts'][1] = artifact(args['sources'][1], [line])
                output = build_matrix_execution(**args)
                self.assertEqual(len([o for o in output['observations'] if o['sourceFileId'] == 'rd'
                                      and 'SPZU-026' in o['parameterCodes']]), 0)
                self.assertEqual(result(output, 'SPZU-026')['machineStatus'], 'MISSING_EVIDENCE')
        for cells in [[('Площадь тротуаров из бетонной плитки', 1000, 300000), ('100 м²', 310000, 390000)],
                      [('Площадь тротуаров из бетонной плитки', 1000, 300000), ('м²', 310000, 340000), ('100', 350000, 390000)]]:
            args = sidewalk_fixture()
            blocks = [{'text': text, 'bboxMilliPoints': [left, 10000, right, 22000]} for text, left, right in cells]
            args['text_artifacts'][1] = artifact(args['sources'][1], [], blocks=blocks)
            output = build_matrix_execution(**args)
            self.assertFalse(any(o['sourceFileId'] == 'rd' and 'SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_sidewalk_role_cannot_widen_rule_family_attribute_context_or_stage_policy(self):
        mutations = [('ruleId', 'matrix-other'), ('attribute', 'BUILDING_TOTAL_AREA'), ('canonicalUnit', 'mm'),
                     ('family', 'DECREASE'), ('valueKind', 'INTEGER'), ('expectedSections', ['PZ']),
                     ('actualSections', ['AR']), ('labels', ['Площадь твёрдых покрытий']),
                     ('unitAliases', ['м²', 'см²']), ('requiredContext', ['ATOMIC_SUBRULE_SCOPE:matrix-spzu-026-sidewalk_tile_area']),
                     ('allowedStagePairs', [['PD', 'RD'], ['PD', 'ID']])]
        for field, value in mutations:
            with self.subTest(field=field):
                registry = load_matrix_registry()
                entry = next(e for e in registry['entries'] if e['parameterCode'] == 'SPZU-026')
                entry['atomicRules'][0][field] = value
                if field == 'allowedStagePairs':
                    entry['atomicRules'][0]['comparisonVariants'] = ['PD_RD', 'PD_ID']
                with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                    build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                           sources=[], text_artifacts=[], registry=registry)
        registry = load_matrix_registry()
        foreign = next(e for e in registry['entries'] if e['parameterCode'] == 'IOS2-073')
        foreign['atomicRules'][0]['subruleContext']['componentRole'] = 'SIDEWALK_TILE_PAVING'
        with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
            build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                   sources=[], text_artifacts=[], registry=registry)


def pd_sidewalk_table_artifact(src: dict, *, include_decoys: bool = True) -> dict:
    """Compact public F0126/PDF20 shapes; no source status or table approval.

    Original block addresses are retained only in fixture provenance. Extraction
    must depend on complete original strings and geometry, never these indexes.
    """
    fixture = json.loads((Path(__file__).parent / 'fixtures' / 'sidewalk-ground-table-f0126.json').read_text())
    page = copy.deepcopy(fixture['page'])
    if not include_decoys:
        page['blocks'] = [block for original_index, block in zip(fixture['originalBlockIndexes'], page['blocks'])
                          if original_index in fixture['coreOriginalBlockIndexes']]
    value = artifact(src, [], blocks=page['blocks'])
    value['pages'][0].update(widthMilliPoints=page['widthMilliPoints'], heightMilliPoints=page['heightMilliPoints'])
    return refresh_artifact_quality(value)


def sidewalk_table_binding_fixture(*, actual: str = '110', review_table: bool = True,
                                   include_unbound: bool = False) -> dict:
    """T13 binds only the selected original ground-table fact and one RD line."""
    args = sidewalk_fixture(actual=actual)
    args['text_artifacts'][0] = pd_sidewalk_table_artifact(args['sources'][0])
    if include_unbound:
        args['text_artifacts'][0]['pages'][0]['blocks'].append({
            'text': 'Площадь тротуаров из бетонной плитки: 99 м²',
            'bboxMilliPoints': [800000, 800000, 1400000, 812000]})
        refresh_artifact_quality(args['text_artifacts'][0])
    origin = build_matrix_execution(**args)
    templates = sidewalk_fixture(actual=actual, fact_scopes=True)
    for src, art, template in zip(args['sources'], args['text_artifacts'], templates['sources']):
        fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                    and (src['stages'] != ['PD'] or o.get('contextFragments')))
        target = derive_matrix_fact_target(fact, art)
        envelope = copy.deepcopy(template['scopeProofs']['FACT_BINDINGS'])
        binding = envelope['bindings'][0]
        binding['target'].update({k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']})
        if review_table and target.get('fragmentsHash'):
            binding['tableContextReview'] = {'fragmentsHash': target['fragmentsHash'],
                                             'reference': 'Inspector checked caption, scope and column header'}
        src['scopeProofs']['FACT_BINDINGS'] = envelope
    args['input_manifest_hash'] = templates['input_manifest_hash']
    return args


class MatrixSidewalkTableTests(unittest.TestCase):
    def output(self, *, mutate=None, include_decoys=True, stage='PD'):
        src = source('ground-table', stage, 'GP', approved=False)
        src.pop('scopeProofs')
        value = pd_sidewalk_table_artifact(src, include_decoys=include_decoys)
        if mutate:
            mutate(value['pages'][0]['blocks'])
            refresh_artifact_quality(value)
        return build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                      sources=[src], text_artifacts=[value])

    @staticmethod
    def block(blocks, prefix):
        return next(block for block in blocks if _test_clean(block['text']).startswith(prefix))

    def test_public_ground_table_extracts_one_area_with_six_visible_context_fragments(self):
        for include_decoys in [True, False]:
            with self.subTest(include_decoys=include_decoys):
                output = self.output(include_decoys=include_decoys)
                facts = [o for o in output['observations'] if 'SPZU-026' in o['parameterCodes']]
                self.assertEqual(len(facts), 1)
                fact = facts[0]
                self.assertEqual((fact['value'], fact['unit'], fact['rawUnit']), ('112', 'm2', 'м²'))
                self.assertEqual(fact['rawText'], 'Тротуары пешеходные из бетонной плитки, по грунту - тип 3 112 м²')
                self.assertEqual(len(fact['evidenceFragments']), 5)
                self.assertEqual(len(fact['contextFragments']), 6)
                self.assertEqual([f['role'] for f in fact['contextFragments']],
                                 ['TABLE_SCOPE'] * 3 + ['ATTRIBUTE_HEADER'] * 3)
                self.assertEqual([f['rawText'] for f in fact['contextFragments']],
                                 ['ВЕДОМОСТЬ ПРОЕЗДОВ, ТРОТУАРОВ, ', 'ДОРОЖЕК И ПЛОЩАДОК',
                                  '(в гр. ГПЗУ)', 'Площадь', 'покрытия, кв.м. в', 'гр. ГПЗУ'])
                self.assertIn('TABLE_CONTEXT_UNVERIFIED', fact['sourceFlags'])
                self.assertIn('SOURCE_REVISION_UNKNOWN', fact['sourceFlags'])
                self.assertIn('SOURCE_APPROVAL_UNKNOWN', fact['sourceFlags'])
                self.assertIsNone(fact['entityKey'])
                self.assertEqual(fact['bbox'], {'x': 132040 / 1684000, 'y': 1 - 363861 / 1191000,
                                               'width': (352445 - 132040) / 1684000,
                                               'height': (363861 - 330201) / 1191000})
                self.assertFalse(any(row['qualified'] for row in output['results']))

    def test_table_cannot_choose_duplicate_caption_scope_header_label_type_or_value(self):
        for prefix in ['ВЕДОМОСТЬ ПРОЕЗДОВ', '(в гр. ГПЗУ)', 'Площадь покрытия, кв.м. в',
                       'Тротуары пешеходные из бетонной плитки, по грунту', '- тип 3', '112 м²']:
            with self.subTest(prefix=prefix):
                output = self.output(mutate=lambda blocks: blocks.append(copy.deepcopy(self.block(blocks, prefix))))
                self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_table_requires_exact_ordered_original_context_and_label_lines(self):
        for prefix in ['ВЕДОМОСТЬ ПРОЕЗДОВ', 'Площадь покрытия, кв.м. в',
                       'Тротуары пешеходные из бетонной плитки, по грунту']:
            for mutation in ['coarse', 'line-order', 'box-order']:
                with self.subTest(prefix=prefix, mutation=mutation):
                    def change(blocks):
                        block = self.block(blocks, prefix)
                        if mutation == 'coarse':
                            block.pop('lineBboxesMilliPoints')
                        elif mutation == 'line-order':
                            block['text'] = '\n'.join(reversed(block['text'].splitlines()))
                        else:
                            block['lineBboxesMilliPoints'].reverse()
                    output = self.output(mutate=change)
                    self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_roof_vehicle_lawn_wrong_scope_and_units_do_not_replace_ground_sidewalk(self):
        mutations = [('Тротуары пешеходные из бетонной плитки, по грунту',
                      'Тротуары пешеходные\nиз бетонной плитки,\nпо кровле автостоянки'),
                     ('Тротуары пешеходные из бетонной плитки, по грунту',
                      'Тротуары с возможностью проезда\nиз бетонной плитки,\nпо грунту'),
                     ('Тротуары пешеходные из бетонной плитки, по грунту', 'Газон,\nпо грунту'),
                     ('- тип 3', '- тип 2'), ('- тип 3', '- тип 3а'),
                     ('(в гр. ГПЗУ)', '(за гр. ГПЗУ)'),
                     ('Площадь покрытия, кв.м. в', 'Площадь\nпокрытия, кв.м. на\nгр. ГПЗУ')]
        mutations.extend(('112 м²', text) for text in ['112 м2', '112 m²', '112 кв.м', '112 мм',
                                                       '112-120 м²', '112 / 120 м²', '112 или 120 м²'])
        for prefix, text in mutations:
            with self.subTest(prefix=prefix, text=text):
                def change(blocks):
                    block = self.block(blocks, prefix)
                    block['text'] = text
                    if len(text.splitlines()) != len(block.get('lineBboxesMilliPoints', [])):
                        block.pop('lineBboxesMilliPoints', None)
                output = self.output(mutate=change)
                self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_table_geometry_blocks_foreign_columns_shifted_cells_and_competing_lines(self):
        def shift(block, dx=0, dy=0):
            for box in [block['bboxMilliPoints'], *block.get('lineBboxesMilliPoints', [])]:
                box[:] = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]
        cases = [('value-column', lambda b: shift(self.block(b, '112 м²'), dx=50000)),
                 ('value-row', lambda b: shift(self.block(b, '112 м²'), dy=30000)),
                 ('type-column', lambda b: shift(self.block(b, '- тип 3'), dx=40000)),
                 ('type-row', lambda b: shift(self.block(b, '- тип 3'), dy=-1)),
                 ('label-column', lambda b: shift(self.block(b, 'Тротуары пешеходные из бетонной плитки, по грунту'), dx=-60000)),
                 ('other-row-cell', lambda b: b.append({'text': '113 м²', 'bboxMilliPoints': [374000, 335241, 395000, 345141]})),
                 ('coarse-other-row-cell', lambda b: b.append({'text': 'другая\nплощадь', 'bboxMilliPoints': [300000, 335241, 325000, 345141]})),
                 ('competing-column-heading', lambda b: b.append({'text': 'Другая площадь', 'bboxMilliPoints': [310000, 460000, 360000, 470000]}))]
        for name, change in cases:
            with self.subTest(name=name):
                output = self.output(mutate=change)
                self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_next_same_column_caption_bounds_table_and_right_diagrams_do_not(self):
        def add_caption(blocks, *, right):
            caption = copy.deepcopy(next(b for b in blocks if '(на кровле автостоянки)' in b['text']
                                         and b['text'].startswith('ВЕДОМОСТЬ')))
            for box in [caption['bboxMilliPoints'], *caption['lineBboxesMilliPoints']]:
                box[:] = [box[0] + (600000 if right else 0), box[1] + 140000,
                          box[2] + (600000 if right else 0), box[3] + 140000]
            blocks.append(caption)
        self.assertTrue(any('SPZU-026' in o['parameterCodes'] for o in self.output(mutate=lambda b: add_caption(b, right=True))['observations']))
        self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in self.output(mutate=lambda b: add_caption(b, right=False))['observations']))
        output = self.output(mutate=lambda blocks: blocks.remove(next(b for b in blocks if '(на кровле автостоянки)' in b['text']
                                                                      and b['text'].startswith('ВЕДОМОСТЬ'))))
        self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_table_exact_geometry_boundaries_are_inclusive_only_inside_the_selected_cells(self):
        def shift(block, dx=0, dy=0):
            for box in [block['bboxMilliPoints'], *block.get('lineBboxesMilliPoints', [])]:
                box[:] = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]
        cases = [
            ('value-column-left', '112 м²', -25560, 0, True),
            ('value-outside-column-left', '112 м²', -25561, 0, False),
            ('value-column-right', '112 м²', 18683, 0, True),
            ('value-outside-column-right', '112 м²', 18684, 0, False),
            ('value-row-bottom', '112 м²', 0, -5040, True),
            ('value-outside-row-bottom', '112 м²', 0, -5041, False),
            ('value-row-top', '112 м²', 0, 18720, True),
            ('value-outside-row-top', '112 м²', 0, 18721, False),
            ('type-column-left', '- тип 3', -39149, 0, True),
            ('type-outside-column-left', '- тип 3', -39150, 0, False),
            ('type-column-right', '- тип 3', 6689, 0, True),
            ('type-outside-column-right', '- тип 3', 6690, 0, False),
            ('header-right-limit', 'Площадь покрытия, кв.м. в', 4133, 0, True),
            ('header-outside-right-limit', 'Площадь покрытия, кв.м. в', 4134, 0, False),
            ('scope-min-center-gap', '(в гр. ГПЗУ)', 0, 6960, True),
            ('scope-outside-min-center-gap', '(в гр. ГПЗУ)', 0, 6961, False),
            ('header-max-scope-gap', 'Площадь покрытия, кв.м. в', 0, -45587, True),
            ('header-outside-max-scope-gap', 'Площадь покрытия, кв.м. в', 0, -45588, False),
        ]
        for name, prefix, dx, dy, accepted in cases:
            with self.subTest(name=name):
                output = self.output(mutate=lambda blocks: shift(self.block(blocks, prefix), dx=dx, dy=dy))
                self.assertEqual(any('SPZU-026' in o['parameterCodes'] for o in output['observations']), accepted)

    def test_table_block_order_is_irrelevant_but_visible_context_changes_identity(self):
        original = next(o for o in self.output()['observations'] if 'SPZU-026' in o['parameterCodes'])
        reversed_fact = next(o for o in self.output(mutate=lambda blocks: blocks.reverse())['observations']
                             if 'SPZU-026' in o['parameterCodes'])
        self.assertEqual(reversed_fact['value'], original['value'])
        self.assertEqual([f['rawText'] for f in reversed_fact['evidenceFragments']],
                         [f['rawText'] for f in original['evidenceFragments']])
        def change_caption(blocks):
            caption = self.block(blocks, 'ВЕДОМОСТЬ ПРОЕЗДОВ')
            for box in [caption['bboxMilliPoints'], *caption['lineBboxesMilliPoints']]:
                box[0] += 1
                box[2] += 1
        moved = next(o for o in self.output(mutate=change_caption)['observations'] if 'SPZU-026' in o['parameterCodes'])
        self.assertEqual(moved['evidenceFragments'], original['evidenceFragments'])
        self.assertEqual(moved['bbox'], original['bbox'])
        self.assertNotEqual(moved['contextFragments'], original['contextFragments'])
        self.assertNotEqual(moved['id'], original['id'])

    def test_wrong_or_unresolved_stage_cannot_emit_ground_table_fact(self):
        for stage in ['RD', 'ID']:
            with self.subTest(stage=stage):
                self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in self.output(stage=stage)['observations']))
        src = source('mixed-table', 'PD', 'GP', approved=False)
        src.update(stages=['PD', 'RD'], pageStages={})
        art = pd_sidewalk_table_artifact(src)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src], text_artifacts=[art])
        self.assertFalse(any('SPZU-026' in o['parameterCodes'] for o in output['observations']))

    def test_table_review_binds_only_selected_fact_and_never_removes_raw_table_flag(self):
        for reviewed in [False, True]:
            with self.subTest(reviewed=reviewed):
                output = build_matrix_execution(**sidewalk_table_binding_fixture(review_table=reviewed, include_unbound=True))
                table = next(o for o in output['observations'] if o.get('contextFragments'))
                self.assertEqual(table['entityKey'], 'building-1')
                self.assertIn('TABLE_CONTEXT_UNVERIFIED', table['sourceFlags'])
                other = next(o for o in output['observations'] if o['stage'] == 'PD' and not o.get('contextFragments'))
                self.assertIsNone(other['entityKey'])
                rows = [r for r in output['results'] if r['parameterCode'] == 'SPZU-026']
                bound = next(r for r in rows if r['entityKey'] == 'building-1')
                self.assertEqual(bound['qualified'], reviewed)
                if not reviewed:
                    self.assertEqual(bound['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')
                self.assertTrue(any(r['entityKey'] is None and not r['qualified'] for r in rows))
        output = build_matrix_execution(**sidewalk_table_binding_fixture(actual='112'))
        self.assertEqual(result(output, 'SPZU-026')['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
        self.assertFalse(result(output, 'SPZU-026')['qualified'])

    def test_wrong_context_review_hash_cannot_clear_table_limitation(self):
        args = sidewalk_table_binding_fixture()
        binding = args['sources'][0]['scopeProofs']['FACT_BINDINGS']['bindings'][0]
        binding['tableContextReview']['fragmentsHash'] = 'f' * 64
        output = build_matrix_execution(**args)
        table = next(o for o in output['observations'] if o.get('contextFragments'))
        self.assertEqual(table['entityKey'], 'building-1')
        self.assertIn('TABLE_CONTEXT_UNVERIFIED', table['sourceFlags'])
        row = result(output, 'SPZU-026')
        self.assertFalse(row['qualified'])
        self.assertEqual(row['reasonCode'], 'TEXT_OR_STAGE_QUALITY_UNVERIFIED')


def _test_clean(text):
    return ' '.join(text.split())


def stair_prose_artifact(src: dict) -> dict:
    """Original F0151 PDF17 remapped to one explicitly synthetic fixture page."""
    public = json.loads((Path(__file__).parent / 'fixtures/pd-stair-F0151-p17.json').read_text())
    value = artifact(src, [])
    value['pages'] = [copy.deepcopy(public['page'])]
    return refresh_artifact_quality(value)


def stair_dimensions_fixture(*, kind: str = 'tread', expected: str | None = None,
                             actual: str | None = None, norm_applicable=True, fact_scopes=False) -> dict:
    if kind not in {'tread', 'riser'}:
        raise ValueError('unsupported stair fixture kind')
    entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'AR-048')
    rule = next(r for r in entry['atomicRules'] if 'stair_' + kind in r['ruleId'])
    expected = expected if expected is not None else ('310' if kind == 'tread' else '149')
    actual = actual if actual is not None else ('299' if kind == 'tread' else '151')
    basis = {'tread': 'FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH',
             'riser': 'FINISHED_VERTICAL_RISER_HEIGHT'}[kind]
    sources = [source('pd', 'PD', 'AR'), source('rd', 'RD', 'AR')]
    arts = [artifact(src, [rule['labels'][0] + ': ' + value + ' мм'])
            for src, value in zip(sources, [expected, actual])]
    key = 'ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']
    for src in sources:
        src['scopeProofs'][key].update(operatingModeKey='EVACUATION', measurementBasisKey=basis)
        src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'].update(applicable=norm_applicable,
            parameterCode='AR-048', attribute=rule['attribute'], threshold=rule['threshold']['value'], canonicalUnit='mm')
        if norm_applicable is None:
            src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'].pop('applicable')
        for name in list(src['scopeProofs']):
            if name.startswith('RULE_SCOPE_COMPLETE:') or name == 'PARAMETER_SCOPE_COMPLETE:AR-048':
                src['scopeProofs'].pop(name)
    args = {'object_id': OBJECT, 'input_manifest_hash': MANIFEST, 'sources': sources, 'text_artifacts': arts}
    if fact_scopes:
        origin = build_matrix_execution(**args)
        args['input_manifest_hash'] = 'c' * 64
        for src, art in zip(sources, arts):
            fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                        and o['attribute'] == rule['attribute'])
            target = derive_matrix_fact_target(fact, art)
            assert target is not None
            contexts = {name: {'reference': 'Inspector checked this exact flight, step and finished dimension'}
                        for name in rule['requiredContext']}
            contexts['NORM_APPLICABILITY_VERIFIED'].update({name: src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'][name]
                for name in ['applicable', 'parameterCode', 'attribute', 'threshold', 'canonicalUnit']
                if name in src['scopeProofs']['NORM_APPLICABILITY_VERIFIED']})
            contexts[key].update({name: src['scopeProofs'][key][name] for name in
                ['parameterCode', 'attribute', 'canonicalUnit', 'componentRole',
                 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']})
            binding = {'ruleId': rule['ruleId'], 'ruleVersion': '1', 'parameterCode': 'AR-048',
                'entityKey': 'building-1', 'reference': 'Inspector selected one staircase flight and step',
                'target': {'checkId': 'immutable-stair-origin', 'executionContentHash': 'd' * 64,
                    **{name: target[name] for name in ['observationId', 'evidenceHash', 'textArtifactHash']}},
                'contexts': contexts}
            src['scopeProofs']['FACT_BINDINGS'] = {'schemaVersion': 'matrix-fact-scopes-v1',
                'bindings': [binding], 'status': 'VERIFIED', 'reference': 'Authenticated exact-fact scope snapshot',
                'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'], 'objectId': OBJECT,
                'inputManifestHash': args['input_manifest_hash']}
    return args


def egress_height_fixture(*, kind: str = 'corridor', expected: str = '2.1', actual: str = '1.99',
                          norm_applicable=True, fact_scopes: bool = False) -> dict:
    """T18 exact original literals, with separately reviewed evacuation/basis context.

    No complete inventory or normative applicability is derived from the text.
    Fact-scope mode exercises portable targets against a different manifest.
    """
    if kind not in {'corridor', 'door'}:
        raise ValueError('unsupported egress height fixture kind')
    entry = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'AR-042')
    rule = next(r for r in entry['atomicRules'] if kind in r['ruleId'])
    basis = {'corridor': 'CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION',
             'door': 'CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD'}[kind]
    pd, rd = source('pd', 'PD', 'AR'), source('rd', 'RD', 'AR')
    sources = [pd, rd]
    arts = [artifact(src, [rule['labels'][0] + ': ' + value + ' м'])
            for src, value in zip(sources, [expected, actual])]
    key = 'ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']
    for src in sources:
        src['scopeProofs'][key].update(operatingModeKey='EVACUATION', measurementBasisKey=basis)
        norm = src['scopeProofs']['NORM_APPLICABILITY_VERIFIED']
        norm.update(applicable=norm_applicable, parameterCode='AR-042', attribute=rule['attribute'],
                    threshold=rule['threshold']['value'], canonicalUnit='m')
        if norm_applicable is None:
            norm.pop('applicable')
        for context in list(src['scopeProofs']):
            if context.startswith('RULE_SCOPE_COMPLETE:') or context == 'PARAMETER_SCOPE_COMPLETE:AR-042':
                src['scopeProofs'].pop(context)
    args = {'object_id': OBJECT, 'input_manifest_hash': MANIFEST, 'sources': sources, 'text_artifacts': arts}
    if fact_scopes:
        origin = build_matrix_execution(**args)
        new_manifest = 'c' * 64
        for src, art in zip(sources, arts):
            fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                        and o['attribute'] == rule['attribute'])
            target = derive_matrix_fact_target(fact, art)
            if target is None:
                raise AssertionError('egress fixture must have a portable original target')
            contexts = {name: {'reference': 'Inspector checked exact evacuation element and physical height basis'}
                        for name in rule['requiredContext']}
            contexts['NORM_APPLICABILITY_VERIFIED'].update({name: src['scopeProofs']['NORM_APPLICABILITY_VERIFIED'][name]
                for name in ['applicable', 'parameterCode', 'attribute', 'threshold', 'canonicalUnit']
                if name in src['scopeProofs']['NORM_APPLICABILITY_VERIFIED']})
            contexts[key].update({name: src['scopeProofs'][key][name] for name in
                ['parameterCode', 'attribute', 'canonicalUnit', 'componentRole',
                 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']})
            binding = {'ruleId': rule['ruleId'], 'ruleVersion': rule['version'], 'parameterCode': 'AR-042',
                       'entityKey': 'building-1', 'reference': 'Inspector selected exact evacuation clearance',
                       'target': {'checkId': 'immutable-origin-check', 'executionContentHash': 'd' * 64,
                                  **{name: target[name] for name in ['observationId', 'evidenceHash', 'textArtifactHash']}},
                       'contexts': contexts}
            src['scopeProofs']['FACT_BINDINGS'] = {
                'schemaVersion': 'matrix-fact-scopes-v1', 'bindings': [binding], 'status': 'VERIFIED',
                'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'],
                'objectId': OBJECT, 'inputManifestHash': new_manifest,
                'reference': 'Authenticated exact-fact inspector review snapshot'}
        args['input_manifest_hash'] = new_manifest
    return args


class MatrixEgressHeightTests(unittest.TestCase):
    @staticmethod
    def row(output, kind):
        return next(r for r in output['results'] if r['ruleId'] == 'matrix-ar-042-evacuation_' + kind + '_clear_height')

    @staticmethod
    def contexts(args, index):
        proofs = args['sources'][index]['scopeProofs']
        return proofs['FACT_BINDINGS']['bindings'][0]['contexts'] if 'FACT_BINDINGS' in proofs else proofs

    def test_two_height_atoms_are_partial_and_do_not_widen_existing_roles(self):
        registry = load_matrix_registry()
        entry = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-042')
        self.assertEqual(entry['family'], 'LOWER_BOUND')
        self.assertEqual(entry['gap'], 'SCOPED_LITERAL_HEIGHT_ONLY;DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_AND_PD_BASELINE_REVIEW_REQUIRED')
        self.assertEqual(len(entry['atomicRules']), 2)
        for kind, rule, threshold, role in zip(['corridor', 'door'], entry['atomicRules'], ['2', '1.9'],
                ['EVACUATION_CORRIDOR_CLEARANCE', 'EVACUATION_DOOR_CLEARANCE']):
            self.assertEqual(rule['ruleId'], 'matrix-ar-042-evacuation_' + kind + '_clear_height')
            self.assertEqual(rule['threshold'], {'value': threshold, 'unit': 'm', 'strict': True})
            self.assertEqual(rule['allowedStagePairs'], [['PD', 'RD']])
            self.assertEqual(rule['requiredContext'], ['NORM_APPLICABILITY_VERIFIED', 'EVACUATION_ROUTE_IDENTITY',
                'ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']])
            self.assertEqual(rule['subruleContext']['componentRole'], role)
            self.assertEqual(rule['unitAliases'], ['м', 'm', 'мм', 'mm', 'см', 'cm'])
        self.assertEqual(sum(bool(e['atomicRules']) for e in registry['entries']), 55)
        self.assertEqual(sum(len(e['atomicRules']) for e in registry['entries']), 63)
        self.assertEqual(sum(len(r['allowedStagePairs']) for e in registry['entries'] for r in e['atomicRules']), 92)

    def test_exact_height_boundaries_and_project_baseline_are_preserved(self):
        for kind, threshold, below, above in [('corridor', '2', '1.999999999999999999', '2.000000000000000001'),
                                             ('door', '1.9', '1.899999999999999999', '1.900000000000000001')]:
            for fact_scopes in [False, True]:
                for actual, status, reason in [(below, 'CANDIDATE', 'CATALOG_TRIGGER_MATCHED'),
                        (threshold, 'CLARIFICATION_REQUIRED', 'NEGATIVE_SCOPE_UNVERIFIED'),
                        (above, 'CLARIFICATION_REQUIRED', 'NEGATIVE_SCOPE_UNVERIFIED')]:
                    with self.subTest(kind=kind, actual=actual, fact_scopes=fact_scopes):
                        out = build_matrix_execution(**egress_height_fixture(kind=kind, expected=threshold,
                            actual=actual, fact_scopes=fact_scopes))
                        row = self.row(out, kind)
                        self.assertEqual((row['machineStatus'], row['reasonCode']), (status, reason))
                        self.assertEqual(row['qualified'], status == 'CANDIDATE')
                        self.assertEqual(Decimal(row['delta']), Decimal(actual) - Decimal(threshold))
                        coverage = next(c for c in out['coverage'] if c['parameterCode'] == 'AR-042')
                        self.assertEqual(coverage['executionStatus'], 'PARTIAL')
                        self.assertEqual(coverage['successfulComparisons'], int(status == 'CANDIDATE'))
                row = self.row(build_matrix_execution(**egress_height_fixture(kind=kind, expected=below,
                    actual=below, fact_scopes=fact_scopes)), kind)
                self.assertEqual((row['machineStatus'], row['reasonCode'], row['delta']),
                                 ('NOT_COMPARABLE', 'PROJECT_BASELINE_OUTSIDE_BOUND', None))

    def test_norm_applicability_must_be_explicit_and_match_selected_atom_on_both_sides(self):
        for kind in ['corridor', 'door']:
            for fact_scopes in [False, True]:
                for index in [0, 1]:
                    for field, value in [('applicable', False), ('applicable', None), ('parameterCode', 'AR-041'),
                                         ('attribute', 'EVACUATION_DOOR_CLEAR_WIDTH'), ('threshold', '2.0'),
                                         ('canonicalUnit', 'mm')]:
                        args = egress_height_fixture(kind=kind, actual='1.89', fact_scopes=fact_scopes)
                        norm = self.contexts(args, index)['NORM_APPLICABILITY_VERIFIED']
                        if value is None:
                            norm.pop(field)
                        else:
                            norm[field] = value
                        row = self.row(build_matrix_execution(**args), kind)
                        self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED')
                        self.assertFalse(row['qualified'])

    def test_all_route_atomic_contexts_and_identity_fields_are_required(self):
        for kind in ['corridor', 'door']:
            for fact_scopes in [False, True]:
                args = egress_height_fixture(kind=kind, actual='1.89', fact_scopes=fact_scopes)
                key = 'ATOMIC_SUBRULE_SCOPE:matrix-ar-042-evacuation_' + kind + '_clear_height'
                for name in ['NORM_APPLICABILITY_VERIFIED', 'EVACUATION_ROUTE_IDENTITY', key]:
                    changed = copy.deepcopy(args)
                    self.contexts(changed, 1).pop(name)
                    self.assertEqual(self.row(build_matrix_execution(**changed), kind)['reasonCode'], 'CONTEXT_UNVERIFIED:' + name)
                for field in ['componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey', 'componentRole',
                              'attribute', 'parameterCode', 'canonicalUnit']:
                    changed = copy.deepcopy(args)
                    self.contexts(changed, 1)[key][field] = 'different-component-or-basis'
                    row = self.row(build_matrix_execution(**changed), kind)
                    self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
                    self.assertFalse(row['qualified'])

    def test_matching_nominal_basis_or_non_evacuation_mode_never_qualifies(self):
        for kind in ['corridor', 'door']:
            for fact_scopes in [False, True]:
                for field, value in [('measurementBasisKey', 'NOMINAL_DOOR_LEAF'),
                                     ('measurementBasisKey', 'FLOOR_TO_FLOOR'),
                                     ('operatingModeKey', 'NORMAL_OPERATION')]:
                    args = egress_height_fixture(kind=kind, actual='1.89', fact_scopes=fact_scopes)
                    key = 'ATOMIC_SUBRULE_SCOPE:matrix-ar-042-evacuation_' + kind + '_clear_height'
                    for index in [0, 1]:
                        self.contexts(args, index)[key][field] = value
                    row = self.row(build_matrix_execution(**args), kind)
                    self.assertEqual(row['reasonCode'], 'CONTEXT_UNVERIFIED:' + key)
                    self.assertFalse(row['qualified'])

    def test_height_units_are_exact_and_equivalent_without_rounding(self):
        for kind in ['corridor', 'door']:
            for raw, unit in [('1.89', 'м'), ('1,89', 'm'), ('1890', 'мм'), ('1890', 'mm'), ('189', 'см'), ('189', 'cm')]:
                args = egress_height_fixture(kind=kind)
                text = args['text_artifacts'][1]['pages'][0]['blocks'][0]['text']
                label = text.split(':')[0]
                args['text_artifacts'][1] = artifact(args['sources'][1], [label + ': ' + raw + ' ' + unit])
                out = build_matrix_execution(**args)
                row = self.row(out, kind)
                self.assertTrue(row['qualified'])
                self.assertEqual(row['actualValue'], '1.89')
                obs = next(o for o in out['observations'] if o['id'] == row['actualObservationId'])
                self.assertEqual((obs['rawValue'], obs['rawUnit'], len(obs['evidenceFragments'])), (raw, unit, 1))
                self.assertNotIn('contextFragments', obs)

    def test_generic_heights_ranges_constraints_and_split_table_are_rejected(self):
        invalid = ['Высота дверей лифтов: 2.4 м', 'Высота коридора: 1.9 м', 'Высота помещения: 1.9 м',
                   'Высота дверного полотна: 1.8 м', 'Высота эвакуационного коридора в свету: не менее 2 м',
                   'Высота эвакуационной двери в свету: 1.8-1.9 м', 'Высота эвакуационной двери в свету: 1.8/1.9 м',
                   'Высота эвакуационной двери в свету: 1.8 или 1.9 м',
                   'Высота эвакуационной двери в свету: 1.8 м, ширина 0.9 м',
                   'Высота эвакуационной двери в свету: 1.8 М', 'Высота эвакуационной двери в свету: 1800 MM',
                   'Высота эвакуационной двери в свету: -1.8 м', 'Высота эвакуационной двери в свету: 1.8 ft']
        for line in invalid:
            args = egress_height_fixture(kind='door')
            args['text_artifacts'][1] = artifact(args['sources'][1], [line])
            out = build_matrix_execution(**args)
            self.assertFalse(any(o['stage'] == 'RD' and 'AR-042' in o['parameterCodes'] for o in out['observations']))
        for kind in ['corridor', 'door']:
            args = egress_height_fixture(kind=kind)
            label = args['text_artifacts'][1]['pages'][0]['blocks'][0]['text'].split(':')[0]
            args['text_artifacts'][1] = artifact(args['sources'][1], [], blocks=[
                {'text': label, 'bboxMilliPoints': [1000, 10000, 300000, 22000]},
                {'text': '1.89 м', 'bboxMilliPoints': [310000, 10000, 390000, 22000]}])
            out = build_matrix_execution(**args)
            self.assertFalse(any(o['stage'] == 'RD' and 'AR-042' in o['parameterCodes'] for o in out['observations']))

    def test_unknown_sources_wrong_entity_stage_section_and_ambiguous_facts_abstain(self):
        for kind in ['corridor', 'door']:
            for field, value, reason in [('revisionStatus', 'UNKNOWN', 'SOURCE_REVISION_UNRESOLVED'),
                    ('approvalStatus', 'UNKNOWN', 'SOURCE_APPROVAL_UNRESOLVED'),
                    ('sectionCode', 'KR', 'SOURCE_SECTION_UNVERIFIED'), ('linkGroupId', 'foreign', 'LINK_GROUP_MISMATCH')]:
                args = egress_height_fixture(kind=kind, actual='1.89', fact_scopes=True)
                args['sources'][1][field] = value
                out = build_matrix_execution(**args)
                self.assertEqual(len([o for o in out['observations'] if 'AR-042' in o['parameterCodes']]), 2)
                row = self.row(out, kind)
                self.assertEqual(row['reasonCode'], reason)
                self.assertFalse(row['qualified'])
            args = egress_height_fixture(kind=kind, actual='1.89', fact_scopes=True)
            args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]['entityKey'] = 'foreign-door'
            self.assertEqual(self.row(build_matrix_execution(**args), kind)['reasonCode'], 'ENTITY_SCOPE_MISMATCH')
            args = egress_height_fixture(kind=kind, actual='1.89')
            args['sources'][1]['stages'] = ['ID']
            out = build_matrix_execution(**args)
            self.assertEqual({r['comparisonVariant'] for r in out['results'] if r['parameterCode'] == 'AR-042'}, {'PD_RD'})
            self.assertFalse(self.row(out, kind)['qualified'])
            args = egress_height_fixture(kind=kind, actual='1.89')
            arts = args['text_artifacts'][1]
            arts['pages'][0]['blocks'].append(copy.deepcopy(arts['pages'][0]['blocks'][0]))
            refresh_artifact_quality(arts)
            self.assertEqual(self.row(build_matrix_execution(**args), kind)['reasonCode'], 'AMBIGUOUS_FACTS')

    def test_fact_binding_cannot_borrow_other_height_atom_or_complete_scope(self):
        args = egress_height_fixture(kind='corridor', actual='2', fact_scopes=True)
        for src in args['sources']:
            src['scopeProofs']['RULE_SCOPE_COMPLETE:matrix-ar-042-evacuation_corridor_clear_height'] = {
                **src['scopeProofs']['ENTITY_SCOPE'], 'inputManifestHash': args['input_manifest_hash']}
        out = build_matrix_execution(**args)
        self.assertEqual(self.row(out, 'corridor')['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
        args = egress_height_fixture(kind='door', actual='1.89', fact_scopes=True)
        binding = args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][0]
        binding['ruleId'] = 'matrix-ar-042-evacuation_corridor_clear_height'
        out = build_matrix_execution(**args)
        self.assertIsNone(next(o for o in out['observations'] if o['stage'] == 'RD')['entityKey'])
        self.assertFalse(self.row(out, 'door')['qualified'])

    def test_two_height_types_in_one_pdf_keep_separate_fact_rule_norm_and_component_proofs(self):
        args = egress_height_fixture(kind='corridor', actual='1.99')
        templates = {kind: egress_height_fixture(kind=kind, actual='1.89', fact_scopes=True)
                     for kind in ['corridor', 'door']}
        for src, art in zip(args['sources'], args['text_artifacts']):
            value = '2.1' if src['stages'] == ['PD'] else '1.89'
            art['pages'][0]['blocks'].append({'text': 'Высота эвакуационной двери в свету: ' + value + ' м',
                'bboxMilliPoints': [1000, 40000, 550000, 50000]})
            refresh_artifact_quality(art)
        origin = build_matrix_execution(**args)
        new_manifest = 'e' * 64
        for index, (src, art) in enumerate(zip(args['sources'], args['text_artifacts'])):
            bindings = []
            for kind in ['corridor', 'door']:
                fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                            and o['attribute'] == 'EVACUATION_' + kind.upper() + '_CLEAR_HEIGHT')
                target = derive_matrix_fact_target(fact, art)
                binding = copy.deepcopy(templates[kind]['sources'][index]['scopeProofs']['FACT_BINDINGS']['bindings'][0])
                binding['target'].update({name: target[name] for name in ['observationId', 'evidenceHash', 'textArtifactHash']})
                binding['entityKey'] = kind + '-element'
                binding['contexts']['ATOMIC_SUBRULE_SCOPE:' + binding['ruleId']]['componentKey'] = kind + '-component'
                bindings.append(binding)
            envelope = copy.deepcopy(templates['corridor']['sources'][index]['scopeProofs']['FACT_BINDINGS'])
            envelope.update(inputManifestHash=new_manifest, bindings=bindings)
            src['scopeProofs']['FACT_BINDINGS'] = envelope
        args['input_manifest_hash'] = new_manifest
        out = build_matrix_execution(**args)
        for kind in ['corridor', 'door']:
            row = self.row(out, kind)
            self.assertEqual((row['entityKey'], row['machineStatus'], row['qualified']),
                             (kind + '-element', 'CANDIDATE', True))
        door_contexts = args['sources'][1]['scopeProofs']['FACT_BINDINGS']['bindings'][1]['contexts']
        door_contexts['NORM_APPLICABILITY_VERIFIED']['attribute'] = 'EVACUATION_CORRIDOR_CLEAR_HEIGHT'
        changed = build_matrix_execution(**args)
        self.assertTrue(self.row(changed, 'corridor')['qualified'])
        self.assertEqual(self.row(changed, 'door')['reasonCode'], 'CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED')

    def test_missing_height_is_two_distinct_abstentions_without_coverage_credit(self):
        args = egress_height_fixture()
        args['text_artifacts'] = [artifact(src, ['Высота этажа: 3 м']) for src in args['sources']]
        out = build_matrix_execution(**args)
        self.assertFalse(any('AR-042' in o['parameterCodes'] for o in out['observations']))
        rows = [r for r in out['results'] if r['parameterCode'] == 'AR-042']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['machineStatus'] == 'MISSING_EVIDENCE' and not r['qualified'] for r in rows))
        coverage = next(c for c in out['coverage'] if c['parameterCode'] == 'AR-042')
        self.assertEqual((coverage['executionStatus'], coverage['successfulComparisons'], coverage['abstentions']),
                         ('PARTIAL', 0, 2))

    def test_egress_policy_cannot_widen_threshold_labels_family_contexts_or_units(self):
        mutations = [('ruleId', 'matrix-ar-042-other'), ('attribute', 'ROOM_HEIGHT'), ('canonicalUnit', 'mm'),
                     ('family', 'DECREASE'), ('labels', ['Высота помещения']), ('unitAliases', ['м', 'ft']),
                     ('expectedSections', ['PZ']), ('actualSections', ['KR']), ('valueKind', 'INTEGER'),
                     ('threshold', {'value': '1.8', 'unit': 'm', 'strict': True}),
                     ('requiredContext', ['ATOMIC_SUBRULE_SCOPE:matrix-ar-042-evacuation_corridor_clear_height']),
                     ('allowedStagePairs', [['PD', 'RD'], ['PD', 'ID']])]
        for field, value in mutations:
            with self.subTest(field=field):
                registry = load_matrix_registry()
                entry = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-042')
                entry['atomicRules'][0][field] = value
                if field == 'allowedStagePairs':
                    entry['atomicRules'][0]['comparisonVariants'] = ['PD_RD', 'PD_ID']
                with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                    build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                           sources=[], text_artifacts=[], registry=registry)
        registry = load_matrix_registry()
        foreign = next(e for e in registry['entries'] if e['parameterCode'] == 'IOS2-073')
        foreign['atomicRules'][0]['subruleContext']['componentRole'] = 'EVACUATION_CORRIDOR_CLEARANCE'
        with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
            build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[], text_artifacts=[], registry=registry)

    def test_known_egress_rule_or_attribute_cannot_strip_policy_or_fall_back_to_legacy_role(self):
        for index in [0, 1]:
            for retained_identity in ['both', 'ruleId', 'attribute']:
                with self.subTest(index=index, retained_identity=retained_identity):
                    registry = load_matrix_registry()
                    entry = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-042')
                    rule = entry['atomicRules'][index]
                    rule.pop('subruleContext')
                    rule['requiredContext'] = ['NORM_APPLICABILITY_VERIFIED', 'EVACUATION_ROUTE_IDENTITY']
                    if retained_identity == 'ruleId':
                        rule['attribute'] = 'ROOM_HEIGHT'
                    elif retained_identity == 'attribute':
                        rule['ruleId'] = 'matrix-unrelated-height'
                    with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                        build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                               sources=[], text_artifacts=[], registry=registry)
            registry = load_matrix_registry()
            entry = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-042')
            rule = entry['atomicRules'][index]
            rule['subruleContext']['componentRole'] = 'POTABLE_WATER_PUMP'
            rule.update(family='DECREASE', threshold=None,
                        requiredContext=['ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']])
            with self.assertRaisesRegex(ValueError, 'atomic subrule context invalid'):
                build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                       sources=[], text_artifacts=[], registry=registry)


class MatrixStairDimensionsTests(unittest.TestCase):
    @staticmethod
    def row(output, kind):
        return next(r for r in output['results'] if r['ruleId'] == 'matrix-ar-048-stair_' + kind +
                    ('_depth' if kind == 'tread' else '_height'))

    @staticmethod
    def contexts(args, index):
        proofs = args['sources'][index]['scopeProofs']
        return proofs['FACT_BINDINGS']['bindings'][0]['contexts'] if 'FACT_BINDINGS' in proofs else proofs

    def test_catalog_installs_two_distinct_families_with_honest_remaining_gap(self):
        registry = load_matrix_registry()
        entry = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-048')
        self.assertIsNone(entry['family'])
        self.assertEqual(len(entry['atomicRules']), 2)
        self.assertEqual(entry['gap'], 'SCOPED_LITERAL_STAIR_DIMENSIONS_ONLY;STEP_COUNT_DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_PD_BASELINE_AND_ID_REQUIRED')
        self.assertEqual([(r['family'], r['threshold']['value']) for r in entry['atomicRules']],
                         [('LOWER_BOUND', '300'), ('UPPER_BOUND', '150')])

    def test_original_two_line_prose_emits_two_unqualified_facts_with_exact_fragments(self):
        src = source('public-pd', 'PD', 'OTHER', approved=False)
        src['scopeProofs'] = {}
        art = stair_prose_artifact(src)
        output = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                       sources=[src], text_artifacts=[art])
        facts = [o for o in output['observations'] if 'AR-048' in o['parameterCodes']]
        self.assertEqual({(o['attribute'], o['value'], o['rawValue'], o['rawUnit']) for o in facts},
                         {('STAIR_TREAD_DEPTH', '300', '0,3', 'м'), ('STAIR_RISER_HEIGHT', '150', '0,15', 'м')})
        for fact in facts:
            self.assertEqual([f['blockId'] for f in fact['evidenceFragments']], ['15:0', '16:0'])
            self.assertIsNone(fact['entityKey'])
            self.assertNotIn('contextFragments', fact)
            self.assertNotIn('TABLE_CONTEXT_UNVERIFIED', fact['sourceFlags'])
        self.assertTrue(all(not r['qualified'] for r in output['results'] if r['parameterCode'] == 'AR-048'))

    def test_both_families_exact_boundaries_equality_and_outside_pd_baselines(self):
        for kind, bound, positive, safe, outside in [
                ('tread', '300', '299.999999999999999999', '300.000000000000000001', '299.9'),
                ('riser', '150', '150.000000000000000001', '149.999999999999999999', '150.1')]:
            for fact_scopes in [False, True]:
                for actual, triggered in [(positive, True), (bound, False), (safe, False)]:
                    with self.subTest(kind=kind, actual=actual, fact_scopes=fact_scopes):
                        row = self.row(build_matrix_execution(**stair_dimensions_fixture(
                            kind=kind, expected=bound, actual=actual, fact_scopes=fact_scopes)), kind)
                        self.assertEqual(row['qualified'], triggered)
                        self.assertEqual(row['machineStatus'], 'CANDIDATE' if triggered else 'CLARIFICATION_REQUIRED')
                        self.assertEqual(Decimal(row['delta']), Decimal(actual) - Decimal(bound))
                        if not triggered:
                            self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')
                row = self.row(build_matrix_execution(**stair_dimensions_fixture(kind=kind,
                    expected=outside, actual=positive, fact_scopes=fact_scopes)), kind)
                self.assertEqual((row['machineStatus'], row['reasonCode'], row['qualified']),
                                 ('NOT_COMPARABLE', 'PROJECT_BASELINE_OUTSIDE_BOUND', False))

    def test_six_exact_unit_aliases_convert_without_rounding_and_zero_is_not_hidden(self):
        for kind, expected, actual in [('tread', '300', '299'), ('riser', '150', '151')]:
            for unit, divisor in [('мм', 1), ('mm', 1), ('м', 1000), ('m', 1000), ('см', 10), ('cm', 10)]:
                with self.subTest(kind=kind, unit=unit):
                    args = stair_dimensions_fixture(kind=kind)
                    label = args['text_artifacts'][0]['pages'][0]['blocks'][0]['text'].split(':')[0]
                    args['text_artifacts'] = [artifact(src, [label + ': ' + str(Decimal(value) / divisor) + ' ' + unit])
                                             for src, value in zip(args['sources'], [expected, actual])]
                    self.assertTrue(self.row(build_matrix_execution(**args), kind)['qualified'])
        zero = self.row(build_matrix_execution(**stair_dimensions_fixture(actual='0')), 'tread')
        self.assertEqual((zero['machineStatus'], zero['actualValue'], zero['delta']), ('CANDIDATE', '0', '-300'))

    def test_norm_proof_matches_exact_selected_attribute_and_threshold_on_each_side(self):
        changes = [('applicable', False), ('applicable', None), ('parameterCode', 'AR-042'),
                   ('attribute', 'OTHER_HEIGHT'), ('threshold', '0.3'), ('canonicalUnit', 'm')]
        for kind in ['tread', 'riser']:
            for scopes in [False, True]:
                for side in [0, 1]:
                    for field, value in changes:
                        with self.subTest(kind=kind, scopes=scopes, side=side, field=field):
                            args = stair_dimensions_fixture(kind=kind, fact_scopes=scopes)
                            proof = self.contexts(args, side)['NORM_APPLICABILITY_VERIFIED']
                            if value is None:
                                proof.pop(field)
                            else:
                                proof[field] = value
                            self.assertFalse(self.row(build_matrix_execution(**args), kind)['qualified'])

    def test_all_step_scope_contexts_and_matching_identities_are_required(self):
        for kind in ['tread', 'riser']:
            rule_id = 'matrix-ar-048-stair_' + kind + ('_depth' if kind == 'tread' else '_height')
            key = 'ATOMIC_SUBRULE_SCOPE:' + rule_id
            for scopes in [False, True]:
                for missing in ['STAIR_FLIGHT_STEP_IDENTITY', key]:
                    args = stair_dimensions_fixture(kind=kind, fact_scopes=scopes)
                    self.contexts(args, 1).pop(missing)
                    self.assertFalse(self.row(build_matrix_execution(**args), kind)['qualified'])
                for field in ['componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey', 'componentRole']:
                    with self.subTest(kind=kind, scopes=scopes, field=field):
                        args = stair_dimensions_fixture(kind=kind, fact_scopes=scopes)
                        self.contexts(args, 1)[key][field] += '-other'
                        self.assertFalse(self.row(build_matrix_execution(**args), kind)['qualified'])
                for field, wrong in [('operatingModeKey', 'NORMAL'), ('measurementBasisKey', 'NOMINAL_DRAWING_SIZE')]:
                    args = stair_dimensions_fixture(kind=kind, fact_scopes=scopes)
                    for side in [0, 1]:
                        self.contexts(args, side)[key][field] = wrong
                    self.assertFalse(self.row(build_matrix_execution(**args), kind)['qualified'])

    def test_unknown_section_stage_entity_ambiguity_and_missing_sources_cannot_qualify(self):
        for kind in ['tread', 'riser']:
            for mutation in ['unknown', 'section', 'stage', 'entity', 'duplicate', 'missing']:
                with self.subTest(kind=kind, mutation=mutation):
                    args = stair_dimensions_fixture(kind=kind)
                    if mutation == 'unknown':
                        args['sources'][1].update(revisionStatus='UNKNOWN', approvalStatus='UNKNOWN')
                    elif mutation == 'section':
                        args['sources'][1]['sectionCode'] = 'OTHER'
                    elif mutation == 'stage':
                        args['sources'][1]['stages'] = ['ID']
                    elif mutation == 'entity':
                        args['sources'][1]['scopeProofs']['ENTITY_SCOPE']['entityKey'] = 'other-flight'
                    elif mutation == 'duplicate':
                        block = copy.deepcopy(args['text_artifacts'][1]['pages'][0]['blocks'][0])
                        block['bboxMilliPoints'] = [1000, 50000, 550000, 60000]
                        args['text_artifacts'][1]['pages'][0]['blocks'].append(block)
                        refresh_artifact_quality(args['text_artifacts'][1])
                    else:
                        args['text_artifacts'][1] = artifact(args['sources'][1], [])
                    self.assertFalse(any(r['qualified'] for r in build_matrix_execution(**args)['results']
                                         if r['parameterCode'] == 'AR-048'))

    def test_literal_ranges_constraints_thousands_decoys_and_table_cells_are_not_facts(self):
        for kind in ['tread', 'riser']:
            args = stair_dimensions_fixture(kind=kind)
            src = args['sources'][0]
            label = args['text_artifacts'][0]['pages'][0]['blocks'][0]['text'].split(':')[0]
            for value in ['300-310 мм', 'не менее 300 мм', '300 или 310 мм', '1 000 мм',
                          '300 ММ', '0.3 М', '300±5 мм', '300 кВт', '300 мм дополнительный текст']:
                with self.subTest(kind=kind, value=value):
                    art = artifact(src, [label + ': ' + value])
                    out = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                                sources=[src], text_artifacts=[art])
                    self.assertFalse(any('AR-048' in o['parameterCodes'] for o in out['observations']))
            art = artifact(src, [], blocks=[{'text': label, 'bboxMilliPoints': [1000, 20000, 300000, 30000]},
                                            {'text': '300 мм', 'bboxMilliPoints': [310000, 20000, 350000, 30000]}])
            out = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src], text_artifacts=[art])
            self.assertFalse(any('AR-048' in o['parameterCodes'] for o in out['observations']))

    @staticmethod
    def move(block, *, dx=0, dy=0):
        for box in [block['bboxMilliPoints'], *block.get('lineBboxesMilliPoints', [])]:
            box[0] += dx; box[2] += dx; box[1] += dy; box[3] += dy

    def prose_output(self, mutate=None, stage='PD'):
        src = source('public-pd', stage, 'OTHER', approved=False)
        src['scopeProofs'] = {}
        art = stair_prose_artifact(src)
        if mutate:
            mutate(art['pages'][0]['blocks'])
            refresh_artifact_quality(art)
        return build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                                      sources=[src], text_artifacts=[art])

    def test_prose_rejects_unknown_suffixes_limits_alternatives_and_other_dimensions(self):
        for index, text in [(15, 'Ширина проступей ступеней предусмотрена не менее 0,3 м, а высота подъема'),
                            (15, 'Ширина проступей ступеней предусмотрена 0,28-0,3 м, а высота подъема'),
                            (15, 'Ширина проступей ступеней предусмотрена 1 000 мм, а высота подъема'),
                            (15, 'Ширина проступей ступеней предусмотрена 0,3 М, а высота подъема'),
                            (16, 'ступеней - 0,15 или 0,17м.'), (16, 'ступеней - не более 0,15м.'),
                            (16, 'ступеней - 0,15м. Уклоны лестниц - 1:3.'),
                            (16, 'ступеней - 0,15м. Или другой вариант 0,17м.'),
                            (16, 'ступеней - 0,15.'), (16, 'глубину 0,3м (уклон маршей 1:2).')]:
            with self.subTest(text=text):
                def mutate(blocks):
                    blocks[index]['text'] = text
                out = self.prose_output(mutate)
                self.assertFalse(any('AR-048' in o['parameterCodes'] for o in out['observations']))

    def test_competing_coarse_and_intervening_geometry_rejects_the_whole_pair(self):
        cases = [lambda b: b.append(copy.deepcopy(b[15])), lambda b: b.append(copy.deepcopy(b[16])),
                 lambda b: b.append({'text': 'другая строка', 'bboxMilliPoints': [100000, 341000, 200000, 345000]}),
                 lambda b: b.append({'text': 'другая\nстрока', 'bboxMilliPoints': [100000, 341000, 200000, 345000]}),
                 lambda b: self.move(b[16], dx=2001), lambda b: self.move(b[16], dy=10082),
                 lambda b: self.move(b[16], dy=-7920)]
        for index, mutate in enumerate(cases):
            with self.subTest(index=index):
                self.assertFalse(any('AR-048' in o['parameterCodes'] for o in self.prose_output(mutate)['observations']))
        def coarse(blocks):
            blocks[15].update(text=blocks[15]['text'] + '\n' + blocks[16]['text'],
                bboxMilliPoints=[85095, 325214, 537769, 363375])
            blocks[15].pop('lineBboxesMilliPoints', None)
            blocks.pop(16)
        self.assertFalse(any('AR-048' in o['parameterCodes'] for o in self.prose_output(coarse)['observations']))

    def test_prose_geometry_exact_boundaries_and_reordered_source_array(self):
        for dx, dy, accepted in [(2000, 0, True), (-2000, 0, True), (2001, 0, False),
                                  (0, 10081, True), (0, 10082, False),
                                  (0, -7919, True), (0, -7920, False)]:
            with self.subTest(dx=dx, dy=dy):
                out = self.prose_output(lambda b: self.move(b[16], dx=dx, dy=dy))
                self.assertEqual(sum('AR-048' in o['parameterCodes'] for o in out['observations']), 2 if accepted else 0)
        for height_change, accepted in [(1000, True), (-1000, True), (1001, False), (-1001, False)]:
            with self.subTest(height_change=height_change):
                def change_height(blocks):
                    block = blocks[16]
                    for box in [block['bboxMilliPoints'], *block.get('lineBboxesMilliPoints', [])]:
                        box[1] -= height_change
                out = self.prose_output(change_height)
                self.assertEqual(sum('AR-048' in o['parameterCodes'] for o in out['observations']), 2 if accepted else 0)
        self.assertEqual(sum('AR-048' in o['parameterCodes'] for o in self.prose_output(lambda b: b.reverse())['observations']), 2)
        for stage in ['ID', 'UNRESOLVED']:
            # UNRESOLVED is produced from a mixed-stage source, not a manifest enum.
            if stage == 'UNRESOLVED':
                src = source('public-pd', 'PD', 'OTHER', approved=False); src['stages'] = ['PD', 'RD']
                out = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST,
                    sources=[src], text_artifacts=[stair_prose_artifact(src)])
            else:
                out = self.prose_output(stage=stage)
            self.assertFalse(any('AR-048' in o['parameterCodes'] for o in out['observations']))
        self.assertEqual(self.prose_output(), self.prose_output())

    def test_f0125_compound_bounds_and_zone_dimensions_are_not_reinterpreted(self):
        src = source('other-pd', 'PD', 'OTHER', approved=False)
        lines = ['и высоте подъема ступеней. Ширина проступей лестниц на путях движения инвалидов',
                 'предусмотрена не менее 0,28 м, а высота подъема ступеней - не более 0,17 м. (фактически для',
                 'подземной части 280 х 170 мм, для надземной части 280 х 150 мм)']
        out = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src],
                                     text_artifacts=[artifact(src, lines)])
        self.assertFalse(any('AR-048' in o['parameterCodes'] for o in out['observations']))

    def test_selected_prose_fact_binding_cannot_qualify_other_attribute_or_complete_negative(self):
        args = stair_dimensions_fixture(fact_scopes=True)
        args['text_artifacts'][0] = stair_prose_artifact(args['sources'][0])
        origin = build_matrix_execution(**args)
        fact = next(o for o in origin['observations'] if o['sourceFileId'] == 'pd' and o['attribute'] == 'STAIR_TREAD_DEPTH')
        target = derive_matrix_fact_target(fact, args['text_artifacts'][0])
        binding = args['sources'][0]['scopeProofs']['FACT_BINDINGS']['bindings'][0]
        binding['target'].update({k: target[k] for k in ['observationId', 'evidenceHash', 'textArtifactHash']})
        out = build_matrix_execution(**args)
        self.assertTrue(self.row(out, 'tread')['qualified'])
        self.assertFalse(self.row(out, 'riser')['qualified'])
        self.assertIsNone(next(o for o in out['observations'] if o['attribute'] == 'STAIR_RISER_HEIGHT')['entityKey'])
        coverage = next(c for c in out['coverage'] if c['parameterCode'] == 'AR-048')
        self.assertEqual(coverage['executionStatus'], 'PARTIAL')
        self.assertEqual(coverage['successfulComparisons'], 1)
        binding['ruleId'] = 'matrix-ar-048-stair_riser_height'
        self.assertFalse(self.row(build_matrix_execution(**args), 'tread')['qualified'])
        for kind, bound in [('tread', '300'), ('riser', '150')]:
            row = self.row(build_matrix_execution(**stair_dimensions_fixture(kind=kind, actual=bound, fact_scopes=True)), kind)
            self.assertEqual(row['reasonCode'], 'NEGATIVE_SCOPE_UNVERIFIED')

    def test_stair_policy_tamper_and_removing_both_policy_and_atomic_gate_fail_closed(self):
        changes = [('labels', ['Глубина ступени']), ('unitAliases', ['мм', 'ММ']), ('family', 'DECREASE'),
                   ('threshold', {'value': '280', 'unit': 'mm', 'strict': True}), ('actualSections', ['OTHER']),
                   ('valueKind', 'INTEGER'), ('allowedStagePairs', [['PD', 'RD'], ['PD', 'ID']]),
                   ('requiredContext', ['NORM_APPLICABILITY_VERIFIED', 'STAIR_FLIGHT_STEP_IDENTITY'])]
        for index in [0, 1]:
            for field, value in changes:
                with self.subTest(index=index, field=field):
                    registry = load_matrix_registry()
                    rule = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-048')['atomicRules'][index]
                    rule[field] = value
                    if field == 'allowedStagePairs':
                        rule['comparisonVariants'] = ['PD_RD', 'PD_ID']
                    with self.assertRaises(ValueError):
                        build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[], text_artifacts=[], registry=registry)
            for retained in ['both', 'ruleId', 'attribute', 'legacy-role']:
                registry = load_matrix_registry()
                rule = next(e for e in registry['entries'] if e['parameterCode'] == 'AR-048')['atomicRules'][index]
                if retained == 'legacy-role':
                    rule['subruleContext']['componentRole'] = 'POTABLE_WATER_PUMP'
                    rule.update(family='DECREASE', threshold=None, requiredContext=['ATOMIC_SUBRULE_SCOPE:' + rule['ruleId']])
                else:
                    rule.pop('subruleContext')
                    rule['requiredContext'] = ['NORM_APPLICABILITY_VERIFIED', 'STAIR_FLIGHT_STEP_IDENTITY']
                    if retained == 'ruleId': rule['attribute'] = 'OTHER_DIMENSION'
                    if retained == 'attribute': rule['ruleId'] = 'matrix-other-dimension'
                with self.subTest(index=index, retained=retained), self.assertRaises(ValueError):
                    build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[], text_artifacts=[], registry=registry)


FENCE_RULE = 'matrix-spzu-036-territory_fence_height'


def fence_prose_artifact(src: dict) -> dict:
    public = json.loads((Path(__file__).parent / 'fixtures/pd-territory-fence-F0154-p14.json').read_text())
    value = artifact(src, [])
    value['pages'] = [copy.deepcopy(public['page'])]
    return refresh_artifact_quality(value)


def fence_height_fixture(*, expected='2.5', actual='2.4', fact_scopes=False) -> dict:
    sources = [source('pd', 'PD', 'GP'), source('rd', 'RD', 'GP')]
    arts = [artifact(src, ['Высота ограждения территории: ' + number + ' м'])
            for src, number in zip(sources, [expected, actual])]
    rule = next(e for e in load_matrix_registry()['entries'] if e['parameterCode'] == 'SPZU-036')['atomicRules'][0]
    for src in sources:
        for key in list(src['scopeProofs']):
            if key.startswith('RULE_SCOPE_COMPLETE:') or key == 'PARAMETER_SCOPE_COMPLETE:SPZU-036':
                src['scopeProofs'].pop(key)
    args = {'object_id': OBJECT, 'input_manifest_hash': MANIFEST, 'sources': sources, 'text_artifacts': arts}
    if fact_scopes:
        origin = build_matrix_execution(**args)
        args['input_manifest_hash'] = 'c' * 64
        for src, art in zip(sources, arts):
            fact = next(o for o in origin['observations'] if o['sourceFileId'] == src['sourceFileId']
                        and o['attribute'] == 'TERRITORY_FENCE_HEIGHT')
            target = derive_matrix_fact_target(fact, art)
            assert target is not None
            contexts = {key: {'reference': 'Inspector checked the original fence type, segment and height'}
                        for key in rule['requiredContext']}
            contexts['APPROVED_CHANGE_STATUS']['approvedChangePresent'] = False
            key = 'ATOMIC_SUBRULE_SCOPE:' + FENCE_RULE
            contexts[key].update({name: src['scopeProofs'][key][name] for name in
                ['parameterCode', 'attribute', 'canonicalUnit', 'componentRole',
                 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']})
            binding = {'ruleId': FENCE_RULE, 'ruleVersion': '1', 'parameterCode': 'SPZU-036',
                'entityKey': 'building-1', 'reference': 'Inspector selected one physical territory fence segment',
                'target': {'checkId': 'immutable-fence-origin', 'executionContentHash': 'd' * 64,
                    **{name: target[name] for name in ['observationId', 'evidenceHash', 'textArtifactHash']}},
                'contexts': contexts}
            src['scopeProofs']['FACT_BINDINGS'] = {'schemaVersion': 'matrix-fact-scopes-v1',
                'bindings': [binding], 'status': 'VERIFIED', 'reference': 'Authenticated exact-fact scope snapshot',
                'sourceFileId': src['sourceFileId'], 'sourceSha256': src['sha256'], 'objectId': OBJECT,
                'inputManifestHash': args['input_manifest_hash']}
    return args


class MatrixTerritoryFenceTests(unittest.TestCase):
    @staticmethod
    def row(args):
        return next(r for r in build_matrix_execution(**args)['results'] if r['ruleId'] == FENCE_RULE)

    @staticmethod
    def contexts(args, index):
        proofs = args['sources'][index]['scopeProofs']
        return proofs['FACT_BINDINGS']['bindings'][0]['contexts'] if 'FACT_BINDINGS' in proofs else proofs

    def test_public_original_prose_one_height_without_review_or_segment_identity(self):
        src = source('public', 'PD', 'GP', approved=False);src['scopeProofs'] = {}
        art = fence_prose_artifact(src)
        out = build_matrix_execution(object_id=OBJECT, input_manifest_hash=MANIFEST, sources=[src], text_artifacts=[art])
        fact, = [o for o in out['observations'] if o['attribute'] == 'TERRITORY_FENCE_HEIGHT']
        self.assertEqual((fact['value'], fact['unit'], fact['rawValue'], fact['rawUnit']), ('2.5', 'm', '2,5', 'м'))
        self.assertEqual([f['blockId'] for f in fact['evidenceFragments']], ['17:0', '17:1'])
        self.assertIsNone(fact['entityKey']);self.assertNotIn('contextFragments', fact)
        self.assertNotIn('TABLE_CONTEXT_UNVERIFIED', fact['sourceFlags'])
        self.assertTrue(all(not r['qualified'] for r in out['results']))

    def test_decrease_precise_equality_increase_and_no_complete_inventory(self):
        for scopes in [False, True]:
            for actual, triggered in [('2.499999999999999999', True), ('2.5', False), ('2.500000000000000001', False)]:
                with self.subTest(scopes=scopes, actual=actual):
                    row = self.row(fence_height_fixture(actual=actual, fact_scopes=scopes))
                    self.assertEqual(row['qualified'], triggered)
                    self.assertEqual(row['machineStatus'], 'CANDIDATE' if triggered else 'CLARIFICATION_REQUIRED')
                    self.assertNotIn('calibratedProbability', row)
                    self.assertEqual(Decimal(row['delta']), Decimal(actual) - Decimal('2.5'))

    def test_each_required_context_is_required_on_each_side(self):
        for scopes in [False, True]:
            for index in [0, 1]:
                for key in ['APPROVED_CHANGE_STATUS', 'FENCE_TYPE_IDENTITY', 'ZONE_IDENTITY', 'ATOMIC_SUBRULE_SCOPE:' + FENCE_RULE]:
                    args = fence_height_fixture(fact_scopes=scopes);self.contexts(args, index).pop(key)
                    with self.subTest(scopes=scopes, index=index, key=key): self.assertFalse(self.row(args)['qualified'])

    def test_context_identity_and_change_cannot_be_assumed(self):
        changes = [('componentRole', 'GUARDRAIL'), ('componentKey', 'different-segment'), ('zoneKey', 'different-zone'),
                   ('operatingModeKey', 'ROOF_EDGE'), ('measurementBasisKey', 'NOMINAL_PANEL_HEIGHT')]
        for scopes in [False, True]:
            for index in [0, 1]:
                for field, value in changes:
                    args = fence_height_fixture(fact_scopes=scopes)
                    self.contexts(args,index)['ATOMIC_SUBRULE_SCOPE:' + FENCE_RULE][field] = value
                    with self.subTest(scopes=scopes,index=index,field=field): self.assertFalse(self.row(args)['qualified'])
                for value in [True]:
                    args = fence_height_fixture(fact_scopes=scopes)
                    self.contexts(args,index)['APPROVED_CHANGE_STATUS']['approvedChangePresent'] = value
                    self.assertFalse(self.row(args)['qualified'])

    def test_literal_alternatives_ranges_thousands_generic_railing_and_units_rejected(self):
        texts = ['Высота ограждения территории: 2-3 м', 'Высота ограждения территории: 2.5/2.4 м',
                 'Высота ограждения территории: не менее 2.5 м', 'Высота ограждения территории: 2 500 мм',
                 'Высота ограждения территории: 2.5 М', 'Высота ограждения территории: м 2.5',
                 'Высота лестничного ограждения: 2.5 м', 'Высота ограждения котлована: 2.5 м']
        for text in texts:
            args = fence_height_fixture();args['text_artifacts'][0] = artifact(args['sources'][0], [text])
            with self.subTest(text=text): self.assertFalse(self.row(args)['qualified'])

    def test_prose_requires_pd_original_same_block_adjacent_exact_lines(self):
        mutations = ['RD', 'split-block', 'coarse', 'other-row', 'duplicate-anchor', 'bad-anchor',
                     'height-range', 'length-range', 'capital-unit', 'negative-indent', 'huge-indent', 'wrong-right-edge', 'gap']
        for case in mutations:
            src=source('public', 'RD' if case=='RD' else 'PD', 'GP', approved=False);src['scopeProofs']={}
            art=fence_prose_artifact(src);page=art['pages'][0];b=page['blocks'][17]
            if case=='split-block':
                lines=b['text'].splitlines();boxes=b['lineBboxesMilliPoints'];page['blocks'][17:18]=[
                    {'text': t, 'bboxMilliPoints': box} for t,box in zip(lines,boxes)]
            elif case=='coarse': b.pop('lineBboxesMilliPoints')
            elif case=='other-row': page['blocks'].append({'text':'Другое значение','bboxMilliPoints':[200000,220000,300000,235000]})
            elif case=='duplicate-anchor': page['blocks'].append({'text':'По границе территории объекта неизвестно','bboxMilliPoints':[1000,1000,300000,15000]})
            elif case=='bad-anchor': b['text']=b['text'].replace('предусмотрена','не предусмотрена')
            elif case=='height-range': b['text']=b['text'].replace('2,5 м','2,5-3 м')
            elif case=='length-range': b['text']=b['text'].replace('480,0 м','480-490 м')
            elif case=='capital-unit': b['text']=b['text'].replace('2,5 м','2,5 М')
            elif case=='negative-indent':
                b['lineBboxesMilliPoints'][0][0]=98000;b['bboxMilliPoints'][0]=98000
            elif case=='huge-indent': b['lineBboxesMilliPoints'][0][0]=140000
            elif case=='wrong-right-edge': b['lineBboxesMilliPoints'][0][2]-=3000
            elif case=='gap':
                b['lineBboxesMilliPoints'][0][1:4:2]=[250000,263980];b['bboxMilliPoints'][3]=263980
            refresh_artifact_quality(art)
            out=build_matrix_execution(object_id=OBJECT,input_manifest_hash=MANIFEST,sources=[src],text_artifacts=[art])
            with self.subTest(case=case): self.assertFalse([o for o in out['observations'] if o['attribute']=='TERRITORY_FENCE_HEIGHT'])

    def test_registry_cannot_remove_typed_policy_or_widen_to_type_id_or_unscoped_decrease(self):
        for field, value in [('family','DIFFERENT'),('threshold',{'value':'2.5','unit':'m','strict':True}),
                ('requiredContext',[]),('actualSections',['OTHER']),('labels',['Высота ограждения']),
                ('allowedStagePairs',[['PD','RD'],['RD','ID']])]:
            registry=load_matrix_registry();r=next(e for e in registry['entries'] if e['parameterCode']=='SPZU-036')['atomicRules'][0]
            r[field]=value
            if field=='allowedStagePairs': r['comparisonVariants']=['PD_RD','RD_ID']
            with self.subTest(field=field),self.assertRaises(ValueError):
                build_matrix_execution(object_id=OBJECT,input_manifest_hash=MANIFEST,sources=[],text_artifacts=[],registry=registry)
        for retained in ['both','ruleId','attribute','legacy-role']:
            registry=load_matrix_registry();r=next(e for e in registry['entries'] if e['parameterCode']=='SPZU-036')['atomicRules'][0]
            if retained=='legacy-role': r['subruleContext']['componentRole']='POTABLE_WATER_PUMP'
            else:
                r.pop('subruleContext');r['requiredContext']=[]
                if retained=='ruleId': r['attribute']='OTHER_HEIGHT'
                if retained=='attribute': r['ruleId']='matrix-other-height'
            with self.subTest(retained=retained),self.assertRaises(ValueError):
                build_matrix_execution(object_id=OBJECT,input_manifest_hash=MANIFEST,sources=[],text_artifacts=[],registry=registry)
