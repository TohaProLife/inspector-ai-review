from pathlib import Path
from copy import deepcopy
import json,unittest
from inspector_worker.inventory_source import reconstruct_ar053_inventory_source
P=Path(__file__).resolve().parent/'fixtures'/'matrix-ar053-inventory-v1'
from inspector_worker import ar053_inventory_comparison as m
PROBE=json.loads((P/'pd-gasket-canonical-only-probe.json').read_text())
class CanonicalOnlyTests(unittest.TestCase):
 def test_authored_canonical_only_full_inventory_and_pd_requirement_branch(self):
  self.assertEqual(PROBE['provenance']['kind'],'SYNTHETIC_CANONICAL_ONLY');self.assertFalse(PROBE['provenance']['originalPdfExists'])
  x=deepcopy(PROBE['input']);s=x['sources'][0];r=s['review'];c=r['inventoryScope']['claims'][0];o=x['origins'][0]
  self.assertEqual(reconstruct_ar053_inventory_source({'sourceFileId':s['sourceFileId'],'sourceSha256':s['sourceSha256'],'stage':'PD','pageStages':r['pageStages'],'textArtifact':o['textArtifact'],'selection':c['selection']})['inventory'],c['inventorySnapshot'])
  self.assertEqual(m.compare_ar053_inventories(x),PROBE['expected'])
 def test_human_completeness_gate_precedes_pd_membership(self):
  x=deepcopy(PROBE['input']);x['sources'][0]['review']['inventoryScope']['claims'][0]['assertion']='UNKNOWN'
  self.assertEqual(m.compare_ar053_inventories(x)['reasonCode'],'HUMAN_COMPLETENESS_UNVERIFIED')
if __name__=='__main__':unittest.main(verbosity=2)
