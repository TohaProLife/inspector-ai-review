"""SHA-checked, review-only pipe material observations from public index v4.

The text layer may contain several networks and pipe types on one page. Each
field below is a literal span from one indexed line; neighboring lines are
retained for review but never silently joined into an engineering fact.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
import struct
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

SCHEMA = "pipe-material-review-v1"
INDEX_VERSION = "7d7dfa2f3e0279a91095"
MANIFEST_SHA = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
AUDIT_SHA = "69ef56fc23e779dfed25aa60c5615be3ee58f244200c6620c2b1ddaec335f49a"
SOURCE_IDS = ("F0163", "F0164", "F0165", "F0166", "F0167", "F0168", "F0169", "F0204")
BASE_REPORT_SHA = "47cadc17d776b7df4b3832345108a71842a3cb3c29de0306238882027bcfff2b"
F0204_CACHE_KEY = "fed4fe81394b9656be80fea03b25a1ec426e5bc31d18a1cf730d2fc6cf7b53b7"
F0204_CACHE_SHA = "cd4b0010578493688ce9a5c036ddc1d3c34b70f42e514607a682325453623c0d"
F0204_REPLAY_RECEIPT_SHA = "3893d6dfd955d2b0fbb7ea43a9e8e78724873d372cf0d8a8744a8e2ae0e2f17c"
F0204_RENDER_SHA = "4ee8449a25a036c2c79ed0ada650b471492da51fce27a03dd56c5ca81216f0d3"
F0204_OCR_ARTIFACT_HASH = "1a3ca99ebd1abea8ff3e401d889b3953e8c105e1d321190344899b69d7829838"
F0204_PAGE_ARTIFACT_SHA = "ad0a12dc21cb717ecf555433445d8bf20b2d6949b8c6af2b1da8125b8a5d3143"
F0204_SOURCE_SHA = "6b15a5deecb14bd62c3622990614a76a95a1b9bace90d07bcda9cbd6b0079767"
MATERIAL = re.compile(
    r"\b(?:полипропилен\w*|полиэтилен\w*|сшит\w*\s+полиэтилен\w*|"
    r"оцинкован\w*|чугун\w*|ВЧШГ|НПВХ|ПВХ|PVC|PE-?X|стальн\w*|"
    r"нержавеющ\w*|медн\w*)\b", re.I)
NETWORK = re.compile(
    r"\b(?:водоснабжен\w*|водопровод\w*|канализац\w*|водоотведен\w*|"
    r"внутренн\w*\s+водосток\w*|В[1-9]|К[1-9]|Т[1-9]|ГВС|ХВС)\b", re.I)
PRESSURE_CLASS = re.compile(r"\b(?:PN\s*\d+(?:[.,]\d+)?|Ру\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*МПа)\b", re.I)
PIPE_TYPE = re.compile(r"\b(?:напорн\w*|безнапорн\w*|малошумн\w*|тонкостенн\w*|армированн\w*)\b", re.I)
PIPE_NOUN = re.compile(r"\b(?:труб\w*|трубопровод\w*)\b", re.I)
OCR_CORRUPTED_MATERIAL = re.compile(r"\bНПВХ[0О]\b", re.I)
SEWER = re.compile(r"\b(?:канализац\w*|водоотведен\w*|К[1-9])\b", re.I)
SUPPLY = re.compile(r"\b(?:водоснабжен\w*|водопровод\w*|В[1-9]|Т3|Т4|ГВС|ХВС)\b", re.I)


class PipeMaterialReviewError(ValueError):
    """Public source, indexed locator or original bytes failed validation."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def literal_spans(pattern: re.Pattern[str], text: str) -> list[dict[str, Any]]:
    return [{"text": match.group(), "start": match.start(), "end": match.end()}
            for match in pattern.finditer(text)]


def line_observation(text: str) -> dict[str, Any] | None:
    """Extract independent raw fields; code hints require network on same line."""
    materials = literal_spans(MATERIAL, text)
    if not materials or not PIPE_NOUN.search(text):
        return None
    networks = literal_spans(NETWORK, text)
    hints = []
    if SUPPLY.search(text):
        hints.append("IOS2-072")
    if SEWER.search(text):
        hints.append("IOS3-075")
    return {
        "rawNetwork": networks,
        "rawMaterial": materials,
        "rawPressureClass": literal_spans(PRESSURE_CLASS, text),
        "rawPipeType": literal_spans(PIPE_TYPE, text),
        "sameLineCodeHints": hints,
        "fieldLinkStatus": "UNVERIFIED_SAME_LINE_WORDS",
        "elementIdentityStatus": "UNVERIFIED",
        "reviewStatus": "REVIEW_ONLY_ABSTAIN",
    }


