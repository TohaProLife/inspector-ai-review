"""Review-only apartment-count observation from public F0101 index pages.

The public manifest identifies F0101 as PD/OTHER. Its title page supplies the
missing PZ section proof; page 10 supplies the printed total. This adapter
never pairs RD, changes coverage, or emits a finding.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from inspector_worker.indexed_page_evidence import load_indexed_page_evidence
from inspector_worker.public_document_index import _validate_cached_page, readonly_index_uri
from inspector_worker.pz_fact_family import _apartment_total_row


SOURCE_ID = "F0101"
OBJECT_ID = "OBJ-NOVOSLOBODSKAYA"
SOURCE_SHA256 = "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54"
PUBLIC_MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
TITLE_PAGE = 1
TOTAL_PAGE = 10
MAX_PAGE_BLOCKS = 256
_TITLE_MARKERS = (
    "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ",
    "Раздел 1",
    "Часть 2 «Пояснительная записка»",
    "НВС-2025/03-ПЗ",
)


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()


def _full_index_page(manifest_path: Path, index_root: Path, page_number: int) -> dict[str, Any]:
    """Read one complete, SHA-validated cached page after public source gates."""
    selected = load_indexed_page_evidence(
        manifest_path, index_root, SOURCE_ID, page_number,
        expected_object_id=OBJECT_ID, expected_stage="PD", expected_section="OTHER",
        block_indices=[0],
    )
    if (selected["manifestSha256"] != PUBLIC_MANIFEST_SHA256
            or selected["sourceSha256"] != SOURCE_SHA256):
        raise ValueError("F0101 source or public manifest SHA-256 mismatch")
    database = index_root / "index.sqlite3"
    with closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        connection.execute("PRAGMA query_only=ON")
        record = connection.execute(
            "SELECT artifact_path, artifact_sha256, parser_provenance, block_count "
            "FROM pages WHERE source_id=? AND page_number=?", (SOURCE_ID, page_number),
        ).fetchone()
    if (record is None or record[1] != selected["pageArtifactSha256"]
            or record[2] != selected["parserProvenance"]
            or type(record[3]) is not int or not 1 <= record[3] <= MAX_PAGE_BLOCKS):
        raise ValueError("F0101 indexed page metadata changed or exceeds bound")
    page = _validate_cached_page(
        index_root, {"sha256": SOURCE_SHA256}, page_number, tuple(record[:3]),
    )
    if (page is None or len(page["blocks"]) != record[3]
            or page["quality"] != selected["quality"]
            or page["widthMilliPoints"] != selected["widthMilliPoints"]
            or page["heightMilliPoints"] != selected["heightMilliPoints"]
            or page["blocks"][0] != {key: selected["blocks"][0][key]
                                         for key in ("text", "bboxMilliPoints")}):
        raise ValueError("F0101 indexed page changed during verified read")
    return {"meta": selected, "page": page}


def _title_proof(title: dict[str, Any]) -> dict[str, Any] | None:
    blocks = title["page"]["blocks"]
    anchors = []
    for marker in _TITLE_MARKERS:
        matches = [(index, block) for index, block in enumerate(blocks)
                   if block["text"].strip() == marker]
        if len(matches) != 1:
            return None
        index, block = matches[0]
        anchors.append({"text": marker, "locator": {"kind": "INDEXED_TEXT_BLOCK",
                       "blockIndex": index, "bboxMilliPoints": block["bboxMilliPoints"]}})
    return {"sourceFileId": SOURCE_ID, "sourceSha256": SOURCE_SHA256,
            "pageNumber": TITLE_PAGE,
            "pageArtifactSha256": title["meta"]["pageArtifactSha256"],
            "parserProvenance": title["meta"]["parserProvenance"],
            "sectionCode": "PZ", "markers": anchors}


def _build_report(title: dict[str, Any], table: dict[str, Any]) -> dict[str, Any]:
    first, second = title["meta"], table["meta"]
    shared = ("manifestSha256", "indexVersionHash", "sourceFileId", "sourceSha256",
              "sourceRelativePath", "objectId", "stage", "section")
    if any(first[key] != second[key] for key in shared):
        raise ValueError("F0101 title and total page source provenance differ")
    if first["pageNumber"] != TITLE_PAGE or second["pageNumber"] != TOTAL_PAGE:
        raise ValueError("F0101 title and total pages differ from expected pages")
    proof = _title_proof(title)
    reasons = ["SOURCE_REVISION_UNRESOLVED", "SOURCE_APPROVAL_UNRESOLVED",
               "RD_AR_SOURCE_MISSING", "SOURCE_LINK_UNRESOLVED"]
    observations: list[dict[str, Any]] = []
    if proof is None:
        reasons.append("PD_PZ_SECTION_UNPROVEN")
    else:
        source = {"sourceFileId": SOURCE_ID, "sha256": SOURCE_SHA256,
                  "objectId": OBJECT_ID, "stages": ["PD"]}
        page = {"pageNumber": TOTAL_PAGE, "blocks": table["page"]["blocks"]}
        fact = _apartment_total_row(OBJECT_ID, source, page, "PD")
        if fact is None or re.fullmatch(r"[1-9][0-9]{0,5}", fact["rawValue"]) is None:
            reasons.append("APARTMENT_TOTAL_NOT_UNIQUE_OR_UNVERIFIED")
        else:
            observations.append({
                "typedFact": fact, "normalizedValueCount": int(fact["rawValue"]),
                "scope": "PRINTED_TOTAL_UNLINKED", "reviewStatus": "UNREVIEWED",
                "sourceSectionProof": proof,
                "pageArtifactSha256": second["pageArtifactSha256"],
                "parserProvenance": second["parserProvenance"],
            })
    report = {
        "schemaVersion": "pz010-public-index-observation-v1",
        "parameterCode": "PZ-010", "datasetSplit": "TRAIN_PUBLIC",
        "objectId": OBJECT_ID, "sourceFileId": SOURCE_ID,
        "sourceSha256": SOURCE_SHA256,
        "manifestSha256": first["manifestSha256"],
        "indexVersionHash": first["indexVersionHash"],
        "sourceRelativePath": first["sourceRelativePath"],
        "sourceSectionProof": proof,
        "totalPageNumber": TOTAL_PAGE,
        "totalPageArtifactSha256": second["pageArtifactSha256"],
        "coordinateSystem": second["coordinateSystem"],
        "observations": observations,
        "evaluation": {"machineStatus": "CLARIFICATION_REQUIRED",
                       "reasonCodes": reasons, "finding": None},
        "comparisonDisposition": "ABSTAIN", "finding": None,
    }
    report["contentHash"] = _hash(report)
    return report


def build_public_f0101_observation(manifest_path: Path, index_root: Path) -> dict[str, Any]:
    """Observe printed PD count only. No RD pair, finding, or coverage claim."""
    title = _full_index_page(manifest_path, index_root, TITLE_PAGE)
    table = _full_index_page(manifest_path, index_root, TOTAL_PAGE)
    return _build_report(title, table)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--index", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build_public_f0101_observation(args.manifest, args.index),
                     ensure_ascii=False, sort_keys=True, indent=2))
