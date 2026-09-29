#!/usr/bin/env python3
"""Render SHA-verified public title pages for human source review only."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.public_ocr_cache import (  # noqa: E402
    PublicOcrCacheError, public_manifest_entry, verified_public_pdf,
)


PACKET_SHA256 = "b1ad972a6c268f36d88665e29a161b9eb614dbe73c8df2e05d5d5ee18fd39328"
MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
MAX_IMAGE_BYTES = 12_000_000
SOURCE_ID = re.compile(r"F[0-9]{4,}\Z")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_packet(path: Path) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    if len(raw) > 16_000_000 or _sha(raw) != PACKET_SHA256:
        raise ValueError("source review packet differs from pinned SHA-256")
    report = json.loads(raw)
    sources = report.get("sources") if isinstance(report, dict) else None
    if (report.get("schemaVersion") != "source-review-packet-v1"
            or report.get("disposition") != "HUMAN_REVIEW_ONLY_ABSTAIN"
            or report.get("manifestSha256") != MANIFEST_SHA256
            or not isinstance(sources, list) or len(sources) != 103):
        raise ValueError("source review packet scope or disposition invalid")
    ids: set[str] = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("source review packet row invalid")
        source_id = source.get("sourceFileId")
        if (not isinstance(source_id, str) or not SOURCE_ID.fullmatch(source_id)
                or source_id in ids or source.get("sourceGateStatus") != "UNVERIFIED_REVIEW_ONLY"
                or not isinstance(source.get("titleLocators"), list)
                or not isinstance(source.get("sourceSha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", source["sourceSha256"])):
            raise ValueError("source review packet identity/status invalid")
        ids.add(source_id)
    return sorted(sources, key=lambda source: (source["reviewRank"], source["sourceFileId"]))


def _pages(source: dict[str, Any], count: int) -> list[int]:
    """Show physical first page plus pages that supplied title cues."""
    pages = [1]
    locators = source["titleLocators"]
    for locator in locators:
        number = locator.get("pageNumber") if isinstance(locator, dict) else None
        if type(number) is int and 1 <= number <= count and number not in pages:
            pages.append(number)
        if len(pages) == 3:
            break
    labels = source.get("titleLabels", {})
    section_hints = labels.get("drawingSections", []) if isinstance(labels, dict) else []
    if not locators or (source.get("manifestSection") == "OTHER" and not section_hints):
        for page in range(2, min(count, 3) + 1):
            if page not in pages and len(pages) < 3:
                pages.append(page)
    return pages


def _render_page(page: fitz.Page, *, stamp: bool) -> bytes:
    rect = page.rect
    if rect.is_empty or rect.width <= 0 or rect.height <= 0:
        raise ValueError("PDF page geometry invalid")
    clip = fitz.Rect(rect.x0 + rect.width * 0.70,
                     rect.y0 + rect.height * 0.85,
                     rect.x1, rect.y1) if stamp else rect
    side = 1900 if stamp else 1500
    scale = min(side / clip.width, side / clip.height, 3)
    pixels = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip,
                             colorspace=fitz.csRGB, alpha=False)
    if pixels.width > side + 2 or pixels.height > side + 2:
        raise ValueError("rendered page exceeds image side limit")
    data = pixels.tobytes("png")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("rendered page exceeds image byte limit")
    return data


def _save_image(path: Path, data: bytes) -> None:
    if path.exists():
        if (path.is_symlink() or path.stat().st_size > MAX_IMAGE_BYTES
                or _sha(path.read_bytes()) != _sha(data)):
            raise ValueError(f"existing atlas image differs: {path.name}")
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.",
                                     suffix=".tmp", delete=False) as target:
        temporary = Path(target.name)
        try:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _html(report: dict[str, Any]) -> str:
    cards: list[str] = []
    for source in report["sources"]:
        labels = source["titleLabels"]
        cues = "; ".join(labels["stages"] + labels["drawingSections"] + labels["literalCiphers"])
        images = "".join(
            f'<figure><img loading="lazy" src="{html.escape(image["path"], quote=True)}" '
            f'alt="{html.escape(source["sourceFileId"], quote=True)} страница {image["pageNumber"]} '
            f'{"штамп" if image["kind"] == "STAMP_CROP" else "целиком"}">'
            f'<figcaption>Страница {image["pageNumber"]}, '
            f'{"область штампа" if image["kind"] == "STAMP_CROP" else "целый лист"}; '
            f'SHA-256 {image["sha256"]}</figcaption></figure>'
            for image in source["images"]
        )
        cards.append(
            f'<details><summary>{source["reviewRank"]}. {source["sourceFileId"]} · '
            f'{html.escape(source["manifestStage"])} / {html.escape(source["manifestSection"])} · '
            f'{html.escape(source["priorityTier"])}</summary>'
            f'<p>{html.escape(source["sourceRelativePath"])}</p>'
            f'<p>Подсказки титула: {html.escape(cues) if cues else "нет"}. '
            f'Исходный SHA-256: <code>{source["sourceSha256"]}</code>.</p>'
            f'{images}</details>'
        )
    return ("<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Публичные источники: визуальная сверка</title>"
            "<style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;"
            "color:#192435}details{border:1px solid #ccd5df;border-radius:8px;padding:1rem;"
            "margin:1rem 0}summary{cursor:pointer;font-weight:700}figure{margin:1rem 0}"
            "img{display:block;max-width:100%;height:auto;border:1px solid #ccd5df}"
            "figcaption{font-size:.8rem;color:#566;overflow-wrap:anywhere}"
            "p{overflow-wrap:anywhere}code{font-size:.85em}</style>"
            "<h1>Публичные источники: визуальная сверка</h1>"
            "<p>103 источника TRAIN_PUBLIC. Изображения созданы из оригинальных PDF после "
            "проверки SHA-256 и числа страниц. Подсказки не подтверждают редакцию, "
            "утверждение, раздел или применимость правил. Решения в атласе не сохраняются.</p>"
            + "".join(cards) + "</html>\n")


def build_atlas(manifest: Path, packet: Path, archive: Path, output_dir: Path) -> dict[str, Any]:
    if _sha(manifest.read_bytes()) != MANIFEST_SHA256:
        raise ValueError("public manifest differs from pinned SHA-256")
    sources = _load_packet(packet)
    output_dir.mkdir(parents=True, exist_ok=True)
    if (output_dir / "report.json").exists() or (output_dir / "index.html").exists():
        raise ValueError("atlas report already exists; refusing to replace it")
    image_dir = output_dir / "images"
    image_dir.mkdir(exist_ok=True)
    if image_dir.is_symlink():
        raise ValueError("atlas image directory is a symlink")
    entries: list[dict[str, Any]] = []
    for source in sources:
        source_id = source["sourceFileId"]
        row = public_manifest_entry(manifest, source_id)
        if (row["sha256"] != source["sourceSha256"]
                or row["relative_path"] != source["sourceRelativePath"]
                or row["object_id"] != source["objectId"]):
            raise ValueError(f"source packet/manifest identity differs: {source_id}")
        images: list[dict[str, Any]] = []
        with verified_public_pdf(row, pdf_path=None, archive_path=archive,
                                 scratch_root=output_dir) as path, fitz.open(path) as document:
            for number in _pages(source, len(document)):
                page = document[number - 1]
                image_kinds = [("FULL_PAGE", False)]
                if max(page.rect.width, page.rect.height) >= 950:
                    image_kinds.append(("STAMP_CROP", True))
                for kind, stamp in image_kinds:
                    data = _render_page(page, stamp=stamp)
                    name = f"{source_id}-p{number}-{'stamp' if stamp else 'full'}.png"
                    image_path = image_dir / name
                    _save_image(image_path, data)
                    images.append({"pageNumber": number, "kind": kind,
                                   "path": f"images/{name}", "sha256": _sha(data),
                                   "bytes": len(data)})
        entries.append({key: source[key] for key in (
            "reviewRank", "sourceFileId", "objectId", "manifestStage", "manifestSection",
            "priorityTier", "sourceSha256", "sourceRelativePath", "titleLabels")}
            | {"images": images})
    report = {"schemaVersion": "source-review-atlas-v1",
              "disposition": "HUMAN_REVIEW_ONLY_ABSTAIN",
              "manifestSha256": MANIFEST_SHA256, "sourcePacketSha256": PACKET_SHA256,
              "sourceCount": len(entries), "imageCount": sum(len(item["images"]) for item in entries),
              "findingCount": None, "parameterCoverage": None, "sources": entries}
    (output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False,
                                              sort_keys=True, indent=2) + "\n", encoding="utf-8")
    (output_dir / "index.html").write_text(_html(report), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = build_atlas(args.manifest, args.packet, args.archive, args.output_dir)
    except (OSError, ValueError, PublicOcrCacheError, fitz.FileDataError) as error:
        print(f"source review atlas failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"sourceCount": result["sourceCount"],
                      "imageCount": result["imageCount"],
                      "output": str(args.output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
