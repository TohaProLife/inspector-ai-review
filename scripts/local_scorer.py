#!/usr/bin/env python3
"""Versioned LOCAL scorer for public, fully located atomic checks.

This is deliberately not the organizers' unpublished scorer. Review candidates
are rejected at the input boundary and cannot become confirmed predictions.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Any

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
ENVELOPE_SCHEMA = ROOT / "schemas/local-evaluation-envelope-v1.schema.json"
# Byte-for-byte copy of the participants' schema. The original file is ignored
# by git, so the packaged scorer must carry its own pinned copy.
SUBMISSION_SCHEMA = ROOT / "schemas/official-submission-20260811.schema.json"
PUBLIC_MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
                   / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
PUBLIC_GOLD = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
               / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl")
SCORER_VERSION = "LOCAL_SCORER_V1"
ALLOWED_LABELS = {"VIOLATION_PRESENT", "NO_VIOLATION"}


class ScorerInputError(ValueError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()]
    except (OSError, ValueError) as exc:
        raise ScorerInputError(f"invalid JSONL: {path.name}") from exc


def _location(value: str) -> str:
    # Preserve leading zeroes and punctuation in room identifiers.
    return " ".join(unicodedata.normalize("NFC", value).strip().upper().split())


def _evidence(rows: list[dict[str, Any]]) -> frozenset[tuple[str, str, int]]:
    return frozenset((row["stage"], row["file_id"], row["pdf_page_number"])
                     for row in rows)


def _gold_evidence(rows: list[dict[str, Any]]) -> frozenset[tuple[str, str, int]]:
    return frozenset((row["stage"], row["file_id"], row["pdf_page_number"])
                     for row in rows)


def _stage_compatible(declared: str, located: str) -> bool:
    return declared == located or (declared == "RD_ID_MIXED" and located in {"RD", "ID"})


def _maximum_pairs(edges: dict[int, list[int]], prediction_count: int) -> dict[int, int]:
    """Deterministic augmenting-path matching: each gold and prediction used once."""
    gold_to_prediction: dict[int, int] = {}

    def visit(prediction: int, seen: set[int]) -> bool:
        for gold in edges.get(prediction, []):
            if gold in seen:
                continue
            seen.add(gold)
            if gold not in gold_to_prediction or visit(gold_to_prediction[gold], seen):
                gold_to_prediction[gold] = prediction
                return True
        return False

    for prediction in range(prediction_count):
        visit(prediction, set())
    return gold_to_prediction


def score(prediction_path: Path, manifest_path: Path, gold_path: Path,
          originals: Path) -> dict[str, Any]:
    try:
        prediction_bytes = prediction_path.read_bytes()
        manifest_bytes = manifest_path.read_bytes()
        gold_bytes = gold_path.read_bytes()
        payload = json.loads(prediction_bytes)
        envelope_schema = json.loads(ENVELOPE_SCHEMA.read_text(encoding="utf-8"))
        submission_schema_bytes = SUBMISSION_SCHEMA.read_bytes()
        submission_schema = json.loads(submission_schema_bytes)
    except (OSError, ValueError) as exc:
        raise ScorerInputError("prediction, manifest, gold or schema cannot be read") from exc
    errors = sorted(Draft202012Validator(envelope_schema).iter_errors(payload),
                    key=lambda e: list(map(str, e.path)))
    if errors:
        raise ScorerInputError(f"evaluation envelope invalid: {errors[0].message}")
    submission = payload["submission"]
    errors = sorted(Draft202012Validator(submission_schema).iter_errors(submission),
                    key=lambda e: list(map(str, e.path)))
    if errors:
        raise ScorerInputError(f"official submission schema invalid: {errors[0].message}")
    if submission.get("resultType") == "REVIEW_CANDIDATE" or any(
            row.get("resultType") == "REVIEW_CANDIDATE" for row in submission["checks"]):
        raise ScorerInputError("review candidates are not submission checks")
    if payload["sourceManifestSha256"] != _sha(manifest_bytes):
        raise ScorerInputError("source manifest SHA mismatch")

    manifest = {}
    for row in _jsonl(manifest_path):
        file_id = row.get("file_id")
        if file_id in manifest:
            raise ScorerInputError("duplicate file ID in source manifest")
        manifest[file_id] = row
    predictions = submission["checks"]
    object_id = submission["object_id"]
    if not any(row.get("object_id") == object_id and row.get("split") == "TRAIN_PUBLIC"
               and row.get("distribution_status") == "INCLUDE"
               and row.get("label_visibility") == "PUBLIC_TRAIN"
               for row in manifest.values()):
        raise ScorerInputError("object is absent from permitted public manifest")
    used_files = set()
    for prediction in predictions:
        if not _location(prediction["location"]):
            raise ScorerInputError("empty normalized location")
        evidence = prediction["evidence"]
        if len(_evidence(evidence)) != len(evidence):
            raise ScorerInputError("duplicate evidence locator")
        if prediction["violation_label"] in {"VIOLATION_PRESENT", "NO_VIOLATION"}:
            if not {"PD", "RD"} <= {row["stage"] for row in evidence}:
                raise ScorerInputError("comparison requires PD and RD evidence")
        for item in evidence:
            file_id = item["file_id"]
            source = manifest.get(file_id)
            if not source or not re.fullmatch(r"F[0-9]+", file_id):
                raise ScorerInputError("evidence file missing from manifest")
            if (source.get("object_id") != object_id
                    or source.get("split") != "TRAIN_PUBLIC"
                    or source.get("distribution_status") != "INCLUDE"
                    or source.get("label_visibility") != "PUBLIC_TRAIN"):
                raise ScorerInputError("evidence source outside permitted public object")
            if (not _stage_compatible(source.get("stage"), item["stage"])
                    or item["pdf_page_number"] > source.get("pdf_pages", 0)):
                raise ScorerInputError("evidence stage or page mismatch")
            used_files.add(file_id)

    gold = []
    for row in _jsonl(gold_path):
        if row.get("split") != "TRAIN_PUBLIC" or row.get("visibility") != "PUBLIC_TRAIN_LABEL":
            raise ScorerInputError("gold contains non-public label")
        if row.get("object_id") == object_id and row.get("score_eligible") is True:
            if row.get("violation_label") not in ALLOWED_LABELS:
                raise ScorerInputError("unsupported public gold label")
            for item in row["evidence"]:
                source = manifest.get(item["file_id"])
                if not source or source.get("object_id") != object_id:
                    raise ScorerInputError("gold source not in public object manifest")
                if (not _stage_compatible(source.get("stage"), item["stage"])
                        or item["pdf_page_number"] > source.get("pdf_pages", 0)):
                    raise ScorerInputError("gold source stage or page mismatch")
                used_files.add(item["file_id"])
            gold.append(row)
    if len({row["check_id"] for row in gold}) != len(gold):
        raise ScorerInputError("duplicate gold check ID")

    # Verify original bytes once per referenced public file. Manifest metadata
    # alone is insufficient evidence that a locator points to the supplied PDF.
    for file_id in sorted(used_files):
        source = manifest[file_id]
        if (source.get("split") != "TRAIN_PUBLIC"
                or source.get("distribution_status") != "INCLUDE"
                or source.get("label_visibility") != "PUBLIC_TRAIN"):
            raise ScorerInputError("gold or prediction references non-public PDF")
        path = originals / f"{file_id}.pdf"
        try:
            pdf = path.read_bytes()
        except OSError as exc:
            raise ScorerInputError(f"original PDF unavailable: {file_id}") from exc
        if len(pdf) != source["size_bytes"] or _sha(pdf) != source["sha256"]:
            raise ScorerInputError(f"original PDF SHA/size mismatch: {file_id}")

    positive = [row for row in gold if row["violation_label"] == "VIOLATION_PRESENT"]
    negative = [row for row in gold if row["violation_label"] == "NO_VIOLATION"]
    positive_keys = {(row["parameter_code"], _location(row["location"])) for row in positive}
    negative_keys = {(row["parameter_code"], _location(row["location"])) for row in negative}
    if positive_keys & negative_keys:
        raise ScorerInputError("conflicting gold labels for atomic key")
    edges: dict[int, list[int]] = defaultdict(list)
    for index, prediction in enumerate(predictions):
        if prediction["violation_label"] != "VIOLATION_PRESENT":
            continue
        key = (prediction["parameter_code"], _location(prediction["location"]))
        for gold_index, row in enumerate(positive):
            if key == (row["parameter_code"], _location(row["location"])) \
                    and _evidence(prediction["evidence"]) == _gold_evidence(row["evidence"]):
                edges[index].append(gold_index)
    matched = _maximum_pairs(edges, len(predictions))
    matched_predictions = set(matched.values())
    false_positive_ids = []
    unlabeled_ids = []
    for index, prediction in enumerate(predictions):
        if prediction["violation_label"] != "VIOLATION_PRESENT" or index in matched_predictions:
            continue
        key = (prediction["parameter_code"], _location(prediction["location"]))
        (false_positive_ids if key in positive_keys | negative_keys else unlabeled_ids).append(
            f"check-{index + 1:04d}")
    negative_edges: dict[int, list[int]] = defaultdict(list)
    for index, prediction in enumerate(predictions):
        if prediction["violation_label"] != "NO_VIOLATION":
            continue
        key = (prediction["parameter_code"], _location(prediction["location"]))
        for gold_index, row in enumerate(negative):
            if key == (row["parameter_code"], _location(row["location"])) \
                    and _evidence(prediction["evidence"]) == _gold_evidence(row["evidence"]):
                negative_edges[index].append(gold_index)
    matched_negative = _maximum_pairs(negative_edges, len(predictions))
    tp = len(matched)
    fp = len(false_positive_ids)
    fn = len(positive) - tp
    tn = len(matched_negative)
    # The visible rows are not declared an exhaustive evaluation universe.
    # Even with some public negatives, unmatched predictions outside that
    # subset cannot be classified, so headline precision/F1/FPR stay unknown.
    precision = None
    recall = tp / len(positive) if positive else None
    f1 = None
    fpr = None
    groups: dict[str, set[str]] = defaultdict(set)
    for row in positive:
        groups[row["finding_group_id"]].add(row["check_id"])
    matched_ids = {positive[index]["check_id"] for index in matched}
    report = {
        "scorerVersion": SCORER_VERSION,
        "scope": "LOCAL_TRAIN_PUBLIC_VISIBLE_LABELS_ONLY",
        "matchingPolicy": "OBJECT_CODE_LOCATION_EXACT_PD_RD_FILE_PAGE_ONE_TO_ONE",
        "objectId": object_id, "runId": payload["runId"],
        "predictionSha256": _sha(prediction_bytes),
        "officialSubmissionSchemaSha256": _sha(submission_schema_bytes),
        "sourceManifestSha256": _sha(manifest_bytes), "goldSha256": _sha(gold_bytes),
        "counts": {"predictions": len(predictions), "goldPositive": len(positive),
                   "goldNegative": len(negative), "tp": tp, "fpKnownKeys": fp,
                   "fn": fn, "tn": tn, "unlabeledPredictions": len(unlabeled_ids),
                   "abstentions": sum(row["violation_label"] in {"COMPARISON_IMPOSSIBLE",
                                                             "MISSING_DOCUMENT"}
                                      for row in predictions)},
        "metrics": {"precision": precision, "recall": recall, "f1": f1, "fpr": fpr,
                    "matchedPositiveGroups": sum(rows <= matched_ids for rows in groups.values()),
                    "positiveGroups": len(groups)},
        "matched": [{"checkId": positive[index]["check_id"],
                     "predictionId": f"check-{prediction + 1:04d}"}
                    for index, prediction in sorted(matched.items())],
        "matchedNegative": [{"checkId": negative[index]["check_id"],
                             "predictionId": f"check-{prediction + 1:04d}"}
                            for index, prediction in sorted(matched_negative.items())],
        "unmatchedPositiveCheckIds": sorted({row["check_id"] for row in positive} - matched_ids),
        "falsePositiveKnownKeyIds": sorted(false_positive_ids),
        "unlabeledPredictionIds": sorted(unlabeled_ids),
        "limitations": ["NOT_OFFICIAL_SCORER", "PUBLIC_LABELS_ARE_NOT_INDEPENDENT_TEST",
                        "PUBLIC_LABELS_NOT_EXHAUSTIVE_FOR_PRECISION_FPR",
                        "RUN_MODE_AND_SEAL_ARE_INPUT_ASSERTIONS",
                        "NO_VERIFIED_NEGATIVE_LABELS" if not negative else "PUBLIC_NEGATIVES_ONLY"],
    }
    report["contentHash"] = _sha(json.dumps(report, sort_keys=True, ensure_ascii=False,
                                           separators=(",", ":")).encode())
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=PUBLIC_MANIFEST)
    parser.add_argument("--gold", type=Path, default=PUBLIC_GOLD)
    parser.add_argument("--originals", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = score(args.predictions, args.manifest, args.gold, args.originals)
    except ScorerInputError as exc:
        parser.error(str(exc))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.report), "counts": report["counts"],
                      "metrics": report["metrics"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
