#!/usr/bin/env python3
"""Render and OCR a verified public PDF page through the local document provider."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse
import uuid


def multipart(fields: dict[str, str], filename: str, content: bytes, media_type: str) -> tuple[bytes, str]:
    boundary = f"inspector-{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend((
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(),
            value.encode(),
            b"\r\n",
        ))
    parts.extend((
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {media_type}\r\n\r\n".encode(),
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def post_multipart(url: str, fields: dict[str, str], filename: str, content: bytes, media_type: str, timeout: int):
    body, content_type = multipart(fields, filename, content, media_type)
    request = urllib.request.Request(url, body, {"Content-Type": content_type}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), {key.lower(): value for key, value in response.headers.items()}


def loopback_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise argparse.ArgumentTypeError("document endpoint must use local HTTP loopback")
    return value.rstrip("/")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--dpi", type=int, default=120)
    parser.add_argument("--script", choices=("eslav", "latin"), default="eslav")
    parser.add_argument("--server", type=loopback_url, default="http://127.0.0.1:8080")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--timeout", type=int, default=360)
    args = parser.parse_args()
    if args.page < 1 or not 72 <= args.dpi <= 600:
        parser.error("invalid page or dpi")
    source = args.pdf.read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    if source_hash != args.expected_sha256:
        parser.error("original PDF sha256 mismatch")

    started = time.monotonic()
    png, render_headers = post_multipart(
        args.server + "/v1/render",
        {"page": str(args.page), "dpi": str(args.dpi)},
        args.pdf.name, source, "application/pdf", args.timeout,
    )
    render_seconds = round(time.monotonic() - started, 2)
    if args.render_only:
        image_path = args.report.with_suffix(".png")
        image_path.write_bytes(png)
        print(json.dumps({"renderSha256": hashlib.sha256(png).hexdigest(), "renderSeconds": render_seconds, "image": str(image_path)}))
        return
    started = time.monotonic()
    result, _ = post_multipart(
        args.server + "/v1/ocr", {"script": args.script},
        f"page-{args.page}.png", png, "image/png", args.timeout,
    )
    ocr_seconds = round(time.monotonic() - started, 2)
    payload = json.loads(result)
    report = {
        "schemaVersion": "document-public-smoke-v1",
        "source": {"name": args.pdf.name, "sha256": source_hash, "page": args.page},
        "render": {
            "sha256": hashlib.sha256(png).hexdigest(),
            "byteSize": len(png),
            "dpi": args.dpi,
            "width": int(render_headers["x-render-width"]),
            "height": int(render_headers["x-render-height"]),
            "sourcePageCount": int(render_headers["x-source-page-count"]),
            "profileId": render_headers["x-renderer-profile"],
            "seconds": render_seconds,
        },
        "ocr": payload,
        "ocrSeconds": ocr_seconds,
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "source": report["source"],
        "render": report["render"],
        "ocrProfileId": payload.get("profileId"),
        "ocrResultCount": len(payload.get("results", [])),
        "ocrSeconds": ocr_seconds,
        "report": str(args.report),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
