"""Versioned, read-only KR material-term observations from audited public index v4.

Lexical observations and nearby lines require human element review. They do not
establish a PD/RD pair, discrepancy, compliance, or parameter coverage.
"""

from __future__ import annotations

import argparse
import contextlib
import gzip
import hashlib
import json
import re
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

SCHEMA = "kr-material-review-v1"
INDEX_VERSION = "7d7dfa2f3e0279a91095"
MANIFEST_SHA = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
AUDIT_SHA = "69ef56fc23e779dfed25aa60c5615be3ee58f244200c6620c2b1ddaec335f49a"
SOURCE_IDS = ("F0105", "F0106", "F0107", "F0136", "F0139", "F0140", "F0141", "F0142", "F0143", "F0144")
PATTERNS = {
    "KR-057": re.compile(r"(?<![\w])[АA]\s*(?:400|500[СC])(?![\w])", re.I),
    "KR-056": re.compile(r"(?<![\w])[СC]\s*(?:245|345)(?![\w])", re.I),
}
HOMOGLYPHS = str.maketrans({"А": "A", "С": "C"})
CONTEXT_PINNED = {
    ("F0105", 13, "2b269a2bb9f61f36ce9a1c39c510e4345d2ea9e4882321101675b9eba0c160ba"):
        "ELEMENT_PARAGRAPH_HINT",
    ("F0105", 14, "74c7566c5f7b56bba8fbd51eeba02cbaa4bb2a32360b0999104fb441ac8878b9"):
        "ELEMENT_PARAGRAPH_HINT",
    ("F0105", 14, "a2aea12b32c6237b4a40eefecf087e95402ab7e54aef23d1766935da62e45790"):
        "ELEMENT_PARAGRAPH_HINT",
    ("F0139", 3, "8117731dabc5f2de55eb5637399a91f2b13129d0944d7a00f0e85d888bf14c0a"):
        "STANDARD_REFERENCE_UNLINKED",
    ("F0139", 3, "d0c508f55cd04850b5b8b1cb0a9af3cf984533989fb938f3bc1b4219b3c81eed"):
        "TABLE_HEADING_UNLINKED",
    ("F0140", 3, "45f70ae98ceea1608ebd5f064fbf68fe028dff4823e5af5cc1995b643a33f36d"):
        "STANDARD_REFERENCE_UNLINKED",
    ("F0140", 3, "aa6f68b06eb27e0b5999e281933bb63891270f882d450b5a20fdc58959f4730b"):
        "GENERAL_NOTE_UNLINKED",
    ("F0140", 3, "d0c508f55cd04850b5b8b1cb0a9af3cf984533989fb938f3bc1b4219b3c81eed"):
        "TABLE_HEADING_UNLINKED",
    ("F0140", 3, "a34c0abb9d5eb1644b04bee582cba1671f040eaecb3877997ae9bf236e4001c2"):
        "TABLE_HEADING_UNLINKED",
}


