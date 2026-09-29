"""Read-only public-index leads for unresolved IOS, PPM, ODI and ZU codes.

All matches are lexical review leads. The catalog strategy remains design-only;
this module cannot create facts, comparable pairs, findings, or coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .ar_unresolved_batch import (
    AUDIT_SHA256, INDEX_VERSION_HASH, MANIFEST_SHA256, ArUnresolvedBatchError,
    _audit, _checked_page, _load_public_manifest, _read_pinned, _sha,
    _valid_box, _valid_row,
)


STRATEGY_REPORT_SHA256 = "39e321972ecea101af7aa70de7d0a5dc60398119ca0e318748852e220a055055"
CODE_PREFIXES = ("IOS1-", "IOS5-", "PPM-", "ODI-", "ZU-")
FAMILIES = ("IOS1", "IOS5", "PPM", "ODI", "ZU")
_TRIGGERS: dict[str, tuple[str, ...]] = {
    "IOS1-068": (r"(?:вру|грщ).{0,70}уставк", r"уставк.{0,70}(?:вру|грщ)",
                 r"номинал\w*.{0,50}автомат\w*"),
    "IOS1-069": (r"кабел\w*.{0,60}\bсечени\w*", r"\bсечени\w*.{0,60}кабел\w*",
                 r"\bfrls\b", r"кабел\w*.{0,50}\bнг.?ls\b"),
    "IOS1-070": (r"контур\w*.{0,50}заземл\w*", r"заземлител\w*.{0,60}количеств\w*",
                 r"элемент\w*.{0,50}молниезащит\w*"),
    "IOS5-080": (r"извещател\w*.{0,50}\bапс\b", r"\bапс\b.{0,50}извещател\w*",
                 r"пожарн\w*.{0,40}сигнализац\w*.{0,50}извещател\w*"),
    "PPM-102": (r"пожарн\w*.{0,30}отсек\w*", r"противопожарн\w*.{0,40}стен\w*",
                r"площад\w*.{0,40}отсек\w*"),
    "PPM-106": (r"эвакуац\w*.{0,50}двер\w*.{0,50}открыван\w*",
                r"открыван\w*.{0,50}эвакуац\w*.{0,50}двер\w*"),
    "PPM-108": (r"извещател\w*.{0,50}\bапс\b", r"\bапс\b.{0,50}извещател\w*",
                r"датчик\w*.{0,50}пожарн\w*.{0,40}сигнализац\w*"),
    "PPM-109": (r"кабел\w*.{0,50}огнестойк\w*", r"огнестойк\w*.{0,50}кабел\w*",
                r"\bfrls\b"),
    "PPM-110": (r"\bсоуэ\b.{0,50}(?:оповещател\w*|динамик\w*)",
                r"(?:оповещател\w*|динамик\w*).{0,50}\bсоуэ\b",
                r"табло\s+[«\"']?выход"),
    "PPM-111": (r"\bозк\b", r"огнезадерживающ\w*.{0,30}клапан\w*"),
    "PPM-112": (r"вентилятор\w*.{0,50}дымоудален\w*",
                r"вентилятор\w*.{0,50}подпор\w*",
                r"расход\w*.{0,50}\bду\b"),
    "PPM-113": (r"\bвпв\b", r"внутренн\w*.{0,40}пожаротушен\w*"),
    "PPM-114": (r"\bнпв\b", r"наружн\w*.{0,40}пожаротушен\w*",
                r"пожарн\w*.{0,30}гидрант\w*"),
    "ODI-115": (r"инвалидн\w*.{0,50}подъ[её]мник\w*",
                r"подъ[её]мник\w*.{0,50}\bмгн\b"),
    "ODI-116": (r"ширин\w*.{0,40}коридор\w*.{0,50}\bмгн\b",
                r"коридор\w*.{0,40}ширин\w*.{0,50}\bмгн\b",
                r"ширин\w*.{0,30}пут\w*.{0,30}движен\w*.{0,30}\bмгн\b"),
    "ODI-117": (r"ширин\w*.{0,40}двер\w*.{0,50}\bмгн\b",
                r"двер\w*.{0,40}в\s+свету.{0,50}\bмгн\b",
                r"дверн\w*.{0,40}про[её]м\w*.{0,50}\bмгн\b"),
    "ODI-119": (r"санузл\w*.{0,40}\bмгн\b",
                r"универсальн\w*.{0,40}кабин\w*",
                r"санитарн\w*.{0,30}узел\w*.{0,50}инвалид\w*"),
    "ODI-121": (r"парковочн\w*.{0,40}мест\w*.{0,40}\bмгн\b",
                r"мест\w*.{0,40}инвалид\w*.{0,40}парков\w*",
                r"стоянк\w*.{0,40}\bмгн\b"),
    "ZU-125": (r"толщин\w*.{0,50}утеплит\w*",
               r"утеплит\w*.{0,50}толщин\w*",
               r"теплоизоляц\w*.{0,20}стен\w*",
               r"стен\w*.{0,50}теплоизоляц\w*"),
    "ZU-127": (r"сопротивлен\w*.{0,30}теплопередач\w*.{0,60}окон\w*",
               r"окон\w*.{0,50}сопротивлен\w*.{0,30}теплопередач\w*",
               r"теплопередач\w*.{0,50}оконн\w*.{0,30}блок\w*"),
    "ZU-130": (r"светодиодн\w*.{0,40}светильник\w*",
               r"энергосберегающ\w*.{0,40}светильник\w*",
               r"\bled\b.{0,40}светильник\w*",
               r"люминесцентн\w*.{0,40}светильник\w*"),
}
_COMPILED = {code: tuple(re.compile(pattern, re.IGNORECASE) for pattern in patterns)
             for code, patterns in _TRIGGERS.items()}


class UtilityUnresolvedBatchError(ValueError):
    """Pinned public input or indexed source cannot be used safely."""


def _normalized(text: str) -> str:
    return " ".join(text.casefold().split())


def _matches(code: str, text: str) -> list[str]:
    normalized = _normalized(text)
    return [pattern.pattern for pattern in _COMPILED[code] if pattern.search(normalized)]


def _family(code: str) -> str:
    return code.split("-", 1)[0]


def _source_role(source: dict[str, Any], entry: dict[str, Any]) -> str:
    stage, section = source["stage"], source["section"]
    if stage in {"PD", "RD"}:
        tags = entry["sourceAvailability"]["byStage"][stage]["catalogExplicitManifestTags"]
        if section in tags:
            return f"{stage}_EXPLICIT_MANIFEST_TAG_CANDIDATE"
        if section == "OTHER":
            return f"{stage}_SECTION_UNRESOLVED"
        return f"{stage}_NONEXPLICIT_SECTION_TAG"
    if stage == "RD_ID_MIXED":
        return "MIXED_STAGE_UNRESOLVED"
    return "OTHER_STAGE"


def _checked_strategy(report_path: Path, catalog_path: Path, registry_path: Path) -> tuple[bytes, dict[str, Any], list[str]]:
    data = _read_pinned(report_path, STRATEGY_REPORT_SHA256)
    report = json.loads(data)
    if (report.get("schemaVersion") != "unresolved-parameter-strategy-report-v1"
            or report.get("summary", {}).get("unresolvedCodes") != 80
            or report.get("summary", {}).get("verifiedComparablePairs") != 0
            or len(report.get("parameters", [])) != 80):
        raise UtilityUnresolvedBatchError("80-code unresolved strategy report differs")
    inputs = report["inputSha256"]
    catalog_data, registry_data = catalog_path.read_bytes(), registry_path.read_bytes()
    if (_sha(catalog_data) != inputs["catalog"]
            or _sha(registry_data) != inputs["registry"]
            or inputs["manifest"] != MANIFEST_SHA256):
        raise UtilityUnresolvedBatchError("strategy catalog, registry or manifest pin differs")
    codes = [entry["parameterCode"] for entry in report["parameters"]
             if entry["parameterCode"].startswith(CODE_PREFIXES)]
    if (len(codes) != 21 or len(set(codes)) != 21 or set(codes) != set(_TRIGGERS)
            or any(entry["executionStatus"] != "DESIGN_ONLY"
                   or entry["findingOrCoveragePromoted"] is not False
                   or entry["sourceAvailability"]["verifiedComparablePair"] is not False
                   for entry in report["parameters"] if entry["parameterCode"] in codes)):
        raise UtilityUnresolvedBatchError("21 utility codes or design-only gates differ")
    catalog = {row["parameter_code"]: row for line in catalog_data.splitlines()
               if (row := json.loads(line)).get("parameter_code") in codes}
    registry = json.loads(registry_data)
    classifications = {row["parameterCode"]: row["classification"]
                       for row in registry["entries"] if row["parameterCode"] in codes}
    if (set(catalog) != set(codes) or set(classifications) != set(codes)
            or any(classifications[code] != "UNRESOLVED" for code in codes)):
        raise UtilityUnresolvedBatchError("catalog or registry 21-code inventory differs")
    for entry in report["parameters"]:
        code = entry["parameterCode"]
        if code in codes and (entry["parameterName"] != catalog[code]["parameter_name"]
                              or entry["catalogTrigger"] != catalog[code]["trigger"]):
            raise UtilityUnresolvedBatchError("strategy catalog definition differs")
    return data, report, codes


def _lead(source: dict[str, Any], record: sqlite3.Row, line: dict[str, Any],
          role: str, matches: list[str], table: bool) -> dict[str, Any]:
    return {
        "sourceFileId": source["file_id"], "sourceRelativePath": source["relative_path"],
        "sourceSha256": source["sha256"], "objectId": source["object_id"],
        "stage": source["stage"], "manifestSection": source["section"],
        "sourceRole": role, "revisionStatus": "UNVERIFIED",
        "pageNumber": record["page_number"],
        "pageArtifactSha256": record["artifact_sha256"],
        "parserProvenance": record["parser_provenance"],
        "lineAddress": [line["blockIndex"], line["lineIndex"]],
        "bboxMilliPoints": line["bboxMilliPoints"], "text": line["text"],
        "matchKind": "GEOMETRIC_TABLE_ROW" if table else "TEXT_LINE",
        "matchedTriggerPatterns": matches,
        "proofGaps": ["STAGE_AND_SECTION_REVIEW_REQUIRED", "REVISION_AND_APPROVAL_UNVERIFIED",
                      "ELEMENT_IDENTITY_UNVERIFIED", "DEFINITION_AND_UNITS_UNVERIFIED",
                      "PD_RD_COMPARABILITY_UNVERIFIED"],
        "disposition": "ABSTAIN_REVIEW_LEAD",
    }


def build_utility_unresolved_batch(
    manifest_path: Path, index_root: Path, audit_path: Path, strategy_report_path: Path,
    catalog_path: Path, registry_path: Path, *,
    max_leads_per_code: int = 500, max_ocr_per_family: int = 20,
) -> dict[str, Any]:
    if not 1 <= max_leads_per_code <= 1000 or not 0 <= max_ocr_per_family <= 40:
        raise UtilityUnresolvedBatchError("batch caps invalid")
    manifest_data = _read_pinned(manifest_path, MANIFEST_SHA256)
    audit_data = _read_pinned(audit_path, AUDIT_SHA256)
    manifest = _load_public_manifest(manifest_data)
    _audit(json.loads(audit_data), MANIFEST_SHA256)
    strategy_data, strategy, codes = _checked_strategy(strategy_report_path, catalog_path, registry_path)
    entries = {item["parameterCode"]: item for item in strategy["parameters"] if item["parameterCode"] in codes}
    source_by_id = {row["file_id"]: row for row in manifest}
    database = index_root / "index.sqlite3"
    uri = f"file:{database.resolve().as_posix()}?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": INDEX_VERSION_HASH}:
            raise UtilityUnresolvedBatchError("public index schema/version differs")
        sources = list(connection.execute("SELECT * FROM sources ORDER BY source_id"))
        if len(sources) != 203:
            raise UtilityUnresolvedBatchError("source inventory differs")
        for record in sources:
            source = source_by_id.get(record["source_id"])
            if source is None or any(record[column] != source[field] for column, field in (
                ("object_id", "object_id"), ("stage", "stage"), ("section", "section"),
                ("relative_path", "relative_path"), ("source_sha256", "sha256"),
                ("byte_size", "size_bytes"))):
                raise UtilityUnresolvedBatchError("indexed source differs from public manifest")
        pages = list(connection.execute("SELECT * FROM pages ORDER BY source_id,page_number"))
        if len(pages) != 10142:
            raise UtilityUnresolvedBatchError("page inventory differs")
        counts = {code: Counter() for code in codes}
        leads: dict[str, list[dict[str, Any]]] = {code: [] for code in codes}
        hit_pages: dict[str, set[tuple[str, int]]] = {code: set() for code in codes}
        inventory = Counter()
        ocr_pages: list[sqlite3.Row] = []
        invalid_lines = 0
        invalid_rows = 0
        for record in pages:
            source = source_by_id[record["source_id"]]
            if source["extension"] != ".pdf" or record["source_sha256"] != source["sha256"]:
                raise UtilityUnresolvedBatchError("page source outside public inventory")
            quality = record["disposition"]
            if quality not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}:
                raise UtilityUnresolvedBatchError("page quality unknown")
            inventory[quality] += 1
            if quality == "OCR_REQUIRED":
                ocr_pages.append(record)
            page = _checked_page(index_root, record, source)
            if quality != "TEXT_LAYER_CANDIDATE":
                continue
            width, height = page["widthMilliPoints"], page["heightMilliPoints"]
            addressed = {}
            for line in page["lines"]:
                key = (line.get("blockIndex"), line.get("lineIndex"))
                if key in addressed:
                    raise UtilityUnresolvedBatchError("duplicate indexed line address")
                if not _valid_box(line.get("bboxMilliPoints"), width, height):
                    invalid_lines += 1
                    continue
                addressed[key] = line
            table_rows = set()
            for row in page["tableRowCandidates"]:
                if _valid_row(row, page, addressed):
                    table_rows.add((row["blockIndex"], row["lineIndex"]))
                else:
                    invalid_rows += 1
            for address, line in addressed.items():
                for code in codes:
                    matched = _matches(code, line["text"])
                    if not matched:
                        continue
                    role = _source_role(source, entries[code])
                    counts[code]["matchedLines"] += 1
                    counts[code]["GEOMETRIC_TABLE_ROW" if address in table_rows else "TEXT_LINE"] += 1
                    counts[code][role] += 1
                    hit_pages[code].add((source["file_id"], record["page_number"]))
                    if len(leads[code]) < max_leads_per_code:
                        leads[code].append(_lead(source, record, line, role, matched,
                                                 address in table_rows))
        if inventory != {"TEXT_LAYER_CANDIDATE": 8668, "OCR_REQUIRED": 1474}:
            raise UtilityUnresolvedBatchError("public index quality totals differ")
    except (ArUnresolvedBatchError, sqlite3.DatabaseError) as error:
        raise UtilityUnresolvedBatchError("indexed artifact or database failed integrity check") from error
    finally:
        if "connection" in locals():
            connection.close()

    code_reports = []
    for code in codes:
        entry = entries[code]
        code_reports.append({
            "parameterCode": code, "family": _family(code),
            "parameterName": entry["parameterName"],
            "catalogTrigger": entry["catalogTrigger"],
            "candidateExtractorFamily": entry["candidateExtractorFamily"],
            "catalogSourceRequirements": entry["catalogSourceRequirements"],
            "strategySourceAvailability": entry["sourceAvailability"],
            "triggerPatterns": list(_TRIGGERS[code]),
            "scanCounts": dict(sorted(counts[code].items())),
            "matchedPageCount": len(hit_pages[code]),
            "leadDisplayCount": len(leads[code]),
            "leadsTruncated": counts[code]["matchedLines"] > len(leads[code]),
            "leads": leads[code],
            "proofGaps": ["NO_VERIFIED_SAME_OBJECT_PD_RD_PAIR", "STAGE_SECTION_REVISION_REVIEW",
                          "ELEMENT_OR_NETWORK_IDENTITY", "DEFINITION_AND_UNITS",
                          "GEOMETRY_OR_APPROVAL_AS_REQUIRED_BY_CATALOG"],
            "disposition": "ABSTAIN",
        })
    family_queue: dict[str, list[tuple[int, int, str, int, dict[str, Any]]]] = {family: [] for family in FAMILIES}
    for record in ocr_pages:
        source = source_by_id[record["source_id"]]
        for code in codes:
            role = _source_role(source, entries[code])
            adjacent = sum((source["file_id"], neighbor) in hit_pages[code]
                           for neighbor in range(max(1, record["page_number"] - 2),
                                                 record["page_number"] + 3))
            if not adjacent and role != "PD_EXPLICIT_MANIFEST_TAG_CANDIDATE":
                continue
            priority = 0 if role == "PD_EXPLICIT_MANIFEST_TAG_CANDIDATE" else 1
            family_queue[_family(code)].append((priority, -adjacent, source["file_id"], record["page_number"], {
                "parameterCode": code, "sourceFileId": source["file_id"],
                "sourceRelativePath": source["relative_path"], "sourceSha256": source["sha256"],
                "objectId": source["object_id"], "stage": source["stage"],
                "manifestSection": source["section"], "sourceRole": role,
                "revisionStatus": "UNVERIFIED", "pageNumber": record["page_number"],
                "pageArtifactSha256": record["artifact_sha256"],
                "adjacentCodeLeadCount": adjacent,
                "reason": "OCR_REQUIRED; exact PD tag candidate or nearby code-specific text lead",
                "disposition": "PLAN_ONLY_UNKNOWN",
            }))
    ocr_report = {}
    for family, queue in family_queue.items():
        queue.sort(key=lambda item: item[:4])
        selected = []
        seen = set()
        for item in queue:
            key = (item[2], item[3])
            if key not in seen:
                seen.add(key)
                if len(selected) < max_ocr_per_family:
                    selected.append(item[4])
        ocr_report[family] = {"eligibleUniquePages": len(seen), "displayCount": len(selected),
                              "queueTruncated": len(seen) > len(selected), "pages": selected}
    return {
        "schemaVersion": "utility-unresolved-public-batch-v1", "status": "REVIEW_ONLY_ABSTAIN",
        "manifestSha256": MANIFEST_SHA256, "auditSha256": AUDIT_SHA256,
        "indexVersionHash": INDEX_VERSION_HASH,
        "strategyReportSha256": _sha(strategy_data),
        "catalogSha256": strategy["inputSha256"]["catalog"],
        "registrySha256": strategy["inputSha256"]["registry"],
        "inventory": {"sources": 203, "pdfSources": 202, "pdfPages": 10142,
                      "textPages": inventory["TEXT_LAYER_CANDIDATE"],
                      "ocrRequiredPages": inventory["OCR_REQUIRED"],
                      "geometricallyInvalidLinesSkipped": invalid_lines,
                      "geometricallyInvalidTableRows": invalid_rows},
        "codeCount": len(codes), "codes": code_reports,
        "targetedOcrQueue": {"executionPolicy": "PLAN_ONLY", "perFamilyCap": max_ocr_per_family,
                             "families": ocr_report},
        "findingCount": None, "parameterCoverage": None,
    }
