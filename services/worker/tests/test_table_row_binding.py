"""Contract tests for a pure geometric primitive, without rule integration."""
from __future__ import annotations
import json
import time
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from inspector_worker import table_row_binding as binder

BASE=Path(__file__).parent/'fixtures'/'table-row-binding-v1'
GOLDEN=json.loads((BASE/'portable-goldens.json').read_text())


def apply_operations(page,policy,operations):
    for operation in operations:
        current=page if operation['target']=='page' else policy
        for key in operation['path'][:-1]:current=current[key]
        key=operation['path'][-1]
        if operation['op']=='set':current[key]=deepcopy(operation['value'])
        elif operation['op']=='delete':del current[key]
        elif operation['op']=='append':current[key].append(deepcopy(operation['value']))
        else:raise AssertionError('unknown test operation')


def fresh():return deepcopy(GOLDEN['page']),deepcopy(GOLDEN['policy'])
def abstention(reason):return {'schemaVersion':'table-row-binding-result-v1','status':'ABSTAIN','reasonCode':reason,'rows':[]}
def one_block(text,box):return {'text':text,'bboxMilliPoints':box,'lineBboxesMilliPoints':[deepcopy(box)]}
def dense_fixture(rows=512):
    page,policy=fresh();page['heightMilliPoints']=100000
    page['blocks']=[one_block('Label',[100,99000,200,99020]),one_block('Value',[400,99000,500,99020]),one_block('unit',[400,98900,500,98920])]
    policy['tableBoxMilliPoints']=[90,100,600,99500];policy['rows']=[]
    for i in range(rows):
        y=98000-i*150;bi=len(page['blocks']);label=f'raw label {i}'
        page['blocks'] += [one_block(label,[100,y,250,y+20]),one_block(str(i),[400,y,450,y+20])]
        policy['rows'].append({'key':str(i),'yRangeMilliPoints':[y-10,y+30],'labelAnchors':[{'blockIndex':bi,'lineIndex':0,'rawText':label}],'valueLineCounts':{'values':1}})
    for i,raw in enumerate(['Label','Value','unit']):
        # Anchor placement remains explicit, never discovered from nearest cells.
        if i==0:policy['columns'][0]['headerAnchors'][0]['rawText']=raw
        elif i==1:policy['columns'][1]['headerAnchors'][0]['rawText']=raw
        else:policy['columns'][1]['unitAnchors'][0]['rawText']=raw
    page['quality']['metrics']['blockCount']=len(page['blocks'])
    return page,policy


class TableRowBindingPortableTest(unittest.TestCase):
    pass


def portable_test(vector):
    def test(self):
        page,policy=fresh();apply_operations(page,policy,vector['operations'])
        before=deepcopy((page,policy));expected=vector['expected']
        if expected=={'throws':'ValueError'}:
            with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)
        else:
            self.assertEqual(binder.bind_table_rows(page,policy),expected)
            self.assertEqual(binder.bind_table_rows(page,policy),expected)
        self.assertEqual((page,policy),before)
    return test


for index,vector in enumerate(GOLDEN['vectors']):
    setattr(TableRowBindingPortableTest,f'test_{index:03d}_{vector["name"].replace("-","_")}',portable_test(vector))


