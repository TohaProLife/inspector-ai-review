"""SHA-pinned, review-only height mentions for AR-042 in public PD/AR PDFs.

No mention is a measured evacuation path or door height without a verified
element, drawing context, revision, applicable norm, and comparable RD source.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Any

SCHEMA = "ar-evacuation-height-review-v1"
SOURCE_IDS = ("F0104", "F0156", "F0157")
INDEX_VERSION = "7d7dfa2f3e0279a91095"
MANIFEST_SHA = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
AUDIT_SHA = "69ef56fc23e779dfed25aa60c5615be3ee58f244200c6620c2b1ddaec335f49a"
HEIGHT = re.compile(r"высот\w*", re.I)
TARGET = re.compile(r"коридор\w*|про[её]м\w*|двер\w*", re.I)
MEASURE = re.compile(r"(?<![\w\d])(\d+(?:[.,]\d+)?)\s*(мм|м)(?![\w])", re.I)
EXCLUSIONS = (
    ("LIFT_DOOR_CONTEXT", re.compile(r"лифт\w*", re.I)),
    ("WINDOW_CONTEXT", re.compile(r"окон\w*|окн\w*|подокон\w*", re.I)),
    ("THRESHOLD_OR_LEVEL_CONTEXT", re.compile(r"порог\w*|перепад\w*", re.I)),
    ("IMPACT_STRIP_CONTEXT", re.compile(r"полос\w*|остекл\w*", re.I)),
)
RENDERER = "renderer-pdfium-5.12.1-linux-x86_64-v1"
PROVIDER = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1"


class HeightReviewError(ValueError):
    """An input or its provenance differs from pinned public corpus."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def classify_height_line(text: str) -> tuple[str, list[str]] | None:
    """Return lexical context and raw dimensions, never a typed fact."""
    if not HEIGHT.search(text) or not TARGET.search(text):
        return None
    measurements = [match.group().strip() for match in MEASURE.finditer(text)]
    for label, pattern in EXCLUSIONS:
        if pattern.search(text):
            return label, measurements
    if re.search(r"локальн\w*\s+про[её]м\w*", text, re.I):
        return "LOCAL_OPENING_UNLINKED", measurements
    if re.search(r"эвакуац\w*", text, re.I):
        return "EVACUATION_CONTEXT_UNLINKED", measurements
    return "ELEMENT_CONTEXT_UNVERIFIED", measurements


def _member_name(info: zipfile.ZipInfo) -> str:
    return info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866")


def verify_originals(archive_path: Path, selected: dict[str, dict[str, Any]]) -> None:
    if len({row["relative_path"] for row in selected.values()}) != len(selected):
        raise HeightReviewError("ambiguous original PDF paths")
    with zipfile.ZipFile(archive_path) as archive:
        found: dict[str, zipfile.ZipInfo] = {}
        prefixes: set[str] = set()
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = _member_name(info)
            for source_id, row in selected.items():
                rel = row["relative_path"]
                if name == rel or name.endswith("/" + rel):
                    if source_id in found:
                        raise HeightReviewError(f"duplicate original PDF: {source_id}")
                    found[source_id] = info
                    prefixes.add(name[:-(len(rel) + 1)] if name != rel else "")
        if set(found) != set(selected) or len(prefixes) != 1:
            raise HeightReviewError("public original PDF selection incomplete or ambiguous")
        for source_id, info in found.items():
            row = selected[source_id]
            digest = hashlib.sha256()
            size = 0
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(chunk)
                    digest.update(chunk)
            if size != row["size_bytes"] or digest.hexdigest() != row["sha256"]:
                raise HeightReviewError(f"original PDF SHA mismatch: {source_id}")


def _page(index_root: Path, record: sqlite3.Row, source_sha: str) -> dict[str, Any]:
    path = (index_root / record["artifact_path"]).resolve()
    if not path.is_relative_to(index_root.resolve()) or not path.is_file():
        raise HeightReviewError("unsafe or missing indexed page")
    data = path.read_bytes()
    if _sha(data) != record["artifact_sha256"]:
        raise HeightReviewError("indexed page SHA mismatch")
    try:
        page = json.loads(gzip.decompress(data))
    except (OSError, ValueError) as error:
        raise HeightReviewError("indexed page invalid") from error
    if (page.get("indexVersionHash") != INDEX_VERSION or page.get("inputSha256") != source_sha
            or page.get("pageNumber") != record["page_number"]
            or page.get("quality", {}).get("disposition") != record["disposition"]
            or not isinstance(page.get("lines"), list)):
        raise HeightReviewError("indexed page provenance mismatch")
    return page


