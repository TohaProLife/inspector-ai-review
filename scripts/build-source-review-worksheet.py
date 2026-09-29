#!/usr/bin/env python3
"""Export SHA-pinned public source-review tasks to a non-authoritative CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
SOURCE_PACKET_SHA256 = "b1ad972a6c268f36d88665e29a161b9eb614dbe73c8df2e05d5d5ee18fd39328"
REGION_PACKET_SHA256 = "a48ec9e5de3f172295582241d6c3f6bc61a01fa99de5bd73c13e5a0e73c01092"
FIELDS = (
    "reviewRank", "sourceFileId", "objectId", "manifestStage", "manifestSection",
    "priorityTier", "titleStageHints", "titleSectionHints", "titleAlignedCodes",
    "regionRoleHints", "conflictKinds", "sourceSha256", "sourceRelativePath",
    "reviewedRevision", "reviewedApproval", "reviewedSection", "evidenceReference",
)


def _load(path: Path, sha: str) -> dict:
    raw = path.read_bytes()
    if len(raw) > 16_000_000 or hashlib.sha256(raw).hexdigest() != sha:
        raise ValueError("source review input SHA-256 differs from pinned report")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("source review report must be an object")
    return value


def _csv_cell(value: object) -> str:
    text = str(value)
    # Paths and source titles came from external PDFs/ZIP; keep spreadsheet cells inert.
    return "'" + text if re.match(r"^[\s]*[=+\-@]", text) else text


def build_rows(source_packet: dict, region_packet: dict) -> list[dict[str, str]]:
    sources = source_packet.get("sources")
    regions = region_packet.get("sources")
    if (source_packet.get("schemaVersion") != "source-review-packet-v1"
            or source_packet.get("disposition") != "HUMAN_REVIEW_ONLY_ABSTAIN"
            or source_packet.get("manifestSha256") != MANIFEST_SHA256
            or not isinstance(sources, list) or len(sources) != 103
            or region_packet.get("schemaVersion") != "mixed-stage-region-batch-v1"
            or region_packet.get("disposition") != "SOURCE_REVIEW_ONLY_ABSTAIN"
            or region_packet.get("manifestSha256") != MANIFEST_SHA256
            or not isinstance(regions, list) or len(regions) != 4):
        raise ValueError("source review packet scope/status invalid")
    region_by_id = {item["sourceFileId"]: item for item in regions}
    if len(region_by_id) != 4 or set(region_by_id) != {"F0197", "F0198", "F0199", "F0200"}:
        raise ValueError("mixed-stage region packet scope invalid")
    rows: list[dict[str, str]] = []
    ids: set[str] = set()
    for item in sources:
        source_id = item["sourceFileId"]
        if (source_id in ids or item.get("sourceGateStatus") != "UNVERIFIED_REVIEW_ONLY"
                or not re.fullmatch(r"F[0-9]{4,}", source_id)
                or not re.fullmatch(r"[a-f0-9]{64}", item.get("sourceSha256", ""))):
            raise ValueError("source review item identity/status invalid")
        ids.add(source_id)
        region = region_by_id.get(source_id)
        if region and (region.get("sourceSha256") != item["sourceSha256"]
                       or region.get("status") != "REVIEW_ONLY_ABSTAIN"):
            raise ValueError("mixed-stage region source mismatch")
        labels = item["titleLabels"]
        values = {
            "reviewRank": item["reviewRank"], "sourceFileId": source_id,
            "objectId": item["objectId"], "manifestStage": item["manifestStage"],
            "manifestSection": item["manifestSection"], "priorityTier": item["priorityTier"],
            "titleStageHints": "; ".join(labels["stages"]),
            "titleSectionHints": "; ".join(labels["drawingSections"]),
            "titleAlignedCodes": "; ".join(item["titleAlignedCodeList"]),
            "regionRoleHints": "; ".join(hint["roleHint"] for hint in region["roleHints"]) if region else "",
            "conflictKinds": "; ".join(hint["kind"] for hint in item["conflictingTitleLabels"]),
            "sourceSha256": item["sourceSha256"],
            "sourceRelativePath": item["sourceRelativePath"],
            "reviewedRevision": "", "reviewedApproval": "", "reviewedSection": "",
            "evidenceReference": "",
        }
        rows.append({key: _csv_cell(values[key]) for key in FIELDS})
    if len(rows) != 103 or not set(region_by_id).issubset(ids):
        raise ValueError("source review packet missing mixed-stage sources")
    return sorted(rows, key=lambda row: int(row["reviewRank"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--source-sha256", default=SOURCE_PACKET_SHA256,
                        help="expected SHA-256 of the source review packet")
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows = build_rows(_load(args.sources, args.source_sha256),
                      _load(args.regions, REGION_PACKET_SHA256))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"reviewTasks": len(rows), "mixedRegionHints": sum(bool(row["regionRoleHints"])
                                                                  for row in rows)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
