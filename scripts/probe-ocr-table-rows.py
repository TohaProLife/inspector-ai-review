#!/usr/bin/env python3
"""Produce uncoded review leads from an independently verified OCR stage."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "worker"))

from inspector_worker.ocr_table_rows import extract_ocr_table_rows  # noqa: E402


SHA = re.compile(r"[a-f0-9]{64}\Z")


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _pairs(items: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in items:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON value: {value}")


def _read_checked(path: Path, expected: str) -> dict:
    if not SHA.fullmatch(expected) or path.is_symlink() or not path.is_file():
        raise ValueError("invalid artifact path or SHA")
    raw = path.read_bytes()
    if _sha(raw) != expected:
        raise ValueError(f"SHA mismatch: {path.name}")
    value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise ValueError("expected JSON object")
    return value


def probe(stage_path: Path, stage_sha: str, verification_path: Path,
          verification_sha: str) -> dict:
    stage = _read_checked(stage_path, stage_sha)
    verification = _read_checked(verification_path, verification_sha)
    if (verification.get("schemaVersion") != "bounded-ocr-stage-verification-v1"
            or verification.get("status") != "SOURCE_RENDER_SCOPE_VERIFIED"
            or verification.get("artifactSha256") != stage_sha
            or verification.get("inputManifestHash") != stage.get("inputManifestHash")
            or verification.get("profileId") != stage.get("providerProfileId")
            or verification.get("ocrLineTextVerified") is not False
            or not isinstance(verification.get("sources"), list)):
        raise ValueError("independent source/render verification missing or stale")
    verified_sources = {}
    for source in verification["sources"]:
        if (not isinstance(source, dict) or not isinstance(source.get("sourceFileId"), str)
                or not isinstance(source.get("sourceSha256"), str)
                or not isinstance(source.get("verifiedRenderedPages"), list)):
            raise ValueError("independent verification source invalid")
        key = source["sourceFileId"]
        if key in verified_sources:
            raise ValueError("duplicate independently verified source")
        verified_sources[key] = source
    analysis = stage.get("analysis")
    if not isinstance(analysis, dict):
        raise ValueError("OCR stage analysis invalid")
    stage_sources = analysis.get("sources")
    if not isinstance(stage_sources, list) or len(stage_sources) != len(verified_sources):
        raise ValueError("independent verification source inventory incomplete")
    for source in stage_sources:
        if not isinstance(source, dict):
            raise ValueError("OCR stage source invalid")
        verified = verified_sources.get(source.get("sourceFileId"))
        if (verified is None or verified["sourceSha256"] != source.get("sourceSha256")
                or not isinstance(source.get("pages"), list)
                or set(verified["verifiedRenderedPages"]) != {
                    page.get("pageNumber") for page in source["pages"] if isinstance(page, dict)}):
            raise ValueError("independent verification does not cover saved OCR pages")
    result = extract_ocr_table_rows(stage, stage_sha256=stage_sha)
    for proposal in result["proposals"]:
        source = verified_sources.get(proposal["sourceFileId"])
        if (source is None or source["sourceSha256"] != proposal["inputSha256"]
                or proposal["pageNumber"] not in source["verifiedRenderedPages"]):
            raise ValueError("table row refers to unverified source or render")
    envelope = {"schemaVersion": "public-ocr-table-review-packet-v1",
                "reviewStatus": "REVIEW_ONLY_ABSTAIN",
                "independentVerificationSha256": verification_sha,
                "tableRows": result, "findingCount": None, "parameterCoverage": None}
    envelope["contentHash"] = _sha(json.dumps(envelope, ensure_ascii=False,
                                               sort_keys=True, separators=(",", ":"),
                                               allow_nan=False).encode("utf-8"))
    return envelope


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--stage-sha256", required=True)
    parser.add_argument("--verification", type=Path, required=True)
    parser.add_argument("--verification-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or args.output.is_symlink():
            raise ValueError("output already exists")
        result = probe(args.stage, args.stage_sha256,
                       args.verification, args.verification_sha256)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True,
                                          indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"status": result["reviewStatus"],
                          "proposalCount": len(result["tableRows"]["proposals"]),
                          "abstentionCount": len(result["tableRows"]["abstentions"]),
                          "outputSha256": _sha(args.output.read_bytes())}))
        return 0
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"OCR table probe failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