def _valid_line_geometry(line: dict[str, Any], page: dict[str, Any]) -> bool:
    box = line.get("bboxMilliPoints")
    return (isinstance(box, list) and len(box) == 4 and all(isinstance(n, int) for n in box)
            and 0 <= box[0] < box[2] <= page["widthMilliPoints"]
            and 0 <= box[1] < box[3] <= page["heightMilliPoints"])


def select_ocr_dpi(page: dict[str, Any]) -> int:
    """Keep renderer below 20 million pixels on large drawing sheets."""
    width = page["widthMilliPoints"] / 1000
    height = page["heightMilliPoints"] / 1000
    if width <= 0 or height <= 0:
        raise HeightReviewError("invalid indexed page dimensions")
    dpi = min(120, math.floor(72 * math.sqrt(20_000_000 / (width * height))))
    if dpi < 72:
        raise HeightReviewError("OCR page too large for bounded renderer")
    return dpi


def review_ocr_lines(artifact: dict[str, Any]) -> list[dict[str, Any]]:
    """OCR exact-line lexical leads; adjacent lines and visual geometry remain unproven."""
    leads = []
    for index, line in enumerate(artifact["lines"]):
        classified = classify_height_line(line["text"])
        if classified is None:
            continue
        context, measurements = classified
        leads.append({"ocrLineIndex": index, "rawText": line["text"],
                      "lineSha256": _sha(line["text"].encode("utf-8")),
                      "bboxPx": line["bboxPx"], "score": line["score"],
                      "rawMeasurements": measurements, "contextClass": context,
                      "reviewStatus": "REVIEW_ONLY_ABSTAIN", "typedFact": None})
    return leads


