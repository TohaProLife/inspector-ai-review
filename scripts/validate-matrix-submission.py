#!/usr/bin/env python3
"""Validate saved prediction bytes with the unchanged public participant schema, offline.

No scorer, labels, network provider, or organizer-only files are loaded. Schema
validity and public reference consistency are separate results. The submission
format carries no original source hashes, so this tool cannot certify their bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "scripts/schemas/machine-submission-v1.schema.json"
SCHEMA_SHA256 = "75c58bef6b580528e7e4af8e4fdcdf5a5d40599b8966dae90df38b3a5f04a8d7"
SCHEMA_SOURCE = "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/submission_schema.json"
SOURCE_MAP_PATH = ROOT / "services/worker/rules/public-source-id-map-v1.json"
SOURCE_MAP_HASH = "124f43c884de67f1a56bb0a65de693626e93125fb7589790f4624e29b09075fa"
MAX_BYTES = 64 * 1024 * 1024


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    raise ValueError(f"non-JSON numeric constant: {value}")


def _decode(data: bytes) -> Any:
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=_pairs, parse_constant=_invalid_constant)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_sha(value: Any) -> str:
    return _sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())


def _pointer(parts: Any) -> str:
    return "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in parts) if parts else ""


def _public_references(submission: dict[str, Any], source_map: dict[str, Any]) -> dict[str, Any]:
    by_id = {s["fileId"]: s for s in source_map["sources"]}
    objects = {s["objectId"] for s in source_map["sources"]}
    issues = []
    if submission["object_id"] not in objects:
        issues.append({"path": "/object_id", "reason": "OBJECT_ID_NOT_IN_PUBLIC_MANIFEST"})
    checked = 0
    for i, check in enumerate(submission["checks"]):
        for j, evidence in enumerate(check["evidence"]):
            checked += 1
            path = f"/checks/{i}/evidence/{j}"
            source = by_id.get(evidence["file_id"])
            if source is None:
                issues.append({"path": path + "/file_id", "reason": "FILE_ID_NOT_IN_PUBLIC_MANIFEST"})
            elif source["objectId"] != submission["object_id"]:
                issues.append({"path": path + "/file_id", "reason": "FILE_OBJECT_MISMATCH"})
            elif evidence["stage"] != source["stage"] and not (
                    source["stage"] == "RD_ID_MIXED" and evidence["stage"] in {"RD", "ID"}):
                issues.append({"path": path + "/stage", "reason": "FILE_STAGE_MISMATCH"})
    return {"consistent": not issues, "evidenceReferencesChecked": checked,
            "sourceMapVersion": source_map["version"], "sourceMapHash": SOURCE_MAP_HASH,
            "originalSourceShaVerified": False, "issues": issues[:100], "issueCount": len(issues)}


def validate_bytes(data: bytes) -> dict[str, Any]:
    """Validate exact saved bytes, retaining their hash in the report."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError as exc:
        raise RuntimeError("jsonschema is required; use scripts/requirements-local-scorer.txt") from exc
    schema_bytes = SCHEMA_PATH.read_bytes()
    if _sha(schema_bytes) != SCHEMA_SHA256:
        raise RuntimeError("offline public schema SHA-256 mismatch")
    schema = _decode(schema_bytes)
    Draft202012Validator.check_schema(schema)
    source_map = _decode(SOURCE_MAP_PATH.read_bytes())
    if _canonical_sha(source_map) != SOURCE_MAP_HASH:
        raise RuntimeError("public source identity map hash mismatch")
    report: dict[str, Any] = {"schemaVersion": "matrix-submission-validation-v1",
        "submissionSha256": _sha(data), "submissionBytes": len(data),
        "officialSchemaSha256": SCHEMA_SHA256, "officialSchemaSource": SCHEMA_SOURCE,
        "schemaValid": False, "errors": [], "publicReferences": None}
    if len(data) > MAX_BYTES:
        report["errors"] = [{"path": "", "message": "submission exceeds 64 MiB"}]
        return report
    try:
        submission = _decode(data)
    except (ValueError, UnicodeError) as exc:
        report["errors"] = [{"path": "", "message": "invalid JSON: " + str(exc)}]
        return report
    errors = sorted(Draft202012Validator(schema).iter_errors(submission),
                    key=lambda error: (_pointer(error.absolute_path), error.message))
    report["errors"] = [{"path": _pointer(error.absolute_path), "message": error.message} for error in errors[:100]]
    report["errorCount"] = len(errors)
    report["schemaValid"] = not errors
    if not errors:
        report["publicReferences"] = _public_references(submission, source_map)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("submission", type=Path, help="Saved UTF-8 machine submission JSON")
    parser.add_argument("--require-official-ids", action="store_true",
                        help="Also require object/file/stage consistency with the frozen public identity map")
    parser.add_argument("--report", type=Path, help="Additionally save the JSON validation report")
    args = parser.parse_args()
    try:
        if args.report and args.report.resolve() == args.submission.resolve():
            raise ValueError("report path must differ from submission path")
        if args.submission.stat().st_size > MAX_BYTES:
            raise ValueError("submission exceeds 64 MiB")
        report = validate_bytes(args.submission.read_bytes())
        serialized = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.report:
            args.report.write_text(serialized, encoding="utf-8")
        sys.stdout.write(serialized)
        return 0 if report["schemaValid"] and (not args.require_official_ids or report["publicReferences"]["consistent"]) else 1
    except (OSError, ValueError, RuntimeError) as exc:
        sys.stderr.write("matrix submission validation error: " + str(exc) + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
