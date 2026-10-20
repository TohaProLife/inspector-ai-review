"""Owner security expectations fixed before first implementation invocation."""
import copy
import json
import unittest
from pathlib import Path
from inspector_worker.steel_comparison import compare_kr056_steel_declarations, project_steel_comparison_scope_decision

_ROOT = Path(__file__).resolve().parents[3]
_CASES = json.loads((_ROOT/'fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json').read_text())['cases']
def case(name):
    return copy.deepcopy(next(c['input'] for c in _CASES if c['name'] == name))

class SteelComparisonOwnerTests(unittest.TestCase):
    def test_retained_stale_decision_precedes_missing_identity(self):
        value = case('stale-pair-review-hash')
        value['identity']['memberKey'] = 'UNRELATED-SELECTED-MEMBER'
        self.assertEqual(compare_kr056_steel_declarations(value)['reasonCode'], 'APPLICABILITY_DECISION_UNVERIFIED')

    def test_retained_forged_claim_precedes_missing_identity(self):
        value = case('rehashed-forged-declaration')
        value['identity']['memberKey'] = 'UNRELATED-SELECTED-MEMBER'
        self.assertEqual(compare_kr056_steel_declarations(value)['reasonCode'], 'DECLARATION_RECONSTRUCTION_UNVERIFIED')

    def test_native_failure_does_not_inspect_hostile_identity(self):
        calls = []
        class Hostile(dict):
            def get(self, *args):
                calls.append('get')
                raise AssertionError('callback')
        result = compare_kr056_steel_declarations(Hostile())
        self.assertIsNone(result['identity'])
        self.assertEqual(result['reasonCode'], 'INVALID_INPUT')
        self.assertEqual(calls, [])

    def test_projection_snapshot_hash_integrity(self):
        value = case('synthetic-directed-C345-C245')['sources'][0]['review']['steelComparisonScope']
        value['claims'][0]['declarationSnapshot']['id'] = '0' * 64
        self.assertIsNone(project_steel_comparison_scope_decision(value))
