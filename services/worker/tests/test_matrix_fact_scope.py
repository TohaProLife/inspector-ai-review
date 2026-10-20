import hashlib
import json
import math
import unittest

from inspector_worker.matrix_fact_scope import (
    derive_matrix_fact_selector,
    derive_matrix_fact_target,
    portable_evidence_hash,
    portable_evidence_json,
)


class PortableMatrixFactEvidenceTests(unittest.TestCase):
    def test_typed_tree_preserves_numbers_and_prevents_tag_collisions(self):
        self.assertEqual(portable_evidence_json(-0.0), '["$number","8000000000000000"]')
        self.assertEqual(portable_evidence_json(0), '["$number","0000000000000000"]')
        self.assertEqual(portable_evidence_json(1), '["$number","3ff0000000000000"]')
        self.assertEqual(portable_evidence_hash(1), portable_evidence_hash(1.0))
        self.assertNotEqual(portable_evidence_hash(-0.0), portable_evidence_hash(0))
        self.assertNotEqual(portable_evidence_hash(1), portable_evidence_hash(['$number', '3ff0000000000000']))
        self.assertNotEqual(portable_evidence_hash([]), portable_evidence_hash(['$array', []]))
        self.assertNotEqual(portable_evidence_hash({}), portable_evidence_hash(['$object', []]))

    def test_utf8_key_order_unicode_and_exponent_golden(self):
        value = {'\U0001f600': '\u2028', '\ue000': 'Чертёж', 'я': 1e-7, 'z': 1, 'A': -0.0}
        canonical = ('["$object",[["A",["$number","8000000000000000"]],'
                     '["z",["$number","3ff0000000000000"]],'
                     '["я",["$number","3e7ad7f29abcaf48"]],'
                     '["\ue000","Чертёж"],["😀","\u2028"]]]')
        self.assertEqual(portable_evidence_json(value), canonical)
        self.assertEqual(portable_evidence_hash(value), hashlib.sha256(canonical.encode('utf-8')).hexdigest())
        self.assertEqual(portable_evidence_hash(value), portable_evidence_hash(dict(reversed(list(value.items())))))

    def test_rejects_non_json_values_non_finite_numbers_and_surrogates(self):
        cyclic = []
        cyclic.append(cyclic)
        for invalid in [math.nan, math.inf, -math.inf, 10 ** 400, (1, 2), {1: 'key'}, object(), cyclic,
                        '\ud800', {'\udfff': 'invalid'}]:
            with self.subTest(invalid=type(invalid)):
                with self.assertRaises(TypeError):
                    portable_evidence_hash(invalid)

    def test_scalar_boundaries_and_original_json_types_remain_distinct(self):
        values = [None, False, True, '', '1', 1, [], {}]
        self.assertEqual(len(set(map(portable_evidence_hash, values))), len(values))
        self.assertEqual(json.loads(portable_evidence_json({'ключ': '😀'})), ['$object', [['ключ', '😀']]])

    def test_selector_uses_exact_raw_evidence_and_entire_artifact(self):
        artifact = {'schemaVersion': 'document-text-v2', 'sourceFileId': 'source', 'inputSha256': 'a' * 64,
                    'coordinateSystem': 'PDF_BOTTOM_LEFT_MILLI_POINTS', 'pages': [
                        {'pageNumber': 1, 'widthMilliPoints': 800000, 'heightMilliPoints': 800000,
                         'blocks': [{'text': 'Класс бетона: В30', 'bboxMilliPoints': [0, 400000, 400000, 500000]}]}]}
        box = {'x': 0.0, 'y': .375, 'width': .5, 'height': .125}
        fact = {'id': 'b' * 64, 'sourceFileId': 'source', 'sourceSha256': 'a' * 64, 'stage': 'PD',
                'pageNumber': 1, 'blockId': '0:0', 'attribute': 'CONCRETE_CLASS', 'value': 'В30', 'unit': 'B_CLASS',
                'rawValue': 'В30', 'rawUnit': 'B_CLASS', 'rawText': 'Класс бетона: В30', 'method': 'TEXT_LAYER',
                'extractorVersion': 'matrix-text-facts-v1', 'bbox': box,
                'evidenceFragments': [{'blockId': '0:0', 'rawText': 'Класс бетона: В30', 'bbox': box}],
                'entityKey': None, 'inputManifestHash': 'c' * 64, 'sourceFlags': ['TABLE_CONTEXT_UNVERIFIED']}
        selector = derive_matrix_fact_selector(fact, artifact)
        target = derive_matrix_fact_target(fact, artifact)
        self.assertIsNotNone(selector)
        self.assertIsNotNone(target)
        self.assertNotIn('contextFragments', selector)
        self.assertNotIn('fragmentsHash', target)
        self.assertEqual(target['textArtifactHash'], portable_evidence_hash(artifact))
        self.assertEqual(target, derive_matrix_fact_target({**fact, 'entityKey': 'reviewed', 'sourceFlags': [],
                                                           'inputManifestHash': 'd' * 64}, artifact))
        self.assertNotEqual(target, derive_matrix_fact_target({**fact, 'rawUnit': 'other'}, artifact))
        self.assertNotEqual(target, derive_matrix_fact_target(fact, {**artifact, 'frame': {'rotate': 90}}))
        self.assertIsNone(derive_matrix_fact_target({**fact, 'sourceSha256': 'e' * 64}, artifact))
        self.assertIsNone(derive_matrix_fact_target({**fact, 'bbox': {**box, 'x': .1}}, artifact))
        self.assertIsNone(derive_matrix_fact_target({**fact, 'contextFragments': []}, artifact))


if __name__ == '__main__':
    unittest.main()