def _write_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False) + "\n").encode("utf-8")
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.",
                                     suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run_targeted_ocr(manifest_path: Path, index_root: Path, audit_path: Path,
                     archive_path: Path, cache_root: Path, progress_root: Path,
                     base_url: str = "http://127.0.0.1:18084") -> dict[str, Any]:
    """OCR exactly unknown AR-042 pages using public source/page/profile SHA cache."""
    from inspector_worker.ocr_pilot import _post_file
    from inspector_worker.public_document_index import readonly_index_uri
    from inspector_worker.public_ocr_cache import (
        cached_public_ocr_page, public_manifest_entry, verified_public_pdf,
    )

    base = evaluate_height_review(manifest_path, index_root, audit_path, archive_path)
    unknown = base["ocrRequiredUnknownPages"]
    by_source: dict[str, list[dict[str, Any]]] = {}
    for item in unknown:
        by_source.setdefault(item["sourceFileId"], []).append(item)
    receipts: list[dict[str, Any]] = []
    with sqlite3.connect(readonly_index_uri(index_root / "index.sqlite3"), uri=True) as connection:
        connection.row_factory = sqlite3.Row
        for source_id, selected_pages in sorted(by_source.items()):
            row = public_manifest_entry(manifest_path, source_id)
            if source_id not in SOURCE_IDS or row["stage"] != "PD" or row["section"] != "AR":
                raise HeightReviewError("OCR source outside pinned PD/AR scope")
            with verified_public_pdf(row, pdf_path=None, archive_path=archive_path,
                                     scratch_root=cache_root) as pdf:
                for selected in selected_pages:
                    number = selected["pageNumber"]
                    record = connection.execute(
                        "SELECT * FROM pages WHERE source_id=? AND page_number=?",
                        (source_id, number)).fetchone()
                    if record is None or record["artifact_sha256"] != selected["pageArtifactSha256"] \
                            or record["disposition"] != "OCR_REQUIRED":
                        raise HeightReviewError("targeted OCR page index changed")
                    indexed_page = _page(index_root, record, row["sha256"])
                    dpi = select_ocr_dpi(indexed_page)
                    result = cached_public_ocr_page(
                        manifest_path=manifest_path, source_id=source_id, page_number=number,
                        pdf_path=pdf, cache_root=cache_root, base_url=base_url,
                        dpi=dpi, script="eslav", renderer_profile_id=RENDERER,
                        provider_profile_id=PROVIDER, index_path=index_root / "index.sqlite3")
                    if (result["sourceSha256"] != row["sha256"]
                            or result["indexDisposition"] != "OCR_REQUIRED"
                            or result["cacheStatus"] not in {"HIT", "MISS_WRITTEN"}):
                        raise HeightReviewError("OCR result provenance mismatch")
                    artifact = result["artifact"]
                    # Independent second render of exact original PDF/page verifies
                    # cache artifact pixel SHA, including on an old cache HIT.
                    png, headers = _post_file(base_url.rstrip("/") + "/v1/render",
                                              {"page": str(number), "dpi": str(dpi)},
                                              pdf.name, pdf.read_bytes(), "application/pdf",
                                              timeout=360, max_response_bytes=40_000_000)
                    if (_sha(png) != artifact["render"]["sha256"]
                            or headers.get("x-renderer-profile") != RENDERER
                            or headers.get("x-render-dpi") != str(dpi)
                            or headers.get("x-source-page-count") != str(row["pdf_pages"])):
                        raise HeightReviewError("independent original PDF render SHA mismatch")
                    leads = review_ocr_lines(artifact)
                    receipt = {"schemaVersion": "ar-evacuation-height-ocr-page-v1",
                               "sourceFileId": source_id, "objectId": row["object_id"],
                               "sourceSha256": row["sha256"], "pageNumber": number,
                               "pageArtifactSha256": selected["pageArtifactSha256"],
                               "dpi": dpi, "rendererProfileId": RENDERER,
                               "providerProfileId": PROVIDER,
                               "cacheStatus": result["cacheStatus"], "cacheKey": result["cacheKey"],
                               "cacheFileSha256": _sha(Path(result["cachePath"]).read_bytes()),
                               "ocrArtifactContentHash": result["artifactContentHash"],
                               "renderArtifactSha256": artifact["render"]["sha256"],
                               "originalPdfRenderShaVerified": True,
                               "ocrLineCount": result["lineCount"], "leadCount": len(leads),
                               "leads": leads, "reviewStatus": "REVIEW_ONLY_ABSTAIN",
                               "findingCount": None, "parameterCoverage": None}
                    _write_atomic(progress_root / f"{source_id}-p{number}.json", receipt)
                    receipts.append(receipt)
                    print(json.dumps({"sourceFileId": source_id, "pageNumber": number,
                                      "cacheStatus": result["cacheStatus"],
                                      "lineCount": result["lineCount"], "leadCount": len(leads)}),
                          flush=True)
    if len(receipts) != len(unknown):
        raise HeightReviewError("targeted OCR page inventory incomplete")
    return {"schemaVersion": "ar-evacuation-height-ocr-batch-v1",
            "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "parameterCode": "AR-042", "manifestSha256": MANIFEST_SHA,
            "auditSha256": AUDIT_SHA, "indexVersionHash": INDEX_VERSION,
            "textReviewSourceCount": len(base["sources"]),
            "textReviewPageCount": sum(x["pages"] for x in base["sources"]),
            "textReviewObservationCount": len(base["observations"]),
            "selectedOcrRequiredPageCount": len(unknown),
            "processedOcrPageCount": len(receipts),
            "cacheHits": sum(item["cacheStatus"] == "HIT" for item in receipts),
            "cacheMissesWritten": sum(item["cacheStatus"] == "MISS_WRITTEN" for item in receipts),
            "ocrLineCount": sum(item["ocrLineCount"] for item in receipts),
            "ocrLexicalLeadCount": sum(item["leadCount"] for item in receipts),
            "receipts": receipts, "evaluation": {"status": "ABSTAIN",
            "reasonCodes": ["NO_VERIFIED_RD_AR_SOURCE", "EVACUATION_ELEMENT_IDENTITY_UNVERIFIED",
                            "REVISION_UNVERIFIED", "APPROVAL_UNVERIFIED",
                            "OCR_TEXT_AND_GEOMETRY_UNCONFIRMED"],
            "comparableFacts": [], "finding": None,
            "findingCount": None, "parameterCoverage": None}}


