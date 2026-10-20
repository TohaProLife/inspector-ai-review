from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.source_declarations import (
    canonical_source_declaration_json, extract_source_declarations,
    source_declaration_id, validate_source_declarations,
)

_BASE = Path(__file__).resolve().parent / 'fixtures/matrix-steel-v1'
_GOLDEN = json.loads((_BASE / 'research-wrapper-golden.json').read_text())


def fixture_input():
    return deepcopy(_GOLDEN['input'])


def expected_output():
    return deepcopy(_GOLDEN['expected'])


def _set_path(value, path, new):
    node = value
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = deepcopy(new)


class SourceDeclarationsTests(unittest.TestCase):
    def test_full43_independent_wrapper_golden_exact_and_immutable(self):
        input = fixture_input();before = deepcopy(input)
        result = extract_source_declarations(input)
        self.assertEqual(result, expected_output())
        self.assertEqual(validate_source_declarations(result, input), result)
        self.assertEqual(input, before)
        self.assertEqual(extract_source_declarations(input), result)
        self.assertEqual(input['sources'][1]['sectionCode'], 'OTHER')
        for d in result['declarations']:
            self.assertIsNone(d['entityKey']);self.assertEqual(d['applicabilityStatus'], 'UNREVIEWED')
            self.assertFalse(set(d) & {'attribute','parameterCode','ruleId','confidence','probability','coverage','qualified'})

    def test_empty_missing_and_partial_artifacts_are_normal(self):
        input=fixture_input();input['textArtifacts']=[]
        self.assertEqual(extract_source_declarations(input)['declarations'], [])
        input['sources']=[]
        self.assertEqual(extract_source_declarations(input)['declarations'], [])
        input=fixture_input();input['textArtifacts']=input['textArtifacts'][:1]
        self.assertEqual(extract_source_declarations(input)['declarations'],expected_output()['declarations'][:1])
        input['sources'][1]['pageStages']={'999':'PD'}
        self.assertEqual(len(extract_source_declarations(input)['declarations']),1)

    def test_stage_policy_single_only_and_contradictions_abstain(self):
        for stages in [[],['ID'],['UNRESOLVED'],['PD','RD'],['RD','PD'],['PD','ID']]:
            with self.subTest(stages=stages):
                input=fixture_input();input['sources'][0]['stages']=stages
                input['sources'][0]['pageStages']={'14':'PD'}
                self.assertEqual(extract_source_declarations(input)['declarations'], expected_output()['declarations'][1:])
        for override in ['RD','ID','UNRESOLVED']:
            input=fixture_input();input['sources'][0]['pageStages']={'1':override}
            self.assertEqual(extract_source_declarations(input)['declarations'],expected_output()['declarations'][1:])
        input=fixture_input();input['sources'][0]['pageStages']={'1':'PD','14':'PD','29':'PD'}
        self.assertEqual(extract_source_declarations(input),expected_output())
        del input['sources'][0]['pageStages']
        self.assertEqual(extract_source_declarations(input),expected_output())

    def test_trusted_metadata_extras_allowed_without_granting_approval(self):
        input=fixture_input()
        for s in input['sources']:
            s.update(reviewed=True, probability=0.99, somethingIgnored={'opaque':object()},
                     revisionStatus='CURRENT',approvalStatus='APPROVED',sectionCode='OTHER')
        self.assertEqual(extract_source_declarations(input),expected_output())

    def test_valid_coarse_geometry_and_inconsistent_union_abstain(self):
        for mode in ['missing-lines','valid-inconsistent-union','ocr']:
            input=fixture_input();p=input['textArtifacts'][0]['pages'][13]
            if mode=='missing-lines':p['blocks'][30].pop('lineBboxesMilliPoints')
            elif mode=='valid-inconsistent-union':p['blocks'][30]['bboxMilliPoints'][0]-=1
            else:
                p['quality']['disposition']='OCR_REQUIRED'
                input['textArtifacts'][0]['qualitySummary']['textLayerCandidatePageCount']-=1
                input['textArtifacts'][0]['qualitySummary']['ocrRequiredPageCount']+=1
            self.assertEqual(extract_source_declarations(input)['declarations'],expected_output()['declarations'][1:])

    def test_source_sort_uses_unicode_codepoints_not_utf16_or_locale(self):
        input=fixture_input()
        for i,sid in enumerate(['\U00010000','\ue000']):
            input['sources'][i]['sourceFileId']=sid;input['textArtifacts'][i]['sourceFileId']=sid
        result=extract_source_declarations(input)
        self.assertEqual([x['sourceFileId'] for x in result['declarations']],['\ue000','\U00010000'])
        input['sources'].reverse();input['textArtifacts'].reverse()
        self.assertEqual(extract_source_declarations(input),result)

    def test_source_id_python_whitespace_and_codepoint_length_portability(self):
        for sid,accepted in [('\x85edge',False),('edge\x1c',False),('\x1dedge',False),
                             ('\x1eedge',False),('edge\x1f',False),('\ufeffedge',True),
                             ('😀'*200,True),('😀'*201,False)]:
            input=fixture_input();input['sources'][0]['sourceFileId']=sid;input['textArtifacts'][0]['sourceFileId']=sid
            if accepted:
                result=extract_source_declarations(input)
                self.assertTrue(any(d['sourceFileId']==sid for d in result['declarations']))
            else:
                with self.assertRaises(ValueError):extract_source_declarations(input)

    def test_full_artifact_hash_covers_unselected_page_and_raw_spaces(self):
        input=fixture_input();before=expected_output();p=input['textArtifacts'][0]['pages'][0]
        p['blocks'][0]['text']=' '+p['blocks'][0]['text']
        result=extract_source_declarations(input)
        a,b=before['declarations'][0],result['declarations'][0]
        self.assertNotEqual(a['textArtifactHash'],b['textArtifactHash']);self.assertNotEqual(a['id'],b['id'])
        self.assertEqual(a['primaryFragments'],b['primaryFragments'])
        self.assertIsNone(validate_source_declarations(before,input))

    def test_output_does_not_alias_trusted_input_or_other_output(self):
        input=fixture_input();before=deepcopy(input);one=extract_source_declarations(input);two=extract_source_declarations(input)
        one['declarations'][0]['scopeFragments'][0]['bboxMilliPoints'][0]=-1
        one['declarations'][0]['productScope']['profile']='fake'
        self.assertEqual(input,before);self.assertEqual(extract_source_declarations(input),two)

    def test_domain_separated_id_excludes_only_id(self):
        body=expected_output()['declarations'][0];before=deepcopy(body)
        raw={k:v for k,v in body.items() if k!='id'}
        independent=hashlib.sha256(json.dumps({'hashDomain':'matrix-source-declaration-id-v1','declaration':raw},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(source_declaration_id(body),independent);body['id']='f'*64
        self.assertEqual(source_declaration_id(body),independent);body['unexpected']='hashed'
        self.assertNotEqual(source_declaration_id(body),independent)
        self.assertNotIn('unexpected',before)

    def test_canonical_ascii_numeric_keys_unicode_and_depth(self):
        self.assertEqual(canonical_source_declaration_json({'2':'д','10':'😀','A':True}),'{"10":"😀","2":"д","A":true}')
        self.assertEqual(canonical_source_declaration_json([None,False,2**53-1,-(2**53-1)]),'[null,false,9007199254740991,-9007199254740991]')
        value=1
        for _ in range(64):value=[value]
        self.assertIsInstance(canonical_source_declaration_json(value),str)
        with self.assertRaises(ValueError):canonical_source_declaration_json([value])
        shared=[];self.assertEqual(canonical_source_declaration_json([shared,shared]),'[[],[]]')

    def test_canonical_native_malformed_tree(self):
        cyclic=[];cyclic.append(cyclic)
        for value in [1.0,0.5,float('nan'),float('inf'),2**53,-2**53,'\ud800',{'кириллица':1},{2:'key'},(),object(),cyclic]:
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(ValueError):canonical_source_declaration_json(value)
        with self.assertRaises(ValueError):source_declaration_id([])

    def test_native_malformed_input_fails_stage_but_malformed_worker_claim_returns_none(self):
        for input in [None,[],True,{},'input']:
            with self.assertRaises(ValueError):extract_source_declarations(input)
            with self.assertRaises(ValueError):validate_source_declarations(expected_output(),input)
        input=fixture_input();input['textArtifacts'][0]['pages'][0]['widthMilliPoints']=float('nan')
        with self.assertRaises(ValueError):extract_source_declarations(input)
        for raw in [None,[],True,1.0,{},'artifact',{'surrogate':'\ud800'}]:
            self.assertIsNone(validate_source_declarations(raw,fixture_input()))


_INPUT_ATTACKS = [
 ('object-missing',['objectId'],''),('object-space',['objectId'],' spaced '),('manifest',['inputManifestHash'],'A'*64),
 ('source-missing-id',['sources',0,'sourceFileId'],''),('source-wrong-object',['sources',0,'objectId'],'other'),
 ('source-sha',['sources',0,'sha256'],'f'*64),('stages-none',['sources',0,'stages'],None),
 ('stages-unknown',['sources',0,'stages'],['BAD']),('stages-duplicate',['sources',0,'stages'],['PD','PD']),
 ('stages-nonstring',['sources',0,'stages'],[True]),('page-stages-null',['sources',0,'pageStages'],None),
 ('page-stages-zero',['sources',0,'pageStages'],{'0':'PD'}),('page-stages-leadingzero',['sources',0,'pageStages'],{'01':'PD'}),
 ('page-stages-wide-digit',['sources',0,'pageStages'],{'１':'PD'}),('page-stages-outside',['sources',0,'pageStages'],{'30':'PD'}),
 ('page-stages-unknown',['sources',0,'pageStages'],{'1':'BAD'}),('page-stages-nonstring',['sources',0,'pageStages'],{'1':1}),
 ('artifact-missing-id',['textArtifacts',0,'sourceFileId'],''),('artifact-orphan',['textArtifacts',0,'sourceFileId'],'orphan'),
 ('artifact-sha',['textArtifacts',0,'inputSha256'],'b'*64),('artifact-schema',['textArtifacts',0,'schemaVersion'],'document-text-v1'),
 ('artifact-coordinate',['textArtifacts',0,'coordinateSystem'],'TOP_LEFT'),('artifact-pagecount',['textArtifacts',0,'pageCount'],1),
 ('artifact-pagecount-bool',['textArtifacts',0,'pageCount'],True),('artifact-textpagecount',['textArtifacts',0,'textPageCount'],0),
 ('artifact-policy',['textArtifacts',0,'qualityPolicyVersion'],'unknown'),('summary-shape',['textArtifacts',0,'qualitySummary'],{}),
 ('summary-count',['textArtifacts',0,'qualitySummary','textLayerCandidatePageCount'],0),
 ('page-order',['textArtifacts',0,'pages',0,'pageNumber'],2),('page-number-bool',['textArtifacts',0,'pages',0,'pageNumber'],True),
 ('page-width-fraction',['textArtifacts',0,'pages',0,'widthMilliPoints'],0.5),('page-height-unsafe',['textArtifacts',0,'pages',0,'heightMilliPoints'],2**53),
 ('page-quality',['textArtifacts',0,'pages',0,'quality'],{}),('page-qualitymetrics',['textArtifacts',0,'pages',0,'quality','metrics'],{}),
 ('page-qualityreason',['textArtifacts',0,'pages',0,'quality','reasonCodes'],[1]),
 ('block-texttype',['textArtifacts',0,'pages',0,'blocks',0,'text'],None),
 ('block-linecount',['textArtifacts',0,'pages',0,'blocks',0,'lineBboxesMilliPoints'],[]),
 ('block-lineoutside',['textArtifacts',0,'pages',0,'blocks',0,'lineBboxesMilliPoints',0,0],-1),
 ('block-geometry-bool',['textArtifacts',0,'pages',0,'blocks',0,'bboxMilliPoints',0],True),
]


def _input_attack(case):
    name,path,value=case
    def method(self):
        input=fixture_input();_set_path(input,path,value)
        with self.assertRaises(ValueError,msg=name):extract_source_declarations(input)
        with self.assertRaises(ValueError,msg=name):validate_source_declarations(expected_output(),input)
    return method


_FORGERIES = [
 ('value',['value'],'С345'),('rawvalue',['rawValue'],'C345'),('rawunit',['rawUnit'],'MPa'),
 ('unit',['canonicalUnit'],'m'),('stage',['stage'],'RD'),('source',['sourceFileId'],'different'),
 ('sha',['sourceSha256'],'f'*64),('texthash',['textArtifactHash'],'f'*64),('entity',['entityKey'],'forged'),
 ('applicability',['applicabilityStatus'],'APPROVED'),('profile',['productScope','profile'],'70Б2'),
 ('tier',['productScope','tier'],1),('standard',['productScope','gradeStandard'],'ГОСТ 27772-2021'),
 ('role',['productScope','role'],'PIPE'),('context-raw',['scopeFragments',0,'rawText'],'forged'),
 ('primary-raw',['primaryFragments',0,'rawText'],'forged'),('context-box',['scopeFragments',0,'bboxMilliPoints',0],1),
 ('parameter',['parameterCode'],'KR-056'),('rule',['ruleId'],'matrix-kr-056-steel'),('probability',['probability'],1),
 ('confidence',['confidence'],99),('attribute',['attribute'],'STEEL_CLASS'),('qualified',['qualified'],True),
]


def _forgery(case):
    name,path,value=case
    def method(self):
        raw=expected_output();_set_path(raw['declarations'][0],path,value)
        raw['declarations'][0]['id']=source_declaration_id(raw['declarations'][0])
        self.assertIsNone(validate_source_declarations(raw,fixture_input()),name)
    return method


for _i,_case in enumerate(_INPUT_ATTACKS):setattr(SourceDeclarationsTests,f'test_input_attack_{_i:02d}_{_case[0]}',_input_attack(_case))
for _i,_case in enumerate(_FORGERIES):setattr(SourceDeclarationsTests,f'test_recomputed_forgery_{_i:02d}_{_case[0]}',_forgery(_case))


class SourceDeclarationsShapeTests(unittest.TestCase):
    def test_duplicate_or_unknown_artifacts_sources_raise_even_excluded_stage(self):
        for kind in ['source','artifact','orphan','malformed-ID-stage']:
            input=fixture_input()
            if kind=='source':input['sources'].append(deepcopy(input['sources'][0]))
            elif kind=='artifact':input['textArtifacts'].append(deepcopy(input['textArtifacts'][0]))
            elif kind=='orphan':input['sources']=input['sources'][1:]
            else:input['sources'][0]['stages']=['ID'];input['textArtifacts'][0]['pages'][0]['extra']=True
            with self.assertRaises(ValueError):extract_source_declarations(input)

    def test_missing_extra_reordered_declarations_or_fields_never_valid(self):
        for kind in ['drop','duplicate','order','scopeorder','scopemissing','primarymissing','extra-envelope','wrong-object','wrong-manifest','extra-product','missing-id']:
            raw=expected_output()
            if kind=='drop':raw['declarations'].pop()
            elif kind=='duplicate':raw['declarations'].append(deepcopy(raw['declarations'][0]))
            elif kind=='order':raw['declarations'].reverse()
            elif kind=='scopeorder':raw['declarations'][0]['scopeFragments'].reverse()
            elif kind=='scopemissing':raw['declarations'][0]['scopeFragments'].pop()
            elif kind=='primarymissing':raw['declarations'][0]['primaryFragments']=[]
            elif kind=='extra-envelope':raw['coverage']=1
            elif kind=='wrong-object':raw['objectId']='other'
            elif kind=='wrong-manifest':raw['inputManifestHash']='f'*64
            elif kind=='extra-product':raw['declarations'][0]['productScope']['reviewed']=True
            else:raw['declarations'][0].pop('id')
            for d in raw['declarations']:
                if 'id' in d:d['id']=source_declaration_id(d)
            self.assertIsNone(validate_source_declarations(raw,fixture_input()),kind)


if __name__=='__main__':unittest.main()
