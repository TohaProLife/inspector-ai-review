"""Narrow source-authored upper fire table evidence, without qualification.

The versioned layout recognizes six explicit construction-category labels and
literal headers. Policy derives solely from their original geometry. Values are
read only after the neutral table binder succeeds. No physical member identity,
protection composition, achieved fire performance, ranking or rule is inferred.
"""
from __future__ import annotations

import re
from typing import Any
from .table_row_binding import bind_table_rows, read_table_row_page

EXTRACTOR_VERSION = 'matrix-fire-resistance-table-v1'
BINDING_POLICY_VERSION = 'matrix-fire-resistance-upper-table-v1'
_SAFE = 2**53 - 1
_SPACE = re.compile(r'[ \t\u00a0\u202f]+')
_VALUE = re.compile(r'(?P<criterion>REI|R)[ ]+(?P<minutes>[1-9][0-9]{0,15})\Z')
_HEADERS = ('Наименование строительной конструкции', 'Предел огнестойкости,')
_ROWS = (
    ('load-bearing-elements', ('Несущие стены, колонны и другие несущие элементы',)),
    ('fire-compartment-slabs', ('Перекрытия междуэтажные, разделяющие здание на', 'пожарные отсеки')),
    ('lift-and-stair-shafts', ('Лифтовые и лестничные шахты',)),
    ('roof-slab', ('Плита покрытия',)),
    ('bridge-crossing', ('Мостовой переход',)),
    ('flights-and-landings', ('Марши и площадки',)),
)


def _clean(text: str) -> str:
    return _SPACE.sub(' ', text).strip(' ')


def _anchor(fragment: dict[str, Any]) -> dict[str, Any]:
    return {key:fragment[key] for key in ('blockIndex','lineIndex','rawText')}


def _copy_fragment(fragment: dict[str, Any]) -> dict[str, Any]:
    return {**fragment, 'bboxMilliPoints':list(fragment['bboxMilliPoints'])}


def _sequence(lines: list[dict[str, Any]]) -> bool:
    return all(0 <= a['bboxMilliPoints'][1]-b['bboxMilliPoints'][3] <= 7000
               for a,b in zip(lines, lines[1:]))


def extract_fire_resistance_candidates(page: Any, stage: Any) -> list[dict[str, Any]]:
    """Return all six original table declarations, or abstain with [].

    Page/source authenticity and stage are caller responsibilities. Only PD/RD
    are accepted; no stage/section/source identity is inferred from page text.
    """
    if type(stage) is not str or stage not in ('PD','RD'):
        return []
    source = read_table_row_page(page)
    if source['status'] != 'READY':
        return []
    by_text: dict[str, list[dict[str, Any]]] = {}
    for line in source['lines']:
        by_text.setdefault(_clean(line['rawText']), []).append(line)
    header_matches = [by_text.get(text, []) for text in _HEADERS]
    # Unit is literal original text, not a normalized or semantically inferred unit.
    units = [line for line in source['lines'] if line['rawText'] == 'мин']
    if any(len(items) != 1 for items in header_matches) or len(units) != 1:
        return []
    label_header, value_header = [items[0] for items in header_matches]
    unit = units[0]
    groups = []
    for _, texts in _ROWS:
        matches = [by_text.get(text, []) for text in texts]
        if any(len(items) != 1 for items in matches):
            return []
        group = [items[0] for items in matches]
        if not _sequence(group):
            return []
        groups.append(group)
    label_lines = [line for group in groups for line in group]
    anchors = [label_header,value_header,unit] + label_lines
    heights = [line['bboxMilliPoints'][3]-line['bboxMilliPoints'][1] for line in anchors]
    if (any(not 11000 <= height <= 13000 for height in heights)
            or max(heights)-min(heights) > 1000
            or max(line['bboxMilliPoints'][0] for line in label_lines)
               - min(line['bboxMilliPoints'][0] for line in label_lines) > 1000):
        return []
    bands = [[min(line['bboxMilliPoints'][1] for line in group),
              max(line['bboxMilliPoints'][3] for line in group)] for group in groups]
    if any(not 0 <= a[0]-b[1] <= 7000 for a,b in zip(bands,bands[1:])):
        return []
    if not 0 <= min(line['bboxMilliPoints'][1] for line in (label_header,value_header,unit))-bands[0][1] <= 15000:
        return []
    if unit['bboxMilliPoints'][3] > value_header['bboxMilliPoints'][1]:
        return []
    label_column = [min(line['bboxMilliPoints'][0] for line in [label_header]+label_lines),
                    max(line['bboxMilliPoints'][2] for line in [label_header]+label_lines)]
    value_column = [value_header['bboxMilliPoints'][0],value_header['bboxMilliPoints'][2]]
    if (label_column[1] > value_column[0] or unit['bboxMilliPoints'][0] < value_column[0]
            or unit['bboxMilliPoints'][2] > value_column[1]):
        return []
    table = [label_column[0],bands[-1][0],value_column[1],
             max(line['bboxMilliPoints'][3] for line in (label_header,value_header,unit))]
    policy = {
        'schemaVersion':'table-row-binding-policy-v1', 'tableBoxMilliPoints':table,
        'columns':[
            {'key':'construction','role':'ROW_LABEL','xRangeMilliPoints':label_column,
             'headerAnchors':[_anchor(label_header)],'unitAnchors':[]},
            {'key':'resistance','role':'VALUE','xRangeMilliPoints':value_column,
             'headerAnchors':[_anchor(value_header)],'unitAnchors':[_anchor(unit)]},
        ],
        'rows':[{'key':key,'yRangeMilliPoints':band,
                 'labelAnchors':[_anchor(line) for line in group],
                 'valueLineCounts':{'resistance':1}}
                for (key,_),band,group in zip(_ROWS,bands,groups)],
        'maxLineGapMilliPoints':7000,
    }
    # No source value or value box participated in policy discovery above.
    bound = bind_table_rows(page, policy)
    if bound['status'] != 'BOUND':
        return []
    result = []
    for row in bound['rows']:
        labels, values = row['cells']
        primary = values['fragments'][0]
        match = _VALUE.fullmatch(primary['rawText'])
        if match is None:
            return []
        minutes = int(match.group('minutes'))
        if minutes > _SAFE:
            return []
        result.append({
            'criterion':match.group('criterion'), 'minutes':minutes,
            'rawValue':primary['rawText'], 'rawUnit':'мин', 'canonicalUnit':'min',
            'constructionLabelLines':[line['rawText'] for line in labels['fragments']],
            'primaryFragments':values['fragments'], 'scopeFragments':labels['fragments'],
            'headerFragments':[_copy_fragment(bound['columns'][0]['headerFragments'][0]),
                               _copy_fragment(bound['columns'][1]['headerFragments'][0])],
            'unitFragments':[_copy_fragment(line) for line in bound['columns'][1]['unitFragments']],
            'bindingPolicyVersion':BINDING_POLICY_VERSION,
            'tableBoxMilliPoints':list(bound['tableBoxMilliPoints']),
        })
    return result
