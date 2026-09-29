#!/usr/bin/env python3
"""Read-only full-corpus census of eight class labels after PASS index audit."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.class_label_probe import probe_public_class_labels  # noqa: E402


DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--max-examples-per-code", type=int, default=20)
    parser.add_argument("--max-ocr-queue", type=int, default=2000)
    arguments = parser.parse_args()
    report = probe_public_class_labels(
        arguments.manifest, arguments.index, arguments.audit,
        max_examples_per_code=arguments.max_examples_per_code,
        max_ocr_queue=arguments.max_ocr_queue)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
