#!/usr/bin/env python3
"""Validate and summarize seven public, review-only batches for 80 unresolved codes.

The summary keeps per-batch scan units and caps. It does not merge page counts,
create extracted facts, promote coverage, or infer findings from search hits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/unresolved-public-summary-20260927/summary.json"
STRATEGY_REPORT = ROOT / "output/unresolved-parameter-strategy-20260927/report.json"
AUDIT = ROOT / "output/public-index-20260927/index-audit.json"
CATALOG = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/parameter_catalog_132.jsonl"
MANIFEST = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
REGISTRY = ROOT / "services/worker/rules/parameter-family-registry-v1.json"
STRATEGY_PACK = ROOT / "docs/operations/unresolved-parameter-strategy-v1.json"
PINNED = {
    "catalog": "c6b73dffbea6bb366fc50f08392522c390bdf7b19420051802bd0bcbd32b4e4f",
    "manifest": "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7",
    "registry": "fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a",
    "strategyPack": "0e9519b426c93fa9eaefe7416d6ced893c212ff3deb198d87e70eedf884d5514",
    "strategyReport": "39e321972ecea101af7aa70de7d0a5dc60398119ca0e318748852e220a055055",
    "audit": "d4d04dccbbbaa2517d5b34a0b5cb0a54dde4dcc424d9b74ec4a6f5c4313ad8cc",
}
INPUTS = {
    "kr": ("output/kr-unresolved-20260927/kr-unresolved-public-batch-v3.json",
           "92b1d5386a116a791b2e5ecd5891942487a37972bb4ecbc004afda20db98ddf5"),
    "ar": ("output/ar-unresolved-20260927/report.json",
           "d2d97651431f4e3fc2fe73c73d4c83306be2081848431ee1140820096914e3e0"),
    "pos": ("output/pos-unresolved-20260927/report.json",
            "ebcb3230238dd2843b1a6433b6e9f69fec849e2dd9be5e28c8c5383bb0e98307"),
    "engineering": ("output/engineering-mixed-20260927/report-v6.json",
                    "d5eefd3500f0b452cdca838c9836538fd8464d05914e9de2da33d36799acc2bf"),
    "pz_spzu": ("output/pz-spzu-unresolved-20260927/report.json",
                "a09fec0b2c39826b537d294cef9c670f376041504c0e90012c1e4496486d5535"),
    "pod_oos": ("output/pod-oos-unresolved-20260927/report.json",
                "f238c00265983b5bc1710f58194fd41022581a0f4b5a9e7dfe42c38f0e954222"),
    "utility": ("output/utility-unresolved-20260927/report.json",
                "cd4680b269c1c2253ae033f1b59c18f70e93fb901df823900b9cb77648a3beef"),
}
EXPECTED_COUNTS = {"kr": 8, "ar": 9, "pos": 6, "engineering": 10,
                   "pz_spzu": 20, "pod_oos": 9, "utility": 21}
ALLOWED_OVERLAP = {"PPM-111", "PPM-112", "PPM-113"}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON report is not object: {path}")
    return value


def _codes(report: dict[str, Any], batch: str) -> dict[str, dict[str, Any]]:
    raw = report.get("codeReports") if batch in {"kr", "pz_spzu"} else report.get("codes")
    if isinstance(raw, dict):
        if any(not isinstance(code, str) or not isinstance(row, dict) for code, row in raw.items()):
            raise ValueError(f"invalid code map in {batch}")
        return raw
    if isinstance(raw, list):
        codes = [row.get("parameterCode") for row in raw if isinstance(row, dict)]
        if (len(codes) != len(raw) or any(not isinstance(code, str) for code in codes)
                or len(set(codes)) != len(codes)):
            raise ValueError(f"invalid or duplicate code list in {batch}")
        return dict(zip(codes, raw, strict=True))
    raise ValueError(f"missing code records in {batch}")


def _require_abstain(report: dict[str, Any], codes: dict[str, dict[str, Any]], batch: str) -> None:
    if report.get("findingCount", "MISSING") is not None or report.get("parameterCoverage", "MISSING") is not None:
        raise ValueError(f"{batch} reports findings or coverage, cannot aggregate as review-only")
    if report.get("runtimePromotion", False) is not False:
        raise ValueError(f"{batch} promotes runtime")
    for code, row in codes.items():
        status = row.get("disposition", row.get("status"))
        if batch == "engineering":
            comparison = row.get("comparison")
            if not isinstance(comparison, dict) or comparison.get("comparablePairCount") != 0:
                raise ValueError(f"{batch}:{code} claims a comparable pair")
            status = comparison.get("status")
        if status != "ABSTAIN":
            raise ValueError(f"{batch}:{code} is not ABSTAIN")
        for key in ("findingCount", "parameterCoverage"):
            if key in row and row[key] is not None:
                raise ValueError(f"{batch}:{code} promotes {key}")
        if row.get("sameObjectExactPdRdArPairCount", 0) != 0:
            raise ValueError(f"{batch}:{code} claims comparable AR pair")
    if report.get("sameObjectExactPdRdArPairCount", 0) != 0:
        raise ValueError("AR batch claims comparable pair")
    if batch == "pos" and report["sourceRoles"]["exactPairObjectCount"] != 0:
        raise ValueError("POS batch claims comparable pair")
    if batch == "kr" and report["sourceGate"]["crossDocumentPair"] != "UNPROVEN":
        raise ValueError("KR pair gate unexpectedly changed")


def _scan_summary(report: dict[str, Any], rows: dict[str, dict[str, Any]], batch: str) -> dict[str, Any]:
    """All counts are kept in source report units; never sum them across batches."""
    if batch == "kr":
        if report["scannedPages"] != report["textLayerPages"] + report["ocrRequiredPages"]:
            raise ValueError("KR page partition invalid")
        if any(row["shownLeads"] > 40 or row["shownLeads"] + row["omittedLeads"] != row["matchingLines"]
               for row in rows.values()):
            raise ValueError("KR lead display cap/accounting invalid")
        return {"selectedSourceDocuments": len(report["sourceFileIds"]),
                "selectedSourcePagesIndexedAndShaChecked": report["scannedPages"],
                "textLayerPagesSearched": report["textLayerPages"],
                "ocrRequiredUnknownPages": report["ocrRequiredPages"],
                "displayLeadCapPerCode": 40,
                "displayLeadsOmitted": sum(row["omittedLeads"] for row in rows.values()),
                "pageSelectionCapPerCode": None,
                "fullPdfContentVerified": False}
    if batch == "ar":
        inv = report["inventory"]
        if inv["textPages"] + inv["ocrPages"] != inv["pdfPages"]:
            raise ValueError("AR page partition invalid")
        return {"corpusPdfSourcesIndexed": inv["pdfSources"],
                "corpusPdfPagesIndexed": inv["pdfPages"],
                "textLayerPagesSearched": inv["textPages"],
                "ocrRequiredUnknownPages": inv["ocrPages"],
                "textLineMatchesWithCodeDuplicates": sum(row["scanCounts"].get("matchedLines", 0) for row in rows.values()),
                "displayLeadsOmitted": sum(row["scanCounts"].get("matchedLines", 0) - row["leadDisplayCount"] for row in rows.values()),
                "targetedOcrPlanOnlyPages": report["targetedOcrQueue"]["displayCount"],
                "targetedOcrQueueTruncated": report["targetedOcrQueue"]["queueTruncated"],
                "cliDefaultDisplayLeadCapPerCode": 500,
                "cliDefaultOcrQueueCap": 24,
                "actualCliCapsRecordedInReport": False,
                "fullPdfContentVerified": False}
    if batch == "pos":
        if report["textLayerCandidatePages"] + report["ocrRequiredPages"] != report["indexedPosPages"]:
            raise ValueError("POS page partition invalid")
        return {"selectedSourceDocuments": len(report["pdPosSourceIds"]),
                "selectedSourcePagesIndexedAndShaChecked": report["indexedPosPages"],
                "textLayerPagesSearched": report["textLayerCandidatePages"],
                "ocrRequiredUnknownPages": report["ocrRequiredPages"],
                "targetedOcrPlanOnlyPages": len(report["ocrProposals"]),
                "ocrProposalBudget": report["ocrProposalBudget"],
                "ocrPagesDeferred": report["ocrPagesDeferred"],
                "pageSelectionCapPerCode": None,
                "fullPdfContentVerified": False}
    if batch == "engineering":
        matches = sum(row["matchedTextPages"] for row in rows.values())
        selected = sum(row["selectedTextPages"] for row in rows.values())
        omitted = sum(row["omittedTextPages"] for row in rows.values())
        if matches != selected + omitted:
            raise ValueError("engineering thematic page partition invalid")
        if any(row["selectedTextPages"] > report["maxPagesPerCode"] for row in rows.values()):
            raise ValueError("engineering per-code page cap exceeded")
        return {"selectedSourceDocuments": len(report["sourceFileIds"]),
                "thematicTextPageAddressesWithCodeDuplicates": matches,
                "shaCheckedSelectedThematicPageAddressesWithCodeDuplicates": selected,
                "thematicPageAddressesOmittedByCap": omitted,
                "pageSelectionCapPerCode": report["maxPagesPerCode"],
                "ocrRequiredUnknownPagesInSelectedSources": report["ocrRequiredPagesInSelectedSources"],
                "targetedOcrPlanOnlyPages": len(report["ocrProposals"]),
                "targetedOcrQueueTruncated": report["ocrProposalSelectionCapped"],
                "fullPdfContentVerified": False}
    if batch == "pz_spzu":
        lexical = sum(row["lexicalMatchedTextPages"] for row in rows.values())
        selected = sum(row["selectedTextPages"] for row in rows.values())
        omitted = sum(row["omittedLexicalTextPages"] for row in rows.values())
        if lexical != selected + omitted:
            raise ValueError("PZ/SPZU lexical page partition invalid")
        if any(row["selectedTextPages"] > report["limits"]["maxPagesPerCode"] for row in rows.values()):
            raise ValueError("PZ/SPZU per-code page cap exceeded")
        return {"corpusPdfSourcesIndexed": report["pdfSources"],
                "corpusPdfPagesIndexed": report["pdfPages"],
                "ftsThematicPageAddressesWithCodeDuplicates": sum(row["ftsMatchedTextPages"] for row in rows.values()),
                "lexicalPageAddressesWithCodeDuplicates": lexical,
                "shaCheckedSelectedLexicalPageAddressesWithCodeDuplicates": selected,
                "lexicalPageAddressesOmittedByCap": omitted,
                "pageSelectionCapPerCode": report["limits"]["maxPagesPerCode"],
                "lineSelectionCapPerPage": report["limits"]["maxLinesPerPage"],
                "ocrRequiredUnknownPagesInCorpus": report["ocrRequiredPagesInCorpus"],
                "targetedOcrPlanOnlyPages": len(report["ocrQueue"]),
                "targetedOcrQueueCap": report["limits"]["maxOcrQueue"],
                "targetedOcrQueueOmitted": report["ocrQueueOmitted"],
                "fullPdfContentVerified": False}
    if batch == "pod_oos":
        if any(row["selectedPageAddresses"] > report["pageCapPerCode"]
               or row["selectedPageAddresses"] + row["pagesOmittedByCap"] != row["ftsMatchedPageAddresses"]
               for row in rows.values()):
            raise ValueError("POD/OOS page cap/accounting invalid")
        return {"corpusPdfSourcesIndexed": report["publicPdfSourceCount"],
                "corpusPdfPagesIndexed": report["publicPdfPageCount"],
                "shaCheckedUniqueSelectedPageAddresses": report["uniqueShaVerifiedSelectedPages"],
                "selectedPageAddressesWithCodeDuplicates": sum(row["selectedPageAddresses"] for row in rows.values()),
                "thematicPageAddressesOmittedByCap": sum(row["pagesOmittedByCap"] for row in rows.values()),
                "pageSelectionCapPerCode": report["pageCapPerCode"],
                "ocrRequiredUnknownPagesInOosFilenameHintSources": report["ocrTriage"]["ocrRequiredPagesInOosFilenameHintSources"],
                "targetedOcrPlanOnlyPages": len(report["ocrTriage"]["proposals"]),
                "ocrProposalCap": report["ocrTriage"]["proposalCap"],
                "fullPdfContentVerified": False}
    if batch == "utility":
        inv = report["inventory"]
        if inv["textPages"] + inv["ocrRequiredPages"] != inv["pdfPages"]:
            raise ValueError("utility page partition invalid")
        queue = report["targetedOcrQueue"]["families"]
        pages = {(page["sourceFileId"], page["pageNumber"]) for family in queue.values()
                 for page in family["pages"]}
        return {"corpusPdfSourcesIndexed": inv["pdfSources"],
                "corpusPdfPagesIndexed": inv["pdfPages"],
                "textLayerPagesSearched": inv["textPages"],
                "ocrRequiredUnknownPages": inv["ocrRequiredPages"],
                "textLineMatchesWithCodeDuplicates": sum(row["scanCounts"].get("matchedLines", 0) for row in rows.values()),
                "displayLeadsOmitted": sum(row["scanCounts"].get("matchedLines", 0) - row["leadDisplayCount"] for row in rows.values()),
                "targetedOcrPlanOnlyEntries": sum(family["displayCount"] for family in queue.values()),
                "targetedOcrPlanOnlyUniquePages": len(pages),
                "targetedOcrQueueTruncated": any(family["queueTruncated"] for family in queue.values()),
                "cliDefaultDisplayLeadCapPerCode": 500,
                "cliDefaultOcrQueueCapPerFamily": 20,
                "actualCliCapsRecordedInReport": False,
                "fullPdfContentVerified": False}
    raise ValueError(f"unknown batch {batch}")


def _code_observation(row: dict[str, Any], batch: str) -> dict[str, Any]:
    """Preserve original report counter names; they have different units."""
    if batch == "kr":
        keys = ("matchingPages", "matchingLines", "shownLeads", "omittedLeads")
    elif batch in {"ar", "utility"}:
        keys = ("matchedPageCount", "leadDisplayCount", "leadsTruncated")
    elif batch == "pos":
        keys = ("exactLexicalAnchorCount", "nearTopicMentionCount", "leadCount")
    elif batch == "engineering":
        keys = ("matchedTextPages", "selectedTextPages", "omittedTextPages")
    elif batch == "pz_spzu":
        keys = ("ftsMatchedTextPages", "lexicalMatchedTextPages", "selectedTextPages",
                "omittedLexicalTextPages")
    elif batch == "pod_oos":
        keys = ("ftsMatchedPageAddresses", "selectedPageAddresses", "pagesOmittedByCap",
                "externalEventSnapshot")
    else:
        raise ValueError(f"unknown batch {batch}")
    return {key: row[key] for key in keys}


def build_summary(root: Path = ROOT,
                  inputs: dict[str, tuple[str, str]] = INPUTS) -> dict[str, Any]:
    if set(inputs) != set(INPUTS):
        raise ValueError("all seven named batch inputs required")
    reference_paths = {"catalog": CATALOG, "manifest": MANIFEST, "registry": REGISTRY,
                       "strategyPack": STRATEGY_PACK, "strategyReport": STRATEGY_REPORT,
                       "audit": AUDIT}
    if any(_sha(path) != PINNED[name] for name, path in reference_paths.items()):
        raise ValueError("pinned catalog, manifest, strategy, registry, or audit SHA drift")
    strategy = _read_json(STRATEGY_REPORT)
    expected = [row["parameterCode"] for row in strategy["parameters"]]
    strategy_by_code = {row["parameterCode"]: row for row in strategy["parameters"]}
    if len(expected) != 80 or len(set(expected)) != 80:
        raise ValueError("strategy report is not exactly 80 unique codes")
    audit = _read_json(AUDIT)
    if audit.get("status") != "PASS" or audit.get("indexVersionHash") != "5f599fc405acfbf9d858":
        raise ValueError("public index audit not PASS/pinned version")

    batch_reports: dict[str, Any] = {}
    by_code: dict[str, list[str]] = {}
    batch_rows: dict[str, dict[str, dict[str, Any]]] = {}
    for name, (relative_path, expected_sha) in inputs.items():
        path = root / relative_path
        actual_sha = _sha(path)
        if actual_sha != expected_sha:
            raise ValueError(f"{name} report SHA-256 drift")
        report = _read_json(path)
        if report.get("manifestSha256") != PINNED["manifest"]:
            raise ValueError(f"{name} manifest SHA mismatch")
        for field, pin in (("catalogSha256", "catalog"), ("registrySha256", "registry"),
                           ("strategySha256", "strategyPack"),
                           ("strategyReportSha256", "strategyReport"),
                           # PZ/SPZU calls the input strategy-report file SHA `reportSha256`.
                           ("reportSha256", "strategyReport"),
                           ("auditSha256", "audit"), ("auditReportSha256", "audit")):
            if field in report and report[field] != PINNED[pin]:
                raise ValueError(f"{name} {field} SHA mismatch")
        if "indexVersionHash" in report and report["indexVersionHash"] != audit["indexVersionHash"]:
            raise ValueError(f"{name} index version mismatch")
        if "scope" in report and report["scope"] != "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY":
            raise ValueError(f"{name} includes non-public scope")
        rows = _codes(report, name)
        if len(rows) != EXPECTED_COUNTS[name]:
            raise ValueError(f"{name} code count drift")
        for code, row in rows.items():
            reference = strategy_by_code.get(code)
            if reference is not None:
                if "catalogTrigger" in row and row["catalogTrigger"] != reference["catalogTrigger"]:
                    raise ValueError(f"{name}:{code} catalog trigger drift")
                if ("candidateExtractorFamily" in row
                        and row["candidateExtractorFamily"] != reference["candidateExtractorFamily"]):
                    raise ValueError(f"{name}:{code} extractor family drift")
        _require_abstain(report, rows, name)
        scan = _scan_summary(report, rows, name)
        batch_reports[name] = {"path": relative_path, "fileSha256": actual_sha,
                               "codeCount": len(rows), "status": report.get("overallStatus", report.get("status", report.get("purpose"))),
                               "scanEvidence": scan,
                               "confirmedComparablePairs": 0,
                               "findingCount": None, "parameterCoverage": None}
        batch_rows[name] = rows
        for code in rows:
            by_code.setdefault(code, []).append(name)
    if set(by_code) != set(expected):
        raise ValueError(f"batch code union differs from 80 unresolved codes: missing={sorted(set(expected)-set(by_code))}, extra={sorted(set(by_code)-set(expected))}")
    overlap = {code for code, batches in by_code.items() if len(batches) > 1}
    if overlap != ALLOWED_OVERLAP or any(by_code[code] != ["engineering", "utility"] for code in overlap):
        raise ValueError("only PPM-111/112/113 may overlap engineering and utility batches")
    codes = [{"parameterCode": code,
              "reviewedInBatches": by_code[code],
              "candidateExtractorFamily": next(row["candidateExtractorFamily"]
                                               for row in strategy["parameters"] if row["parameterCode"] == code),
              "batchObservations": {name: {
                  "status": (batch_rows[name][code].get("comparison", {}).get("status") if name == "engineering"
                             else batch_rows[name][code].get("disposition", batch_rows[name][code].get("status"))),
                  "pageCountMeaning": "batch-specific search/review addresses; no deduplicated cross-batch page coverage",
                  "reportedCounters": _code_observation(batch_rows[name][code], name),
              } for name in by_code[code]},
              "verifiedComparablePair": False,
              "findingOrCoveragePromoted": False}
             for code in expected]
    result = {"schemaVersion": "unresolved-public-batch-summary-v1",
              "executionPolicy": "REVIEW_ONLY_ABSTAIN",
              "sourceScope": "TRAIN_PUBLIC+INCLUDE+PUBLIC_TRAIN; no hidden answers",
              "inputSha256": PINNED,
              "summary": {"unresolvedCodeCount": 80,
                          "batchCodeOccurrences": sum(len(rows) for rows in batch_rows.values()),
                          "overlapCodes": sorted(overlap),
                          "reviewedBatchCount": len(batch_reports),
                          "confirmedComparablePairs": 0,
                          "findingsPromoted": 0,
                          "coveragePromoted": 0,
                          "fullPdfContentVerified": False},
              "batchReports": batch_reports,
              "parameters": codes,
              "interpretation": (
                  "Page counts and search hits have different scopes and duplicate across codes/batches. "
                  "OCR_REQUIRED pages and capped thematic candidates remain UNKNOWN. "
                  "No report proves same-object, same-element, comparable revision PD/RD pair."
              )}
    result["summarySha256"] = hashlib.sha256(
        (json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    ).hexdigest()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    result = build_summary()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"summarySha256": result["summarySha256"], **result["summary"]},
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
