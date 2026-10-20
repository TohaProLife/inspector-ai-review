"""Standalone immutable KR060 snapshot integrity; no package/actor/PDF authentication."""
import hashlib
import json
import re


class ColumnPylonSectionRunSnapshotValidationError(TypeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _fail(code):
    raise ColumnPylonSectionRunSnapshotValidationError(code)


_DOMAIN = 'matrix-kr060-column-pylon-run-snapshot-json-v1'
_VERSION = 'matrix-kr060-column-pylon-run-snapshot-v1'
_SHA = re.compile(r'[a-f0-9]{64}\Z')
_UUID = re.compile(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\Z')
_WS = frozenset(list(range(9, 14)) + list(range(28, 33)) + [0x85, 0xa0, 0x1680] + list(range(0x2000, 0x200b)) + [0x2028, 0x2029, 0x202f, 0x205f, 0x3000])


def _canonical(value):
    nodes = 0
    charged = 0
    ancestors = set()

    def charge(n):
        nonlocal charged
        charged += n
        if charged > 524288:
            _fail('INPUT_LIMIT')

    def visit(v, depth):
        nonlocal nodes
        nodes += 1
        if nodes > 200000 or depth > 64:
            _fail('INPUT_LIMIT')
        t = type(v)
        if v is None:
            charge(4)
            return 'null'
        if t is bool:
            s = 'true' if v else 'false'
            charge(len(s))
            return s
        if t is int:
            if abs(v) > 9007199254740991:
                _fail('INVALID_INPUT')
            s = str(v)
            charge(len(s))
            return s
        if t is str:
            if len(v) > 2000000:
                _fail('INPUT_LIMIT')
            if any(0xd800 <= ord(c) <= 0xdfff for c in v):
                _fail('INVALID_INPUT')
            s = json.dumps(v, ensure_ascii=False, separators=(',', ':'))
            charge(len(s.encode('utf8')))
            return s
        if t not in (list, dict) or id(v) in ancestors:
            _fail('INVALID_INPUT')
        if len(v) > 32768:
            _fail('INPUT_LIMIT')
        if t is dict and any(type(k) is not str or not k.isascii() for k in dict.keys(v)):
            _fail('INVALID_INPUT')
        ancestors.add(id(v))
        charge(2 + max(0, len(v) - 1) + (len(v) if t is dict else 0))
        if t is list:
            result = '[' + ','.join(visit(x, depth + 1) for x in v) + ']'
        else:
            result = '{' + ','.join(visit(k, depth + 1) + ':' + visit(v[k], depth + 1) for k in sorted(v)) + '}'
        ancestors.remove(id(v))
        return result

    return visit(value, 0)


def _detach(value):
    return json.loads(_canonical(value))


def _hash(value):
    return hashlib.sha256(_canonical(value).encode('utf8')).hexdigest()


def _sha(value):
    return type(value) is str and _SHA.fullmatch(value) is not None


def _uuid(value):
    return type(value) is str and _UUID.fullmatch(value) is not None


def _key(value):
    return (type(value) is str and 1 <= len(value) <= 200 and ord(value[0]) not in _WS and ord(value[-1]) not in _WS
            and not any(ord(c) <= 31 or 0x7f <= ord(c) <= 0x9f or ord(c) in (0x2028, 0x2029, 0xfffd) for c in value))


def _body(value):
    if (type(value) is not dict or not _uuid(value.get('objectId')) or not _key(value.get('objectApiId'))
            or not _sha(value.get('inputManifestHash')) or type(value.get('entries')) is not list or len(value['entries']) > 16):
        return False
    ids = set()
    previous = ''
    for e in value['entries']:
        if (type(e) is not dict or set(e) != {'pairKey', 'decisionId', 'sequenceNo', 'journalContentHash', 'projectionContentHash', 'included', 'exclusionReason'}
                or not _sha(e['pairKey']) or not _uuid(e['decisionId']) or not _sha(e['journalContentHash']) or not _sha(e['projectionContentHash']) or type(e['included']) is not bool):
            return False
        n = e['sequenceNo']
        if type(n) is not str or re.fullmatch(r'[1-9][0-9]{0,18}', n) is None or len(n) == 19 and n > '9223372036854775807':
            return False
        if (e['included'] and e['exclusionReason'] is not None
                or not e['included'] and e['exclusionReason'] not in ('SOURCE_NOT_IN_MANIFEST', 'SOURCE_REVIEW_REFERENCE_CHANGED')):
            return False
        if e['pairKey'] <= previous or e['decisionId'] in ids:
            return False
        previous = e['pairKey']
        ids.add(e['decisionId'])
    return True


def _validate(value):
    if (type(value) is not dict or set(value) != {'schemaVersion', 'objectId', 'objectApiId', 'inputManifestHash', 'entries', 'contentHash'}
            or value['schemaVersion'] != _VERSION or not _sha(value['contentHash']) or not _body(value)):
        _fail('INVALID_SNAPSHOT')
    snapshot = {k: v for k, v in value.items() if k != 'contentHash'}
    if _hash({'hashDomain': _DOMAIN, 'snapshot': snapshot}) != value['contentHash']:
        _fail('INVALID_SNAPSHOT')
    return value


def validate_column_pylon_section_run_snapshot(value):
    return _validate(_detach(value))


def build_column_pylon_section_run_snapshot(value):
    raw = _detach(value)
    if type(raw) is not dict or set(raw) != {'objectId', 'objectApiId', 'inputManifestHash', 'entries'} or not _body(raw):
        _fail('INVALID_SNAPSHOT')
    snapshot = {'schemaVersion': _VERSION, **raw}
    return _validate({**snapshot, 'contentHash': _hash({'hashDomain': _DOMAIN, 'snapshot': snapshot})})
