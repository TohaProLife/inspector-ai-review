"""Bounded, read-only discovery of public indexed text for family review.

This module selects candidate blocks. It neither extracts engineering facts nor
compares PD/RD values; a text hit is never a finding or parameter coverage.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any, Sequence

from .indexed_page_evidence import IndexedPageEvidenceError, load_indexed_page_evidence
from .public_document_index import INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest, readonly_index_uri


FAMILIES = frozenset({
    "RELATIVE_DELTA", "INCREASE", "DIFFERENT", "DECREASE", "CLASS_DECREASE",
    "LOWER_BOUND", "PRESENCE_SET", "RELATIVE_INCREASE", "UPPER_BOUND",
})
DEFAULT_KR_SOURCES = ("F0105", "F0106", "F0107", "F0136", "F0139", "F0140",
                      "F0141", "F0142", "F0143", "F0144")
DEFAULT_KR_TERMS = ("толщин*", "стен*", "арматур*", "диаметр*", "колонн*", "пилон*")
TERM_RE = re.compile(r"[^\W_]+\*?\Z", re.UNICODE)
SOURCE_RE = re.compile(r"F[0-9]{4}\Z")


class PublicFamilyBatchError(ValueError):
    """Batch cannot safely read selected public indexed evidence."""


def _terms(values: Sequence[str]) -> tuple[str, ...]:
    if (isinstance(values, (str, bytes)) or not isinstance(values, Sequence)
            or not 1 <= len(values) <= 12):
        raise PublicFamilyBatchError("select 1..12 FTS terms")
    result: list[str] = []
    for raw in values:
        if (not isinstance(raw, str) or not 2 <= len(raw) <= 40
                or not TERM_RE.fullmatch(raw) or raw.count("*") > 1):
            raise PublicFamilyBatchError("FTS terms must be bounded words or terminal-prefix words")
        word = raw.rstrip("*")
        if not any(character.isalpha() for character in word):
            raise PublicFamilyBatchError("FTS terms must contain letters")
        if raw.casefold() not in result:
            result.append(raw.casefold())
    return tuple(result)


def _sources(values: Sequence[str]) -> tuple[str, ...]:
    if (isinstance(values, (str, bytes)) or not isinstance(values, Sequence)
            or not 1 <= len(values) <= 50
            or any(not isinstance(value, str) or not SOURCE_RE.fullmatch(value)
                   for value in values)):
        raise PublicFamilyBatchError("select 1..50 distinct public PDF source IDs")
    if len(set(values)) != len(values):
        raise PublicFamilyBatchError("duplicate source ID")
    return tuple(values)


def _match_terms(text: str, terms: Sequence[str]) -> list[str]:
    found = []
    for term in terms:
        stem = re.escape(term.rstrip("*"))
        expression = (rf"(?<!\w){stem}\w*" if term.endswith("*")
                      else rf"(?<!\w){stem}(?!\w)")
        if re.search(expression, text, re.IGNORECASE | re.UNICODE):
            found.append(term)
    return found


def _balanced_order(source_ids: tuple[str, ...], public_pdfs: dict[str, dict[str, Any]]) -> list[str]:
    """Interleave stages, then round-robin files within each stage."""
    by_stage: dict[str, list[str]] = {}
    for source_id in source_ids:
        stage = public_pdfs[source_id]["stage"]
        by_stage.setdefault(stage, []).append(source_id)
    order: list[str] = []
    while any(by_stage.values()):
        for ids in by_stage.values():
            if ids:
                order.append(ids.pop(0))
    return order


def _read_fts(
    index_root: Path, source_ids: tuple[str, ...], public_pdfs: dict[str, dict[str, Any]],
    terms: tuple[str, ...],
    max_pages: int, max_ocr_pages: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], bool, bool]:
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise PublicFamilyBatchError("public index database missing")
    expression = " OR ".join(f'"{term[:-1]}"*' if term.endswith("*") else f'"{term}"'
                             for term in terms)
    placeholders = ",".join("?" for _ in source_ids)
    source_counts: dict[str, dict[str, int]] = {}
    hit_counts: dict[str, int] = {source_id: 0 for source_id in source_ids}
    hits_by_source: dict[str, list[dict[str, Any]]] = {source_id: [] for source_id in source_ids}
    try:
        with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("BEGIN")
            meta = dict(connection.execute(
                "SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise PublicFamilyBatchError("public index schema or extractor version mismatch")
            for source_id in source_ids:
                manifest_row = public_pdfs[source_id]
                source = connection.execute(
                    "SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
                if source is None or source["status"] != "COMPLETE":
                    raise PublicFamilyBatchError(f"{source_id} is not COMPLETE in public index")
                expected = (("object_id", "object_id"), ("stage", "stage"),
                            ("section", "section"), ("relative_path", "relative_path"),
                            ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                            ("expected_pages", "pdf_pages"))
                if any(source[column] != manifest_row[key] for column, key in expected):
                    raise PublicFamilyBatchError(f"{source_id} index metadata differs from manifest")
                if source["observed_pages"] != manifest_row["pdf_pages"] or source["error"] is not None:
                    raise PublicFamilyBatchError(f"{source_id} indexed source page count invalid")
                counts = connection.execute(
                    "SELECT COUNT(*) AS total,MIN(page_number) AS first,MAX(page_number) AS last,"
                    "SUM(disposition='TEXT_LAYER_CANDIDATE') AS text_pages,"
                    "SUM(disposition='OCR_REQUIRED') AS ocr_pages "
                    "FROM pages WHERE source_id=?", (source_id,)).fetchone()
                if (counts["total"] != manifest_row["pdf_pages"] or counts["first"] != 1
                        or counts["last"] != manifest_row["pdf_pages"]
                        or counts["text_pages"] != source["text_candidate_pages"]
                        or counts["ocr_pages"] != source["ocr_required_pages"]
                        or counts["text_pages"] + counts["ocr_pages"] != counts["total"]):
                    raise PublicFamilyBatchError(f"{source_id} indexed source pages incomplete")
                source_counts[source_id] = {"ocr": counts["ocr_pages"]}
            # page_fts.source_id is UNINDEXED in FTS5. One bounded scan over
            # selected IDs verifies that a missing/duplicate/extra FTS row
            # cannot silently turn a text page into a negative search result.
            expected_fts = Counter(
                (record["source_id"], record["page_number"])
                for record in connection.execute(
                    f"SELECT source_id,page_number FROM pages WHERE source_id IN ({placeholders})",
                    source_ids))
            actual_fts = Counter(
                (record["source_id"], record["page_number"])
                for record in connection.execute(
                    f"SELECT source_id,page_number FROM page_fts WHERE source_id IN ({placeholders})",
                    source_ids))
            if (actual_fts != expected_fts
                    or any(count != 1 for count in actual_fts.values())):
                raise PublicFamilyBatchError("selected public sources have missing, duplicate or extra FTS page rows")
            # No FTS result is allowed to confer source permission. Manifest gating
            # occurs before this read and each selected block is independently gated.
            hit_base = ("FROM page_fts f JOIN pages p ON p.source_id=f.source_id "
                        "AND p.page_number=f.page_number JOIN sources s ON s.source_id=f.source_id "
                        f"WHERE page_fts MATCH ? AND f.source_id IN ({placeholders}) "
                        "AND s.status='COMPLETE' AND p.disposition='TEXT_LAYER_CANDIDATE' ")
            count_sql = "SELECT f.source_id,COUNT(*) AS hit_count " + hit_base + "GROUP BY f.source_id"
            for item in connection.execute(count_sql, (expression, *source_ids)):
                hit_counts[item["source_id"]] = item["hit_count"]
            hit_sql = ("SELECT f.source_id,f.page_number,p.disposition "
                       "FROM page_fts f JOIN pages p ON p.source_id=f.source_id "
                       "AND p.page_number=f.page_number JOIN sources s ON s.source_id=f.source_id "
                       "WHERE page_fts MATCH ? AND f.source_id=? "
                       "AND s.status='COMPLETE' AND p.disposition='TEXT_LAYER_CANDIDATE' "
                       "ORDER BY bm25(page_fts),f.page_number LIMIT ?")
            for source_id in source_ids:
                if hit_counts[source_id]:
                    hits_by_source[source_id] = [dict(row) for row in connection.execute(
                        hit_sql, (expression, source_id, max_pages))]
            ocr_sql = ("SELECT p.source_id,p.page_number,p.source_sha256,p.artifact_sha256 "
                       "FROM pages p JOIN sources s ON s.source_id=p.source_id "
                       f"WHERE p.source_id IN ({placeholders}) AND s.status='COMPLETE' "
                       "AND p.disposition='OCR_REQUIRED' "
                       "ORDER BY p.source_id,p.page_number LIMIT ?")
            ocr_rows = [dict(row) for row in connection.execute(
                ocr_sql, (*source_ids, max_ocr_pages + 1))]
    except sqlite3.DatabaseError as error:
        raise PublicFamilyBatchError("public index FTS database invalid") from error
    ordered_sources = _balanced_order(source_ids, public_pdfs)
    offsets = {source_id: 0 for source_id in source_ids}
    hits: list[dict[str, Any]] = []
    while len(hits) < max_pages:
        advanced = False
        for source_id in ordered_sources:
            offset = offsets[source_id]
            if offset < len(hits_by_source[source_id]):
                hits.append(hits_by_source[source_id][offset])
                offsets[source_id] += 1
                advanced = True
                if len(hits) == max_pages:
                    break
        if not advanced:
            break
    selection = [
        {"sourceFileId": source_id, "stage": public_pdfs[source_id]["stage"],
         "matchedTextPages": hit_counts[source_id],
         "selectedTextPages": offsets[source_id],
         "omittedTextPages": hit_counts[source_id] - offsets[source_id],
         "ocrRequiredPages": source_counts[source_id]["ocr"]}
        for source_id in source_ids
    ]
    return (hits, ocr_rows[:max_ocr_pages], selection,
            sum(hit_counts.values()) > max_pages, len(ocr_rows) > max_ocr_pages)


def discover_public_family_batch(
    manifest_path: Path, index_root: Path, *, family: str = "DECREASE",
    source_ids: Sequence[str] | None = None, terms: Sequence[str] | None = None,
    max_pages: int = 40, max_blocks_per_page: int = 4,
    max_ocr_pages: int = 100,
) -> dict[str, Any]:
    """Return review candidates with exact, SHA-checked indexed block evidence.

    Default selection covers only KR-061/062's public source candidates. Other
    families require explicit source IDs and FTS words. Truncation is visible.
    """
    if family not in FAMILIES:
        raise PublicFamilyBatchError("unknown candidate family")
    if (source_ids is None) != (terms is None):
        raise PublicFamilyBatchError("source IDs and FTS terms must be supplied together")
    if source_ids is None:
        if family != "DECREASE":
            raise PublicFamilyBatchError("nondefault family requires source IDs and FTS terms")
        source_ids, terms = DEFAULT_KR_SOURCES, DEFAULT_KR_TERMS
    selected_sources = _sources(source_ids)
    selected_terms = _terms(terms)
    if (type(max_pages) is not int or not 1 <= max_pages <= 100
            or type(max_blocks_per_page) is not int or not 1 <= max_blocks_per_page <= 8
            or type(max_ocr_pages) is not int or not 1 <= max_ocr_pages <= 500):
        raise PublicFamilyBatchError("max_pages 1..100, max_blocks_per_page 1..8, max_ocr_pages 1..500")
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise PublicFamilyBatchError("public manifest changed during read")
    public_pdfs = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"
                   and row["file_id"] != "F0194"}
    invalid = set(selected_sources) - set(public_pdfs)
    if invalid:
        raise PublicFamilyBatchError(f"source outside public PDF allowlist: {sorted(invalid)}")
    hits, ocr_rows, source_selection, hits_truncated, ocr_truncated = _read_fts(
        index_root, selected_sources, public_pdfs, selected_terms, max_pages, max_ocr_pages)
    if len({(hit["source_id"], hit["page_number"]) for hit in hits}) != len(hits):
        raise PublicFamilyBatchError("duplicate FTS page address")
    candidates: list[dict[str, Any]] = []
    for hit in hits:
        source_id, page_number = hit["source_id"], hit["page_number"]
        row = public_pdfs[source_id]
        indexed = get_indexed_page(index_root, source_id, page_number)
        matched = []
        for index, block in enumerate(indexed["page"]["blocks"]):
            terms_found = _match_terms(block["text"], selected_terms)
            if terms_found:
                matched.append((index, terms_found))
        if not matched:
            raise PublicFamilyBatchError("FTS page hit has no exact indexed block locator")
        selected = matched[:max_blocks_per_page]
        try:
            evidence = load_indexed_page_evidence(
                manifest_path, index_root, source_id, page_number,
                expected_object_id=row["object_id"], expected_stage=row["stage"],
                expected_section=row["section"],
                block_indices=[index for index, _ in selected],
            )
        except IndexedPageEvidenceError as error:
            raise PublicFamilyBatchError(f"{source_id} page {page_number}: {error}") from error
        candidates.append({
            "sourceFileId": source_id, "pageNumber": page_number,
            "matchedTermsByBlock": [
                {"blockIndex": index, "terms": terms_found} for index, terms_found in selected],
            "matchedBlockCount": len(matched),
            "blocksTruncated": len(matched) > len(selected),
            "evidence": evidence,
            "reviewStatus": "NEEDS_HUMAN_REVIEW",
        })
    ocr_queue = []
    for item in ocr_rows:
        row = public_pdfs[item["source_id"]]
        if item["source_sha256"] != row["sha256"] or item["page_number"] > row["pdf_pages"]:
            raise PublicFamilyBatchError("OCR queue source/page differs from public manifest")
        indexed = get_indexed_page(index_root, item["source_id"], item["page_number"])
        if (indexed["source"]["status"] != "COMPLETE"
                or indexed["source"]["source_sha256"] != row["sha256"]
                or indexed["page"]["quality"]["disposition"] != "OCR_REQUIRED"):
            raise PublicFamilyBatchError("OCR queue page quality/source metadata differs from public index")
        ocr_queue.append({"sourceFileId": item["source_id"],
                          "pageNumber": item["page_number"],
                          "sourceSha256": item["source_sha256"],
                          "pageArtifactSha256": item["artifact_sha256"],
                          "parserProvenance": indexed["parserProvenance"],
                          "quality": indexed["page"]["quality"],
                          "status": "TARGETED_OCR_REQUIRED"})
    review_queue = [
        {"sourceFileId": item["sourceFileId"], "pageNumber": item["pageNumber"],
         "blockIndices": item["evidence"]["selectedBlockIndices"],
         "evidenceSha256": item["evidence"]["evidenceSha256"],
         "status": "NEEDS_HUMAN_REVIEW"}
        for item in candidates
    ]
    if manifest_path.read_bytes() != manifest_bytes:
        raise PublicFamilyBatchError("public manifest changed during batch")
    return {
        "schemaVersion": "public-family-batch-v1",
        "purpose": "REVIEW_CANDIDATES_ONLY",
        "family": family,
        "defaultProfile": "KR-061_KR-062_PUBLIC" if source_ids == DEFAULT_KR_SOURCES
                          and terms == DEFAULT_KR_TERMS else None,
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "indexVersionHash": _version_hash(),
        "sourceFileIds": list(selected_sources),
        "sourceSelection": source_selection,
        "ftsTerms": list(selected_terms),
        "limits": {"maxPages": max_pages, "maxBlocksPerPage": max_blocks_per_page,
                   "maxOcrPages": max_ocr_pages},
        "truncated": {"textPages": hits_truncated, "ocrPages": ocr_truncated},
        "candidates": candidates,
        "reviewQueue": review_queue,
        "ocrQueue": ocr_queue,
        "findingCount": None,
        "parameterCoverage": None,
    }