def _member_name(info: zipfile.ZipInfo) -> str:
    return info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866")


def _verify_originals(archive_path: Path, selected: dict[str, dict[str, Any]]) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        matched: dict[str, zipfile.ZipInfo] = {}
        roots: set[str] = set()
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = _member_name(info)
            for source_id, source in selected.items():
                relative = source["relative_path"]
                if name == relative or name.endswith("/" + relative):
                    if source_id in matched:
                        raise PipeMaterialReviewError(f"ambiguous PDF member: {source_id}")
                    matched[source_id] = info
                    roots.add(name[: -(len(relative) + 1)] if name != relative else "")
        if set(matched) != set(selected) or len(roots) != 1:
            raise PipeMaterialReviewError("original public PDF inventory missing or ambiguous")
        for source_id, info in matched.items():
            source = selected[source_id]
            if info.file_size != source["size_bytes"]:
                raise PipeMaterialReviewError(f"PDF size mismatch: {source_id}")
            digest = hashlib.sha256()
            byte_count = 0
            with archive.open(info) as member:
                for chunk in iter(lambda: member.read(1024 * 1024), b""):
                    digest.update(chunk)
                    byte_count += len(chunk)
            if byte_count != source["size_bytes"] or digest.hexdigest() != source["sha256"]:
                raise PipeMaterialReviewError(f"PDF SHA mismatch: {source_id}")


def _load_page(root: Path, row: sqlite3.Row, source_sha: str) -> dict[str, Any]:
    path = (root / row["artifact_path"]).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise PipeMaterialReviewError("page artifact missing or path unsafe")
    encoded = path.read_bytes()
    if _sha(encoded) != row["artifact_sha256"]:
        raise PipeMaterialReviewError("page artifact SHA mismatch")
    try:
        page = json.loads(gzip.decompress(encoded))
    except (OSError, ValueError) as error:
        raise PipeMaterialReviewError("page artifact invalid") from error
    if (page.get("indexVersionHash") != INDEX_VERSION or page.get("inputSha256") != source_sha
            or page.get("pageNumber") != row["page_number"]
            or page.get("quality", {}).get("disposition") != row["disposition"]
            or not isinstance(page.get("lines"), list)):
        raise PipeMaterialReviewError("page provenance mismatch")
    return page


def _valid_locator(line: dict[str, Any], page: dict[str, Any]) -> bool:
    box = line.get("bboxMilliPoints")
    return (isinstance(line.get("text"), str)
            and isinstance(line.get("blockIndex"), int) and line["blockIndex"] >= 0
            and isinstance(line.get("lineIndex"), int) and line["lineIndex"] >= 0
            and isinstance(box, list) and len(box) == 4
            and all(isinstance(value, int) for value in box)
            and 0 <= box[0] < box[2] <= page["widthMilliPoints"]
            and 0 <= box[1] < box[3] <= page["heightMilliPoints"])