class MaterialReviewError(ValueError):
    """Public source or indexed evidence fails verification."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _member_name(info: zipfile.ZipInfo) -> str:
    # Older ZIP archives store Cyrillic bytes as CP866 while claiming CP437.
    return info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866")


def _verify_originals(archive_path: Path, selected: dict[str, dict[str, Any]]) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        matches: dict[str, zipfile.ZipInfo] = {}
        prefixes: set[str] = set()
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = _member_name(info)
            for source_id, row in selected.items():
                rel = row["relative_path"]
                if name == rel or name.endswith("/" + rel):
                    if source_id in matches:
                        raise MaterialReviewError(f"ambiguous original PDF: {source_id}")
                    matches[source_id] = info
                    prefixes.add(name[:-(len(rel) + 1)] if name != rel else "")
        if set(matches) != set(selected) or len(prefixes) != 1:
            raise MaterialReviewError("original PDF inventory missing or ambiguous")
        for source_id, info in matches.items():
            row = selected[source_id]
            if info.file_size != row["size_bytes"]:
                raise MaterialReviewError(f"original PDF size mismatch: {source_id}")
            digest = hashlib.sha256()
            count = 0
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    count += len(chunk)
            if count != row["size_bytes"] or digest.hexdigest() != row["sha256"]:
                raise MaterialReviewError(f"original PDF SHA mismatch: {source_id}")


def _terms(text: str) -> list[tuple[str, str, str]]:
    result = []
    for code, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            raw = match.group().replace(" ", "").upper()
            result.append((code, raw, raw.translate(HOMOGLYPHS)))
    return result


def classify_context(source_id: str, page_number: int, line_sha256: str) -> str:
    """Classify SHA-pinned lines on four reviewed pages; never infer an element link."""
    return CONTEXT_PINNED.get((source_id, page_number, line_sha256),
                              "UNCLASSIFIED_TEXT_MENTION")


def _load_page(index_root: Path, source_id: str, row: sqlite3.Row,
               source_sha: str) -> dict[str, Any]:
    path = (index_root / row["artifact_path"]).resolve()
    if not path.is_relative_to(index_root.resolve()) or not path.is_file():
        raise MaterialReviewError(f"unsafe or missing page artifact: {source_id} p{row['page_number']}")
    data = path.read_bytes()
    if _sha(data) != row["artifact_sha256"]:
        raise MaterialReviewError(f"page artifact SHA mismatch: {source_id} p{row['page_number']}")
    try:
        page = json.loads(gzip.decompress(data))
    except (OSError, ValueError) as error:
        raise MaterialReviewError("page artifact invalid") from error
    if (page.get("indexVersionHash") != INDEX_VERSION or page.get("inputSha256") != source_sha
            or page.get("pageNumber") != row["page_number"]
            or page.get("quality", {}).get("disposition") != row["disposition"]
            or not isinstance(page.get("lines"), list)):
        raise MaterialReviewError(f"page provenance mismatch: {source_id} p{row['page_number']}")
    return page


def evaluate_material_review(manifest_path: Path, index_root: Path, audit_path: Path,
                             archive_path: Path, *, source_ids: tuple[str, ...] = SOURCE_IDS,
                             _pins: dict[str, str] | None = None) -> dict[str, Any]:
    """Verify original bytes and every selected page; emit review-only exact terms."""
    pins = _pins or {"manifest": MANIFEST_SHA, "audit": AUDIT_SHA, "index": INDEX_VERSION}
    manifest_bytes, audit_bytes = manifest_path.read_bytes(), audit_path.read_bytes()
    if _sha(manifest_bytes) != pins["manifest"] or _sha(audit_bytes) != pins["audit"]:
        raise MaterialReviewError("public v4 manifest/audit SHA mismatch")
    # Hash whole public manifest, but parse only its allowed TRAIN_PUBLIC rows.
    manifest = [json.loads(line) for line in manifest_bytes.splitlines()
                if b'"TRAIN_PUBLIC"' in line and b'"INCLUDE"' in line
                and b'"PUBLIC_TRAIN"' in line]
    audit = json.loads(audit_bytes)
    if (len(manifest) != 203 or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != pins["manifest"]
            or audit.get("indexVersionHash") != pins["index"]
            or audit.get("findingCount") != 0 or audit.get("fatalFindingCount") != 0
            or audit.get("actual", {}).get("verifiedPageArtifacts") != 10142
            or audit.get("actual", {}).get("ftsMapRows") != 10142):
        raise MaterialReviewError("public v4 audit gate failed")
    by_id = {row["file_id"]: row for row in manifest}
    if len(by_id) != len(manifest) or not source_ids or len(set(source_ids)) != len(source_ids) \
            or not set(source_ids).issubset(SOURCE_IDS):
        raise MaterialReviewError("source selection invalid")
    selected = {source_id: by_id[source_id] for source_id in source_ids}
    for source_id, row in selected.items():
        expected_stage = "PD" if source_id in SOURCE_IDS[:3] else "RD"
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility"),
                row.get("extension"), row.get("object_id"), row.get("stage"), row.get("section")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", ".pdf", "OBJ-NOVOSLOBODSKAYA",
                expected_stage, "KR"):
            raise MaterialReviewError(f"source outside public KR scope: {source_id}")
    _verify_originals(archive_path, selected)
    observations, unknown_pages, source_summary = [], [], []
    database = index_root / "index.sqlite3"
    with contextlib.closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": pins["index"]}:
            raise MaterialReviewError("index version mismatch")
        for source_id, manifest_row in selected.items():
            source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            if source is None or any((source[column] != manifest_row[key]) for column, key in (
                    ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                    ("expected_pages", "pdf_pages"), ("object_id", "object_id"),
                    ("stage", "stage"), ("section", "section"), ("relative_path", "relative_path"))):
                raise MaterialReviewError(f"index source differs from manifest: {source_id}")
            if source["status"] != "COMPLETE" or source["observed_pages"] != manifest_row["pdf_pages"]:
                raise MaterialReviewError(f"index source incomplete: {source_id}")
            pages = connection.execute("SELECT * FROM pages WHERE source_id=? ORDER BY page_number",
                                       (source_id,)).fetchall()
            if len(pages) != manifest_row["pdf_pages"] or [p["page_number"] for p in pages] != list(range(1, len(pages) + 1)):
                raise MaterialReviewError(f"index page inventory incomplete: {source_id}")
            counts = {"TEXT_LAYER_CANDIDATE": 0, "OCR_REQUIRED": 0}
            for record in pages:
                if record["source_sha256"] != manifest_row["sha256"]:
                    raise MaterialReviewError("page source SHA mismatch")
                page = _load_page(index_root, source_id, record, manifest_row["sha256"])
                disposition = record["disposition"]
                if disposition not in counts:
                    raise MaterialReviewError("unknown page disposition")
                counts[disposition] += 1
                if disposition == "OCR_REQUIRED":
                    unknown_pages.append({"sourceFileId": source_id, "pageNumber": record["page_number"],
                                          "pageArtifactSha256": record["artifact_sha256"],
                                          "status": "OCR_REQUIRED_UNKNOWN"})
                    continue
                lines = page["lines"]
                for global_index, line in enumerate(lines):
                    raw = line.get("text")
                    if not isinstance(raw, str):
                        raise MaterialReviewError("invalid indexed line")
                    for code, raw_term, term in _terms(raw):
                        # Wide enough to retain a preceding element phrase when
                        # PDF extraction interleaves a title stamp or page mark.
                        # These are positional clues, never an inferred link.
                        nearby = [{"lineIndex": i, "rawText": lines[i]["text"]}
                                  for i in range(max(0, global_index - 10), min(len(lines), global_index + 3))
                                  if i != global_index and len(lines[i]["text"].strip()) > 3]
                        observations.append({
                            "parameterCode": code, "term": term, "rawTerm": raw_term,
                            "sourceFileId": source_id, "stage": manifest_row["stage"],
                            "sourceSha256": manifest_row["sha256"], "pageNumber": record["page_number"],
                            "pageArtifactSha256": record["artifact_sha256"],
                            "rawText": raw, "lineSha256": _sha(raw.encode("utf-8")),
                            "locator": {"globalLineIndex": global_index,
                                        "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                                        "bboxMilliPoints": line["bboxMilliPoints"]},
                            "nearbyLines": nearby, "elementContextStatus": "UNVERIFIED",
                            "contextClass": classify_context(source_id, record["page_number"],
                                                             _sha(raw.encode("utf-8"))),
                            "reviewStatus": "REVIEW_ONLY_ABSTAIN",
                        })
            source_summary.append({"sourceFileId": source_id, "stage": manifest_row["stage"],
                                   "sourceSha256": manifest_row["sha256"], "pages": len(pages),
                                   "textLayerPages": counts["TEXT_LAYER_CANDIDATE"],
                                   "ocrRequiredPages": counts["OCR_REQUIRED"]})
    return {"schemaVersion": SCHEMA, "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "purpose": "REVIEW_ONLY", "manifestSha256": pins["manifest"], "auditSha256": pins["audit"],
            "indexVersionHash": pins["index"], "objectId": "OBJ-NOVOSLOBODSKAYA",
            "sources": source_summary, "observations": observations, "ocrRequiredUnknownPages": unknown_pages,
            "evaluation": {"status": "ABSTAIN", "reasonCodes": ["ELEMENT_IDENTITY_UNVERIFIED",
                            "REVISION_UNVERIFIED", "APPROVAL_UNVERIFIED", "OCR_PAGES_UNASSESSED"],
                           "comparableFacts": [], "finding": None,
                           "findingCount": None, "parameterCoverage": None}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("manifest", "index", "audit", "archive"):
        parser.add_argument("--" + key, required=True, type=Path)
    parser.add_argument("--source-id", action="append", choices=SOURCE_IDS)
    args = parser.parse_args()
    result = evaluate_material_review(args.manifest, args.index, args.audit, args.archive,
                                      source_ids=tuple(args.source_id or SOURCE_IDS))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
