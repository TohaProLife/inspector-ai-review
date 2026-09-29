"""Offline, resumable index for manifest-approved public source documents.

This is a search/triage artifact, never a verified engineering fact. It does not
read labels or the public ground-truth TXT body.
"""
from __future__ import annotations

import concurrent.futures
import contextlib
from .platform_support import require_posix_file_locks
import gzip
import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

from inspector_worker.text_layer import (
    TEXT_QUALITY_POLICY_VERSION, _milli_points, qualify_page_text,
)

INDEX_SCHEMA_VERSION = "public-document-index-v1"
EXTRACTOR_VERSION = "pdfminer-page-layout-v3"
SCOPE = ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN")
HASH_RE = re.compile(r"[a-f0-9]{64}\Z")
SOURCE_RE = re.compile(r"F[0-9]{4}\Z")
_SECTION_RE = re.compile(r"(?i)^\s*(?:(?:раздел|section)\s+\d+[.\s:–-]*|(?:АР|КР|ПЗ|ОВ|ВК|ЭОМ)\s*[-–. :]\s*)[\w\s.,№()«»/–-]{2,140}$")
_NUMBER_RE = re.compile(r"\d+[.,]?\d*")


def readonly_index_uri(database: Path) -> str:
    """Read a frozen WAL database on a read-only mount without hiding live WAL.

    SQLite needs a writable -shm sibling for ordinary WAL readers. A completed,
    checkpointed index can use immutable mode on a read-only bind mount. If a
    nonempty WAL exists, ordinary read-only mode must see it; callers then fail
    on a truly read-only mount rather than silently reading stale main pages.
    """
    wal = database.with_name(database.name + "-wal")
    pending_wal = wal.exists() and wal.stat().st_size > 0
    return database.resolve().as_uri() + ("?mode=ro" if pending_wal else "?mode=ro&immutable=1")


def _version_hash() -> str:
    import pdfminer
    value = [INDEX_SCHEMA_VERSION, EXTRACTOR_VERSION, TEXT_QUALITY_POLICY_VERSION,
             str(pdfminer.__version__)]
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()[:20]


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _emit(kind: str, **fields: Any) -> None:
    print(json.dumps({"event": kind, **fields}, ensure_ascii=False, sort_keys=True), flush=True)


def _safe_relative(raw: str) -> str:
    if not isinstance(raw, str) or not raw or "\\" in raw or "\x00" in raw:
        raise ValueError("unsafe relative path")
    parts = PurePosixPath(raw).parts
    if raw.startswith("/") or not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError("unsafe relative path")
    normalized = "/".join(parts)
    if normalized != raw or unicodedata.normalize("NFC", raw) != raw:
        raise ValueError("unsafe/noncanonical relative path")
    return normalized


def load_public_manifest(path: Path) -> list[dict[str, Any]]:
    """Read only document inventory rows; reject duplicate IDs and paths."""
    rows: list[dict[str, Any]] = []
    ids: set[str] = set()
    paths: set[str] = set()
    with path.open("r", encoding="utf-8") as source:
        for line_no, line in enumerate(source, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"manifest line {line_no} is not an object")
            if (row.get("split"), row.get("distribution_status"), row.get("label_visibility")) != SCOPE:
                continue
            source_id = row.get("file_id")
            rel = _safe_relative(row.get("relative_path"))
            if not isinstance(source_id, str) or not SOURCE_RE.fullmatch(source_id):
                raise ValueError(f"invalid public file_id at line {line_no}")
            if source_id in ids or rel in paths:
                raise ValueError(f"duplicate public source at line {line_no}")
            ids.add(source_id)
            paths.add(rel)
            if row.get("extension") not in (".pdf", ".txt"):
                raise ValueError(f"unsupported public extension for {source_id}")
            if row["extension"] != PurePosixPath(rel).suffix.lower():
                raise ValueError(f"manifest extension mismatch for {source_id}")
            if not isinstance(row.get("size_bytes"), int) or row["size_bytes"] < 1:
                raise ValueError(f"invalid byte size for {source_id}")
            if not isinstance(row.get("sha256"), str) or not HASH_RE.fullmatch(row["sha256"]):
                raise ValueError(f"invalid SHA for {source_id}")
            if row["extension"] == ".pdf" and (not isinstance(row.get("pdf_pages"), int) or row["pdf_pages"] < 1):
                raise ValueError(f"invalid PDF page count for {source_id}")
            rows.append(row)
    if not rows:
        raise ValueError("manifest has no included TRAIN_PUBLIC/PUBLIC_TRAIN documents")
    return sorted(rows, key=lambda row: row["file_id"])


def _decoded_member(info: zipfile.ZipInfo) -> str:
    raw = info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp866")
    return _safe_relative(raw[:-1] if raw.endswith("/") else raw)


def resolve_archive_members(archive: Path, rows: list[dict[str, Any]]) -> dict[str, str]:
    """Resolve exact manifest suffix under one common archive root; reject ambiguity."""
    by_relative = {row["relative_path"]: row["file_id"] for row in rows}
    by_id = {row["file_id"]: row for row in rows}
    matches: dict[str, tuple[str, str]] = {}
    names: set[str] = set()
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            name = _decoded_member(info)
            if name in names:
                raise ValueError(f"duplicate ZIP member: {name}")
            names.add(name)
            if info.is_dir():
                continue
            for rel, source_id in by_relative.items():
                if name == rel:
                    prefix = ""
                elif name.endswith("/" + rel):
                    prefix = name[:-(len(rel) + 1)]
                else:
                    continue
                if source_id in matches:
                    raise ValueError(f"ambiguous ZIP member for {source_id}")
                if info.file_size != by_id[source_id]["size_bytes"]:
                    raise ValueError(f"ZIP size differs from manifest for {source_id}")
                matches[source_id] = (name, prefix)
    prefixes = {prefix for _, prefix in matches.values()}
    if len(prefixes) > 1:
        raise ValueError("public ZIP members do not share one root prefix")
    return {source_id: name for source_id, (name, _) in matches.items()}


def _connect(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database, timeout=60)
    connection.execute("PRAGMA busy_timeout=60000")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextlib.contextmanager
