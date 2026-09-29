#!/usr/bin/env python3
"""Addressed, SHA-gated line context for literal numeric-label FTS pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from collections import defaultdict
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402
from inspector_worker.numeric_family_table_rows import _definitions  # noqa: E402
from inspector_worker.numeric_label_probe import _audit_gate  # noqa: E402
from inspector_worker.numeric_table_row_candidates import load_numeric_table_policy  # noqa: E402
from inspector_worker.public_document_index import (  # noqa: E402
    get_indexed_page, load_public_manifest, readonly_index_uri,
)

from importlib.util import module_from_spec, spec_from_file_location

_fts_path = ROOT / "scripts" / "probe-public-numeric-family-tables-fts.py"
_spec = spec_from_file_location("numeric_family_table_fts", _fts_path)
assert _spec is not None and _spec.loader is not None
_fts = module_from_spec(_spec)
_spec.loader.exec_module(_fts)

_WORDS = re.compile(r"[^\W_]+", re.UNICODE)


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _word_locations(lines: list[dict]) -> list[tuple[str, int]]:
    return [(word.casefold(), index) for index, line in enumerate(lines)
            for word in _WORDS.findall(line["text"])]


def _matched_spans(lines: list[dict], label: str) -> list[tuple[int, int]]:
    words = [word.casefold() for word in _WORDS.findall(label)]
    located = _word_locations(lines)
    spans = set()
    for start in range(len(located) - len(words) + 1):
        if [word for word, _ in located[start:start + len(words)]] == words:
            spans.add((located[start][1], located[start + len(words) - 1][1]))
    return sorted(spans)


def _line_locator(line: dict, page_sha: str) -> dict:
    text = line["text"]
    return {"blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
            "bboxMilliPoints": line["bboxMilliPoints"], "text": text,
            "lineTextSha256": _sha(text.encode("utf-8")),
            "pageArtifactSha256": page_sha}


def _context(lines: list[dict], spans: list[tuple[int, int]], page_sha: str,
             *, limit: int = 128) -> tuple[list[dict], int]:
    indices = set()
    for start, end in spans:
        # Table values often follow a vertical stack of axis labels; retain a
        # bounded forward window rather than just the next two text lines.
        indices.update(range(max(0, start - 2), min(len(lines), end + 33)))
        target_boxes = [lines[index]["bboxMilliPoints"] for index in range(start, end + 1)]
        for index, line in enumerate(lines):
            box = line["bboxMilliPoints"]
            if any(max(box[1], target[1]) < min(box[3], target[3])
                   and (box[2] <= target[0] or box[0] >= target[2])
                   for target in target_boxes):
                indices.add(index)
    ordered = sorted(indices)
    return [_line_locator(lines[index], page_sha) for index in ordered[:limit]], max(0, len(ordered) - limit)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit-report", type=Path, required=True)
    parser.add_argument("--fts-report", type=Path, required=True)
    parser.add_argument("--expected-fts-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists() or not args.output.parent.is_dir():
            raise ValueError("new output file in an existing directory required")
        manifest_bytes = args.manifest.read_bytes()
        manifest_sha = _sha(manifest_bytes)
        manifest = {row["file_id"]: row for row in load_public_manifest(args.manifest)}
        audit_bytes = args.audit_report.read_bytes()
        if len(audit_bytes) > 16 * 1024 * 1024:
            raise ValueError("audit report exceeds 16 MiB")
        _audit_gate(json.loads(audit_bytes), list(manifest.values()), manifest_sha,
                    (203, 202, 10142))
        fts_bytes = args.fts_report.read_bytes()
        if (_sha(fts_bytes) != args.expected_fts_sha256
                or len(fts_bytes) > 16 * 1024 * 1024):
            raise ValueError("FTS report SHA or size mismatch")
        fts = json.loads(fts_bytes)
        if (fts["status"] != "COMPLETE" or fts["ftsMatchedPages"] != 29
                or fts["selectedPages"] != 29
                or fts["manifestSha256"] != manifest_sha):
            raise ValueError("FTS report not full 29-page public census")
        policy = load_numeric_family_labels()
        special = load_numeric_table_policy()
        definitions = _definitions(policy, special)
        if (fts["labelPackSha256"] != policy["labelPackSha256"]
                or fts["tablePolicySha256"] != special["policySha256"]
                or fts["labelDefinitions"] != len(definitions)):
            raise ValueError("FTS report policy drift")
        database = args.index / "index.sqlite3"
        before = database.stat()
        by_page: dict[tuple[str, int], list[dict]] = defaultdict(list)
        page_sha = {}
        with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            for definition in definitions:
                phrase = _fts.fts_literal_phrase(definition["label"])
                for source_id, page_number in connection.execute(
                        "SELECT source_id,page_number FROM page_fts WHERE page_fts MATCH ?",
                        (phrase,)):
                    by_page[(source_id, page_number)].append(definition)
            for source_id, page_number in by_page:
                result = connection.execute(
                    "SELECT artifact_sha256 FROM pages WHERE source_id=? AND page_number=?",
                    (source_id, page_number)).fetchone()
                if result is None:
                    raise ValueError("FTS page missing from indexed pages")
                page_sha[(source_id, page_number)] = result[0]
        addresses = {(page["sourceFileId"], page["pageNumber"]) for page in fts["pages"]}
        if addresses != set(by_page) or len(addresses) != 29:
            raise ValueError("FTS address set changed")
        results = []
        for source_id, page_number in sorted(addresses):
            indexed = get_indexed_page(args.index, source_id, page_number)
            source = manifest[source_id]
            meta = indexed["source"]
            if (meta["source_sha256"] != source["sha256"]
                    or meta["stage"] != source["stage"]
                    or meta["section"] != source["section"]
                    or meta["object_id"] != source["object_id"]
                    or indexed["page"]["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"):
                raise ValueError("source or page differs from public manifest/index")
            lines = indexed["page"]["lines"]
            labels = []
            for definition in by_page[(source_id, page_number)]:
                spans = _matched_spans(lines, definition["label"])
                context, omitted = _context(lines, spans, page_sha[(source_id, page_number)])
                labels.append({"parameterCode": definition["parameterCode"],
                               "attribute": definition["attribute"],
                               "label": definition["label"],
                               "policyKind": definition["policyKind"],
                               "lineSpans": spans, "context": context,
                               "contextLinesOmitted": omitted})
            results.append({"sourceFileId": source_id, "sourceSha256": source["sha256"],
                            "stage": source["stage"], "manifestSection": source["section"],
                            "pageNumber": page_number,
                            "pageArtifactSha256": page_sha[(source_id, page_number)],
                            "labels": labels})
        after = database.stat()
        if (args.manifest.read_bytes() != manifest_bytes
                or args.audit_report.read_bytes() != audit_bytes
                or args.fts_report.read_bytes() != fts_bytes
                or any(getattr(before, field) != getattr(after, field)
                       for field in ("st_dev", "st_ino", "st_size", "st_mtime_ns"))):
            raise ValueError("input changed during review")
        report = {"schemaVersion": "numeric-fts-page-review-v1",
                  "status": "CONTEXT_CAPTURED_REVIEW_REQUIRED", "scope": fts["scope"],
                  "manifestSha256": manifest_sha, "auditReportSha256": _sha(audit_bytes),
                  "ftsReportSha256": _sha(fts_bytes), "pages": results,
                  "pageCount": len(results), "findingCount": None,
                  "parameterCoverage": None}
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, sort_keys=True, indent=2)
            output.write("\n")
        print(json.dumps({"status": report["status"], "pageCount": len(results),
                          "labelHits": sum(len(page["labels"]) for page in results),
                          "output": str(args.output)}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
