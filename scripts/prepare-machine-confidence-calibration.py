#!/usr/bin/env python3
"""Prepare an offline isotonic calibration artifact; never activate runtime policy."""

from __future__ import annotations

import argparse
from bisect import bisect_left
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


TOOL_VERSION = "machine-confidence-pav-v1"
STATUS = "PREPARED_REQUIRES_INDEPENDENT_LABEL_REVIEW"
TARGET = "engineering_violation"
MAX_MANIFEST_BYTES = 65_536
MAX_SPLIT_BYTES = 16_777_216
MAX_LINE_BYTES = 65_536
MAX_ROWS = 50_000
MAX_DEPTH = 16
MAX_OUTPUT_BYTES = 16_777_216
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class CalibrationError(ValueError):
    """A preparation input or publication was refused."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CalibrationError(message)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_bounded(path: Path, limit: int) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode), "input must be a regular file")
        require(info.st_size <= limit, "input byte limit exceeded")
        data = stream.read(limit + 1)
    require(len(data) <= limit, "input byte limit exceeded")
    return data


def strict_json(data: bytes) -> object:
    try:
        text = data.decode("utf-8")
        depth, quoted, escaped = 0, False, False
        for character in text:
            if quoted:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == '"':
                    quoted = False
            elif character == '"':
                quoted = True
            elif character in "[{":
                depth += 1
                require(depth <= MAX_DEPTH, "JSON depth limit exceeded")
            elif character in "]}":
                depth -= 1

        def pairs(items: list[tuple[str, object]]) -> dict:
            result: dict = {}
            for key, value in items:
                require(key not in result, "duplicate JSON key")
                result[key] = value
            return result

        def finite_float(lexeme: str) -> float:
            value = float(lexeme)
            require(math.isfinite(value), "nonfinite JSON number")
            return value

        def nonfinite(_lexeme: str) -> None:
            raise CalibrationError("nonfinite JSON number")

        return json.loads(text, object_pairs_hook=pairs, parse_float=finite_float,
                          parse_constant=nonfinite)
    except (UnicodeError, ValueError, RecursionError) as error:
        if isinstance(error, CalibrationError):
            raise
        raise CalibrationError("invalid UTF-8 JSON") from error


def fields(value: object, names: str, context: str) -> dict:
    require(type(value) is dict and set(value) == set(names.split()),
            f"invalid {context} fields")
    return value


def text(value: object, context: str) -> str:
    require(type(value) is str and 0 < len(value) <= 512 and value == value.strip()
            and all(ord(c) >= 32 and not 0xD800 <= ord(c) <= 0xDFFF for c in value),
            f"invalid {context}")
    return value


def score(value: object, lower: float, upper: float) -> float:
    require(type(value) in (int, float) and lower <= value <= upper,
            "score must be a finite number in declared score domain")
    # Range comparison above rejects huge integers before float conversion.
    result = float(value)
    require(math.isfinite(result), "score must be finite")
    return 0.0 if result == 0 else result


def validate_manifest(raw: object) -> dict:
    manifest = fields(raw, "schema_version calibration_version label_target domain model "
                      "score_domain label_provenance split_provenance sources", "manifest")
    require(type(manifest["schema_version"]) is int and manifest["schema_version"] == 1,
            "unsupported manifest schema_version")
    require(manifest["label_target"] == TARGET, "label_target must be engineering_violation")
    for name in ("calibration_version", "domain"):
        text(manifest[name], name)
    model = fields(manifest["model"], "id version score_name", "model")
    for name, value in model.items():
        text(value, f"model.{name}")
    domain = manifest["score_domain"]
    require(type(domain) is list and len(domain) == 2, "invalid score_domain")
    lower, upper = (score(value, 0, 1) for value in domain)
    require(lower < upper, "score_domain must increase within [0,1]")
    provenance = fields(manifest["label_provenance"], "source_id source_version "
                        "annotation_protocol annotator_authority independent_of_model_predictions",
                        "label_provenance")
    require(provenance["independent_of_model_predictions"] is True,
            "independent label provenance assertion required")
    for name in ("source_id", "source_version", "annotation_protocol", "annotator_authority"):
        text(provenance[name], f"label_provenance.{name}")
    split = fields(manifest["split_provenance"], "method assignment_id assigned_before_evaluation",
                   "split_provenance")
    require(split["assigned_before_evaluation"] is True,
            "predeclared split provenance assertion required")
    text(split["method"], "split method")
    text(split["assignment_id"], "split assignment_id")
    fields(manifest["sources"], "fit evaluation", "sources")
    return manifest


def read_split(root: Path, reference: object, manifest: dict) -> tuple[list[dict], dict]:
    reference = fields(reference, "path sha256 bytes", "source reference")
    relative = Path(text(reference["path"], "source path"))
    require(not relative.is_absolute() and ".." not in relative.parts,
            "source path must stay relative to manifest directory")
    resolved = (root / relative).resolve(strict=True)
    require(resolved.is_relative_to(root), "source path escapes manifest directory")
    require(type(reference["sha256"]) is str and SHA256.fullmatch(reference["sha256"]) is not None,
            "invalid source sha256")
    require(type(reference["bytes"]) is int and 0 < reference["bytes"] <= MAX_SPLIT_BYTES,
            "invalid source byte count")
    data = read_bounded(resolved, MAX_SPLIT_BYTES)
    require(len(data) == reference["bytes"] and digest(data) == reference["sha256"],
            "source hash or byte count drift")
    rows = []
    for line in data.split(b"\n"):
        if not line:
            continue  # A final newline and empty lines do not create examples.
        require(len(line) <= MAX_LINE_BYTES, "JSONL line byte limit exceeded")
        require(len(rows) < MAX_ROWS, "JSONL row limit exceeded")
        row = fields(strict_json(line), "candidate_id label_id object_id document_sha256s score "
                     "label label_target domain model_id model_version label_source_id", "row")
        for name in ("candidate_id", "label_id", "object_id"):
            text(row[name], name)
        expected = {"label_target": TARGET, "domain": manifest["domain"],
                    "model_id": manifest["model"]["id"],
                    "model_version": manifest["model"]["version"],
                    "label_source_id": manifest["label_provenance"]["source_id"]}
        require(all(row[name] == value for name, value in expected.items()),
                "row target/domain/model/label source mismatch")
        documents = row["document_sha256s"]
        require(type(documents) is list and 1 <= len(documents) <= 16
                and all(type(sha) is str and SHA256.fullmatch(sha) for sha in documents)
                and len(set(documents)) == len(documents), "invalid document_sha256s")
        row["score"] = score(row["score"], *manifest["score_domain"])
        require(type(row["label"]) is bool or
                (type(row["label"]) is int and row["label"] in (0, 1)),
                "label must be boolean or integer 0/1")
        row["label"] = int(row["label"])
        rows.append(row)
    require(bool(rows), "split must not be empty")
    return rows, dict(reference)


def validate_splits(fit: list[dict], evaluation: list[dict]) -> None:
    for name in ("candidate_id", "label_id"):
        identifiers = [row[name] for row in fit + evaluation]
        require(len(set(identifiers)) == len(identifiers), f"duplicate {name}")
    require(not {row["object_id"] for row in fit} & {row["object_id"] for row in evaluation},
            "fit/evaluation object leakage")
    require(not {sha for row in fit for sha in row["document_sha256s"]}
            & {sha for row in evaluation for sha in row["document_sha256s"]},
            "fit/evaluation document leakage")


def fit_pav(rows: list[dict]) -> dict:
    grouped: dict[float, list[int]] = {}
    for row in rows:
        group = grouped.setdefault(row["score"], [0, 0])
        group[0] += row["label"]
        group[1] += 1
    scores = sorted(grouped)
    blocks: list[dict] = []
    for index, value in enumerate(scores):
        positives, count = grouped[value]
        blocks.append({"first": index, "last": index, "positives": positives, "count": count})
        while len(blocks) > 1:
            left, right = blocks[-2:]
            if left["positives"] * right["count"] <= right["positives"] * left["count"]:
                break
            blocks[-2:] = [{"first": left["first"], "last": right["last"],
                            "positives": left["positives"] + right["positives"],
                            "count": left["count"] + right["count"]}]
    probabilities = [0.0] * len(scores)
    for block in blocks:
        probability = block["positives"] / block["count"]
        probabilities[block["first"]:block["last"] + 1] = [probability] * (
            block["last"] - block["first"] + 1)
    return {"method": "increasing-pav", "interpolation": "linear-between-observed-score-knots",
            "outside_fit_range": "ABSTAIN", "score_knots": scores,
            "probability_knots": probabilities, "blocks": blocks,
            "fit_range": [scores[0], scores[-1]]}


def predict(model: dict, value: float) -> float | None:
    scores, probabilities = model["score_knots"], model["probability_knots"]
    if value < scores[0] or value > scores[-1]:
        return None
    index = bisect_left(scores, value)
    if scores[index] == value:
        return probabilities[index]
    fraction = (value - scores[index - 1]) / (scores[index] - scores[index - 1])
    return probabilities[index - 1] + fraction * (probabilities[index] - probabilities[index - 1])


def evaluate(rows: list[dict], model: dict) -> dict:
    bins: list[list[tuple[float, int]]] = [[] for _ in range(10)]
    squared_errors: list[float] = []
    positive_count = scored_positives = 0
    for row in sorted(rows, key=lambda item: item["candidate_id"]):
        positive_count += row["label"]
        probability = predict(model, row["score"])
        if probability is None:
            continue
        scored_positives += row["label"]
        squared_errors.append((probability - row["label"]) ** 2)
        bins[min(int(probability * 10), 9)].append((probability, row["label"]))
    scored = len(squared_errors)
    bin_metrics = [{"index": index, "count": len(values),
                    "mean_probability": math.fsum(p for p, _ in values) / len(values) if values else None,
                    "event_rate": sum(y for _, y in values) / len(values) if values else None}
                   for index, values in enumerate(bins)]
    return {"rows": len(rows), "positives": positive_count, "negatives": len(rows) - positive_count,
            "scored": scored, "scored_positives": scored_positives,
            "scored_negatives": scored - scored_positives, "abstained": len(rows) - scored,
            "coverage": scored / len(rows),
            "brier": math.fsum(squared_errors) / scored if scored else None,
            "ece_10_equal_width_bins": math.fsum(
                abs(item["mean_probability"] - item["event_rate"]) * item["count"]
                for item in bin_metrics if item["count"]) / scored if scored else None,
            "probability_bins": bin_metrics}


def split_identity(rows: list[dict]) -> dict:
    ordered = sorted(rows, key=lambda row: row["candidate_id"])
    objects = sorted({row["object_id"] for row in rows})
    documents = sorted({sha for row in rows for sha in row["document_sha256s"]})
    return {"rows": len(rows), "objects": len(objects), "documents": len(documents),
            "rows_sha256": digest(canonical(ordered)),
            "object_ids_sha256": digest(canonical(objects)),
            "document_sha256s_sha256": digest(canonical(documents))}


def prepare(manifest_path: Path) -> dict:
    manifest_bytes = read_bounded(manifest_path, MAX_MANIFEST_BYTES)
    manifest = validate_manifest(strict_json(manifest_bytes))
    root = manifest_path.resolve(strict=True).parent
    fit, fit_reference = read_split(root, manifest["sources"]["fit"], manifest)
    heldout, heldout_reference = read_split(root, manifest["sources"]["evaluation"], manifest)
    validate_splits(fit, heldout)
    model = fit_pav(fit)
    return {"schema_version": 1, "status": STATUS, "tool_version": TOOL_VERSION,
            "runtime_activation_permitted": False, "independent_label_review": "REQUIRED_NOT_PERFORMED",
            "provenance_verification": "MANIFEST_ASSERTIONS_ONLY_NOT_INDEPENDENTLY_VERIFIED",
            "calibration_version": manifest["calibration_version"], "label_target": TARGET,
            "domain": manifest["domain"], "model": manifest["model"],
            "score_domain": manifest["score_domain"], "label_provenance": manifest["label_provenance"],
            "split_provenance": manifest["split_provenance"],
            "manifest": {"sha256": digest(manifest_bytes), "bytes": len(manifest_bytes)},
            "sources": {"fit": fit_reference, "evaluation": heldout_reference},
            "splits": {"fit": split_identity(fit), "evaluation": split_identity(heldout)},
            "parameters": model,
            "metrics_policy": {"denominator": "scored rows only; abstentions reported separately",
                               "ece_bins": "[j/10,(j+1)/10); final bin includes 1"},
            "metrics": {"fit": evaluate(fit, model), "heldout": evaluate(heldout, model)}}


def write_exclusive(path: Path, data: bytes) -> None:
    """Publish complete private bytes atomically, refusing any existing final path."""
    require(len(data) <= MAX_OUTPUT_BYTES, "output byte limit exceeded")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)  # Exclusive atomic publication; never replace.
    finally:
        os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="new private artifact path")
    arguments = parser.parse_args()
    try:
        require(not os.path.lexists(arguments.output), "output already exists")
        artifact = prepare(arguments.manifest)
        data = canonical(artifact) + b"\n"
        write_exclusive(arguments.output, data)
        print(json.dumps({"status": STATUS, "sha256": digest(data), "bytes": len(data)}))
        return 0
    except (CalibrationError, OSError) as error:
        print(json.dumps({"status": "REFUSED", "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