def _writer_lock(output: Path) -> Iterator[None]:
    """Cooperative single-writer lock for all current index mutation commands."""
    fcntl = require_posix_file_locks()
    output.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output / ".public-index-writer.lock", os.O_CREAT | os.O_RDWR, 0o600)
    acquired = False
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError as error:
            raise ValueError("another public index writer holds the output lock") from error
        yield
    finally:
        if acquired:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def initialize_index(output: Path) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    database = output / "index.sqlite3"
    with contextlib.closing(_connect(database)) as connection, connection:
        connection.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sources (
          source_id TEXT PRIMARY KEY, object_id TEXT NOT NULL, stage TEXT NOT NULL,
          section TEXT NOT NULL, relative_path TEXT NOT NULL, source_sha256 TEXT NOT NULL,
          byte_size INTEGER NOT NULL, expected_pages INTEGER, status TEXT NOT NULL,
          observed_pages INTEGER, text_candidate_pages INTEGER, ocr_required_pages INTEGER,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS pages (
          source_id TEXT NOT NULL REFERENCES sources(source_id), page_number INTEGER NOT NULL,
          source_sha256 TEXT NOT NULL, disposition TEXT NOT NULL,
          artifact_path TEXT NOT NULL, artifact_sha256 TEXT NOT NULL,
          parser_provenance TEXT NOT NULL DEFAULT 'PDFMINER',
          block_count INTEGER NOT NULL, section_candidate_count INTEGER NOT NULL,
          table_candidate_count INTEGER NOT NULL, text_chars INTEGER NOT NULL,
          PRIMARY KEY (source_id, page_number)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
          source_id UNINDEXED, page_number UNINDEXED, text, tokenize='unicode61'
        );
        CREATE TABLE IF NOT EXISTS page_fts_map (
          source_id TEXT NOT NULL, page_number INTEGER NOT NULL,
          fts_rowid INTEGER NOT NULL UNIQUE,
          PRIMARY KEY (source_id,page_number)
        );
        CREATE INDEX IF NOT EXISTS idx_sources_scope ON sources(object_id,stage,section);
        CREATE INDEX IF NOT EXISTS idx_pages_disposition ON pages(disposition);
        """)
        columns = {record[1] for record in connection.execute("PRAGMA table_info(pages)")}
        if "parser_provenance" not in columns:
            connection.execute("ALTER TABLE pages ADD COLUMN parser_provenance TEXT NOT NULL DEFAULT 'PDFMINER'")
        version = _version_hash()
        current = connection.execute("SELECT value FROM meta WHERE key='versionHash'").fetchone()
        if current and current[0] != version:
            raise ValueError("index version differs; choose a fresh output directory")
        connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('versionHash',?)", (version,))
        connection.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('schemaVersion',?)", (INDEX_SCHEMA_VERSION,))
        _ensure_fts_rowid_map(connection)
    return database


def _ensure_fts_rowid_map(connection: sqlite3.Connection) -> None:
    """One-time, transaction-bound migration from legacy FTS key scans."""
    marker = connection.execute("SELECT value FROM meta WHERE key='ftsRowidMapVersion'").fetchone()
    if marker and marker[0] != "1":
        raise ValueError("unsupported FTS rowid map version")
    if marker is None:
        connection.execute("DELETE FROM page_fts_map")
        seen: set[tuple[str,int]] = set()
        count = 0
        for rowid, source_id, page_number in connection.execute(
                "SELECT rowid,source_id,page_number FROM page_fts"):
            if not isinstance(source_id,str) or not isinstance(page_number,int) or page_number < 1:
                raise ValueError("legacy FTS row has invalid source/page key")
            key = (source_id,page_number)
            if key in seen:
                raise ValueError(f"duplicate legacy FTS row for {source_id} p.{page_number}")
            seen.add(key)
            if connection.execute("SELECT 1 FROM pages WHERE source_id=? AND page_number=?",key).fetchone() is None:
                raise ValueError(f"legacy FTS row has no page artifact: {source_id} p.{page_number}")
            connection.execute("INSERT INTO page_fts_map(source_id,page_number,fts_rowid) VALUES(?,?,?)",
                               (source_id,page_number,rowid))
            count += 1
        page_count, = connection.execute("SELECT COUNT(*) FROM pages").fetchone()
        if page_count != count:
            raise ValueError("legacy FTS rows and page artifacts have different counts")
        connection.execute("INSERT INTO meta(key,value) VALUES('ftsRowidMapVersion','1')")
    else:
        page_count, = connection.execute("SELECT COUNT(*) FROM pages").fetchone()
        fts_count, = connection.execute("SELECT COUNT(*) FROM page_fts").fetchone()
        map_count, = connection.execute("SELECT COUNT(*) FROM page_fts_map").fetchone()
        if page_count != fts_count or fts_count != map_count:
            raise ValueError("FTS rowid map/page/FTS counts differ; refusing unsafe reuse")


def _source_upsert(connection: sqlite3.Connection, row: dict[str, Any], status: str, error: str | None = None) -> None:
    existing = connection.execute("SELECT source_sha256 FROM sources WHERE source_id=?", (row["file_id"],)).fetchone()
    if existing and existing[0] != row["sha256"]:
        raise ValueError("source ID points to different input SHA in existing index")
    connection.execute("""INSERT INTO sources
        (source_id,object_id,stage,section,relative_path,source_sha256,byte_size,expected_pages,status,error)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
        object_id=excluded.object_id,stage=excluded.stage,section=excluded.section,
        relative_path=excluded.relative_path,byte_size=excluded.byte_size,
        expected_pages=excluded.expected_pages,status=excluded.status,error=excluded.error""",
        (row["file_id"], row["object_id"], row["stage"], row["section"],
         row["relative_path"], row["sha256"], row["size_bytes"], row.get("pdf_pages"), status, error))
    connection.commit()


def _verified_spool(row: dict[str, Any], location: dict[str, str], output: Path) -> Iterator[Path]:
    """Stream exactly one source to output disk and verify before any parsing."""
    @contextlib.contextmanager
    def spool() -> Iterator[Path]:
        temporary_root = output / "tmp"
        temporary_root.mkdir(exist_ok=True)
        # Linux TemporaryFile has no directory entry. SIGKILL cannot strand a
        # copied source PDF on the backup disk; /proc gives pdfminer a pathname.
        with tempfile.TemporaryFile(mode="w+b", dir=temporary_root) as destination:
            digest = hashlib.sha256()
            total = 0
            if location["mode"] == "zip":
                with zipfile.ZipFile(location["archive"]) as archive:
                    info = next((info for info in archive.infolist()
                                 if _decoded_member(info) == location["member"]), None)
                    if info is None or info.is_dir():
                        raise ValueError("source missing from archive")
                    reader = archive.open(info)
                    with reader:
                        while chunk := reader.read(1024 * 1024):
                            total += len(chunk)
                            if total > row["size_bytes"]:
                                raise ValueError("source exceeds manifest size")
                            digest.update(chunk)
                            destination.write(chunk)
            else:
                source = Path(location["path"])
                with source.open("rb") as reader:
                    while chunk := reader.read(1024 * 1024):
                        total += len(chunk)
                        if total > row["size_bytes"]:
                            raise ValueError("source exceeds manifest size")
                        digest.update(chunk)
                        destination.write(chunk)
            if total != row["size_bytes"] or digest.hexdigest() != row["sha256"]:
                raise ValueError("source size/SHA-256 differs from public manifest")
            destination.flush()
            os.fsync(destination.fileno())
            yield Path(f"/proc/self/fd/{destination.fileno()}")
    return spool()


def _page_path(output: Path, source_sha: str, page_number: int) -> Path:
    return output / "pages" / source_sha / _version_hash() / f"{page_number:06d}.json.gz"


def _validate_cached_page(output: Path, row: dict[str, Any], page_number: int, record: tuple[Any, ...]) -> dict[str, Any] | None:
    artifact_path, artifact_sha = record[:2]
    path = (output / artifact_path).resolve()
    if not path.is_relative_to(output.resolve()) or not path.is_file():
        return None
    try:
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != artifact_sha:
            return None
        page = json.loads(gzip.decompress(content))
        if (page.get("schemaVersion") != INDEX_SCHEMA_VERSION
                or page.get("indexVersionHash") != _version_hash()
                or page.get("inputSha256") != row["sha256"]
                or page.get("pageNumber") != page_number
                or page.get("qualityPolicyVersion") != TEXT_QUALITY_POLICY_VERSION
                or page.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"):
            return None
        parser = page.get("parserProvenance", "PDFMINER")
        if parser not in ("PDFMINER", "PYMUPDF"):
            return None
        if parser == "PYMUPDF" and not isinstance(page.get("parserVersion"), str):
            return None
        if len(record) > 2 and record[2] != parser:
            return None
        blocks = page["blocks"]
        if not isinstance(blocks, list) or page["quality"] != qualify_page_text([block["text"] for block in blocks]):
            return None
        width, height = page["widthMilliPoints"], page["heightMilliPoints"]
        if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1:
            return None
        for block in blocks:
            box = block["bboxMilliPoints"]
            if not isinstance(block["text"], str) or not (isinstance(box, list) and len(box) == 4
                    and all(isinstance(v, int) for v in box) and 0 <= box[0] <= box[2] <= width
                    and 0 <= box[1] <= box[3] <= height):
                return None
        lines = page["lines"]
        if not isinstance(lines, list):
            return None
        for line in lines:
            box = line["bboxMilliPoints"]
            if (not isinstance(line["text"], str) or not isinstance(line["blockIndex"], int)
                    or not 0 <= line["blockIndex"] < len(blocks)
                    or not isinstance(line["lineIndex"], int) or line["lineIndex"] < 0
                    or not (isinstance(box, list) and len(box) == 4
                    and all(isinstance(v, int) for v in box)
                    and 0 <= box[0] <= box[2] <= width and 0 <= box[1] <= box[3] <= height)):
                return None
        return page
    except (OSError, ValueError, KeyError, TypeError, EOFError):
        return None


def _write_page(output: Path, page: dict[str, Any]) -> tuple[str, str]:
    path = _page_path(output, page["inputSha256"], page["pageNumber"])
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = gzip.compress(_canonical(page), compresslevel=6, mtime=0)
    digest = hashlib.sha256(payload).hexdigest()
    with tempfile.NamedTemporaryFile(prefix=".page-", suffix=".tmp", dir=path.parent, delete=False) as temporary:
        temporary.write(payload)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)
    return str(path.relative_to(output)), digest


def _lines_and_blocks(layout: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    from pdfminer.layout import LTTextContainer, LTTextLine
    width = max(1, round(float(layout.width) * 1000))
    height = max(1, round(float(layout.height) * 1000))
    paired: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for element in layout:
        if not isinstance(element, LTTextContainer):
            continue
        text = element.get_text().replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
        if not text:
            continue
        def box(item: Any) -> list[int]:
            x0 = _milli_points(float(item.x0), float(layout.x0), width)
            y0 = _milli_points(float(item.y0), float(layout.y0), height)
            x1 = _milli_points(float(item.x1), float(layout.x0), width)
            y1 = _milli_points(float(item.y1), float(layout.y0), height)
            return [min(x0,x1), min(y0,y1), max(x0,x1), max(y0,y1)]
        lines = []
        for child in element:
            if isinstance(child, LTTextLine):
                line_text = child.get_text().replace("\r", "\n").replace("\x00", "").strip()
                if line_text:
                    lines.append({"text": line_text, "bboxMilliPoints": box(child)})
        paired.append(({"text": text, "bboxMilliPoints": box(element)}, lines))
    paired.sort(key=lambda pair: (-pair[0]["bboxMilliPoints"][3], pair[0]["bboxMilliPoints"][0],
                                  pair[0]["bboxMilliPoints"][1], pair[0]["text"]))
    return [block for block, _ in paired], [dict(line, blockIndex=index, lineIndex=line_index)
                                            for index, (_, lines) in enumerate(paired)
                                            for line_index, line in enumerate(lines)]


def _candidates(lines: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sections: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    for line in lines:
        text = line["text"].strip()
        if len(sections) < 16 and _SECTION_RE.fullmatch(text):
            sections.append({"status": "CANDIDATE", "kind": "SECTION_HEADING_CANDIDATE",
                             "text": text[:200], "blockIndex": line["blockIndex"],
                             "lineIndex": line["lineIndex"], "bboxMilliPoints": line["bboxMilliPoints"]})
        if (len(tables) < 100 and len(text) <= 400 and len(_NUMBER_RE.findall(text)) >= 2
                and (re.search(r"\s{2,}", text) or "|" in text or ";" in text)):
            tables.append({"status": "CANDIDATE", "kind": "TABLE_ROW_CANDIDATE",
                           "text": text, "blockIndex": line["blockIndex"],
                           "lineIndex": line["lineIndex"], "bboxMilliPoints": line["bboxMilliPoints"]})
    return sections, tables


def _page_artifact(layout: Any, row: dict[str, Any], page_number: int) -> dict[str, Any]:
    blocks, lines = _lines_and_blocks(layout)
    sections, tables = _candidates(lines)
    return {
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "indexVersionHash": _version_hash(),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "inputSha256": row["sha256"],
        "pageNumber": page_number,
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "widthMilliPoints": max(1, round(float(layout.width) * 1000)),
        "heightMilliPoints": max(1, round(float(layout.height) * 1000)),
        "blocks": blocks,
        "lines": lines,
        "quality": qualify_page_text([block["text"] for block in blocks]),
        "sectionCandidates": sections,
        "tableRowCandidates": tables,
    }


def _pymupdf_page_artifact(page: Any, row: dict[str, Any], page_number: int) -> dict[str, Any]:
    """Map PyMuPDF's crop-relative, unrotated top-left boxes to PDF media coordinates."""
    import fitz

    media = page.mediabox
    crop = page.cropbox
    media_width = float(media.width)
    media_height = float(media.height)
    rotation = int(page.rotation)
    if rotation not in (0, 90, 180, 270) or media_width <= 0 or media_height <= 0:
        raise ValueError("unsupported PDF page geometry for PyMuPDF fallback")
    width_points = media_height if rotation in (90, 270) else media_width
    height_points = media_width if rotation in (90, 270) else media_height
    width = max(1, round(width_points * 1000))
    height = max(1, round(height_points * 1000))
    crop_x = float(crop.x0 - media.x0)
    crop_y = float(crop.y0 - media.y0)

    def box(raw: Any) -> list[int]:
        if not isinstance(raw, (tuple, list)) or len(raw) != 4:
            raise ValueError("PyMuPDF text box missing four coordinates")
        x0, y0, x1, y1 = (float(value) for value in raw)
        if not all(math.isfinite(value) for value in (x0,y0,x1,y1)):
            raise ValueError("PyMuPDF text box has nonfinite geometry")
        corners = ((x0 + crop_x,y0 + crop_y),(x0 + crop_x,y1 + crop_y),
                   (x1 + crop_x,y0 + crop_y),(x1 + crop_x,y1 + crop_y))
        transformed = []
        for x,y in corners:
            if rotation == 0:
                rx,ry = x,y
            elif rotation == 90:
                rx,ry = media_height-y,x
            elif rotation == 180:
                rx,ry = media_width-x,media_height-y
            else:
                rx,ry = y,media_width-x
            transformed.append((rx,height_points-ry))
        return [max(0,min(width,round(min(x for x,_ in transformed)*1000))),
                max(0,min(height,round(min(y for _,y in transformed)*1000))),
                max(0,min(width,round(max(x for x,_ in transformed)*1000))),
                max(0,min(height,round(max(y for _,y in transformed)*1000)))]

    extracted = page.get_text("dict", sort=False)
    paired: list[tuple[dict[str, Any],list[dict[str, Any]]]] = []
    for raw_block in extracted.get("blocks", []):
        if raw_block.get("type") != 0:
            continue
        raw_lines: list[dict[str, Any]] = []
        for raw_line in raw_block.get("lines", []):
            text = "".join(str(span.get("text", "")) for span in raw_line.get("spans", []))
            text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
            if text:
                raw_lines.append({"text": text, "bboxMilliPoints": box(raw_line["bbox"])})
        if raw_lines:
            block_text = "\n".join(line["text"] for line in raw_lines)
            paired.append(({"text": block_text, "bboxMilliPoints": box(raw_block["bbox"])},raw_lines))
    paired.sort(key=lambda pair: (-pair[0]["bboxMilliPoints"][3],pair[0]["bboxMilliPoints"][0],
                                  pair[0]["bboxMilliPoints"][1],pair[0]["text"]))
    blocks = [item[0] for item in paired]
    lines = [dict(line, blockIndex=index, lineIndex=line_index)
             for index, (_, grouped) in enumerate(paired)
             for line_index, line in enumerate(grouped)]
    sections, tables = _candidates(lines)
    return {"schemaVersion": INDEX_SCHEMA_VERSION,
            "indexVersionHash": _version_hash(),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "inputSha256": row["sha256"], "pageNumber": page_number,
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "widthMilliPoints": width, "heightMilliPoints": height,
            "blocks": blocks, "lines": lines,
            "quality": qualify_page_text([block["text"] for block in blocks]),
            "sectionCandidates": sections, "tableRowCandidates": tables,
            "parserProvenance": "PYMUPDF", "parserVersion": str(fitz.VersionBind),
            "sourcePageRotationDegrees": rotation,
            "sourceMediaBoxPoints": [float(v) for v in media],
            "sourceCropBoxPoints": [float(v) for v in crop]}


def _store_page(connection: sqlite3.Connection, output: Path, row: dict[str, Any], page: dict[str, Any]) -> None:
    source_id = row["file_id"]
    page_number = page["pageNumber"]
    text = "\n".join(block["text"] for block in page["blocks"])
    existing_page = connection.execute("SELECT 1 FROM pages WHERE source_id=? AND page_number=?",
                                       (source_id,page_number)).fetchone() is not None
    mapped = connection.execute("SELECT fts_rowid FROM page_fts_map WHERE source_id=? AND page_number=?",
                                (source_id,page_number)).fetchone()
    if bool(mapped) != existing_page:
        raise ValueError(f"FTS rowid map missing/orphaned for {source_id} p.{page_number}")
    if mapped:
        actual = connection.execute("SELECT source_id,page_number FROM page_fts WHERE rowid=?",
                                    (mapped[0],)).fetchone()
        if actual != (source_id,page_number):
            raise ValueError(f"FTS rowid map points to wrong row for {source_id} p.{page_number}")
    path, digest = _write_page(output, page)
    with connection:
        if mapped:
            connection.execute("DELETE FROM page_fts WHERE rowid=?",(mapped[0],))
            connection.execute("DELETE FROM page_fts_map WHERE source_id=? AND page_number=?",
                               (source_id,page_number))
        connection.execute("""INSERT INTO pages(source_id,page_number,source_sha256,disposition,
            artifact_path,artifact_sha256,parser_provenance,block_count,section_candidate_count,table_candidate_count,text_chars)
            VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,page_number) DO UPDATE SET
            source_sha256=excluded.source_sha256,disposition=excluded.disposition,
            artifact_path=excluded.artifact_path,artifact_sha256=excluded.artifact_sha256,
            parser_provenance=excluded.parser_provenance,
            block_count=excluded.block_count,section_candidate_count=excluded.section_candidate_count,
            table_candidate_count=excluded.table_candidate_count,text_chars=excluded.text_chars""",
            (source_id, page_number, row["sha256"], page["quality"]["disposition"], path, digest,
             page.get("parserProvenance", "PDFMINER"),
             len(page["blocks"]), len(page["sectionCandidates"]), len(page["tableRowCandidates"]), len(text)))
        cursor = connection.execute("INSERT INTO page_fts(source_id,page_number,text) VALUES(?,?,?)",
                                    (source_id, page_number, text))
        connection.execute("INSERT INTO page_fts_map(source_id,page_number,fts_rowid) VALUES(?,?,?)",
                           (source_id,page_number,cursor.lastrowid))


def _cached_document(connection: sqlite3.Connection, output: Path, row: dict[str, Any]) -> bool:
    record = connection.execute("""SELECT status,observed_pages,object_id,stage,section,
                              relative_path,byte_size,expected_pages FROM sources WHERE source_id=?""",
                                (row["file_id"],)).fetchone()
    if not record or record != ("COMPLETE", row["pdf_pages"], row["object_id"], row["stage"],
                               row["section"], row["relative_path"], row["size_bytes"], row["pdf_pages"]):
        return False
    pages = connection.execute("SELECT page_number,artifact_path,artifact_sha256,parser_provenance FROM pages WHERE source_id=? ORDER BY page_number",
                               (row["file_id"],)).fetchall()
    if len(pages) != row["pdf_pages"]:
        return False
    for expected, (number, path, digest, parser) in enumerate(pages, 1):
        if number != expected or not _cache_page_and_search_valid(connection, output, row, number, (path,digest,parser)):
            return False
    return True


def _process_source(row: dict[str, Any], location: dict[str, str], output_raw: str) -> dict[str, Any]:
    output = Path(output_raw)
    database = output / "index.sqlite3"
    source_id = row["file_id"]
    with contextlib.closing(_connect(database)) as connection, connection:
        try:
            if row["extension"] == ".txt":
                # Ground-truth index: do not open, spool or index its contents.
                if row["file_id"] != "F0194" or row.get("annotation_status") != "GROUND_TRUTH_INDEX":
                    raise ValueError("public TXT is not the expected ground-truth inventory item")
                if not location:
                    raise ValueError("ground-truth TXT inventory member missing")
                if location["mode"] == "file" and Path(location["path"]).stat().st_size != row["size_bytes"]:
                    raise ValueError("ground-truth TXT inventory size differs from manifest")
                _source_upsert(connection, row, "SKIPPED_GROUND_TRUTH_TXT")
                _emit("source", sourceId=source_id, status="SKIPPED_GROUND_TRUTH_TXT")
                return {"sourceId": source_id, "status": "SKIPPED_GROUND_TRUTH_TXT"}
            if not location:
                raise ValueError("source missing from selected input")
            _emit("source_start", sourceId=source_id, expectedPages=row["pdf_pages"])
            with _verified_spool(row, location, output) as pdf_path:
                if _cached_document(connection, output, row):
                    ocr_required, = connection.execute("SELECT ocr_required_pages FROM sources WHERE source_id=?",
                                                       (source_id,)).fetchone()
                    _emit("source", sourceId=source_id, status="REUSED", pageCount=row["pdf_pages"])
                    return {"sourceId": source_id, "status": "REUSED", "pageCount": row["pdf_pages"],
                            "ocrRequiredPages": ocr_required}
                _source_upsert(connection, row, "INDEXING")
                from pdfminer.high_level import extract_pages
                observed = 0
                for observed, layout in enumerate(extract_pages(str(pdf_path)), 1):
                    cached = connection.execute("SELECT artifact_path,artifact_sha256,parser_provenance FROM pages WHERE source_id=? AND page_number=?",
                                                (source_id, observed)).fetchone()
                    if cached and _cache_page_and_search_valid(connection, output, row, observed, cached):
                        pass
                    else:
                        page = _page_artifact(layout, row, observed)
                        _store_page(connection, output, row, page)
                    if observed % 25 == 0:
                        _emit("source_progress", sourceId=source_id, pagesDone=observed,
                              expectedPages=row["pdf_pages"])
                if observed != row["pdf_pages"]:
                    raise ValueError(f"PDF page count {observed} differs from manifest {row['pdf_pages']}")
                if not _cached_pages_complete(connection, output, row):
                    raise ValueError("page cache incomplete or corrupt after extraction")
                counts = connection.execute("SELECT disposition,COUNT(*) FROM pages WHERE source_id=? GROUP BY disposition",
                                            (source_id,)).fetchall()
                by_disposition = dict(counts)
                with connection:
                    connection.execute("""UPDATE sources SET status='COMPLETE',observed_pages=?,
                      text_candidate_pages=?,ocr_required_pages=?,error=NULL WHERE source_id=?""",
                      (observed, by_disposition.get("TEXT_LAYER_CANDIDATE",0),
                       by_disposition.get("OCR_REQUIRED",0), source_id))
                _emit("source", sourceId=source_id, status="COMPLETE", pageCount=observed,
                      ocrRequiredPages=by_disposition.get("OCR_REQUIRED",0))
                return {"sourceId": source_id, "status": "COMPLETE", "pageCount": observed,
                        "ocrRequiredPages": by_disposition.get("OCR_REQUIRED",0)}
        except Exception as error:
            try:
                _source_upsert(connection, row, "FAILED", str(error)[:500])
            except Exception:
                pass
            _emit("source", sourceId=source_id, status="FAILED", error=str(error)[:500])
            return {"sourceId": source_id, "status": "FAILED", "error": str(error)[:500]}


def _cached_pages_complete(connection: sqlite3.Connection, output: Path, row: dict[str, Any]) -> bool:
    pages = connection.execute("SELECT page_number,artifact_path,artifact_sha256,parser_provenance FROM pages WHERE source_id=? ORDER BY page_number",
                               (row["file_id"],)).fetchall()
    if len(pages) != row["pdf_pages"]:
        return False
    return all(number == expected and _cache_page_and_search_valid(connection, output, row, number, (path,digest,parser))
               for expected, (number,path,digest,parser) in enumerate(pages, 1))


def _cache_page_and_search_valid(connection: sqlite3.Connection, output: Path,
                                 row: dict[str, Any], page_number: int,
                                 record: tuple[Any, ...]) -> bool:
    page = _validate_cached_page(output, row, page_number, record)
    if page is None:
        return False
    return _mapped_fts_text_matches(connection,row["file_id"],page_number,page["blocks"])


def _mapped_fts_text_matches(connection: sqlite3.Connection, source_id: str,
                             page_number: int, blocks: list[dict[str,Any]]) -> bool:
    mapped = connection.execute("SELECT fts_rowid FROM page_fts_map WHERE source_id=? AND page_number=?",
                                (source_id,page_number)).fetchone()
    if mapped is None:
        return False
    search_row = connection.execute("SELECT source_id,page_number,text FROM page_fts WHERE rowid=?",
                                    (mapped[0],)).fetchone()
    return (search_row is not None and search_row[0] == source_id
            and search_row[1] == page_number and search_row[2] ==
            "\n".join(block["text"] for block in blocks))


def _directory_locations(materials_root: Path, rows: list[dict[str, Any]], override_map: dict[str, str]) -> dict[str, dict[str, str]]:
    root = materials_root.resolve()
    locations = {}
    used: set[Path] = set()
    for row in rows:
        source_id = row["file_id"]
        if source_id in override_map:
            raw = Path(override_map[source_id])
            if not raw.is_absolute():
                raise ValueError("override paths must be absolute")
            path = raw.resolve()
        else:
            path = (root / row["relative_path"]).resolve()
            if not path.is_relative_to(root):
                raise ValueError(f"source escapes materials root: {source_id}")
        if path in used:
            raise ValueError("two public source IDs resolve to one path")
        used.add(path)
        locations[source_id] = {"mode": "file", "path": str(path)}
    return locations


def _build_public_index_unlocked(manifest: Path, output: Path, *, archive: Path | None = None,
                       materials_root: Path | None = None, override_map: dict[str, str] | None = None,
                       source_ids: set[str] | None = None, workers: int = 1) -> dict[str, Any]:
    if (archive is None) == (materials_root is None):
        raise ValueError("exactly one of archive or materials_root is required")
    if workers < 1 or workers > 16:
        raise ValueError("workers must be between 1 and 16")
    rows = load_public_manifest(manifest)
    if source_ids is not None:
        unknown = source_ids - {row["file_id"] for row in rows}
        if unknown:
            raise ValueError(f"source IDs outside public allowlist: {sorted(unknown)}")
        rows = [row for row in rows if row["file_id"] in source_ids]
    if not rows:
        raise ValueError("no selected public sources")
    overrides = override_map or {}
    if overrides and archive is not None:
        raise ValueError("override map applies only to materials_root mode")
    if set(overrides) - {row["file_id"] for row in rows}:
        raise ValueError("override map contains unselected source")
    initialize_index(output)
    if archive is not None:
        members = resolve_archive_members(archive, rows)
        locations = {source_id: {"mode": "zip", "archive": str(archive), "member": member}
                     for source_id, member in members.items()}
    else:
        locations = _directory_locations(materials_root, rows, overrides)
    _emit("build_start", selectedSources=len(rows), pdfSources=sum(row["extension"]==".pdf" for row in rows),
          indexVersionHash=_version_hash())
    results: list[dict[str, Any]] = []
    if workers == 1:
        for row in rows:
            results.append(_process_source(row, locations.get(row["file_id"], {}), str(output)))
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(_process_source, row, locations.get(row["file_id"], {}), str(output))
                       for row in rows]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
    results.sort(key=lambda result: result["sourceId"])
    summary = {"schemaVersion": INDEX_SCHEMA_VERSION, "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
               "indexVersionHash": _version_hash(), "selectedSources": len(rows),
               "completeSources": sum(result["status"] in ("COMPLETE","REUSED") for result in results),
               "reusedSources": sum(result["status"] == "REUSED" for result in results),
               "skippedGroundTruthTxt": sum(result["status"] == "SKIPPED_GROUND_TRUTH_TXT" for result in results),
               "failedSources": [result["sourceId"] for result in results if result["status"] == "FAILED"],
               "pageCount": sum(result.get("pageCount",0) for result in results),
               "ocrRequiredPages": sum(result.get("ocrRequiredPages",0) for result in results),
               "sources": results}
    _emit("build_complete", **{key: value for key,value in summary.items() if key != "sources"})
    return summary


