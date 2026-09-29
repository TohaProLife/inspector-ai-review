"""Review-only readiness of 47 candidate codes against pinned public evidence.

This is a report composer, never a rule evaluator. A missing or stale probe is
not converted to a zero match, and an OCR-required page is not a code match.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Mapping

from .candidate_family_rules import load_candidate_family_pack
from .candidate_source_matrix import build_candidate_source_matrix
from .class_family_candidates import load_class_family_labels
from .numeric_family_candidates import NUMERIC_FAMILIES, load_numeric_family_labels
from .presence_family_candidates import load_presence_family_labels
from .public_document_index import load_public_manifest


_PROBE_GROUPS = ("numeric", "class", "presence")
_VERSION = re.compile(r"[a-f0-9]{20}\Z")
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")


class PublicFamilyReadinessError(ValueError):
    """A public inventory or supplied evidence report failed closed."""


def _read_json(path: Path, *, max_bytes: int = 32 * 1024 * 1024) -> tuple[dict[str, Any], str]:
    content = path.read_bytes()
    if len(content) > max_bytes:
        raise PublicFamilyReadinessError(f"report exceeds bounded size: {path.name}")
    try:
        value = json.loads(content)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PublicFamilyReadinessError(f"report JSON invalid: {path.name}") from error
    if not isinstance(value, dict):
        raise PublicFamilyReadinessError(f"report must be an object: {path.name}")
    return value, hashlib.sha256(content).hexdigest()


def _count(value: Any, name: str) -> int:
    if type(value) is not int or value < 0:
        raise PublicFamilyReadinessError(f"invalid nonnegative count: {name}")
    return value


def _canonical_sha(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_gate(rule: Mapping[str, Any], row: Mapping[str, Any]) -> str:
    """Metadata-only gate; no title or drawing section is inferred from text."""
    if row["stage"] == rule["expectedStage"]:
        side = "Expected"
    elif row["stage"] in rule["allowedActualStages"]:
        side = "Actual"
    else:
        return "STAGE_OUTSIDE_RULE"
    if rule["manifestSectionStatus"][side.lower()] != "EXACT_CATEGORY":
        return "DRAWING_SECTION_RESOLUTION_REQUIRED"
    if row["section"] not in rule[f"required{side}Sections"]:
        return "MANIFEST_SECTION_OUTSIDE_RULE"
    if row["section"] not in rule[f"required{side}DrawingSections"]:
        return "DRAWING_MARK_PROOF_REQUIRED"
    return "MANIFEST_CATEGORY_MATCH_REVIEW_ONLY"


def _validate_audit(audit: Mapping[str, Any], rows: list[dict[str, Any]],
                    manifest_sha: str) -> None:
    """Check complete public receipt without requiring PDF parser installation."""
    source_rows = {row["file_id"]: row for row in rows}
    if (audit.get("schemaVersion") != "public-document-index-audit-v1"
            or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != manifest_sha
            or not isinstance(audit.get("indexVersionHash"), str)
            or _VERSION.fullmatch(audit["indexVersionHash"]) is None
            or audit.get("findingCount") != 0
            or audit.get("fatalFindingCount") != 0
            or audit.get("findings") != []
            or audit.get("findingsTruncated") != 0
            or audit.get("expected") != {"sourceCount": 203, "pdfSources": 202,
                                         "pdfPages": 10_142, "txtInventorySources": 1}):
        raise PublicFamilyReadinessError("exact 203-source PASS audit required")
    actual = audit.get("actual")
    if not isinstance(actual, dict) or any(
            type(actual.get(key)) is not int or actual[key] != value
            for key, value in (("sourceCount", 203), ("completePdfSources", 202),
                               ("indexedPages", 10_142), ("verifiedPageArtifacts", 10_142),
                               ("ftsRows", 10_142), ("ftsMapRows", 10_142),
                               ("txtInventorySources", 1))):
        raise PublicFamilyReadinessError("PASS audit inventory or page checks incomplete")
    dispositions = actual.get("dispositions")
    if (not isinstance(dispositions, dict)
            or set(dispositions) - {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
            or any(type(value) is not int or value < 0 for value in dispositions.values())
            or sum(dispositions.values()) != 10_142):
        raise PublicFamilyReadinessError("PASS audit reading quality invalid")
    reports = audit.get("sources")
    if not isinstance(reports, list) or len(reports) != 203:
        raise PublicFamilyReadinessError("PASS audit source list incomplete")
    seen: set[str] = set()
    sum_pages = 0
    sum_ocr = 0
    for item in reports:
        if not isinstance(item, dict):
            raise PublicFamilyReadinessError("PASS audit source row invalid")
        source_id = item.get("sourceId")
        row = source_rows.get(source_id)
        if row is None or source_id in seen:
            raise PublicFamilyReadinessError("PASS audit source outside public inventory")
        seen.add(source_id)
        pages = row.get("pdf_pages") or 0
        status = "SKIPPED_GROUND_TRUTH_TXT" if source_id == "F0194" else "COMPLETE"
        source_dispositions = item.get("dispositions")
        if (item.get("status") != status or item.get("stage") != row["stage"]
                or item.get("section") != row["section"]
                or item.get("objectId") != row["object_id"]
                or item.get("expectedPages") != pages
                or item.get("indexedPages") != pages
                or item.get("issueCount") != 0
                or not isinstance(source_dispositions, dict)
                or set(source_dispositions) - {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
                or any(type(value) is not int or value < 0
                       for value in source_dispositions.values())
                or sum(source_dispositions.values()) != pages):
            raise PublicFamilyReadinessError("PASS audit source metadata or pages differ")
        sum_pages += pages
        sum_ocr += source_dispositions.get("OCR_REQUIRED", 0)
    if (seen != set(source_rows) or sum_pages != 10_142
            or sum_ocr != dispositions.get("OCR_REQUIRED", 0)):
        raise PublicFamilyReadinessError("PASS audit source totals differ")


def _report_inventory(report: Mapping[str, Any], audit: Mapping[str, Any]) -> None:
    inventory = report.get("inventory")
    if not isinstance(inventory, dict):
        raise PublicFamilyReadinessError("probe inventory missing")
    expected = (audit["expected"]["sourceCount"], audit["expected"]["pdfSources"],
                audit["expected"]["pdfPages"], audit["expected"]["txtInventorySources"])
    actual = tuple(inventory.get(key) for key in
                   ("sourceCount", "pdfSources", "pdfPages", "txtInventorySources"))
    if actual != expected or any(type(item) is not int for item in actual):
        raise PublicFamilyReadinessError("probe inventory differs from PASS audit")
    if "ocrRequiredPages" in inventory and inventory["ocrRequiredPages"] != (
            audit["actual"]["dispositions"].get("OCR_REQUIRED", 0)):
        raise PublicFamilyReadinessError("probe OCR count differs from PASS audit")
    if "textCandidatePages" in inventory and inventory["textCandidatePages"] != (
            audit["actual"]["dispositions"].get("TEXT_LAYER_CANDIDATE", 0)):
        raise PublicFamilyReadinessError("probe text count differs from PASS audit")


def _probe_sources(report: Mapping[str, Any], rows: list[dict[str, Any]],
                   audit: Mapping[str, Any], *, kind: str) -> None:
    source_rows = report.get("sources")
    pdfs = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    audit_sources = {item["sourceId"]: item for item in audit["sources"]}
    if not isinstance(source_rows, list) or len(source_rows) != len(pdfs):
        raise PublicFamilyReadinessError("full probe source list missing")
    seen: set[str] = set()
    for item in source_rows:
        if not isinstance(item, dict):
            raise PublicFamilyReadinessError("probe source row invalid")
        source_id = item.get("sourceFileId")
        row = pdfs.get(source_id)
        if row is None or source_id in seen:
            raise PublicFamilyReadinessError("probe source outside public PDFs or duplicate")
        seen.add(source_id)
        receipt = audit_sources[source_id]
        page_total = item.get("sourceTotalPages" if kind == "numeric" else "expectedPages")
        if (item.get("stage") != row["stage"]
                or item.get("manifestSection") != row["section"]
                or item.get("objectId") != row["object_id"]
                or page_total != row["pdf_pages"]
                or item.get("verifiedPages") != row["pdf_pages"]
                or (kind == "numeric" and item.get("selectedPages") != row["pdf_pages"])
                or item.get("ocrRequiredPages") != receipt["dispositions"].get("OCR_REQUIRED", 0)
                or item.get("textCandidatePages") != receipt["dispositions"].get(
                    "TEXT_LAYER_CANDIDATE", 0)):
            raise PublicFamilyReadinessError("probe source differs from manifest/audit")
    if seen != set(pdfs):
        raise PublicFamilyReadinessError("probe omitted public PDF")


def _ocr_queue(queue: Any, rows: list[dict[str, Any]],
               audit: Mapping[str, Any], *, require_quality: bool) -> None:
    """A reported OCR address must stay within the permitted PDF inventory."""
    count = audit["actual"]["dispositions"].get("OCR_REQUIRED", 0)
    if not isinstance(queue, list) or len(queue) != count:
        raise PublicFamilyReadinessError("OCR queue missing or truncated")
    pdfs = {row["file_id"]: row for row in rows if row["extension"] == ".pdf"}
    audit_sources = {item["sourceId"]: item for item in audit["sources"]}
    seen: set[tuple[str, int]] = set()
    by_source: dict[str, int] = defaultdict(int)
    for entry in queue:
        if not isinstance(entry, dict):
            raise PublicFamilyReadinessError("OCR queue entry invalid")
        source_id, page = entry.get("sourceFileId"), entry.get("pageNumber")
        row = pdfs.get(source_id)
        address = (source_id, page)
        artifact = entry.get("pageArtifactSha256")
        if (row is None or type(page) is not int or not 1 <= page <= row["pdf_pages"]
                or address in seen or entry.get("sourceSha256") != row["sha256"]
                or not isinstance(artifact, str) or _SHA256.fullmatch(artifact) is None):
            raise PublicFamilyReadinessError("OCR queue address or source SHA invalid")
        if require_quality and (
                not isinstance(entry.get("quality"), dict)
                or entry["quality"].get("disposition") != "OCR_REQUIRED"
                or entry.get("status") != "TARGETED_OCR_REQUIRED"
                or entry.get("parserProvenance") not in {"PDFMINER", "PYMUPDF"}):
            raise PublicFamilyReadinessError("OCR queue quality/status invalid")
        seen.add(address)
        by_source[source_id] += 1
    if any(by_source[source_id] != audit_sources[source_id]["dispositions"].get(
            "OCR_REQUIRED", 0) for source_id in pdfs):
        raise PublicFamilyReadinessError("OCR queue differs from source audit counts")


def _validate_probe(
    kind: str, path: Path, *, manifest_sha: str, audit_sha: str,
    audit: Mapping[str, Any], rows: list[dict[str, Any]],
    pack: Mapping[str, Any], label_sha: str,
) -> tuple[dict[str, Any], str]:
    report, digest = _read_json(path)
    schema = {"numeric": {"numeric-label-probe-v1"},
              "class": {"class-label-probe-v1", "class-label-probe-v2"},
              "presence": {"presence-public-corpus-probe-v1"}}[kind]
    if (report.get("schemaVersion") not in schema
            or report.get("manifestSha256") != manifest_sha
            or report.get("indexVersionHash") != audit["indexVersionHash"]
            or report.get("labelPackSha256") != label_sha
            or report.get("findingCount") is not None
            or report.get("parameterCoverage") is not None
            or report.get("scope") != "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY"):
        raise PublicFamilyReadinessError(f"{kind} probe schema, hash, scope or policy mismatch")
    audit_key = "auditSha256" if kind == "presence" else "auditReportSha256"
    if report.get(audit_key) != audit_sha:
        raise PublicFamilyReadinessError(f"{kind} probe differs from PASS audit receipt")
    _report_inventory(report, audit)
    if kind == "presence":
        if (report.get("rulePackSha256") != pack["packSha256"]
                or report.get("purpose") != "REVIEW_ONLY"
                or report.get("scanStatus") != "FTS_HITS_SCANNED"
                or report.get("searchCompleteness") != "NOT_ESTABLISHED"
                or report.get("absenceInference") != "PROHIBITED"
                or report.get("enumerationCompleteness") != "NOT_ESTABLISHED"
                or report.get("selectedHitPages") != report.get("ftsHitPages")
                or report.get("evidenceErrorPages") != 0
                or report.get("truncated") != {"hitPages": False, "ocrQueue": False}
                or report.get("ocrRequiredPages") != audit["actual"]["dispositions"].get(
                    "OCR_REQUIRED", 0)
                or not isinstance(report.get("ocrQueue"), list)):
            raise PublicFamilyReadinessError("presence probe is partial, truncated, or drifted")
        _ocr_queue(report["ocrQueue"], rows, audit, require_quality=True)
        code_stats = report.get("codeReports")
    else:
        if (report.get("status") != "COMPLETE"
                or report.get("purpose") != "LITERAL_LABEL_CENSUS_ONLY"
                or report.get("disposition") != "REVIEW_ONLY"):
            raise PublicFamilyReadinessError(f"{kind} probe is partial or targeted")
        if kind == "numeric" and (
                report.get("selectedPages") is not None
                or report["inventory"].get("scannedPages") != 10_142
                or report["inventory"].get("scannedPdfSources") != 202):
            raise PublicFamilyReadinessError("numeric probe must be full corpus")
        _probe_sources(report, rows, audit, kind=kind)
        if kind == "class" and report.get("ocrQueueTruncated") != 0:
            raise PublicFamilyReadinessError("class OCR queue truncated")
        if kind == "class":
            _ocr_queue(report.get("ocrQueue"), rows, audit, require_quality=False)
        code_stats = report.get("codes")
    if not isinstance(code_stats, dict):
        raise PublicFamilyReadinessError(f"{kind} code statistics missing")
    expected_codes = {
        rule["parameterCode"] for rule in pack["rules"]
        if (rule["family"] in NUMERIC_FAMILIES if kind == "numeric" else
            rule["family"] == ("CLASS_DECREASE" if kind == "class" else "PRESENCE_SET"))
    }
    if set(code_stats) != expected_codes:
        raise PublicFamilyReadinessError(f"{kind} code set differs from 47-rule pack")
    for code, stat in code_stats.items():
        if not isinstance(stat, dict):
            raise PublicFamilyReadinessError(f"{kind} code statistics invalid: {code}")
        keys = (("labelHitLines", "candidateMentions") if kind == "presence" else
                ("exactLineMatches", "matchedPages", "nonExactNumericLines") if kind == "numeric" else
                ("exactLineMatches", "matchedPages", "nearMissLines", "nearMissPages"))
        for key in keys:
            _count(stat.get(key), f"{kind}:{code}:{key}")
        if kind != "presence" and stat["matchedPages"] > stat["exactLineMatches"]:
            raise PublicFamilyReadinessError(f"probe match pages exceed lines: {code}")
        if kind == "class" and stat["nearMissPages"] > stat["nearMissLines"]:
            raise PublicFamilyReadinessError(f"class near-miss pages exceed lines: {code}")
        if kind == "presence":
            near = stat.get("nearMissCounts")
            if not isinstance(near, dict) or any(
                    not isinstance(key, str) or not key or type(value) is not int or value < 0
                    for key, value in near.items()):
                raise PublicFamilyReadinessError(f"presence near misses invalid: {code}")
            if stat["candidateMentions"] + sum(near.values()) > stat["labelHitLines"]:
                raise PublicFamilyReadinessError(f"presence counts inconsistent: {code}")
        else:
            rule = next(item for item in pack["rules"] if item["parameterCode"] == code)
            if stat.get("family") != rule["family"]:
                raise PublicFamilyReadinessError(f"probe family mismatch: {code}")
            sources = stat.get("sources")
            if not isinstance(sources, dict) or any(
                    source_id not in {row["file_id"] for row in rows if row["extension"] == ".pdf"}
                    or not isinstance(source, dict)
                    for source_id, source in sources.items()):
                raise PublicFamilyReadinessError(f"probe code source outside public PDFs: {code}")
            for key in ("exactLineMatches", "nonExactNumericLines" if kind == "numeric"
                        else "nearMissLines"):
                if sum(_count(source.get(key), f"{code}:{source_id}:{key}")
                       for source_id, source in sources.items()) != stat[key]:
                    raise PublicFamilyReadinessError(f"probe code/source counts differ: {code}")
    if kind != "presence":
        totals = report.get("totals")
        if not isinstance(totals, dict):
            raise PublicFamilyReadinessError("probe totals absent")
        for key in ("exactLineMatches", "matchedCodePages",
                    "nonExactNumericLines" if kind == "numeric" else "nearMissLines"):
            stat_key = "matchedPages" if key == "matchedCodePages" else key
            if totals.get(key) != sum(item[stat_key] for item in code_stats.values()):
                raise PublicFamilyReadinessError(f"probe total differs from codes: {key}")
    return report, digest


def build_public_family_readiness(
    manifest_path: Path, audit_path: Path, *,
    matrix_path: Path | None = None,
    numeric_probe_path: Path | None = None,
    class_probe_path: Path | None = None,
    presence_probe_path: Path | None = None,
    numeric_label_pack_path: Path | None = None,
) -> dict[str, Any]:
    """Compose 47 honest candidate rows without reading original PDFs again."""
    manifest_bytes = manifest_path.read_bytes()
    rows = load_public_manifest(manifest_path)
    audit, audit_sha = _read_json(audit_path)
    _validate_audit(audit, rows, hashlib.sha256(manifest_bytes).hexdigest())
    if manifest_path.read_bytes() != manifest_bytes:
        raise PublicFamilyReadinessError("public manifest changed during report")
    matrix = build_candidate_source_matrix(manifest_path)
    matrix_file_sha = None
    if matrix_path is not None:
        provided, matrix_file_sha = _read_json(matrix_path)
        if provided != matrix:
            raise PublicFamilyReadinessError("source matrix differs from current pinned inventory")
    pack = load_candidate_family_pack()
    if matrix["candidatePackSha256"] != pack["packSha256"]:
        raise PublicFamilyReadinessError("source matrix candidate pack drift")
    label_shas = {
        "numeric": load_numeric_family_labels(numeric_label_pack_path)["labelPackSha256"]
        if numeric_label_pack_path is not None else load_numeric_family_labels()["labelPackSha256"],
        "class": load_class_family_labels()["labelPackSha256"],
        "presence": load_presence_family_labels()["labelPackSha256"],
    }
    paths = {"numeric": numeric_probe_path, "class": class_probe_path,
             "presence": presence_probe_path}
    probes: dict[str, dict[str, Any] | None] = {}
    provenance: dict[str, dict[str, Any]] = {}
    for kind in _PROBE_GROUPS:
        path = paths[kind]
        if path is None:
            probes[kind] = None
            provenance[kind] = {"status": "NOT_SUPPLIED", "reportSha256": None,
                                "labelPackSha256": label_shas[kind]}
            continue
        report, digest = _validate_probe(
            kind, path, manifest_sha=matrix["manifestSha256"], audit_sha=audit_sha,
            audit=audit, rows=rows, pack=pack, label_sha=label_shas[kind])
        probes[kind] = report
        provenance[kind] = {"status": "VALIDATED", "reportSha256": digest,
                            "labelPackSha256": label_shas[kind]}
    matrix_codes = {item["parameterCode"]: item for item in matrix["codes"]}
    audit_sources = {item["sourceId"]: item for item in audit["sources"]}
    manifest_sources = {item["file_id"]: item for item in rows}
    code_rows = []
    family_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rule in pack["rules"]:
        code = rule["parameterCode"]
        group = ("numeric" if rule["family"] in NUMERIC_FAMILIES else
                 "class" if rule["family"] == "CLASS_DECREASE" else "presence")
        source = matrix_codes[code]
        potential_ids: set[str] = set()
        exact_pair_objects = []
        for obj in source["objects"]:
            if obj["sameObjectExactSourcePairAvailable"]:
                exact_pair_objects.append(obj["objectId"])
            for role in ("expected", "actual"):
                for key in ("exactSourceIds", "unresolvedSectionSourceIds",
                            "mixedStageSourceIds", "mixedStageUnclassifiedSourceIds"):
                    potential_ids.update(obj[role][key])
        potential_ocr = sum(audit_sources[source_id]["dispositions"].get("OCR_REQUIRED", 0)
                            for source_id in potential_ids)
        probe = probes[group]
        stat = (probe["codeReports" if group == "presence" else "codes"][code]
                if probe is not None else None)
        exact_gate_counts: dict[str, int] | None = None
        if stat is not None and group != "presence":
            gate_counts: dict[str, int] = defaultdict(int)
            for source_id, item in stat["sources"].items():
                gate_counts[_source_gate(rule, manifest_sources[source_id])] += item[
                    "exactLineMatches"]
            exact_gate_counts = dict(sorted((key, value) for key, value in gate_counts.items()
                                            if value))
        evidence = ({"status": "NOT_PROBED_CURRENT_POLICY", "exactLabelLines": None,
                     "nearMissLines": None, "presenceCandidateMentions": None,
                     "exactLabelSourceGateCounts": None}
                    if stat is None else {
                        "status": "LEXICAL_LEADS_ONLY",
                        "exactLabelLines": (stat["exactLineMatches"] if group != "presence" else None),
                        "nearMissLines": (stat["nonExactNumericLines"] if group == "numeric" else
                                          stat["nearMissLines"] if group == "class" else
                                          sum(stat["nearMissCounts"].values())),
                        "presenceCandidateMentions": (stat["candidateMentions"]
                                                      if group == "presence" else None),
                        "exactLabelSourceGateCounts": exact_gate_counts,
                    })
        record = {
            "parameterCode": code, "family": rule["family"], "extractorGroup": group,
            "factType": rule["factType"], "attributes": rule["attributes"],
            "sourceGates": {
                "expectedStage": rule["expectedStage"],
                "allowedActualStages": rule["allowedActualStages"],
                "manifestSectionStatus": rule["manifestSectionStatus"],
                "requiredExpectedSections": rule["requiredExpectedSections"],
                "requiredActualSections": rule["requiredActualSections"],
                "requiredExpectedDrawingSections": rule["requiredExpectedDrawingSections"],
                "requiredActualDrawingSections": rule["requiredActualDrawingSections"],
                "requiredContext": rule["requiredContext"],
            },
            "objectSourcePlans": source["objects"],
            "sameObjectExactSourcePairObjects": exact_pair_objects,
            "potentialOcrPagesInCandidateSources": potential_ocr,
            "potentialOcrMeaning": "SOURCE_SCOPE_ONLY_NOT_CODE_HITS",
            "evidence": evidence,
            "executableFactCount": 0,
            "disposition": "NO_EXECUTABLE_FACT_ABSTAIN",
        }
        code_rows.append(record)
        family_rows[rule["family"]].append(record)
    if len(code_rows) != 47 or len({row["parameterCode"] for row in code_rows}) != 47:
        raise PublicFamilyReadinessError("47-code candidate registry drift")
    families = []
    for family, members in sorted(family_rows.items()):
        families.append({
            "family": family, "codeCount": len(members),
            "codes": [item["parameterCode"] for item in members],
            "codesWithValidatedLexicalProbe": sum(
                item["evidence"]["status"] == "LEXICAL_LEADS_ONLY" for item in members),
            "codesWithExactManifestPair": sum(
                bool(item["sameObjectExactSourcePairObjects"]) for item in members),
            "executableFactCount": 0,
            "disposition": "NO_EXECUTABLE_FACT_ABSTAIN",
        })
    if (manifest_path.read_bytes() != manifest_bytes
            or hashlib.sha256(audit_path.read_bytes()).hexdigest() != audit_sha):
        raise PublicFamilyReadinessError("public manifest or PASS audit changed during report")
    return {
        "schemaVersion": "public-family-readiness-v1",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "purpose": "REVIEW_ONLY", "disposition": "NO_EXECUTABLE_FACT_ABSTAIN",
        "manifestSha256": matrix["manifestSha256"], "auditSha256": audit_sha,
        "indexVersionHash": audit["indexVersionHash"],
        "candidatePackSha256": pack["packSha256"],
        "sourceMatrixSha256": _canonical_sha(matrix),
        "sourceMatrixFileSha256": matrix_file_sha,
        "inventory": {"sourceCount": 203, "pdfSources": 202, "pdfPages": 10_142,
                      "metadataOnlySourceId": "F0194",
                      "textCandidatePages": audit["actual"]["dispositions"].get(
                          "TEXT_LAYER_CANDIDATE", 0),
                      "ocrRequiredPages": audit["actual"]["dispositions"].get(
                          "OCR_REQUIRED", 0)},
        "probeProvenance": provenance,
        "ocrQueueMeaning": "GLOBAL_PUBLIC_PAGES_NOT_PER_CODE; SOURCE_POTENTIAL_IS_AN_UPPER_BOUND",
        "summary": {"candidateCodes": 47, "executableFactCount": 0,
                    "findingCount": None, "parameterCoverage": None,
                    "codesWithExactManifestPair": sum(
                        bool(item["sameObjectExactSourcePairObjects"]) for item in code_rows),
                    "codesWithValidatedLexicalProbe": sum(
                        item["evidence"]["status"] == "LEXICAL_LEADS_ONLY"
                        for item in code_rows)},
        "families": families, "codes": code_rows,
    }
