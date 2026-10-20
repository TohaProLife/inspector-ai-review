"""Frozen independent diagnostic regression cases; no runtime-derived oracle."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from inspector_worker.lighting_technology_comparison import compare_zu130_lighting_technologies
P=Path(__file__).resolve().parents[3]/'fixtures/matrix-lighting-technology-comparison-v1/qa-gate-regression-goldens.json'
M=json.loads(P.read_text())
class LightingComparisonGateRegressionTests(unittest.TestCase):
 def test_shape_association_and_reconstruction_gate_order(self):
  self.assertEqual(len(M['gateCases']),5)
  for c in M['gateCases']:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_zu130_lighting_technologies(x),c['expected']);self.assertEqual(x,before)
 def test_canonical_snapshot_shape_precedes_reconstruction(self):
  self.assertEqual(len(M['shapeCases']),5)
  for c in M['shapeCases']:
   with self.subTest(name=c['name']):
    x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_zu130_lighting_technologies(x),c['expected']);self.assertEqual(x,before)

 def test_snapshot_source_association_is_full_reconstruction_gate(self):
  m=json.loads(P.with_name('qa-snapshot-association-golden.json').read_text());self.assertEqual(len(m['cases']),1)
  for c in m['cases']:
   x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_zu130_lighting_technologies(x),c['expected']);self.assertEqual(x,before)

 def test_unclaimed_source_does_not_require_invented_origin(self):
  m=json.loads(P.with_name('qa-unclaimed-source-golden.json').read_text());self.assertEqual(len(m['cases']),1)
  for c in m['cases']:
   x=copy.deepcopy(c['input']);before=copy.deepcopy(x);self.assertEqual(compare_zu130_lighting_technologies(x),c['expected']);self.assertEqual(x,before)