def audit_targeted_ocr_report(manifest_path: Path, index_root: Path, audit_path: Path,
                              archive_path: Path, cache_root: Path, progress_root: Path,
                              report_path: Path) -> dict[str, Any]:
    """Recheck original PDF/index, exact page receipts, and cached OCR bytes."""
    from inspector_worker.ocr_pilot import canonical_hash
    from inspector_worker.public_ocr_cache import (
        _cache_request, _load_json, _validate_cache, public_manifest_entry,
    )

    base = evaluate_height_review(manifest_path, index_root, audit_path, archive_path)
    report_raw = report_path.read_bytes()
    report = _load_json(report_raw)
    selected = {(item["sourceFileId"], item["pageNumber"]): item
                for item in base["ocrRequiredUnknownPages"]}
    receipts = report.get("receipts")
    if (report.get("schemaVersion") != "ar-evacuation-height-ocr-batch-v1"
            or report.get("parameterCode") != "AR-042"
            or report.get("manifestSha256") != MANIFEST_SHA
            or report.get("auditSha256") != AUDIT_SHA
            or report.get("indexVersionHash") != INDEX_VERSION
            or report.get("textReviewPageCount") != 125
            or report.get("textReviewObservationCount") != len(base["observations"])
            or not isinstance(receipts, list) or len(receipts) != len(selected)
            or report.get("selectedOcrRequiredPageCount") != len(selected)
            or report.get("processedOcrPageCount") != len(selected)
            or report.get("evaluation", {}).get("status") != "ABSTAIN"
            or report["evaluation"].get("findingCount") is not None
            or report["evaluation"].get("parameterCoverage") is not None):
        raise HeightReviewError("AR OCR report scope or totals invalid")
    receipt_hashes: dict[str, str] = {}
    cache_hashes: dict[str, str] = {}
    seen: set[tuple[str, int]] = set()
    hits = misses = line_count = lead_count = 0
    for receipt in receipts:
        key = (receipt.get("sourceFileId"), receipt.get("pageNumber"))
        selected_page = selected.get(key)
        if selected_page is None or key in seen:
            raise HeightReviewError("OCR receipt page outside selected inventory or repeated")
        seen.add(key)
        source_id, number = key
        row = public_manifest_entry(manifest_path, source_id)
        path = progress_root / f"{source_id}-p{number}.json"
        if path.is_symlink() or not path.is_file():
            raise HeightReviewError("OCR page receipt missing or symlinked")
        raw_receipt = path.read_bytes()
        if _load_json(raw_receipt) != receipt:
            raise HeightReviewError("OCR page receipt differs from batch report")
        if (receipt.get("sourceSha256") != row["sha256"]
                or receipt.get("pageArtifactSha256") != selected_page["pageArtifactSha256"]
                or receipt.get("reviewStatus") != "REVIEW_ONLY_ABSTAIN"
                or receipt.get("findingCount") is not None
                or receipt.get("parameterCoverage") is not None
                or receipt.get("originalPdfRenderShaVerified") is not True
                or receipt.get("rendererProfileId") != RENDERER
                or receipt.get("providerProfileId") != PROVIDER):
            raise HeightReviewError("OCR receipt provenance or abstain gate invalid")
        request = _cache_request(row, number, receipt["dpi"], "eslav", RENDERER, PROVIDER)
        cache_key = canonical_hash(request)
        cache_path = cache_root / cache_key[:2] / cache_key[2:4] / f"{cache_key}.json"
        if receipt.get("cacheKey") != cache_key or cache_path.is_symlink() or not cache_path.is_file():
            raise HeightReviewError("OCR cache key or file invalid")
        raw_cache = cache_path.read_bytes()
        artifact = _validate_cache(_load_json(raw_cache), request)
        leads = review_ocr_lines(artifact)
        if (receipt.get("cacheFileSha256") != _sha(raw_cache)
                or receipt.get("ocrArtifactContentHash") != artifact["contentHash"]
                or receipt.get("renderArtifactSha256") != artifact["render"]["sha256"]
                or receipt.get("ocrLineCount") != len(artifact["lines"])
                or receipt.get("leadCount") != len(leads) or receipt.get("leads") != leads
                or receipt.get("cacheStatus") not in {"HIT", "MISS_WRITTEN"}):
            raise HeightReviewError("OCR receipt differs from verified cache artifact")
        name = f"{source_id}-p{number}"
        receipt_hashes[name] = _sha(raw_receipt)
        cache_hashes[name] = _sha(raw_cache)
        hits += receipt["cacheStatus"] == "HIT"
        misses += receipt["cacheStatus"] == "MISS_WRITTEN"
        line_count += len(artifact["lines"])
        lead_count += len(leads)
    if ({(receipt["sourceFileId"], receipt["pageNumber"]) for receipt in receipts} != set(selected)
            or report.get("cacheHits") != hits
            or report.get("cacheMissesWritten") != misses
            or report.get("ocrLineCount") != line_count
            or report.get("ocrLexicalLeadCount") != lead_count):
        raise HeightReviewError("AR OCR batch counts differ from audited receipts")
    return {"schemaVersion": "ar-evacuation-height-ocr-audit-v1",
            "status": "PASS", "reportSha256": _sha(report_raw),
            "selectedOcrRequiredPages": len(selected),
            "verifiedReceiptCount": len(receipt_hashes),
            "verifiedCacheCount": len(cache_hashes),
            "cacheHitsInFirstPass": hits, "cacheMissesInFirstPass": misses,
            "ocrLineCount": line_count, "ocrLexicalLeadCount": lead_count,
            "receiptSha256": receipt_hashes, "cacheFileSha256": cache_hashes,
            "findingCount": None, "parameterCoverage": None}


