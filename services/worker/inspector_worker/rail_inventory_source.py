"""Independent staged ODI120 literal rail inventory reconstruction.

Source-local mechanical evidence only; no complete/approved/entity/comparison
authority. Domain call/AR helpers are deliberately not imported.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import re
from typing import Any

from inspector_worker.source_declarations import _valid_artifact
from inspector_worker.table_row_binding import _portable_error, _key, _text, read_table_row_page

EXTRACTOR_VERSION='matrix-odi120-rail-inventory-source-v1'
INVENTORY_SCHEMA_VERSION=EXTRACTOR_VERSION
POLICY_VERSION='matrix-odi120-rail-inventory-literals-v1'
RESULT_SCHEMA_VERSION='matrix-odi120-rail-inventory-source-result-v1'
_SAFE=2**53-1
_SHA=re.compile(r'[a-f0-9]{64}\Z',re.ASCII)
_PAGE=re.compile(r'[1-9][0-9]{0,15}\Z',re.ASCII)
_SCOPE=re.compile(r'Санузел МГН: ([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\Z')
_HEADER='Перечень поручней доступного санузла'
_END='Конец перечня поручней доступного санузла'
_FEATURES=(
 ('WC_FIXED_RAIL',('Поручень стационарный','для унитаза')),
 ('WC_FOLDING_RAIL',('Поручень откидной','с бумагодержателем','для унитаза')),
 ('BASIN_RAIL',('Поручень для раковины',)),
)
_VOCAB=frozenset(line for _,group in _FEATURES for line in group)
_INPUT={'sourceFileId','sourceSha256','stage','pageStages','textArtifact','selection'}
_SELECTION={'pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'}
_FRAGMENT={'pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'}
_READER_MAP={'INVALID_PAGE':'INVALID_TEXT_ARTIFACT','PAGE_LIMIT':'INPUT_LIMIT',
 'TEXT_LAYER_UNAVAILABLE':'TEXT_LAYER_UNAVAILABLE',
 'LINE_GEOMETRY_UNAVAILABLE':'LINE_GEOMETRY_UNAVAILABLE',
 'LINE_GEOMETRY_INCONSISTENT':'LINE_GEOMETRY_INCONSISTENT'}


def _abstain(reason: str) -> dict[str,Any]:
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'ABSTAIN','reasonCode':reason}


def _integer(v: Any, minimum: int=0) -> bool:
    return type(v) is int and minimum<=v<=_SAFE


def _box(v: Any, width: int, height: int) -> bool:
    return (type(v) is list and len(v)==4 and all(_integer(n) for n in v)
            and v[0]<v[2]<=width and v[1]<v[3]<=height)


def _contains(a: list[int],b: list[int]) -> bool:
    return a[0]<=b[0] and a[1]<=b[1] and b[2]<=a[2] and b[3]<=a[3]


def _intersects(a: list[int],b: list[int]) -> bool:
    return a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]


def _fragment(v: Any,width: int,height: int,region: list[int]) -> bool:
    return (type(v) is dict and set(v)==_FRAGMENT
            and _integer(v['pageNumber'],1) and _integer(v['blockIndex']) and _integer(v['lineIndex'])
            and _text(v['rawText'],line=True) and 0<len(v['rawText'])<=8192
            and bool(v['rawText'].strip()) and _box(v['bboxMilliPoints'],width,height)
            and _contains(region,v['bboxMilliPoints']))


def _hash(v: Any) -> str:
    return hashlib.sha256(json.dumps(v,ensure_ascii=False,sort_keys=True,
        separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()


def reconstruct_odi120_rail_inventory_source(input: Any) -> dict[str,Any]:
    """Reconstruct all literal rows, or abstain without a partial inventory."""
    error=_portable_error(input)
    if error:return _abstain('INPUT_LIMIT' if error=='LIMIT' else 'INVALID_INPUT')
    if (type(input) is not dict or set(input)!=_INPUT or not _key(input.get('sourceFileId'))
            or type(input.get('sourceSha256')) is not str or not _SHA.fullmatch(input['sourceSha256'])
            or type(input.get('stage')) is not str or type(input.get('pageStages')) is not dict):
        return _abstain('INVALID_INPUT')
    stages=input['pageStages']
    if any(not _PAGE.fullmatch(k) or int(k)>_SAFE or type(v) is not str
           or v not in {'PD','RD','ID','UNRESOLVED'} for k,v in stages.items()):
        return _abstain('INVALID_INPUT')
    artifact=input['textArtifact']
    if not _valid_artifact(artifact):return _abstain('INVALID_TEXT_ARTIFACT')
    if artifact['pageCount']>512:return _abstain('INPUT_LIMIT')
    if artifact['sourceFileId']!=input['sourceFileId'] or artifact['inputSha256']!=input['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if any(int(k)>artifact['pageCount'] for k in stages):return _abstain('INVALID_INPUT')
    stage=input['stage']
    if stage not in {'PD','RD'} or any(v!=stage for v in stages.values()):
        return _abstain('STAGE_UNRESOLVED')
    selection=input['selection']
    if (type(selection) is not dict or set(selection)!=_SELECTION
            or not _integer(selection.get('pageNumber'),1)
            or selection['pageNumber']>artifact['pageCount']):
        return _abstain('INVALID_SELECTION')
    page=artifact['pages'][selection['pageNumber']-1]
    width,height=page['widthMilliPoints'],page['heightMilliPoints']
    region=selection['regionBoxMilliPoints']
    if not _box(region,width,height):return _abstain('INVALID_SELECTION')
    for k in ('headerFragments','scopeFragments','endFragments'):
        if (type(selection[k]) is not list or len(selection[k])!=1
                or not _fragment(selection[k][0],width,height,region)):
            return _abstain('INVALID_SELECTION')
    if region!=[0,selection['endFragments'][0]['bboxMilliPoints'][1],width,
                selection['headerFragments'][0]['bboxMilliPoints'][3]]:
        return _abstain('INVALID_SELECTION')
    read=read_table_row_page(page)
    if read['status']!='READY':return _abstain(_READER_MAP[read['reasonCode']])
    lines=[line for line in read['lines'] if line['rawText'].strip()]
    active=[line for line in lines if _intersects(line['bboxMilliPoints'],region)]
    if len(active)>128:return _abstain('REGION_LINE_LIMIT')
    if any(not _contains(region,line['bboxMilliPoints']) for line in active):
        return _abstain('REGION_BOUNDARY_CROSSED')
    active.sort(key=lambda line:(-line['bboxMilliPoints'][1],line['bboxMilliPoints'][0],line['blockIndex'],line['lineIndex']))
    for prior,current in zip(active,active[1:]):
        gap=prior['bboxMilliPoints'][1]-current['bboxMilliPoints'][3]
        if not 0<=gap<=30000:return _abstain('AMBIGUOUS_LAYOUT')
    headers=[line for line in lines if line['rawText']==_HEADER]
    if (len(headers)!=1 or selection['headerFragments'][0]!=headers[0]
            or not active or active[0]!=headers[0]):return _abstain('HEADER_UNVERIFIED')
    scopes=[line for line in lines if _SCOPE.fullmatch(line['rawText'])]
    if (len(scopes)!=1 or selection['scopeFragments'][0]!=scopes[0]
            or len(active)<2 or active[1]!=scopes[0]):return _abstain('SCOPE_UNVERIFIED')
    ends=[line for line in lines if line['rawText']==_END]
    if (len(ends)!=1 or selection['endFragments'][0]!=ends[0]
            or len(active)<3 or active[-1]!=ends[0]):return _abstain('END_UNVERIFIED')
    if any(line['rawText'] in _VOCAB and not _contains(region,line['bboxMilliPoints']) for line in lines):
        return _abstain('OUTSIDE_BODY_ROW')
    body=active[2:-1]
    if not body:return _abstain('EMPTY_INVENTORY_UNVERIFIED')
    rows=[];position=0;unsupported=False
    while position<len(body):
        matched=False
        for key,raw in _FEATURES:
            group=body[position:position+len(raw)]
            if (len(group)==len(raw) and tuple(f['rawText'] for f in group)==raw
                    and all(f['blockIndex']==group[0]['blockIndex']
                            and f['lineIndex']==group[0]['lineIndex']+i for i,f in enumerate(group))):
                rows.append({'featureKey':key,'fragments':deepcopy(group)})
                position+=len(raw);matched=True;break
        if not matched:unsupported=True;position+=1
    if unsupported:return _abstain('UNSUPPORTED_BODY_ROW')
    if len({r['featureKey'] for r in rows})!=len(rows):return _abstain('DUPLICATE_FEATURE')
    inventory={'schemaVersion':INVENTORY_SCHEMA_VERSION,'extractorVersion':EXTRACTOR_VERSION,
        'policyVersion':POLICY_VERSION,'sourceFileId':input['sourceFileId'],'sourceSha256':input['sourceSha256'],
        'textArtifactHash':_hash({'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact}),
        'stage':stage,'pageNumber':page['pageNumber'],'widthMilliPoints':width,'heightMilliPoints':height,
        'regionBoxMilliPoints':deepcopy(region),'headerFragments':deepcopy(selection['headerFragments']),
        'scopeFragments':deepcopy(selection['scopeFragments']),'endFragments':deepcopy(selection['endFragments']),
        'roomToken':_SCOPE.fullmatch(scopes[0]['rawText']).group(1),'featureRows':rows}
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'RECONSTRUCTED','inventory':inventory}
