"""End-to-end offline PZ-002 pilot over verified TRAIN_PUBLIC source PDFs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable

from .numeric_extraction import extract_pz_002_facts
from .ocr_pilot import extract_pz_002_ocr_facts, recognize_pdf_page, validate_local_url
from .parameter_routing import route_parameter
from .public_pilot import load_public_bundle
from .table_rows import extract_pz002_table_rows
from .table_visual import crosscheck_table_fact
from .typed_rules import evaluate_numeric_rule


def prioritize_ocr_pages(route: dict[str, Any]) -> list[tuple[str, int]]:
    """Visit nearby OCR pages across relevant stages before a stable fallback."""
    pages: set[tuple[str, int]] = set()
    relevant_stages: list[list[tuple[str, int]]] = []
    for stage in route["stages"]:
        anchors: dict[str, list[int]] = {}
        for candidate in stage["candidates"]:
            if "SUBJECT_TEXT_MATCH" in candidate["reasonCodes"]:
                anchors.setdefault(candidate["sourceFileId"], []).append(candidate["pageNumber"])
        stage_pages = {(item["sourceFileId"], item["pageNumber"]) for item in stage["ocrPages"]}
        pages.update(stage_pages)
        if anchors:
            relevant_stages.append(sorted(stage_pages, key=lambda item: (
                0 if item[0] in anchors else 1,
                min((abs(item[1] - page) for page in anchors.get(item[0], [])), default=10**9),
                item[0], item[1],
            )))
    ordered: list[tuple[str, int]] = []
    selected: set[tuple[str, int]] = set()
    for rank in range(max((len(stage) for stage in relevant_stages), default=0)):
        for stage in relevant_stages:
            if rank < len(stage) and stage[rank] not in selected:
                ordered.append(stage[rank])
                selected.add(stage[rank])
    return ordered + sorted(pages - selected)


def run_pz002_pilot(
    manifest_path: Path,
    materials_root: Path,
    source_ids: list[str],
    navigation_rule: dict[str, Any],
    numeric_rule: dict[str, Any],
    source_decisions: dict[str, dict[str, Any]] | None = None,
    *,
    document_ai_url: str | None = None,
    max_ocr_pages: int | None = None,
    max_table_pages: int | None = 8,
    max_table_ocr_pages: int | None = 2,
    source_overrides: dict[str, Path] | None = None,
) -> dict[str, Any]:
    bundle = load_public_bundle(manifest_path, materials_root, source_ids, source_decisions, source_overrides)
    result = analyze_pz002_bundle(
        bundle, navigation_rule, numeric_rule,
        document_ai_url=document_ai_url, max_ocr_pages=max_ocr_pages,
        max_table_pages=max_table_pages,
        max_table_ocr_pages=max_table_ocr_pages,
        source_path_for_ocr=lambda source_id: bundle["verifiedSourcePaths"][source_id],
    )
    return {**result, "schemaVersion": "pz-002-public-pilot-v1", "datasetSplit": "TRAIN_PUBLIC"}


def analyze_pz002_bundle(
    bundle: dict[str, Any],
    navigation_rule: dict[str, Any],
    numeric_rule: dict[str, Any],
    *,
    document_ai_url: str | None = None,
    max_ocr_pages: int | None = None,
    max_table_pages: int | None = 8,
    max_table_ocr_pages: int | None = 2,
    source_path_for_ocr: Callable[[str], Path] | None = None,
    recognize_page: Callable[[str, int, int, str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate immutable source/text inputs without depending on dataset labels."""
    if navigation_rule.get("parameterCode") != "PZ-002" or numeric_rule.get("parameterCode") != "PZ-002":
        raise ValueError("PZ-002 pilot requires matching navigation and numeric rules")
    if (not isinstance(bundle.get("objectId"), str) or not bundle["objectId"]
            or not isinstance(bundle.get("selectedManifestHash"), str)
            or not isinstance(bundle.get("sources"), list)
            or not isinstance(bundle.get("textArtifacts"), list)):
        raise ValueError("PZ-002 bundle has no immutable manifest/source inputs")
    route = route_parameter({
        "schemaVersion": "parameter-route-request-v1",
        "inputManifestHash": bundle["selectedManifestHash"],
        "objectId": bundle["objectId"],
        "rule": navigation_rule,
        "sources": bundle["sources"],
        "textArtifacts": bundle["textArtifacts"],
    })
    facts = extract_pz_002_facts(route, bundle["textArtifacts"], entity_key="building-total")
    if max_table_pages is not None and (type(max_table_pages) is not int or max_table_pages < 0):
        raise ValueError("max_table_pages must be a non-negative integer")
    if max_table_ocr_pages is not None and (type(max_table_ocr_pages) is not int or max_table_ocr_pages < 0):
        raise ValueError("max_table_ocr_pages must be a non-negative integer")
    text_index = {artifact["sourceFileId"]: artifact for artifact in bundle["textArtifacts"]}
    direct_fact_pages = {(fact["sourceFileId"], fact["pageNumber"]) for fact in facts}
    table_pages = list(dict.fromkeys(
        (candidate["sourceFileId"], candidate["pageNumber"])
        for stage in route["stages"] for candidate in stage["candidates"]
        if (candidate["sourceFileId"], candidate["pageNumber"]) not in direct_fact_pages
        and any("общая площадь здания" in text_index[candidate["sourceFileId"]]["pages"]
                [candidate["pageNumber"] - 1]["blocks"][index]["text"].casefold()
                for index in candidate["blockIndexes"])
    ))
    selected_table_pages = (table_pages[:max_table_pages] if max_table_pages is not None else table_pages) if source_path_for_ocr else []
    for source_id, page_number in selected_table_pages:
        facts.extend(extract_pz002_table_rows(
            source_path_for_ocr(source_id), text_index[source_id], page_number,
            entity_key="building-total",
        ))
    ocr_pages = prioritize_ocr_pages(route)
    if max_ocr_pages is not None and (type(max_ocr_pages) is not int or max_ocr_pages < 0):
        raise ValueError("max_ocr_pages must be a non-negative integer")
    if document_ai_url is not None:
        document_ai_url = validate_local_url(document_ai_url)
    table_fact_pages = list(dict.fromkeys(
        (fact["sourceFileId"], fact["pageNumber"])
        for fact in facts if fact.get("evidenceKind") == "TABLE_ROW"
    ))
    selected_table_ocr_pages = (
        table_fact_pages[:max_table_ocr_pages] if max_table_ocr_pages is not None else table_fact_pages
    ) if document_ai_url and source_path_for_ocr else []
    source_index = {source["sourceFileId"]: source for source in bundle["sources"]}
    table_ocr_artifacts = []
    table_crosschecks = []

    def read_page(source_id: str, page_number: int) -> dict[str, Any]:
        page_count = text_index[source_id]["pageCount"]
        if recognize_page is not None:
            return recognize_page(source_id, page_number, page_count, document_ai_url)
        return recognize_pdf_page(
            source_path_for_ocr(source_id), source_id, source_index[source_id]["sha256"],
            page_number, page_count, base_url=document_ai_url,
        )

    for source_id, page_number in selected_table_ocr_pages:
        artifact = read_page(source_id, page_number)
        table_ocr_artifacts.append(artifact)
        for fact in facts:
            if fact.get("evidenceKind") == "TABLE_ROW" and (
                fact["sourceFileId"], fact["pageNumber"]
            ) == (source_id, page_number):
                match = crosscheck_table_fact(fact, artifact)
                if match:
                    table_crosschecks.append(match)
    selected_ocr_pages = ocr_pages[:max_ocr_pages] if document_ai_url and max_ocr_pages is not None else (
        ocr_pages if document_ai_url else [])
    ocr_artifacts = []
    for source_id, page_number in selected_ocr_pages:
        if source_path_for_ocr is None:
            raise ValueError("OCR_REQUIRED page has no source PDF loader")
        artifact = read_page(source_id, page_number)
        ocr_artifacts.append(artifact)
        facts.extend(extract_pz_002_ocr_facts(artifact, entity_key="building-total"))
    evaluation = evaluate_numeric_rule(
        {**numeric_rule, "objectId": bundle["objectId"]},
        bundle["sources"], bundle["textArtifacts"], facts,
        ocr_artifacts=ocr_artifacts,
        table_ocr_artifacts=table_ocr_artifacts,
        table_crosschecks=table_crosschecks,
        search_complete=(len(ocr_artifacts) == len(ocr_pages)
                         and len(selected_table_pages) == len(table_pages)
                         and all(not stage["sourceReview"] for stage in route["stages"])),
    )
    return {
        "schemaVersion": "pz-002-analysis-v1",
        "objectId": bundle["objectId"],
        "selectedManifestHash": bundle["selectedManifestHash"],
        "selectedFileIds": bundle.get("selectedFileIds", sorted(source_index)),
        "route": route,
        "extractedFacts": facts,
        "ocrArtifacts": ocr_artifacts,
        "tableOcrArtifacts": table_ocr_artifacts,
        "tableCrosschecks": table_crosschecks,
        "ocrRequiredPageCount": len(ocr_pages),
        "ocrProcessedPageCount": len(ocr_artifacts),
        "ocrDeferredPageCount": len(ocr_pages) - len(ocr_artifacts),
        "ocrSelectionPolicy": "subject-stage-neighbor-v1",
        "tableReviewedPageCount": len(selected_table_pages),
        "tableDeferredPageCount": len(table_pages) - len(selected_table_pages),
        "tableOcrDeferredPageCount": len(table_fact_pages) - len(selected_table_ocr_pages),
        "evaluation": evaluation,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run offline PZ-002 routing, extraction, and typed comparison")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--materials-root", required=True, type=Path)
    parser.add_argument("--source-id", action="append", required=True)
    parser.add_argument("--source", action="append", default=[], metavar="FILE_ID=PATH",
                        help="Verified PDF path override for an extracted source")
    parser.add_argument("--navigation-rule", required=True, type=Path)
    parser.add_argument("--numeric-rule", required=True, type=Path)
    parser.add_argument("--source-decisions", type=Path)
    parser.add_argument("--document-ai-url", help="Local HTTP document-ai endpoint for OCR-required pages")
    parser.add_argument("--max-ocr-pages", type=int, help="Page budget; omitted means all OCR-required pages")
    parser.add_argument("--max-table-pages", type=int, default=8, help="Bounded revisit of routed table pages")
    parser.add_argument("--max-table-ocr-pages", type=int, default=2, help="Visual corroboration budget for table facts")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    overrides: dict[str, Path] = {}
    for entry in args.source:
        source_id, separator, path = entry.partition("=")
        if not separator or not source_id or not path or source_id in overrides:
            parser.error("--source requires a unique FILE_ID=PATH")
        overrides[source_id] = Path(path)
    result = run_pz002_pilot(
        args.manifest, args.materials_root, args.source_id,
        json.loads(args.navigation_rule.read_text(encoding="utf-8")),
        json.loads(args.numeric_rule.read_text(encoding="utf-8")),
        json.loads(args.source_decisions.read_text(encoding="utf-8")) if args.source_decisions else None,
        document_ai_url=args.document_ai_url,
        max_ocr_pages=args.max_ocr_pages,
        max_table_pages=args.max_table_pages,
        max_table_ocr_pages=args.max_table_ocr_pages,
        source_overrides=overrides,
    )
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
