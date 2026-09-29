#!/usr/bin/env python3
"""Catalog-pinned, metadata-only strategy inventory for 80 unresolved parameters.

This script reads the public catalog, design registry, and public manifest metadata.
It never reads PDF bytes, hidden labels, or external registries. Output is planning
data, never executable rules or coverage.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/worker"))
from inspector_worker.parameter_family_registry import (  # noqa: E402
    CATALOG_SHA256,
    load_parameter_family_registry,
)

DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"
CATALOG = DATA / "parameter_catalog_132.jsonl"
MANIFEST = DATA / "document_manifest.jsonl"
REGISTRY = ROOT / "services/worker/rules/parameter-family-registry-v1.json"
STRATEGY = ROOT / "docs/operations/unresolved-parameter-strategy-v1.json"
OUTPUT = ROOT / "output/unresolved-parameter-strategy-20260927"
MANIFEST_SHA256 = "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7"
SECTION_TAGS = {
    "АР": "AR", "ЭОМ": "EOM", "ГП": "GP", "КР": "KR", "ОВ": "OV",
    "ПОС": "POS", "СС": "SS", "ВК": "VK",
}
STAGES = ("PD", "RD", "ID")
FAMILY_REQUIREMENTS = {
    "AREA_PROGRAM": "пообъектную и позонную семантику площади или состава, включая назначение помещений",
    "BOUNDARY_OVERLAY": "привязанную к масштабу геометрию и пересечение границ на плане",
    "BUILDING_LEVELS": "идентичность здания, тип каждого этажа и связь этажности с заявленным объёмом",
    "COORDINATE_ALIGNMENT": "единые координаты, систему отсчёта и связь обозначений между листами",
    "DIMENSION_LAYOUT": "размер на конкретном плане и применимость геометрического ограничения",
    "DOCUMENT_APPROVAL": "редакцию, полномочия и факт согласования именно этой замены",
    "EQUIPMENT_SPEC": "идентичность оборудования и несколько связанных технических характеристик",
    "EXTERNAL_EVENT_CHAIN": "подлинные записи внешней системы, участников и временную последовательность событий",
    "FUNCTIONAL_CAPACITY": "назначение объекта, единицу и расчётный режим технологической мощности",
    "LAYER_ASSEMBLY": "состав слоёв, материалы и положение слоя в узле или конструкции",
    "MATERIAL_CLASS": "марку или материал, нормативную шкалу свойств и назначение изделия",
    "METHOD_SEQUENCE": "последовательность работ, область применения и документ согласования",
    "NETWORK_TOPOLOGY": "узлы сети, связи и параметры конкретных ветвей или контуров",
    "PARKING_LAYOUT": "количество и размеры индивидуальных мест на одной схеме парковки",
    "ROOF_DRAINAGE_LAYOUT": "геометрию скатов, путь стока и расстановку воронок",
    "SAFETY_COVERAGE": "покрытие зон и пространственную связь оборудования с защищаемым объектом",
    "SITE_FEATURE_LAYOUT": "объекты плана, их количество, тип и пространственные отношения",
    "SPECIFICATION_SET": "состав спецификации с идентичностью каждой позиции и её характеристиками",
    "STRUCTURAL_DETAIL": "привязку конструктивного узла, размеры и роль в несущей схеме",
    "THERMAL_PERFORMANCE": "конструкцию изделия и подтверждённый расчётом коэффициент теплопередачи",
    "WASTE_MATERIAL_CHAIN": "класс отхода, массу, происхождение и подтверждённый маршрут утилизации",
}
EVIDENCE_KINDS = frozenset({
    "GEOMETRY", "VISUAL_SYMBOL", "NORM", "EXTERNAL_REGISTRY", "COMPOSITE",
    "CROSS_DOCUMENT", "APPROVAL_CONTEXT", "SPECIFICATION", "TABLE",
})
REASON_PROOF_GATES = {
    "GEOMETRY_OR_TOPOLOGY": "Привязать листы к одной редакции и извлечь геометрию с масштабом и системой координат.",
    "NORMATIVE_OR_APPLICABILITY": "Подтвердить применимую редакцию нормы и условия её действия на объект.",
    "APPROVAL_OR_CONTEXT": "Подтвердить согласование замены и контекст применения проектного решения.",
    "COMPOSITE_TRIGGER": "Извлечь все части составного условия на одном сопоставимом объекте.",
    "SOURCE_TRIGGER_CONFLICT": "Сначала разрешить расхождение названия параметра, источников и триггера каталога.",
    "EXTERNAL_REGISTRY": "Получить авторизованную запись внешнего реестра с временем и идентичностью события.",
    "PUBLIC_MAPPING_CONFLICT": "Сначала проверить соответствие раздела каталога разделам публичного пакета.",
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _explicit_sections(text: str) -> list[str]:
    return sorted({tag for token, tag in SECTION_TAGS.items()
                   if re.search(rf"(?<![А-ЯЁа-яё0-9]){token}(?![А-ЯЁа-яё0-9])", text)})


def _public_manifest(path: Path, expected_hash: str | None) -> list[dict[str, Any]]:
    if expected_hash is not None and _sha(path) != expected_hash:
        raise ValueError("public document manifest SHA-256 drift")
    rows: list[dict[str, Any]] = []
    ids: set[str] = set()
    for row in _jsonl(path):
        # Filter before reading any hidden row's document metadata.
        if (row.get("split"), row.get("distribution_status"), row.get("label_visibility")) != (
                "TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"):
            continue
        file_id = row.get("file_id")
        if (not isinstance(file_id, str) or file_id in ids
                or row.get("stage") not in {*STAGES, "RD_ID_MIXED", "UNKNOWN"}
                or any(not isinstance(row.get(key), str) or not row[key]
                       for key in ("object_id", "section", "sha256"))):
            raise ValueError("invalid eligible public manifest row")
        ids.add(file_id)
        rows.append(row)
    return rows


def _candidate_sources(source_fields: dict[str, str], public_rows: list[dict[str, Any]]) -> dict[str, Any]:
    objects = sorted({row["object_id"] for row in public_rows})
    result: dict[str, Any] = {"byStage": {}, "mixedStageByObject": {}, "unknownStageByObject": {}}
    for stage in STAGES:
        tags = _explicit_sections(source_fields[stage])
        counts: dict[str, Any] = {}
        for object_id in objects:
            subset = [row for row in public_rows if row["object_id"] == object_id and row["stage"] == stage]
            counts[object_id] = {
                "allSections": len(subset),
                "byManifestSection": dict(sorted(Counter(row["section"] for row in subset).items())),
                "exactSectionTagCandidates": sum(row["section"] in tags for row in subset) if tags else None,
                "unclassifiedOther": sum(row["section"] == "OTHER" for row in subset),
            }
        result["byStage"][stage] = {"catalogExplicitManifestTags": tags, "byObject": counts}
    for object_id in objects:
        subset = [row for row in public_rows if row["object_id"] == object_id
                  and row["stage"] == "RD_ID_MIXED"]
        result["mixedStageByObject"][object_id] = {
            "documentCount": len(subset),
            "byManifestSection": dict(sorted(Counter(row["section"] for row in subset).items())),
        }
        unknown = [row for row in public_rows if row["object_id"] == object_id
                   and row["stage"] == "UNKNOWN"]
        result["unknownStageByObject"][object_id] = {
            "documentCount": len(unknown),
            "byManifestSection": dict(sorted(Counter(row["section"] for row in unknown).items())),
        }
    pd_tags = result["byStage"]["PD"]["catalogExplicitManifestTags"]
    rd_tags = result["byStage"]["RD"]["catalogExplicitManifestTags"]
    if not pd_tags or not rd_tags:
        disposition = "CATALOG_SECTION_MAPPING_UNRESOLVED"
    else:
        paired = any(
            result["byStage"]["PD"]["byObject"][obj]["exactSectionTagCandidates"] > 0
            and result["byStage"]["RD"]["byObject"][obj]["exactSectionTagCandidates"] > 0
            for obj in objects
        )
        if paired:
            disposition = "SAME_OBJECT_STAGE_SECTION_CANDIDATES_ONLY"
        elif any(
            result["byStage"][stage]["byObject"][obj]["exactSectionTagCandidates"] > 0
            for stage in ("PD", "RD") for obj in objects
        ):
            disposition = "ONE_SIDED_STAGE_SECTION_CANDIDATES_ONLY"
        else:
            disposition = "NO_EXACT_STAGE_SECTION_TAG_MATCH"
    result["metadataDisposition"] = disposition
    result["verifiedComparablePair"] = False
    return result


def build_report(
    catalog_path: Path = CATALOG,
    manifest_path: Path = MANIFEST,
    registry_path: Path = REGISTRY,
    strategy_path: Path = STRATEGY,
    expected_catalog_hash: str | None = CATALOG_SHA256,
    expected_manifest_hash: str | None = MANIFEST_SHA256,
) -> dict[str, Any]:
    if expected_catalog_hash is not None and _sha(catalog_path) != expected_catalog_hash:
        raise ValueError("public parameter catalog SHA-256 drift")
    catalog = _jsonl(catalog_path)
    registry = load_parameter_family_registry(catalog_path=catalog_path, registry_path=registry_path)
    design = json.loads(strategy_path.read_text(encoding="utf-8"))
    if (set(design) != {"schemaVersion", "catalogSha256", "registrySha256", "executionPolicy", "entries"}
            or design["schemaVersion"] != "unresolved-parameter-strategy-v1"
            or design["catalogSha256"] != _sha(catalog_path)
            or design["registrySha256"] != _sha(registry_path)
            or design["executionPolicy"] != "DESIGN_ONLY"):
        raise ValueError("unresolved strategy schema, input SHA, or execution policy drift")
    unresolved = [row["parameterCode"] for row in registry["entries"]
                  if row["classification"] == "UNRESOLVED"]
    entries = design["entries"]
    if len(unresolved) != 80 or len(entries) != 80 or [row.get("parameterCode") for row in entries] != unresolved:
        raise ValueError("strategy must cover 80 unresolved registry codes exactly once in catalog order")
    by_code = {row["parameter_code"]: row for row in catalog}
    public_rows = _public_manifest(manifest_path, expected_manifest_hash)
    output: list[dict[str, Any]] = []
    for item in entries:
        if (set(item) != {"parameterCode", "candidateExtractorFamily", "evidenceKinds", "specificProofDependency"}
                or item["candidateExtractorFamily"] not in FAMILY_REQUIREMENTS
                or not isinstance(item["evidenceKinds"], list)
                or not item["evidenceKinds"]
                or len(set(item["evidenceKinds"])) != len(item["evidenceKinds"])
                or not set(item["evidenceKinds"]) <= EVIDENCE_KINDS
                or not isinstance(item["specificProofDependency"], str)
                or not item["specificProofDependency"].strip()):
            raise ValueError(f"invalid strategy design: {item.get('parameterCode')}")
        code = item["parameterCode"]
        catalog_row = by_code[code]
        registry_row = next(row for row in registry["entries"] if row["parameterCode"] == code)
        source_fields = {stage: catalog_row[f"source_{stage.lower()}"] for stage in STAGES}
        output.append({
            "parameterId": catalog_row["parameter_id"],
            "parameterCode": code,
            "parameterName": catalog_row["parameter_name"],
            "catalogSection": catalog_row["pd_section"],
            "catalogTrigger": catalog_row["trigger"],
            "catalogSourceRequirements": source_fields,
            "registryReasonCode": registry_row["reasonCode"],
            "nextProofGate": REASON_PROOF_GATES[registry_row["reasonCode"]],
            "requiredEvidenceKinds": item["evidenceKinds"],
            "candidateExtractorFamily": item["candidateExtractorFamily"],
            "whyGenericComparisonInsufficient": (
                f"Нужно подтвердить {item['specificProofDependency']}; "
                f"семейству требуется {FAMILY_REQUIREMENTS[item['candidateExtractorFamily']]}. "
                "Одна величина, класс или отметка наличия не доказывает условие каталога."
            ),
            "sourceAvailability": _candidate_sources(source_fields, public_rows),
            "executionStatus": "DESIGN_ONLY",
            "findingOrCoveragePromoted": False,
        })
    report = {
        "schemaVersion": "unresolved-parameter-strategy-report-v1",
        "inputSha256": {"catalog": _sha(catalog_path), "registry": _sha(registry_path),
                        "strategy": _sha(strategy_path), "manifest": _sha(manifest_path)},
        "scope": "TRAIN_PUBLIC+INCLUDE+PUBLIC_TRAIN manifest metadata only; no PDF, labels, hidden answers, or external systems",
        "candidateCountMeaning": "Source-stage/section tag candidates, never page content, revision, semantic match, verified pair, coverage, or finding",
        "summary": {
            "unresolvedCodes": len(output),
            "eligiblePublicDocuments": len(public_rows),
            "candidateExtractorFamilies": dict(sorted(Counter(x["candidateExtractorFamily"] for x in output).items())),
            "metadataDispositions": dict(sorted(Counter(x["sourceAvailability"]["metadataDisposition"] for x in output).items())),
            "verifiedComparablePairs": 0,
            "findingsOrCoveragePromoted": 0,
        },
        "parameters": output,
    }
    report["reportSha256"] = hashlib.sha256(
        (json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    ).hexdigest()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    report = build_report()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"reportSha256": report["reportSha256"], **report["summary"]},
                     ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
