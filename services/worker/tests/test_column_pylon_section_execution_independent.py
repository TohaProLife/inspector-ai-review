"""Independent T83 whole-output oracle. No source consumer used to author expected data."""
import copy
import json
from pathlib import Path
import unittest
from inspector_worker import column_pylon_section_execution as dut

ORACLE = json.loads((Path(__file__).resolve().parents[3] / 'fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json').read_text())

class IndependentColumnPylonExecutionTests(unittest.TestCase):
    def assert_rejected(self, call, code):
        try:
            call()
        except Exception as exc:
            self.assertEqual(getattr(exc, 'code', None), code)
        else:
            self.fail('Expected ' + code)

    def test_sixteen_whole_envelopes_evidence_coverage_and_input_immutability(self):
        for original in ORACLE['wholeCases']:
            with self.subTest(case=original['name']):
                c = copy.deepcopy(original)
                before = copy.deepcopy(c)
                self.assertEqual(dut.validate_column_pylon_section_loader_package(c['package'], c['snapshot']), c['package'])
                envelope = dut.build_column_pylon_section_comparisons(c['package'], c['snapshot'])
                self.assertEqual(envelope, c['expected']['envelope'])
                self.assertEqual(dut.validate_column_pylon_section_comparisons(envelope), c['expected']['envelope'])
                self.assertEqual(dut.column_pylon_section_comparison_evidence(c['package'], c['snapshot'], envelope), c['expected']['evidence'])
                self.assertEqual(dut.merge_column_pylon_section_coverage(ORACLE['baseCoverage'], envelope), c['expected']['coverage'])
                self.assertEqual(c, before)

    def test_nineteen_retained_and_standalone_error_stages(self):
        def operation(c):
            optional = [c['registry']] if 'registry' in c else []
            if c['operation'] == 'build':
                return dut.build_column_pylon_section_comparisons(c['package'], c['snapshot'], *optional)
            if c['operation'] == 'validate':
                return dut.validate_column_pylon_section_comparisons(c['envelope'])
            if c['operation'] == 'evidence':
                return dut.column_pylon_section_comparison_evidence(c['package'], c['snapshot'], c['envelope'], *optional)
            if c['operation'] == 'merge':
                return dut.merge_column_pylon_section_coverage(c['coverage'], c['envelope'], *optional)
            raise AssertionError('Unknown frozen operation')
        for c in ORACLE['throwCases']:
            with self.subTest(case=c['name']):
                self.assert_rejected(lambda: operation(copy.deepcopy(c)), c['expectedErrorCode'])

    def test_nineteen_inclusion_vectors_global_sha_precedence(self):
        for original in ORACLE['inclusionCases']:
            with self.subTest(case=original['name']):
                c = copy.deepcopy(original)
                before = copy.deepcopy(c)
                if 'expectedErrorCode' in c:
                    self.assert_rejected(lambda: dut.calculate_column_pylon_section_snapshot_inclusion(c['input']), c['expectedErrorCode'])
                else:
                    self.assertEqual(dut.calculate_column_pylon_section_snapshot_inclusion(c['input']), c['expected'])
                self.assertEqual(c, before)

    def test_native_rejection_without_user_callbacks(self):
        calls = []
        class Hostile(dict):
            def items(self):
                calls.append('items')
                raise AssertionError('callback')
            def __iter__(self):
                calls.append('iter')
                raise AssertionError('callback')
        cycle = {}; cycle['self'] = cycle
        for value in [Hostile(), cycle, {'x': 0.5}, {'x': '\ud800'}]:
            self.assert_rejected(lambda: dut.validate_column_pylon_section_loader_package(value, ORACLE['wholeCases'][0]['snapshot']), 'INVALID_INPUT')
        self.assertEqual(calls, [])
        deep = {}
        for _ in range(70):
            deep = {'child': deep}
        self.assert_rejected(lambda: dut.validate_column_pylon_section_loader_package(deep, ORACLE['wholeCases'][0]['snapshot']), 'INPUT_LIMIT')

    def test_registry_and_detached_results(self):
        self.assertEqual(dut.COLUMN_PYLON_SECTION_CAPABILITY_REGISTRY, ORACLE['registry'])
        self.assertEqual(dut.COLUMN_PYLON_SECTION_CAPABILITY_REGISTRY_HASH, ORACLE['registryHash'])
        c = ORACLE['wholeCases'][0]
        result = dut.validate_column_pylon_section_loader_package(c['package'], c['snapshot'])
        self.assertIsNot(result, c['package'])
        self.assertIsNot(result['sources'], c['package']['sources'])
        envelope = dut.validate_column_pylon_section_comparisons(c['expected']['envelope'])
        self.assertIsNot(envelope, c['expected']['envelope'])
        self.assertIsNot(envelope['results'], c['expected']['envelope']['results'])
        registry = copy.deepcopy(dut.COLUMN_PYLON_SECTION_CAPABILITY_REGISTRY)
        registry['changed'] = True
        self.assertEqual(dut.build_column_pylon_section_comparisons(c['package'], c['snapshot']), c['expected']['envelope'])

if __name__ == '__main__':
    unittest.main()
