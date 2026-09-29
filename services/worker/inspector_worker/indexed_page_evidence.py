"""Read-only, manifest-bound text evidence from selected public index blocks.

This adapter returns source candidates for family extractors, not engineering
facts or proof that a value is absent. OCR_REQUIRED pages must be handled by a
separate, explicitly selected OCR route.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, Sequence, TypedDict

from .public_document_index import (
    INDEX_SCHEMA_VERSION, _validate_cached_page, _version_hash,
    load_public_manifest, readonly_index_uri,
)


MAX_SELECTED_BLOCKS = 64
MAX_SELECTED_LINES = 512
MAX_EVIDENCE_TEXT_BYTES = 64 * 1024
_HASH = re.compile(r"[a-f0-9]{64}\Z")


class IndexedPageEvidenceError(ValueError):
    """Selected page cannot safely supply public text evidence."""


class IndexedPageNeedsOcr(IndexedPageEvidenceError):
    """Indexed text is insufficient; request targeted OCR for this page."""


class IndexedTextBlock(TypedDict):
    blockIndex: int
    text: str
    bboxMilliPoints: list[int]


class IndexedTextLine(TypedDict):
    blockIndex: int
    lineIndex: int
    text: str
    bboxMilliPoints: list[int]


class IndexedPageEvidence(TypedDict):
    schemaVersion: str
    candidateStatus: str
    manifestSha256: str
    indexVersionHash: str
    qualityPolicyVersion: str
    sourceFileId: str
    objectId: str
    stage: str
    section: str
    sourceSha256: str
    sourceRelativePath: str
    pageNumber: int
    pageArtifactSha256: str
    parserProvenance: str
    coordinateSystem: str
    widthMilliPoints: int
    heightMilliPoints: int
    quality: dict[str, Any]
    selectedBlockIndices: list[int]
    blocks: list[IndexedTextBlock]
    lines: list[IndexedTextLine]
    sectionCandidates: list[dict[str, Any]]
    tableRowCandidates: list[dict[str, Any]]
    evidenceSha256: str


def _manifest_row(path: Path, source_id: str) -> tuple[dict[str, Any], str]:
    before = path.read_bytes()
    try:
        rows = load_public_manifest(path)
    except ValueError as error:
        raise IndexedPageEvidenceError("public manifest invalid or source outside allowlist") from error
    if path.read_bytes() != before:
        raise IndexedPageEvidenceError("public manifest changed during read")
    matching = [row for row in rows if row["file_id"] == source_id]
    if len(matching) != 1:
        raise IndexedPageEvidenceError("source is outside exact public manifest allowlist")
    row = matching[0]
    if row["extension"] != ".pdf" or source_id == "F0194":
        raise IndexedPageEvidenceError("only public PDF pages may supply text evidence")
    return row, hashlib.sha256(before).hexdigest()


def _selected_indices(indices: Sequence[int]) -> list[int]:
    if (isinstance(indices, (str, bytes)) or not isinstance(indices, Sequence)
            or not 1 <= len(indices) <= MAX_SELECTED_BLOCKS
            or any(type(index) is not int or index < 0 for index in indices)
            or len(set(indices)) != len(indices)):
        raise IndexedPageEvidenceError("select 1..64 distinct original block indices")
    return sorted(indices)


def _candidate_subset(page: dict[str, Any], key: str,
                      selected: set[int], lines: list[IndexedTextLine]) -> list[dict[str, Any]]:
    raw = page.get(key)
    if not isinstance(raw, list):
        raise IndexedPageEvidenceError(f"indexed {key} metadata missing")
    lookup = {(line["blockIndex"], line["lineIndex"]): line for line in lines}
    result = []
    for candidate in raw:
        if not isinstance(candidate, dict):
            raise IndexedPageEvidenceError(f"indexed {key} metadata invalid")
        if candidate.get("blockIndex") not in selected:
            continue
        line = lookup.get((candidate.get("blockIndex"), candidate.get("lineIndex")))
        if (line is None or candidate.get("status") != "CANDIDATE"
                or candidate.get("text") != line["text"]
                or candidate.get("bboxMilliPoints") != line["bboxMilliPoints"]):
            raise IndexedPageEvidenceError(f"indexed {key} provenance mismatch")
        result.append(candidate)
    return result


def load_indexed_page_evidence(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int, *,
    expected_object_id: str, expected_stage: str, expected_section: str,
    block_indices: Sequence[int],
) -> IndexedPageEvidence:
    """Select original indexed blocks after all source, page and scope gates.

    Throws on incomplete/corrupt pages and never silently truncates text. One
    call reads at most 64 original blocks and 64 KiB of selected text.
    """
    if (not isinstance(source_id, str) or not re.fullmatch(r"F[0-9]{4}", source_id)
            or type(page_number) is not int or page_number < 1):
        raise IndexedPageEvidenceError("invalid public page address")
    if any(not isinstance(value, str) or not value for value in
           (expected_object_id, expected_stage, expected_section)):
        raise IndexedPageEvidenceError("expected object, stage and section are required")
    selected_indices = _selected_indices(block_indices)
    row, manifest_sha = _manifest_row(manifest_path, source_id)
    if (row["object_id"], row["stage"], row["section"]) != (
            expected_object_id, expected_stage, expected_section):
        raise IndexedPageEvidenceError("requested object/stage/section differs from public manifest")
    if page_number > row["pdf_pages"]:
        raise IndexedPageEvidenceError("page number exceeds public manifest")

    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise IndexedPageEvidenceError("public index database missing")
    try:
        with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("BEGIN")  # Stable metadata snapshot during concurrent indexing.
            meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise IndexedPageEvidenceError("public index schema or extraction version mismatch")
            source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            if source is None or source["status"] != "COMPLETE":
                raise IndexedPageEvidenceError("public source is not COMPLETE")
            fields = (("object_id", "object_id"), ("stage", "stage"),
                      ("section", "section"), ("relative_path", "relative_path"),
                      ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                      ("expected_pages", "pdf_pages"))
            if any(source[column] != row[manifest_field] for column, manifest_field in fields):
                raise IndexedPageEvidenceError("indexed source metadata differs from public manifest")
            if source["observed_pages"] != row["pdf_pages"] or source["error"] is not None:
                raise IndexedPageEvidenceError("indexed source page count or status invalid")
            counts = connection.execute("""SELECT COUNT(*) AS count, MIN(page_number) AS first,
                MAX(page_number) AS last,
                SUM(CASE WHEN disposition='TEXT_LAYER_CANDIDATE' THEN 1 ELSE 0 END) AS text_count,
                SUM(CASE WHEN disposition='OCR_REQUIRED' THEN 1 ELSE 0 END) AS ocr_count
                FROM pages WHERE source_id=?""", (source_id,)).fetchone()
            if (counts["count"] != row["pdf_pages"] or counts["first"] != 1
                    or counts["last"] != row["pdf_pages"]
                    or counts["text_count"] != source["text_candidate_pages"]
                    or counts["ocr_count"] != source["ocr_required_pages"]
                    or counts["text_count"] + counts["ocr_count"] != row["pdf_pages"]):
                raise IndexedPageEvidenceError("indexed source pages incomplete or inconsistent")
            page_record = connection.execute("SELECT * FROM pages WHERE source_id=? AND page_number=?",
                                             (source_id, page_number)).fetchone()
            if page_record is None:
                raise IndexedPageEvidenceError("selected page missing from public index")
            if (page_record["source_sha256"] != row["sha256"]
                    or not isinstance(page_record["artifact_sha256"], str)
                    or not _HASH.fullmatch(page_record["artifact_sha256"])):
                raise IndexedPageEvidenceError("selected page SHA metadata mismatch")
            page = _validate_cached_page(index_root, row, page_number,
                                         (page_record["artifact_path"], page_record["artifact_sha256"],
                                          page_record["parser_provenance"]))
            if page is None:
                raise IndexedPageEvidenceError("indexed page artifact hash/schema/quality invalid")
            if (not isinstance(page.get("sectionCandidates"), list)
                    or not isinstance(page.get("tableRowCandidates"), list)):
                raise IndexedPageEvidenceError("indexed page candidate metadata invalid")
            if (page_record["disposition"] != page["quality"]["disposition"]
                    or page_record["block_count"] != len(page["blocks"])
                    or page_record["section_candidate_count"] != len(page["sectionCandidates"])
                    or page_record["table_candidate_count"] != len(page["tableRowCandidates"])
                    or page_record["text_chars"] != len("\n".join(block["text"] for block in page["blocks"]))):
                raise IndexedPageEvidenceError("indexed page metadata differs from artifact")
            if page_record["disposition"] == "OCR_REQUIRED":
                raise IndexedPageNeedsOcr(f"{source_id} page {page_number} requires targeted OCR")
            if page_record["disposition"] != "TEXT_LAYER_CANDIDATE":
                raise IndexedPageEvidenceError("indexed page disposition is unsupported")
    except sqlite3.DatabaseError as error:
        raise IndexedPageEvidenceError("public index database invalid") from error

    if selected_indices[-1] >= len(page["blocks"]):
        raise IndexedPageEvidenceError("selected block index outside indexed page")
    selected = set(selected_indices)
    blocks: list[IndexedTextBlock] = [
        {"blockIndex": index, "text": page["blocks"][index]["text"],
         "bboxMilliPoints": page["blocks"][index]["bboxMilliPoints"]}
        for index in selected_indices
    ]
    lines: list[IndexedTextLine] = [
        {"blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
         "text": line["text"], "bboxMilliPoints": line["bboxMilliPoints"]}
        for line in page["lines"] if line["blockIndex"] in selected
    ]
    if len(lines) > MAX_SELECTED_LINES:
        raise IndexedPageEvidenceError("selected blocks exceed line limit; select fewer blocks")
    if len({(line["blockIndex"], line["lineIndex"]) for line in lines}) != len(lines):
        raise IndexedPageEvidenceError("indexed line addresses are not unique")
    byte_count = sum(len(item["text"].encode("utf-8")) for item in [*blocks, *lines])
    if byte_count > MAX_EVIDENCE_TEXT_BYTES:
        raise IndexedPageEvidenceError("selected text exceeds 64 KiB; select fewer blocks")
    sections = _candidate_subset(page, "sectionCandidates", selected, lines)
    tables = _candidate_subset(page, "tableRowCandidates", selected, lines)
    evidence: IndexedPageEvidence = {
        "schemaVersion": "indexed-page-evidence-v1", "candidateStatus": "CANDIDATE",
        "manifestSha256": manifest_sha, "indexVersionHash": page["indexVersionHash"],
        "qualityPolicyVersion": page["qualityPolicyVersion"],
        "sourceFileId": source_id, "objectId": row["object_id"],
        "stage": row["stage"], "section": row["section"],
        "sourceSha256": row["sha256"], "sourceRelativePath": row["relative_path"],
        "pageNumber": page_number, "pageArtifactSha256": page_record["artifact_sha256"],
        "parserProvenance": page_record["parser_provenance"],
        "coordinateSystem": page["coordinateSystem"],
        "widthMilliPoints": page["widthMilliPoints"],
        "heightMilliPoints": page["heightMilliPoints"], "quality": page["quality"],
        "selectedBlockIndices": selected_indices, "blocks": blocks, "lines": lines,
        "sectionCandidates": sections, "tableRowCandidates": tables,
        "evidenceSha256": "",
    }
    content = {key: value for key, value in evidence.items() if key != "evidenceSha256"}
    evidence["evidenceSha256"] = hashlib.sha256(json.dumps(
        content, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode("utf-8")).hexdigest()
    return evidence
