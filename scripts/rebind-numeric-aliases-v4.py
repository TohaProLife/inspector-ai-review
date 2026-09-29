#!/usr/bin/env python3
"""Rebind four reviewed literal lines to a newly audited public index."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.numeric_family_candidates import load_numeric_family_labels  # noqa: E402
from inspector_worker.public_document_index import (  # noqa: E402
    _version_hash, get_indexed_page, load_public_manifest, readonly_index_uri,
)
from inspector_worker.public_ocr_cache import verified_public_pdf  # noqa: E402


MANIFEST_SHA = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
PARENT_AUDIT_SHA = "d4d04dccbbbaa2517d5b34a0b5cb0a54dde4dcc424d9b74ec4a6f5c4313ad8cc"


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def rebind(manifest: Path, parent: Path, parent_audit: Path, index: Path,
           audit: Path, archive: Path, old_pack: Path, output: Path,
           receipt: Path, scratch: Path) -> dict:
    if output.exists() or receipt.exists():
        raise ValueError("output pack and receipt paths must be new")
    if sha(manifest.read_bytes()) != MANIFEST_SHA or sha(parent_audit.read_bytes()) != PARENT_AUDIT_SHA:
        raise ValueError("public manifest or parent audit SHA differs")
    current_audit_raw = audit.read_bytes()
    current_audit = json.loads(current_audit_raw)
    if (current_audit.get("status") != "PASS"
            or current_audit.get("manifestSha256") != MANIFEST_SHA
            or current_audit.get("indexVersionHash") != _version_hash()
            or current_audit.get("findingCount") != 0
            or current_audit.get("actual", {}).get("verifiedPageArtifacts") != 10142):
        raise ValueError("current public index is not fully audited")
    original = load_numeric_family_labels(old_pack)
    if (original["schemaVersion"], original["version"]) != ("numeric-family-labels-v1", "1"):
        raise ValueError("input label pack is not historical v1")
    rows = {row["file_id"]: row for row in load_public_manifest(manifest)}
    pack = json.loads(old_pack.read_text(encoding="utf-8"))
    samples = [sample for alias in pack["verifiedAliasEvidence"] for sample in alias["samples"]]
    if len(samples) != 4:
        raise ValueError("expected exactly four original reviewed alias samples")
    sources = {sample["sourceFileId"] for sample in samples}
    if len(sources) != 4:
        raise ValueError("expected four original PDF sources")
    for source_id in sorted(sources):
        row = rows.get(source_id)
        if row is None or row["extension"] != ".pdf":
            raise ValueError("alias source is not an allowed public PDF")
        with verified_public_pdf(row, pdf_path=None, archive_path=archive,
                                 scratch_root=scratch):
            pass
    changes = []
    with sqlite3.connect(readonly_index_uri(parent / "index.sqlite3"), uri=True) as old_db, \
         sqlite3.connect(readonly_index_uri(index / "index.sqlite3"), uri=True) as new_db:
        for sample in samples:
            source_id, number = sample["sourceFileId"], sample["pageNumber"]
            row = rows[source_id]
            if (sample["sourceSha256"] != row["sha256"]
                    or sample["stage"] != row["stage"]
                    or sample["manifestSection"] != row["section"]
                    or sha(sample["lineText"].encode("utf-8")) != sample["lineTextSha256"]):
                raise ValueError("original alias identity or literal text differs")
            old_record = old_db.execute(
                "SELECT artifact_sha256 FROM pages WHERE source_id=? AND page_number=?",
                (source_id, number)).fetchone()
            new_record = new_db.execute(
                "SELECT artifact_sha256,disposition FROM pages WHERE source_id=? AND page_number=?",
                (source_id, number)).fetchone()
            if (old_record is None or old_record[0] != sample["pageArtifactSha256"]
                    or new_record is None or new_record[1] != "TEXT_LAYER_CANDIDATE"):
                raise ValueError("alias page SHA or readability differs from audited indexes")
            indexed = get_indexed_page(index, source_id, number)
            if (indexed["source"]["source_sha256"] != row["sha256"]
                    or indexed["page"]["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"):
                raise ValueError("alias page artifact differs from original PDF identity")
            lines = [line for line in indexed["page"]["lines"]
                     if line["blockIndex"] == sample["blockIndex"]
                     and line["lineIndex"] == sample["lineIndex"]]
            if len(lines) != 1 or lines[0]["text"] != sample["lineText"]:
                raise ValueError("reviewed literal line changed in current index")
            changes.append({"sourceFileId": source_id, "pageNumber": number,
                            "oldPageArtifactSha256": old_record[0],
                            "newPageArtifactSha256": new_record[0],
                            "lineTextSha256": sample["lineTextSha256"]})
            sample["pageArtifactSha256"] = new_record[0]
    pack["schemaVersion"] = "numeric-family-labels-v2"
    pack["version"] = "2"
    raw = (json.dumps(pack, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix=output.name + ".",
                                     suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(raw)
    try:
        validated = load_numeric_family_labels(temporary)
        os.chmod(temporary, 0o644)
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    result = {"schemaVersion": "numeric-alias-rebind-v1", "disposition": "REVIEW_ONLY",
              "manifestSha256": MANIFEST_SHA, "parentAuditSha256": PARENT_AUDIT_SHA,
              "currentAuditSha256": sha(current_audit_raw),
              "currentIndexVersionHash": _version_hash(),
              "oldLabelPackSha256": original["labelPackSha256"],
              "newLabelPackSha256": validated["labelPackSha256"],
              "newLabelFileSha256": sha(raw), "sourceCount": len(sources),
              "sampleCount": len(changes), "samples": changes,
              "findingCount": None, "parameterCoverage": None}
    receipt.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True,
                                  indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("manifest", "parent-index", "parent-audit", "index", "audit",
                "archive", "old-pack", "output", "receipt", "scratch"):
        parser.add_argument("--" + key, type=Path, required=True)
    args = parser.parse_args()
    try:
        result = rebind(args.manifest, args.parent_index, args.parent_audit,
                        args.index, args.audit, args.archive, args.old_pack,
                        args.output, args.receipt, args.scratch)
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        print(f"numeric alias rebind failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({key: result[key] for key in (
        "sourceCount", "sampleCount", "newLabelPackSha256", "currentIndexVersionHash")},
        ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
