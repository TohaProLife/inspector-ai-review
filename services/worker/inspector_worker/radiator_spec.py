"""Exploratory radiator specification extraction from verified public PDFs.

This module produces page-local observations, never an IOS4-077 finding. In
particular, a shared model token does not establish the same room, approved
revision, comparable heat-output basis, or PD/RD document relationship.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .ocr_pilot import canonical_hash, validate_ocr_artifact


MODEL = re.compile(r"(?<!\d)([123]\d-[1-9]\d{2}-\d{3,4})(?!\d)")
POWER = re.compile(r"(?<!\w)(\d{1,5}(?:[,.]\d{1,3})?)\s*(?:кВт|kW)(?!\w)", re.I)
EXPECTED = {"F0171": ("PD", "OV"), "F0202": ("RD_ID_MIXED", "OV")}
MAX_PD_PAGES = 2
MAX_MIXED_PAGES = 5
MANIFEST_FIELDS = ("file_id", "object_id", "split", "distribution_status",
                   "label_visibility", "extension", "stage", "section",
                   "relative_path", "pdf_pages", "size_bytes", "sha256")


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_public_sources(manifest_path: Path, paths: dict[str, Path]) -> dict[str, dict[str, Any]]:
    """Validate exactly the two source PDFs, never loading a verdict file."""
    if set(paths) != set(EXPECTED):
        raise ValueError("IOS4-077 probe requires exactly F0171 and F0202")
    selected: dict[str, dict[str, Any]] = {}
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        # Do not decode unrelated (including hidden) manifest entries.
        if not any(re.search(r'"file_id"\s*:\s*"' + source_id + r'"', raw) for source_id in EXPECTED):
            continue
        row = json.loads(raw)
        source_id = row.get("file_id")
        if source_id in selected:
            raise ValueError(f"duplicate manifest entry: {source_id}")
        # Annotation/verdict fields are deliberately absent from this projection.
        selected[source_id] = {field: row.get(field) for field in MANIFEST_FIELDS}
    if set(selected) != set(EXPECTED):
        raise ValueError("selected sources missing from public manifest")
    if (len({row.get("object_id") for row in selected.values()}) != 1
            or not next(iter(selected.values())).get("object_id")):
        raise ValueError("sources do not share an object")
    for source_id, row in selected.items():
        stage, section = EXPECTED[source_id]
        if (row.get("split") != "TRAIN_PUBLIC" or row.get("distribution_status") != "INCLUDE"
                or row.get("label_visibility") != "PUBLIC_TRAIN" or row.get("extension") != ".pdf"
                or row.get("stage") != stage or row.get("section") != section):
            raise ValueError(f"{source_id} is not the required distributed public OV PDF")
        if (not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])
                or type(row.get("size_bytes")) is not int or type(row.get("pdf_pages")) is not int
                or row["pdf_pages"] < 1 or not isinstance(row.get("relative_path"), str)):
            raise ValueError(f"{source_id} has invalid source metadata")
        path = paths[source_id]
        if not path.is_file() or path.stat().st_size != row["size_bytes"] or _file_hash(path) != row["sha256"]:
            raise ValueError(f"{source_id} does not match manifest SHA-256 and size")
        import fitz
        with fitz.open(path) as pdf:
            if len(pdf) != row["pdf_pages"]:
                raise ValueError(f"{source_id} page count differs from manifest")
    return selected


def _normalized_number(raw: str) -> str:
    return raw.replace(",", ".")


def _word_cells(words: list[tuple], *, minimum_x: float, maximum_x: float,
                y: float) -> list[dict[str, Any]]:
    return [{"text": str(word[4]), "bboxPt": [round(float(value), 2) for value in word[:4]]}
            for word in sorted(words, key=lambda word: word[0])
            if minimum_x <= word[0] < maximum_x and abs((word[1] + word[3]) / 2 - y) <= 8]


def extract_pd_rows(pdf_path: Path, source_hash: str, pages: list[int]) -> list[dict[str, Any]]:
    """Read model, family, count and nominal unit output on the same PDF text row."""
    import fitz
    if _file_hash(pdf_path) != source_hash:
        raise ValueError("PD source SHA-256 changed before extraction")
    rows: list[dict[str, Any]] = []
    with fitz.open(pdf_path) as pdf:
        for page_number in pages:
            if type(page_number) is not int or not 1 <= page_number <= len(pdf):
                raise ValueError("PD page outside verified PDF")
            words = pdf[page_number - 1].get_text("words", sort=True)
            for word in words:
                match = MODEL.fullmatch(str(word[4]).strip(".,;"))
                if match is None or word[0] > pdf[page_number - 1].rect.width * .5:
                    continue
                y = (word[1] + word[3]) / 2
                width = pdf[page_number - 1].rect.width
                family_cells = _word_cells(words, minimum_x=width * .42, maximum_x=width * .65, y=y)
                count_cells = _word_cells(words, minimum_x=width * .76, maximum_x=width * .84, y=y)
                power_cells = _word_cells(words, minimum_x=width * .86, maximum_x=width, y=y)
                family_text = " ".join(cell["text"] for cell in family_cells)
                count_text = " ".join(cell["text"] for cell in count_cells)
                power_text = " ".join(cell["text"] for cell in power_cells)
                family = re.fullmatch(r"PRADO\s+(Classic|Universal(?:\s+Z)?)", family_text, re.I)
                count = re.fullmatch(r"\d{1,5}", count_text.strip())
                output = POWER.fullmatch(power_text.strip())
                rows.append({
                    "sourceFileId": "F0171", "sourceSha256": source_hash, "sourcePage": page_number,
                    "manifestStage": "PD", "pageStage": "PD", "extractionMethod": "PDF_TEXT_LAYER",
                    "model": match.group(1), "modelRaw": str(word[4]),
                    "family": family.group(1) if family else None,
                    "quantity": int(count.group()) if count else None,
                    "unitHeatOutputKw": _normalized_number(output.group(1)) if output else None,
                    "rawCells": {"family": family_text, "quantity": count_text, "unitHeatOutput": power_text},
                    "textLayerModelBoxPt": [round(float(value), 2) for value in word[:4]],
                    "textLayerCells": {
                        "model": [{"text": str(word[4]),
                                   "bboxPt": [round(float(value), 2) for value in word[:4]]}],
                        "family": family_cells, "quantity": count_cells,
                        "unitHeatOutput": power_cells,
                    },
                    "parseStatus": "COMPLETE" if family and count and output else "PARTIAL",
                    "reviewStatus": "UNREVIEWED",
                })
    return rows


def _nearest_ocr_line(lines: list[dict[str, Any]], y: float, low_x: float, high_x: float,
                      width: float) -> tuple[int, dict[str, Any]] | None:
    candidates = [
        (index, line) for index, line in enumerate(lines)
        if low_x <= line["bboxPx"][0] / width < high_x
        and abs((line["bboxPx"][1] + line["bboxPx"][3]) / 2 - y) <= 12
    ]
    # A nearest cell is not proof of row membership when OCR produced two
    # plausible cells in the same column. Keep the value unresolved.
    if len(candidates) != 1:
        return None
    return candidates[0]


def extract_rd_rows(artifacts: list[dict[str, Any]], source_hash: str) -> list[dict[str, Any]]:
    """Keep OCR model tokens and nearby cells with exact page/pixel provenance.

    The mixed source has no authenticated per-page RD/ID decision. OCR unit
    recognition is not silently repaired (for example, `kBm` stays unknown).
    """
    rows: list[dict[str, Any]] = []
    for artifact in artifacts:
        page = artifact.get("pageNumber")
        validate_ocr_artifact(artifact, source_id="F0202", source_hash=source_hash, page_number=page)
        lines = artifact["lines"]
        width = artifact["render"]["widthPx"]
        for index, line in enumerate(lines):
            model_matches = list(MODEL.finditer(line["text"]))
            if len(model_matches) != 1 or line["bboxPx"][0] / width >= .5 or line["score"] < .85:
                continue
            model = model_matches[0]
            y = (line["bboxPx"][1] + line["bboxPx"][3]) / 2
            count_cell = _nearest_ocr_line(lines, y, .76, .83, width)
            unit_cell = _nearest_ocr_line(lines, y, .83, .90, width)
            total_cell = _nearest_ocr_line(lines, y, .90, 1, width)
            def evidence(candidate: tuple[int, dict[str, Any]] | None) -> dict[str, Any] | None:
                if candidate is None:
                    return None
                cell_index, cell = candidate
                return {"lineIndex": cell_index, "text": cell["text"], "score": cell["score"],
                        "bboxPx": cell["bboxPx"]}
            raw_count = count_cell[1]["text"].strip() if count_cell else ""
            count = int(raw_count) if re.fullmatch(r"\d{1,5}", raw_count) and count_cell[1]["score"] >= .9 else None
            raw_unit = unit_cell[1]["text"].strip() if unit_cell else ""
            heat = POWER.fullmatch(raw_unit) if unit_cell and unit_cell[1]["score"] >= .9 else None
            rows.append({
                "sourceFileId": "F0202", "sourceSha256": source_hash, "sourcePage": page,
                "manifestStage": "RD_ID_MIXED", "pageStage": "UNKNOWN", "extractionMethod": "LOCAL_OCR",
                "ocrArtifactHash": artifact["contentHash"],
                "ocrProviderProfile": artifact["provider"]["profileId"],
                "renderSha256": artifact["render"]["sha256"],
                "renderDpi": artifact["render"]["dpi"], "model": model.group(1),
                "modelRaw": line["text"], "quantity": count,
                "unitHeatOutputKw": _normalized_number(heat.group(1)) if heat else None,
                "rawCells": {"model": evidence((index, line)), "quantity": evidence(count_cell),
                             "unitHeatOutput": evidence(unit_cell), "rowTotal": evidence(total_cell)},
                "parseStatus": "COMPLETE" if count is not None and heat else "PARTIAL",
                "reviewStatus": "UNREVIEWED",
            })
    return rows


def build_public_observation_slice(manifest_path: Path, pd_source: Path, mixed_source: Path,
                                   *, pd_pages: list[int], mixed_pages: list[int],
                                   ocr_artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract bounded public source observations, without a comparison verdict.

    Caller supplies OCR artifacts from selected mixed-source pages. Their
    content hashes and source identity are checked, but their render pixels and
    transcription are not independently verified here.
    """
    for pages, limit, name in ((pd_pages, MAX_PD_PAGES, "PD"),
                               (mixed_pages, MAX_MIXED_PAGES, "mixed RD/ID")):
        if (not isinstance(pages, list) or not 1 <= len(pages) <= limit
                or any(type(page) is not int or page < 1 for page in pages)
                or len(set(pages)) != len(pages)):
            raise ValueError(f"{name} observation pages must be unique and bounded")
    if (not isinstance(ocr_artifacts, list) or len(ocr_artifacts) != len(mixed_pages)
            or any(not isinstance(artifact, dict) for artifact in ocr_artifacts)
            or any(type(artifact.get("pageNumber")) is not int for artifact in ocr_artifacts)
            or sorted(artifact.get("pageNumber") for artifact in ocr_artifacts) != sorted(mixed_pages)):
        raise ValueError("OCR artifacts must cover exactly the selected mixed-source pages")
    manifest = verify_public_sources(
        manifest_path, {"F0171": pd_source, "F0202": mixed_source},
    )
    if any(page > manifest[source_id]["pdf_pages"]
           for source_id, pages in (("F0171", pd_pages), ("F0202", mixed_pages))
           for page in pages):
        raise ValueError("observation page outside verified PDF")
    pd_rows = extract_pd_rows(pd_source, manifest["F0171"]["sha256"], pd_pages)
    mixed_rows = extract_rd_rows(ocr_artifacts, manifest["F0202"]["sha256"])
    report = build_report(manifest, pd_rows, mixed_rows,
                          pd_pages=pd_pages, rd_pages=mixed_pages)
    report["schemaVersion"] = "ios4-077-public-observation-slice-v1"
    report["overlapSemantics"] = "LEXICAL_ONLY"
    reason_codes = ["SOURCE_REVISION_APPROVAL_UNRESOLVED", "MIXED_PAGE_STAGE_UNRESOLVED",
                    "ENTITY_LINK_UNRESOLVED", "THERMAL_BASIS_UNRESOLVED",
                    "OCR_TRANSCRIPTION_UNVERIFIED"]
    if not pd_rows or not mixed_rows:
        reason_codes.append("SPEC_ROWS_NOT_FOUND")
    if any(row["unitHeatOutputKw"] is None for row in mixed_rows):
        reason_codes.append("OCR_UNIT_UNVERIFIED")
    report["evaluation"] = {
        "machineStatus": "CLARIFICATION_REQUIRED", "reasonCodes": reason_codes,
        "comparableFacts": [], "finding": None,
    }
    report["contentHash"] = canonical_hash({key: value for key, value in report.items()
                                             if key != "contentHash"})
    return report


