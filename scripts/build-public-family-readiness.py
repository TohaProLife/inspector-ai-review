#!/usr/bin/env python3
"""Compose review-only 47-code readiness from pinned public reports."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_family_readiness import (  # noqa: E402
    PublicFamilyReadinessError, build_public_family_readiness,
)


DEFAULT_MANIFEST = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
                    / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data" / "document_manifest.jsonl")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--matrix", type=Path)
    parser.add_argument("--numeric-probe", type=Path)
    parser.add_argument("--numeric-label-pack", type=Path)
    parser.add_argument("--class-probe", type=Path)
    parser.add_argument("--presence-probe", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        if arguments.output.exists() or not arguments.output.parent.is_dir():
            raise PublicFamilyReadinessError("output path must be new in an existing directory")
        report = build_public_family_readiness(
            arguments.manifest, arguments.audit, matrix_path=arguments.matrix,
            numeric_probe_path=arguments.numeric_probe,
            numeric_label_pack_path=arguments.numeric_label_pack,
            class_probe_path=arguments.class_probe,
            presence_probe_path=arguments.presence_probe)
        content = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=arguments.output.parent,
                prefix=arguments.output.name + ".", suffix=".tmp", delete=False) as target:
            temporary = Path(target.name)
            try:
                target.write(content)
                target.flush()
                os.fsync(target.fileno())
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        if arguments.output.exists():
            temporary.unlink(missing_ok=True)
            raise PublicFamilyReadinessError("output path appeared while building report")
        try:
            os.chmod(temporary, 0o644)
            os.link(temporary, arguments.output)
        finally:
            temporary.unlink(missing_ok=True)
        print(json.dumps({"status": "REVIEW_ONLY", "output": str(arguments.output),
                          "summary": report["summary"],
                          "probeProvenance": report["probeProvenance"]},
                         ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError, PublicFamilyReadinessError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)}, ensure_ascii=False),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
