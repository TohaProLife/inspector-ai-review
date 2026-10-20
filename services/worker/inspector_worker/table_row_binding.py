"""Pure geometric table links over one complete canonical source page.

Callers supply explicit table/column/row geometry and source-authored anchors.
This primitive neither recognizes values nor authenticates policy, source bytes,
semantic units, identity, review or parameter applicability. No nearest lookup.
"""
from __future__ import annotations
from typing import Any
from bisect import bisect_right

BINDER_VERSION = 'table-row-binding-v1'
POLICY_SCHEMA_VERSION = 'table-row-binding-policy-v1'
RESULT_SCHEMA_VERSION = 'table-row-binding-result-v1'
MAX_COLUMNS = 16
MAX_ROWS = 512
MAX_ANCHORS_PER_GROUP = 32
MAX_CELL_LINES = 32
MAX_TOTAL_ANCHORS = 2048
MAX_PAGE_BLOCKS = 8192
MAX_PAGE_LINES = 32768
MAX_TABLE_LINES = 2048
MAX_LINE_CODEPOINTS = 8192
MAX_PAGE_CODEPOINTS = 2_000_000
MAX_PAGE_UTF8_BYTES = 4_000_000
MAX_PORTABLE_NODES = 200_000
MAX_CONTAINER_ITEMS = 32768
MAX_PORTABLE_UTF8_BYTES = 8_000_000
MAX_PORTABLE_DEPTH = 64
_SAFE = 2**53 - 1
_METRICS = {'alphanumericCharacterCount', 'blockCount', 'disallowedControlCharacterCount',
            'nonWhitespaceCharacterCount', 'replacementCharacterCount'}


def _portable_error(value: Any) -> str | None:
    nodes=0; byte_count=0
    def visit(v: Any, depth: int, ancestors: frozenset[int]) -> str | None:
        nonlocal nodes, byte_count
        nodes+=1
        if nodes>MAX_PORTABLE_NODES or depth>MAX_PORTABLE_DEPTH:return 'LIMIT'
        if v is None or type(v) is bool:return None
        if type(v) is int:return None if abs(v)<=_SAFE else 'INVALID'
        if type(v) is str:
            if len(v)>MAX_PAGE_CODEPOINTS:return 'LIMIT'
            if any(0xd800<=ord(c)<=0xdfff for c in v):return 'INVALID'
            byte_count+=len(v.encode('utf-8'))
            return 'LIMIT' if byte_count>MAX_PORTABLE_UTF8_BYTES else None
        if type(v) not in (dict,list) or id(v) in ancestors:return 'INVALID'
        if len(v)>MAX_CONTAINER_ITEMS:return 'LIMIT'
        next_ancestors=ancestors|{id(v)}
        if type(v) is dict:
            for key,item in v.items():
                if type(key) is not str:return 'INVALID'
                error=visit(key,depth+1,next_ancestors) or visit(item,depth+1,next_ancestors)
                if error:return error
        else:
            for item in v:
                error=visit(item,depth+1,next_ancestors)
                if error:return error
        return None
    return visit(value,0,frozenset())


def _portable(value: Any) -> bool:
    return _portable_error(value) is None


