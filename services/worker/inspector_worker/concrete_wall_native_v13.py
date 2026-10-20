"""OUTPUT-ONLY v13 fixed native boundaries, not authentication or release admission.

Exact builtin containers/scalars only. No supplied descriptors, callbacks, JSON
hooks, coercion, traversal of user objects, or caller-selected budgets.
Canonical output is only the existing Python JSON byte-budget representation;
portable fact hashes continue to use the frozen portable_evidence_hash helper.
"""
from __future__ import annotations
import json
import math
from typing import Any


class ConcreteWallAdapterError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str = "INVALID_INPUT") -> None:
    raise ConcreteWallAdapterError(code)


def _canonical_native(value: Any, *, origins: bool) -> str:
    nodes = 0
    active: set[int] = set()
    max_nodes, max_depth, max_bytes = ((200000, 64, 524288) if origins
                                     else (4500018, 69, 67108864))

    def visit(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > max_nodes or depth > max_depth:
            _fail("INPUT_LIMIT")
        kind = type(item)
        if kind is str:
            if len(item) > 2000000:
                _fail("INPUT_LIMIT")
            if any(0xD800 <= ord(c) <= 0xDFFF for c in item):
                _fail()
        elif kind is bool or item is None:
            return
        elif kind is int:
            if abs(item) > 9007199254740991:
                _fail()
        elif kind is float:
            if not math.isfinite(item) or abs(item) > 9007199254740991:
                _fail()
        elif kind is list or kind is dict:
            if len(item) > 32768:
                _fail("INPUT_LIMIT")
            marker = id(item)
            if marker in active:
                _fail()
            active.add(marker)
            if kind is dict:
                for key, child in dict.items(item):
                    if type(key) is not str or not key.isascii():
                        _fail()
                    visit(key, depth + 1)
                    visit(child, depth + 1)
            else:
                for child in list.__iter__(item):
                    visit(child, depth + 1)
            active.remove(marker)
        else:
            _fail()

    visit(value, 0)
    result = json.dumps(value, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":"), allow_nan=False)
    if len(result.encode("utf-8")) > max_bytes:
        _fail("INPUT_LIMIT")
    return result


def canonical_concrete_wall_lease_native_v13(value: Any) -> str:
    return _canonical_native(value, origins=False)


def canonical_concrete_wall_origins_native_v1(value: Any) -> str:
    return _canonical_native(value, origins=True)


# V13-only bounded admission and portable hashing. Public canonical bodies above
# remain frozen. The ordinary JSON encoder may emit one escaped scalar chunk;
# only the typed SHA output buffer is bounded to 65536 bytes.
import hashlib
import struct


def assert_concrete_wall_lease_native_v13(value: Any) -> None:
    """Same complete native walk and ordinary JSON UTF8 budget, without a join."""
    nodes = 0
    active: set[int] = set()
    max_nodes, max_depth, max_bytes = 4500018, 69, 67108864

    def visit(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > max_nodes or depth > max_depth:
            _fail("INPUT_LIMIT")
        kind = type(item)
        if kind is str:
            if len(item) > 2000000:
                _fail("INPUT_LIMIT")
            if any(0xD800 <= ord(c) <= 0xDFFF for c in item):
                _fail()
        elif kind is bool or item is None:
            return
        elif kind is int:
            if abs(item) > 9007199254740991:
                _fail()
        elif kind is float:
            if not math.isfinite(item) or abs(item) > 9007199254740991:
                _fail()
        elif kind is list or kind is dict:
            if len(item) > 32768:
                _fail("INPUT_LIMIT")
            marker = id(item)
            if marker in active:
                _fail()
            active.add(marker)
            if kind is dict:
                for key, child in dict.items(item):
                    if type(key) is not str or not key.isascii():
                        _fail()
                    visit(key, depth + 1)
                    visit(child, depth + 1)
            else:
                for child in list.__iter__(item):
                    visit(child, depth + 1)
            active.remove(marker)
        else:
            _fail()

    visit(value, 0)
    encoder = json.JSONEncoder(ensure_ascii=False, sort_keys=True,
                               separators=(",", ":"), allow_nan=False)
    byte_count = 0
    for chunk in encoder.iterencode(value):
        if chunk.isascii():
            byte_count += len(chunk)
        else:
            for offset in range(0, len(chunk), 16384):
                byte_count += len(chunk[offset:offset + 16384].encode("utf-8"))
        if byte_count > max_bytes:
            _fail("INPUT_LIMIT")


def sha256_portable_evidence_native_v13(value: Any) -> str:
    """Exact portable typed-tree SHA; complete lease admission precedes hashing."""
    assert_concrete_wall_lease_native_v13(value)
    digest = hashlib.sha256()
    buffer = bytearray()

    def emit(chunk: bytes) -> None:
        offset = 0
        while offset < len(chunk):
            count = min(65536 - len(buffer), len(chunk) - offset)
            buffer.extend(chunk[offset:offset + count])
            offset += count
            if len(buffer) == 65536:
                digest.update(buffer)
                buffer.clear()

    def string(item: str) -> None:
        emit(b'"')
        # Admission rejected surrogates. JSON escaping is compositional across
        # scalar-code-point slices, including controls, quotes and backslashes.
        for offset in range(0, len(item), 8192):
            chunk = json.dumps(item[offset:offset + 8192], ensure_ascii=False,
                               separators=(",", ":"), allow_nan=False)
            emit(chunk[1:-1].encode("utf-8"))
        emit(b'"')

    def visit(item: Any) -> None:
        kind = type(item)
        if item is None:
            emit(b"null")
        elif kind is bool:
            emit(b"true" if item else b"false")
        elif kind is str:
            string(item)
        elif kind is int or kind is float:
            emit(b'["$number","')
            emit(struct.pack(">d", float(item)).hex().encode("ascii"))
            emit(b'"]')
        elif kind is list:
            emit(b'["$array",[')
            for index, child in enumerate(list.__iter__(item)):
                if index:
                    emit(b",")
                visit(child)
            emit(b"]]")
        else:
            # Exact native dict with ASCII keys already admitted; ASCII order
            # equals UTF8 byte order. Shared acyclic children serialize per edge.
            emit(b'["$object",[')
            for index, key in enumerate(sorted(item)):
                if index:
                    emit(b",")
                emit(b"[")
                string(key)
                emit(b",")
                visit(dict.__getitem__(item, key))
                emit(b"]")
            emit(b"]]")

    visit(value)
    if buffer:
        digest.update(buffer)
    return digest.hexdigest()