def build_report(manifest: dict[str, dict[str, Any]], pd_rows: list[dict[str, Any]],
                 rd_rows: list[dict[str, Any]], *, pd_pages: list[int], rd_pages: list[int]) -> dict[str, Any]:
    """A reproducible source observation; all comparison release gates abstain."""
    manifest_fingerprint = canonical_hash({source_id: manifest[source_id] for source_id in sorted(EXPECTED)})
    report = {
        "schemaVersion": "ios4-077-public-spec-probe-v1", "parameterCode": "IOS4-077",
        "datasetSplit": "TRAIN_PUBLIC", "objectId": manifest["F0171"]["object_id"],
        "selectedManifestHash": manifest_fingerprint,
        "sources": [
            {"sourceFileId": source_id, "sourceSha256": manifest[source_id]["sha256"],
             "relativePath": manifest[source_id]["relative_path"],
             "manifestStage": manifest[source_id]["stage"], "section": manifest[source_id]["section"],
             "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN"}
            for source_id in sorted(EXPECTED)
        ],
        "pageSelection": {"method": "EXPLICIT_EXPLORATORY_PAGES", "pd": pd_pages, "mixedRdId": rd_pages},
        "pdRows": pd_rows, "mixedRdIdRows": rd_rows,
        "observedModelTokenOverlap": sorted({row["model"] for row in pd_rows} & {row["model"] for row in rd_rows}),
        "gates": {"revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
                  "mixedPageStage": "UNKNOWN", "entityLinkStatus": "UNKNOWN",
                  "thermalBasisStatus": "UNKNOWN"},
        "comparisonDisposition": "ABSTAIN", "finding": None,
    }
    report["contentHash"] = canonical_hash(report)
    return report