def _integer(value: Any, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= _SAFE


def _text(value: Any, *, line: bool = False) -> bool:
    return (type(value) is str and not any(0xd800 <= ord(c) <= 0xdfff or
            ord(c) < 32 and c not in ('\t' if line else '\n\t') or c in '\u2028\u2029\ufffd'
            for c in value))


def _key(value: Any) -> bool:
    return _text(value, line=True) and 0 < len(value) <= 200 and value.strip() == value


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4 and all(_integer(x) for x in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _contains(outer: list[int], inner: list[int]) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and inner[2] <= outer[2] and inner[3] <= outer[3]


def _overlaps(a: list[int], b: list[int]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _ref(value: dict[str, Any]) -> tuple[int, int]:
    return value['blockIndex'], value['lineIndex']


def _order(value: dict[str, Any]) -> tuple[int, int, int, int, int, int]:
    b = value['bboxMilliPoints']
    return -b[3], b[0], -b[1], b[2], value['blockIndex'], value['lineIndex']


def _page_lines(page: Any) -> tuple[str | None, list[dict[str, Any]]]:
    portable_error=_portable_error(page)
    if portable_error:return ('PAGE_LIMIT' if portable_error=='LIMIT' else 'INVALID_PAGE'), []
    if (type(page) is not dict or set(page) != {
            'pageNumber','widthMilliPoints','heightMilliPoints','blocks','quality'}
            or any(not _integer(page.get(k), 1) for k in ('pageNumber','widthMilliPoints','heightMilliPoints'))
            or type(page.get('blocks')) is not list or type(page.get('quality')) is not dict):
        return 'INVALID_PAGE', []
    q = page['quality']
    if (set(q) != {'disposition','metrics','reasonCodes'} or type(q.get('disposition')) is not str
            or q['disposition'] not in {'TEXT_LAYER_CANDIDATE','OCR_REQUIRED'}
            or type(q.get('metrics')) is not dict or set(q['metrics']) != _METRICS
            or any(not _integer(n) for n in q['metrics'].values())
            or type(q.get('reasonCodes')) is not list or any(not _text(x, line=True) for x in q['reasonCodes'])):
        return 'INVALID_PAGE', []
    if q['metrics']['blockCount'] != len(page['blocks']): return 'INVALID_PAGE', []
    if q['disposition'] != 'TEXT_LAYER_CANDIDATE': return 'TEXT_LAYER_UNAVAILABLE', []
    if len(page['blocks']) > MAX_PAGE_BLOCKS: return 'PAGE_LIMIT', []
    lines = []; codepoints = 0; byte_count = 0
    for bi, block in enumerate(page['blocks']):
        if (type(block) is not dict or set(block) not in ({'text','bboxMilliPoints'},
                {'text','bboxMilliPoints','lineBboxesMilliPoints'}) or not _text(block.get('text'))
                or not _box(block.get('bboxMilliPoints'),page['widthMilliPoints'],page['heightMilliPoints'])):
            return 'INVALID_PAGE', []
        if 'lineBboxesMilliPoints' not in block: return 'LINE_GEOMETRY_UNAVAILABLE', []
        texts, boxes = block['text'].split('\n'), block['lineBboxesMilliPoints']
        codepoints += len(block['text']); byte_count += len(block['text'].encode('utf-8'))
        if (len(lines)+len(texts)>MAX_PAGE_LINES or codepoints>MAX_PAGE_CODEPOINTS or byte_count>MAX_PAGE_UTF8_BYTES
                or any(len(t)>MAX_LINE_CODEPOINTS for t in texts)): return 'PAGE_LIMIT', []
        if (type(boxes) is not list or len(boxes) != len(texts) or not boxes
                or any(not _box(x,page['widthMilliPoints'],page['heightMilliPoints']) for x in boxes)):
            return 'INVALID_PAGE', []
        union = [min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        if union != block['bboxMilliPoints']: return 'LINE_GEOMETRY_INCONSISTENT', []
        lines.extend({'pageNumber':page['pageNumber'],'blockIndex':bi,'lineIndex':li,
                      'rawText':text,'bboxMilliPoints':list(box)} for li,(text,box) in enumerate(zip(texts,boxes)))
    return None, lines


def _policy(policy: Any) -> None:
    if (not _portable(policy) or type(policy) is not dict or set(policy) != {
            'schemaVersion','tableBoxMilliPoints','columns','rows','maxLineGapMilliPoints'}
            or policy.get('schemaVersion') != POLICY_SCHEMA_VERSION
            or not _box(policy.get('tableBoxMilliPoints'),_SAFE,_SAFE)
            or not _integer(policy.get('maxLineGapMilliPoints'))
            or type(policy.get('columns')) is not list or not 2 <= len(policy['columns']) <= MAX_COLUMNS
            or type(policy.get('rows')) is not list or not 1 <= len(policy['rows']) <= MAX_ROWS):
        raise ValueError('invalid table row binding policy')
    table = policy['tableBoxMilliPoints']; keys=set(); refs=set(); previous=table[0]; labels=0; values=[]
    def anchors(items: Any) -> None:
        if type(items) is not list or not 1 <= len(items) <= MAX_ANCHORS_PER_GROUP: raise ValueError('invalid table row binding anchors')
        for a in items:
            if (type(a) is not dict or set(a) != {'blockIndex','lineIndex','rawText'}
                    or not _integer(a.get('blockIndex')) or not _integer(a.get('lineIndex'))
                    or not _text(a.get('rawText'), line=True) or not a['rawText'].strip()
                    or len(a['rawText'])>MAX_LINE_CODEPOINTS):
                raise ValueError('invalid table row binding anchor')
            if _ref(a) in refs: raise ValueError('duplicate table row binding anchor')
            if len(refs)>=MAX_TOTAL_ANCHORS:raise ValueError('table row binding anchor limit')
            refs.add(_ref(a))
    for col in policy['columns']:
        if (type(col) is not dict or set(col) != {'key','role','xRangeMilliPoints','headerAnchors','unitAnchors'}
                or not _key(col.get('key')) or col['key'] in keys
                or col.get('role') not in ('ROW_LABEL','VALUE')
                or type(col.get('xRangeMilliPoints')) is not list or len(col['xRangeMilliPoints']) != 2
                or any(not _integer(x) for x in col['xRangeMilliPoints'])):
            raise ValueError('invalid table row binding column')
        left,right=col['xRangeMilliPoints']
        if not previous <= left < right <= table[2]: raise ValueError('overlapping or unordered table columns')
        previous=right; keys.add(col['key']);anchors(col['headerAnchors'])
        if col['role']=='ROW_LABEL':
            labels+=1
            if col['unitAnchors'] != []: raise ValueError('label column cannot declare units')
        else: values.append(col['key']);anchors(col['unitAnchors'])
    if labels != 1: raise ValueError('table requires exactly one label column')
    keys=set(); previous=table[3];declared_values=0
    for row in policy['rows']:
        if (type(row) is not dict or set(row) != {'key','yRangeMilliPoints','labelAnchors','valueLineCounts'}
                or not _key(row.get('key')) or row['key'] in keys
                or type(row.get('yRangeMilliPoints')) is not list or len(row['yRangeMilliPoints']) != 2
                or any(not _integer(x) for x in row['yRangeMilliPoints'])
                or type(row.get('valueLineCounts')) is not dict or set(row['valueLineCounts']) != set(values)
                or any(not _integer(n,1) or n>MAX_CELL_LINES for n in row['valueLineCounts'].values())):
            raise ValueError('invalid table row binding row')
        bottom,top=row['yRangeMilliPoints']
        if not table[1] <= bottom < top <= previous: raise ValueError('overlapping or unordered table rows')
        previous=bottom;keys.add(row['key']);anchors(row['labelAnchors'])
        declared_values+=sum(row['valueLineCounts'].values())
        if declared_values+len(refs)>MAX_TABLE_LINES:raise ValueError('table row binding declared line limit')


def _abstain(reason: str) -> dict[str, Any]:
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'ABSTAIN','reasonCode':reason,'rows':[]}


def bind_table_rows(page: Any, policy: Any) -> dict[str, Any]:
    """Bind exact raw fragments within declared cells; fail the entire table.

    Invalid policy raises ValueError. Unusable/malformed source data returns a
    typed abstention. A BOUND result is geometric association only, never an
    interpretation of a unit/value or authentication of source applicability.
    """
    _policy(policy)
    error,lines=_page_lines(page)
    if error: return _abstain(error)
    table=policy['tableBoxMilliPoints']
    if not _box(table,page['widthMilliPoints'],page['heightMilliPoints']): return _abstain('TABLE_OUTSIDE_PAGE')
    active=[x for x in lines if x['rawText'].strip() and _overlaps(x['bboxMilliPoints'],table)]
    if len(active)>MAX_TABLE_LINES: return _abstain('TABLE_LINE_LIMIT')
    if any(not _contains(table,x['bboxMilliPoints']) for x in active): return _abstain('TABLE_BOUNDARY_CROSSING')
    sweep=[]
    for x in sorted(active,key=lambda z:(z['bboxMilliPoints'][1],z['bboxMilliPoints'][0])):
        box=x['bboxMilliPoints'];sweep=[y for y in sweep if y['bboxMilliPoints'][3]>box[1]]
        if any(_overlaps(box,y['bboxMilliPoints']) for y in sweep):return _abstain('OVERLAPPING_LINES')
        sweep.append(x)
    index={_ref(x):x for x in lines};used=set();columns=[]
    label=next(x for x in policy['columns'] if x['role']=='ROW_LABEL')
    def resolve(anchors: list[dict[str,Any]], box: list[int], minimum_bottom: int=0):
        resolved=[]
        for a in anchors:
            x=index.get(_ref(a))
            if x is None: return 'MISSING_ANCHOR',[]
            if x['rawText'] != a['rawText']: return 'ANCHOR_MISMATCH',[]
            if not _contains(box,x['bboxMilliPoints']) or x['bboxMilliPoints'][1] < minimum_bottom:
                return 'ANCHOR_OUTSIDE_CELL',[]
            resolved.append(x)
        if resolved != sorted(resolved,key=_order): return 'ANCHOR_ORDER',[]
        used.update(_ref(x) for x in resolved)
        return None,resolved
    for col in policy['columns']:
        box=[col['xRangeMilliPoints'][0],table[1],col['xRangeMilliPoints'][1],table[3]]
        e,headers=resolve(col['headerAnchors'],box,policy['rows'][0]['yRangeMilliPoints'][1])
        if e:return _abstain(e)
        e,units=resolve(col['unitAnchors'],box,policy['rows'][0]['yRangeMilliPoints'][1])
        if e:return _abstain(e)
        columns.append({'key':col['key'],'role':col['role'],'xRangeMilliPoints':list(col['xRangeMilliPoints']),
                        'headerFragments':headers,'unitFragments':units})
    column_starts=[c['xRangeMilliPoints'][0] for c in policy['columns']]
    bottom_rows=sorted((r['yRangeMilliPoints'][0],i) for i,r in enumerate(policy['rows']))
    row_starts=[x[0] for x in bottom_rows];cells_by_key={}
    for x in active:
        if _ref(x) in used:continue
        box=x['bboxMilliPoints'];ci=bisect_right(column_starts,box[0])-1
        ri=bisect_right(row_starts,box[1])-1
        if ci<0 or ri<0:continue
        row_index=bottom_rows[ri][1];col=policy['columns'][ci];row=policy['rows'][row_index]
        cell_box=[col['xRangeMilliPoints'][0],row['yRangeMilliPoints'][0],
                  col['xRangeMilliPoints'][1],row['yRangeMilliPoints'][1]]
        if _contains(cell_box,box):cells_by_key.setdefault((row_index,ci),[]).append(x)
    # Resolve every explicit label before evaluating cells, as the wire order
    # prescribes. No earlier cell failure can hide a later invalid source anchor.
    resolved_labels=[]
    for row in policy['rows']:
        bottom,top=row['yRangeMilliPoints'];lc=label['xRangeMilliPoints']
        e,anchors=resolve(row['labelAnchors'],[lc[0],bottom,lc[1],top])
        if e:return _abstain(e)
        resolved_labels.append(anchors)
    rows=[];seen_labels=set()
    for row_index,row in enumerate(policy['rows']):
        anchors=resolved_labels[row_index]
        label_text=tuple(x['rawText'] for x in anchors)
        if label_text in seen_labels:return _abstain('DUPLICATE_ROW_LABEL')
        seen_labels.add(label_text);cells=[]
        for column_index,col in enumerate(policy['columns']):
            cell=sorted(cells_by_key.get((row_index,column_index),[]),key=_order)
            if col['role']=='ROW_LABEL':
                if cell != anchors:return _abstain('UNEXPECTED_LABEL_CONTENT')
            elif len(cell) != row['valueLineCounts'][col['key']]:return _abstain('CELL_LINE_COUNT')
            if len({x['rawText'] for x in cell}) != len(cell):return _abstain('DUPLICATE_CELL_CONTENT')
            if col['role']=='VALUE' and any(a['bboxMilliPoints'][1]<b['bboxMilliPoints'][3] for a,b in zip(cell,cell[1:])):
                return _abstain('AMBIGUOUS_CELL_LINES')
            if any(a['bboxMilliPoints'][1]-b['bboxMilliPoints'][3]>policy['maxLineGapMilliPoints'] for a,b in zip(cell,cell[1:])):
                return _abstain('MULTILINE_GAP')
            used.update(_ref(x) for x in cell)
            cells.append({'columnKey':col['key'],'role':col['role'],'fragments':cell})
        rows.append({'key':row['key'],'yRangeMilliPoints':list(row['yRangeMilliPoints']),'cells':cells})
    if used != {_ref(x) for x in active}:return _abstain('UNASSIGNED_CONTENT')
    return {'schemaVersion':RESULT_SCHEMA_VERSION,'status':'BOUND','tableBoxMilliPoints':list(table),
            'columns':columns,'rows':rows}


def read_table_row_page(page: Any) -> dict[str, Any]:
    """Read complete copied source lines before consumers discover any policy.

    This exposes the same bounded canonical validation used by the binder. It
    authenticates neither original source bytes nor semantic table applicability.
    """
    error, lines = _page_lines(page)
    if error:
        return {'schemaVersion':'table-row-source-lines-v1','status':'ABSTAIN',
                'reasonCode':error,'lines':[]}
    return {'schemaVersion':'table-row-source-lines-v1','status':'READY',
            'pageNumber':page['pageNumber'],'widthMilliPoints':page['widthMilliPoints'],
            'heightMilliPoints':page['heightMilliPoints'],'lines':lines}
