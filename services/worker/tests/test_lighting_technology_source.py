"""Independent authored original-backed source declarations; not a comparator."""
import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.lighting_technology_source import reconstruct_lighting_technology_source,lighting_technology_declaration_content_hash
F=Path(__file__).resolve().parents[3]/'fixtures'/'matrix-lighting-technology-source-v1'
RAW=(F/'research-authored-goldens.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest()=='e5340b5bd776432af6349436387298998df2d0da44b087932c681b30971be59a'
CASES=json.loads(RAW)['cases']
class LightingTechnologySourceTests(unittest.TestCase):
 def test_frozen_original_backed_whole_outputs(self):
  self.assertEqual(len(CASES),12)
  for c in CASES:
   with self.subTest(name=c['name']):
    value=copy.deepcopy(c['input']);before=copy.deepcopy(value)
    actual=reconstruct_lighting_technology_source(value)
    self.assertEqual(actual,c['expected']);self.assertEqual(value,before)
    if actual['status']=='RECONSTRUCTED':self.assertEqual(lighting_technology_declaration_content_hash(actual['declaration']),c['expectedDeclarationContentHash'])
if __name__=='__main__':unittest.main()
