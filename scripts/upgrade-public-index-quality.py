#!/usr/bin/env python3
"""Derive a v2-quality public index from the fully audited v1 snapshot."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import sqlite3
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_document_index import (  # noqa: E402
    _version_hash, _write_page, load_public_manifest, readonly_index_uri,
)
from inspector_worker.text_layer import (  # noqa: E402
    LEGACY_TEXT_QUALITY_POLICY_VERSION, TEXT_QUALITY_POLICY_VERSION,
    qualify_page_text,
)


MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
PARENT_AUDIT_SHA256 = "d4d04dccbbbaa2517d5b34a0b5cb0a54dde4dcc424d9b74ec4a6f5c4313ad8cc"
PARENT_VERSION_HASH = "5f599fc405acfbf9d858"
EXPECTED_SOURCE_COUNT = 203
EXPECTED_PDF_COUNT = 202
EXPECTED_PAGE_COUNT = 10142
MAX_PAGE_BYTES = 64 * 1024 * 1024


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validated_parent(manifest: Path, audit: Path) -> dict[str, dict]:
    if _sha(manifest.read_bytes()) != MANIFEST_SHA256:
        raise ValueError("public manifest differs from pinned SHA-256")
    raw = audit.read_bytes()
    if _sha(raw) != PARENT_AUDIT_SHA256:
        raise ValueError("parent audit differs from pinned SHA-256")
    value = json.loads(raw)
    if (value.get("status") != "PASS" or value.get("indexVersionHash") != PARENT_VERSION_HASH
            or value.get("manifestSha256") != MANIFEST_SHA256
            or value.get("actual", {}).get("sourceCount") != EXPECTED_SOURCE_COUNT
            or value.get("actual", {}).get("completePdfSources") != EXPECTED_PDF_COUNT
            or value.get("actual", {}).get("indexedPages") != EXPECTED_PAGE_COUNT
            or value.get("actual", {}).get("verifiedPageArtifacts") != EXPECTED_PAGE_COUNT):
        raise ValueError("parent audit does not prove expected public scope")
    rows = load_public_manifest(manifest)
    if len(rows) != EXPECTED_SOURCE_COUNT:
        raise ValueError("public manifest source count differs")
    return {row["file_id"]: row for row in rows}


def upgrade_page(page: dict, *, source_id: str, source_sha: str,
                 page_number: int) -> dict:
    if (page.get("schemaVersion") != "public-document-index-v1"
            or page.get("indexVersionHash") != PARENT_VERSION_HASH
            or page.get("qualityPolicyVersion") != LEGACY_TEXT_QUALITY_POLICY_VERSION
            or page.get("inputSha256") != source_sha
            or page.get("pageNumber") != page_number
            or not isinstance(page.get("blocks"), list)):
        raise ValueError(f"parent page identity invalid: {source_id} p{page_number}")
    blocks = page["blocks"]
    if not all(isinstance(block, dict) and isinstance(block.get("text"), str)
               for block in blocks):
        raise ValueError("parent page blocks invalid")
    block_texts = [block["text"] for block in blocks]
    if page.get("quality") != qualify_page_text(
            block_texts, policy_version=LEGACY_TEXT_QUALITY_POLICY_VERSION):
        raise ValueError("parent page legacy quality mismatches blocks")
    upgraded = dict(page)
    upgraded["indexVersionHash"] = _version_hash()
    upgraded["qualityPolicyVersion"] = TEXT_QUALITY_POLICY_VERSION
    upgraded["quality"] = qualify_page_text(block_texts)
    return upgraded


def upgrade_index(manifest: Path, parent: Path, audit: Path, output: Path) -> dict:
    by_id = _validated_parent(manifest, audit)
    if output.exists() or output.with_name(output.name + ".building").exists():
        raise ValueError("target index or staging directory already exists")
    building = output.with_name(output.name + ".building")
    building.mkdir(parents=True)
    parent_database = parent / "index.sqlite3"
    if not parent_database.is_file():
        raise ValueError("parent index.sqlite3 is missing")
    changed: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    with sqlite3.connect(readonly_index_uri(parent_database), uri=True) as source:
        source.row_factory = sqlite3.Row
        parent_version = source.execute("SELECT value FROM meta WHERE key='versionHash'").fetchone()
        total = source.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
        if not parent_version or parent_version[0] != PARENT_VERSION_HASH or total != EXPECTED_PAGE_COUNT:
            raise ValueError("parent DB version or page count differs from PASS audit")
        with sqlite3.connect(building / "index.sqlite3") as destination:
            source.backup(destination)
            destination.execute("PRAGMA foreign_keys=ON")
            destination.execute("UPDATE meta SET value=? WHERE key='versionHash'", (_version_hash(),))
            for record in source.execute(
                    "SELECT source_id,page_number,source_sha256,disposition,"
                    "artifact_path,artifact_sha256 FROM pages ORDER BY source_id,page_number"):
                source_id, number = record["source_id"], record["page_number"]
                row = by_id.get(source_id)
                if (row is None or row["extension"] != ".pdf"
                        or row["sha256"] != record["source_sha256"]):
                    raise ValueError("parent page outside public manifest or SHA differs")
                path = (parent / record["artifact_path"]).resolve()
                if not path.is_relative_to(parent.resolve()) or not path.is_file():
                    raise ValueError("parent page path unsafe or missing")
                if path.stat().st_size > MAX_PAGE_BYTES:
                    raise ValueError("parent compressed page exceeds limit")
                raw = path.read_bytes()
                if _sha(raw) != record["artifact_sha256"]:
                    raise ValueError("parent page compressed SHA differs")
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
                    page_bytes = compressed.read(MAX_PAGE_BYTES + 1)
                if len(page_bytes) > MAX_PAGE_BYTES:
                    raise ValueError("parent page exceeds decompressed limit")
                page = upgrade_page(json.loads(page_bytes), source_id=source_id,
                                    source_sha=row["sha256"], page_number=number)
                relative, digest = _write_page(building, page)
                new_disposition = page["quality"]["disposition"]
                destination.execute(
                    "UPDATE pages SET disposition=?,artifact_path=?,artifact_sha256=? "
                    "WHERE source_id=? AND page_number=?",
                    (new_disposition, relative, digest, source_id, number))
                counts[new_disposition] += 1
                if new_disposition != record["disposition"]:
                    changed.append({"sourceFileId": source_id, "pageNumber": number,
                                    "from": record["disposition"], "to": new_disposition,
                                    "reasonCodes": page["quality"]["reasonCodes"]})
            for source_id, text_count, ocr_count in destination.execute(
                    "SELECT source_id,"
                    "SUM(CASE WHEN disposition='TEXT_LAYER_CANDIDATE' THEN 1 ELSE 0 END),"
                    "SUM(CASE WHEN disposition='OCR_REQUIRED' THEN 1 ELSE 0 END) "
                    "FROM pages GROUP BY source_id").fetchall():
                destination.execute(
                    "UPDATE sources SET text_candidate_pages=?,ocr_required_pages=? WHERE source_id=?",
                    (text_count, ocr_count, source_id))
            destination.commit()
            destination.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    if sum(counts.values()) != EXPECTED_PAGE_COUNT:
        raise ValueError("derived page count differs")
    report = {"schemaVersion": "public-index-quality-upgrade-v1",
              "disposition": "DERIVED_INDEX_REQUIRES_INDEPENDENT_AUDIT",
              "manifestSha256": MANIFEST_SHA256, "parentAuditSha256": PARENT_AUDIT_SHA256,
              "parentIndexVersionHash": PARENT_VERSION_HASH,
              "indexVersionHash": _version_hash(),
              "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
              "pageCount": sum(counts.values()), "dispositions": dict(sorted(counts.items())),
              "changedPageCount": len(changed), "changedPages": changed,
              "findingCount": None, "parameterCoverage": None}
    (building / "derivation.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.replace(building, output)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--parent-index", type=Path, required=True)
    parser.add_argument("--parent-audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = upgrade_index(args.manifest, args.parent_index,
                               args.parent_audit, args.output)
    except (OSError, ValueError, sqlite3.Error, json.JSONDecodeError) as error:
        print(f"public index quality upgrade failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"indexVersionHash": report["indexVersionHash"],
                      "pageCount": report["pageCount"],
                      "changedPageCount": report["changedPageCount"],
                      "dispositions": report["dispositions"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
