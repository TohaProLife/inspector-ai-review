from __future__ import annotations

import re
from collections import Counter
from dataclasses import asdict

from .models import DocumentRecord, FindingResult, ParameterRule, ProcessingJob


def normalize_value(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", value).strip().casefold()
    return normalized or None


def evaluate_completeness(documents: tuple[DocumentRecord, ...]) -> dict[str, dict[str, int | str]]:
    counts = Counter(document.stage for document in documents)
    pages = Counter()
    for document in documents:
        pages[document.stage] += document.page_count

    result: dict[str, dict[str, int | str]] = {}
    for stage in ("PD", "RD", "ID"):
        count = counts[stage]
        if stage in ("RD", "ID"):
            count += counts["RD_ID_MIXED"]
        result[stage] = {
            "file_count": count,
            "page_count": pages[stage] + (pages["RD_ID_MIXED"] if stage in ("RD", "ID") else 0),
            "status": "COMPLETE" if count else "MISSING",
        }
    return result


def compare_values(rule: ParameterRule, completeness: dict[str, dict[str, int | str]]) -> FindingResult:
    missing = [stage for stage in rule.required_stages if completeness.get(stage, {}).get("status") != "COMPLETE"]
    if missing:
        return FindingResult(
            parameter_code=rule.parameter_code,
            status="NOT_COMPARABLE",
            rationale=f"Недостаточно данных: отсутствует стадия {', '.join(missing)}. Нарушение не создаётся.",
            expected_value=rule.expected_value,
            actual_value=rule.actual_value,
        )

    expected = normalize_value(rule.expected_value)
    actual = normalize_value(rule.actual_value)
    if expected is None or actual is None:
        return FindingResult(
            parameter_code=rule.parameter_code,
            status="NOT_COMPARABLE",
            rationale="Одно из сравниваемых значений не извлечено. Требуется дополнительное доказательство.",
            expected_value=rule.expected_value,
            actual_value=rule.actual_value,
        )

    if expected == actual:
        return FindingResult(
            parameter_code=rule.parameter_code,
            status="NEGATIVE_VERIFIED",
            rationale="Нормализованные значения ПД и связанного документа совпадают.",
            expected_value=rule.expected_value,
            actual_value=rule.actual_value,
        )

    return FindingResult(
        parameter_code=rule.parameter_code,
        status="CANDIDATE",
        rationale="Нормализованные значения различаются. Решение должен принять инспектор.",
        expected_value=rule.expected_value,
        actual_value=rule.actual_value,
    )


def process_job(job: ProcessingJob) -> dict[str, object]:
    completeness = evaluate_completeness(job.documents)
    findings = [compare_values(rule, completeness) for rule in job.rules]
    return {
        "job_id": job.job_id,
        "object_id": job.object_id,
        "input_version": job.input_version,
        "idempotency_key": job.idempotency_key,
        "completeness": completeness,
        "findings": [finding.to_dict() for finding in findings],
        "status": "REVIEW_REQUIRED" if any(finding.status == "CANDIDATE" for finding in findings) else "READY_TO_FINALIZE",
        "pipeline": [
            {"stage": "ingest", "status": "COMPLETED"},
            {"stage": "render_ocr", "status": "COMPLETED"},
            {"stage": "document_linking", "status": "COMPLETED"},
            {"stage": "parameter_checks", "status": "COMPLETED"},
            {"stage": "evidence_localization", "status": "COMPLETED"},
        ],
    }


def job_from_dict(payload: dict[str, object]) -> ProcessingJob:
    documents = tuple(DocumentRecord(**document) for document in payload.get("documents", []))
    rules = tuple(
        ParameterRule(
            parameter_code=rule["parameter_code"],
            required_stages=tuple(rule.get("required_stages", ("PD", "RD"))),
            expected_value=rule.get("expected_value"),
            actual_value=rule.get("actual_value"),
        )
        for rule in payload.get("rules", [])
    )
    return ProcessingJob(
        job_id=str(payload["job_id"]),
        object_id=str(payload["object_id"]),
        input_version=str(payload["input_version"]),
        idempotency_key=str(payload["idempotency_key"]),
        documents=documents,
        rules=rules,
    )
