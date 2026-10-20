"""Narrow source-authored steel declarations, independently of qualification.

The PD grammar binds the immediately parenthesized grade to three70Б3 I-beams
of the second distribution-belt tier. It never assigns that grade to70Б2, tubes,
a plate or reinforcement. The RD grammar names I-beams but supplies no member,
profile or tier identity. Its manifest section remains the caller's authentic
OTHER; this parser does not classify sections, approve, or join source members.

Geometry bounds derive from the already verified F0105p14/F0145p4 originals.
They are grammar bounds, not source/page allowlists. Output metadata is internal
source-authored context, not an extension of standard observations or identity.
"""
from __future__ import annotations

import re
from typing import Any

EXTRACTOR_VERSION = 'matrix-steel-prose-v1'
_MAX_SAFE = 2**53 - 1
_SPACE = re.compile(r'[ \t\u00a0\u202f]+')
_ALIASES = {'C245': 'С245', 'С245': 'С245', 'C345': 'С345', 'С345': 'С345'}
_GRADE = r'(?P<grade>[CС](?:245|345))'
_PD = re.compile(r'двутавров 70Б3 ГОСТ Р 35087-2024 \(сталь класса ' + _GRADE
                 + r' ГОСТ 27772-2015\)\. Монтаж\Z')
_PD_SCOPES = (
    'конструкциях, и составляет от 3,5 м до 5,5 м. Крепление распорных элементов к',
    '«стене в грунте» осуществляется через распределительные пояса, которые',
    'выполняются на 1 и 3 ярусе из спаренных двутавров 70Б2, для 2 яруса из трех',
)
_RD_FIRST = '12. Трубы должны соответствовать ГОСТ 10704-91, из стали марки Ст20 по ГОСТ'
_RD_START = '380-2005. Двутавры должны соответствовать по ГОСТ Р 57837-2017, сталь'
_RD_CLASS = re.compile(_GRADE + r' по ГОСТ 27772-2021\. Сталь прокатная листовая должна\Z')
_RD_SHEET = re.compile(r'соответствовать ГОСТ 19903-2015 из стали [CС](?:245|345) по ГОСТ 27772-2021\.\Z')
_RD_REBAR = 'Арматурные стержни закладных деталей класса А500С по ГОСТ 34028-2016.'
_PD_ANCHOR = re.compile(r'сталь класса', re.I)
_RD_ANCHOR = re.compile(r'двутавры', re.I)
_PD_SCOPE_ANCHORS = (re.compile(r'крепление распорных элементов к', re.I),
                     re.compile(r'через распределительные пояса, которые', re.I),
                     re.compile(r'выполняются на 1 и 3 ярусе', re.I))


def normalize_steel_catalog_grade(value: Any) -> str | None:
    """Only literal Latin/Cyrillic C glyph aliases of the two catalog grades."""
    return _ALIASES.get(value) if type(value) is str else None


def compare_steel_catalog_example(expected: Any, actual: Any) -> bool | None:
    """Pure bounded predicate; False equality is not a qualified negative finding.

    No numerical strength/plasticity ranking is implied. Reverse/unknown grades
    abstain; identity, approval, standard applicability and completeness live
    outside this helper. No probability or coverage value is produced.
    """
    pd, rd = normalize_steel_catalog_grade(expected), normalize_steel_catalog_grade(actual)
    if pd is None or rd is None:
        return None
    if pd == rd:
        return False
    return True if (pd, rd) == ('С345', 'С245') else None


def _clean(text: str) -> str:
    return _SPACE.sub(' ', text).strip()


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is int and 0 <= n <= _MAX_SAFE for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _safe_text(text: Any) -> bool:
    return (type(text) is str and not any(
        (ord(c) < 32 and c not in '\n\t') or 0xD800 <= ord(c) <= 0xDFFF
        or c in '\u2028\u2029' for c in text))


def _lines(page: Any) -> list[dict[str, Any]] | None:
    if (type(page) is not dict
            or set(page) != {'pageNumber', 'widthMilliPoints', 'heightMilliPoints', 'quality', 'blocks'}
            or any(type(page.get(k)) is not int or not 0 < page[k] <= _MAX_SAFE
                   for k in ('pageNumber', 'widthMilliPoints', 'heightMilliPoints'))
            or type(page['quality']) is not dict
            or page['quality'].get('disposition') != 'TEXT_LAYER_CANDIDATE'
            or type(page['blocks']) is not list):
        return None
    result = []
    for bi, block in enumerate(page['blocks']):
        if (type(block) is not dict or set(block) != {'text', 'bboxMilliPoints', 'lineBboxesMilliPoints'}
                or not _safe_text(block.get('text'))
                or not _box(block.get('bboxMilliPoints'), page['widthMilliPoints'], page['heightMilliPoints'])):
            return None
        texts, boxes = block['text'].split('\n'), block['lineBboxesMilliPoints']
        if (type(boxes) is not list or len(boxes) != len(texts) or not boxes
                or any(not _box(b, page['widthMilliPoints'], page['heightMilliPoints']) for b in boxes)):
            return None
        union = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                 max(b[2] for b in boxes), max(b[3] for b in boxes)]
        if union != block['bboxMilliPoints']:
            return None
        for li, (text, box) in enumerate(zip(texts, boxes)):
            result.append({'pageNumber': page['pageNumber'], 'blockIndex': bi, 'lineIndex': li,
                           'rawText': text, 'bboxMilliPoints': list(box)})
    return result