def build_public_index(manifest: Path, output: Path, *, archive: Path | None = None,
                       materials_root: Path | None = None, override_map: dict[str,str] | None = None,
                       source_ids: set[str] | None = None, workers: int = 1) -> dict[str,Any]:
    with _writer_lock(output):
        return _build_public_index_unlocked(manifest, output, archive=archive,
                                            materials_root=materials_root, override_map=override_map,
                                            source_ids=source_ids, workers=workers)


def _repair_failed_source(row: dict[str, Any], location: dict[str, str], output_raw: str) -> dict[str, Any]:
    """Replace all pages of one already FAILED PDF with explicit PyMuPDF pages."""
    import fitz

    output = Path(output_raw)
    source_id = row["file_id"]
    with contextlib.closing(_connect(output / "index.sqlite3")) as connection, connection:
        current = connection.execute("SELECT status,source_sha256 FROM sources WHERE source_id=?",
                                     (source_id,)).fetchone()
        if current != ("FAILED", row["sha256"]):
            return {"sourceId": source_id, "status": "NOT_FAILED_OR_SHA_CHANGED"}
        try:
            if not location:
                raise ValueError("failed PDF missing from selected input")
            _emit("repair_start", sourceId=source_id, expectedPages=row["pdf_pages"])
            with _verified_spool(row, location, output) as pdf_path:
                with fitz.open(str(pdf_path)) as document:
                    if len(document) != row["pdf_pages"]:
                        raise ValueError(f"PyMuPDF page count {len(document)} differs from public manifest {row['pdf_pages']}")
                    for page_index in range(len(document)):
                        artifact = _pymupdf_page_artifact(document[page_index], row, page_index + 1)
                        _store_page(connection, output, row, artifact)
                        if (page_index + 1) % 25 == 0:
                            _emit("repair_progress", sourceId=source_id,
                                  pagesDone=page_index + 1, expectedPages=row["pdf_pages"])
            if not _cached_pages_complete(connection, output, row):
                raise ValueError("repaired page cache incomplete or corrupt")
            parsers = connection.execute("SELECT DISTINCT parser_provenance FROM pages WHERE source_id=?",
                                         (source_id,)).fetchall()
            if parsers != [("PYMUPDF",)]:
                raise ValueError("repaired source has mixed parser provenance")
            counts = dict(connection.execute("SELECT disposition,COUNT(*) FROM pages WHERE source_id=? GROUP BY disposition",
                                             (source_id,)).fetchall())
            with connection:
                connection.execute("""UPDATE sources SET status='COMPLETE',observed_pages=?,
                  text_candidate_pages=?,ocr_required_pages=?,error=NULL WHERE source_id=? AND status='FAILED'""",
                  (row["pdf_pages"], counts.get("TEXT_LAYER_CANDIDATE",0),
                   counts.get("OCR_REQUIRED",0), source_id))
            _emit("repair_source", sourceId=source_id, status="COMPLETE", parserProvenance="PYMUPDF",
                  pageCount=row["pdf_pages"], ocrRequiredPages=counts.get("OCR_REQUIRED",0))
            return {"sourceId": source_id, "status": "COMPLETE", "parserProvenance": "PYMUPDF",
                    "pageCount": row["pdf_pages"], "ocrRequiredPages": counts.get("OCR_REQUIRED",0)}
        except Exception as error:
            with connection:
                connection.execute("UPDATE sources SET status='FAILED',error=? WHERE source_id=?",
                                   (str(error)[:500], source_id))
            _emit("repair_source", sourceId=source_id, status="FAILED", error=str(error)[:500])
            return {"sourceId": source_id, "status": "FAILED", "error": str(error)[:500]}