class TableRowBindingNativeTest(unittest.TestCase):
    def assert_page_rejects(self,change,reason='INVALID_PAGE'):
        page,policy=fresh();change(page)
        self.assertEqual(binder.bind_table_rows(page,policy),abstention(reason))

    def test_real_complete_pages_and_byte_equal_original_fragments(self):
        for name,rows,blocks in [('fire-requirements-F0106-p51.json',6,26),('ground-areas-F0126-p20.json',4,265)]:
            with self.subTest(name=name):
                fixture=json.loads((BASE/name).read_text());page=fixture['page'];policy=fixture['policy']
                before=json.dumps([page,policy],ensure_ascii=False,separators=(',',':')).encode()
                result=binder.bind_table_rows(page,policy)
                self.assertEqual(result,fixture['expected']);self.assertEqual(len(result['rows']),rows)
                self.assertEqual(len(page['blocks']),blocks);self.assertTrue(fixture['provenance']['pageComplete'])
                fragments=[f for c in result['columns'] for key in ('headerFragments','unitFragments') for f in c[key]]
                fragments += [f for row in result['rows'] for cell in row['cells'] for f in cell['fragments']]
                self.assertEqual(len({(f['blockIndex'],f['lineIndex']) for f in fragments}),len(fragments))
                for f in fragments:
                    block=page['blocks'][f['blockIndex']]
                    self.assertEqual(f['rawText'].encode('utf-8'),block['text'].split('\n')[f['lineIndex']].encode('utf-8'))
                    self.assertEqual(f['bboxMilliPoints'],block['lineBboxesMilliPoints'][f['lineIndex']])
                self.assertEqual(before,json.dumps([page,policy],ensure_ascii=False,separators=(',',':')).encode())
                # Outputs own all nested containers; caller edits cannot mutate authentic input.
                fragments[0]['bboxMilliPoints'][0]+=1
                self.assertEqual(before,json.dumps([page,policy],ensure_ascii=False,separators=(',',':')).encode())
                self.assertEqual(binder.bind_table_rows(page,policy),fixture['expected'])

    def test_real_tables_have_no_semantic_result_fields(self):
        forbidden={'parameterCode','attribute','rule','entityKey','confidence','probability','coverage','approvedScope','sourceFileId','sourceSha256','id','value'}
        for name in ['fire-requirements-F0106-p51.json','ground-areas-F0126-p20.json']:
            fixture=json.loads((BASE/name).read_text());result=binder.bind_table_rows(fixture['page'],fixture['policy'])
            def visit(v):
                if type(v) is dict:
                    self.assertFalse(forbidden.intersection(v))
                    for item in v.values():visit(item)
                elif type(v) is list:
                    for item in v:visit(item)
            visit(result)

    def test_native_integral_float_rejected_no_json_lexical_claim(self):
        self.assert_page_rejects(lambda p:p.update(pageNumber=1.0))

    def test_native_nonfinite_floats_rejected(self):
        for value in [float('nan'),float('inf'),float('-inf')]:
            with self.subTest(value=value):self.assert_page_rejects(lambda p:p.update(pageNumber=value))

    def test_native_surrogate_value_and_key_rejected(self):
        self.assert_page_rejects(lambda p:p['blocks'][4].update(text='\ud800'))
        self.assert_page_rejects(lambda p:p.update({'\udfff':None}))

    def test_native_cycles_rejected_without_recursion_error(self):
        self.assert_page_rejects(lambda p:p.update(cycle=p))
        page,policy=fresh();policy['cycle']=policy
        with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)

    def test_native_arbitrary_object_not_traversed(self):
        class Explosive:
            @property
            def blocks(self):raise AssertionError('property accessed')
            def __iter__(self):raise AssertionError('object iterated')
        _,policy=fresh();self.assertEqual(binder.bind_table_rows(Explosive(),policy),abstention('INVALID_PAGE'))

    def test_native_dict_subclass_not_traversed(self):
        class ExplosiveDict(dict):
            def items(self):raise AssertionError('items accessed')
            def __iter__(self):raise AssertionError('iterated')
        page,policy=fresh();self.assertEqual(binder.bind_table_rows(ExplosiveDict(page),policy),abstention('INVALID_PAGE'))
        with self.assertRaises(ValueError):binder.bind_table_rows(page,ExplosiveDict(policy))

    def test_native_list_and_integer_subclasses_rejected(self):
        class SubList(list):pass
        class SubInt(int):pass
        self.assert_page_rejects(lambda p:p.update(blocks=SubList(p['blocks'])))
        self.assert_page_rejects(lambda p:p.update(pageNumber=SubInt(1)))

    def test_native_tuple_set_bytes_rejected(self):
        for value in [(1,2),{1,2},b'raw']:
            with self.subTest(type=type(value).__name__):self.assert_page_rejects(lambda p:p.update(quality=value))

    def test_shared_noncyclic_containers_are_allowed(self):
        page,policy=fresh();box=page['blocks'][4]['bboxMilliPoints'];page['blocks'][4]['lineBboxesMilliPoints'][0]=box
        self.assertEqual(binder.bind_table_rows(page,policy),GOLDEN['vectors'][0]['expected'])

    def test_invalid_policy_precedes_invalid_page_without_traversal(self):
        class Explosive:
            def __iter__(self):raise AssertionError('page accessed')
        with self.assertRaises(ValueError):binder.bind_table_rows(Explosive(),{})

    def test_depth_limit_before_page_shape(self):
        def change(page):
            current={};page['deep']=current
            for _ in range(65):current['next']={};current=current['next']
        self.assert_page_rejects(change,'PAGE_LIMIT')

    def test_wide_container_limit_before_page_shape(self):
        self.assert_page_rejects(lambda p:p.update(wide=[None]*32769),'PAGE_LIMIT')

    def test_portable_node_limit(self):
        # Small individual containers, but >200000 scalar nodes in total.
        self.assert_page_rejects(lambda p:p.update(nodes=[[None]*1000 for _ in range(201)]),'PAGE_LIMIT')

    def test_portable_utf8_limit(self):
        self.assert_page_rejects(lambda p:p.update(bytes=['🙂'*1000000]*3),'PAGE_LIMIT')

    def test_block_limit(self):
        page,policy=fresh();page['blocks']=[one_block('x',[700,100,710,110])]*8193
        page['quality']['metrics']['blockCount']=8193
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('PAGE_LIMIT'))

    def test_line_limit(self):
        page,policy=fresh();page['blocks']=[{'text':'\n'*8191,'bboxMilliPoints':[700,100,710,110],'lineBboxesMilliPoints':[[700,100,710,110]]*8192}]*5
        page['quality']['metrics']['blockCount']=5
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('PAGE_LIMIT'))

    def test_line_codepoint_limit(self):
        self.assert_page_rejects(lambda p:p['blocks'][4].update(text='x'*8193),'PAGE_LIMIT')

    def test_page_text_codepoint_limit(self):
        page,policy=fresh();page['blocks']=[one_block('x'*8000,[700,100,710,110]) for _ in range(251)]
        page['quality']['metrics']['blockCount']=251
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('PAGE_LIMIT'))

    def test_page_text_utf8_limit(self):
        page,policy=fresh();page['blocks']=[one_block('🙂'*8000,[700,100,710,110]) for _ in range(126)]
        page['quality']['metrics']['blockCount']=126
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('PAGE_LIMIT'))

    def test_table_line_limit_precedes_overlap(self):
        page,policy=fresh();page['blocks'] += [one_block('x',[100,600,110,610]) for _ in range(2049)]
        page['quality']['metrics']['blockCount']=len(page['blocks'])
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('TABLE_LINE_LIMIT'))

    def test_policy_rows_columns_anchors_limits(self):
        for mutator in [lambda q:q.update(rows=q['rows']*257),lambda q:q.update(columns=q['columns']*9),lambda q:q['columns'][0].update(headerAnchors=[{'blockIndex':100+i,'lineIndex':0,'rawText':'x'} for i in range(33)])]:
            page,policy=fresh();mutator(policy)
            with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)

    def test_declared_lines_limit_before_source_access(self):
        page,policy=dense_fixture(512)
        for row in policy['rows']:row['valueLineCounts']['values']=4
        with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)

    def test_max_rows_have_bounded_geometry_work(self):
        page,policy=dense_fixture(512);before=deepcopy((page,policy))
        with patch.object(binder,'_overlaps',wraps=binder._overlaps) as overlaps,patch.object(binder,'_contains',wraps=binder._contains) as contains:
            start=time.perf_counter();result=binder.bind_table_rows(page,policy);elapsed=time.perf_counter()-start
        self.assertEqual(result['status'],'BOUND');self.assertEqual(len(result['rows']),512)
        self.assertLess(overlaps.call_count,5000);self.assertLess(contains.call_count,5000)
        self.assertLess(elapsed,5.0);self.assertEqual((page,policy),before)

    def test_anchor_owns_one_role_even_when_text_same(self):
        page,policy=fresh();policy['rows'][0]['labelAnchors']=[deepcopy(policy['columns'][0]['headerAnchors'][0])]
        with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)

    def test_header_boundary_exact_contact_allowed(self):
        page,policy=fresh();page['blocks'][2]=one_block('u',[400,680,450,700])
        self.assertEqual(binder.bind_table_rows(page,policy)['status'],'BOUND')

    def test_no_hidden_semantic_gate_on_original_values(self):
        page,policy=fresh()
        for raw in ['REI 150','В25','С345','arbitrary🙂','000','-1.2','<R']:
            page['blocks'][4]['text']=raw
            result=binder.bind_table_rows(page,policy)
            self.assertEqual(result['status'],'BOUND');self.assertEqual(result['rows'][0]['cells'][1]['fragments'][0]['rawText'],raw)

    def test_two_valid_regions_do_not_claim_full_table_completeness(self):
        page,policy=fresh();full=binder.bind_table_rows(page,policy)
        policy['rows']=policy['rows'][:1];policy['tableBoxMilliPoints'][1]=640
        narrow=binder.bind_table_rows(page,policy)
        self.assertEqual(full['status'],'BOUND');self.assertEqual(narrow['status'],'BOUND')
        self.assertEqual(len(full['rows']),2);self.assertEqual(len(narrow['rows']),1)
        self.assertNotIn('complete',narrow)

    def test_multiple_value_columns_are_independent_and_explicit(self):
        page,policy=fresh();policy['tableBoxMilliPoints'][2]=950
        page['blocks'] += [one_block('Secondary',[700,800,900,820]),one_block('other unit',[700,770,900,790]),one_block('left raw',[700,650,900,670]),one_block('right raw',[700,550,900,570])]
        page['quality']['metrics']['blockCount']=11
        policy['columns'].append({'key':'other','role':'VALUE','xRangeMilliPoints':[650,950],'headerAnchors':[{'blockIndex':7,'lineIndex':0,'rawText':'Secondary'}],'unitAnchors':[{'blockIndex':8,'lineIndex':0,'rawText':'other unit'}]})
        for row in policy['rows']:row['valueLineCounts']['other']=1
        result=binder.bind_table_rows(page,policy)
        self.assertEqual(result['status'],'BOUND')
        self.assertEqual([r['cells'][2]['fragments'][0]['blockIndex'] for r in result['rows']],[9,10])
        self.assertEqual([r['cells'][1]['fragments'][0]['blockIndex'] for r in result['rows']],[4,6])

    def test_row_label_column_need_not_be_leftmost(self):
        page,policy=fresh()
        for i in [0,3,5]:
            for box in [page['blocks'][i]['bboxMilliPoints'],*page['blocks'][i]['lineBboxesMilliPoints']]:box[0]+=300;box[2]+=300
        for i in [1,2,4,6]:
            for box in [page['blocks'][i]['bboxMilliPoints'],*page['blocks'][i]['lineBboxesMilliPoints']]:box[0]-=300;box[2]-=300
        # JSON fixture boxes are independent containers; all source references stay unchanged.
        policy['columns'][0]['xRangeMilliPoints']=[350,600]
        policy['columns'][1]['xRangeMilliPoints']=[90,300]
        policy['columns'].reverse()
        result=binder.bind_table_rows(page,policy)
        self.assertEqual(result['status'],'BOUND')
        self.assertEqual(result['rows'][0]['cells'][0]['fragments'][0]['blockIndex'],4)
        self.assertEqual(result['rows'][0]['cells'][1]['fragments'][0]['blockIndex'],3)

    def test_unicode_key_edge_whitespace_and_bom(self):
        for prefix in ['\u0085','\x1c','\u00a0']:
            page,policy=fresh();policy['rows'][0]['key']=prefix+'row'
            with self.assertRaises(ValueError):binder.bind_table_rows(page,policy)
        page,policy=fresh();policy['rows'][0]['key']='\ufeffrow'
        self.assertEqual(binder.bind_table_rows(page,policy)['status'],'BOUND')

    def test_all_explicit_labels_resolve_before_any_cell_failure(self):
        page,policy=fresh();page['blocks'][4]['text']=' '
        page['blocks'][5]['text']='changed second source label'
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('ANCHOR_MISMATCH'))
        policy['rows'][1]['labelAnchors'][0]['rawText']='changed second source label'
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('CELL_LINE_COUNT'))

    def test_quality_shape_and_count_precede_ocr_and_block_cap(self):
        page,policy=fresh();page['quality']['disposition']='OCR_REQUIRED'
        page['quality']['metrics']['blockCount']=8
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('INVALID_PAGE'))
        page['quality']['metrics']['blockCount']=7
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('TEXT_LAYER_UNAVAILABLE'))
        page,policy=fresh();page['blocks']=[one_block('x',[700,100,710,110])]*8193
        del page['quality']['metrics']['replacementCharacterCount']
        self.assertEqual(binder.bind_table_rows(page,policy),abstention('INVALID_PAGE'))


