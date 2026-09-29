"""Bounded, text-only free-search suspicion; never a rule finding or matrix result.

This profile finds a specific PD warm-floor *reference* whose wording is not
present in the extracted text of RD candidate sources. It does not infer room
ownership, element absence, source approval, or PD/RD comparability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from .parameter_routing import _validate_artifact
from .public_pilot import load_public_bundle
from .text_layer import extract_pdf_text_artifact


_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_WARM_FLOOR = re.compile(r"т[её]пл\w*\s+пол\w*", re.IGNORECASE)
_REGULATOR = re.compile(r"регулятор|multibox", re.IGNORECASE)
PROFILE_ID = "free-heating-text-reference-v1"
MAX_SOURCES = 16
MAX_PAGES = 2048
MAX_PD_REFERENCES = 64


def _canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def _source_scope(source: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    stages = source["stages"]
    return {
        "sourceFileId": source["sourceFileId"], "inputSha256": source["sha256"],
        "textArtifactHash": _canonical_hash(artifact),
        "stageStatus": "RD" if stages == ["RD"] else "MIXED_RD_ID_UNRESOLVED",
        "revisionStatus": source.get("revisionStatus", "UNKNOWN"),
        "approvalStatus": source.get("approvalStatus", "UNKNOWN"),
        "linkGroupId": source.get("linkGroupId"),
        "pageCount": artifact["pageCount"],
        "textLayerCandidatePageCount": artifact["qualitySummary"]["textLayerCandidatePageCount"],
        "ocrRequiredPageCount": artifact["qualitySummary"]["ocrRequiredPageCount"],
        "textSearchState": "MATCH_IN_EXTRACTED_TEXT" if any(
            _WARM_FLOOR.search(block["text"])
            for page in artifact["pages"] if page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
            for block in page["blocks"]
        ) else "NO_MATCH_IN_EXTRACTED_TEXT_ONLY",
    }


def analyze_free_heating_suspicion(bundle: dict[str, Any]) -> dict[str, Any]:
    """Use immutable text artifacts; return a review signal, never a mismatch verdict."""
    if not isinstance(bundle, dict):
        raise ValueError("free-search bundle must be an object")
    object_id = bundle.get("objectId")
    manifest_hash = bundle.get("selectedManifestHash")
    sources = bundle.get("sources")
    artifacts = bundle.get("textArtifacts")
    selected_ids = bundle.get("selectedFileIds")
    if (not isinstance(object_id, str) or not object_id
            or not isinstance(manifest_hash, str) or _SHA256.fullmatch(manifest_hash) is None
            or not isinstance(sources, list) or not 0 < len(sources) <= MAX_SOURCES
            or not isinstance(artifacts, list) or not isinstance(selected_ids, list)):
        raise ValueError("free-search bundle has invalid immutable inputs")
    source_by_id: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("free-search source must be an object")
        source_id = source.get("sourceFileId")
        sha = source.get("sha256")
        stages = source.get("stages")
        if (not isinstance(source_id, str) or not source_id or source_id in source_by_id
                or not isinstance(sha, str) or _SHA256.fullmatch(sha) is None
                or source.get("objectId") != object_id
                or not isinstance(stages, list) or not stages
                or any(stage not in {"PD", "RD", "ID"} for stage in stages)):
            raise ValueError("free-search source has invalid object, identity or stage")
        source_by_id[source_id] = source
    if sorted(selected_ids) != sorted(source_by_id):
        raise ValueError("free-search selected IDs differ from immutable sources")
    artifact_by_id: dict[str, dict[str, Any]] = {}
    total_pages = 0
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise ValueError("free-search text artifact must be an object")
        source_id = artifact.get("sourceFileId")
        if source_id not in source_by_id or source_id in artifact_by_id:
            raise ValueError("free-search text artifact source is missing or duplicated")
        _validate_artifact(artifact, source_by_id[source_id])
        artifact_by_id[source_id] = artifact
        total_pages += artifact["pageCount"]
    if set(artifact_by_id) != set(source_by_id) or total_pages > MAX_PAGES:
        raise ValueError("free-search text artifacts are incomplete or exceed page bound")

    pd_sources = [s for s in sources if s["stages"] == ["PD"]]
    rd_sources = [s for s in sources if "RD" in s["stages"]]
    rd_scopes = [_source_scope(s, artifact_by_id[s["sourceFileId"]]) for s in rd_sources]
    unmatched_scopes = [s for s in rd_scopes if s["textSearchState"] == "NO_MATCH_IN_EXTRACTED_TEXT_ONLY"]
    pd_references: list[dict[str, Any]] = []
    if rd_sources and unmatched_scopes:
        for source in pd_sources:
            artifact = artifact_by_id[source["sourceFileId"]]
            artifact_hash = _canonical_hash(artifact)
            for page in artifact["pages"]:
                if page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE":
                    continue
                for block_index, block in enumerate(page["blocks"]):
                    if not (_WARM_FLOOR.search(block["text"]) and _REGULATOR.search(block["text"])):
                        continue
                    pd_references.append({
                        "sourceFileId": source["sourceFileId"], "inputSha256": source["sha256"],
                        "textArtifactHash": artifact_hash, "sourcePage": page["pageNumber"],
                        "blockIndex": block_index, "bboxMilliPoints": block["bboxMilliPoints"],
                        "quote": block["text"][:1000], "quoteTruncated": len(block["text"]) > 1000,
                        "localizationLevel": "TEXT_BLOCK",
                    })
                    if len(pd_references) > MAX_PD_REFERENCES:
                        raise ValueError("free-search PD reference count exceeds safe bound")
    suspicions: list[dict[str, Any]] = []
    if pd_references:
        identity = {"profileId": PROFILE_ID, "manifestHash": manifest_hash,
                    "pdReferences": pd_references,
                    "rdSources": [s["inputSha256"] for s in unmatched_scopes]}
        suspicions.append({
            "suspicionId": _canonical_hash(identity), "machineStatus": "SUSPICION",
            "discoveryMethod": "PD_WARM_FLOOR_TEXT_REFERENCE_WITH_RD_TEXT_GAP",
            "comparisonStatus": "NOT_COMPARABLE", "pdReferences": pd_references,
            "rdCandidateSources": unmatched_scopes,
            "scopeStatus": "TEXT_LAYER_ONLY_FULL_RD_VISUAL_SCOPE_UNVERIFIED",
            "verificationConditions": [
                "SOURCE_REVISION_APPROVAL_AND_PD_RD_LINK_REVIEW",
                "PD_REFERENCE_TO_ROOM_OR_SYSTEM_LINK_REVIEW",
                "RD_PAGE_STAGE_AND_ROOM_LINK_REVIEW",
                "VISUAL_OR_OCR_RD_REVIEW",
                "FULL_RD_SCOPE_AND_ALTERNATIVE_DESIGN_REVIEW",
            ],
        })
    reason = ("NO_RD_CANDIDATE_SOURCE" if not rd_sources else
              "RD_TEXT_REFERENCE_OBSERVED_OR_NO_PD_REFERENCE" if not suspicions else
              "PD_REFERENCE_RD_TEXT_GAP_REVIEW_REQUIRED")
    return {
        "schemaVersion": "free-heating-suspicion-v1", "profileId": PROFILE_ID,
        "objectId": object_id, "selectedManifestHash": manifest_hash,
        "selectedFileIds": sorted(source_by_id), "matrixScope": "FREE",
        "parameterCode": "FREE-HEATING-001",
        "status": "SUSPICION" if suspicions else "NO_DISCOVERY", "reasonCode": reason,
        "findingCount": 0, "roomLinkStatus": "UNRESOLVED",
        "sourceScan": rd_scopes,
        "suspicions": suspicions,
    }


def run_public_free_heating(
    manifest_path: Path, materials_root: Path, source_ids: list[str],
    source_overrides: dict[str, Path] | None = None,
) -> dict[str, Any]:
    """Verify TRAIN_PUBLIC bytes first, then extract mixed-stage text for review only."""
    bundle = load_public_bundle(manifest_path, materials_root, source_ids,
                                source_overrides=source_overrides)
    present = {artifact["sourceFileId"] for artifact in bundle["textArtifacts"]}
    for source in bundle["sources"]:
        source_id = source["sourceFileId"]
        if source_id in present:
            continue
        path = bundle["verifiedSourcePaths"][source_id]
        bundle["textArtifacts"].append(extract_pdf_text_artifact(path, source_id, source["sha256"]))
    return analyze_free_heating_suspicion(bundle)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--materials-root", required=True, type=Path)
    parser.add_argument("--source-id", action="append", required=True)
    parser.add_argument("--source", action="append", default=[], metavar="FILE_ID=PATH")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    overrides: dict[str, Path] = {}
    for entry in args.source:
        source_id, separator, path = entry.partition("=")
        if not separator or not source_id or not path or source_id in overrides:
            parser.error("--source requires a unique FILE_ID=PATH")
        overrides[source_id] = Path(path)
    result = run_public_free_heating(args.manifest, args.materials_root,
                                     args.source_id, overrides)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "status": result["status"],
                      "suspicionCount": len(result["suspicions"]),
                      "findingCount": result["findingCount"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
