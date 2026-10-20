"""Atomic, source/profile/crop-pinned successful observation cache for v7 retries."""
import hashlib
import json
import os
import re
from pathlib import Path
import tempfile


def _path(namespace, record):
    root = os.environ.get('INSPECTOR_VISUAL_CACHE_ROOT')
    if not root: return None
    key = hashlib.sha256(json.dumps([namespace, record['sourceSha256'], record['proposalOrdinal'],
        record['cropSha256']], separators=(',', ':')).encode()).hexdigest()
    return Path(root) / (key + '.json')


def cached_observation(namespace, expected):
    path = _path(namespace, expected)
    if path is None: return None
    try:
        if path.is_symlink() or path.stat().st_size > 16384: return None
        saved = json.loads(path.read_text())
        record = saved['observation']
        digest = hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if saved['sha256'] != digest or set(record) != set(expected): return None
        mutable = {'decision', 'reasonCode', 'responseSha256'}
        if any(record[k] != v for k,v in expected.items() if k not in mutable): return None
        if ((record['decision'],record['reasonCode']) not in {('RADIATOR_HINT','MODEL_RESPONSE'),
            ('OTHER_HINT','MODEL_RESPONSE'),('ABSTAIN','MODEL_ABSTAIN')}
            or not isinstance(record['responseSha256'],str) or not re.fullmatch(r'[a-f0-9]{64}', record['responseSha256'])): return None
        return record
    except (OSError, ValueError, KeyError, TypeError): return None


def save_observation(namespace, record):
    path = _path(namespace, record)
    if path is None or record['responseSha256'] is None: return
    temporary = None
    try:
        path.parent.mkdir(parents=True,exist_ok=True)
        digest = hashlib.sha256(json.dumps(record,sort_keys=True,separators=(',', ':')).encode()).hexdigest()
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
            temporary=stream.name
            json.dump({'sha256':digest,'observation':record},stream,separators=(',', ':'))
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary,path)
    except OSError:
        if temporary:
            try: os.unlink(temporary)
            except OSError: pass