class TableRowSourceReaderTest(unittest.TestCase):
    def test_complete_real_page_lines_byte_equal_in_original_order(self):
        for name in ['fire-requirements-F0106-p51.json','ground-areas-F0126-p20.json']:
            fixture=json.loads((BASE/name).read_text());page=fixture['page'];before=deepcopy(page)
            result=binder.read_table_row_page(page)
            self.assertEqual(set(result),{'schemaVersion','status','pageNumber','widthMilliPoints','heightMilliPoints','lines'})
            self.assertEqual(result['schemaVersion'],'table-row-source-lines-v1');self.assertEqual(result['status'],'READY')
            expected=[]
            for bi,block in enumerate(page['blocks']):
                for li,raw in enumerate(block['text'].split('\n')):
                    expected.append({'pageNumber':page['pageNumber'],'blockIndex':bi,'lineIndex':li,'rawText':raw,'bboxMilliPoints':block['lineBboxesMilliPoints'][li]})
            self.assertEqual(result['lines'],expected);self.assertEqual(page,before)

    def test_invalid_or_hostile_source_never_returns_partial_lines(self):
        class Hostile(dict):
            def items(self):raise AssertionError('native code invoked')
        page,_=fresh()
        for invalid,reason in [(Hostile(page),'INVALID_PAGE'),(None,'INVALID_PAGE')]:
            self.assertEqual(binder.read_table_row_page(invalid),{'schemaVersion':'table-row-source-lines-v1','status':'ABSTAIN','reasonCode':reason,'lines':[]})
        page['blocks'][-1]['bboxMilliPoints'][0]-=1
        self.assertEqual(binder.read_table_row_page(page),{'schemaVersion':'table-row-source-lines-v1','status':'ABSTAIN','reasonCode':'LINE_GEOMETRY_INCONSISTENT','lines':[]})

    def test_reader_and_source_boxes_have_no_shared_mutable_containers(self):
        page,_=fresh();before=deepcopy(page)
        first=binder.read_table_row_page(page);second=binder.read_table_row_page(page)
        first['lines'][0]['bboxMilliPoints'][0]+=1;first['lines'].clear()
        self.assertEqual(page,before)
        self.assertEqual(binder.read_table_row_page(page),second)


if __name__=='__main__':unittest.main()
