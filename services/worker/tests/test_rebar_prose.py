from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.rebar_prose import EXTRACTOR_VERSION, extract_rebar_candidates

FIXTURE_PATH = Path(__file__).parent / 'fixtures/rebar-F0106-F0139.json'
FIXTURE = json.loads(FIXTURE_PATH.read_text())


def page(stage):
    source = next(x for x in FIXTURE['sources'] if x['source']['stage'] == stage)
    return copy.deepcopy(source['sourceArtifact']['pages'][source['provenance']['targetOriginalPdfPage'] - 1])


def edit(p, bi, li, old, new):
    lines = p['blocks'][bi]['text'].split('\n')
    assert old in lines[li]
    lines[li] = lines[li].replace(old, new)
    p['blocks'][bi]['text'] = '\n'.join(lines)


def union(block):
    boxes = block['lineBboxesMilliPoints']
    block['bboxMilliPoints'] = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                               max(b[2] for b in boxes), max(b[3] for b in boxes)]


def shift(p, bi, li, dx=0, dy=0):
    b = p['blocks'][bi]['lineBboxesMilliPoints'][li]
    p['blocks'][bi]['lineBboxesMilliPoints'][li] = [b[0]+dx, b[1]+dy, b[2]+dx, b[3]+dy]
    union(p['blocks'][bi])


def append(p, text, box=None):
    b = box or [1000, 1000, 20000, 13000]
    p['blocks'].append({'text': text, 'bboxMilliPoints': b[:], 'lineBboxesMilliPoints': [b[:]]})


