#!/usr/bin/env python3
"""Read-only smoke for scoped source listing, review lookup and original bytes."""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:14100")
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--object-id", required=True)
    parser.add_argument("--file-id", help="Original to verify; defaults to the smallest file")
    args = parser.parse_args()

    credentials = dict(
        line.split("=", 1)
        for line in args.credentials_file.read_text().splitlines()
        if "=" in line
    )
    if not credentials.get("login") or not credentials.get("password"):
        parser.error("credentials file needs login and password")

    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    base = args.base_url.rstrip("/")
    login = urllib.request.Request(
        base + "/api/auth/login",
        json.dumps({"login": credentials["login"], "password": credentials["password"]}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(login, timeout=30):
        pass

    object_id = urllib.parse.quote(args.object_id, safe="")
    with opener.open(base + f"/api/objects/{object_id}/files", timeout=30) as response:
        files = json.load(response)["items"]
    if not files:
        raise RuntimeError("object has no source files")
    for row in files:
        if not isinstance(row.get("sha256"), str) or len(row["sha256"]) != 64:
            raise RuntimeError("source list has no SHA-256")
        if not isinstance(row.get("stages"), list) or not row["stages"]:
            raise RuntimeError("source list has no stages")

    selected = next((row for row in files if row["id"] == args.file_id), None) if args.file_id else min(
        files, key=lambda row: row["size"]
    )
    if selected is None:
        raise RuntimeError("requested source file is not in this object")
    source_path = f"/api/objects/{object_id}/files/{urllib.parse.quote(selected['id'], safe='')}"
    try:
        with opener.open(base + source_path + "/source-review", timeout=30) as response:
            review = json.load(response)
            review_status = response.status
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        review = None
        review_status = 404
    if review is not None and (review["sourceFileId"] != selected["id"]
                               or review["sourceSha256"] != selected["sha256"]):
        raise RuntimeError("source review does not match the selected original")

    size = 0
    digest = hashlib.sha256()
    with opener.open(base + source_path + "/content", timeout=180) as response:
        if response.status != 200 or "attachment" not in response.headers.get("Content-Disposition", ""):
            raise RuntimeError("source download is not an attachment")
        header_hash = response.headers.get("X-Content-SHA256", "")
        while block := response.read(1024 * 1024):
            size += len(block)
            digest.update(block)
    if size != selected["size"] or digest.hexdigest() != selected["sha256"] or header_hash != selected["sha256"]:
        raise RuntimeError("downloaded source bytes failed size or SHA-256 verification")
    print(json.dumps({
        "objectId": args.object_id,
        "sourceCount": len(files),
        "verifiedFileId": selected["id"],
        "verifiedBytes": size,
        "sha256Verified": True,
        "reviewStatus": review_status,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
