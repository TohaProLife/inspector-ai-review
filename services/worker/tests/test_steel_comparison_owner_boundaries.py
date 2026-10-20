"""Additional owner limits fixed before their first execution, without oracle edits."""
import copy
import json
import unittest
from pathlib import Path
from inspector_worker.steel_comparison import compare_kr056_steel_declarations
_ROOT = Path(__file__).resolve().parents[3]
_CASES = json.loads((_ROOT/'fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json').read_text())['cases']
def candidate():
    return copy.deepcopy(next(c['input'] for c in _CASES if c['name'] == 'synthetic-directed-C345-C245'))
class SteelComparisonOwnerBoundaryTests(unittest.TestCase):
    def test_large_current_page_decimal_cannot_throw(self):
        x = candidate()
        x['sources'][0]['review']['pageStages'] = {'1'*5000: 'PD'}
        self.assertEqual(compare_kr056_steel_declarations(x)['reasonCode'], 'SOURCE_PROVENANCE_UNVERIFIED')
    def test_inline_identifier_uses_frozen_clean_line_policy(self):
        x = candidate()
        x['sources'][0]['review']['linkGroupId'] = 'name\nnext'
        self.assertEqual(compare_kr056_steel_declarations(x)['reasonCode'], 'INVALID_INPUT')
