import copy,hashlib,json,unittest
from pathlib import Path
from inspector_worker.lighting_technology_source import reconstruct_lighting_technology_source
RAW=(Path(__file__).resolve().parents[3]/'fixtures/matrix-lighting-technology-source-v1/research-manufacturer-boundary-goldens.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest()=='f44bc4c2ea033ccc0d05e8bd21061c379b69c144d24efcf24c8ca71ae68b5a09'
class ManufacturerBoundaryTests(unittest.TestCase):
 def test_ascii_quote_guards(self):
  for c in json.loads(RAW)['cases']:
   with self.subTest(name=c['name']):
    value=copy.deepcopy(c['input']);before=copy.deepcopy(value);self.assertEqual(reconstruct_lighting_technology_source(value),c['expected']);self.assertEqual(value,before)
