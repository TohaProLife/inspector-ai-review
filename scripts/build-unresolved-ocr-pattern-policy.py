#!/usr/bin/env python3
"""Freeze code-specific lexical patterns from seven audited public batch modules."""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "services/worker/inspector_worker"
DEST = ROOT / "output/unresolved-ocr-20260927/pattern-policy.json"
INPUTS = {
    "utility": ("utility_unresolved_batch.py", "_TRIGGERS"),
    "ar": ("ar_unresolved_batch.py", "_TRIGGERS"),
    "engineering": ("engineering_mixed_batch.py", "CODE_SPEC"),
    "pos": ("pos_unresolved_batch.py", "PATTERN_TEXT"),
    "pz_spzu": ("pz_spzu_unresolved_batch.py", "LINE_PATTERNS"),
    "pod_oos": ("pod_oos_unresolved_batch.py", "PATTERN_TEXT"),
    "kr": ("kr_unresolved_batch.py", "ANCHORS"),
}


def constant(path: Path, name: str) -> dict:
    values = []
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(target, ast.Name) and target.id == name for target in targets):
                values.append(ast.literal_eval(node.value))
    if len(values) != 1 or not isinstance(values[0], dict):
        raise ValueError(f"pattern constant missing or duplicated: {path}:{name}")
    return values[0]


def build() -> dict:
    patterns = {}
    input_hashes = {}
    code_sources = {}
    for batch, (filename, constant_name) in INPUTS.items():
        path = MODULE / filename
        input_hashes[batch] = hashlib.sha256(path.read_bytes()).hexdigest()
        values = constant(path, constant_name)
        for code, value in values.items():
            if batch == "engineering":
                value = (value[2],)
            elif isinstance(value, str):
                value = (value,)
            if not value or not all(isinstance(expression, str) and expression for expression in value):
                raise ValueError(f"empty lexical pattern: {code}")
            patterns.setdefault(code, tuple(value))
            code_sources.setdefault(code, []).append(batch)
    if len(patterns) != 80:
        raise ValueError(f"expected 80 unique unresolved codes; got {len(patterns)}")
    return {
        "schemaVersion": "unresolved-ocr-pattern-policy-v1",
        "scope": "LEXICAL_REVIEW_ONLY_NO_FINDINGS_OR_ABSENCE",
        "sourceModuleSha256": input_hashes,
        "patterns": {code: list(patterns[code]) for code in sorted(patterns)},
        "codeSources": {code: sorted(code_sources[code]) for code in sorted(code_sources)},
    }


def main() -> None:
    if DEST.exists():
        raise ValueError("pattern policy already exists; do not overwrite pin")
    value = build()
    DEST.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    DEST.write_bytes(raw)
    print(json.dumps({"codeCount": len(value["patterns"]),
                      "sha256": hashlib.sha256(raw).hexdigest()}, sort_keys=True))


if __name__ == "__main__":
    main()