def evaluate_height_review(manifest_path: Path, index_root: Path, audit_path: Path,
                           archive_path: Path) -> dict[str, Any]:
    from inspector_worker.public_document_index import readonly_index_uri
    manifest_bytes, audit_bytes = manifest_path.read_bytes(), audit_path.read_bytes()
    if _sha(manifest_bytes) != MANIFEST_SHA or _sha(audit_bytes) != AUDIT_SHA:
        raise HeightReviewError("public manifest/audit SHA mismatch")
    manifest = [json.loads(line) for line in manifest_bytes.splitlines()
                if b'"TRAIN_PUBLIC"' in line and b'"INCLUDE"' in line
                and b'"PUBLIC_TRAIN"' in line]
    audit = json.loads(audit_bytes)
    if (len(manifest) != 203 or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != MANIFEST_SHA
            or audit.get("indexVersionHash") != INDEX_VERSION
            or audit.get("findingCount") != 0 or audit.get("fatalFindingCount") != 0
            or audit.get("actual", {}).get("verifiedPageArtifacts") != 10142):
        raise HeightReviewError("public index audit gate failed")
    by_id = {row["file_id"]: row for row in manifest}
    if len(by_id) != 203 or not set(SOURCE_IDS).issubset(by_id):
        raise HeightReviewError("public source inventory invalid")
    selected = {source_id: by_id[source_id] for source_id in SOURCE_IDS}
    for source_id, row in selected.items():
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility"),
                row.get("extension"), row.get("stage"), row.get("section")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", ".pdf", "PD", "AR"):
            raise HeightReviewError(f"source outside exact public PD/AR scope: {source_id}")
    verify_originals(archive_path, selected)
    observations: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    with sqlite3.connect(readonly_index_uri(index_root / "index.sqlite3"), uri=True) as connection:
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": INDEX_VERSION}:
            raise HeightReviewError("public index version mismatch")
        for source_id, manifest_row in selected.items():
            source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            if source is None or source["status"] != "COMPLETE" or any(
                    source[column] != manifest_row[key] for column, key in (
                        ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                        ("expected_pages", "pdf_pages"), ("observed_pages", "pdf_pages"),
                        ("object_id", "object_id"), ("stage", "stage"),
                        ("section", "section"), ("relative_path", "relative_path"))):
                raise HeightReviewError(f"indexed source differs from public manifest: {source_id}")
            pages = connection.execute("SELECT * FROM pages WHERE source_id=? ORDER BY page_number",
                                       (source_id,)).fetchall()
            if len(pages) != manifest_row["pdf_pages"] or [p["page_number"] for p in pages] != list(range(1, len(pages) + 1)):
                raise HeightReviewError(f"incomplete page inventory: {source_id}")
            text_pages = 0
            ocr_pages = 0
            for record in pages:
                if record["source_sha256"] != manifest_row["sha256"]:
                    raise HeightReviewError("page source SHA mismatch")
                page = _page(index_root, record, manifest_row["sha256"])
                if record["disposition"] == "OCR_REQUIRED":
                    ocr_pages += 1
                    unknown.append({"sourceFileId": source_id, "pageNumber": record["page_number"],
                                    "pageArtifactSha256": record["artifact_sha256"],
                                    "status": "OCR_REQUIRED_UNKNOWN"})
                    continue
                if record["disposition"] != "TEXT_LAYER_CANDIDATE":
                    raise HeightReviewError("unknown read-quality disposition")
                text_pages += 1
                for global_index, line in enumerate(page["lines"]):
                    raw = line.get("text")
                    if not isinstance(raw, str):
                        raise HeightReviewError("invalid indexed line text")
                    classified = classify_height_line(raw)
                    if classified is None:
                        continue
                    if not _valid_line_geometry(line, page):
                        raise HeightReviewError("candidate line has invalid geometry")
                    context, measurements = classified
                    observations.append({
                        "parameterCode": "AR-042", "sourceFileId": source_id,
                        "objectId": manifest_row["object_id"], "stage": "PD", "section": "AR",
                        "sourceRelativePath": manifest_row["relative_path"],
                        "sourceSha256": manifest_row["sha256"], "pageNumber": record["page_number"],
                        "pageArtifactSha256": record["artifact_sha256"],
                        "rawText": raw, "lineSha256": _sha(raw.encode("utf-8")),
                        "locator": {"globalLineIndex": global_index, "blockIndex": line["blockIndex"],
                                    "lineIndex": line["lineIndex"], "bboxMilliPoints": line["bboxMilliPoints"]},
                        "rawMeasurements": measurements, "contextClass": context,
                        "reviewStatus": "REVIEW_ONLY_ABSTAIN", "typedFact": None,
                    })
            sources.append({"sourceFileId": source_id, "objectId": manifest_row["object_id"],
                            "stage": "PD", "section": "AR", "sourceSha256": manifest_row["sha256"],
                            "pages": len(pages), "textLayerPages": text_pages,
                            "ocrRequiredPages": ocr_pages})
    return {"schemaVersion": SCHEMA, "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "purpose": "REVIEW_ONLY", "manifestSha256": MANIFEST_SHA,
            "auditSha256": AUDIT_SHA, "indexVersionHash": INDEX_VERSION,
            "parameterCode": "AR-042", "sources": sources,
            "observations": observations, "ocrRequiredUnknownPages": unknown,
            "evaluation": {"status": "ABSTAIN", "reasonCodes": ["NO_VERIFIED_RD_AR_SOURCE",
                            "EVACUATION_ELEMENT_IDENTITY_UNVERIFIED", "REVISION_UNVERIFIED",
                            "APPROVAL_UNVERIFIED", "OCR_PAGES_UNASSESSED"],
                           "comparableFacts": [], "finding": None,
                           "findingCount": None, "parameterCoverage": None}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "index", "audit", "archive"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--targeted-ocr", action="store_true")
    parser.add_argument("--audit-ocr-report", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--progress", type=Path)
    parser.add_argument("--ocr-output", type=Path)
    parser.add_argument("--ocr-audit-output", type=Path)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084")
    args = parser.parse_args()
    if args.targeted_ocr and args.audit_ocr_report is not None:
        parser.error("choose OCR run or OCR audit")
    if args.audit_ocr_report is not None:
        if args.cache is None or args.progress is None or args.ocr_audit_output is None:
            parser.error("--audit-ocr-report requires --cache, --progress, and --ocr-audit-output")
        result = audit_targeted_ocr_report(args.manifest, args.index, args.audit,
                                           args.archive, args.cache, args.progress,
                                           args.audit_ocr_report)
        _write_atomic(args.ocr_audit_output, result)
        print(json.dumps({"status": result["status"],
                          "verifiedReceiptCount": result["verifiedReceiptCount"],
                          "verifiedCacheCount": result["verifiedCacheCount"]}))
        return
    if args.targeted_ocr:
        if args.cache is None or args.progress is None or args.ocr_output is None:
            parser.error("--targeted-ocr requires --cache, --progress, and --ocr-output")
        result = run_targeted_ocr(args.manifest, args.index, args.audit, args.archive,
                                  args.cache, args.progress, args.ocr_url)
        _write_atomic(args.ocr_output, result)
        print(json.dumps({"processedOcrPageCount": result["processedOcrPageCount"],
                          "cacheHits": result["cacheHits"],
                          "cacheMissesWritten": result["cacheMissesWritten"],
                          "ocrLineCount": result["ocrLineCount"],
                          "ocrLexicalLeadCount": result["ocrLexicalLeadCount"]}))
        return
    else:
        result = evaluate_height_review(args.manifest, args.index, args.audit, args.archive)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