def _repair_failed_public_index_unlocked(manifest: Path, output: Path, *, archive: Path | None = None,
                               materials_root: Path | None = None,
                               override_map: dict[str, str] | None = None,
                               source_ids: set[str] | None = None,
                               workers: int = 1) -> dict[str, Any]:
    """Repair only previously FAILED public PDFs in same v3 index; never rebuild successes."""
    if (archive is None) == (materials_root is None):
        raise ValueError("exactly one of archive or materials_root is required")
    if workers < 1 or workers > 16:
        raise ValueError("workers must be between 1 and 16")
    if not (output / "index.sqlite3").is_file():
        raise ValueError("existing index.sqlite3 is required for failed-only repair")
    rows = load_public_manifest(manifest)
    by_id = {row["file_id"]: row for row in rows}
    if source_ids is not None and not source_ids <= by_id.keys():
        raise ValueError("source IDs outside public allowlist")
    initialize_index(output)  # additive parser provenance column for existing v3
    with contextlib.closing(_connect(output / "index.sqlite3")) as connection, connection:
        failed_ids = {record[0] for record in connection.execute(
            "SELECT source_id FROM sources WHERE status='FAILED'")}
        if failed_ids - by_id.keys():
            raise ValueError("index has FAILED source outside public manifest")
        active_count, = connection.execute("SELECT COUNT(*) FROM sources WHERE status='INDEXING'").fetchone()
        if active_count:
            raise ValueError("index still has INDEXING sources; wait for full build to finish")
    if source_ids is not None:
        not_failed = source_ids - failed_ids
        if not_failed:
            raise ValueError(f"repair accepts only FAILED sources: {sorted(not_failed)}")
        failed_ids = source_ids
    selected = [by_id[source_id] for source_id in sorted(failed_ids) if source_id in by_id]
    if any(row["extension"] != ".pdf" for row in selected):
        raise ValueError("failed-only fallback supports PDF only")
    overrides = override_map or {}
    if overrides and archive is not None:
        raise ValueError("override map applies only to materials_root mode")
    if set(overrides) - failed_ids:
        raise ValueError("override map contains source outside failed selection")
    if archive is not None:
        members = resolve_archive_members(archive, selected) if selected else {}
        locations = {source_id: {"mode":"zip","archive":str(archive),"member":member}
                     for source_id,member in members.items()}
    else:
        locations = _directory_locations(materials_root, selected, overrides)
    _emit("repair_build_start", failedPdfSources=len(selected), indexVersionHash=_version_hash())
    results: list[dict[str, Any]] = []
    if workers == 1:
        for row in selected:
            results.append(_repair_failed_source(row, locations.get(row["file_id"], {}), str(output)))
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(_repair_failed_source, row, locations.get(row["file_id"], {}), str(output))
                       for row in selected]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
    results.sort(key=lambda result: result["sourceId"])
    summary = {"schemaVersion": INDEX_SCHEMA_VERSION, "indexVersionHash": _version_hash(),
               "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY", "selectedFailedSources": len(selected),
               "repairedSources": sum(result["status"] == "COMPLETE" for result in results),
               "failedSources": [result["sourceId"] for result in results if result["status"] != "COMPLETE"],
               "repairedPages": sum(result.get("pageCount",0) for result in results),
               "ocrRequiredPages": sum(result.get("ocrRequiredPages",0) for result in results),
               "sources": results}
    _emit("repair_build_complete", **{key:value for key,value in summary.items() if key != "sources"})
    return summary


