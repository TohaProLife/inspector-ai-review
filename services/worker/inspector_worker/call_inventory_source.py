"""Independent T43 pure call-equipment inventory reconstruction.

An exact authored header/room/end grammar, not approval, physical absence or
functional conformity. The protected consumer authenticates source/origin/review.
No AR inventory reconstructor, comparator or future TypeScript implementation is
used. Whole input is bounded before application traversal; no partial output.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import re
from typing import Any

from inspector_worker.source_declarations import _valid_artifact
from inspector_worker.table_row_binding import _portable_error, _key, _text, read_table_row_page

EXTRACTOR_VERSION='matrix-odi123-call-inventory-source-v1'
POLICY_VERSION='matrix-odi123-call-inventory-literals-v1'
INVENTORY_SCHEMA_VERSION='matrix-odi123-call-inventory-source-v1'
RESULT_SCHEMA_VERSION='matrix-odi123-call-inventory-source-result-v1'
_SAFE=2**53-1
_SHA=re.compile(r'[a-f0-9]{64}\Z',re.ASCII)
_PAGE=re.compile(r'[1-9][0-9]{0,15}\Z',re.ASCII)
_SCOPE=re.compile(r'Санузел МГН: ([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\Z')
_HEADER='Перечень оборудования системы вызова персонала'
_END='Конец перечня оборудования системы вызова персонала'
_FEATURES={'Кнопка вызова персонала':'PERSONNEL_CALL_BUTTON',
           'Система двусторонней связи':'TWO_WAY_COMMUNICATION_SYSTEM'}
_FRAGMENT={'pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'}
_INPUT={'sourceFileId','sourceSha256','stage','pageStages','textArtifact','selection'}
_SELECTION={'pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'}


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'ABSTAIN','reasonCode':reason}


def _integer(value: Any, minimum: int=0) -> bool:
    return type(value) is int and minimum<=value<=_SAFE


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value)==4 and all(_integer(n) for n in value)
            and value[0]<value[2]<=width and value[1]<value[3]<=height)


def _contains(outer: list[int], inner: list[int]) -> bool:
    return outer[0]<=inner[0] and outer[1]<=inner[1] and inner[2]<=outer[2] and inner[3]<=outer[3]


def _intersects(a: list[int], b: list[int]) -> bool:
    return a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]


def _fragment(value: Any, width: int, height: int, region: list[int]) -> bool:
    return (type(value) is dict and set(value)==_FRAGMENT
            and _integer(value['pageNumber'],1) and _integer(value['blockIndex'])
            and _integer(value['lineIndex']) and _text(value['rawText'],line=True)
            and 0<len(value['rawText'])<=8192 and bool(value['rawText'].strip())
            and _box(value['bboxMilliPoints'],width,height)
            and _contains(region,value['bboxMilliPoints']))


def _hash(value: Any) -> str:
    encoded=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
    return hashlib.sha256(encoded.encode('utf-8')).hexdigest()


def reconstruct_odi123_call_inventory_source(input: Any) -> dict[str, Any]:
    """Reconstruct literal source rows without asserting scope completeness."""
    error=_portable_error(input)
    if error:
        return _abstain('INPUT_LIMIT' if error=='LIMIT' else 'INVALID_INPUT')
    if (type(input) is not dict or set(input)!=_INPUT or not _key(input.get('sourceFileId'))
            or type(input.get('sourceSha256')) is not str or not _SHA.fullmatch(input['sourceSha256'])
            or type(input.get('stage')) is not str or type(input.get('pageStages')) is not dict):
        return _abstain('INVALID_INPUT')
    page_stages=input['pageStages']
    if any(not _PAGE.fullmatch(key) or int(key)>_SAFE or type(stage) is not str
           or stage not in {'PD','RD','ID','UNRESOLVED'} for key,stage in page_stages.items()):
        return _abstain('INVALID_INPUT')
    artifact=input['textArtifact']
    if not _valid_artifact(artifact):
        return _abstain('INVALID_TEXT_ARTIFACT')
    if artifact['pageCount']>512:
        return _abstain('INPUT_LIMIT')
    if any(int(key)>artifact['pageCount'] for key in page_stages):
        return _abstain('INVALID_INPUT')
    if artifact['sourceFileId']!=input['sourceFileId'] or artifact['inputSha256']!=input['sourceSha256']:
        return _abstain('SOURCE_MISMATCH')
    if input['stage'] not in {'PD','RD'} or any(stage!=input['stage'] for stage in page_stages.values()):
        return _abstain('STAGE_UNRESOLVED')
    selection=input['selection']
    if (type(selection) is not dict or set(selection)!=_SELECTION
            or not _integer(selection.get('pageNumber'),1)
            or selection['pageNumber']>artifact['pageCount']):
        return _abstain('INVALID_SELECTION')
    page=artifact['pages'][selection['pageNumber']-1]
    width,height=page['widthMilliPoints'],page['heightMilliPoints']
    region=selection['regionBoxMilliPoints']
    if not _box(region,width,height):
        return _abstain('INVALID_SELECTION')
    for group in ('headerFragments','scopeFragments','endFragments'):
        fragments=selection[group]
        if (type(fragments) is not list or len(fragments)!=1
                or not _fragment(fragments[0],width,height,region)):
            return _abstain('INVALID_SELECTION')
    header=selection['headerFragments'][0]
    scope=selection['scopeFragments'][0]
    end=selection['endFragments'][0]
    if region!=[0,end['bboxMilliPoints'][1],width,header['bboxMilliPoints'][3]]:
        return _abstain('INVALID_SELECTION')
    reader=read_table_row_page(page)
    if reader['status']!='READY':
        return _abstain({'INVALID_PAGE':'INVALID_TEXT_ARTIFACT','PAGE_LIMIT':'INPUT_LIMIT'}.get(
            reader['reasonCode'],reader['reasonCode']))
    full_lines=[line for line in reader['lines'] if line['rawText'].strip()]
    intersects=[line for line in full_lines if _intersects(region,line['bboxMilliPoints'])]
    if len(intersects)>128:
        return _abstain('REGION_LINE_LIMIT')
    if any(not _contains(region,line['bboxMilliPoints']) for line in intersects):
        return _abstain('REGION_BOUNDARY_CROSSED')
    lines=sorted(intersects,key=lambda f:(-f['bboxMilliPoints'][1],f['bboxMilliPoints'][0],
                                         f['blockIndex'],f['lineIndex']))
    for previous,current in zip(lines,lines[1:]):
        gap=previous['bboxMilliPoints'][1]-current['bboxMilliPoints'][3]
        if not 0<=gap<=30000:
            return _abstain('AMBIGUOUS_LAYOUT')
    if (header['rawText']!=_HEADER or header not in full_lines or header not in lines
            or sum(line['rawText']==_HEADER for line in full_lines)!=1
            or not lines or lines[0]!=header):
        return _abstain('HEADER_UNVERIFIED')
    match=_SCOPE.fullmatch(scope['rawText'])
    if (not match or scope not in full_lines or scope not in lines
            or sum(bool(_SCOPE.fullmatch(line['rawText'])) for line in full_lines)!=1
            or len(lines)<2 or lines[1]!=scope):
        return _abstain('SCOPE_UNVERIFIED')
    if (end['rawText']!=_END or end not in full_lines or end not in lines
            or sum(line['rawText']==_END for line in full_lines)!=1
            or len(lines)<3 or lines[-1]!=end):
        return _abstain('END_UNVERIFIED')
    body=lines[2:-1]
    if not body:
        return _abstain('EMPTY_INVENTORY_UNVERIFIED')
    if any(line['rawText'] not in _FEATURES for line in body):
        return _abstain('UNSUPPORTED_BODY_ROW')
    features=[_FEATURES[line['rawText']] for line in body]
    if len(set(features))!=len(features):
        return _abstain('DUPLICATE_FEATURE')
    inventory={'schemaVersion':INVENTORY_SCHEMA_VERSION,'extractorVersion':EXTRACTOR_VERSION,
               'policyVersion':POLICY_VERSION,'sourceFileId':input['sourceFileId'],
               'sourceSha256':input['sourceSha256'],'textArtifactHash':_hash({
                   'hashDomain':'matrix-source-declaration-text-artifact-v1','textArtifact':artifact}),
               'stage':input['stage'],'pageNumber':page['pageNumber'],'widthMilliPoints':width,
               'heightMilliPoints':height,'regionBoxMilliPoints':deepcopy(region),
               'headerFragments':deepcopy(selection['headerFragments']),
               'scopeFragments':deepcopy(selection['scopeFragments']),
               'endFragments':deepcopy(selection['endFragments']),'roomToken':match.group(1),
               'featureRows':[{'featureKey':key,'fragments':[deepcopy(line)]}
                              for key,line in zip(features,body)]}
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'RECONSTRUCTED','inventory':inventory}
