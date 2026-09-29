#!/usr/bin/env python3
"""Plan and run a bounded public OCR triage for the 80 unresolved codes.

No OCR lead is a fact, finding, coverage decision, or absence proof.
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
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

SUMMARY = ROOT / "output/unresolved-public-summary-20260927/summary.json"
MANIFEST = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
AUDIT = ROOT / "output/public-index-20260927/index-audit.json"
PATTERN_POLICY = ROOT / "output/unresolved-ocr-20260927/pattern-policy.json"
RENDERER = "renderer-pdfium-5.12.1-linux-x86_64-v1"
PROVIDER = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1"
SCRIPT = "eslav"
MAX_PAGES = 80


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    result = json.loads(path.read_bytes())
    if not isinstance(result, dict):
        raise ValueError(f"not a JSON object: {path}")
    return result


def write_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                      allow_nan=False) + "\n").encode()
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".",
                                     suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _reports() -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, str]]:
    summary = read_json(SUMMARY)
    if (summary.get("summary", {}).get("unresolvedCodeCount") != 80
            or summary.get("summary", {}).get("reviewedBatchCount") != 7
            or summary.get("sourceScope") != "TRAIN_PUBLIC+INCLUDE+PUBLIC_TRAIN; no hidden answers"):
        raise ValueError("unresolved summary scope/count changed")
    if (file_sha(MANIFEST) != summary["inputSha256"]["manifest"]
            or file_sha(AUDIT) != summary["inputSha256"]["audit"]):
        raise ValueError("manifest or PASS audit hash differs from summary")
    audit = read_json(AUDIT)
    if audit.get("status") != "PASS":
        raise ValueError("public index audit not PASS")
    reports = {}
    hashes = {}
    for name, record in summary["batchReports"].items():
        path = ROOT / record["path"]
        digest = file_sha(path)
        if digest != record["fileSha256"] or record.get("findingCount") is not None:
            raise ValueError(f"stale or promoted batch: {name}")
        reports[name] = read_json(path)
        hashes[name] = digest
    if set(reports) != {"utility", "engineering", "ar", "pos", "pz_spzu", "kr", "pod_oos"}:
        raise ValueError("unresolved batch inventory changed")
    return summary, reports, hashes


def _public_manifest() -> dict[str, dict[str, Any]]:
    rows = {}
    for raw in MANIFEST.read_bytes().splitlines():
        row = json.loads(raw)
        sid = row["file_id"]
        if sid in rows:
            raise ValueError("duplicate manifest source ID")
        rows[sid] = row
    return rows


def _role(row: dict[str, Any]) -> str:
    if row["stage"] == "RD_ID_MIXED":
        return "MIXED_STAGE_UNRESOLVED"
    if row["section"] == "OTHER":
        return "SECTION_UNRESOLVED"
    return "MANIFEST_STAGE_SECTION_ONLY"


def _proposals(reports: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    proposals = []

    def add(name: str, item: dict[str, Any], *, family: str, reason: str,
            codes: list[str] | None = None, anchors: list[dict[str, Any]] | None = None) -> None:
        proposals.append({
            "batch": name, "sourceFileId": item["sourceFileId"],
            "pageNumber": item["pageNumber"],
            "sourceSha256": item.get("sourceSha256"),
            "pageArtifactSha256": item["pageArtifactSha256"],
            "family": family, "reason": reason,
            "codes": sorted(set(codes or [])), "nearbyTextAnchors": anchors or [],
        })

    utility = reports["utility"]["targetedOcrQueue"]["families"]
    for family, group in utility.items():
        if group.get("queueTruncated") or len(group["pages"]) != group["displayCount"]:
            raise ValueError("utility OCR proposal list truncated")
        for item in group["pages"]:
            add("utility", item, family=family, reason=item["reason"],
                codes=[item["parameterCode"]])

    eng = reports["engineering"]
    source_hashes = {item["sourceFileId"]: item["sourceSha256"] for item in eng["sources"]}
    if len(eng["ocrProposals"]) != 9:
        raise ValueError("engineering OCR proposal count changed")
    for item in eng["ocrProposals"]:
        add("engineering", {**item, "sourceSha256": source_hashes[item["sourceFileId"]]},
            family="ENGINEERING_MIXED", reason=item["reason"])
    if {(item["sourceFileId"], item["pageNumber"]) for item in eng["ocrProposals"]
            if item["sourceFileId"] == "F0204"} != {("F0204", 6), ("F0204", 7)}:
        raise ValueError("F0204 p6-7 not both in engineering proposals")

    ar = reports["ar"]["targetedOcrQueue"]
    if ar.get("queueTruncated") or len(ar["pages"]) != 9:
        raise ValueError("AR OCR proposal count changed")
    for item in ar["pages"]:
        add("ar", item, family="AR", reason=item["reason"])

    pos = reports["pos"]["ocrProposals"]
    if {(x["sourceFileId"], x["pageNumber"]) for x in pos} != {
            ("F0112", page) for page in range(78, 83)}:
        raise ValueError("POS drawing sheet proposal changed")
    for item in pos:
        add("pos", item, family="POS", reason=item["reason"])

    pz = reports["pz_spzu"]
    if pz.get("ocrQueueOmitted") != 0 or len(pz["ocrQueue"]) != 21:
        raise ValueError("PZ/SPZU OCR proposal count changed")
    leads_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for code, detail in pz["codeReports"].items():
        for lead in detail["leads"]:
            leads_by_source[lead["sourceFileId"]].append({
                "parameterCode": code, "pageNumber": lead["pageNumber"],
                "lineSha256": lead["lineSha256"], "text": lead["text"][:140],
            })
    for item in pz["ocrQueue"]:
        nearby = [lead for lead in leads_by_source[item["sourceFileId"]]
                  if abs(lead["pageNumber"] - item["pageNumber"]) <= 2]
        if not nearby:
            continue  # no same-source literal text anchor; keep UNKNOWN outside queue
        nearby.sort(key=lambda lead: (abs(lead["pageNumber"] - item["pageNumber"]),
                                      lead["parameterCode"], lead["lineSha256"]))
        add("pz_spzu", item, family="PZ_SPZU",
            reason=f"OCR_REQUIRED_WITH_NEARBY_LITERAL_TEXT_ANCHOR_DISTANCE_{item['distanceToSelectedTextPage']}",
            codes=[lead["parameterCode"] for lead in nearby], anchors=nearby[:4])
    return proposals


def build_plan(index_root: Path) -> dict[str, Any]:
    summary, reports, report_hashes = _reports()
    manifest = _public_manifest()
    proposals = _proposals(reports)
    by_key: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for proposal in proposals:
        by_key[(proposal["sourceFileId"], proposal["pageNumber"])].append(proposal)
    if not 1 <= len(by_key) <= MAX_PAGES:
        raise ValueError("bounded OCR queue exceeded 80 unique pages")
    index_path = index_root / "index.sqlite3"
    if not index_path.is_file():
        raise ValueError("public index absent")
    connection = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
    pages = []
    try:
        for (source_id, number), origins in sorted(by_key.items()):
            row = manifest.get(source_id)
            if (row is None or row["split"] != "TRAIN_PUBLIC"
                    or row["distribution_status"] != "INCLUDE"
                    or row["label_visibility"] != "PUBLIC_TRAIN"
                    or row["extension"] != ".pdf"):
                raise ValueError(f"source outside public allowlist: {source_id}")
            records = connection.execute(
                "SELECT source_sha256, disposition, artifact_path, artifact_sha256 FROM pages "
                "WHERE source_id=? AND page_number=?", (source_id, number)).fetchall()
            if len(records) != 1:
                raise ValueError("queued page absent or duplicated in index")
            source_hash, disposition, artifact_path, artifact_hash = records[0]
            if disposition != "OCR_REQUIRED" or source_hash != row["sha256"]:
                raise ValueError("queued page not OCR_REQUIRED or source SHA changed")
            path = index_root / artifact_path
            if file_sha(path) != artifact_hash:
                raise ValueError("queued index page SHA changed")
            page = json.loads(gzip.decompress(path.read_bytes()))
            if page["inputSha256"] != source_hash or page["pageNumber"] != number:
                raise ValueError("queued index page identity changed")
            if any(item["sourceSha256"] not in {None, source_hash}
                   or item["pageArtifactSha256"] != artifact_hash for item in origins):
                raise ValueError("batch proposal differs from indexed PDF/page SHA")
            # PDFium has 25m pixels cap. Keep margin below it; 115 DPI for
            # F0193 p55/p56 is known to pass from prior targeted attempt.
            width = page["widthMilliPoints"] / 1000
            height = page["heightMilliPoints"] / 1000
            dpi = min(120, int(math.floor(72 * math.sqrt(24_500_000 / (width * height)))))
            if source_id == "F0193" and number in {55, 56}:
                dpi = min(dpi, 115)
            # Seven dense 22m-pixel ODI drawings exceeded the 360s local
            # provider timeout at 120 DPI (F0173 p27). This is a bounded
            # triage retry, not a change to the source or an absence claim.
            if (source_id, number) in {
                    ("F0173", 27), ("F0173", 33),
                    ("F0175", 27), ("F0175", 32), ("F0175", 37),
                    ("F0176", 47), ("F0176", 48),
                    ("F0203", 8), ("F0204", 7)}:
                dpi = min(dpi, 72)
            if (source_id, number) == ("F0204", 6):
                dpi = min(dpi, 90)
            if dpi < 72:
                raise ValueError("queued page cannot render within bounded DPI")
            pages.append({
                "sourceFileId": source_id, "pageNumber": number,
                "sourceSha256": source_hash, "pageArtifactSha256": artifact_hash,
                "objectId": row["object_id"], "manifestStage": row["stage"],
                "manifestSection": row["section"], "manifestRoleGate": _role(row),
                "widthMilliPoints": page["widthMilliPoints"],
                "heightMilliPoints": page["heightMilliPoints"], "dpi": dpi,
                "families": sorted({item["family"] for item in origins}),
                "sourceBatches": sorted({item["batch"] for item in origins}),
                "proposals": sorted(origins, key=lambda item: (item["batch"], item["family"], item["reason"])),
                "status": "OCR_PROPOSAL_ONLY_UNKNOWN",
            })
    finally:
        connection.close()
    return {
        "schemaVersion": "unresolved-targeted-ocr-queue-v2",
        "scope": "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY",
        "disposition": "BOUNDED_REVIEW_ONLY_ABSTAIN",
        "findingCount": None, "parameterCoverage": None, "absenceProof": False,
        "manifestSha256": summary["inputSha256"]["manifest"],
        "auditSha256": summary["inputSha256"]["audit"],
        "summarySha256": file_sha(SUMMARY), "batchReportSha256": report_hashes,
        "patternPolicySha256": file_sha(PATTERN_POLICY),
        "maxUniquePages": MAX_PAGES,
        "proposalEntries": len(proposals), "selectedUniquePages": len(pages),
        "pzSpzuTextAnchoredPages": sum("pz_spzu" in p["sourceBatches"] for p in pages),
        "pages": pages,
    }


def _patterns() -> dict[str, tuple[str, ...]]:
    policy = read_json(PATTERN_POLICY)
    if policy.get("schemaVersion") != "unresolved-ocr-pattern-policy-v1":
        raise ValueError("unresolved OCR pattern policy invalid")
    patterns = {code: tuple(value) for code, value in policy["patterns"].items()}
    if len(patterns) != 80:
        raise ValueError(f"unresolved lexical code inventory differs from 80: {len(patterns)}")
    if any(not values or not all(isinstance(value, str) and value for value in values)
           for values in patterns.values()):
        raise ValueError("empty unresolved OCR lexical policy")
    return patterns


def _chunks(size: int) -> list[list[int]]:
    output = []
    start = 0
    while start < size:
        end = min(size, start + 128)
        output.append(list(range(start, end)))
        if end == size:
            break
        start = end - 1
    return output


def _lexical_80(lines: list[dict[str, Any]], patterns: dict[str, tuple[str, ...]]) -> dict[str, Any]:
    compiled = {code: tuple(re.compile(expression, re.I) for expression in values)
                for code, values in patterns.items()}
    count_by_code = {code: 0 for code in patterns}
    samples = []
    total = 0
    for index, line in enumerate(lines):
        value = line["text"]
        for code, expressions in compiled.items():
            matched = [i for i, expression in enumerate(expressions) if expression.search(value)]
            if matched:
                total += 1
                count_by_code[code] += 1
                if len(samples) < 256:
                    samples.append({"parameterCode": code, "lineIndex": index,
                                    "patternIndices": matched, "text": value[:250],
                                    "bboxPx": line["bboxPx"], "score": line["score"]})
    return {"probedCodeCount": len(patterns), "lexicalLeadCount": total,
            "leadCountByCode": {k: v for k, v in count_by_code.items() if v},
            "sampleLeads": samples, "sampleLeadsTruncated": total > len(samples)}


def _probe_47(cache: Path, index_root: Path, page: dict[str, Any],
              result: dict[str, Any], dpi: int) -> dict[str, Any]:
    from inspector_worker.ocr_label_probe import probe_cached_ocr_labels
    leads = []
    hashes = []
    for indices in _chunks(result["lineCount"]):
        probe = probe_cached_ocr_labels(
            MANIFEST, index_root, cache, page["sourceFileId"], page["pageNumber"],
            expected_object_id=page["objectId"], expected_stage=page["manifestStage"],
            expected_section=page["manifestSection"], line_indices=indices,
            dpi=dpi, script=SCRIPT, renderer_profile_id=RENDERER,
            provider_profile_id=PROVIDER)
        if (probe["pinnedCodeCount"] != 47 or probe["cacheKey"] != result["cacheKey"]
                or probe["artifactContentHash"] != result["artifactContentHash"]):
            raise ValueError("47-code probe provenance mismatch")
        hashes.append(probe["reportSha256"])
        leads.extend(probe["leads"])
    unique = {json.dumps(lead, ensure_ascii=False, sort_keys=True): lead for lead in leads}
    return {"probedCodeCount": 47, "lexicalLeadCount": len(unique),
            "codesWithLeads": sorted({lead["parameterCode"] for lead in unique.values()}),
            "sampleLeads": list(unique.values())[:128],
            "sampleLeadsTruncated": len(unique) > 128,
            "segmentHashes": hashes}


def execute(args: argparse.Namespace) -> dict[str, Any]:
    from inspector_worker.public_ocr_cache import cached_public_ocr_page
    queue = read_json(args.queue)
    rebuilt = build_plan(args.index)
    if queue != rebuilt:
        raise ValueError("queue stale against current reports, manifest, audit, or index")
    patterns = _patterns()
    queue_hash = file_sha(args.queue)
    report = {
        "schemaVersion": "unresolved-targeted-ocr-batch-v1",
        "scope": queue["scope"], "disposition": "REVIEW_ONLY_ABSTAIN",
        "findingCount": None, "parameterCoverage": None, "absenceProof": False,
        "queueSha256": queue_hash, "selectedUniquePages": queue["selectedUniquePages"],
        "unresolvedCodeProbeCount": 80, "candidateCodeProbeCount": 47,
        "profile": {"rendererProfileId": RENDERER, "providerProfileId": PROVIDER,
                    "script": SCRIPT},
        "items": [], "cacheVerification": [], "summary": {},
    }
    if args.output.is_file():
        previous = read_json(args.output)
        if (previous.get("schemaVersion") != report["schemaVersion"]
                or previous.get("queueSha256") != queue_hash):
            raise ValueError("existing batch report belongs to different queue")
        report["items"] = previous["items"]
    by_key = {(item["sourceFileId"], item["pageNumber"]): item for item in report["items"]}
    if len(by_key) != len(report["items"]):
        raise ValueError("duplicate page in existing report")
    queue_by_key = {(page["sourceFileId"], page["pageNumber"]): page
                    for page in queue["pages"]}
    for key, item in by_key.items():
        page = queue_by_key.get(key)
        if (page is None or item.get("sourceSha256") != page["sourceSha256"]
                or item.get("pageArtifactSha256") != page["pageArtifactSha256"]
                or item.get("plannedDpi") != page["dpi"]
                or item.get("status") not in {"OCR_PROBED", "ERROR"}
                or (item["status"] == "OCR_PROBED" and (
                    item.get("ocrDpi") != page["dpi"]
                    or item.get("candidate47", {}).get("probedCodeCount") != 47
                    or item.get("unresolved80", {}).get("probedCodeCount") != 80))):
            raise ValueError("existing OCR checkpoint differs from pinned queue")

    def checkpoint() -> None:
        completed = sum(item["status"] == "OCR_PROBED" for item in report["items"])
        errors = sum(item["status"] == "ERROR" for item in report["items"])
        report["summary"] = {
            "completedPages": completed, "failedPages": errors,
            "notAttemptedPages": queue["selectedUniquePages"] - len(report["items"]),
            "cacheHits": sum(item.get("cacheStatus") == "HIT" for item in report["items"]),
            "cacheMissesWritten": sum(item.get("cacheStatus") == "MISS_WRITTEN" for item in report["items"]),
            "unresolved80LexicalLeads": sum(item.get("unresolved80", {}).get("lexicalLeadCount", 0)
                                             for item in report["items"]),
            "candidate47LexicalLeads": sum(item.get("candidate47", {}).get("lexicalLeadCount", 0)
                                            for item in report["items"]),
            "outsideSelectedQueue": "UNKNOWN",
        }
        write_atomic(args.output, report)

    checkpoint()
    for order, page in enumerate(queue["pages"], 1):
        key = page["sourceFileId"], page["pageNumber"]
        if key in by_key and by_key[key]["status"] == "OCR_PROBED":
            continue
        dpi = page["dpi"]
        try:
            while True:
                try:
                    result = cached_public_ocr_page(
                        manifest_path=MANIFEST, source_id=page["sourceFileId"],
                        page_number=page["pageNumber"], archive_path=args.archive,
                        cache_root=args.cache, base_url=args.ocr_url, dpi=dpi,
                        script=SCRIPT, renderer_profile_id=RENDERER,
                        provider_profile_id=PROVIDER,
                        index_path=args.index / "index.sqlite3")
                    break
                except ValueError as error:
                    if "rendered page exceeds" not in str(error) or dpi < 80:
                        raise
                    dpi -= 5
            if result["sourceSha256"] != page["sourceSha256"] or result["indexDisposition"] != "OCR_REQUIRED":
                raise ValueError("OCR result differs from selected public page")
            cache_raw = Path(result["cachePath"]).read_bytes()
            item = {
                "sourceFileId": key[0], "pageNumber": key[1],
                "sourceSha256": page["sourceSha256"],
                "pageArtifactSha256": page["pageArtifactSha256"],
                "objectId": page["objectId"], "manifestStage": page["manifestStage"],
                "manifestSection": page["manifestSection"],
                "manifestRoleGate": page["manifestRoleGate"],
                "families": page["families"], "sourceBatches": page["sourceBatches"],
                "plannedDpi": page["dpi"], "ocrDpi": dpi,
                "cacheStatus": result["cacheStatus"], "cacheKey": result["cacheKey"],
                "cacheFileSha256": sha(cache_raw),
                "ocrArtifactContentHash": result["artifactContentHash"],
                "renderArtifactSha256": result["artifact"]["render"]["sha256"],
                "ocrLineCount": result["lineCount"],
                "unresolved80": _lexical_80(result["artifact"]["lines"], patterns),
                "candidate47": _probe_47(args.cache, args.index, page, result, dpi),
                "status": "OCR_PROBED",
            }
        except Exception as error:
            item = {"sourceFileId": key[0], "pageNumber": key[1],
                    "sourceSha256": page["sourceSha256"],
                    "pageArtifactSha256": page["pageArtifactSha256"],
                    "plannedDpi": page["dpi"], "ocrDpi": dpi,
                    "status": "ERROR", "errorType": type(error).__name__,
                    "error": str(error)[:350]}
        if key in by_key:
            report["items"] = [item if (x["sourceFileId"], x["pageNumber"]) == key else x
                               for x in report["items"]]
        else:
            report["items"].append(item)
        by_key[key] = item
        checkpoint()
        print(json.dumps({"order": order, "total": len(queue["pages"]), "sourceFileId": key[0],
                          "pageNumber": key[1], "status": item["status"],
                          "cacheStatus": item.get("cacheStatus"),
                          "ocrDpi": item["ocrDpi"],
                          "leads80": item.get("unresolved80", {}).get("lexicalLeadCount"),
                          "leads47": item.get("candidate47", {}).get("lexicalLeadCount")},
                         ensure_ascii=False), flush=True)
        if sum(x["status"] == "ERROR" for x in report["items"][-3:]) == 3:
            break
    # Repeat cache lookup on up to three deterministic pages. A miss is a hard
    # failure because it could launch provider OCR a second time.
    done = [item for item in report["items"] if item["status"] == "OCR_PROBED"]
    samples = [done[index] for index in sorted({0, len(done) // 2, len(done) - 1})] if done else []
    for item in samples:
        repeated = cached_public_ocr_page(
            manifest_path=MANIFEST, source_id=item["sourceFileId"],
            page_number=item["pageNumber"], archive_path=args.archive,
            cache_root=args.cache, base_url=args.ocr_url, dpi=item["ocrDpi"],
            script=SCRIPT, renderer_profile_id=RENDERER, provider_profile_id=PROVIDER,
            index_path=args.index / "index.sqlite3")
        if (repeated["cacheStatus"] != "HIT" or repeated["cacheKey"] != item["cacheKey"]
                or repeated["artifactContentHash"] != item["ocrArtifactContentHash"]):
            raise ValueError("repeat sample not identical cache HIT")
        report["cacheVerification"].append({
            "sourceFileId": item["sourceFileId"], "pageNumber": item["pageNumber"],
            "ocrDpi": item["ocrDpi"], "cacheStatus": "HIT",
            "ocrArtifactContentHash": repeated["artifactContentHash"]})
    checkpoint()
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "run"))
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--ocr-url", default="http://127.0.0.1:18084")
    args = parser.parse_args()
    if args.mode == "plan":
        if args.queue.exists():
            raise ValueError("queue already exists; do not overwrite pinned selection")
        queue = build_plan(args.index)
        write_atomic(args.queue, queue)
        print(json.dumps({"queueSha256": file_sha(args.queue),
                          "proposalEntries": queue["proposalEntries"],
                          "selectedUniquePages": queue["selectedUniquePages"],
                          "pzSpzuTextAnchoredPages": queue["pzSpzuTextAnchoredPages"]}))
        return 0
    if args.output is None or args.archive is None or args.cache is None:
        parser.error("run requires --output, --archive, and --cache")
    result = execute(args)
    print(json.dumps({"reportSha256": file_sha(args.output),
                      "summary": result["summary"],
                      "cacheVerification": result["cacheVerification"]},
                     ensure_ascii=False))
    return 0 if result["summary"]["failedPages"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
