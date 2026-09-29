#!/usr/bin/env python3
"""Find TRAIN_PUBLIC PDF pages with a local embedding model before reading labels.

The public case supplies only a room and parameter as the query. Its evidence
pages and verdict are opened only after ranking, for evaluation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlparse


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def loopback(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise argparse.ArgumentTypeError("embedding URL must use local HTTP loopback")
    return value.rstrip("/")


def page_texts(path: Path, count: int) -> list[str]:
    result = subprocess.run(
        ["pdftotext", "-raw", str(path), "-"], check=True, capture_output=True,
        timeout=300,
    )
    pages = result.stdout.decode("utf-8", errors="replace").split("\f")
    if len(pages) == count + 1 and not pages[-1].strip():
        pages.pop()
    if len(pages) != count:
        raise ValueError(f"pdftotext returned {len(pages)} pages; manifest requires {count}: {path}")
    return pages


def page_excerpt(page: str, location: str) -> str:
    lines = page.splitlines()
    pattern = re.compile(rf"(?<!\d){re.escape(location)}(?!\d)", re.IGNORECASE)
    hit_lines = [index for index, line in enumerate(lines) if pattern.search(line)]
    selected = set(range(min(8, len(lines))))
    for index in hit_lines[:10]:
        selected.update(range(max(0, index - 2), min(len(lines), index + 3)))
    selected.update(range(max(0, len(lines) - 4), len(lines)))
    return "\n".join(lines[index] for index in sorted(selected))[:2400]


def embed(url: str, model: str, texts: list[str], timeout: int) -> list[list[float]]:
    request = urllib.request.Request(
        url + "/v1/embeddings",
        data=json.dumps({"model": model, "input": texts}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    vectors = [item["embedding"] for item in sorted(payload["data"], key=lambda item: item["index"])]
    if len(vectors) != len(texts) or any(len(vector) != 1024 for vector in vectors):
        raise ValueError("embedding response has unexpected shape")
    return vectors


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def discipline(parameter_code: str, parameter_name: str) -> str | None:
    # The free-search code names its discipline; public expected values are never used.
    if parameter_code.startswith("FREE-HEATING-") or "отоплен" in parameter_name.lower():
        return "heating"
    if "вентиляц" in parameter_name.lower() or "воздуховод" in parameter_name.lower():
        return "ventilation"
    return None


def structural_score(page: str, cover: str, section: str | None, subject: str | None) -> tuple[int, list[str]]:
    """Rank actual drawings before coincidental room numbers in specifications."""
    lower = page.lower()
    cover = cover.lower()
    reasons: list[str] = []
    score = 0
    if "принципиальная схема" in lower:
        score += 6
        reasons.append("schematic")
    elif "экспликация помещений" in lower:
        score += 6
        reasons.append("floor-plan")
    elif "план систем" in lower or "план сетей" in lower:
        score += 5
        reasons.append("plan")
    if section == "OV":
        score += 1
    if subject == "heating":
        if "отоплен" in cover and "вентиляц" not in cover:
            score += 3
            reasons.append("heating-volume")
        if re.search(r"схема\s+системы?\s+отопления", lower):
            score += 2
            reasons.append("heating-sheet")
    elif subject == "ventilation":
        if "вентиляц" in cover and "отоплен" not in cover:
            score += 3
            reasons.append("ventilation-volume")
        if "общеобменной вентиляции" in lower:
            score += 2
            reasons.append("ventilation-sheet")
        elif "приточных установок" in lower:
            score += 1
            reasons.append("supply-unit-sheet")
    return score, reasons


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--public-checks", type=Path, required=True)
    parser.add_argument("--case-id", action="append", required=True)
    parser.add_argument("--source", action="append", required=True, metavar="FILE_ID=PDF_PATH")
    parser.add_argument("--embedding-url", type=loopback, default="http://127.0.0.1:18085")
    parser.add_argument("--ranker", choices=("embedding", "structural"), default="embedding")
    parser.add_argument("--model", default="inspector-qwen3-embedding-0.6b")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 32:
        parser.error("batch size must be 1..32")

    manifest = {item["file_id"]: item for item in rows(args.manifest)}
    public_rows = {item["check_id"]: item for item in rows(args.public_checks)}
    catalog_path = args.public_checks.parent / "parameter_catalog_132.jsonl"
    catalog = {item["parameter_code"]: item for item in rows(catalog_path)}
    cases: list[dict] = []
    for case_id in args.case_id:
        case = public_rows.get(case_id)
        if not case or case.get("split") != "TRAIN_PUBLIC" or case.get("visibility") != "PUBLIC_TRAIN_LABEL":
            parser.error(f"{case_id} is not a public training case")
        if not isinstance(case.get("location"), str) or not case["location"].isdigit():
            parser.error(f"{case_id} needs a numeric room location")
        cases.append(case)

    sources: dict[str, dict] = {}
    for item in args.source:
        if "=" not in item:
            parser.error("--source must be FILE_ID=PDF_PATH")
        file_id, raw_path = item.split("=", 1)
        if file_id in sources:
            parser.error(f"duplicate source {file_id}")
        entry = manifest.get(file_id)
        if not entry or entry.get("split") != "TRAIN_PUBLIC" or entry.get("distribution_status") != "INCLUDE":
            parser.error(f"{file_id} is not an included TRAIN_PUBLIC source")
        path = Path(raw_path)
        if not path.is_file() or path.stat().st_size != entry["size_bytes"] or digest(path) != entry["sha256"]:
            parser.error(f"size or SHA-256 mismatch for {file_id}")
        pages = page_texts(path, entry["pdf_pages"])
        sources[file_id] = {"manifest": entry, "pages": pages, "cover": "\n".join(pages[:3])}
    if not any(item["manifest"].get("stage") == "PD" for item in sources.values()):
        parser.error("a PD source is required")
    if not any(item["manifest"].get("stage") == "RD_ID_MIXED" for item in sources.values()):
        parser.error("an RD source is required")

    # Build candidates without inspecting case evidence, verdict, or expected values.
    candidates: list[dict] = []
    for case in cases:
        location = case["location"]
        pattern = re.compile(rf"(?<!\d){re.escape(location)}(?!\d)")
        for file_id, source in sources.items():
            if source["manifest"].get("object_id") != case.get("object_id"):
                continue
            stage = "PD" if source["manifest"]["stage"] == "PD" else "RD"
            for index, page in enumerate(source["pages"], 1):
                if pattern.search(page):
                    candidates.append({
                        "caseId": case["check_id"], "stage": stage,
                        "fileId": file_id, "sourcePage": index,
                        "text": page_excerpt(page, location), "page": page,
                    })
    if not candidates:
        raise ValueError("no lexical candidates found")
    started = time.monotonic()
    if args.ranker == "embedding":
        for index in range(0, len(candidates), args.batch_size):
            batch = candidates[index:index + args.batch_size]
            vectors = embed(args.embedding_url, args.model, [item["text"] for item in batch], args.timeout)
            for candidate, vector in zip(batch, vectors):
                candidate["vector"] = vector
            print(f"embedded {min(index + len(batch), len(candidates))}/{len(candidates)}", file=sys.stderr)

    results: list[dict] = []
    for case in cases:
        parameter_name = catalog.get(case.get("parameter_code"), {}).get("parameter_name", "отопление и вентиляция")
        query = f"Помещение {case['location']}. {parameter_name}. Сопоставление проектной и рабочей документации по отоплению и вентиляции."
        query_vector = embed(args.embedding_url, args.model, [query], args.timeout)[0] if args.ranker == "embedding" else None
        subject = discipline(case.get("parameter_code") or "", parameter_name)
        stages: dict[str, dict] = {}
        for stage in ("PD", "RD"):
            ranked = [item for item in candidates if item["caseId"] == case["check_id"] and item["stage"] == stage]
            if args.ranker == "embedding":
                ranked.sort(key=lambda item: -dot(query_vector, item["vector"]))
                for item in ranked:
                    item["score"] = round(dot(query_vector, item["vector"]), 6)
            else:
                for item in ranked:
                    source = sources[item["fileId"]]
                    item["score"], item["reasons"] = structural_score(
                        item["page"], source["cover"], source["manifest"].get("section"), subject,
                    )
                ranked.sort(key=lambda item: (-item["score"], item["fileId"], item["sourcePage"]))
            # The public answer is read only here, after all ranking is complete.
            gold = {(item["file_id"], item["pdf_page_number"]) for item in case["evidence"] if item["stage"] == stage}
            gold_ranks = [
                {"fileId": file_id, "sourcePage": page,
                 "rank": next((i for i, item in enumerate(ranked, 1) if item["fileId"] == file_id and item["sourcePage"] == page), None)}
                for file_id, page in sorted(gold)
            ]
            stages[stage] = {
                "candidateCount": len(ranked),
                "topPages": [{k: item[k] for k in ("fileId", "sourcePage", "score", "reasons") if k in item} for item in ranked[:10]],
                "goldRanks": gold_ranks,
            }
        results.append({
            "caseId": case["check_id"], "location": case["location"],
            "parameterCode": case.get("parameter_code"), "query": query,
            "stages": stages,
            "selection": [
                {"stage": stage, **stages[stage]["topPages"][0]}
                for stage in ("PD", "RD") if stages[stage]["topPages"]
            ],
            "publicLabel": case["comparison_result"],
        })
    report = {
        "schemaVersion": "local-public-retrieval-v1", "model": args.model if args.ranker == "embedding" else None,
        "method": "exact-room-lexical-filter-then-" + args.ranker,
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "sources": [{"fileId": file_id, "sha256": source["manifest"]["sha256"],
                     "pageCount": len(source["pages"])} for file_id, source in sources.items()],
        "cases": results, "domainDecision": "NOT_ACCEPTED_PROBE_ONLY",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"elapsedSeconds": report["elapsedSeconds"], "cases": [
        {"caseId": item["caseId"], "PD": item["stages"]["PD"]["goldRanks"],
         "RD": item["stages"]["RD"]["goldRanks"]} for item in results
    ]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
