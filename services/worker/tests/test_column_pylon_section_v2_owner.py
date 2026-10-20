"""Owner exact frozen source/provenance and arithmetic corpus; independent expected JSON."""
import copy
import hashlib
import json
import unittest
from pathlib import Path
from inspector_worker.column_pylon_section_v2 import (compare_kr060_column_pylon_section, materialize_column_pylon_section_review, project_column_pylon_section_review_decision, ColumnPylonSectionReviewValidationError)
ROOT=Path(__file__).resolve().parents[3]
def fixture(name, pin):
    data=(ROOT/'fixtures/matrix-column-pylon-section-v2'/name).read_bytes()
    assert hashlib.sha256(data).hexdigest()==pin
    return json.loads(data)
class ColumnPylonSectionV2OwnerTests(unittest.TestCase):
    def test_whole17(self):
        whole=fixture('owner-manual-whole.json','3d8ea1c261193984bb32cb294715daa8f310d45e4796ce4932b983b9f26a2d27')
        for c in whole['cases']:
            with self.subTest(name=c['name']):
                before=copy.deepcopy(c['input'])
                self.assertEqual(compare_kr060_column_pylon_section(c['input']),c['expected'])
                self.assertEqual(c['input'],before)
    def test_projection_and_withdrawal(self):
        packet=fixture('owner-manual-review.json','f8f55140d12b268342df73b65d98efe72eb207169e77325ef1e24248d08c38d2')
        for c in packet['projectionCases']:
            self.assertEqual(project_column_pylon_section_review_decision(c['input']),c['expected'])
        for c in packet['materializationCases']:
            self.assertEqual(materialize_column_pylon_section_review(c['input'],c['context']),c['expected'])
    def test_fresh_materialization_exact_manual_journal(self):
        p=fixture('owner-fresh-materialization.json','78fbc9e25d969e9aa624b494eb2112579fc4c966c6d066bd26bc369b358df48f')
        self.assertEqual(materialize_column_pylon_section_review(p['request'],p['context']),p['expected'])
    def test_unknown_draft_cannot_commit_stale_source_review(self):
        p=fixture('owner-fresh-materialization.json','78fbc9e25d969e9aa624b494eb2112579fc4c966c6d066bd26bc369b358df48f')
        p['request']['status']='UNKNOWN'
        p['context']['sources'][1]['review']['contentHash']='0'*64
        with self.assertRaises(ColumnPylonSectionReviewValidationError) as e:
            materialize_column_pylon_section_review(p['request'],p['context'])
        self.assertEqual(e.exception.code,'STALE_REVIEW')

class ColumnPylonSectionV2StandaloneTests(unittest.TestCase):
    def journal(self):
        return fixture('owner-manual-whole.json','3d8ea1c261193984bb32cb294715daa8f310d45e4796ce4932b983b9f26a2d27')['cases'][0]['input']['review']
    def rehash(self,j):
        def sha(v):return hashlib.sha256(json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()
        j['projection']['contentHash']=sha({'hashDomain':'matrix-kr060-column-pylon-pair-projection-json-v2','projection':{k:v for k,v in j['projection'].items() if k!='contentHash'}})
        j['contentHash']=sha({'hashDomain':'matrix-kr060-column-pylon-pair-journal-json-v2','journal':{k:v for k,v in j.items() if k!='contentHash'}})
        return j
    def test_native_selection_hash_and_literal_target_are_standalone_consistent(self):
        from inspector_worker.column_pylon_section_v2 import validate_column_pylon_section_review_decision
        for mode in ['native-hash','literal-page']:
            j=self.journal()
            if mode=='native-hash':j['projection']['actual']['selection']['selectionContentHash']='0'*64
            else:j['projection']['expected']['selection']['pageNumber']=2
            self.rehash(j)
            with self.assertRaises(ColumnPylonSectionReviewValidationError):validate_column_pylon_section_review_decision(j)
    def test_proleptic_gregorian_four_digit_utc(self):
        from inspector_worker.column_pylon_section_v2 import validate_column_pylon_section_review_decision
        for date,valid in [('0000-02-29T00:00:00.000Z',True),('0000-02-30T00:00:00.000Z',False),('0001-01-01T00:00:00.000Z',True),('1900-02-29T00:00:00.000Z',False),('2000-02-29T00:00:00.000Z',True)]:
            with self.subTest(date=date):
                j=self.journal();j['createdAt']=date;self.rehash(j)
                if valid:self.assertEqual(validate_column_pylon_section_review_decision(j),j)
                else:
                    with self.assertRaises(ColumnPylonSectionReviewValidationError):validate_column_pylon_section_review_decision(j)