def evaluate_pipe_material_review(manifest_path: Path, index_root: Path, audit_path: Path,
                                  archive_path: Path, *,
                                  source_ids: tuple[str, ...] = SOURCE_IDS) -> dict[str, Any]:
    manifest_bytes, audit_bytes = manifest_path.read_bytes(), audit_path.read_bytes()
    if _sha(manifest_bytes) != MANIFEST_SHA or _sha(audit_bytes) != AUDIT_SHA:
        raise PipeMaterialReviewError("public manifest/audit SHA differs from pinned v4")
    manifest = [json.loads(line) for line in manifest_bytes.splitlines()
                if b'"TRAIN_PUBLIC"' in line and b'"INCLUDE"' in line
                and b'"PUBLIC_TRAIN"' in line]
    audit = json.loads(audit_bytes)
    if (len(manifest) != 203 or audit.get("status") != "PASS"
            or audit.get("manifestSha256") != MANIFEST_SHA
            or audit.get("indexVersionHash") != INDEX_VERSION
            or audit.get("actual", {}).get("verifiedPageArtifacts") != 10142
            or audit.get("actual", {}).get("ftsMapRows") != 10142):
        raise PipeMaterialReviewError("public index v4 audit gate failed")
    by_id = {source["file_id"]: source for source in manifest}
    if len(by_id) != 203 or not source_ids or len(set(source_ids)) != len(source_ids) \
            or not set(source_ids).issubset(SOURCE_IDS):
        raise PipeMaterialReviewError("source selection outside fixed public batch")
    selected = {source_id: by_id[source_id] for source_id in source_ids}
    for source_id, source in selected.items():
        if (source.get("split"), source.get("distribution_status"), source.get("label_visibility"),
                source.get("extension"), source.get("object_id"), source.get("section")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", ".pdf",
                "OBJ-TYUMENSKAYA-5-GOLD-SEED", "VK"):
            raise PipeMaterialReviewError(f"source outside public VK object: {source_id}")
        if source.get("stage") != ("RD_ID_MIXED" if source_id == "F0204" else "PD"):
            raise PipeMaterialReviewError(f"source stage differs: {source_id}")
    _verify_originals(archive_path, selected)
    observations: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    invalid_line_locators = 0
    with sqlite3.connect(f"file:{index_root / 'index.sqlite3'}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        meta = dict(connection.execute("SELECT key,value FROM meta WHERE key IN ('schemaVersion','versionHash')"))
        if meta != {"schemaVersion": "public-document-index-v1", "versionHash": INDEX_VERSION}:
            raise PipeMaterialReviewError("index schema/version mismatch")
        for source_id, source in selected.items():
            indexed = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            if indexed is None or any(indexed[column] != source[key] for column, key in (
                    ("source_sha256", "sha256"), ("byte_size", "size_bytes"),
                    ("expected_pages", "pdf_pages"), ("object_id", "object_id"),
                    ("stage", "stage"), ("section", "section"),
                    ("relative_path", "relative_path"))):
                raise PipeMaterialReviewError(f"indexed source mismatch: {source_id}")
            pages = connection.execute("SELECT * FROM pages WHERE source_id=? ORDER BY page_number",
                                       (source_id,)).fetchall()
            if (indexed["status"] != "COMPLETE" or len(pages) != source["pdf_pages"]
                    or [row["page_number"] for row in pages] != list(range(1, len(pages) + 1))):
                raise PipeMaterialReviewError(f"incomplete indexed source: {source_id}")
            quality = Counter()
            for row in pages:
                if row["source_sha256"] != source["sha256"]:
                    raise PipeMaterialReviewError("indexed page source SHA mismatch")
                page = _load_page(index_root, row, source["sha256"])
                disposition = row["disposition"]
                if disposition not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}:
                    raise PipeMaterialReviewError("unknown page disposition")
                quality[disposition] += 1
                if disposition == "OCR_REQUIRED":
                    unknown.append({"sourceFileId": source_id, "pageNumber": row["page_number"],
                                    "pageArtifactSha256": row["artifact_sha256"],
                                    "status": "OCR_REQUIRED_UNKNOWN"})
                    continue
                table_rows = {(candidate.get("blockIndex"), candidate.get("lineIndex"),
                               candidate.get("text"), tuple(candidate.get("bboxMilliPoints", [])))
                              for candidate in page["tableRowCandidates"]}
                seen: set[tuple[int, int]] = set()
                for line in page["lines"]:
                    if not _valid_locator(line, page):
                        invalid_line_locators += 1
                        continue
                    key = (line["blockIndex"], line["lineIndex"])
                    if key in seen:
                        raise PipeMaterialReviewError("duplicate line locator")
                    seen.add(key)
                    fields = line_observation(line["text"])
                    if fields is None:
                        continue
                    observations.append({
                        "sourceFileId": source_id, "sourceSha256": source["sha256"],
                        "manifestStage": source["stage"], "manifestSection": source["section"],
                        "stageAndSectionVerified": False, "revisionAndApprovalVerified": False,
                        "pageNumber": row["page_number"], "pageArtifactSha256": row["artifact_sha256"],
                        "parserProvenance": row["parser_provenance"],
                        "locator": {"blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                                    "bboxMilliPoints": line["bboxMilliPoints"]},
                        "rawText": line["text"], "lineSha256": _sha(line["text"].encode()),
                        "indexedTableRowCandidate": (line["blockIndex"], line["lineIndex"],
                                                     line["text"], tuple(line["bboxMilliPoints"])) in table_rows,
                        "pageTableRowCandidateCount": len(page["tableRowCandidates"]),
                        "pageSectionCandidateCount": len(page["sectionCandidates"]),
                        **fields,
                    })
            summaries.append({"sourceFileId": source_id, "sourceSha256": source["sha256"],
                              "manifestStage": source["stage"], "manifestSection": source["section"],
                              "pageCount": len(pages), "textLayerPages": quality["TEXT_LAYER_CANDIDATE"],
                              "ocrRequiredPages": quality["OCR_REQUIRED"]})
    return {"schemaVersion": SCHEMA, "purpose": "REVIEW_ONLY", "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
            "manifestSha256": MANIFEST_SHA, "auditSha256": AUDIT_SHA, "indexVersionHash": INDEX_VERSION,
            "objectId": "OBJ-TYUMENSKAYA-5-GOLD-SEED", "parameterCodes": ["IOS2-072", "IOS3-075"],
            "sources": summaries, "observations": observations, "ocrRequiredUnknownPages": unknown,
            "invalidLineLocatorsExcluded": invalid_line_locators,
            "evaluation": {"status": "ABSTAIN", "comparablePairs": [], "facts": [],
                           "finding": None, "findingCount": None, "parameterCoverage": None,
                           "reasonCodes": ["SOURCE_STAGE_SECTION_UNVERIFIED", "REVISION_APPROVAL_UNVERIFIED",
                                           "ELEMENT_NETWORK_IDENTITY_UNVERIFIED", "COMPOSITE_TRIGGER_UNVERIFIED",
                           "OCR_PAGES_UNASSESSED"]}}


def evaluate_cached_pipe_ocr(cache_path: Path, render_png_path: Path,
                             base_report_path: Path, replay_receipt_path: Path) -> dict[str, Any]:
    """Recheck exact F0204 p.6 cache/render and retain raw OCR material leads.

    The function does not repair OCR text or join adjacent network/material
    lines. Original-PDF cache replay and independent PDFium rendering are
    performed separately before passing the two SHA-pinned files here.
    """
    from .ocr_pilot import canonical_hash, validate_ocr_artifact

    report_bytes = base_report_path.read_bytes()
    if _sha(report_bytes) != BASE_REPORT_SHA:
        raise PipeMaterialReviewError("base public PDF report SHA mismatch")
    base = json.loads(report_bytes)
    selected = [item for item in base["sources"] if item["sourceFileId"] == "F0204"]
    unknown = [item for item in base["ocrRequiredUnknownPages"]
               if item["sourceFileId"] == "F0204" and item["pageNumber"] == 6]
    if (len(selected) != 1 or selected[0]["sourceSha256"] != F0204_SOURCE_SHA
            or selected[0]["manifestStage"] != "RD_ID_MIXED"
            or len(unknown) != 1 or unknown[0]["pageArtifactSha256"] != F0204_PAGE_ARTIFACT_SHA):
        raise PipeMaterialReviewError("F0204 p.6 absent from verified public base report")
    cache_bytes = cache_path.read_bytes()
    render_bytes = render_png_path.read_bytes()
    if _sha(cache_bytes) != F0204_CACHE_SHA or _sha(render_bytes) != F0204_RENDER_SHA:
        raise PipeMaterialReviewError("OCR cache or independent render SHA mismatch")
    if not render_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise PipeMaterialReviewError("independent render is not PNG")
    width, height = struct.unpack(">II", render_bytes[16:24])
    cache = json.loads(cache_bytes)
    request = cache.get("request")
    expected_request = {
        "schemaVersion": "public-ocr-page-cache-v1", "sourceFileId": "F0204",
        "sourceSha256": F0204_SOURCE_SHA, "pageNumber": 6, "dpi": 90,
        "script": "eslav", "rendererProfileId": "renderer-pdfium-5.12.1-linux-x86_64-v1",
        "providerProfileId": "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
    }
    if (cache.get("schemaVersion") != "public-ocr-page-cache-v1"
            or request != expected_request or canonical_hash(request) != F0204_CACHE_KEY
            or cache.get("contentHash") != canonical_hash(
                {key: value for key, value in cache.items() if key != "contentHash"})):
        raise PipeMaterialReviewError("OCR cache key, request or contentHash mismatch")
    artifact = cache.get("artifact")
    try:
        validate_ocr_artifact(artifact, source_id="F0204", source_hash=F0204_SOURCE_SHA,
                              page_number=6)
    except ValueError as error:
        raise PipeMaterialReviewError("cached OCR artifact invalid") from error
    render = artifact["render"]
    if (artifact["contentHash"] != F0204_OCR_ARTIFACT_HASH
            or render["sha256"] != F0204_RENDER_SHA
            or render["widthPx"] != width or render["heightPx"] != height
            or render["dpi"] != 90 or artifact["provider"]["profileId"] != expected_request["providerProfileId"]
            or artifact["provider"]["script"] != "eslav" or len(artifact["lines"]) != 287):
        raise PipeMaterialReviewError("OCR artifact differs from exact public render/provider receipt")
    replay_bytes = replay_receipt_path.read_bytes()
    if _sha(replay_bytes) != F0204_REPLAY_RECEIPT_SHA:
        raise PipeMaterialReviewError("original-ZIP cache replay receipt SHA mismatch")
    replay = json.loads(replay_bytes)
    if replay != {
        "schemaVersion": "pipe-material-f0204-cache-replay-v1",
        "sourceFileId": "F0204", "pageNumber": 6,
        "sourceSha256": F0204_SOURCE_SHA, "indexDisposition": "OCR_REQUIRED",
        "cacheStatus": "HIT", "cacheKey": F0204_CACHE_KEY,
        "cacheFileSha256": F0204_CACHE_SHA,
        "ocrArtifactContentHash": F0204_OCR_ARTIFACT_HASH,
        "render": render, "ocrLineCount": 287,
        "networkMode": "DOCKER_NETWORK_NONE",
        "archiveSource": "ORIGINAL_PUBLIC_PARTICIPANT_ZIP",
    }:
        raise PipeMaterialReviewError("original-ZIP cache replay receipt differs")
    leads = []
    for index, line in enumerate(artifact["lines"]):
        raw = line["text"]
        material = literal_spans(MATERIAL, raw)
        corrupted = literal_spans(OCR_CORRUPTED_MATERIAL, raw)
        if not material and not corrupted:
            continue
        same_line = line_observation(raw)
        leads.append({
            "lineIndex": index, "rawText": raw, "lineSha256": _sha(raw.encode()),
            "bboxPx": line["bboxPx"], "ocrScore": line["score"],
            "rawNetwork": literal_spans(NETWORK, raw),
            "rawMaterial": material + corrupted,
            "rawPressureClass": literal_spans(PRESSURE_CLASS, raw),
            "rawPipeType": literal_spans(PIPE_TYPE, raw),
            "materialTokenStatus": ("OCR_CORRUPTED_SUFFIX_REVIEW" if corrupted else "LITERAL_OCR_TOKEN"),
            "sameLineCodeHints": same_line["sameLineCodeHints"] if same_line else [],
            "reviewStatus": "REVIEW_ONLY_ABSTAIN",
        })
    return {
        "schemaVersion": "pipe-material-ocr-review-v1", "purpose": "REVIEW_ONLY",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY", "sourceFileId": "F0204",
        "objectId": base["objectId"], "manifestStage": "RD_ID_MIXED", "manifestSection": "VK",
        "sourceSha256": F0204_SOURCE_SHA, "pageNumber": 6,
        "pageArtifactSha256": F0204_PAGE_ARTIFACT_SHA,
        "baseReportSha256": BASE_REPORT_SHA, "cacheKey": F0204_CACHE_KEY,
        "cacheReplayReceiptSha256": F0204_REPLAY_RECEIPT_SHA,
        "cacheFileSha256": F0204_CACHE_SHA, "ocrArtifactContentHash": F0204_OCR_ARTIFACT_HASH,
        "renderArtifactSha256": F0204_RENDER_SHA, "renderDpi": 90,
        "renderWidthPx": width, "renderHeightPx": height,
        "rendererProfileId": expected_request["rendererProfileId"],
        "providerProfileId": expected_request["providerProfileId"],
        "ocrLineCount": len(artifact["lines"]), "materialLeadCount": len(leads),
        "leads": leads, "evaluation": {"status": "ABSTAIN", "facts": [], "comparablePairs": [],
            "finding": None, "findingCount": None, "parameterCoverage": None,
            "reasonCodes": ["OCR_TEXT_REQUIRES_VISUAL_REVIEW", "SOURCE_MIXED_STAGE_UNRESOLVED",
                            "REVISION_APPROVAL_UNVERIFIED", "ELEMENT_NETWORK_IDENTITY_UNVERIFIED",
                            "COMPOSITE_TRIGGER_UNVERIFIED"]},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "index", "audit", "archive"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--source-id", action="append", choices=SOURCE_IDS)
    args = parser.parse_args()
    report = evaluate_pipe_material_review(args.manifest, args.index, args.audit, args.archive,
                                           source_ids=tuple(args.source_id or SOURCE_IDS))
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
