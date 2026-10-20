"""Independent T83 immutable snapshot core and BIGINT boundaries."""
import copy
import json
from pathlib import Path
import unittest
from inspector_worker import column_pylon_section_run_snapshot as dut
ORACLE = json.loads((Path(__file__).resolve().parents[3] / 'fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json').read_text())

class IndependentColumnPylonSnapshotTests(unittest.TestCase):
    def assert_rejected(self, call, code):
        try:
            call()
        except Exception as exc:
            self.assertEqual(getattr(exc, 'code', None), code)
        else:
            self.fail('Expected ' + code)

    def test_four_complete_build_validate_detached_snapshots(self):
        for c in ORACLE['snapshotCases']:
            with self.subTest(case=c['name']):
                before = copy.deepcopy(c)
                self.assertEqual(dut.build_column_pylon_section_run_snapshot(c['buildInput']), c['expected'])
                result = dut.validate_column_pylon_section_run_snapshot(c['expected'])
                self.assertEqual(result, c['expected'])
                self.assertIsNot(result, c['expected'])
                self.assertIsNot(result['entries'], c['expected']['entries'])
                self.assertEqual(c, before)

    def test_seven_closed_shape_order_and_bigint_rejections(self):
        for c in ORACLE['snapshotThrowCases']:
            with self.subTest(case=c['name']):
                self.assert_rejected(lambda: dut.validate_column_pylon_section_run_snapshot(c['input']), c['expectedErrorCode'])

    def test_native_callback_zero_and_depth(self):
        calls = []
        class Hostile(dict):
            def items(self):
                calls.append('items'); raise AssertionError('callback')
        for value in [Hostile(), {'x': 1.5}, {'x': '\ud800'}]:
            self.assert_rejected(lambda: dut.validate_column_pylon_section_run_snapshot(value), 'INVALID_INPUT')
        self.assertEqual(calls, [])
        deep = {}
        for _ in range(66):
            deep = {'child': deep}
        self.assert_rejected(lambda: dut.validate_column_pylon_section_run_snapshot(deep), 'INPUT_LIMIT')

if __name__ == '__main__':
    unittest.main()
