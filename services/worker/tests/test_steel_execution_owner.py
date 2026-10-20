"""Owned independent retained-integrity boundaries, frozen before invocation."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest
from inspector_worker import steel_execution as e

_ROOT = Path(__file__).resolve().parents[3]
_MANUAL = json.loads((_ROOT/'fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json').read_text())

def case(name):
    return deepcopy(next(c for c in _MANUAL['validCases'] if c['name']==name))

def positive():
    return case('authored-original-directed-positive')

def rehash(decision):
    decision['contentHash'] = hashlib.sha256(json.dumps({'hashDomain':'matrix-kr056-steel-applicability-decision-json-v1',
        'decision':{k:v for k,v in decision.items() if k!='contentHash'}},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class SteelExecutionOwnerTests(unittest.TestCase):
    def test_large_current_page_key_on_unclaimed_retained_original(self):
        x = case('authored-original-no-reviews-unbound')['package']
        template = positive()['package']['sources'][0]['review']
        x['sources'][0]['review'] = template
        template['steelComparisonScope'] = {'schemaVersion':'matrix-kr056-steel-review-v1','claims':[]}
        template['pageStages'] = {'9'*5000:'PD'}
        with self.assertRaisesRegex(ValueError,'^SOURCE_PROVENANCE_UNVERIFIED$'):
            e.build_steel_comparisons(x)

    def test_original_role_integrity_precedes_empty_identity_projection(self):
        x = positive()['package']
        x['identities'] = []
        decision = x['applicabilityDecisions'][0]
        decision['status'] = 'UNKNOWN'
        decision['expected'],decision['actual'] = decision['actual'],decision['expected']
        basis = decision['basis']
        basis['expectedScopeFragments'],basis['actualScopeFragments'] = basis['actualScopeFragments'],basis['expectedScopeFragments']
        rehash(decision)
        with self.assertRaisesRegex(ValueError,'^APPLICABILITY_DECISION_UNVERIFIED$'):
            e.validate_steel_comparison_loader_package(x)

    def test_derive_checks_local_snapshot_hash_before_identity(self):
        sources = positive()['package']['sources']
        claim = sources[0]['review']['steelComparisonScope']['claims'][0]
        claim['identity']['entityKey'] = 'unrelated-member'
        claim['memberMapping']['identity'] = deepcopy(claim['identity'])
        claim['declarationSnapshot']['id'] = 'f'*64
        with self.assertRaisesRegex(ValueError,'^DECLARATION_RECONSTRUCTION_UNVERIFIED$'):
            e.derive_steel_comparison_identities(sources)

    def test_rehashed_result_cannot_alias_original_pdf_sha(self):
        envelope = positive()['expected']['envelope']
        row = envelope['results'][0]
        comparison = row['comparison']['comparison']
        comparison['actual']['sourceSha256'] = comparison['expected']['sourceSha256']
        row['id'] = hashlib.sha256(json.dumps({'hashDomain':'matrix-steel-execution-result-id-v1',
            'objectId':envelope['objectId'],'inputManifestHash':envelope['inputManifestHash'],
            'capabilityRegistryHash':envelope['capabilityRegistryHash'],'result':{k:v for k,v in row.items() if k!='id'}},
            ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with self.assertRaises(ValueError):
            e.validate_steel_comparisons(envelope)

    def test_unknown_pair_operational_not_reason_filtered_corrupt_pair_throws(self):
        c = case('pair-unknown-operational')
        self.assertEqual(e.build_steel_comparisons(c['package']),c['expected']['envelope'])
        x = deepcopy(c['package'])
        x['applicabilityDecisions'][0]['contentHash'] = 'f'*64
        with self.assertRaisesRegex(ValueError,'^APPLICABILITY_DECISION_UNVERIFIED$'):
            e.build_steel_comparisons(x)