def repair_failed_public_index(manifest: Path, output: Path, *, archive: Path | None = None,
                               materials_root: Path | None = None,
                               override_map: dict[str,str] | None = None,
                               source_ids: set[str] | None = None,
                               workers: int = 1) -> dict[str,Any]:
    with _writer_lock(output):
        return _repair_failed_public_index_unlocked(manifest, output, archive=archive,
                                                    materials_root=materials_root, override_map=override_map,
                                                    source_ids=source_ids, workers=workers)


def _finish_incomplete_source(row: dict[str,Any], location: dict[str,str], output: Path) -> dict[str,Any]:
    """Use PyMuPDF only for absent/broken pages; preserve verified prior pages."""
    import fitz

    source_id = row["file_id"]
    with contextlib.closing(_connect(output / "index.sqlite3")) as connection, connection:
        existing = connection.execute("SELECT status,source_sha256 FROM sources WHERE source_id=?",
                                      (source_id,)).fetchone()
        if existing and existing[1] != row["sha256"]:
            raise ValueError(f"existing source SHA differs from manifest for {source_id}")
        if row["extension"] == ".txt":
            if row["file_id"] != "F0194" or row.get("annotation_status") != "GROUND_TRUTH_INDEX":
                raise ValueError("unexpected public TXT inventory item")
            if not location:
                raise ValueError("ground-truth TXT inventory member missing")
            if location["mode"] == "file" and Path(location["path"]).stat().st_size != row["size_bytes"]:
                raise ValueError("ground-truth TXT inventory size differs from manifest")
            if existing and existing[0] not in ("SKIPPED_GROUND_TRUTH_TXT","FAILED"):
                raise ValueError("ground-truth TXT has unexpected index status")
            _source_upsert(connection,row,"SKIPPED_GROUND_TRUTH_TXT")
            return {"sourceId":source_id,"status":"SKIPPED_GROUND_TRUTH_TXT"}
        if existing and existing[0] == "COMPLETE":
            if not _cached_document(connection,output,row):
                raise ValueError(f"COMPLETE source has corrupt/incomplete cache: {source_id}")
            count, = connection.execute("SELECT COUNT(*) FROM pages WHERE source_id=?",
                                        (source_id,)).fetchone()
            return {"sourceId":source_id,"status":"PRESERVED_COMPLETE","pageCount":count}
        if existing and existing[0] not in ("INDEXING","FAILED"):
            raise ValueError(f"unexpected source status for finish-incomplete: {source_id}")
        if not location:
            raise ValueError(f"public source missing from selected input: {source_id}")
        _emit("finish_source_start",sourceId=source_id,previousStatus=existing[0] if existing else "ABSENT",
              expectedPages=row["pdf_pages"])
        try:
            with _verified_spool(row,location,output) as pdf_path:
                with fitz.open(str(pdf_path)) as document:
                    if len(document) != row["pdf_pages"]:
                        raise ValueError(f"PyMuPDF page count {len(document)} differs from public manifest {row['pdf_pages']}")
                    _source_upsert(connection,row,"INDEXING")
                    reused = 0
                    generated = 0
                    invalid_cached = 0
                    for page_index in range(len(document)):
                        page_number = page_index + 1
                        cached = connection.execute("""SELECT artifact_path,artifact_sha256,parser_provenance
                              FROM pages WHERE source_id=? AND page_number=?""",
                              (source_id,page_number)).fetchone()
                        if cached and _cache_page_and_search_valid(connection,output,row,page_number,cached):
                            reused += 1
                        else:
                            if cached:
                                invalid_cached += 1
                            artifact = _pymupdf_page_artifact(document[page_index],row,page_number)
                            _store_page(connection,output,row,artifact)
                            generated += 1
                        if page_number % 25 == 0:
                            _emit("finish_source_progress",sourceId=source_id,pagesDone=page_number,
                                  expectedPages=row["pdf_pages"],reusedPages=reused,generatedPages=generated)
                    if not _cached_pages_complete(connection,output,row):
                        raise ValueError("finish-incomplete cache failed integrity check")
                    counts = dict(connection.execute("SELECT disposition,COUNT(*) FROM pages WHERE source_id=? GROUP BY disposition",
                                                     (source_id,)).fetchall())
                    with connection:
                        connection.execute("""UPDATE sources SET status='COMPLETE',observed_pages=?,
                            text_candidate_pages=?,ocr_required_pages=?,error=NULL WHERE source_id=?""",
                            (row["pdf_pages"],counts.get("TEXT_LAYER_CANDIDATE",0),
                             counts.get("OCR_REQUIRED",0),source_id))
                    result = {"sourceId":source_id,"status":"COMPLETE","pageCount":row["pdf_pages"],
                              "reusedPages":reused,"generatedPages":generated,
                              "invalidCachedPagesReplaced":invalid_cached,
                              "ocrRequiredPages":counts.get("OCR_REQUIRED",0)}
                    _emit("finish_source",**result)
                    return result
        except Exception as error:
            _source_upsert(connection,row,"FAILED",str(error)[:500])
            result = {"sourceId":source_id,"status":"FAILED","error":str(error)[:500]}
            _emit("finish_source",**result)
            return result


