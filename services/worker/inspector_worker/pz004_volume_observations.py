"""Bounded source observations for PZ-004 on two public PDF pages.

No rule result is emitted. Equal printed numbers cannot establish comparable
building scope, the approved revision, geometry, or an applicable change.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import fitz


SOURCE_SPEC = {
    "F0150": {"stage": "PD", "section": "OTHER", "page": 26},
    "F0201": {"stage": "RD_ID_MIXED", "section": "OV", "page": 14},
}
EXPECTED_PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
NUMBER = r"(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)[,.]\d{1,3}"
PD_LABEL = re.compile(r"Строительный\s+об[ъь]?[её]м\s+здания,\s*в\s*т\.\s*ч\.:?", re.I)
RD_SENTENCE = re.compile(
    rf"Строительный\s+об[ъь]?[её]м\s+здания\s+V\s*=\s*({NUMBER})\s+куб\.?\s*м\s*;?",
    re.I,
)
DECIMAL = re.compile(rf"{NUMBER}")
MANIFEST_FIELDS = (
    "file_id", "object_id", "split", "distribution_status", "label_visibility",
    "extension", "stage", "section", "relative_path", "pdf_pages",
    "size_bytes", "sha256",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_hash(value: Any) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _rect(rect: Any) -> list[float]:
    return [round(float(coordinate), 2) for coordinate in rect]


def _lines(page: fitz.Page) -> list[dict[str, Any]]:
    lines = []
    for block_index, block in enumerate(page.get_text("dict", sort=True)["blocks"]):
        for line_index, line in enumerate(block.get("lines", [])):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if text:
                lines.append({
                    "text": text, "bboxPt": _rect(line["bbox"]),
                    "blockIndex": block_index, "lineIndex": line_index,
                })
    return lines


def _value(raw: str) -> str | None:
    if not DECIMAL.fullmatch(raw.strip()):
        return None
    try:
        value = Decimal(raw.replace(" ", "").replace("\u00a0", "").replace(",", "."))
    except InvalidOperation:
        return None
    return format(value, "f") if value >= 0 else None


def verify_public_sources(
    manifest_path: Path,
    sources: dict[str, Path],
    *,
    expected_manifest_sha256: str,
) -> tuple[dict[str, dict[str, Any]], str]:
    """Check manifest identity and original bytes without reading answer files."""
    if set(sources) != set(SOURCE_SPEC):
        raise ValueError("PZ-004 probe requires exactly F0150 and F0201")
    manifest_hash = _sha256(manifest_path)
    if manifest_hash != expected_manifest_sha256:
        raise ValueError("document_manifest.jsonl SHA-256 mismatch")
    selected: dict[str, dict[str, Any]] = {}
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        if not any(re.search(r'"file_id"\s*:\s*"' + source_id + r'"', raw)
                   for source_id in SOURCE_SPEC):
            continue
        row = json.loads(raw)
        source_id = row.get("file_id")
        if source_id in selected:
            raise ValueError(f"duplicate manifest entry: {source_id}")
        selected[source_id] = {field: row.get(field) for field in MANIFEST_FIELDS}
    if set(selected) != set(SOURCE_SPEC):
        raise ValueError("selected sources missing from manifest")
    if len({row["object_id"] for row in selected.values()}) != 1 or not selected["F0150"]["object_id"]:
        raise ValueError("sources must share a nonempty object_id")
    for source_id, row in selected.items():
        spec = SOURCE_SPEC[source_id]
        if (row["split"] != "TRAIN_PUBLIC" or row["distribution_status"] != "INCLUDE"
                or row["label_visibility"] != "PUBLIC_TRAIN" or row["extension"] != ".pdf"
                or row["stage"] != spec["stage"] or row["section"] != spec["section"]):
            raise ValueError(f"{source_id} wrong public split, stage, or section")
        if (not isinstance(row["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
                or type(row["size_bytes"]) is not int or row["size_bytes"] < 1
                or type(row["pdf_pages"]) is not int or row["pdf_pages"] < spec["page"]
                or not isinstance(row["relative_path"], str) or not row["relative_path"]):
            raise ValueError(f"{source_id} invalid manifest source metadata")
        path = sources[source_id]
        if (not path.is_file() or path.stat().st_size != row["size_bytes"]
                or _sha256(path) != row["sha256"]):
            raise ValueError(f"{source_id} PDF size or SHA-256 mismatch")
        with fitz.open(path) as pdf:
            if len(pdf) != row["pdf_pages"]:
                raise ValueError(f"{source_id} PDF page count differs from manifest")
    return selected, manifest_hash


def _pd_observations(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observations = []
    for label in lines:
        if not PD_LABEL.fullmatch(label["text"]):
            continue
        peers = [line for line in lines
                 if line["bboxPt"][0] > label["bboxPt"][2]
                 and abs(line["bboxPt"][1] - label["bboxPt"][1]) <= 4]
        units = [line for line in peers if re.fullmatch(r"м\s*[³3]", line["text"], re.I)]
        values = [line for line in peers if _value(line["text"]) is not None
                  and len(units) == 1 and line["bboxPt"][0] > units[0]["bboxPt"][2]]
        if len(units) != 1 or len(values) != 1:
            continue
        observations.append({
            "valueM3": _value(values[0]["text"]), "rawValue": values[0]["text"],
            "rawUnit": units[0]["text"], "rawLabel": label["text"],
            "quote": " | ".join(line["text"] for line in (label, units[0], values[0])),
            "textLayerBoxesPt": {"label": label["bboxPt"], "unit": units[0]["bboxPt"],
                                 "value": values[0]["bboxPt"]},
            "scope": "BUILDING_TOTAL_PRINTED",
        })
    return observations


def _rd_observations(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    observations = []
    for line in lines:
        match = RD_SENTENCE.fullmatch(line["text"])
        if match is None:
            continue
        value = _value(match.group(1))
        if value is None:
            continue
        observations.append({
            "valueM3": value, "rawValue": match.group(1), "rawUnit": "куб.м",
            "rawLabel": "Строительный объем здания", "quote": line["text"],
            "textLayerBoxesPt": {"line": line["bboxPt"]},
            "scope": "BUILDING_TOTAL_PRINTED",
        })
    return observations


def build_public_observation_slice(
    manifest_path: Path,
    pd_source: Path,
    mixed_source: Path,
    *,
    expected_manifest_sha256: str,
) -> dict[str, Any]:
    """Read only F0150 p26 and F0201 p14; always abstain from PZ-004 verdict."""
    paths = {"F0150": pd_source, "F0201": mixed_source}
    manifest, manifest_hash = verify_public_sources(
        manifest_path, paths, expected_manifest_sha256=expected_manifest_sha256,
    )
    observations = []
    reasons = ["SOURCE_REVISION_UNRESOLVED", "SOURCE_APPROVAL_UNRESOLVED",
               "SOURCE_LINK_UNRESOLVED", "MIXED_PAGE_STAGE_UNRESOLVED",
               "RD_AR_KR_SOURCE_MISSING", "GEOMETRY_AND_SCOPE_UNVERIFIED",
               "APPLICABLE_CHANGE_UNRESOLVED"]
    for source_id in SOURCE_SPEC:
        path = paths[source_id]
        row = manifest[source_id]
        if _sha256(path) != row["sha256"]:
            raise ValueError(f"{source_id} PDF SHA-256 changed before extraction")
        page_number = SOURCE_SPEC[source_id]["page"]
        with fitz.open(path) as pdf:
            lines = _lines(pdf[page_number - 1])
        source_observations = (_pd_observations(lines) if source_id == "F0150"
                               else _rd_observations(lines))
        if len(source_observations) != 1:
            reasons.append(f"{source_id}_TOTAL_VOLUME_NOT_UNIQUE")
            source_observations = []
        for fact in source_observations:
            observations.append({
                **fact, "sourceFileId": source_id, "sourceSha256": row["sha256"],
                "sourcePage": page_number, "manifestStage": row["stage"],
                "pageStage": "PD" if source_id == "F0150" else "UNRESOLVED",
                "section": row["section"], "extractionMethod": "PDF_TEXT_LAYER",
                "reviewStatus": "UNREVIEWED",
            })
        if _sha256(path) != row["sha256"]:
            raise ValueError(f"{source_id} PDF SHA-256 changed during extraction")
    report = {
        "schemaVersion": "pz004-public-volume-observation-v1", "parameterCode": "PZ-004",
        "datasetSplit": "TRAIN_PUBLIC", "objectId": manifest["F0150"]["object_id"],
        "manifestSha256": manifest_hash,
        "selectedManifestHash": _canonical_hash(manifest),
        "sources": [
            {"sourceFileId": source_id, "sourceSha256": manifest[source_id]["sha256"],
             "sizeBytes": manifest[source_id]["size_bytes"],
             "relativePath": manifest[source_id]["relative_path"],
             "manifestStage": manifest[source_id]["stage"],
             "section": manifest[source_id]["section"],
             "sourcePage": SOURCE_SPEC[source_id]["page"],
             "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN"}
            for source_id in SOURCE_SPEC
        ],
        "observations": observations,
        "literalValueOverlap": (
            len(observations) == 2 and len({item["sourceFileId"] for item in observations}) == 2
            and observations[0]["valueM3"] == observations[1]["valueM3"]
        ),
        "overlapSemantics": "LEXICAL_ONLY",
        "evaluation": {"machineStatus": "CLARIFICATION_REQUIRED", "reasonCodes": reasons,
                       "comparableFacts": [], "finding": None},
        "comparisonDisposition": "ABSTAIN", "finding": None,
    }
    report["contentHash"] = _canonical_hash(report)
    return report