class RebarProseTests(unittest.TestCase):
    def test_complete161_source_artifacts_and_manifest_gate(self):
        self.assertEqual(EXTRACTOR_VERSION, 'matrix-rebar-prose-v1')
        self.assertEqual(sum(len(s['sourceArtifact']['pages']) for s in FIXTURE['sources']), 161)
        for item in FIXTURE['sources']:
            s, a = item['source'], item['sourceArtifact']
            self.assertEqual((s['split'], s['distribution_status'], s['label_visibility']),
                             ('TRAIN_PUBLIC', 'INCLUDE', 'PUBLIC_TRAIN'))
            self.assertEqual(a['schemaVersion'], 'document-text-v2')
            self.assertEqual((a['sourceFileId'], a['inputSha256'], a['pageCount']),
                             (s['file_id'], s['sha256'], s['pdf_pages']))
            self.assertEqual([p['pageNumber'] for p in a['pages']], list(range(1, s['pdf_pages']+1)))
            raw = json.dumps(a, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item['provenance']['fullTextArtifactSha256'])

    def test_equal_real_originals_full_raw_scope(self):
        values = []
        for stage, primary, scopes, raw in [('PD', [(4,0),(5,0)], [(0,0),(3,0)], 'А500C'),
                                            ('RD', [(45,0)], [(1,3),(44,0),(32,11)], 'А500С')]:
            p = page(stage); f = extract_rebar_candidates(p, stage)
            self.assertEqual(len(f), 1)
            f = f[0]; values.append(f['value'])
            self.assertEqual(set(f), {'value','rawValue','rawUnit','canonicalUnit','primaryFragments','scopeFragments'})
            self.assertEqual(f['rawValue'], raw)
            self.assertIsNone(f['rawUnit']); self.assertEqual(f['canonicalUnit'], 'rebar_catalog_example')
            for name, expected in [('primaryFragments',primary), ('scopeFragments',scopes)]:
                self.assertEqual([(x['blockIndex'],x['lineIndex']) for x in f[name]], expected)
                for x in f[name]:
                    b = p['blocks'][x['blockIndex']]
                    self.assertEqual(x['rawText'], b['text'].split('\n')[x['lineIndex']])
                    self.assertEqual(x['bboxMilliPoints'], b['lineBboxesMilliPoints'][x['lineIndex']])
            self.assertNotIn('entityKey', f); self.assertNotIn('approved', f); self.assertNotIn('role', f)
        self.assertEqual(values, ['А500С','А500С'])

    def test_full161_scan_has_only_the_two_governing_candidates(self):
        found=[]
        for item in FIXTURE['sources']:
            for p in item['sourceArtifact']['pages']:
                for fact in extract_rebar_candidates(p,item['source']['stage']):
                    found.append((item['source']['file_id'],p['pageNumber'],fact['value']))
        self.assertEqual(found,[('F0106',50,'А500С'),('F0139',4,'А500С')])

    def test_only_six_explicit_glyph_aliases(self):
        aliases = {'А500C':'А500С','A500C':'А500С','A500С':'А500С','А500С':'А500С','A400':'А400','А400':'А400'}
        for stage, bi, old in [('PD',4,'А500C'),('RD',45,'А500С')]:
            for alias, canonical in aliases.items():
                with self.subTest(stage=stage,alias=alias):
                    p = page(stage); edit(p,bi,0,old,alias)
                    f = extract_rebar_candidates(p,stage)[0]
                    self.assertEqual((f['value'], f['rawValue']), (canonical,alias))

    def test_other_classes_ranges_lowercase_and_glyphs_abstain(self):
        for stage, bi, old in [('PD',4,'А500C'),('RD',45,'А500С')]:
            for value in ['А400С','A400C','А240','А500В','A500B','А500B','А500с','а500с','А 500С',
                          'А500С/А400','А500С или А400','А500С-А400','А500С (А400)','А500С, А400','Ø28А500С']:
                with self.subTest(stage=stage,value=value):
                    p=page(stage);edit(p,bi,0,old,value)
                    self.assertEqual(extract_rebar_candidates(p,stage),[])

    def test_wrong_declaration_standard_title_embedded_and_guide_wall(self):
        wrong = ['Прокат периодического профиля из арматурной стали класса A500C.',
                 'Арматурные стержни закладных деталей класса А500С по ГОСТ 34028-2016.',
                 'вязанными арматурными каркасами, основная рабочая арматура А400,',
                 'арматура А500С, конструктивная А240 по ГОСТ 34028-2016.',
                 'ГОСТ 380-2005. Арматура класса А500С и класса А240 по ГОСТ 34028-2016.']
        for stage, bi in [('PD',4),('RD',45)]:
            for text in wrong:
                p=page(stage);p['blocks'][bi]['text']=text
                self.assertEqual(extract_rebar_candidates(p,stage),[])

    def test_duplicates_malformed_governing_and_competing_clauses(self):
        for stage,bi in [('PD',4),('RD',45)]:
            for text in [page(stage)['blocks'][bi]['text'],'Арматура всех конструкций ???',
                         'Арматура для железобетонных конструкций ???','Арматура ???',
                         'Арматура класса А400 по ГОСТ 34028-2016.',
                         'Основная рабочая арматура А400, конструктивная А240.']:
                p=page(stage);append(p,text)
                self.assertEqual(extract_rebar_candidates(p,stage),[])
            p=page(stage);p['blocks'][bi]['text']+=' Арматура класса А400.'
            self.assertEqual(extract_rebar_candidates(p,stage),[])

    def test_missing_duplicate_wrong_or_ambiguous_scope(self):
        for stage, pairs in [('PD',[(0,0),(3,0)]),('RD',[(1,3),(44,0),(32,11)])]:
            for bi,li in pairs:
                p=page(stage);edit(p,bi,li,p['blocks'][bi]['text'].split('\n')[li],'Не определено.')
                self.assertEqual(extract_rebar_candidates(p,stage),[])
                p=page(stage);append(p,p['blocks'][bi]['text'].split('\n')[li])
                self.assertEqual(extract_rebar_candidates(p,stage),[])
        for old,new in [('Подземная часть','Надземная часть'),('всех корпусов','отдельного корпуса')]:
            p=page('PD');bi=0 if old=='Подземная часть' else 3;edit(p,bi,0,old,new)
            self.assertEqual(extract_rebar_candidates(p,'PD'),[])
        p=page('RD');edit(p,1,3,'подземной части','надземной части')
        self.assertEqual(extract_rebar_candidates(p,'RD'),[])

    def test_full_line_negation_quotes_alternative_and_tail_required(self):
        for stage,bi in [('PD',4),('RD',45)]:
            original=page(stage)['blocks'][bi]['text']
            for text in ['Не '+original,'«'+original+'»','"'+original+'"',original+' или А400.',
                         original.replace('Арматура','Арматура не',1),original+'\n']:
                p=page(stage);p['blocks'][bi]['text']=text
                self.assertEqual(extract_rebar_candidates(p,stage),[])
        p=page('RD');edit(p,45,0,' Армирование монолитных лестничных маршей и площадок выполняется отдельными стержнями с перевязкой их в местах пересечений','')
        self.assertEqual(extract_rebar_candidates(p,'RD'),[])

    def test_pd_continuation_strict_original_and_adjacency(self):
        for text in ['52544-2006','ГОСТ 52544-2006.','52544-2006. или А400','52544-2006.\n','34028-2016.']:
            p=page('PD');p['blocks'][5]['text']=text
            self.assertEqual(extract_rebar_candidates(p,'PD'),[])
        p=page('PD');p['blocks'][4],p['blocks'][5]=p['blocks'][5],p['blocks'][4]
        self.assertEqual(extract_rebar_candidates(p,'PD'),[])
        p=page('PD');p['blocks'].insert(5,{'text':'Лишняя строка','bboxMilliPoints':[100000,627800,200000,628800],
                                        'lineBboxesMilliPoints':[[100000,627800,200000,628800]]})
        self.assertEqual(extract_rebar_candidates(p,'PD'),[])

    def test_geometry_column_gap_overlap_height_guards(self):
        for stage,bi,li,dx,dy in [('PD',5,0,-40000,0),('PD',5,0,0,-10000),('PD',5,0,0,5000),
                                ('PD',0,0,3000,0),('PD',3,0,0,60000),('RD',44,0,5000,0),
                                ('RD',44,0,0,40000),('RD',1,3,50000,0),('RD',1,3,0,-200000),
                                ('RD',45,0,0,40000),('RD',32,11,0,8000),('RD',32,11,45000,0)]:
            p=page(stage);shift(p,bi,li,dx,dy)
            self.assertEqual(extract_rebar_candidates(p,stage),[],(stage,bi,dx,dy))
        for stage,bi in [('PD',4),('RD',45)]:
            for delta in [-3000,3000]:
                p=page(stage);p['blocks'][bi]['lineBboxesMilliPoints'][0][3]+=delta;union(p['blocks'][bi])
                self.assertEqual(extract_rebar_candidates(p,stage),[])
            p=page(stage);box=p['blocks'][bi]['lineBboxesMilliPoints'][0][:];append(p,'Лишняя строка',box)
            self.assertEqual(extract_rebar_candidates(p,stage),[])

    def test_rd_intervening_context_exact_no_numerical_class_inference(self):
        p=page('RD');f=extract_rebar_candidates(p,'RD')[0]
        self.assertEqual(f['scopeFragments'][2]['rawText'],
            'Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%.')
        self.assertEqual(f['value'],'А500С')
        for text in ['Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 60%.',
                     'Новая неизвестная строка.', '«Минимальная прочность бетона конструкций после снятия опалубки должна быть не менее 50%.»']:
            q=page('RD');edit(q,32,11,q['blocks'][32]['text'].split('\n')[11],text)
            self.assertEqual(extract_rebar_candidates(q,'RD'),[])
        p=page('RD');append(p,'Неизвестная вставка',[100000,550000,200000,553000])
        self.assertEqual(extract_rebar_candidates(p,'RD'),[])

    def test_scope_geometry_unknown_interleaving_and_coarse_boxes(self):
        for stage,bi,li in [('PD',0,0),('PD',3,0),('RD',1,3),('RD',44,0),('RD',32,11)]:
            p=page(stage);b=p['blocks'][bi]['lineBboxesMilliPoints'][li][:]
            append(p,'Посторонний текст',b)
            self.assertEqual(extract_rebar_candidates(p,stage),[])
        for bi in [1,32]:
            p=page('RD');p['blocks'][bi]['lineBboxesMilliPoints']=[p['blocks'][bi]['bboxMilliPoints'][:]]*len(p['blocks'][bi]['lineBboxesMilliPoints'])
            self.assertEqual(extract_rebar_candidates(p,'RD'),[])
        p=page('RD');append(p,'Арматура ???',[100000,550000,200000,553000])
        self.assertEqual(extract_rebar_candidates(p,'RD'),[])

    def test_invalid_whole_page_geometry_quality_shapes_fail_closed(self):
        for stage in ['PD','RD']:
            for mutate in [lambda p:p.update(pageNumber=True),lambda p:p.update(widthMilliPoints=2**53),
                           lambda p:p.update(extra='forged'),lambda p:p['quality'].update(disposition='OCR_REQUIRED'),
                           lambda p:p['blocks'][-1].update(lineBboxesMilliPoints=None),
                           lambda p:p['blocks'][-1].update(bboxMilliPoints=[0,0,1,1]),
                           lambda p:p['blocks'][-1]['lineBboxesMilliPoints'][0].__setitem__(0,False),
                           lambda p:p['blocks'][-1].update(text=p['blocks'][-1]['text']+'\r'),
                           lambda p:p['blocks'][-1].update(extra='forged')]:
                p=page(stage);mutate(p);self.assertEqual(extract_rebar_candidates(p,stage),[])
            self.assertEqual(extract_rebar_candidates(page(stage),'RD' if stage=='PD' else 'PD'),[])
        for p in [None,[],{},True]:self.assertEqual(extract_rebar_candidates(p,'PD'),[])
        for stage in ['',None,'pd','AS_BUILT']:self.assertEqual(extract_rebar_candidates(page('PD'),stage),[])

    def test_no_source_or_page_allowlist_and_input_and_return_isolation(self):
        for stage in ['PD','RD']:
            p=page(stage);p['pageNumber']=7
            before=copy.deepcopy(p);f=extract_rebar_candidates(p,stage)
            self.assertEqual(len(f),1);self.assertEqual(p,before)
            f[0]['primaryFragments'][0]['bboxMilliPoints'][0]=0
            f[0]['scopeFragments'][0]['rawText']='forged'
            self.assertEqual(p,before)
            self.assertNotEqual(f,extract_rebar_candidates(p,stage))


if __name__ == '__main__':unittest.main()
