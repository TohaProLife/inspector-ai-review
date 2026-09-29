from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

DocumentStage = Literal["PD", "RD", "ID", "RD_ID_MIXED", "UNKNOWN"]
FindingStatus = Literal["CANDIDATE", "NEGATIVE_VERIFIED", "NOT_COMPARABLE"]


@dataclass(frozen=True)
class DocumentRecord:
    file_id: str
    stage: DocumentStage
    sha256: str
    page_count: int = 0


@dataclass(frozen=True)
class ParameterRule:
    parameter_code: str
    required_stages: tuple[DocumentStage, ...]
    expected_value: str | None
    actual_value: str | None


@dataclass(frozen=True)
class FindingResult:
    parameter_code: str
    status: FindingStatus
    rationale: str
    expected_value: str | None
    actual_value: str | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProcessingJob:
    job_id: str
    object_id: str
    input_version: str
    idempotency_key: str
    documents: tuple[DocumentRecord, ...] = field(default_factory=tuple)
    rules: tuple[ParameterRule, ...] = field(default_factory=tuple)
