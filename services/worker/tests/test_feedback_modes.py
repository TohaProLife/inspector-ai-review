import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import fitz
from inspector_worker.document_context import document_context
from inspector_worker.main import execute_durable_job
from inspector_worker.visual_vlm import selected_ordinals, observe_proposals, render_crop
from inspector_worker.visual_proposal_adapter import VisualProposalAdapter, PROFILE_V7_FULL, PROFILE_HASH_V7_FULL, PROFILE_ID_V7_FULL

class FeedbackModesTests(unittest.TestCase):
    def test_context_uses_late_titles_outline_and_metadata_and_keeps_mixed_systems(self):
        with fitz.open() as doc:
            for _ in range(5): doc.new_page()
            doc.set_metadata({'title': 'Система отопления'})
            doc.set_toc([[1, 'Система вентиляции', 4]])
            result = document_context(doc)
            self.assertEqual(result['status'], 'MIXED')
            self.assertEqual(result['domains'], ['HEATING', 'VENTILATION'])
            self.assertEqual(len(result['inspectedPages']), 5)
            self.assertEqual(result['unreadablePageCount'], 5)
            self.assertEqual(result['signals'][1]['pageNumber'], 4)
            # Actual Cyrillic page text, beyond historical first-two/500-character window.
            font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
            doc[4].insert_text((20, 50), 'X' * 600, fontsize=2)
            doc[4].insert_text((20, 100), 'Электроснабжение', fontfile=font, fontname='DejaVu', fontsize=12)
            late = document_context(doc)
            self.assertIn('ELECTRICAL', late['domains'])
            self.assertTrue(any(s['kind'] == 'PAGE_TEXT' and s['pageNumber'] == 5 for s in late['signals']))

    def test_full_visits_all_proposals_and_reports_provider_failures(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'source.pdf'
            with fitz.open() as doc:
                doc.new_page(width=200, height=100)
                doc.save(path)
            source = {'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                      'proposals': [{'pageNumber': 1, 'bboxNormalized': [.1,.1,.5,.9]} for _ in range(7)]}
            full = observe_proposals(path, source, None, mode='FULL', max_edge=2048)
            self.assertEqual(full['selectedOrdinals'], list(range(7)))
            self.assertEqual(full['omittedProposalCount'], 0)
            self.assertTrue(all(o['reasonCode'] == 'ENDPOINT_NOT_CONFIGURED' for o in full['observations']))
            self.assertEqual(len(selected_ordinals(7)), 2)
            with self.assertRaises(ValueError): selected_ordinals(-1, 'FULL')
            image = fitz.Pixmap(render_crop(path, 1, [.1,.1,.5,.9], 2048))
            self.assertGreater(max(image.width, image.height), 768)
            self.assertLessEqual(max(image.width, image.height), 2048)

    def test_successful_crops_resume_without_repeating_model_calls_and_corrupt_cache_is_ignored(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'source.pdf'
            with fitz.open() as doc:
                doc.new_page(width=200, height=100); doc.save(path)
            source = {'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                      'proposals': [{'pageNumber': 1, 'bboxNormalized': [.1,.1,.5,.9]}]}
            with patch.dict('os.environ', {'INSPECTOR_VISUAL_CACHE_ROOT': str(Path(root)/'cache')}), patch(
                'inspector_worker.visual_vlm._post_vlm', return_value=('RADIATOR','a'*64)) as model:
                first=observe_proposals(path,source,'http://visual-vlm:8080/v1',mode='FULL',cache_namespace='profile-v7')
                second=observe_proposals(path,source,'http://visual-vlm:8080/v1',mode='FULL',cache_namespace='profile-v7')
                self.assertEqual(model.call_count,1); self.assertEqual(first,second)
                next((Path(root)/'cache').glob('*.json')).write_text('corrupt')
                observe_proposals(path,source,'http://visual-vlm:8080/v1',mode='FULL',cache_namespace='profile-v7')
                self.assertEqual(model.call_count,2)

    def test_full_adapter_keeps_immutable_profile_and_scans_all_pages(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'source.pdf'
            with fitz.open() as doc:
                for _ in range(3):
                    page=doc.new_page(width=200,height=100)
                    page.draw_rect(fitz.Rect(20,10,26,60),color=(1,0,0),width=.4)
                    page.draw_line(fitz.Point(26,30),fitz.Point(65,30),color=(0,0,1))
                doc.save(path)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            lease={'objectId':'OBJ-TEST', 'inputManifestHash':'a'*64,
                'release':{'lifecycle':'DRAFT','providerSlot':{'stageJobType':'ENTITY_EXTRACTION',
                    'providerKind':'ENTITY_EXTRACTION_MODEL','status':'CONFIGURED',
                    'profileId':PROFILE_ID_V7_FULL,'adapterVersion':'7','configHash':PROFILE_HASH_V7_FULL}},
                'inputs':{'sourceFiles':[{'sourceFileId':'FIL-TEST','sha256':digest,'byteSize':path.stat().st_size,
                    'mediaType':'application/pdf','downloadPath':'/api/internal/v1/jobs/test/inputs/FIL-TEST'}]}}
            def copy(_url,destination,*_): destination.write_bytes(path.read_bytes())
            with patch('inspector_worker.visual_proposal_adapter._download_source',side_effect=copy), patch.dict('os.environ',{},clear=True):
                result=VisualProposalAdapter().execute(lease,{})
            source=result['analysis']['sources'][0]
            self.assertEqual(result['analysis']['profile'], PROFILE_V7_FULL)
            self.assertEqual(source['scannedPageNumbers'], [1,2,3])
            self.assertEqual(len(source['vlm']['observations']),3)
            self.assertEqual(source['vlm']['omittedProposalCount'],0)
            self.assertEqual(source['documentContext']['schemaVersion'],'document-context-v2')

    def test_final_progress_is_fenced_and_persisted_before_completion(self):
        progress = {'mode':'FULL','documentCount':1,'completedDocuments':1,'scannedPages':3,
            'skippedPages':0,'eligible':3,'selected':3,'processed':3,'failed':0}
        calls=[]
        def post(job, action, payload):
            calls.append((action,dict(payload)))
            return {'status':'ACQUIRED','lease':{'attemptId':'attempt','fencingToken':2}} if action == 'claim' else {'status':'LEASE_EXTENDED' if action == 'heartbeat' else 'COMPLETED'}
        def stage(_job, _lease, attempt):
            attempt['visualProgress']=progress
            return {'complete':True}
        envelope={'schema_version':'1.0','event_id':'event','event_type':'job.ready',
            'job_id':'job','job_type':'ENTITY_EXTRACTION','run_id':'run','scope_type':'ANALYSIS',
            'input_manifest_hash':'a'*64}
        with patch('inspector_worker.main.LeaseHeartbeat'), patch('inspector_worker.main.post_with_retry',side_effect=post), patch('inspector_worker.main.DEFAULT_STAGE_PROVIDER_REGISTRY.execute',side_effect=stage):
            self.assertEqual(execute_durable_job(envelope)['status'],'COMPLETED')
        self.assertEqual([c[0] for c in calls],['claim','heartbeat','complete'])
        self.assertEqual(calls[1][1]['visualProgress'],progress)
        self.assertEqual(calls[1][1]['fencingToken'],2)
        self.assertNotIn('visualProgress',calls[2][1])
