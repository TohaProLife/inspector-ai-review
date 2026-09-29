"""Deterministic, audit-gated OCR worklist for public candidate families.

This planner reads no PDF or ground-truth TXT and calls no OCR provider. A row
is a review lead, never a verified document classification or engineering fact.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path
from typing import Any

from .candidate_source_matrix import build_candidate_source_matrix
from .class_family_candidates import load_class_family_labels
from .numeric_family_candidates import load_numeric_family_labels
from .presence_family_candidates import load_presence_family_labels
from .public_document_index import INDEX_SCHEMA_VERSION, _version_hash, load_public_manifest, readonly_index_uri
from .public_section_proposals import EXPECTED_PUBLIC_COUNTS, PUBLIC_MANIFEST_SHA256, _audit_gate


SCHEMA_VERSION = "public-family-ocr-queue-v2"
MAX_PER_FAMILY = 200
MAX_NEIGHBOR_RADIUS = 3
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_TOC = re.compile(r"\b(?:содержани\w*|оглавлени\w*|contents)\b", re.IGNORECASE)
_MARKS = {
    "AR": ("АР", "AR"), "KR": ("КР", "KR"), "KJ": ("КЖ", "KJ"),
    "KM": ("КМ", "KM"), "OV": ("ОВ", "OV"), "VK": ("ВК", "VK"),
    "EOM": ("ЭОМ", "EOM"), "GP": ("ГП", "GP"), "SS": ("СС", "SS"),
    "PZ": ("ПЗ", "PZ"), "SPZU": ("СПОЗУ", "SPZU"),
    "POS": ("ПОС", "POS"), "PPR": ("ППР", "PPR"), "PP": ("ПП", "PP"),
    "ODI": ("ОДИ", "ODI"), "ZU": ("ЗУ", "ZU"), "SM": ("СМ", "SM"),
    "POD": ("ПОД", "POD"), "PPM": ("ППМ", "PPM"),
    "IOS1": ("ИОС1", "IOS1"), "IOS2": ("ИОС2", "IOS2"),
    "IOS3": ("ИОС3", "IOS3"), "NVK": ("НВК", "NVK"),
    "GSV": ("ГСВ", "GSV"),
}
_ROLE_PRIORITY = {
    "EXACT_CATEGORY": 4,
    "UNRESOLVED_SECTION": 3,
    "MIXED_STAGE_CATEGORY": 2,
    "MIXED_STAGE_UNCLASSIFIED": 1,
}
_PLAN_FIELDS = (
    ("exactSourceIds", "EXACT_CATEGORY"),
    ("unresolvedSectionSourceIds", "UNRESOLVED_SECTION"),
    ("mixedStageSourceIds", "MIXED_STAGE_CATEGORY"),
    ("mixedStageUnclassifiedSourceIds", "MIXED_STAGE_UNCLASSIFIED"),
)


class PublicFamilyOcrQueueError(ValueError):
    """Required public index, audit, source matrix, or label policy is invalid."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    content = path.read_bytes()
    if len(content) > 32 * 1024 * 1024:
        raise PublicFamilyOcrQueueError("planning input exceeds 32 MiB")
    value = json.loads(content)
    if not isinstance(value, dict):
        raise PublicFamilyOcrQueueError("planning input must be a JSON object")
    return value, content


def _labels_by_code(matrix: dict[str, Any]) -> tuple[dict[str, tuple[str, ...]], dict[str, str]]:
    numeric = load_numeric_family_labels()
    classes = load_class_family_labels()
    presence = load_presence_family_labels()
    labels: dict[str, tuple[str, ...]] = {}
    for entry in numeric["entries"]:
        labels[entry["parameterCode"]] = tuple(
            label for attribute in entry["attributes"] for label in attribute["labels"]
        )
    for entry in classes["entries"]:
        labels[entry["parameterCode"]] = tuple(entry["labels"])
    for entry in presence["entries"]:
        labels[entry["parameterCode"]] = tuple(
            label for feature in entry["features"] for label in feature["labels"]
        )
    codes = {item["parameterCode"] for item in matrix["codes"]}
    if set(labels) != codes or len(codes) != 47:
        raise PublicFamilyOcrQueueError("label policies do not cover the 47 candidate codes")
    return labels, {
        "numeric": numeric["labelPackSha256"],
        "class": classes["labelPackSha256"],
        "presence": presence["labelPackSha256"],
    }