def finish_incomplete_public_index(manifest: Path, output: Path, *, archive: Path | None = None,
                                   materials_root: Path | None = None,
                                   override_map: dict[str,str] | None = None,
                                   source_ids: set[str] | None = None,
                                   operator_confirms_main_stopped: bool = False) -> dict[str,Any]:
    """After main writer stops, fill missing pages in same index without reparsing valid cache."""
    if not operator_confirms_main_stopped:
        raise ValueError("finish-incomplete requires explicit --main-service-stopped confirmation")
    if (archive is None) == (materials_root is None):
        raise ValueError("exactly one of archive or materials_root is required")
    if not (output / "index.sqlite3").is_file():
        raise ValueError("existing index.sqlite3 required; finish-incomplete cannot create a new index")
    with _writer_lock(output):
        initialize_index(output)
        rows = load_public_manifest(manifest)
        by_id = {row["file_id"]:row for row in rows}
        if source_ids is not None:
            unknown = source_ids - by_id.keys()
            if unknown:
                raise ValueError(f"source IDs outside public allowlist: {sorted(unknown)}")
            rows = [row for row in rows if row["file_id"] in source_ids]
        if not rows:
            raise ValueError("no selected public sources")
        overrides = override_map or {}
        if overrides and archive is not None:
            raise ValueError("override map applies only to materials_root mode")
        if set(overrides) - {row["file_id"] for row in rows}:
            raise ValueError("override map contains unselected source")
        if archive is not None:
            members = resolve_archive_members(archive,rows)
            locations = {source_id:{"mode":"zip","archive":str(archive),"member":member}
                         for source_id,member in members.items()}
        else:
            locations = _directory_locations(materials_root,rows,overrides)
        # Fail closed before first mutation if any already COMPLETE source has
        # changed manifest metadata or a corrupt page/FTS entry.
        complete_ids: set[str] = set()
        with contextlib.closing(_connect(output / "index.sqlite3")) as connection, connection:
            if source_ids is None:
                indexed_ids = {record[0] for record in connection.execute("SELECT source_id FROM sources")}
                if indexed_ids - by_id.keys():
                    raise ValueError("index contains source outside public manifest")
            for row in rows:
                if row["extension"] != ".pdf":
                    continue
                existing = connection.execute("SELECT status,source_sha256 FROM sources WHERE source_id=?",
                                              (row["file_id"],)).fetchone()
                if existing and existing[1] != row["sha256"]:
                    raise ValueError(f"existing source SHA differs from manifest for {row['file_id']}")
                if existing and existing[0] == "COMPLETE" and not _cached_document(connection,output,row):
                    raise ValueError(f"COMPLETE source has corrupt/incomplete cache: {row['file_id']}")
                if existing and existing[0] == "COMPLETE":
                    complete_ids.add(row["file_id"])
        _emit("finish_build_start",selectedSources=len(rows),indexVersionHash=_version_hash(),
              operatorConfirmedMainStopped=True)
        results = []
        for row in rows:
            if row["file_id"] in complete_ids:
                results.append({"sourceId":row["file_id"],"status":"PRESERVED_COMPLETE",
                                "pageCount":row["pdf_pages"]})
            else:
                results.append(_finish_incomplete_source(row,locations.get(row["file_id"],{}),output))
        failed = [result["sourceId"] for result in results if result["status"] == "FAILED"]
        summary = {"schemaVersion":INDEX_SCHEMA_VERSION,"indexVersionHash":_version_hash(),
                   "scope":"TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY","selectedSources":len(rows),
                   "preservedCompleteSources":sum(r["status"] == "PRESERVED_COMPLETE" for r in results),
                   "completedSources":sum(r["status"] == "COMPLETE" for r in results),
                   "skippedGroundTruthTxt":sum(r["status"] == "SKIPPED_GROUND_TRUTH_TXT" for r in results),
                   "failedSources":failed,
                   "reusedPages":sum(r.get("reusedPages",0) for r in results),
                   "generatedPages":sum(r.get("generatedPages",0) for r in results),
                   "invalidCachedPagesReplaced":sum(r.get("invalidCachedPagesReplaced",0) for r in results),
                   "sources":results}
        _emit("finish_build_complete",**{key:value for key,value in summary.items() if key != "sources"})
        return summary


