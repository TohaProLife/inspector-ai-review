"""Offline routing over the participant packet's TRAIN_PUBLIC source PDFs."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from .parameter_routing import route_parameter
from .text_layer import extract_pdf_text_artifact


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_public_bundle(
    manifest_path: Path,
    materials_root: Path,
    source_ids: list[str],
    source_decisions: dict[str, dict[str, Any]] | None = None,
    source_overrides: dict[str, Path] | None = None,
) -> dict[str, Any]:
    if not source_ids or len(set(source_ids)) != len(source_ids):
        raise ValueError("source_ids must be a non-empty set of unique file IDs")
    wanted = set(source_ids)
    selected: dict[str, dict[str, Any]] = {}
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("file_id") in wanted:
            file_id = row["file_id"]
            if file_id in selected:
                raise ValueError(f"duplicate file_id in manifest: {file_id}")
            selected[file_id] = row
    if set(selected) != wanted:
        raise ValueError(f"file IDs missing from manifest: {sorted(wanted - set(selected))}")
    object_ids = {row.get("object_id") for row in selected.values()}
    if len(object_ids) != 1 or not next(iter(object_ids)):
        raise ValueError("selected sources must belong to one object")
    decisions = source_decisions or {}
    if not isinstance(decisions, dict) or set(decisions) - set(selected):
        raise ValueError("source decisions must refer only to selected file IDs")
    overrides = source_overrides or {}
    if not isinstance(overrides, dict) or set(overrides) - set(selected):
        raise ValueError("source overrides must refer only to selected file IDs")
    materials_root = materials_root.resolve()
    sources: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    source_paths: dict[str, Path] = {}
    for file_id in sorted(selected):
        row = selected[file_id]
        if (row.get("split") != "TRAIN_PUBLIC" or row.get("distribution_status") != "INCLUDE"
                or row.get("label_visibility") != "PUBLIC_TRAIN"):
            raise ValueError(f"{file_id} is not a distributed TRAIN_PUBLIC source")
        if row.get("extension") != ".pdf":
            raise ValueError(f"{file_id} is not a PDF")
        stage = row.get("stage")
        if stage not in {"PD", "RD", "ID", "RD_ID_MIXED"}:
            raise ValueError(f"{file_id} has an unsupported stage: {stage}")
        relative_path = row.get("relative_path")
        if not isinstance(relative_path, str) or not relative_path:
            raise ValueError(f"{file_id} has no relative_path")
        path = overrides.get(file_id)
        if path is not None and not isinstance(path, Path):
            raise ValueError(f"source override path is invalid: {file_id}")
        if not (materials_root / relative_path).resolve().is_relative_to(materials_root):
            raise ValueError(f"{file_id} escapes the materials root")
        path = (path or materials_root / relative_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"source PDF missing: {file_id}: {path}")
        if path.stat().st_size != row.get("size_bytes") or _sha256_file(path) != row.get("sha256"):
            raise ValueError(f"source PDF does not match manifest SHA-256/size: {file_id}")
        source_paths[file_id] = path
        decision = decisions.get(file_id, {})
        if not isinstance(decision, dict) or (decision and decision.get("sourceSha256") != row["sha256"]):
            raise ValueError(f"source decision hash mismatch: {file_id}")
        revision_status = decision.get("revisionStatus", "UNKNOWN")
        approval_status = decision.get("approvalStatus", "UNKNOWN")
        if revision_status not in {"CURRENT", "SUPERSEDED", "UNKNOWN"}:
            raise ValueError(f"source revisionStatus is invalid: {file_id}")
        if approval_status not in {"APPROVED", "UNAPPROVED", "UNKNOWN"}:
            raise ValueError(f"source approvalStatus is invalid: {file_id}")
        link_group = decision.get("linkGroupId")
        if link_group is not None and (not isinstance(link_group, str) or not link_group.strip()):
            raise ValueError(f"source linkGroupId is invalid: {file_id}")
        page_stages = decision.get("pageStages", {})
        if not isinstance(page_stages, dict):
            raise ValueError(f"source pageStages is invalid: {file_id}")
        if (revision_status == "CURRENT" or approval_status == "APPROVED" or link_group is not None or page_stages):
            basis = decision.get("basis")
            if (not isinstance(basis, dict) or not isinstance(basis.get("reference"), str)
                    or not basis["reference"].strip()):
                raise ValueError(f"source decision needs a review basis: {file_id}")
        stages = ["RD", "ID"] if stage == "RD_ID_MIXED" else [stage]
        sources.append({
            "sourceFileId": file_id,
            "sha256": row["sha256"],
            "objectId": row["object_id"],
            "stages": stages,
            "sectionCode": row.get("section"),
            "revisionStatus": revision_status,
            "approvalStatus": approval_status,
            "linkGroupId": link_group,
            "pageStages": page_stages,
        })
        # The packet does not identify the stage of each page in a mixed PDF.
        # Extracting it would not make its RD and ID pages comparable.
        if stage != "RD_ID_MIXED" or page_stages:
            artifact = extract_pdf_text_artifact(path, file_id, row["sha256"])
            if artifact["pageCount"] != row.get("pdf_pages"):
                raise ValueError(f"extracted page count differs from manifest for {file_id}")
            artifacts.append(artifact)
    selected_rows = [selected[file_id] for file_id in sorted(selected)]
    selected_manifest_hash = hashlib.sha256(
        json.dumps(selected_rows, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "objectId": next(iter(object_ids)),
        "selectedManifestHash": selected_manifest_hash,
        "selectedFileIds": sorted(selected),
        "sources": sources,
        "textArtifacts": artifacts,
        "verifiedSourcePaths": source_paths,
    }


def run_public_pilot(
    manifest_path: Path,
    materials_root: Path,
    source_ids: list[str],
    rule: dict[str, Any],
    source_decisions: dict[str, dict[str, Any]] | None = None,
    source_overrides: dict[str, Path] | None = None,
) -> dict[str, Any]:
    bundle = load_public_bundle(manifest_path, materials_root, source_ids, source_decisions, source_overrides)
    result = route_parameter({
        "schemaVersion": "parameter-route-request-v1",
        "inputManifestHash": bundle["selectedManifestHash"],
        "objectId": bundle["objectId"],
        "rule": rule,
        "sources": bundle["sources"],
        "textArtifacts": bundle["textArtifacts"],
    })
    return {**result, "datasetSplit": "TRAIN_PUBLIC", "selectedFileIds": bundle["selectedFileIds"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Route a rule on verified TRAIN_PUBLIC PDFs")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--materials-root", required=True, type=Path)
    parser.add_argument("--source-id", action="append", required=True)
    parser.add_argument("--source", action="append", default=[], metavar="FILE_ID=PATH",
                        help="Verified PDF path override for an extracted source")
    parser.add_argument("--rule", required=True, type=Path, help="JSON atomic routing rule")
    parser.add_argument("--source-decisions", type=Path, help="Reviewed source metadata JSON by file ID")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    overrides: dict[str, Path] = {}
    for entry in args.source:
        source_id, separator, path = entry.partition("=")
        if not separator or not source_id or not path or source_id in overrides:
            parser.error("--source requires a unique FILE_ID=PATH")
        overrides[source_id] = Path(path)
    result = run_public_pilot(
        args.manifest,
        args.materials_root,
        args.source_id,
        json.loads(args.rule.read_text(encoding="utf-8")),
        json.loads(args.source_decisions.read_text(encoding="utf-8")) if args.source_decisions else None,
        overrides,
    )
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
