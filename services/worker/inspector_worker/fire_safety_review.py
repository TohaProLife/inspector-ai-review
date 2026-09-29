"""Offline, SHA-pinned lexical review for PPM-102 and PPM-113.

Observations are page and line addresses for a human. They are never typed
facts, matched design/working-document elements, findings, or coverage.
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
from collections import Counter
from pathlib import Path
from typing import Any

SCHEMA = "fire-safety-review-v1"
INDEX_VERSION = "7d7dfa2f3e0279a91095"
MANIFEST_SHA = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
AUDIT_SHA = "69ef56fc23e779dfed25aa60c5615be3ee58f244200c6620c2b1ddaec335f49a"
SOURCE_IDS = ("F0117", "F0193", "F0164", "F0204")
SOURCE_SCOPE = {
    "F0117": ("OBJ-NOVOSLOBODSKAYA", "PD", "OTHER"),
    "F0193": ("OBJ-TYUMENSKAYA-5-GOLD-SEED", "PD", "PB"),
    "F0164": ("OBJ-TYUMENSKAYA-5-GOLD-SEED", "PD", "VK"),
    "F0204": ("OBJ-TYUMENSKAYA-5-GOLD-SEED", "RD_ID_MIXED", "VK"),
}
PATTERNS = {
    "PPM-102": re.compile(r"пожарн\w*\s+отсек\w*|противопожарн\w*\s+стен\w*", re.I),
    "PPM-113": re.compile(r"\bвпв\b|внутренн\w*\s+противопожарн\w*\s+водопровод\w*|внутренн\w*\s+пожаротушен\w*", re.I),
}
DETAIL = {
    "PPM-102": re.compile(r"площад\w*|границ\w*|раздел\w*|стен\w*|преград\w*|непрерыв\w*|про[её]м\w*|перегород\w*", re.I),
    "PPM-113": re.compile(r"расход\w*|л/с|стру\w*|кран\w*|диаметр\w*|кольц\w*|д\s*у\s*\d+|\bDN\s*\d+", re.I),
}
MAX_LEADS_PER_CODE = 80


class FireReviewError(ValueError):
    """Source, audit, or indexed page is inconsistent with pinned public corpus."""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def member_name(info: zipfile.ZipInfo) -> str:
    return info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866")


def classify_line(code: str, text: str, nearby: str, *, table_row: bool) -> tuple[str, int] | None:
    """Classify lexical lead only; nearby text never supplies a missing match."""
    if code not in PATTERNS or not PATTERNS[code].search(text):
        return None
    detail_in_line = bool(DETAIL[code].search(text))
    detail_nearby = bool(DETAIL[code].search(nearby))
    if detail_in_line:
        return ("TABLE_ROW_WITH_DETAIL" if table_row else "TEXT_WITH_DETAIL", 3)
    if detail_nearby:
        return ("NEARBY_DETAIL_UNLINKED", 2)
    return ("TERM_ONLY", 1)


def verify_originals(archive_path: Path, selected: dict[str, dict[str, Any]]) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        matches: dict[str, zipfile.ZipInfo] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = member_name(info)
            for source_id, row in selected.items():
                rel = row["relative_path"]
                if name == rel or name.endswith("/" + rel):
                    if source_id in matches:
                        raise FireReviewError(f"ambiguous original PDF: {source_id}")
                    matches[source_id] = info
        if set(matches) != set(selected):
            raise FireReviewError("original PDF inventory incomplete")
        for source_id, info in matches.items():
            row = selected[source_id]
            if info.file_size != row["size_bytes"]:
                raise FireReviewError(f"original PDF size mismatch: {source_id}")
            digest = hashlib.sha256()
            size = 0
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                    size += len(chunk)
            if size != row["size_bytes"] or digest.hexdigest() != row["sha256"]:
                raise FireReviewError(f"original PDF SHA mismatch: {source_id}")


def read_page(index_root: Path, record: sqlite3.Row, source_sha: str, index_version: str) -> dict[str, Any]:
    path = (index_root / record["artifact_path"]).resolve()
    if not path.is_relative_to(index_root.resolve()) or not path.is_file():
        raise FireReviewError("page artifact missing or unsafe")
    data = path.read_bytes()
    if sha(data) != record["artifact_sha256"]:
        raise FireReviewError("page artifact SHA mismatch")
    try:
        page = json.loads(gzip.decompress(data))
    except (OSError, ValueError) as error:
        raise FireReviewError("page artifact invalid") from error
    if (page.get("indexVersionHash") != index_version or page.get("inputSha256") != source_sha
            or page.get("pageNumber") != record["page_number"]
            or page.get("quality", {}).get("disposition") != record["disposition"]
            or not isinstance(page.get("lines"), list)
            or not isinstance(page.get("tableRowCandidates"), list)
            or not isinstance(page.get("sectionCandidates"), list)):
        raise FireReviewError("page provenance mismatch")
    if (len(page["tableRowCandidates"]) != record["table_candidate_count"]
            or len(page["sectionCandidates"]) != record["section_candidate_count"]):
        raise FireReviewError("page structure count mismatch")
    return page


def evaluate_fire_review(manifest_path: Path, index_root: Path, audit_path: Path,
                         archive_path: Path, *, source_ids: tuple[str, ...] = SOURCE_IDS,
                         pins: dict[str, str] | None = None) -> dict[str, Any]:
    """Scan all selected pages; retain strongest bounded addresses per code."""
    pins = pins or {"manifest": MANIFEST_SHA, "audit": AUDIT_SHA, "index": INDEX_VERSION}
    manifest_bytes, audit_bytes = manifest_path.read_bytes(), audit_path.read_bytes()
    if sha(manifest_bytes) != pins["manifest"] or sha(audit_bytes) != pins["audit"]:
        raise FireReviewError("public manifest/audit SHA mismatch")
    audit = json.loads(audit_bytes)
    if (audit.get("status") != "PASS" or audit.get("manifestSha256") != pins["manifest"]
            or audit.get("indexVersionHash") != pins["index"] or audit.get("findingCount") != 0
            or audit.get("fatalFindingCount") != 0
            or audit.get("actual", {}).get("verifiedPageArtifacts") != 10142):
        raise FireReviewError("public v4 audit gate failed")
    allowed = [json.loads(line) for line in manifest_bytes.splitlines()
               if b'"TRAIN_PUBLIC"' in line and b'"INCLUDE"' in line and b'"PUBLIC_TRAIN"' in line]
    if len(allowed) != 203 or not source_ids or len(set(source_ids)) != len(source_ids) \
            or not set(source_ids).issubset(SOURCE_IDS):
        raise FireReviewError("public source selection invalid")
    by_id = {row["file_id"]: row for row in allowed}
    if len(by_id) != len(allowed) or not set(source_ids).issubset(by_id):
        raise FireReviewError("public manifest source missing or duplicated")
    selected = {source_id: by_id[source_id] for source_id in source_ids}
    for source_id, row in selected.items():
        if (row.get("object_id"), row.get("stage"), row.get("section")) != SOURCE_SCOPE[source_id] \
                or row.get("extension") != ".pdf":
            raise FireReviewError(f"source outside pinned scope: {source_id}")
    verify_originals(archive_path, selected)
    observations: dict[str, list[dict[str, Any]]] = {code: [] for code in PATTERNS}
    counts: dict[str, Counter] = {code: Counter() for code in PATTERNS}
    sources = []
    database = index_root / "index.sqlite3"
    with contextlib.closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": pins["index"]}:
            raise FireReviewError("index version mismatch")
        for source_id, manifest_row in selected.items():
            source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            if source is None or source["status"] != "COMPLETE":
                raise FireReviewError(f"index source incomplete: {source_id}")
            for column, key in (("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                                ("expected_pages", "pdf_pages"), ("object_id", "object_id"),
                                ("stage", "stage"), ("section", "section"),
                                ("relative_path", "relative_path")):
                if source[column] != manifest_row[key]:
                    raise FireReviewError(f"source mismatch: {source_id}/{column}")
            pages = connection.execute("SELECT * FROM pages WHERE source_id=? ORDER BY page_number",
                                       (source_id,)).fetchall()
            if len(pages) != manifest_row["pdf_pages"] or [row["page_number"] for row in pages] != list(range(1, len(pages) + 1)):
                raise FireReviewError(f"page inventory incomplete: {source_id}")
            quality = Counter()
            for record in pages:
                if record["source_sha256"] != manifest_row["sha256"]:
                    raise FireReviewError("page source SHA mismatch")
                page = read_page(index_root, record, manifest_row["sha256"], pins["index"])
                disposition = record["disposition"]
                if disposition not in ("TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"):
                    raise FireReviewError("unknown page disposition")
                quality[disposition] += 1
                if disposition == "OCR_REQUIRED":
                    continue
                table_keys = {(item["blockIndex"], item["lineIndex"], item["text"],
                               tuple(item["bboxMilliPoints"])) for item in page["tableRowCandidates"]}
                lines = page["lines"]
                for position, line in enumerate(lines):
                    text = line.get("text")
                    if not isinstance(text, str):
                        raise FireReviewError("invalid indexed line")
                    table_key = (line.get("blockIndex"), line.get("lineIndex"), text,
                                 tuple(line.get("bboxMilliPoints", [])))
                    nearby = " ".join(lines[i]["text"] for i in range(max(0, position - 2),
                                                                        min(len(lines), position + 3)) if i != position)
                    for code in PATTERNS:
                        classification = classify_line(code, text, nearby, table_row=table_key in table_keys)
                        if classification is None:
                            continue
                        context, rank = classification
                        counts[code]["lineMatches"] += 1
                        counts[code][f"source:{source_id}"] += 1
                        counts[code][f"context:{context}"] += 1
                        observations[code].append({
                            "parameterCode": code, "sourceFileId": source_id,
                            "objectId": manifest_row["object_id"], "manifestStage": manifest_row["stage"],
                            "manifestSection": manifest_row["section"],
                            "sourceSha256": manifest_row["sha256"],
                            "pageNumber": record["page_number"], "pageArtifactSha256": record["artifact_sha256"],
                            "pageDisposition": disposition,
                            "pageQualityReasonCodes": page["quality"].get("reasonCodes", []),
                            "sectionCandidateTexts": [item["text"] for item in page["sectionCandidates"][:8]],
                            "sectionCandidatesTruncated": max(0, len(page["sectionCandidates"]) - 8),
                            "globalLineIndex": position,
                            "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                            "bboxMilliPoints": line["bboxMilliPoints"], "rawText": text,
                            "lineSha256": sha(text.encode("utf-8")), "nearbyText": nearby[:700],
                            "tableRowCandidate": table_key in table_keys, "contextClass": context,
                            "rank": rank, "reviewStatus": "REVIEW_ONLY_ABSTAIN",
                        })
            sources.append({"sourceFileId": source_id, "objectId": manifest_row["object_id"],
                            "manifestStage": manifest_row["stage"], "manifestSection": manifest_row["section"],
                            "sourceSha256": manifest_row["sha256"], "pages": len(pages),
                            "textLayerPages": quality["TEXT_LAYER_CANDIDATE"],
                            "ocrRequiredUnknownPages": quality["OCR_REQUIRED"]})
    by_code = []
    for code, rows in observations.items():
        ranked = sorted(rows, key=lambda item: (-item["rank"], not item["tableRowCandidate"],
                                                       item["sourceFileId"], item["pageNumber"], item["globalLineIndex"]))
        retained = ranked[:MAX_LEADS_PER_CODE]
        by_code.append({"parameterCode": code, "reviewStatus": "REVIEW_ONLY_ABSTAIN",
                        "totalLineMatches": len(rows), "distinctMatchedPages": len({(r["sourceFileId"], r["pageNumber"]) for r in rows}),
                        "contextCounts": {key.removeprefix("context:"): count for key, count in counts[code].items()
                                          if key.startswith("context:")},
                        "sourceMatchCounts": {key.removeprefix("source:"): count for key, count in counts[code].items()
                                             if key.startswith("source:")},
                        "retainedCount": len(retained), "truncatedCount": len(rows) - len(retained),
                        "leads": retained, "comparableFacts": [], "finding": None,
                        "findingCount": None, "parameterCoverage": None})
    return {"schemaVersion": SCHEMA, "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "purpose": "REVIEW_ONLY", "manifestSha256": pins["manifest"], "auditSha256": pins["audit"],
            "indexVersionHash": pins["index"], "originalPdfShaVerified": True,
            "sources": sources, "codes": by_code,
            "proofGaps": ["APPROVED_REVISIONS_UNKNOWN", "PD_RD_ELEMENT_IDENTITY_UNKNOWN",
                          "TEXT_LAYER_MISSES_IMAGE_CONTENT", "TOPOLOGY_AND_NETWORK_NOT_VERIFIED",
                          "OCR_REQUIRED_CONTENT_UNKNOWN"],
            "findingCount": None, "parameterCoverage": None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "index", "audit", "archive", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    report = evaluate_fire_review(args.manifest, args.index, args.audit, args.archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"report": str(args.output), "sourceCount": len(report["sources"]),
                      "codes": {c["parameterCode"]: c["totalLineMatches"] for c in report["codes"]}},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
