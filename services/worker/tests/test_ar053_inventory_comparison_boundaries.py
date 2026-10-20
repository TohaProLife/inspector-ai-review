from pathlib import Path
from copy import deepcopy
import json,unittest
P=Path(__file__).resolve().parent/'fixtures'/'matrix-ar053-inventory-v1'
from inspector_worker import ar053_inventory_comparison as m
class AmendmentTests(unittest.TestCase):
 def test_all13_root_approved_precedence_budget_vectors(self):
  cases=json.loads((P/'review-red-vectors.json').read_text())['cases'];self.assertEqual(len(cases),13)
  for c in cases:
   with self.subTest(case=c['name']):self.assertEqual(m.compare_ar053_inventories(c['input']),c['expected'])
 def test_all15_prototype_extra_keys_never_silently_dropped(self):
  cases=json.loads((P/'prototype-json-red-vectors.json').read_text())['cases'];self.assertEqual(len(cases),15)
  for c in cases:
   with self.subTest(case=c['name']):self.assertEqual(m.compare_ar053_inventories(c['input']),c['expected'])
 def test_all30_additional_portable_edges_exact(self):
  cases=json.loads((P/'additional-portable-native-vectors.json').read_text())['cases'];self.assertEqual(len(cases),30)
  for c in cases:
   with self.subTest(case=c['name']):
    before=deepcopy(c['input']);self.assertEqual(m.compare_ar053_inventories(c['input']),c['expected']);self.assertEqual(c['input'],before)
if __name__=='__main__':unittest.main(verbosity=2)
