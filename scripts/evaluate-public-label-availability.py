#!/usr/bin/env python3
"""Audit public TRAIN labels and E2E receipts without scoring abstentions."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = (ROOT / "datasets" / "reference_methodology" / "hackathon_gold_20260811"
          / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ" / "data")
RULES = ROOT / "services" / "worker" / "rules"
PREVIEWS = ROOT / "output" / "homeserver-candidate-preview-20260927"
SCOPE = ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN")
PILOT_CODES = frozenset({"PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"})


def _read(path: Path, *, maximum: int = 32 * 1024 * 1024) -> bytes:
    content = path.read_bytes()
    if not 0 < len(content) <= maximum:
        raise ValueError(f"input missing or exceeds bound: {path.name}")
    return content


def _jsonl(content: bytes) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in content.decode("utf-8").splitlines() if line.strip()]
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("JSONL rows must be objects")
    return rows


def _hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def evidence_role_status(label_stage: str, manifest_stage: str) -> str:
    """Never promote an RD_ID_MIXED file to RD from its file ID alone."""
    if label_stage == manifest_stage and label_stage in {"PD", "RD", "ID"}:
        return "MANIFEST_STAGE_EXACT"
    if label_stage in {"RD", "ID"} and manifest_stage == "RD_ID_MIXED":
        return "PAGE_STAGE_PROOF_REQUIRED"
    return "STAGE_CONFLICT"


def _open_labels(checks: list[dict[str, Any]], catalog: dict[str, dict],
                 manifest: dict[str, dict]) -> tuple[list[dict], dict[str, dict], dict]:
    by_code: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "positiveChecks": 0, "negativeChecks": 0,
        "positiveGroups": set(), "negativeGroups": set(),
    })
    seen_ids: set[str] = set()
    reviewed = []
    for check in checks:
        check_id = check.get("check_id")
        code = check.get("parameter_code")
        label = check.get("violation_label")
        scope = check.get("matrix_scope")
        if (not isinstance(check_id, str) or check_id in seen_ids
                or check.get("split") != "TRAIN_PUBLIC"
                or check.get("visibility") != "PUBLIC_TRAIN_LABEL"
                or label not in {"VIOLATION_PRESENT", "NO_VIOLATION"}
                or not isinstance(code, str)
                or not isinstance(check.get("finding_group_id"), str)
                or check.get("score_eligible") is not True):
            raise ValueError("public check identity, scope, or label invalid")
        seen_ids.add(check_id)
        if scope == "MATRIX":
            if (code not in catalog
                    or check.get("parameter_id") != catalog[code]["parameter_id"]):
                raise ValueError("public matrix label differs from catalog")
        elif scope == "FREE_SEARCH":
            if code in catalog or check.get("parameter_id") is not None:
                raise ValueError("free-search label overlaps matrix catalog")
        else:
            raise ValueError("public check matrix scope unknown")
        entries = check.get("evidence")
        if not isinstance(entries, list) or not entries:
            raise ValueError("public check evidence missing")
        evidence = []
        for item in entries:
            source_id = item.get("file_id")
            source = manifest.get(source_id)
            page = item.get("pdf_page_number")
            if (source is None or source["object_id"] != check.get("object_id")
                    or source["extension"] != ".pdf"
                    or type(page) is not int or not 1 <= page <= source["pdf_pages"]):
                raise ValueError("public label evidence outside permitted PDF/page/object")
            role = evidence_role_status(item.get("stage"), source["stage"])
            if role == "STAGE_CONFLICT":
                raise ValueError("public label evidence stage conflicts with manifest")
            evidence.append({"labelStage": item["stage"], "sourceFileId": source_id,
                             "manifestStage": source["stage"], "manifestSection": source["section"],
                             "sourceSha256": source["sha256"], "pdfPageNumber": page,
                             "roleStatus": role})
        group = check["finding_group_id"]
        classification = "positive" if label == "VIOLATION_PRESENT" else "negative"
        by_code[code][classification + "Checks"] += 1
        by_code[code][classification + "Groups"].add(group)
        reviewed.append({"checkId": check_id, "findingGroupId": group,
                         "objectId": check["object_id"], "matrixScope": scope,
                         "parameterCode": code, "locationType": check.get("location_type"),
                         "location": check.get("location"), "label": label,
                         "comparisonResult": check.get("comparison_result"),
                         "evidence": evidence,
                         "hasRevisionOrApprovalFields": any(
                             key in check for key in ("revision_id", "approval_status",
                                                       "source_revision", "link_group_id"))})
    counts = {code: {"positiveChecks": value["positiveChecks"],
                     "negativeChecks": value["negativeChecks"],
                     "positiveGroups": len(value["positiveGroups"]),
                     "negativeGroups": len(value["negativeGroups"])}
              for code, value in by_code.items()}
    role_counts = Counter(item["roleStatus"] for check in reviewed for item in check["evidence"])
    summary = {"checkCount": len(reviewed),
               "positiveCheckCount": sum(item["label"] == "VIOLATION_PRESENT" for item in reviewed),
               "negativeCheckCount": sum(item["label"] == "NO_VIOLATION" for item in reviewed),
               "findingGroupCount": len({item["findingGroupId"] for item in reviewed}),
               "matrixCheckCount": sum(item["matrixScope"] == "MATRIX" for item in reviewed),
               "freeSearchCheckCount": sum(item["matrixScope"] == "FREE_SEARCH" for item in reviewed),
               "labeledObjects": sorted({item["objectId"] for item in reviewed}),
               "evidenceRoleCounts": dict(sorted(role_counts.items())),
               "checksWithRevisionOrApprovalFields": sum(item["hasRevisionOrApprovalFields"]
                                                         for item in reviewed),
               "uniqueEvidencePages": len({(item["sourceFileId"], item["pdfPageNumber"])
                                           for check in reviewed for item in check["evidence"]})}
    return reviewed, counts, summary


def preview_evaluation_status(preview: dict, *, labeled_objects: set[str],
                              labeled_codes: set[str], smoke_object: str) -> dict:
    """Operational receipt only; no confusion-matrix cells from ABSTAIN."""
    comparisons = preview.get("factFamily", {}).get("comparisons", [])
    candidate = preview.get("candidateFamilyPreview", {})
    if (preview.get("status") != "PARTIAL" or preview.get("findingCount") != 0
            or candidate.get("codeCount") != 47
            or len(comparisons) != 5
            or {row.get("parameterCode") for row in comparisons} != PILOT_CODES):
        raise ValueError("unexpected E2E candidate preview receipt")
    statuses = Counter(row.get("status") for row in comparisons)
    if any(status not in {"ABSTAIN", "REVIEW_REQUIRED"} for status in statuses):
        raise ValueError("E2E comparison status outside review-only contract")
    if candidate.get("leadCount") != 0:
        raise ValueError("unexpected E2E candidate lead count")
    return {"checkId": preview["checkId"], "serviceObjectId": preview["objectId"],
            "status": preview["status"], "coverage": preview["coverage"],
            "findingCount": preview["findingCount"],
            "pilotComparisonCount": len(comparisons),
            "pilotComparisonStatusCounts": dict(sorted(statuses.items())),
            "candidateCodeCount": candidate["codeCount"],
            "candidateLeadCount": candidate["leadCount"],
            "documentedPublicSourceObject": smoke_object,
            "documentedSourceObjectOverlapsLabels": smoke_object in labeled_objects,
            "pilotCodeOverlapsLabels": bool(PILOT_CODES & labeled_codes),
            "scoringStatus": "NOT_ESTIMABLE_NO_SAME_OBJECT_LABELED_PREDICTIONS",
            "trueNegativeCount": None, "falseNegativeCount": None,
            "precision": None, "recall": None, "f1": None}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=PUBLIC / "document_manifest.jsonl")
    parser.add_argument("--checks", type=Path, default=PUBLIC / "public_train_checks.jsonl")
    parser.add_argument("--catalog", type=Path, default=PUBLIC / "parameter_catalog_132.jsonl")
    parser.add_argument("--registry", type=Path,
                        default=RULES / "parameter-family-registry-v1.json")
    parser.add_argument("--candidate-pack", type=Path,
                        default=RULES / "parameter-candidate-rules-v1.json")
    parser.add_argument("--first-preview", type=Path,
                        default=PREVIEWS / "candidate-preview-core-smoke-fixed-20260927.json")
    parser.add_argument("--second-preview", type=Path,
                        default=PREVIEWS / "candidate-preview-core-post-reconnect-20260927.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if (args.output.exists() or not args.output.parent.is_dir()
                or args.checks.name != "public_train_checks.jsonl"
                or args.checks.parent != args.manifest.parent):
            raise ValueError("new output and participant public checks/manifest required")
        files = {name: _read(path) for name, path in {
            "publicManifest": args.manifest, "publicChecks": args.checks,
            "catalog": args.catalog, "familyRegistry": args.registry,
            "candidatePack": args.candidate_pack,
            "firstPreview": args.first_preview, "secondPreview": args.second_preview,
        }.items()}
        hashes = {name: _hash(content) for name, content in files.items()}
        public = {row["file_id"]: row for row in _jsonl(files["publicManifest"])
                  if (row.get("split"), row.get("distribution_status"),
                      row.get("label_visibility")) == SCOPE}
        if len(public) != 203 or sum(row["extension"] == ".pdf" for row in public.values()) != 202:
            raise ValueError("public manifest inventory drift")
        catalog_rows = _jsonl(files["catalog"])
        catalog = {row["parameter_code"]: row for row in catalog_rows}
        if (len(catalog_rows) != 132 or len(catalog) != 132
                or {row["parameter_id"] for row in catalog_rows} != set(range(1, 133))):
            raise ValueError("132-code catalog inventory invalid")
        registry = json.loads(files["familyRegistry"])
        candidate = json.loads(files["candidatePack"])
        registry_rows = registry["entries"]
        by_registry = {row["parameterCode"]: row for row in registry_rows}
        candidate_codes = {row["parameterCode"] for row in candidate["rules"]}
        if (registry["catalogSha256"] != hashes["catalog"]
                or candidate["catalogSha256"] != hashes["catalog"]
                or candidate["registrySha256"] != hashes["familyRegistry"]
                or len(registry_rows) != 132 or len(by_registry) != 132
                or set(by_registry) != set(catalog)
                or len(candidate["rules"]) != 47 or len(candidate_codes) != 47
                or candidate_codes != {code for code, row in by_registry.items()
                                       if row["classification"] == "GENERIC_CANDIDATE"}
                or {code for code, row in by_registry.items()
                    if row["classification"] == "PILOT_REVIEW_ONLY"} != PILOT_CODES):
            raise ValueError("catalog, registry, or 47-code candidate policy drift")
        checks = _jsonl(files["publicChecks"])
        reviewed, by_code, label_summary = _open_labels(checks, catalog, public)
        matrix_labeled = {code for code in by_code if code in catalog}
        labeled_codes = set(by_code)
        catalog_evaluation = []
        for row in catalog_rows:
            code = row["parameter_code"]
            counts = by_code.get(code, {"positiveChecks": 0, "negativeChecks": 0,
                                        "positiveGroups": 0, "negativeGroups": 0})
            catalog_evaluation.append({"parameterId": row["parameter_id"],
                                       "parameterCode": code,
                                       "familyClassification": by_registry[code]["classification"],
                                       **counts})
        family_counts = {}
        for classification in ("PILOT_REVIEW_ONLY", "GENERIC_CANDIDATE", "UNRESOLVED"):
            subset = [row for row in catalog_evaluation
                      if row["familyClassification"] == classification]
            family_counts[classification] = {
                "catalogCodes": len(subset),
                "codesWithPositiveChecks": sum(row["positiveChecks"] > 0 for row in subset),
                "codesWithNegativeChecks": sum(row["negativeChecks"] > 0 for row in subset),
                "positiveChecks": sum(row["positiveChecks"] for row in subset),
                "negativeChecks": sum(row["negativeChecks"] for row in subset),
            }
        smoke_ids = ("F0105", "F0136")  # Documented inputs; receipts lack source SHA/IDs.
        smoke = [public[source_id] for source_id in smoke_ids]
        if (len({row["object_id"] for row in smoke}) != 1
                or {row["stage"] for row in smoke} != {"PD", "RD"}):
            raise ValueError("documented E2E source pair invalid")
        smoke_object = smoke[0]["object_id"]
        preview_paths = (args.first_preview, args.second_preview)
        previews = []
        for name, path in zip(("firstPreview", "secondPreview"), preview_paths):
            value = json.loads(files[name])
            assessed = preview_evaluation_status(
                value, labeled_objects=set(label_summary["labeledObjects"]),
                labeled_codes=labeled_codes, smoke_object=smoke_object)
            assessed["receiptSha256"] = hashes[name]
            previews.append(assessed)
        if previews[0]["checkId"] == previews[1]["checkId"]:
            raise ValueError("two E2E previews must be distinct checks")
        if any(path.read_bytes() != files[name] for name, path in {
            "publicManifest": args.manifest, "publicChecks": args.checks,
            "catalog": args.catalog, "familyRegistry": args.registry,
            "candidatePack": args.candidate_pack,
            "firstPreview": args.first_preview, "secondPreview": args.second_preview,
        }.items()):
            raise ValueError("public evaluation input changed during read")
        report = {
            "schemaVersion": "public-label-evaluation-v1",
            "status": "COMPLETE_COUNTS_METRICS_NOT_ESTIMABLE",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "labelSource": "public_train_checks.jsonl_ONLY",
            "inputSha256": hashes,
            "publicInventory": {"sourceCount": len(public),
                                "pdfCount": sum(row["extension"] == ".pdf" for row in public.values()),
                                "sourceCountsByObject": dict(sorted(Counter(
                                    row["object_id"] for row in public.values()).items()))},
            "labelSummary": label_summary,
            "matrixCodesWithPublicPositives": sorted(code for code in matrix_labeled
                                                     if by_code[code]["positiveChecks"]),
            "matrixCodesWithPublicNegatives": sorted(code for code in matrix_labeled
                                                     if by_code[code]["negativeChecks"]),
            "matrixCodesWithoutChecks": 132 - len(matrix_labeled),
            "familyCounts": family_counts,
            "freeSearchCounts": {code: counts for code, counts in sorted(by_code.items())
                                 if code not in catalog},
            "catalogCodes": catalog_evaluation,
            "publicChecks": reviewed,
            "documentedSmokeInputs": {"bindingStatus": "DOCUMENTED_NOT_IN_MACHINE_RECEIPTS",
                                      "sourceFileIds": list(smoke_ids),
                                      "publicObjectId": smoke_object,
                                      "sources": [{"sourceFileId": row["file_id"],
                                                   "stage": row["stage"],
                                                   "sourceSha256": row["sha256"]}
                                                  for row in smoke]},
            "e2eReceipts": previews,
            "metrics": {"precision": None, "recall": None, "f1": None,
                        "falsePositiveRate": None,
                        "reason": "NO_SAME_OBJECT_CASE_PREDICTIONS_AND_NO_NEGATIVE_CHECKS",
                        "abstainAsNegative": False,
                        "availableKnownPositiveCheckDenominator": label_summary["positiveCheckCount"],
                        "scoredKnownPositiveChecks": 0,
                        "truePositiveCount": None, "falsePositiveCount": None,
                        "trueNegativeCount": None, "falseNegativeCount": None},
        }
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(report, output, ensure_ascii=False, sort_keys=True, indent=2)
            output.write("\n")
        print(json.dumps({"status": report["status"], "publicChecks": len(reviewed),
                          "positiveChecks": label_summary["positiveCheckCount"],
                          "negativeChecks": label_summary["negativeCheckCount"],
                          "matrixCodesWithLabels": len(matrix_labeled),
                          "pilotLabeled": family_counts["PILOT_REVIEW_ONLY"]["positiveChecks"],
                          "candidateLabeled": family_counts["GENERIC_CANDIDATE"]["positiveChecks"],
                          "output": str(args.output)}, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as error:
        print(json.dumps({"status": "FAILED", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
