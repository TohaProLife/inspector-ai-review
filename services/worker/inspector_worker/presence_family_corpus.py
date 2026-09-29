"""Audit-gated, read-only corpus probe for eight public presence-set codes.

FTS locates possible pages; SHA-checked original lines decide reviewer leads.
Neither an FTS miss nor a positive mention proves a complete set or absence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any

from .candidate_source_matrix import PUBLIC_MANIFEST_SHA256
from .indexed_page_evidence import IndexedPageEvidenceError, load_indexed_page_evidence
from .kr_decrease_batch import (
    EXPECTED_PUBLIC_COUNTS, KrDecreaseBatchError, _require_pass_audit,
)
from .presence_family_candidates import (
    LABEL_PACK_PATH, PRESENCE_CODES, _CARRIER_BY_FEATURE, _UNCERTAIN, _label_matches, _normalized,
    _scope_tokens, extract_indexed_presence_family_candidates,
    load_presence_family_labels,
)
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest,
)


# Broad recall terms for the eight literal feature dictionaries. FTS only
# narrows work; every reported line is re-read through the index evidence gate.
FTS_STEMS = (
    "лот", "дренаж", "демпфер", "проклад", "короб", "огражден",
    "гидроорош", "пылезащит", "пушк", "поручн", "тактил", "кнопк",
    "двусторон", "двухсторон", "счетчик", "счётчик", "электросчетчик",
    "электросчётчик", "водосчетчик", "водосчётчик", "теплосчетчик",
    "теплосчётчик",
)
MAX_PUBLIC_PAGES = 10_142


class PresenceCorpusProbeError(ValueError):
    """Audit, index, or selected public evidence cannot support this probe."""


def _exact_int(value: Any, expected: int) -> bool:
    return type(value) is int and value == expected


def _fts_expression() -> str:
    return " OR ".join(f'"{stem}"*' for stem in FTS_STEMS)


def _index_read_uri(database: Path) -> str:
    # Immutable SQLite ignores WAL. Only use it after the writer has
    # checkpointed/removed the WAL; otherwise ordinary ro must see that log.
    wal = database.with_name(database.name + "-wal")
    suffix = "?mode=ro" if wal.is_file() and wal.stat().st_size > 0 else "?mode=ro&immutable=1"
    return database.resolve().as_uri() + suffix


def _anchor_block(text: str) -> bool:
    normalized = _normalized(text)
    return any(_normalized(stem) in normalized for stem in FTS_STEMS)


def _label_hit(text: str, entry: dict[str, Any]) -> bool:
    normalized = _normalized(text)
    return any(_label_matches(normalized, label)
               for feature in entry["features"] for label in feature["labels"])


def _source_issue(
    line: str, entry: dict[str, Any], rule: dict[str, Any],
    stage: str, section: str,
) -> str | None:
    if "?" in line or _UNCERTAIN.search(line):
        return "CONTEXT_UNCERTAIN"
    scopes = _scope_tokens(line, entry["scopeGroups"])
    if scopes is None:
        return "SCOPE_UNRESOLVED"
    if stage == rule["expectedStage"]:
        side = "expected"
    elif stage in rule["allowedActualStages"]:
        side = "actual"
    else:
        return "STAGE_UNRESOLVED"
    if rule["manifestSectionStatus"][side] != "EXACT_CATEGORY":
        return "SECTION_PROOF_REQUIRED"
    if (section not in rule[f"required{side.title()}Sections"]
            or section not in rule[f"required{side.title()}DrawingSections"]):
        return "SECTION_MISMATCH"
    if entry["parameterCode"] == "ZU-129":
        carrier = _normalized(scopes[0]["matchedLabel"])
        if not any(carrier in _CARRIER_BY_FEATURE[feature["featureKey"]]
                   for feature in entry["features"]
                   if any(_label_matches(_normalized(line), label)
                          for label in feature["labels"])):
            return "FEATURE_SCOPE_CONFLICT"
    return None


def _sample_line(evidence: dict[str, Any], line: dict[str, Any], *,
                 reason: str) -> dict[str, Any]:
    return {
        "reason": reason, "sourceFileId": evidence["sourceFileId"],
        "objectId": evidence["objectId"], "stage": evidence["stage"],
        "manifestSection": evidence["section"],
        "sourceSha256": evidence["sourceSha256"],
        "pageNumber": evidence["pageNumber"],
        "pageArtifactSha256": evidence["pageArtifactSha256"],
        "pageEvidenceSha256": evidence["evidenceSha256"],
        "lineText": line["text"],
        "locator": {"blockIndex": line["blockIndex"],
                    "lineIndex": line["lineIndex"],
                    "bboxMilliPoints": line["bboxMilliPoints"]},
    }


def _read_evidence_chunks(
    manifest_path: Path, index_root: Path, source_id: str, page_number: int,
    row: dict[str, Any], chosen: list[int],
) -> list[dict[str, Any]]:
    try:
        return [load_indexed_page_evidence(
            manifest_path, index_root, source_id, page_number,
            expected_object_id=row["object_id"], expected_stage=row["stage"],
            expected_section=row["section"], block_indices=chosen)]
    except IndexedPageEvidenceError as error:
        if len(chosen) == 1 or "select fewer blocks" not in str(error):
            raise
        midpoint = len(chosen) // 2
        return (_read_evidence_chunks(manifest_path, index_root, source_id,
                                      page_number, row, chosen[:midpoint])
                + _read_evidence_chunks(manifest_path, index_root, source_id,
                                        page_number, row, chosen[midpoint:]))


def _process_evidence(
    evidence: dict[str, Any], *, manifest_path: Path, index_root: Path,
    source_id: str, page_number: int, row: dict[str, Any],
    chosen: list[int], policy: dict[str, Any], entries: dict[str, dict[str, Any]],
    code_reports: dict[str, dict[str, Any]], max_examples_per_code: int,
    label_pack_path: Path,
) -> None:
    for code in sorted(PRESENCE_CODES):
        entry, rule = entries[code], policy["rules"][code]
        relevant = [line for line in evidence["lines"] if _label_hit(line["text"], entry)]
        if not relevant:
            continue
        code_report = code_reports[code]
        code_report["labelHitLines"] += len(relevant)
        eligible = any(_source_issue(line["text"], entry, rule,
                                     evidence["stage"], evidence["section"]) is None
                       for line in relevant)
        candidates = []
        if eligible:
            candidates = extract_indexed_presence_family_candidates(
                manifest_path, index_root, source_id, page_number,
                expected_object_id=row["object_id"], expected_stage=row["stage"],
                expected_section=row["section"], block_indices=chosen,
                parameter_code=code, drawing_section=row["section"],
                label_pack_path=label_pack_path)
            if any(candidate["pageEvidenceSha256"] != evidence["evidenceSha256"]
                   for candidate in candidates):
                raise PresenceCorpusProbeError("candidate evidence differs from selected page")
        code_report["candidateMentions"] += len(candidates)
        for candidate in candidates:
            if len(code_report["examples"]) < max_examples_per_code:
                code_report["examples"].append(candidate)
        candidate_addresses = {(item["locator"]["blockIndex"],
                                item["locator"]["lineIndex"])
                               for item in candidates}
        for line in relevant:
            address = (line["blockIndex"], line["lineIndex"])
            if address in candidate_addresses:
                continue
            reason = (_source_issue(line["text"], entry, rule,
                                    evidence["stage"], evidence["section"])
                      or "UNQUALIFIED_LABEL_MENTION")
            code_report["nearMissCounts"][reason] += 1
            if len(code_report["nearMissExamples"]) < max_examples_per_code:
                code_report["nearMissExamples"].append(
                    _sample_line(evidence, line, reason=reason))


def probe_public_presence_corpus(
    manifest_path: Path, index_root: Path, audit_path: Path, *,
    max_pages: int = MAX_PUBLIC_PAGES, blocks_per_read: int = 16,
    max_examples_per_code: int = 5, max_ocr_queue: int = 2_000,
    label_pack_path: Path = LABEL_PACK_PATH,
    _expected_counts: dict[str, int] | None = None,
    _expected_manifest_sha256: str | None = None,
) -> dict[str, Any]:
    """Scan all FTS anchor pages by default, bounded by immutable public audit.

    Private expected-count/SHA overrides support synthetic tests. CLI exposes
    neither, and production always requires the exact 203-source inventory.
    """
    expected = EXPECTED_PUBLIC_COUNTS if _expected_counts is None else _expected_counts
    pinned_manifest_sha = (PUBLIC_MANIFEST_SHA256 if _expected_manifest_sha256 is None
                           else _expected_manifest_sha256)
    if (type(max_pages) is not int or not 1 <= max_pages <= MAX_PUBLIC_PAGES
            or type(blocks_per_read) is not int or not 1 <= blocks_per_read <= 64
            or type(max_examples_per_code) is not int or not 1 <= max_examples_per_code <= 20
            or type(max_ocr_queue) is not int or not 1 <= max_ocr_queue <= MAX_PUBLIC_PAGES):
        raise PresenceCorpusProbeError("probe limits outside bounded public range")
    manifest_bytes = manifest_path.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != pinned_manifest_sha:
        raise PresenceCorpusProbeError("public manifest SHA differs from pinned allowlist")
    rows = load_public_manifest(manifest_path)
    if manifest_path.read_bytes() != manifest_bytes:
        raise PresenceCorpusProbeError("public manifest changed during read")
    audit_bytes = audit_path.read_bytes()
    try:
        audit = json.loads(audit_bytes)
    except json.JSONDecodeError as error:
        raise PresenceCorpusProbeError("public audit JSON invalid") from error
    if not isinstance(audit, dict):
        raise PresenceCorpusProbeError("public audit must be an object")
    try:
        _require_pass_audit(audit, manifest_bytes, rows, expected)
    except KrDecreaseBatchError as error:
        raise PresenceCorpusProbeError(str(error)) from error
    policy = load_presence_family_labels(label_pack_path)
    entries = {entry["parameterCode"]: entry for entry in policy["entries"]}
    public_pdfs = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    if len(public_pdfs) != expected["pdfSources"]:
        raise PresenceCorpusProbeError("public PDF inventory differs from audit")
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise PresenceCorpusProbeError("public index database missing")
    with closing(sqlite3.connect(_index_read_uri(database), uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        meta = dict(connection.execute(
            "SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
            raise PresenceCorpusProbeError("index schema or version differs from PASS audit")
        counts = {"pages": connection.execute("SELECT COUNT(*) FROM pages").fetchone()[0],
                  "fts": connection.execute("SELECT COUNT(*) FROM page_fts").fetchone()[0],
                  "map": connection.execute("SELECT COUNT(*) FROM page_fts_map").fetchone()[0],
                  "sources": connection.execute("SELECT COUNT(*) FROM sources").fetchone()[0]}
        if (not _exact_int(counts["pages"], expected["pdfPages"])
                or not _exact_int(counts["fts"], expected["pdfPages"])
                or not _exact_int(counts["map"], expected["pdfPages"])
                or not _exact_int(counts["sources"], expected["sourceCount"])):
            raise PresenceCorpusProbeError("index inventory changed after PASS audit")
        hits = [dict(record) for record in connection.execute("""
            SELECT m.source_id AS sourceFileId,m.page_number AS pageNumber
            FROM page_fts JOIN page_fts_map m ON m.fts_rowid=page_fts.rowid
            JOIN pages p ON p.source_id=m.source_id AND p.page_number=m.page_number
            WHERE page_fts MATCH ? AND p.disposition='TEXT_LAYER_CANDIDATE'
            ORDER BY m.source_id,m.page_number
        """, (_fts_expression(),))]
        ocr_count = connection.execute(
            "SELECT COUNT(*) FROM pages WHERE disposition='OCR_REQUIRED'").fetchone()[0]
        ocr_rows = [dict(record) for record in connection.execute("""
            SELECT source_id AS sourceFileId,page_number AS pageNumber,
                   source_sha256 AS sourceSha256,artifact_sha256 AS pageArtifactSha256
            FROM pages WHERE disposition='OCR_REQUIRED'
            ORDER BY source_id,page_number LIMIT ?
        """, (max_ocr_queue,))]
    if len({(hit["sourceFileId"], hit["pageNumber"]) for hit in hits}) != len(hits):
        raise PresenceCorpusProbeError("duplicate FTS page address")
    ocr_queue = []
    for item in ocr_rows:
        row = public_pdfs.get(item["sourceFileId"])
        if (row is None or row["sha256"] != item["sourceSha256"]
                or not 1 <= item["pageNumber"] <= row["pdf_pages"]):
            raise PresenceCorpusProbeError("OCR queue address/source differs from public manifest")
        indexed = get_indexed_page(index_root, item["sourceFileId"], item["pageNumber"])
        if (indexed["source"]["source_sha256"] != item["sourceSha256"]
                or indexed["page"]["quality"]["disposition"] != "OCR_REQUIRED"):
            raise PresenceCorpusProbeError("OCR queue artifact quality/source differs from index")
        ocr_queue.append({**item, "parserProvenance": indexed["parserProvenance"],
                          "quality": indexed["page"]["quality"],
                          "status": "TARGETED_OCR_REQUIRED"})
    code_reports = {code: {"labelHitLines": 0, "candidateMentions": 0,
                           "nearMissCounts": Counter(), "examples": [],
                           "nearMissExamples": []}
                    for code in sorted(PRESENCE_CODES)}
    selected_pages = 0
    anchor_blocks_read = 0
    evidence_chunks = 0
    fts_only_pages = 0
    evidence_error_pages = 0
    evidence_errors: list[dict[str, Any]] = []
    for hit in hits[:max_pages]:
        source_id, page_number = hit["sourceFileId"], hit["pageNumber"]
        row = public_pdfs.get(source_id)
        if row is None or not 1 <= page_number <= row["pdf_pages"]:
            raise PresenceCorpusProbeError("FTS hit outside public PDF allowlist")
        indexed = get_indexed_page(index_root, source_id, page_number)
        if (indexed["source"]["source_sha256"] != row["sha256"]
                or indexed["source"]["status"] != "COMPLETE"
                or indexed["page"]["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"):
            raise PresenceCorpusProbeError("FTS hit source, SHA or quality differs from manifest")
        anchor_indices = [index for index, block in enumerate(indexed["page"]["blocks"])
                          if _anchor_block(block["text"])]
        if not anchor_indices:
            fts_only_pages += 1
            continue
        page_read = False
        page_error = False
        for offset in range(0, len(anchor_indices), blocks_per_read):
            chosen = anchor_indices[offset:offset + blocks_per_read]
            try:
                chunks = _read_evidence_chunks(
                    manifest_path, index_root, source_id, page_number, row, chosen)
            except IndexedPageEvidenceError as error:
                page_error = True
                if len(evidence_errors) < 20:
                    evidence_errors.append({"sourceFileId": source_id,
                                            "pageNumber": page_number,
                                            "reason": str(error)[:180]})
                break
            for evidence in chunks:
                _process_evidence(
                    evidence, manifest_path=manifest_path, index_root=index_root,
                    source_id=source_id, page_number=page_number, row=row,
                    chosen=evidence["selectedBlockIndices"], policy=policy,
                    entries=entries, code_reports=code_reports,
                    max_examples_per_code=max_examples_per_code,
                    label_pack_path=label_pack_path)
                anchor_blocks_read += len(evidence["selectedBlockIndices"])
                evidence_chunks += 1
                page_read = True
        selected_pages += int(page_read)
        evidence_error_pages += int(page_error)
    if manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes:
        raise PresenceCorpusProbeError("manifest or PASS audit changed during corpus probe")
    for code in code_reports:
        code_reports[code]["nearMissCounts"] = dict(sorted(
            code_reports[code]["nearMissCounts"].items()))
    partial = len(hits) > max_pages or evidence_error_pages > 0
    return {
        "schemaVersion": "presence-public-corpus-probe-v1",
        "purpose": "REVIEW_ONLY", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "scanStatus": "PARTIAL" if partial else "FTS_HITS_SCANNED",
        "searchCompleteness": "NOT_ESTABLISHED",
        "absenceInference": "PROHIBITED", "enumerationCompleteness": "NOT_ESTABLISHED",
        "manifestSha256": audit["manifestSha256"],
        "indexVersionHash": audit["indexVersionHash"],
        "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
        "rulePackSha256": policy["candidatePackSha256"],
        "labelPackSha256": policy["labelPackSha256"],
        "inventory": {"sourceCount": expected["sourceCount"],
                      "pdfSources": expected["pdfSources"],
                      "pdfPages": expected["pdfPages"],
                      "txtInventorySources": expected["txtInventorySources"]},
        "ftsTerms": list(FTS_STEMS), "ftsHitPages": len(hits),
        "selectedHitPages": min(len(hits), max_pages),
        "pagesWithSelectedAnchorBlocks": selected_pages,
        "ftsOnlyPages": fts_only_pages,
        "anchorBlocksRead": anchor_blocks_read,
        "evidenceChunks": evidence_chunks,
        "evidenceErrorPages": evidence_error_pages,
        "evidenceErrorExamples": evidence_errors,
        "truncated": {"hitPages": len(hits) > max_pages,
                      "ocrQueue": ocr_count > max_ocr_queue},
        "codeReports": code_reports,
        "ocrRequiredPages": ocr_count, "ocrQueue": ocr_queue,
        "findingCount": None, "parameterCoverage": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=MAX_PUBLIC_PAGES)
    parser.add_argument("--blocks-per-read", type=int, default=16)
    parser.add_argument("--max-examples-per-code", type=int, default=5)
    parser.add_argument("--max-ocr-queue", type=int, default=2_000)
    arguments = parser.parse_args()
    report = probe_public_presence_corpus(
        arguments.manifest, arguments.index, arguments.audit,
        max_pages=arguments.max_pages,
        blocks_per_read=arguments.blocks_per_read,
        max_examples_per_code=arguments.max_examples_per_code,
        max_ocr_queue=arguments.max_ocr_queue)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
