#!/usr/bin/env python3
"""Probe a local model on original TRAIN_PUBLIC evidence pages.

This is a qualification probe. It does not insert findings into the application.
The public label selects pages and is added to the report only after inference.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_page_text(path: Path, page: int) -> str:
    result = subprocess.run(
        ["pdftotext", "-f", str(page), "-l", str(page), "-raw", str(path), "-"],
        check=True, capture_output=True, text=True, timeout=90,
    )
    return result.stdout


def excerpt(text: str, location: str, limit: int = 11000) -> str:
    if len(text) <= limit:
        return text
    lines = text.splitlines()
    selected = set(range(min(24, len(lines))))
    if location:
        pattern = re.compile(rf"(?<!\d){re.escape(location)}(?!\d)", re.IGNORECASE)
        for index, line in enumerate(lines):
            if pattern.search(line):
                selected.update(range(max(0, index - 4), min(len(lines), index + 5)))
    selected.update(range(max(0, len(lines) - 14), len(lines)))
    return "\n".join(lines[index] for index in sorted(selected))[:limit]


def render_page(path: Path, page: int) -> bytes:
    with tempfile.TemporaryDirectory(prefix="inspector-public-page-") as temp_dir:
        prefix = str(Path(temp_dir) / "page")
        subprocess.run(
            ["pdftoppm", "-f", str(page), "-l", str(page),
             "-scale-to", "1280", "-singlefile", "-png", str(path), prefix],
            check=True, capture_output=True, timeout=120,
        )
        return Path(prefix + ".png").read_bytes()


def local_model_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise argparse.ArgumentTypeError("model endpoint must be local HTTP on loopback")
    return value.rstrip("/")


def normalized_quote(value: str) -> str:
    return " ".join(value.casefold().split())


def load_ocr_report(path: Path, *, file_id: str, page: int, pdf_path: Path, source_hash: str) -> tuple[list[str], list[list[float]], list[float], dict]:
    report = json.loads(path.read_text(encoding="utf-8"))
    source = report.get("source", {})
    if (report.get("schemaVersion") != "document-public-smoke-v1"
            or source.get("name") != pdf_path.name
            or source.get("sha256") != source_hash
            or source.get("page") != page):
        raise ValueError(f"OCR report does not match verified {file_id} page {page}")
    ocr = report.get("ocr", {})
    results = ocr.get("results", [])
    if (ocr.get("schemaVersion") != "document-ai-ocr-response-v1"
            or not isinstance(results, list) or len(results) != 1):
        raise ValueError(f"invalid OCR result for {file_id} page {page}")
    overall = results[0].get("overall_ocr_res", {})
    lines = overall.get("rec_texts", [])
    scores = overall.get("rec_scores", [])
    boxes = overall.get("rec_boxes", [])
    render = report.get("render", {})
    width, height = render.get("width"), render.get("height")
    if (not isinstance(lines, list) or not isinstance(scores, list) or not isinstance(boxes, list)
            or not (len(lines) == len(scores) == len(boxes))
            or any(not isinstance(line, str) for line in lines)
            or not isinstance(width, int) or not isinstance(height, int)
            or width < 1 or height < 1
            or any(not isinstance(score, (int, float)) or not 0 <= score <= 1 for score in scores)
            or any(not isinstance(box, list) or len(box) != 4
                   or any(not isinstance(value, (int, float)) or isinstance(value, bool)
                          or not math.isfinite(value) for value in box)
                   or not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)
                   for box in boxes)):
        raise ValueError(f"invalid OCR line geometry for {file_id} page {page}")
    return lines, boxes, scores, {
        "profileId": ocr.get("profileId"),
        "renderSha256": render.get("sha256"),
        "renderWidth": width,
        "renderHeight": height,
        "lineCount": len(lines),
        "seconds": report.get("ocrSeconds"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--public-checks", type=Path, required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--source", action="append", required=True, metavar="FILE_ID=PDF_PATH")
    parser.add_argument("--model-url", type=local_model_url, default="http://127.0.0.1:18082")
    parser.add_argument("--model", default="inspector-bonsai-2-27b")
    parser.add_argument("--mode", choices=("text", "vision", "ocr", "ocr-live"), default="text")
    parser.add_argument("--ocr-report", action="append", default=[], metavar="FILE_ID:PAGE=JSON_PATH")
    parser.add_argument("--document-url", type=local_model_url, default="http://127.0.0.1:18084")
    parser.add_argument("--ocr-artifacts-dir", type=Path)
    parser.add_argument("--retrieval-report", type=Path,
                        help="use the top PD/RD pages from an independent blind retrieval run")
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "ocr-live" and args.ocr_report:
        parser.error("--ocr-report cannot be combined with --mode ocr-live")
    if args.mode != "ocr-live" and args.ocr_artifacts_dir:
        parser.error("--ocr-artifacts-dir requires --mode ocr-live")

    manifest = {row["file_id"]: row for row in read_jsonl(args.manifest)}
    cases = [row for row in read_jsonl(args.public_checks) if row.get("check_id") == args.case_id]
    if len(cases) != 1 or cases[0].get("split") != "TRAIN_PUBLIC" or cases[0].get("visibility") != "PUBLIC_TRAIN_LABEL":
        parser.error("case must be one public TRAIN_PUBLIC label")
    case = cases[0]
    catalog_path = args.public_checks.parent / "parameter_catalog_132.jsonl"
    catalog = {row["parameter_code"]: row for row in read_jsonl(catalog_path)} if catalog_path.is_file() else {}
    parameter = catalog.get(case.get("parameter_code"), {})
    sources: dict[str, Path] = {}
    for item in args.source:
        if "=" not in item:
            parser.error("--source requires FILE_ID=PDF_PATH")
        file_id, raw_path = item.split("=", 1)
        if file_id in sources:
            parser.error(f"duplicate source {file_id}")
        sources[file_id] = Path(raw_path)
    ocr_reports: dict[tuple[str, int], Path] = {}
    for item in args.ocr_report:
        if "=" not in item or ":" not in item.split("=", 1)[0]:
            parser.error("--ocr-report requires FILE_ID:PAGE=JSON_PATH")
        reference, raw_path = item.split("=", 1)
        file_id, raw_page = reference.rsplit(":", 1)
        try:
            key = (file_id, int(raw_page))
        except ValueError:
            parser.error("--ocr-report page must be an integer")
        if key in ocr_reports:
            parser.error(f"duplicate OCR report for {key}")
        ocr_reports[key] = Path(raw_path)

    retrieval_binding = None
    evidence = case.get("evidence", [])
    if args.retrieval_report:
        retrieval = json.loads(args.retrieval_report.read_text(encoding="utf-8"))
        if retrieval.get("schemaVersion") != "local-public-retrieval-v1":
            parser.error("invalid retrieval report schema")
        selected_cases = [item for item in retrieval.get("cases", []) if item.get("caseId") == args.case_id]
        selected = selected_cases[0].get("selection", []) if len(selected_cases) == 1 else []
        if len(selected) != 2 or {item.get("stage") for item in selected} != {"PD", "RD"}:
            parser.error("retrieval report must select one PD and one RD page")
        source_hashes = {item.get("fileId"): item.get("sha256") for item in retrieval.get("sources", [])}
        for item in selected:
            source = manifest.get(item.get("fileId"))
            expected_stage = "PD" if item["stage"] == "PD" else "RD_ID_MIXED"
            if (not source or source.get("split") != "TRAIN_PUBLIC"
                    or source.get("distribution_status") != "INCLUDE"
                    or source.get("stage") != expected_stage
                    or source_hashes.get(item["fileId"]) != source.get("sha256")
                    or not isinstance(item.get("sourcePage"), int)
                    or not 1 <= item["sourcePage"] <= source["pdf_pages"]):
                parser.error("retrieval page does not match a verified public source")
        evidence = [
            {"stage": item["stage"], "file_id": item["fileId"],
             "pdf_page_number": item["sourcePage"]}
            for item in selected
        ]
        retrieval_binding = {
            "reportSha256": sha256_file(args.retrieval_report),
            "model": retrieval.get("model"),
            "method": retrieval.get("method"),
        }
    if not isinstance(evidence, list) or not evidence:
        parser.error("public case has no evidence pages")
    pages = []
    page_texts: dict[tuple[str, int], str] = {}
    page_ocr_lines: dict[tuple[str, int], list[str]] = {}
    page_ocr_boxes: dict[tuple[str, int], list[list[float]]] = {}
    page_ocr_scores: dict[tuple[str, int], list[float]] = {}
    content: list[dict] = []
    scratch = tempfile.TemporaryDirectory(prefix="inspector-ocr-live-") if args.mode == "ocr-live" and not args.ocr_artifacts_dir else None
    if args.ocr_artifacts_dir:
        args.ocr_artifacts_dir.mkdir(parents=True, exist_ok=True)
    for item in evidence:
        file_id, page = item["file_id"], item["pdf_page_number"]
        source = manifest.get(file_id)
        if not source or source.get("split") != "TRAIN_PUBLIC" or source.get("distribution_status") != "INCLUDE":
            parser.error(f"{file_id} is not an included TRAIN_PUBLIC source")
        path = sources.get(file_id)
        if path is None or not path.is_file():
            parser.error(f"missing original PDF for {file_id}")
        if path.stat().st_size != source["size_bytes"]:
            parser.error(f"size mismatch for {file_id}")
        actual_hash = sha256_file(path)
        if actual_hash != source["sha256"]:
            parser.error(f"SHA-256 mismatch for {file_id}")
        if not isinstance(page, int) or not 1 <= page <= source["pdf_pages"]:
            parser.error(f"invalid source page for {file_id}")
        text = extract_page_text(path, page)
        page_texts[(file_id, page)] = text
        page_record = {
            "fileId": file_id,
            "stage": item["stage"],
            "sourcePage": page,
            "sourceSha256": actual_hash,
            "textCharacters": len(text),
            "textExcerpt": excerpt(text, str(case.get("location", "")), 3500 if args.mode in {"vision", "ocr", "ocr-live"} else 11000),
        }
        if args.mode in {"ocr", "ocr-live"}:
            report_path = ocr_reports.get((file_id, page))
            if args.mode == "ocr-live":
                report_root = args.ocr_artifacts_dir or Path(scratch.name)
                report_path = report_root / f"{file_id}-page{page}-ocr.json"
                subprocess.run(
                    [
                        sys.executable, str(Path(__file__).with_name("smoke-document-public.py")),
                        "--pdf", str(path), "--expected-sha256", actual_hash,
                        "--page", str(page), "--dpi", "100", "--server", args.document_url,
                        "--report", str(report_path), "--timeout", str(args.timeout),
                    ],
                    check=True, capture_output=True, text=True, timeout=args.timeout + 30,
                )
            if report_path is None or not report_path.is_file():
                parser.error(f"missing OCR report for {file_id} page {page}")
            try:
                lines, boxes, scores, ocr_metadata = load_ocr_report(
                    report_path, file_id=file_id, page=page,
                    pdf_path=path, source_hash=actual_hash,
                )
            except (ValueError, OSError, json.JSONDecodeError) as error:
                parser.error(str(error))
            page_ocr_lines[(file_id, page)] = lines
            page_ocr_boxes[(file_id, page)] = boxes
            page_ocr_scores[(file_id, page)] = scores
            page_record["ocr"] = ocr_metadata
            page_record["ocrExcerpt"] = excerpt("\n".join(lines), str(case.get("location", "")), 5000)
        pages.append(page_record)
        content.append({"type": "text", "text": json.dumps(page_record, ensure_ascii=False)})
        if args.mode == "vision":
            image = render_page(path, page)
            page_record["renderSha256"] = hashlib.sha256(image).hexdigest()
            content.append({
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode("ascii")},
            })

    quote_rule = {
        "vision": "фрагментами переданного текста или уверенно читаемыми с изображения. ",
        "ocr": "фрагментами текстового слоя или OCR-строк. ",
        "ocr-live": "фрагментами текстового слоя или OCR-строк. ",
        "text": "фрагментами переданного текста. ",
    }[args.mode]
    input_note = {
        "vision": "Переданы текстовые фрагменты и изображения страниц.",
        "ocr": "Переданы текстовые фрагменты и OCR-строки с тех же страниц.",
        "ocr-live": "Переданы текстовые фрагменты и OCR-строки с тех же страниц.",
        "text": "Переданы только текстовые фрагменты страниц.",
    }[args.mode]
    question = (
        "Сравни ПД и РД по указанному помещению, если страниц достаточно. "
        "Рассматривай наблюдаемую конфигурацию отопления и вентиляции. "
        "Совпадение названия помещения само по себе не доказывает совпадение конфигурации. "
        "Не считай отсутствие слова доказательством "
        "отсутствия элемента на чертеже. Если невозможно установить расхождение по данным "
        "фрагментам, ответь INSUFFICIENT_EVIDENCE. Верни только JSON с ключами "
        "verdict (MATCH, MISMATCH или INSUFFICIENT_EVIDENCE), explanation, "
        "evidence (массив объектов fileId, sourcePage, quote). Цитаты должны быть дословными "
        + quote_rule
        + f"Помещение: {case.get('location')}. Параметр: {case.get('parameter_code')}. "
        f"Предмет параметра из публичного каталога: {parameter.get('parameter_name', 'не указан')}. "
        + input_note
    )
    content.insert(0, {"type": "text", "text": question})
    request_body = {
        "model": args.model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "max_tokens": 512,
    }
    request = urllib.request.Request(
        args.model_url + "/v1/chat/completions",
        data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        model_response = json.load(response)
    elapsed = round(time.monotonic() - started, 2)
    choice = model_response["choices"][0]
    answer = choice["message"].get("content") or ""
    try:
        parsed = json.loads(answer)
    except json.JSONDecodeError:
        parsed = None
    verdict = parsed.get("verdict") if isinstance(parsed, dict) else None
    if verdict not in {"MATCH", "MISMATCH", "INSUFFICIENT_EVIDENCE"}:
        verdict = "INVALID_RESPONSE"
    citations = []
    for citation in parsed.get("evidence", []) if isinstance(parsed, dict) and isinstance(parsed.get("evidence"), list) else []:
        if not isinstance(citation, dict):
            continue
        file_id = citation.get("fileId")
        page = citation.get("sourcePage")
        quote = citation.get("quote")
        source_text = page_texts.get((file_id, page)) if isinstance(file_id, str) and isinstance(page, int) else None
        verified = (
            isinstance(quote, str) and len(quote.strip()) >= 4
            and source_text is not None
            and normalized_quote(quote) in normalized_quote(source_text)
        )
        citations.append({"fileId": file_id, "sourcePage": page, "quote": quote, "textLayerVerified": bool(verified)})
        if args.mode in {"ocr", "ocr-live"}:
            ocr_lines = page_ocr_lines.get((file_id, page), [])
            matched_index = next((
                index for index, line in enumerate(ocr_lines)
                if isinstance(quote, str) and len(quote.strip()) >= 4
                and normalized_quote(quote) in normalized_quote(line)
            ), None)
            citations[-1]["ocrLineVerified"] = matched_index is not None
            if matched_index is not None:
                citations[-1]["ocrPixelBox"] = page_ocr_boxes[(file_id, page)][matched_index]
                citations[-1]["ocrConfidence"] = page_ocr_scores[(file_id, page)][matched_index]
    report = {
        "schemaVersion": "local-public-probe-v1",
        "caseId": args.case_id,
        "mode": args.mode,
        "model": args.model,
        "modelSeconds": elapsed,
        "inferencePrompt": question,
        "generationConfig": {"temperature": 0, "maxTokens": 512},
        "pages": pages,
        "answer": answer,
        "verdict": verdict,
        "domainDecision": "NOT_ACCEPTED_PROBE_ONLY",
        "citations": citations,
        "finishReason": choice.get("finish_reason"),
        "usage": model_response.get("usage"),
        "publicLabel": case["comparison_result"],
        "publicViolationLabel": case["violation_label"],
    }
    if retrieval_binding is not None:
        selected_keys = {(item["file_id"], item["pdf_page_number"]) for item in evidence}
        gold_keys = {(item["file_id"], item["pdf_page_number"]) for item in case["evidence"]}
        report["retrieval"] = {
            **retrieval_binding,
            "selectedGoldPages": len(selected_keys & gold_keys),
            "goldPageCount": len(gold_keys),
        }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if scratch is not None:
        scratch.cleanup()
    print(json.dumps({key: report[key] for key in ("caseId", "mode", "modelSeconds", "verdict", "domainDecision", "finishReason", "publicLabel")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
