"""Finite owner boundary cases fixed before tests in owner-boundary-intent-before-tests.json."""
import copy
import json
from pathlib import Path
import unittest
from inspector_worker import column_pylon_section_execution as api
from inspector_worker.column_pylon_section_run_snapshot import build_column_pylon_section_run_snapshot
ORACLE=json.loads((Path(__file__).resolve().parents[3]/'fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json').read_text())
class OwnerExecutionBoundaries(unittest.TestCase):
    def rejects(self,fn,code):
        with self.assertRaises(api.ColumnPylonSectionExecutionValidationError) as caught:
            fn()
        self.assertEqual(caught.exception.code,code)
    def pair(self):
        c=copy.deepcopy(ORACLE['wholeCases'][0]); p=c['package']
        values=api.calculate_column_pylon_section_snapshot_inclusion({'currentSources':p['sources'],'journals':[r['journal'] for r in p['reviews']]})
        s=build_column_pylon_section_run_snapshot({'objectId':c['snapshot']['objectId'],'objectApiId':p['objectId'],'inputManifestHash':p['inputManifestHash'],
            'entries':[{**old,**new} for old,new in zip(c['snapshot']['entries'],values)]})
        return p,s
    def test_native_roots_and_limits_without_callbacks(self):
        calls=[]
        class Hostile(dict):
            def __iter__(self):calls.append('iter');raise AssertionError()
            def items(self):calls.append('items');raise AssertionError()
        self.rejects(lambda:api.build_column_pylon_section_comparisons(None,Hostile(),None),'INVALID_INPUT')
        self.rejects(lambda:api.column_pylon_section_comparison_evidence(None,{},Hostile(),None),'INVALID_INPUT')
        self.assertEqual(calls,[])
        snapshot=ORACLE['wholeCases'][0]['snapshot']
        self.rejects(lambda:api.validate_column_pylon_section_loader_package([None]*32768,snapshot),'INVALID_PACKAGE')
        self.rejects(lambda:api.validate_column_pylon_section_loader_package([None]*32769,snapshot),'INPUT_LIMIT')
        self.rejects(lambda:api.validate_column_pylon_section_loader_package('x'*2000000,snapshot),'INVALID_PACKAGE')
        self.rejects(lambda:api.validate_column_pylon_section_loader_package('x'*2000001,snapshot),'INPUT_LIMIT')
    def test_unicode_order_and_empty_current_package(self):
        p={'schemaVersion':'matrix-kr060-column-pylon-loader-inputs-v1','objectId':'object','inputManifestHash':'a'*64,
            'sources':[{'sourceFileId':'\ue000','sourceSha256':'b'*64,'stages':['PD'],'review':None},{'sourceFileId':'😀','sourceSha256':'c'*64,'stages':['RD'],'review':None}], 'origins':[],'reviews':[]}
        s=build_column_pylon_section_run_snapshot({'objectId':'11111111-1111-4111-8111-111111111111','objectApiId':'object','inputManifestHash':p['inputManifestHash'],'entries':[]})
        self.assertEqual(api.validate_column_pylon_section_loader_package(p,s),p)
        p['sources'].reverse()
        self.rejects(lambda:api.validate_column_pylon_section_loader_package(p,s),'INVALID_PACKAGE')
    def test_rehashed_standalone_arithmetic(self):
        p,s=self.pair(); e=api.build_column_pylon_section_comparisons(p,s)
        self.assertEqual(e['results'][0]['comparison']['status'],'CANDIDATE')
        for change in ('delta','direction','pin'):
            bad=copy.deepcopy(e); row=bad['results'][0]
            if change=='delta':row['comparison']['comparison']['deltaAreaMm2']='0'
            elif change=='direction':
                row['comparison'].update(status='NO_DECREASE_IN_REVIEWED_PAIR',reasonCode='REVIEWED_PAIR_HAS_NO_AREA_DECREASE')
                row['comparison'].pop('expertReviewRequired')
            else:row['pairJournalContentHash']='f'*64
            body={k:v for k,v in row.items() if k!='id'}
            # Independent normative hash preimage; expected rejection is hand-authored.
            import hashlib
            pre={'hashDomain':'matrix-column-pylon-section-execution-result-id-v1','objectId':bad['objectId'],'inputManifestHash':bad['inputManifestHash'],
                'capabilityRegistryHash':bad['capabilityRegistryHash'],'pairReviewSnapshotHash':bad['pairReviewSnapshotHash'],'result':body}
            row['id']=hashlib.sha256(json.dumps(pre,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            self.rejects(lambda:api.validate_column_pylon_section_comparisons(bad),'INVALID_COMPARISONS')
    def test_private_default_registry_and_explicit_null(self):
        p,s=self.pair(); expected=api.build_column_pylon_section_comparisons(p,s)
        view=api.COLUMN_PYLON_SECTION_CAPABILITY_REGISTRY; previous=view['entries'][0]['enabled'];view['entries'][0]['enabled']=False
        try:
            self.assertEqual(api.build_column_pylon_section_comparisons(p,s),expected)
            self.rejects(lambda:api.build_column_pylon_section_comparisons(p,s,None),'INVALID_REGISTRY')
            self.rejects(lambda:api.column_pylon_section_comparison_evidence(p,s,expected,None),'INVALID_REGISTRY')
            self.rejects(lambda:api.merge_column_pylon_section_coverage(ORACLE['baseCoverage'],expected,None),'INVALID_REGISTRY')
        finally:view['entries'][0]['enabled']=previous
        p['reviews']=[]
        self.rejects(lambda:api.validate_column_pylon_section_loader_package(p,s),'INVALID_PACKAGE')
if __name__=='__main__':unittest.main()
