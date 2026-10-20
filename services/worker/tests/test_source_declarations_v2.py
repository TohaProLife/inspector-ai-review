"""Full-source v2 evidence authentication and unchanged v1 steel bodies/IDs."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker import source_declarations as legacy
from inspector_worker import source_declarations_v2 as wrapper
from test_source_declarations import fixture_input as steel_input, expected_output as steel_output

BASE=Path(__file__).parent/'fixtures/matrix-fire-table-v1'
EXPECTED=json.loads((BASE/'wrapper-golden.json').read_text())['expected']


def fixture_input():
    input=steel_input();artifact=json.loads((BASE/'F0106-full.text.json').read_text())
    input['sources'].append({'sourceFileId':artifact['sourceFileId'],'sha256':artifact['inputSha256'],'stages':['PD'],'sectionCode':'KR'})
    input['textArtifacts'].append(artifact)
    return input


def expected_output():return deepcopy(EXPECTED)


class SourceDeclarationsV2Tests(unittest.TestCase):
    def test_full182_independent_golden_exact_and_steel_payload_ids_unchanged(self):
        input=fixture_input();before=deepcopy(input);result=wrapper.extract_source_declarations(input)
        self.assertEqual(result,expected_output());self.assertEqual(input,before)
        self.assertEqual(wrapper.validate_source_declarations(result,input),result)
        self.assertEqual([d for d in result['declarations'] if d['kind']=='SOURCE_AUTHORED_STEEL_DECLARATION'],steel_output()['declarations'])
        self.assertEqual(legacy.extract_source_declarations(input),steel_output())
        self.assertEqual(len(result['declarations']),8)
        self.assertEqual({d['pageNumber'] for d in result['declarations'] if d['kind']=='SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION'},{51})
        self.assertTrue(all(d['entityKey'] is None and d['applicabilityStatus']=='UNREVIEWED' for d in result['declarations']))
        for d in result['declarations']:
            self.assertFalse(set(d)&{'attribute','parameterCode','ruleId','probability','confidence','coverage','comparison','qualified'})

    def test_missing_artifact_is_empty_not_missing_source_partial_claim(self):
        input=fixture_input();input['textArtifacts']=[]
        self.assertEqual(wrapper.extract_source_declarations(input)['declarations'],[])
        input=fixture_input();input['textArtifacts'].pop()
        self.assertEqual(wrapper.extract_source_declarations(input)['declarations'],steel_output()['declarations'])
        # A worker cannot omit one of the six rows on a provided complete artifact.
        input=fixture_input();raw=expected_output();raw['declarations'].pop()
        self.assertIsNone(wrapper.validate_source_declarations(raw,input))

    def test_stage_single_pd_rd_only_preserve_other_section_and_mixed_abstention(self):
        for stages in [[],['ID'],['UNRESOLVED'],['PD','RD'],['RD','PD']]:
            input=fixture_input();input['sources'][-1]['stages']=stages
            self.assertEqual(wrapper.extract_source_declarations(input)['declarations'],steel_output()['declarations'])
        for stage in ['PD','RD']:
            input=fixture_input();input['sources'][-1].update(stages=[stage],sectionCode='OTHER',pageStages={'51':stage})
            result=wrapper.extract_source_declarations(input)
            fires=[d for d in result['declarations'] if d['kind']=='SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION']
            self.assertEqual(len(fires),6);self.assertTrue(all(d['stage']==stage for d in fires))
            self.assertEqual(input['sources'][-1]['sectionCode'],'OTHER')
        for stage in ['RD','ID','UNRESOLVED']:
            input=fixture_input();input['sources'][-1]['pageStages']={'1':stage}
            self.assertEqual(wrapper.extract_source_declarations(input)['declarations'],steel_output()['declarations'])

    def test_all_input_validation_precedes_any_fire_discovery(self):
        mutations=[lambda i:i['sources'].append(deepcopy(i['sources'][-1])),
                   lambda i:i['textArtifacts'].append(deepcopy(i['textArtifacts'][-1])),
                   lambda i:i['textArtifacts'][-1].update(inputSha256='0'*64),
                   lambda i:i['textArtifacts'][-1].update(sourceFileId='orphan'),
                   lambda i:i['textArtifacts'][-1]['pages'].pop(),
                   lambda i:i['sources'][-1].update(pageStages={'140':'PD'}),
                   lambda i:i['sources'][-1].update(pageStages={'01':'PD'}),
                   lambda i:i['sources'][-1].update(stages=['PD','PD']),
                   lambda i:i['sources'][-1].update(objectId='foreign'),
                   lambda i:i['textArtifacts'][-1]['pages'][0].update(extra=True)]
        for mutate in mutations:
            input=fixture_input();mutate(input)
            with patch('inspector_worker.source_declarations_v2.extract_fire_resistance_candidates') as extract:
                with self.assertRaises(ValueError):wrapper.extract_source_declarations(input)
            extract.assert_not_called()
        input=fixture_input();input['sources'][-1]['stages']=['ID'];input['textArtifacts'][-1]['pageCount']-=1
        with self.assertRaises(ValueError):wrapper.extract_source_declarations(input)

    def test_recomputed_forgery_of_every_fire_field_and_source_context_rejected(self):
        input=fixture_input();base=expected_output();idx=next(i for i,d in enumerate(base['declarations']) if d['kind']=='SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION')
        changes={'minutes':121,'criterion':('R' if base['declarations'][idx]['criterion']=='REI' else 'REI'),'rawValue':'R 121','rawUnit':'сек','canonicalUnit':'s','stage':'RD',
                 'entityKey':'invented','applicabilityStatus':'APPROVED','pageNumber':50,'sourceSha256':'0'*64,
                 'textArtifactHash':'0'*64,'bindingPolicyVersion':'other','tableBoxMilliPoints':[1,2,3,4],
                 'scopeFragments':[],'headerFragments':[],'unitFragments':[],'primaryFragments':[],
                 'constructionLabelLines':['invented'],'probability':99,'confidence':100,'ruleId':'KR-066'}
        for key,value in changes.items():
            raw=deepcopy(base);raw['declarations'][idx][key]=value
            raw['declarations'][idx]['id']=wrapper.source_declaration_id(raw['declarations'][idx])
            self.assertIsNone(wrapper.validate_source_declarations(raw,input),key)
        raw=deepcopy(base);raw['declarations'][idx]['scopeFragments'][0]['rawText']='invented'
        raw['declarations'][idx]['id']=wrapper.source_declaration_id(raw['declarations'][idx])
        self.assertIsNone(wrapper.validate_source_declarations(raw,input))
        for key,value in [('schemaVersion','matrix-source-declarations-v1'),('purpose','COMPARISON'),('extra',True)]:
            raw=deepcopy(base);raw[key]=value;self.assertIsNone(wrapper.validate_source_declarations(raw,input))
        raw=deepcopy(base);raw['declarations'].reverse();self.assertIsNone(wrapper.validate_source_declarations(raw,input))

    def test_source_sort_unicode_codepoint_not_utf16_or_locale(self):
        input=fixture_input()
        for source,artifact,sid in zip(input['sources'],input['textArtifacts'],['\U00010000','\ue000','a']):
            source['sourceFileId']=sid;artifact['sourceFileId']=sid
        result=wrapper.extract_source_declarations(input)
        ids=[d['sourceFileId'] for d in result['declarations']]
        self.assertEqual(ids,['a']*6+['\ue000','\U00010000'])
        input['sources'].reverse();input['textArtifacts'].reverse()
        self.assertEqual(wrapper.extract_source_declarations(input),result)

    def test_full_artifact_hash_binds_unrelated_pages_and_output_does_not_alias(self):
        input=fixture_input();before=deepcopy(input);first=wrapper.extract_source_declarations(input)
        input['textArtifacts'][-1]['pages'][0]['blocks'][0]['text']+=' unchanged source evidence scope'
        second=wrapper.extract_source_declarations(input)
        first_fire=[d for d in first['declarations'] if d['kind']=='SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION']
        second_fire=[d for d in second['declarations'] if d['kind']=='SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION']
        self.assertTrue(all(a['textArtifactHash']!=b['textArtifactHash'] and a['id']!=b['id'] for a,b in zip(first_fire,second_fire)))
        first_fire[0]['headerFragments'][0]['bboxMilliPoints'][0]=-1
        self.assertNotEqual(first_fire[0]['headerFragments'],first_fire[1]['headerFragments'])
        self.assertEqual(wrapper.extract_source_declarations(before),expected_output())

    def test_coarse_ocr_union_and_partial_upper_table_abstain_six_not_partial(self):
        for mode in ['coarse','ocr','union','raw']:
            input=fixture_input();artifact=input['textArtifacts'][-1];page=artifact['pages'][50]
            if mode=='coarse':page['blocks'][0].pop('lineBboxesMilliPoints')
            elif mode=='ocr':
                page['quality']['disposition']='OCR_REQUIRED';artifact['qualitySummary']['textLayerCandidatePageCount']-=1;artifact['qualitySummary']['ocrRequiredPageCount']+=1
            elif mode=='union':page['blocks'][0]['bboxMilliPoints'][0]-=1
            else:page['blocks'][8]['text']=page['blocks'][8]['text'].replace('REI 60','REI ???')
            self.assertEqual(wrapper.extract_source_declarations(input)['declarations'],steel_output()['declarations'],mode)

    def test_native_malformed_claims_rejected_and_invalid_input_raises(self):
        input=fixture_input()
        for raw in [None,[],{'x':float('nan')},{'x':1.0},{'x':2**53},{'x':'\ud800'}]:
            self.assertIsNone(wrapper.validate_source_declarations(raw,input))
        cycle={};cycle['x']=cycle
        self.assertIsNone(wrapper.validate_source_declarations(cycle,input))
        with self.assertRaises(ValueError):wrapper.validate_source_declarations({},None)
        self.assertIs(wrapper.extract_source_declarations,wrapper.extract_source_declarations_v2)
        self.assertIs(wrapper.validate_source_declarations,wrapper.validate_source_declarations_v2)

if __name__=='__main__':unittest.main()
