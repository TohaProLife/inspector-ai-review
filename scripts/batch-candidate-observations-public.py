#!/usr/bin/env python3
"""Run the 47-code observation contract over all SHA-checked public PDFs.

Source review fields absent from the participant manifest remain UNKNOWN. The
batch must therefore abstain; its value is a complete artifact/provenance and
family gate check, not a scored benchmark or a negative finding.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/worker"))

from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.public_document_index import get_indexed_page, load_public_manifest
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION


PUBLIC_MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
                   / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
AUDIT = ROOT / "output/public-index-20260927/index-audit.json"
READINESS = ROOT / "output/public-index-20260927/public-family-readiness-20260927.json"
OCR_TRIAGE = ROOT / "output/unresolved-ocr-20260927/triage.json"


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source_and_artifact(index_root: Path, row: dict[str, Any],
                        index_version_hash: str) -> tuple[dict[str, Any], dict[str, Any], Counter[str]]:
    if row["extension"] != ".pdf" or row["stage"] not in {"PD", "RD", "ID", "RD_ID_MIXED"}:
        raise ValueError("public batch source must be a typed PDF")
    stages = ["RD", "ID"] if row["stage"] == "RD_ID_MIXED" else [row["stage"]]
    page_stages = ({str(page): "UNRESOLVED" for page in range(1, row["pdf_pages"] + 1)}
                   if len(stages) > 1 else {})
    # The manifest section is not a reviewed drawing section. No source
    # revision, approval, or mixed-file page role is inferred from filenames.
    source = {
        "sourceFileId": row["file_id"], "sha256": row["sha256"],
        "objectId": row["object_id"], "stages": stages, "sectionCode": None,
        "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
        "pageStages": page_stages,
    }
    pages = []
    dispositions: Counter[str] = Counter()
    for number in range(1, row["pdf_pages"] + 1):
        indexed = get_indexed_page(index_root, row["file_id"], number)
        saved_source, page = indexed["source"], indexed["page"]
        if (saved_source["source_id"] != row["file_id"]
                or saved_source["object_id"] != row["object_id"]
                or saved_source["stage"] != row["stage"]
                or saved_source["section"] != row["section"]
                or saved_source["source_sha256"] != row["sha256"]
                or saved_source["status"] != "COMPLETE"
                or page["indexVersionHash"] != index_version_hash
                or page["inputSha256"] != row["sha256"]
                or page["pageNumber"] != number
                or page["qualityPolicyVersion"] != TEXT_QUALITY_POLICY_VERSION):
            raise ValueError(f"indexed source/page differs from participant manifest: {row['file_id']} p.{number}")
        dispositions[page["quality"]["disposition"]] += 1
        pages.append({key: page[key] for key in (
            "pageNumber", "widthMilliPoints", "heightMilliPoints", "blocks", "quality")})
    artifact = {
        "schemaVersion": "document-text-v2", "sourceFileId": row["file_id"],
        "inputSha256": row["sha256"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": row["pdf_pages"],
        "textPageCount": sum(bool(page["blocks"]) for page in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {
            "textLayerCandidatePageCount": dispositions["TEXT_LAYER_CANDIDATE"],
            "ocrRequiredPageCount": dispositions["OCR_REQUIRED"],
        },
        "pages": pages,
    }
    return source, artifact, dispositions


def run(index_root: Path, manifest: Path, audit_path: Path,
        readiness_path: Path, ocr_triage_path: Path) -> dict[str, Any]:
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    readiness = json.loads(readiness_path.read_text(encoding="utf-8"))
    manifest_hash = sha_file(manifest)
    pack = load_candidate_family_pack()
    if (audit["status"] != "PASS" or audit["findingCount"] != 0
            or audit["manifestSha256"] != manifest_hash
            or audit["expected"] != {"pdfPages": 10142, "pdfSources": 202,
                                      "sourceCount": 203, "txtInventorySources": 1}
            or readiness["auditSha256"] != sha_file(audit_path)
            or readiness["manifestSha256"] != manifest_hash
            or readiness["candidatePackSha256"] != pack["packSha256"]):
        raise ValueError("public index audit, manifest, or pinned policy drift")
    rows = load_public_manifest(manifest)
    public_by_id = {row["file_id"]: row for row in rows}
    ocr_triage = json.loads(ocr_triage_path.read_text(encoding="utf-8"))
    ocr_summary = ocr_triage["summary"]
    ocr_pages = ocr_triage["pages"]
    if (ocr_triage["scope"] != "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY"
            or ocr_triage["disposition"] != "REVIEW_ONLY_ABSTAIN"
            or ocr_triage["findingCount"] is not None
            or ocr_triage["parameterCoverage"] is not None
            or len(ocr_pages) != ocr_summary["completedPages"]
            or sum(item["candidate47LeadCount"] for item in ocr_pages)
            != ocr_summary["candidate47LexicalLeads"]
            or any(item["sourceFileId"] not in public_by_id
                   or public_by_id[item["sourceFileId"]]["extension"] != ".pdf"
                   or not 1 <= item["pageNumber"] <= public_by_id[item["sourceFileId"]]["pdf_pages"]
                   for item in ocr_pages)):
        raise ValueError("targeted OCR triage is not bounded to public review-only pages")
    pdfs = [row for row in rows if row["extension"] == ".pdf"]
    if len(rows) != 203 or len(pdfs) != 202 or sum(row["pdf_pages"] for row in pdfs) != 10142:
        raise ValueError("participant public inventory differs from 203/202/10142")
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in pdfs:
        grouped[row["object_id"]].append(row)
    objects: list[dict[str, Any]] = []
    quality: Counter[str] = Counter()
    stage_counts: Counter[str] = Counter()
    family_counts: dict[str, dict[str, Any]] = {}
    readiness_codes = {code["parameterCode"]: code for code in readiness["codes"]}
    if set(readiness_codes) != {rule["parameterCode"] for rule in pack["rules"]}:
        raise ValueError("readiness report does not cover exactly 47 candidate codes")
    for rule in pack["rules"]:
        family = rule["family"]
        family_counts.setdefault(family, {"codes": set(), "reasonCounts": Counter(),
                                          "observationCount": 0, "typedFactCount": 0,
                                          "indexExactLabelLines": 0,
                                          "indexPresenceCandidateMentions": 0,
                                          "indexNearMissLines": 0})["codes"].add(rule["parameterCode"])
        evidence = readiness_codes[rule["parameterCode"]]["evidence"]
        if evidence["status"] != "LEXICAL_LEADS_ONLY":
            raise ValueError("readiness evidence claims more than lexical leads")
        for field in ("exactLabelLines", "presenceCandidateMentions", "nearMissLines"):
            count = evidence[field]
            if count is not None:
                if type(count) is not int or count < 0:
                    raise ValueError("readiness lexical count invalid")
                family_counts[family]["index" + field[0].upper() + field[1:]] += count
    for object_id, object_rows in sorted(grouped.items()):
        sources, artifacts = [], []
        for row in object_rows:
            source, artifact, dispositions = source_and_artifact(
                index_root, row, audit["indexVersionHash"])
            sources.append(source)
            artifacts.append(artifact)
            quality.update(dispositions)
            stage_counts[row["stage"]] += 1
        preview = evaluate_run_candidate_family_preview(object_id, manifest_hash,
                                                        sources, artifacts)
        observations = extract_candidate_family_observations(preview, sources, artifacts)
        if (preview["outputCount"] != 47 or len(observations["codeRows"]) != 47
                or observations["inputManifestHash"] != manifest_hash
                or observations["findingCount"] is not None
                or observations["parameterCoverage"] is not None):
            raise ValueError("run observation contract differs from review-only policy")
        for code_row in observations["codeRows"]:
            family = family_counts[code_row["family"]]
            family["observationCount"] += code_row["observationCount"]
            family["reasonCounts"].update(code_row["reasonCodes"])
        for observation in observations["observations"]:
            if observation["typedFact"] is not None:
                family_counts[observation["family"]]["typedFactCount"] += 1
        objects.append({"objectId": object_id, "pdfSourceCount": len(object_rows),
                        "pageCount": sum(row["pdf_pages"] for row in object_rows),
                        "previewContentHash": preview["contentHash"],
                        "observationContentHash": observations["contentHash"],
                        "observationCount": observations["outputCount"]})
    if quality != Counter(audit["actual"]["dispositions"]):
        raise ValueError("indexed page quality counts differ from complete audit")
    if sum(stage_counts.values()) != 202:
        raise ValueError("not all public PDF stages accounted for")
    families = []
    for name, value in sorted(family_counts.items()):
        families.append({"family": name, "codeCount": len(value["codes"]),
                         "codes": sorted(value["codes"]),
                         "observationCount": value["observationCount"],
                         "typedFactCount": value["typedFactCount"],
                         "precomputedIndexLexicalSignals": {
                             "exactLabelLines": value["indexExactLabelLines"],
                             "presenceCandidateMentions": value["indexPresenceCandidateMentions"],
                             "nearMissLines": value["indexNearMissLines"],
                         },
                         "reasonCounts": dict(sorted(value["reasonCounts"].items()))})
    output_count = sum(item["observationCount"] for item in families)
    result = {
        "schemaVersion": "candidate-observations-public-batch-v1",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "purpose": "REVIEW_ONLY", "disposition": "ABSTAIN_SOURCE_REVIEW_UNRESOLVED",
        "inputHashes": {"manifestSha256": manifest_hash,
                        "indexAuditSha256": sha_file(audit_path),
                        "indexDatabaseSha256": sha_file(index_root / "index.sqlite3"),
                        "readinessSha256": sha_file(readiness_path),
                        "targetedOcrTriageSha256": sha_file(ocr_triage_path),
                        "candidateRulePackSha256": pack["packSha256"]},
        "inventory": {"publicDocumentCount": 203, "publicPdfCount": 202,
                      "metadataOnlyTxtCount": 1, "verifiedIndexedPageCount": sum(quality.values()),
                      "pageDispositionCounts": dict(sorted(quality.items())),
                      "sourceStageCounts": dict(sorted(stage_counts.items())),
                      "sourceRevisionUnknownCount": 202,
                      "sourceApprovalUnknownCount": 202,
                      "reviewedDrawingSectionCount": 0},
        "objects": objects, "families": families,
        "independentTargetedOcrLexicalProbe": {
            "queuedAndCompletedPageCount": len(ocr_pages),
            "candidate47LabelLeadCount": ocr_summary["candidate47LexicalLeads"],
            "candidate47PagesWithLeads": sum(item["candidate47LeadCount"] > 0
                                             for item in ocr_pages),
            "candidate47SourceGateCounts": ocr_summary["candidate47SourceGates"],
            "status": "LEXICAL_NAVIGATION_ONLY_NOT_RUN_OBSERVATIONS",
        },
        "codeCount": sum(item["codeCount"] for item in families),
        "observationCount": output_count,
        "typedFactCount": sum(item["typedFactCount"] for item in families),
        "findingCount": None, "parameterCoverage": None,
        "limits": [
            "Manifest does not prove current revision or approval; all run sources retain UNKNOWN.",
            "Manifest section is not a reviewed drawing section; sectionCode stays null.",
            "RD_ID_MIXED page roles stay UNRESOLVED unless reviewed per page.",
            "Zero observations under unresolved review gates is not a negative result.",
            "Targeted OCR label leads are separate from artifact-verified run observations.",
            "Class and presence families require further typed-value and complete-set review.",
        ],
    }
    result["contentHash"] = canonical_hash(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=PUBLIC_MANIFEST)
    parser.add_argument("--audit", type=Path, default=AUDIT)
    parser.add_argument("--readiness", type=Path, default=READINESS)
    parser.add_argument("--ocr-triage", type=Path, default=OCR_TRIAGE)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("batch output already exists")
    result = run(args.index, args.manifest, args.audit, args.readiness,
                 args.ocr_triage)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True,
                                      indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "contentHash": result["contentHash"],
                      "observationCount": result["observationCount"],
                      "verifiedIndexedPageCount": result["inventory"]["verifiedIndexedPageCount"]},
                     ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