def get_indexed_page(output: Path, source_id: str, page_number: int) -> dict[str, Any]:
    """Return SHA-checked immutable page with exact PDF-coordinate blocks."""
    if not SOURCE_RE.fullmatch(source_id) or page_number < 1:
        raise ValueError("invalid page address")
    database = output / "index.sqlite3"
    with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        source = connection.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
        if source is None:
            raise KeyError(source_id)
        columns = {item[1] for item in connection.execute("PRAGMA table_info(pages)")}
        parser_sql = "parser_provenance" if "parser_provenance" in columns else "'PDFMINER' AS parser_provenance"
        row = connection.execute(f"SELECT artifact_path,artifact_sha256,{parser_sql} FROM pages WHERE source_id=? AND page_number=?",
                                 (source_id,page_number)).fetchone()
        if row is None:
            raise KeyError(f"{source_id} p.{page_number}")
        page = _validate_cached_page(output, {"sha256": source["source_sha256"]}, page_number, row)
        if page is None:
            raise ValueError("indexed page cache failed hash/schema validation")
        has_map = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_fts_map'").fetchone()
        if has_map and not _mapped_fts_text_matches(connection,source_id,page_number,page["blocks"]):
            raise ValueError("indexed page FTS rowid map/text mismatch")
        return {"source": {key: source[key] for key in ("source_id","object_id","stage","section",
                 "source_sha256","relative_path","status")}, "page": page,
                "parserProvenance": row["parser_provenance"]}


