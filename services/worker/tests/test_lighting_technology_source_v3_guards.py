"""Additive guard regressions; manual expectations precede source fixes."""
import copy
import hashlib
import json
import unittest
from pathlib import Path

from inspector_worker.lighting_technology_source_v3 import (
    lighting_technology_v3_declaration_content_hash,
    reconstruct_lighting_technology_source_v3,
)

_FIXTURE = Path(__file__).resolve().parents[3] / 'fixtures/matrix-lighting-technology-source-v3-v1/qa-guard-regression-goldens.json'
assert hashlib.sha256(_FIXTURE.read_bytes()).hexdigest() == '601c6fac3e51cca363922d98eb091493b65ad890217a8a5e173d89d6a7d839c8'
_MANUAL = json.loads(_FIXTURE.read_text())


class LightingTechnologySourceV3GuardTests(unittest.TestCase):
    def test_five_parser_and_native_geometry_hash_guards(self):
        self.assertEqual(len(_MANUAL['hashCases']), 5)
        for case in _MANUAL['hashCases']:
            with self.subTest(name=case['name']):
                self.assertEqual(case['expected'], 'THROW')
                value = copy.deepcopy(case['declaration'])
                before = copy.deepcopy(value)
                with self.assertRaises(ValueError):
                    lighting_technology_v3_declaration_content_hash(value)
                self.assertEqual(value, before)

    def test_three_lighting_key_vs_full_original_key_precedence_controls(self):
        self.assertEqual(len(_MANUAL['sourceCases']), 3)
        for case in _MANUAL['sourceCases']:
            with self.subTest(name=case['name']):
                value = copy.deepcopy(case['input'])
                before = copy.deepcopy(value)
                self.assertEqual(reconstruct_lighting_technology_source_v3(value), case['expected'])
                self.assertEqual(value, before)