def _count(page: dict[str, Any], pattern: re.Pattern[str]) -> int:
    # Count malformed/split competitors, without using block joins as evidence.
    return sum(len(pattern.findall(_clean(b['text'].replace('\n', ' ')))) for b in page['blocks'])


def _unique(lines: list[dict[str, Any]], pattern: re.Pattern[str]) -> dict[str, Any] | None:
    matches = [x for x in lines if pattern.search(_clean(x['rawText']))]
    return matches[0] if len(matches) == 1 else None


def _geometry(chosen: list[dict[str, Any]], lines: list[dict[str, Any]],
              low_height: int, high_height: int, max_gap: int, max_left_delta: int) -> bool:
    boxes = [x['bboxMilliPoints'] for x in chosen]
    heights = [b[3] - b[1] for b in boxes]
    if (any(not low_height <= h <= high_height for h in heights)
            or max(heights) - min(heights) > 1000
            or max(b[0] for b in boxes) - min(b[0] for b in boxes) > max_left_delta
            or any(not 0 <= a[1] - b[3] <= max_gap for a, b in zip(boxes, boxes[1:]))):
        return False
    selected = {(x['blockIndex'], x['lineIndex']) for x in chosen}
    envelope = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes)]
    for line in lines:
        if (line['blockIndex'], line['lineIndex']) in selected or not line['rawText'].strip():
            continue
        b = line['bboxMilliPoints']
        if b[0] < envelope[2] and b[2] > envelope[0] and b[1] < envelope[3] and b[3] > envelope[1]:
            return False
    return True


def extract_steel_candidates(page: Any, stage: str) -> list[dict[str, Any]]:
    """Return narrow declaration evidence, never qualified findings.

    Same-source/page authenticity and actual stage are caller responsibilities.
    Only PD/RD are recognized; no source IDs, section or member equivalence are
    inferred. Literal raw glyph and complete original lines/boxes survive.
    """
    if type(stage) is not str or stage not in ('PD', 'RD'):
        return []
    lines = _lines(page)
    if lines is None:
        return []
    if stage == 'PD':
        if _count(page, _PD_ANCHOR) != 1:
            return []
        primary = _unique(lines, _PD_ANCHOR)
        if primary is None:
            return []
        match = _PD.fullmatch(_clean(primary['rawText']))
        scopes = []
        for pattern, expected in zip(_PD_SCOPE_ANCHORS, _PD_SCOPES):
            if _count(page, pattern) != 1:
                return []
            line = _unique(lines, pattern)
            if line is None or _clean(line['rawText']) != expected:
                return []
            scopes.append(line)
        if not match or not _geometry(scopes + [primary], lines, 11000, 13000, 10000, 2000):
            return []
        # Source enumeration must agree with reading order; margin blocks may
        # intervene only outside the independently checked body envelope.
        keys = [(x['blockIndex'], x['lineIndex']) for x in scopes + [primary]]
        if keys != sorted(keys):
            return []
        primaries = [primary]
        product = {'role': 'DISTRIBUTION_BELT_I_BEAMS', 'productKind': 'I_BEAM',
                   'profile': '70Б3', 'count': 3, 'tier': 2,
                   'productStandard': 'ГОСТ Р 35087-2024', 'gradeStandard': 'ГОСТ 27772-2015'}
    else:
        if _count(page, _RD_ANCHOR) != 1:
            return []
        start = _unique(lines, _RD_ANCHOR)
        if start is None or _clean(start['rawText']) != _RD_START:
            return []
        bi, li = start['blockIndex'], start['lineIndex']
        if li < 1:
            return []
        by_key = {(x['blockIndex'], x['lineIndex']): x for x in lines}
        chosen = [by_key.get((bi, j)) for j in range(li - 1, li + 4)]
        if any(x is None for x in chosen):
            return []
        first, start, primary, sheet, rebar = chosen
        match = _RD_CLASS.fullmatch(_clean(primary['rawText']))
        if (not match or _clean(first['rawText']) != _RD_FIRST
                or not _RD_SHEET.fullmatch(_clean(sheet['rawText']))
                or _clean(rebar['rawText']) != _RD_REBAR
                or not _geometry(chosen, lines, 14500, 16500, 4000, 21000)):
            return []
        primaries = [start, primary]
        scopes = [first, sheet, rebar]
        product = {'role': 'I_BEAM_GENERIC_DECLARATION', 'productKind': 'I_BEAM',
                   'profile': None, 'count': None, 'tier': None,
                   'productStandard': 'ГОСТ Р 57837-2017', 'gradeStandard': 'ГОСТ 27772-2021'}
    raw = match.group('grade')
    return [{'value': _ALIASES[raw], 'rawValue': raw, 'rawUnit': None,
             'canonicalUnit': 'steel_catalog_example', 'primaryFragments': primaries,
             'scopeFragments': scopes, 'productScope': product}]