def search_index(output: Path, query: str, *, object_id: str | None = None,
                 stage: str | None = None, section: str | None = None,
                 limit: int = 30) -> list[dict[str, Any]]:
    """FTS token search within optional manifest scope filters."""
    tokens = re.findall(r"[^\W_]+", query, re.UNICODE)[:8]
    if not tokens or not 1 <= limit <= 100:
        raise ValueError("query needs word tokens and limit 1..100")
    expression = " ".join('"'+token.replace('"','')+'"' for token in tokens)
    filters = ["page_fts MATCH ?"]
    values: list[Any] = [expression]
    for field,value in (("object_id",object_id),("stage",stage),("section",section)):
        if value is not None:
            filters.append(f"s.{field}=?")
            values.append(value)
    values.append(limit)
    database = output / "index.sqlite3"
    with contextlib.closing(sqlite3.connect(readonly_index_uri(database), uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        columns = {item[1] for item in connection.execute("PRAGMA table_info(pages)")}
        parser_sql = "p.parser_provenance" if "parser_provenance" in columns else "'PDFMINER' AS parser_provenance"
        has_map = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_fts_map'").fetchone()
        join_sql = ("FROM page_fts JOIN page_fts_map m ON m.fts_rowid=page_fts.rowid "
                    "AND m.source_id=page_fts.source_id AND m.page_number=page_fts.page_number "
                    "JOIN pages p ON p.source_id=m.source_id AND p.page_number=m.page_number "
                    if has_map else
                    "FROM page_fts JOIN pages p ON p.source_id=page_fts.source_id "
                    "AND p.page_number=page_fts.page_number ")
        sql = ("SELECT s.source_id,s.object_id,s.stage,s.section,p.page_number,p.disposition," + parser_sql + ","
               "p.artifact_sha256,snippet(page_fts,2,'[',']','…',16) AS snippet "
               + join_sql + "JOIN sources s ON s.source_id=p.source_id "
               "WHERE " + " AND ".join(filters) + " ORDER BY bm25(page_fts),s.source_id,p.page_number LIMIT ?")
        return [dict(row) for row in connection.execute(sql, values)]
