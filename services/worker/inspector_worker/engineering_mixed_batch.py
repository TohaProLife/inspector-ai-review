"""Read-only OV/VK lexical observations for ten unresolved engineering codes.

All selected pages come from the audited 203-source TRAIN_PUBLIC index. Quotes
are review leads, not typed engineering facts or comparable PD/RD pairs.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

from .kr_decrease_batch import EXPECTED_PUBLIC_COUNTS, _require_pass_audit
from .public_document_index import (
    INDEX_SCHEMA_VERSION, _version_hash, get_indexed_page, load_public_manifest,
    readonly_index_uri,
)


PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
OBJECT_ID = "OBJ-TYUMENSKAYA-5-GOLD-SEED"
SOURCE_ROLES = (("PD", "OV"), ("PD", "VK"),
                ("RD_ID_MIXED", "OV"), ("RD_ID_MIXED", "VK"))
CODE_SPEC: dict[str, tuple[str, tuple[str, ...], str]] = {
    "IOS2-072": ("VK", ("труб*", "полипропилен*", "оцинкован*", "давлен*"),
                 r"труб|полипропилен|оцинкован|давлен"),
    "IOS2-073": ("VK", ("насос*",), r"насос"),
    "IOS3-075": ("VK", ("канализац*", "чугун*", "пвх", "малошум*"),
                 r"канализац|чугун|пвх|малошум"),
    "IOS4-076": ("OV", ("т1", "т2", "стояк*"),
                 r"(?<!\w)т[12](?!\w)|стояк"),
    "IOS4-077": ("OV", ("радиатор*", "теплоотдач*"),
                 r"радиатор|теплоотдач"),
    "IOS4-078": ("OV", ("воздуховод*",), r"воздуховод"),
    "IOS4-079": ("OV", ("вентилятор*",), r"вентилятор"),
    "PPM-111": ("OV", ("озк", "клапан*", "огнезадерживающ*"),
                r"(?<!\w)озк(?!\w)|огнезадерживающ|"
                r"(?:противопожарн\w*\s+клапан|клапан\w*\s+противопожарн)"),
    "PPM-112": ("OV", ("дымоудален*", "подпор*"),
                r"дымоудален|подпор|(?<!\w)ду(?!\w)"),
    "PPM-113": ("VK", ("пожарн*", "впв", "кольц*"),
                r"(?<!\w)впв(?!\w)|(?:пожарн\w*\s+кран|кран\w*\s+пожарн)|"
                r"кольц\w*\s+трубопровод|внутренн\w*\s+пожаротушен"),
}
TITLE_CUES = {
    "RD_TITLE": re.compile(r"рабочая\s+документация", re.I),
    "EXECUTION_ACT": re.compile(
        r"акт\s+освидетельствован|освидетельствования\s+скрытых\s+работ|(?<!\w)аоср(?!\w)", re.I),
    "EXECUTION_DRAWING": re.compile(r"исполнительн(?:ый|ая|ое)\s+(?:чертеж|схем)", re.I),
    "PD_TITLE": re.compile(r"проектная\s+документация", re.I),
}
SECTION_CUES = {
    "OV": re.compile(r"отоплени|вентиляци|дымоудален|(?<!\w)ов[12]?(?!\w)", re.I),
    "VK": re.compile(r"водоснабжен|водоотведен|канализаци|(?<!\w)вк(?!\w)", re.I),
}
MAX_QUOTE_CHARS = 1400


class EngineeringMixedBatchError(ValueError):
    """The report cannot meet the public source and evidence gates."""


def _code_scope(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = sorted((row for row in rows if row["extension"] == ".pdf"
                       and row["object_id"] == OBJECT_ID
                       and (row["stage"], row["section"]) in SOURCE_ROLES),
                      key=lambda row: row["file_id"])
    roles = {(row["stage"], row["section"]) for row in selected}
    if roles != set(SOURCE_ROLES) or len(selected) != 16:
        raise EngineeringMixedBatchError("OV/VK public source inventory changed")
    return selected


def _title_cues(page: dict[str, Any], *, max_lines: int = 3) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for line in page["lines"]:
        text = line["text"].strip()
        kinds = [kind for kind, pattern in TITLE_CUES.items() if pattern.search(text)]
        if not kinds:
            continue
        if len(text) > MAX_QUOTE_CHARS:
            continue
        result.append({"kinds": kinds, "blockIndex": line["blockIndex"],
                       "lineIndex": line["lineIndex"], "text": text,
                       "bboxMilliPoints": line["bboxMilliPoints"]})
        if len(result) >= max_lines:
            break
    return result


def _page_scope(page: dict[str, Any], manifest_stage: str,
                manifest_section: str) -> dict[str, Any]:
    title = _title_cues(page)
    cue_types = sorted({kind for item in title for kind in item["kinds"]})
    text = "\n".join(line["text"] for line in page["lines"])
    sections = sorted(key for key, pattern in SECTION_CUES.items() if pattern.search(text))
    if manifest_stage == "RD_ID_MIXED":
        stage_status = "MIXED_STAGE_UNRESOLVED"
        if "RD_TITLE" in cue_types and any(kind.startswith("EXECUTION_") for kind in cue_types):
            stage_cue_status = "MIXED_RD_AND_EXECUTION_CUES_REVIEW"
        elif "RD_TITLE" in cue_types:
            stage_cue_status = "RD_TITLE_CUE_WITH_MIXED_MANIFEST"
        elif any(kind.startswith("EXECUTION_") for kind in cue_types):
            stage_cue_status = "EXECUTION_CUE_WITH_MIXED_MANIFEST"
        else:
            stage_cue_status = "NO_PAGE_STAGE_CUE"
    elif manifest_stage == "PD":
        stage_status = "PD_MANIFEST_ONLY"
        stage_cue_status = ("PAGE_STAGE_CUE_CONFLICT_REVIEW" if
                            "RD_TITLE" in cue_types or
                            any(kind.startswith("EXECUTION_") for kind in cue_types) else
                            "PD_TITLE_CUE" if "PD_TITLE" in cue_types else
                            "NO_PAGE_STAGE_CUE")
    else:
        raise EngineeringMixedBatchError("unexpected manifest stage")
    if manifest_section in sections and len(sections) == 1:
        section_status = "MANIFEST_SECTION_WITH_PAGE_CUE_UNVERIFIED"
    elif sections and manifest_section not in sections:
        section_status = "PAGE_SECTION_CUE_CONFLICT_REVIEW"
    elif len(sections) > 1:
        section_status = "PAGE_SECTION_CUES_MIXED_REVIEW"
    else:
        section_status = "MANIFEST_SECTION_ONLY"
    return {"stageStatus": stage_status, "stageCueStatus": stage_cue_status,
            "titleCueTypes": cue_types,
            "titleCueEvidence": title, "sectionStatus": section_status,
            "pageSectionCues": sections,
            "pageStageVerified": False, "pageSectionVerified": False}


def _observations(page: dict[str, Any], code: str,
                  max_per_page: int = 3) -> tuple[list[dict[str, Any]], int]:
    pattern = re.compile(CODE_SPEC[code][2], re.I)
    table_keys = {(item["blockIndex"], item["lineIndex"])
                  for item in page["tableRowCandidates"]}
    ranked: list[tuple[tuple[int, int, int, int], int, dict[str, Any]]] = []
    for order, line in enumerate(page["lines"]):
        text = line["text"].strip()
        if not pattern.search(text):
            continue
        table = (line["blockIndex"], line["lineIndex"]) in table_keys
        if len(text) > MAX_QUOTE_CHARS:
            observation = {"status": "LONG_LINE_SHA_ONLY", "lineSha256": hashlib.sha256(
                text.encode("utf-8")).hexdigest(), "lineChars": len(text),
                "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                "bboxMilliPoints": line["bboxMilliPoints"],
                "indexedTableRowCandidate": table}
        else:
            observation = {"status": "EXACT_INDEXED_TEXT_CANDIDATE", "text": text,
                "lineSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                "bboxMilliPoints": line["bboxMilliPoints"],
                "indexedTableRowCandidate": table}
        rank = (int(len(text) <= MAX_QUOTE_CHARS), int(table),
                int(bool(re.search(r"\d\s*(?:мм|м3|м³|па|квт|вт|л/с)", text, re.I))),
                int(bool(re.search(r"\d", text))))
        ranked.append((rank, order, observation))
    chosen = sorted(sorted(ranked, key=lambda row: (row[0], -row[1]), reverse=True)[:max_per_page],
                    key=lambda row: row[1])
    return [observation for _, _, observation in chosen], len(ranked)


def _query_hits(connection: sqlite3.Connection, source_ids: list[str],
                terms: tuple[str, ...], target_pattern: str) -> tuple[list[tuple[str, int]], int]:
    expression = " OR ".join('"' + term.rstrip("*") + '"' +
                             ("*" if term.endswith("*") else "") for term in terms)
    placeholders = ",".join("?" for _ in source_ids)
    query = ("SELECT f.source_id,f.page_number,f.text FROM page_fts f "
             "JOIN page_fts_map m ON m.fts_rowid=f.rowid "
             "AND m.source_id=f.source_id AND m.page_number=f.page_number "
             "JOIN pages p ON p.source_id=m.source_id AND p.page_number=m.page_number "
             f"WHERE page_fts MATCH ? AND f.source_id IN ({placeholders}) "
             "AND p.disposition='TEXT_LAYER_CANDIDATE' "
             "ORDER BY f.source_id,f.page_number")
    pattern = re.compile(target_pattern, re.I)
    hits = []
    fts_total = 0
    for source_id, page_number, text in connection.execute(query, (expression, *source_ids)):
        fts_total += 1
        if any(pattern.search(line) for line in text.splitlines()):
            hits.append((source_id, page_number))
    return hits, fts_total


def _balanced_hits(hits: list[tuple[str, int]], source_ids: list[str],
                   limit: int) -> list[tuple[str, int]]:
    by_source: dict[str, list[int]] = defaultdict(list)
    for source_id, page_number in hits:
        by_source[source_id].append(page_number)
    result: list[tuple[str, int]] = []
    while len(result) < limit and any(by_source.values()):
        for source_id in source_ids:
            if by_source[source_id]:
                result.append((source_id, by_source[source_id].pop(0)))
                if len(result) == limit:
                    break
    return result


def _ocr_proposals(connection: sqlite3.Connection, source_ids: list[str],
                   mixed_source_ids: set[str], selected: set[tuple[str, int]],
                   limit: int = 24) -> tuple[list[dict[str, Any]], int, int]:
    rows: list[tuple[str, int, str]] = []
    for source_id in source_ids:
        rows.extend((source_id, number, sha) for number, sha in connection.execute(
            "SELECT page_number,artifact_sha256 FROM pages WHERE source_id=? "
            "AND disposition='OCR_REQUIRED' ORDER BY page_number", (source_id,)))
    first_mixed_ocr: set[tuple[str, int]] = set()
    for source_id in mixed_source_ids:
        first_mixed_ocr.update((source_id, page_number) for _, page_number, _ in
                               [row for row in rows if row[0] == source_id][:2])
    scored = []
    for source_id, page_number, page_sha in rows:
        adjacent = any((source_id, page_number + offset) in selected for offset in (-1, 1))
        first_mixed_drawing = (source_id, page_number) in first_mixed_ocr
        if adjacent or first_mixed_drawing:
            reason = ("ADJACENT_TO_TEXT_HIT" if adjacent else
                      "FIRST_MIXED_SOURCE_OCR_PAGE")
            scored.append((0 if adjacent else 1, source_id, page_number, page_sha, reason))
    scored.sort()
    result = [{"sourceFileId": source_id, "pageNumber": page_number,
               "pageArtifactSha256": sha, "reason": reason,
               "status": "OCR_PROPOSAL_ONLY"}
              for _, source_id, page_number, sha, reason in scored[:limit]]
    return result, len(rows), len(scored)


def build_engineering_mixed_batch(manifest_path: Path, index_root: Path,
                                  audit_path: Path, *, max_pages_per_code: int = 48) -> dict[str, Any]:
    if type(max_pages_per_code) is not int or not 1 <= max_pages_per_code <= 100:
        raise EngineeringMixedBatchError("max_pages_per_code must be 1..100")
    manifest_bytes = manifest_path.read_bytes()
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if manifest_sha != PUBLIC_MANIFEST_SHA256:
        raise EngineeringMixedBatchError("public manifest SHA differs from pinned inventory")
    rows = load_public_manifest(manifest_path)
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    _require_pass_audit(audit, manifest_bytes, rows, EXPECTED_PUBLIC_COUNTS)
    selected_rows = _code_scope(rows)
    by_id = {row["file_id"]: row for row in selected_rows}
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise EngineeringMixedBatchError("public index database missing")
    page_cache: dict[tuple[str, int], dict[str, Any]] = {}

    def page_at(source_id: str, number: int) -> dict[str, Any]:
        key = (source_id, number)
        if key not in page_cache:
            indexed = get_indexed_page(index_root, source_id, number)
            source = indexed["source"]
            row = by_id[source_id]
            if (source["source_sha256"] != row["sha256"]
                    or (source["object_id"], source["stage"], source["section"])
                    != (row["object_id"], row["stage"], row["section"])
                    or indexed["page"]["inputSha256"] != row["sha256"]):
                raise EngineeringMixedBatchError("page/source provenance differs from public manifest")
            page_cache[key] = indexed["page"]
        return page_cache[key]

    source_ids = sorted(by_id)
    try:
        with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.execute("BEGIN")
            meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
            if meta != {"schemaVersion": INDEX_SCHEMA_VERSION, "versionHash": _version_hash()}:
                raise EngineeringMixedBatchError("public index version differs from audit")
            for row in selected_rows:
                indexed = connection.execute("SELECT object_id,stage,section,source_sha256,status,observed_pages "
                                             "FROM sources WHERE source_id=?", (row["file_id"],)).fetchone()
                if indexed != (row["object_id"], row["stage"], row["section"],
                               row["sha256"], "COMPLETE", row["pdf_pages"]):
                    raise EngineeringMixedBatchError("selected source/index mismatch")
            code_reports: list[dict[str, Any]] = []
            all_selected: set[tuple[str, int]] = set()
            for code, (section, terms, target_pattern) in CODE_SPEC.items():
                ids = [row["file_id"] for row in selected_rows if row["section"] == section]
                hits, fts_total = _query_hits(connection, ids, terms, target_pattern)
                if len(set(hits)) != len(hits):
                    raise EngineeringMixedBatchError("duplicate FTS page key")
                chosen = _balanced_hits(hits, ids, max_pages_per_code)
                all_selected.update(chosen)
                observations: list[dict[str, Any]] = []
                for source_id, number in chosen:
                    row = by_id[source_id]
                    page = page_at(source_id, number)
                    if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                        raise EngineeringMixedBatchError("FTS hit is not text-layer candidate")
                    quote_rows, quote_count = _observations(page, code)
                    if not quote_rows:
                        raise EngineeringMixedBatchError("FTS hit has no corresponding indexed line")
                    page_record = connection.execute("SELECT artifact_sha256 FROM pages "
                                                     "WHERE source_id=? AND page_number=?",
                                                     (source_id, number)).fetchone()
                    observations.append({
                        "sourceFileId": source_id, "objectId": OBJECT_ID,
                        "manifestStage": row["stage"], "manifestSection": row["section"],
                        "sourceSha256": row["sha256"], "pageNumber": number,
                        "pageArtifactSha256": page_record[0],
                        "parserProvenance": page["parserProvenance"],
                        "qualityDisposition": page["quality"]["disposition"],
                        "pageScope": _page_scope(page, row["stage"], row["section"]),
                        "lineCandidates": quote_rows, "matchedLineCount": quote_count,
                        "omittedLineCount": quote_count - len(quote_rows),
                    })
                stage_counts = {stage: sum(by_id[source_id]["stage"] == stage for source_id, _ in hits)
                                for stage in ("PD", "RD_ID_MIXED")}
                code_reports.append({"parameterCode": code, "section": section,
                    "ftsTerms": list(terms), "ftsTextPageHits": fts_total,
                    "genericExcludedPages": fts_total - len(hits),
                    "matchedTextPages": len(hits),
                    "selectedTextPages": len(chosen), "omittedTextPages": len(hits) - len(chosen),
                    "matchedPagesByManifestStage": stage_counts,
                    "observations": observations, "comparison": {
                        "status": "ABSTAIN", "comparablePairCount": 0,
                        "reasons": (["MIXED_ACTUAL_STAGE_UNRESOLVED"] if stage_counts["RD_ID_MIXED"] else
                                    ["NO_ACTUAL_TEXT_OBSERVATION"]) +
                                   (["NO_PD_TEXT_OBSERVATION"] if not stage_counts["PD"] else []) +
                                   ["ENTITY_LINK_REVISION_AND_COMPOSITE_REQUIREMENTS_UNVERIFIED"],
                    }})
            title_pages: list[dict[str, Any]] = []
            for row in selected_rows:
                if row["stage"] != "RD_ID_MIXED":
                    continue
                for number in range(1, min(3, row["pdf_pages"]) + 1):
                    page = page_at(row["file_id"], number)
                    title_pages.append({"sourceFileId": row["file_id"],
                        "sourceSha256": row["sha256"], "pageNumber": number,
                        "qualityDisposition": page["quality"]["disposition"],
                        "pageScope": _page_scope(page, row["stage"], row["section"]),
                        "pageArtifactSha256": connection.execute(
                            "SELECT artifact_sha256 FROM pages WHERE source_id=? AND page_number=?",
                            (row["file_id"], number)).fetchone()[0]})
            ocr, ocr_total, ocr_eligible = _ocr_proposals(
                connection, source_ids,
                {row["file_id"] for row in selected_rows if row["stage"] == "RD_ID_MIXED"},
                all_selected)
    except sqlite3.DatabaseError as error:
        raise EngineeringMixedBatchError("public index database invalid") from error
    if (manifest_path.read_bytes() != manifest_bytes or audit_path.read_bytes() != audit_bytes):
        raise EngineeringMixedBatchError("manifest or audit changed during batch")
    return {"schemaVersion": "engineering-mixed-public-batch-v1",
            "purpose": "REVIEW_ONLY_ABSTAIN", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": manifest_sha,
            "auditSha256": hashlib.sha256(audit_bytes).hexdigest(),
            "indexVersionHash": _version_hash(), "objectId": OBJECT_ID,
            "sourceFileIds": source_ids,
            "sources": [{"sourceFileId": row["file_id"], "stage": row["stage"],
                         "section": row["section"], "sourceSha256": row["sha256"],
                         "pages": row["pdf_pages"]} for row in selected_rows],
            "maxPagesPerCode": max_pages_per_code, "codes": code_reports,
            "lineSelectionPolicy": "EXACT_QUOTE_THEN_TABLE_THEN_MEASUREMENT_THEN_READING_ORDER_MAX_3_PER_PAGE",
            "mixedSourceTitlePages": title_pages,
            "ocrRequiredPagesInSelectedSources": ocr_total,
            "ocrProposalCandidates": ocr_eligible,
            "ocrProposals": ocr, "ocrProposalSelectionCapped": ocr_eligible > len(ocr),
            "findingCount": None, "parameterCoverage": None,
            "runtimePromotion": False}