def _source_plans(matrix: dict[str, Any], manifest: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    public_pdfs = {row["file_id"]: row for row in manifest if row["extension"] == ".pdf"}
    plans: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for code in matrix["codes"]:
        family = code["family"]
        for object_plan in code["objects"]:
            object_id = object_plan["objectId"]
            for role in ("expected", "actual"):
                for field, category in _PLAN_FIELDS:
                    for source_id in object_plan[role][field]:
                        row = public_pdfs.get(source_id)
                        if row is None or row["object_id"] != object_id:
                            raise PublicFamilyOcrQueueError("source matrix references invalid public PDF")
                        source = plans[family].setdefault(source_id, {
                            "codes": {}, "sameObjectExactPair": False,
                        })
                        key = (code["parameterCode"], role.upper())
                        previous = source["codes"].get(key)
                        if previous is not None and previous != category:
                            raise PublicFamilyOcrQueueError("source matrix has conflicting role categories")
                        source["codes"][key] = category
                        source["sameObjectExactPair"] |= object_plan["sameObjectExactSourcePairAvailable"]
    return plans


def _toc_section_cue(text: str, marks: set[str]) -> bool:
    if not _TOC.search(text):
        return False
    return any(re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", text, re.IGNORECASE)
               for mark in marks for alias in _MARKS.get(mark, ()))


def _neighbor_hints(
    row: sqlite3.Row, neighbors: list[sqlite3.Row],
    codes: dict[tuple[str, str], str], labels: dict[str, tuple[str, ...]],
    drawing_marks: dict[tuple[str, str], set[str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    hints: list[dict[str, Any]] = []
    reasons: set[str] = set()
    for neighbor in neighbors:
        page_number = neighbor["page_number"]
        if page_number == row["page_number"] or neighbor["disposition"] != "TEXT_LAYER_CANDIDATE":
            continue
        text = neighbor["text"] or ""
        folded = " ".join(text.casefold().split())
        matched = sorted({code for code, _ in codes
                          if any(" ".join(label.casefold().split()) in folded
                                 for label in labels[code] if len(label.strip()) >= 5)})
        toc = _toc_section_cue(text, set().union(*(drawing_marks[key] for key in codes)))
        if not matched and not toc:
            continue
        hint: dict[str, Any] = {
            "pageNumber": page_number,
            "distance": abs(page_number - row["page_number"]),
            "matchedLabelCodes": matched,
            "tocSectionMark": toc,
        }
        hints.append(hint)
        if matched:
            reasons.add("NEIGHBOR_TEXT_LABEL")
        if toc:
            reasons.add("NEIGHBOR_TOC_SECTION_MARK")
    return sorted(hints, key=lambda item: (item["distance"], item["pageNumber"])), sorted(reasons)


def _check_index(connection: sqlite3.Connection, manifest: list[dict[str, Any]],
                 audit: dict[str, Any]) -> list[sqlite3.Row]:
    meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN "
                                   "('schemaVersion','versionHash','ftsRowidMapVersion')"))
    if meta != {"schemaVersion": INDEX_SCHEMA_VERSION,
                "versionHash": _version_hash(), "ftsRowidMapVersion": "1"}:
        raise PublicFamilyOcrQueueError("index schema, extractor, or FTS map version stale")
    public_pdfs = {row["file_id"]: row for row in manifest if row["extension"] == ".pdf"}
    sources = {row["source_id"]: row for row in connection.execute("SELECT * FROM sources")}
    if set(sources) != {row["file_id"] for row in manifest}:
        raise PublicFamilyOcrQueueError("index source inventory differs from manifest")
    for row in manifest:
        source = sources[row["file_id"]]
        expected_status = "COMPLETE" if row["extension"] == ".pdf" else "SKIPPED_GROUND_TRUTH_TXT"
        if (source["status"] != expected_status or source["source_sha256"] != row["sha256"]
                or source["object_id"] != row["object_id"] or source["stage"] != row["stage"]
                or source["section"] != row["section"]
                or source["expected_pages"] != row.get("pdf_pages")):
            raise PublicFamilyOcrQueueError("index source metadata differs from manifest")
    pages = list(connection.execute(
        "SELECT source_id,page_number,source_sha256,disposition,artifact_sha256 "
        "FROM pages ORDER BY source_id,page_number"
    ))
    expected_pages = sum(row["pdf_pages"] for row in public_pdfs.values())
    if len(pages) != expected_pages or audit["actual"]["indexedPages"] != expected_pages:
        raise PublicFamilyOcrQueueError("index page enumeration incomplete")
    by_source: dict[str, list[sqlite3.Row]] = defaultdict(list)
    dispositions: dict[str, int] = defaultdict(int)
    for page in pages:
        source_id = page["source_id"]
        row = public_pdfs.get(source_id)
        if (row is None or page["source_sha256"] != row["sha256"]
                or page["disposition"] not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
                or not isinstance(page["artifact_sha256"], str)
                or not _SHA.fullmatch(page["artifact_sha256"])):
            raise PublicFamilyOcrQueueError("invalid public index page metadata")
        by_source[source_id].append(page)
        dispositions[page["disposition"]] += 1
    audit_by_source = {item["sourceId"]: item for item in audit["sources"]}
    for source_id, row in public_pdfs.items():
        actual_pages = by_source[source_id]
        if [page["page_number"] for page in actual_pages] != list(range(1, row["pdf_pages"] + 1)):
            raise PublicFamilyOcrQueueError("source pages have a gap or duplicate")
        expected_disposition = audit_by_source[source_id]["dispositions"]
        measured = {kind: sum(page["disposition"] == kind for page in actual_pages)
                    for kind in ("TEXT_LAYER_CANDIDATE", "OCR_REQUIRED")}
        if any(measured[kind] != expected_disposition.get(kind, 0) for kind in measured):
            raise PublicFamilyOcrQueueError("source page dispositions differ from PASS audit")
    if dict(dispositions) != audit["actual"]["dispositions"]:
        raise PublicFamilyOcrQueueError("index dispositions differ from PASS audit")
    expected_fts = expected_pages
    if (connection.execute("SELECT COUNT(*) FROM page_fts_map").fetchone()[0] != expected_fts
            or connection.execute("SELECT COUNT(*) FROM page_fts").fetchone()[0] != expected_fts
            or connection.execute("SELECT COUNT(*) FROM pages p LEFT JOIN page_fts_map m "
                                  "ON m.source_id=p.source_id AND m.page_number=p.page_number "
                                  "WHERE m.fts_rowid IS NULL").fetchone()[0]
            or connection.execute("SELECT COUNT(*) FROM page_fts_map m "
                                  "LEFT JOIN pages p ON p.source_id=m.source_id "
                                  "AND p.page_number=m.page_number WHERE p.source_id IS NULL").fetchone()[0]
            or connection.execute("SELECT COUNT(*) FROM page_fts_map m "
                                  "JOIN page_fts f ON f.rowid=m.fts_rowid "
                                  "WHERE f.source_id!=m.source_id OR f.page_number!=m.page_number").fetchone()[0]):
        raise PublicFamilyOcrQueueError("index FTS rows differ from PASS audit")
    return pages


def _nearby_text(connection: sqlite3.Connection, source_id: str, page_number: int,
                 radius: int, expected_pages: int) -> list[sqlite3.Row]:
    # Lookup by the audited FTS rowid map. page_fts.source_id itself is UNINDEXED.
    lo = max(1, page_number - radius)
    hi = min(expected_pages, page_number + radius)
    return list(connection.execute(
        "SELECT p.page_number,p.disposition,f.text FROM pages p "
        "JOIN page_fts_map m ON m.source_id=p.source_id AND m.page_number=p.page_number "
        "JOIN page_fts f ON f.rowid=m.fts_rowid "
        "WHERE p.source_id=? AND p.page_number BETWEEN ? AND ? ORDER BY p.page_number",
        (source_id, lo, hi),
    ))


def _rank_family(entries: list[dict[str, Any]], max_per_family: int) -> tuple[list[dict[str, Any]], int]:
    ordered = sorted(entries, key=lambda item: (
        -item["priority"], item["sourceFileId"], item["pageNumber"],
    ))
    selected: list[dict[str, Any]] = []
    seen_sources: dict[str, int] = defaultdict(int)
    # Per-source cap spreads a small OCR budget across distinct PDFs. If fewer
    # sources exist, filling the remaining budget is deterministic.
    for cap in (3, max_per_family):
        for item in ordered:
            key = (item["sourceFileId"], item["pageNumber"])
            if len(selected) >= max_per_family:
                break
            if seen_sources[item["sourceFileId"]] >= cap or any(
                    (value["sourceFileId"], value["pageNumber"]) == key for value in selected):
                continue
            selected.append(item)
            seen_sources[item["sourceFileId"]] += 1
    return selected, len(ordered) - len(selected)


def _has_local_family_hint(item: dict[str, Any]) -> bool:
    """Unpinned sources require a nearby literal label before consuming OCR.

    A TOC section mark may rank an eligible page, but does not show that an
    adjacent scanned sheet contains a family fact. The 12-page probe confirmed
    this distinction for the generic AR title-window leaves.
    """
    if any(role["sourceCategory"] == "EXACT_CATEGORY" for role in item["codeRoles"]):
        return True
    return any(hint["matchedLabelCodes"] for hint in item["neighborHints"])


def build_public_family_ocr_queue(
    manifest_path: Path, index_root: Path, audit_path: Path, source_matrix_path: Path,
    *, max_per_family: int = 16, neighbor_radius: int = 2,
    planning_version: int = 2,
) -> dict[str, Any]:
    """Rank OCR_REQUIRED pages per family without invoking OCR or making facts."""
    if (type(max_per_family) is not int or not 1 <= max_per_family <= MAX_PER_FAMILY
            or type(neighbor_radius) is not int
            or not 0 <= neighbor_radius <= MAX_NEIGHBOR_RADIUS
            or type(planning_version) is not int or planning_version not in (1, 2)):
        raise PublicFamilyOcrQueueError("OCR queue bounds invalid")
    manifest_bytes = manifest_path.read_bytes()
    if _sha256(manifest_bytes) != PUBLIC_MANIFEST_SHA256:
        raise PublicFamilyOcrQueueError("public manifest SHA-256 differs from pinned inventory")
    manifest = load_public_manifest(manifest_path)
    audit, audit_bytes = _load_json(audit_path)
    try:
        _audit_gate(audit, manifest_bytes, manifest, EXPECTED_PUBLIC_COUNTS)
    except (ValueError, KeyError, TypeError) as error:
        raise PublicFamilyOcrQueueError("PASS audit is stale, incomplete, or truncated") from error
    matrix, matrix_bytes = _load_json(source_matrix_path)
    recomputed = build_candidate_source_matrix(manifest_path)
    if matrix != recomputed:
        raise PublicFamilyOcrQueueError("source matrix is stale, incomplete, or truncated")
    labels, label_hashes = _labels_by_code(matrix)
    source_plans = _source_plans(matrix, manifest)
    rules = {item["parameterCode"]: item for item in matrix["codes"]}
    from .candidate_family_rules import load_candidate_family_pack
    pack = {item["parameterCode"]: item for item in load_candidate_family_pack()["rules"]}
    if set(pack) != set(rules):
        raise PublicFamilyOcrQueueError("candidate rule pack differs from matrix")
    drawing_marks: dict[tuple[str, str], set[str]] = {}
    for code, rule in pack.items():
        drawing_marks[code, "EXPECTED"] = set(rule["requiredExpectedDrawingSections"])
        drawing_marks[code, "ACTUAL"] = set(rule["requiredActualDrawingSections"])
    public_pdfs = {row["file_id"]: row for row in manifest if row["extension"] == ".pdf"}
    database = index_root / "index.sqlite3"
    if not database.is_file():
        raise PublicFamilyOcrQueueError("public index database missing")
    try:
        with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only=ON")
            connection.execute("BEGIN")
            pages = _check_index(connection, manifest, audit)
            ocr_by_source: dict[str, list[sqlite3.Row]] = defaultdict(list)
            for page in pages:
                if page["disposition"] == "OCR_REQUIRED":
                    ocr_by_source[page["source_id"]].append(page)
            neighbor_cache: dict[tuple[str, int], list[sqlite3.Row]] = {}
            families: list[dict[str, Any]] = []
            for family in sorted({item["family"] for item in matrix["codes"]}):
                candidates: list[dict[str, Any]] = []
                for source_id, plan in sorted(source_plans[family].items()):
                    source = public_pdfs[source_id]
                    assignments = plan["codes"]
                    code_roles = [
                        {"parameterCode": code, "role": role, "sourceCategory": category}
                        for (code, role), category in sorted(assignments.items())
                    ]
                    top_category = max(assignments.values(), key=_ROLE_PRIORITY.__getitem__)
                    for page in ocr_by_source[source_id]:
                        key = (source_id, page["page_number"])
                        if key not in neighbor_cache:
                            neighbor_cache[key] = _nearby_text(
                                connection, source_id, page["page_number"], neighbor_radius,
                                source["pdf_pages"],
                            )
                        hints, hint_reasons = _neighbor_hints(
                            page, neighbor_cache[key], assignments, labels, drawing_marks,
                        )
                        reasons = ["PUBLIC_OCR_REQUIRED", top_category]
                        if plan["sameObjectExactPair"]:
                            reasons.append("SAME_OBJECT_EXACT_SOURCE_PAIR_AVAILABLE")
                        if page["page_number"] <= 3:
                            reasons.append("TITLE_WINDOW")
                        reasons.extend(hint_reasons)
                        nearest_label = min((hint["distance"] for hint in hints
                                             if hint["matchedLabelCodes"]), default=None)
                        priority = (10 * _ROLE_PRIORITY[top_category]
                                    + (5 if plan["sameObjectExactPair"] else 0)
                                    + (6 if page["page_number"] <= 3 else 0)
                                    + (12 - 2 * nearest_label if nearest_label is not None else 0)
                                    + (5 if "NEIGHBOR_TOC_SECTION_MARK" in hint_reasons else 0))
                        candidates.append({
                            "family": family, "sourceFileId": source_id,
                            "objectId": source["object_id"], "manifestStage": source["stage"],
                            "manifestSection": source["section"],
                            "sourceSha256": source["sha256"],
                            "pageNumber": page["page_number"],
                            "pageArtifactSha256": page["artifact_sha256"],
                            "pageDisposition": "OCR_REQUIRED", "codeRoles": code_roles,
                            "priority": priority, "reasons": reasons,
                            "neighborHints": hints,
                            "disposition": "OCR_REVIEW_QUEUE_ONLY_ABSTAIN",
                        })
                eligible = (candidates if planning_version == 1 else
                            [item for item in candidates if _has_local_family_hint(item)])
                deferred = len(candidates) - len(eligible)
                selected, omitted = _rank_family(eligible, max_per_family)
                family_report = {
                    "family": family,
                    "candidateCodeCount": sum(item["family"] == family for item in matrix["codes"]),
                    "ocrCandidatePages": len(candidates), "selectedPages": len(selected),
                    "omittedByPerFamilyCap": omitted,
                    "queue": selected,
                }
                if planning_version == 2:
                    family_report["deferredUnpinnedWithoutLocalHint"] = deferred
                families.append(family_report)
    except sqlite3.DatabaseError as error:
        raise PublicFamilyOcrQueueError("public index database invalid") from error
    deduplicated: dict[tuple[str, int], dict[str, Any]] = {}
    for family_report in families:
        for selected in family_report["queue"]:
            key = (selected["sourceFileId"], selected["pageNumber"])
            previous = deduplicated.get(key)
            if previous is None:
                deduplicated[key] = {
                    "sourceFileId": selected["sourceFileId"],
                    "pageNumber": selected["pageNumber"],
                    "sourceSha256": selected["sourceSha256"],
                    "pageArtifactSha256": selected["pageArtifactSha256"],
                    "families": [family_report["family"]],
                }
            else:
                if (previous["sourceSha256"] != selected["sourceSha256"]
                        or previous["pageArtifactSha256"] != selected["pageArtifactSha256"]):
                    raise PublicFamilyOcrQueueError("shared OCR page has inconsistent source or artifact hash")
                previous["families"].append(family_report["family"])
    unique_pages = [deduplicated[key] for key in sorted(deduplicated)]
    report = {
        "schemaVersion": (SCHEMA_VERSION if planning_version == 2
                          else "public-family-ocr-queue-v1"),
        "disposition": "OCR_REVIEW_QUEUE_ONLY_ABSTAIN",
        "findingCount": None, "parameterCoverage": None,
        "manifestSha256": _sha256(manifest_bytes),
        "auditSha256": _sha256(audit_bytes),
        "sourceMatrixSha256": _sha256(matrix_bytes),
        "candidatePackSha256": matrix["candidatePackSha256"],
        "labelPackSha256": label_hashes,
        "indexVersionHash": _version_hash(),
        "sourceInventory": {"publicSources": 203, "publicPdfSources": 202,
                            "publicPdfPages": 10142, "metadataOnlySourceId": "F0194"},
        "parameters": {"maxPerFamily": max_per_family,
                       "neighborRadius": neighbor_radius},
        "families": families,
        "uniqueSelectedPages": unique_pages,
        "totals": {"ocrRequiredPagesInIndex": audit["actual"]["dispositions"].get("OCR_REQUIRED", 0),
                   "candidateFamilyCount": len(families),
                   "candidateCodeCount": len(matrix["codes"]),
                   "selectedFamilyPagePairs": sum(item["selectedPages"] for item in families),
                   "selectedUniqueOcrPages": len(unique_pages),
                   "selectedPagesSharedAcrossFamilies": sum(
                       len(item["families"]) > 1 for item in unique_pages),
                   "omittedFamilyPagePairsByCap": sum(item["omittedByPerFamilyCap"] for item in families)},
        "inputEnumerationComplete": True,
        "queueCapped": any(item["omittedByPerFamilyCap"] for item in families),
    }
    if planning_version == 2:
        report["selectionPolicy"] = "UNPINNED_SOURCE_REQUIRES_LOCAL_TEXT_LABEL"
        report["totals"]["deferredUnpinnedWithoutLocalHint"] = sum(
            item["deferredUnpinnedWithoutLocalHint"] for item in families)
    return report
