#!/usr/bin/env python3
"""Deterministic, metadata-only readiness inventory for the public 132-code catalog.

No PDF or hidden-answer content is read. Counts describe document candidates,
not verified revisions, extracted values, comparisons, or findings.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"
CATALOG = PUBLIC_DATA / "parameter_catalog_132.jsonl"
MANIFEST = PUBLIC_DATA / "document_manifest.jsonl"
LABELS = PUBLIC_DATA / "public_train_checks.jsonl"
OUTPUT = ROOT / "output/catalog-readiness-public-20260927"
CATALOG_SHA256 = "c6b73dffbea6bb366fc50f08392522c390bdf7b19420051802bd0bcbd32b4e4f"
MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
LABELS_SHA256 = "f992db4b339fa2d5a49176e65693fd38be3b6cbffc5a6838ca9819050db32658"

# Explicit snapshot of the tested PILOT_PZ002_PZ017 coverage profile. These
# statuses are implementation claims, never inferred from sources or labels.
PINNED_STATUS_ROWS = """
PZ-001 UNSUPPORTED
PZ-002 PARTIAL
PZ-003 UNSUPPORTED
PZ-004 UNSUPPORTED
PZ-005 UNSUPPORTED
PZ-006 UNSUPPORTED
PZ-007 UNSUPPORTED
PZ-008 UNSUPPORTED
PZ-009 UNSUPPORTED
PZ-010 UNSUPPORTED
PZ-011 UNSUPPORTED
PZ-012 UNSUPPORTED
PZ-013 UNSUPPORTED
PZ-014 UNSUPPORTED
PZ-015 UNSUPPORTED
PZ-016 UNSUPPORTED
PZ-017 PARTIAL
PZ-018 UNSUPPORTED
PZ-019 UNSUPPORTED
PZ-020 UNSUPPORTED
PZ-021 UNSUPPORTED
PZ-022 UNSUPPORTED
PZ-023 UNSUPPORTED
SPZU-024 UNSUPPORTED
SPZU-025 UNSUPPORTED
SPZU-026 UNSUPPORTED
SPZU-027 UNSUPPORTED
SPZU-028 UNSUPPORTED
SPZU-029 UNSUPPORTED
SPZU-030 UNSUPPORTED
SPZU-031 UNSUPPORTED
SPZU-032 UNSUPPORTED
SPZU-033 UNSUPPORTED
SPZU-034 UNSUPPORTED
SPZU-035 UNSUPPORTED
SPZU-036 UNSUPPORTED
SPZU-037 UNSUPPORTED
SPZU-038 UNSUPPORTED
SPZU-039 UNSUPPORTED
AR-040 UNSUPPORTED
AR-041 UNSUPPORTED
AR-042 UNSUPPORTED
AR-043 UNSUPPORTED
AR-044 UNSUPPORTED
AR-045 UNSUPPORTED
AR-046 UNSUPPORTED
AR-047 UNSUPPORTED
AR-048 UNSUPPORTED
AR-049 UNSUPPORTED
AR-050 UNSUPPORTED
AR-051 UNSUPPORTED
AR-052 UNSUPPORTED
AR-053 UNSUPPORTED
KR-054 UNSUPPORTED
KR-055 UNSUPPORTED
KR-056 UNSUPPORTED
KR-057 UNSUPPORTED
KR-058 UNSUPPORTED
KR-059 UNSUPPORTED
KR-060 UNSUPPORTED
KR-061 UNSUPPORTED
KR-062 UNSUPPORTED
KR-063 UNSUPPORTED
KR-064 UNSUPPORTED
KR-065 UNSUPPORTED
KR-066 UNSUPPORTED
KR-067 UNSUPPORTED
IOS1-068 UNSUPPORTED
IOS1-069 UNSUPPORTED
IOS1-070 UNSUPPORTED
IOS2-071 UNSUPPORTED
IOS2-072 UNSUPPORTED
IOS2-073 UNSUPPORTED
IOS3-074 UNSUPPORTED
IOS3-075 UNSUPPORTED
IOS4-076 UNSUPPORTED
IOS4-077 UNSUPPORTED
IOS4-078 UNSUPPORTED
IOS4-079 UNSUPPORTED
IOS5-080 UNSUPPORTED
POS-081 UNSUPPORTED
POS-082 UNSUPPORTED
POS-083 UNSUPPORTED
POS-084 UNSUPPORTED
POS-085 UNSUPPORTED
POS-086 UNSUPPORTED
POS-087 UNSUPPORTED
POS-088 UNSUPPORTED
POS-089 UNSUPPORTED
POD-090 UNSUPPORTED
POD-091 UNSUPPORTED
POD-092 UNSUPPORTED
POD-093 UNSUPPORTED
POD-094 UNSUPPORTED
POD-095 UNSUPPORTED
POD-096 UNSUPPORTED
POD-097 UNSUPPORTED
OOS-098 UNSUPPORTED
OOS-099 UNSUPPORTED
OOS-100 UNSUPPORTED
OOS-101 UNSUPPORTED
PPM-102 UNSUPPORTED
PPM-103 UNSUPPORTED
PPM-104 UNSUPPORTED
PPM-105 UNSUPPORTED
PPM-106 UNSUPPORTED
PPM-107 UNSUPPORTED
PPM-108 UNSUPPORTED
PPM-109 UNSUPPORTED
PPM-110 UNSUPPORTED
PPM-111 UNSUPPORTED
PPM-112 UNSUPPORTED
PPM-113 UNSUPPORTED
PPM-114 UNSUPPORTED
ODI-115 UNSUPPORTED
ODI-116 UNSUPPORTED
ODI-117 UNSUPPORTED
ODI-118 UNSUPPORTED
ODI-119 UNSUPPORTED
ODI-120 UNSUPPORTED
ODI-121 UNSUPPORTED
ODI-122 UNSUPPORTED
ODI-123 UNSUPPORTED
ZU-124 UNSUPPORTED
ZU-125 UNSUPPORTED
ZU-126 UNSUPPORTED
ZU-127 UNSUPPORTED
ZU-128 UNSUPPORTED
ZU-129 UNSUPPORTED
ZU-130 UNSUPPORTED
ZU-131 UNSUPPORTED
SM-132 UNSUPPORTED
"""

# Exact catalog text tags to exact manifest section tags. No broad synonym or
# OTHER match: catalog prose and manifest taxonomy differ in many rows.
SECTION_TAGS = {
    "АР": "AR", "ЭОМ": "EOM", "ГП": "GP", "КР": "KR",
    "ОВ": "OV", "ПОС": "POS", "СС": "SS", "ВК": "VK",
}
STAGES = ("PD", "RD", "ID")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path.name}:{number}: row must be object")
            rows.append(value)
    return rows


def pinned_statuses() -> dict[str, str]:
    statuses: dict[str, str] = {}
    for line in PINNED_STATUS_ROWS.splitlines():
        if not line.strip():
            continue
        code, status = line.split()
        if code in statuses or status not in {"PARTIAL", "UNSUPPORTED"}:
            raise ValueError("duplicate or invalid pinned implementation status")
        statuses[code] = status
    if len(statuses) != 132 or {code for code, value in statuses.items() if value == "PARTIAL"} != {"PZ-002", "PZ-017"}:
        raise ValueError("pinned implementation status must contain 132 codes and two named partials")
    return statuses


def validate_catalog(rows: list[dict[str, Any]], expected_hash: str | None, actual_hash: str) -> list[dict[str, Any]]:
    codes = [row.get("parameter_code") for row in rows]
    if any(not isinstance(code, str) for code in codes):
        raise ValueError("catalog parameter_code missing or invalid")
    if len(codes) != len(set(codes)):
        raise ValueError("duplicate catalog parameter_code")
    if len(rows) != 132:
        raise ValueError(f"catalog has {len(rows)} codes, expected 132")
    statuses = pinned_statuses()
    if set(codes) != set(statuses):
        raise ValueError(f"catalog/pinned-status code mismatch: missing={sorted(set(statuses)-set(codes))}, extra={sorted(set(codes)-set(statuses))}")
    ids = [row.get("parameter_id") for row in rows]
    if sorted(ids) != list(range(1, 133)):
        raise ValueError("catalog parameter_id must cover 1..132 exactly")
    for row in rows:
        if any(not isinstance(row.get(key), str) or not row[key].strip() for key in ("pd_section", "parameter_name", "source_pd", "source_rd", "source_id")):
            raise ValueError(f"catalog required source fields invalid: {row['parameter_code']}")
    if expected_hash is not None and actual_hash != expected_hash:
        raise ValueError("immutable public catalog SHA-256 mismatch")
    return sorted(rows, key=lambda row: row["parameter_id"])


def eligible_sources(rows: list[dict[str, Any]], expected_hash: str | None, actual_hash: str) -> list[dict[str, Any]]:
    if expected_hash is not None and actual_hash != expected_hash:
        raise ValueError("public document manifest SHA-256 mismatch")
    file_ids: set[str] = set()
    eligible: list[dict[str, Any]] = []
    for row in rows:
        # Reject unknown public visibility. Ignore hidden rows before reading
        # their other fields or adding any counts.
        if row.get("split") != "TRAIN_PUBLIC":
            continue
        if row.get("distribution_status") != "INCLUDE" or row.get("label_visibility") != "PUBLIC_TRAIN":
            continue
        file_id = row.get("file_id")
        if not isinstance(file_id, str) or file_id in file_ids:
            raise ValueError("duplicate or invalid eligible public file_id")
        file_ids.add(file_id)
        if row.get("stage") not in {*STAGES, "RD_ID_MIXED", "UNKNOWN"}:
            raise ValueError(f"invalid public stage for {file_id}")
        if any(not isinstance(row.get(key), str) or not row[key] for key in ("object_id", "section", "sha256")):
            raise ValueError(f"incomplete eligible public source {file_id}")
        eligible.append(row)
    return eligible


def public_label_counts(rows: list[dict[str, Any]], public_file_ids: set[str], catalog_codes: set[str]) -> tuple[Counter[str], Counter[str]]:
    counts: Counter[str] = Counter()
    out_of_catalog: Counter[str] = Counter()
    check_ids: set[str] = set()
    for row in rows:
        if row.get("split") != "TRAIN_PUBLIC" or row.get("visibility") != "PUBLIC_TRAIN_LABEL":
            continue
        check_id = row.get("check_id")
        code = row.get("parameter_code")
        if not isinstance(check_id, str) or check_id in check_ids or not isinstance(code, str):
            raise ValueError("duplicate or invalid public check")
        check_ids.add(check_id)
        evidence = row.get("evidence")
        if not isinstance(evidence, list) or not evidence or any(not isinstance(item, dict) or item.get("file_id") not in public_file_ids for item in evidence):
            raise ValueError(f"public check {check_id} references non-public source")
        if code in catalog_codes:
            counts[code] += 1
        elif code.startswith("FREE-"):
            out_of_catalog[code] += 1
        else:
            raise ValueError(f"unknown public check parameter_code {code}")
    return counts, out_of_catalog


def explicit_sections(source_text: str) -> list[str]:
    # Match whole Cyrillic code tokens only. An absent match means unknown,
    # never "zero sources" for that catalog requirement.
    found = {manifest_tag for catalog_tag, manifest_tag in SECTION_TAGS.items()
             if re.search(rf"(?<![А-ЯЁа-яё0-9]){catalog_tag}(?![А-ЯЁа-яё0-9])", source_text)}
    return sorted(found)


def source_inventory(sources: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, int]]]:
    counts: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    for row in sources:
        counts[row["object_id"]][row["stage"]][row["section"]] += 1
    return {object_id: {stage: dict(sorted(sections.items())) for stage, sections in sorted(stages.items())}
            for object_id, stages in sorted(counts.items())}


def candidate_counts(inventory: dict[str, dict[str, dict[str, int]]], source_fields: dict[str, str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for stage in STAGES:
        tags = explicit_sections(source_fields[stage])
        per_object: dict[str, Any] = {}
        for object_id, stages in inventory.items():
            sections = stages.get(stage, {})
            per_object[object_id] = {
                "stageDocumentCount": sum(sections.values()),
                "byManifestSection": sections,
                "exactSectionTagCandidateCount": sum(sections.get(tag, 0) for tag in tags) if tags else None,
                "unclassifiedSectionCount": sections.get("OTHER", 0),
            }
        result[stage] = {"explicitManifestSectionTags": tags, "byObject": per_object}
    result["RD_ID_MIXED_UNRESOLVED"] = {
        object_id: {"documentCount": sum(stages.get("RD_ID_MIXED", {}).values()),
                    "byManifestSection": stages.get("RD_ID_MIXED", {})}
        for object_id, stages in inventory.items()
    }
    return result


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def build_report(catalog_path: Path = CATALOG, manifest_path: Path = MANIFEST, labels_path: Path = LABELS,
                 expected_catalog_hash: str | None = CATALOG_SHA256,
                 expected_manifest_hash: str | None = MANIFEST_SHA256,
                 expected_labels_hash: str | None = LABELS_SHA256) -> dict[str, Any]:
    hashes = {"catalog": sha256_file(catalog_path), "manifest": sha256_file(manifest_path), "publicLabels": sha256_file(labels_path)}
    catalog = validate_catalog(read_jsonl(catalog_path), expected_catalog_hash, hashes["catalog"])
    sources = eligible_sources(read_jsonl(manifest_path), expected_manifest_hash, hashes["manifest"])
    if expected_labels_hash is not None and hashes["publicLabels"] != expected_labels_hash:
        raise ValueError("public check labels SHA-256 mismatch")
    inventory = source_inventory(sources)
    labels, free_labels = public_label_counts(read_jsonl(labels_path), {row["file_id"] for row in sources},
                                               {row["parameter_code"] for row in catalog})
    statuses = pinned_statuses()
    entries = []
    for row in catalog:
        code = row["parameter_code"]
        source_fields = {stage: row[f"source_{stage.lower()}"] for stage in STAGES}
        entries.append({
            "parameterId": row["parameter_id"], "parameterCode": code,
            "parameterName": row["parameter_name"], "catalogSection": row["pd_section"],
            "sourceRequirements": source_fields, "candidateDocuments": candidate_counts(inventory, source_fields),
            "publicCheckLabelCount": labels[code], "implementationStatus": statuses[code],
            "comparablePairVerified": False, "findingReadiness": "NOT_ESTABLISHED",
        })
    report: dict[str, Any] = {
        "schemaVersion": "catalog-readiness-public-v1", "inputSha256": hashes,
        "pinnedStatusMappingSha256": hashlib.sha256(PINNED_STATUS_ROWS.encode("utf-8")).hexdigest(),
        "scope": "TRAIN_PUBLIC+INCLUDE+PUBLIC_TRAIN metadata; repository public checks only",
        "candidateCountMeaning": "Manifest documents by object/stage/section; does not verify content, page stage, revision, linkage, comparison, or absence",
        "summary": {
            "parameterCount": len(entries), "eligiblePublicSourceDocumentCount": len(sources),
            "publicCheckLabelCountInCatalog": sum(labels.values()),
            "publicCheckLabelCountOutsideCatalog": dict(sorted(free_labels.items())),
            "implementationStatusCounts": dict(sorted(Counter(statuses.values()).items())),
            "comparablePairsVerifiedByInventory": 0, "findingsEvaluatedByInventory": 0,
        },
        "sourceInventoryByObjectStageSection": inventory, "parameters": entries,
    }
    report["reportSha256"] = hashlib.sha256(canonical_bytes(report)).hexdigest()
    return report


def markdown_summary(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Публичная матрица готовности каталога",
        "",
        f"SHA-256 отчёта: `{report['reportSha256']}`. Детерминированный снимок только локальных публичных JSONL.",
        "",
        f"Коды: {summary['parameterCount']}; документы-кандидаты TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN: {summary['eligiblePublicSourceDocumentCount']}; "
        f"публичные checks в каталоге: {summary['publicCheckLabelCountInCatalog']}.",
        f"Статусы закреплённого пилота: {summary['implementationStatusCounts']}. "
        "Эта инвентаризация не проверяет сопоставимые пары и findings (оба счётчика выполненных проверок равны 0).",
        "",
        "Кандидат по manifest не означает наличие нужного значения, сопоставимую редакцию или проверку отсутствия. "
        "RD_ID_MIXED показан отдельно: без постраничного подтверждения стадии он не включён в RD/ID counts. "
        "OTHER не сопоставляется с разделом каталога. Null у exactSectionTagCandidateCount означает, что точный tag не извлечён из свободного текста.",
        "",
        "Публичные labels считаются по `public_train_checks.jsonl`; группы findings и предложенные bbox не удваивают их. "
        f"Вне каталога: {summary['publicCheckLabelCountOutsideCatalog']}. Отсутствие label не означает NO_VIOLATION.",
        "",
        "| Код | Раздел каталога | Публичных checks | Статус | Проверка пары этим скриптом |",
        "|---|---|---:|---|---|",
    ]
    for row in report["parameters"]:
        lines.append(f"| {row['parameterCode']} | {row['catalogSection']} | {row['publicCheckLabelCount']} | {row['implementationStatus']} | не выполняется |")
    lines += ["", "Подробные исходные требования и counts по объекту/стадии/разделу manifest: `report.json`.", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    report = build_report()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_bytes(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n")
    (args.output / "SUMMARY.md").write_text(markdown_summary(report), encoding="utf-8")
    print(json.dumps({"reportSha256": report["reportSha256"], **report["summary"]}, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
