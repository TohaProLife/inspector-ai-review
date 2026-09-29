"""Bounded KR-058/KR-059 observations from verified TRAIN_PUBLIC PDFs.

This is an offline, non-durable probe. Drawing labels do not establish
element identity, source revision, or a comparable PD/RD zone.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .ocr_pilot import canonical_hash


EXPECTED = {"F0106": "PD", "F0140": "RD", "F0144": "RD"}
PAGES = {"F0106": (52, 53), "F0140": (3, 6, 7), "F0144": (3, 4)}
FIELDS = ("file_id", "object_id", "split", "distribution_status", "label_visibility",
          "extension", "stage", "section", "relative_path", "pdf_pages", "size_bytes", "sha256")


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_public_sources(manifest_path: Path, paths: dict[str, Path]) -> dict[str, dict[str, Any]]:
    """Project only required manifest rows; verify bytes before PDF content read."""
    if set(paths) != set(EXPECTED):
        raise ValueError("KR slab probe requires exactly F0106, F0140, F0144")
    selected: dict[str, dict[str, Any]] = {}
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        if not any(re.search(r'"file_id"\s*:\s*"' + source_id + r'"', raw)
                   for source_id in EXPECTED):
            continue
        row = json.loads(raw)
        source_id = row.get("file_id")
        if source_id not in EXPECTED:
            continue
        if source_id in selected:
            raise ValueError(f"duplicate manifest entry: {source_id}")
        selected[source_id] = {field: row.get(field) for field in FIELDS}
    if set(selected) != set(EXPECTED):
        raise ValueError("selected public manifest sources missing")
    if len({row["object_id"] for row in selected.values()}) != 1 or not selected["F0106"]["object_id"]:
        raise ValueError("selected sources must belong to one object")
    import fitz
    for source_id, row in selected.items():
        if (row["split"] != "TRAIN_PUBLIC" or row["distribution_status"] != "INCLUDE"
                or row["label_visibility"] != "PUBLIC_TRAIN" or row["extension"] != ".pdf"
                or row["stage"] != EXPECTED[source_id] or row["section"] != "KR"):
            raise ValueError(f"{source_id} is not required public KR PDF")
        if (not isinstance(row["relative_path"], str) or not row["relative_path"]
                or type(row["size_bytes"]) is not int or row["size_bytes"] <= 0
                or type(row["pdf_pages"]) is not int or row["pdf_pages"] < max(PAGES[source_id])
                or not isinstance(row["sha256"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
            raise ValueError(f"{source_id} has invalid manifest metadata")
        path = paths[source_id]
        if not path.is_file() or path.stat().st_size != row["size_bytes"] or _file_hash(path) != row["sha256"]:
            raise ValueError(f"{source_id} does not match manifest size and SHA-256")
        with fitz.open(path) as pdf:
            if len(pdf) != row["pdf_pages"]:
                raise ValueError(f"{source_id} page count differs from manifest")
    return selected


def _lines(page: Any) -> list[dict[str, Any]]:
    result = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            raw = " ".join(span["text"] for span in line["spans"]).strip()
            if raw:
                result.append({"rawText": raw, "bboxPt": [round(float(n), 2) for n in line["bbox"]]})
    return result


def _matches(lines: list[dict[str, Any]], pattern: str, *, exactly: int | None = None) -> list[dict[str, Any]]:
    found = [dict(line, textLayerLineIndex=index) for index, line in enumerate(lines)
             if re.search(pattern, line["rawText"], re.I)]
    if exactly is not None and len(found) != exactly:
        raise ValueError(f"expected {exactly} unique source line for {pattern!r}; got {len(found)}")
    return found


def _observation(source_id: str, manifest: dict[str, dict[str, Any]], page: int,
                 parameter: str, kind: str, line: dict[str, Any], values: list[int | str],
                 raw_values: list[str], scope: str) -> dict[str, Any]:
    return {
        "parameterCode": parameter, "sourceFileId": source_id,
        "sourceSha256": manifest[source_id]["sha256"], "sourcePage": page,
        "manifestStage": manifest[source_id]["stage"], "extractionMethod": "PDF_TEXT_LAYER",
        "kind": kind, "rawText": line["rawText"], "rawValues": raw_values,
        "values": values, "unit": (None if kind == "DOCUMENT_SCOPE_LABEL" else
                                    "m" if kind in {"TOP_ELEVATION", "LEVEL_MARKER"} else "mm"),
        "textLayerLineIndex": line["textLayerLineIndex"], "bboxPt": line["bboxPt"],
        "zoneScope": scope, "reviewStatus": "UNREVIEWED",
        "interpretationStatus": ("ELEMENT_UNRESOLVED" if kind == "DRAWING_LOCAL_THICKNESS"
                                 else "SOURCE_TEXT_UNREVIEWED"),
    }


def _line_values(line: dict[str, Any], pattern: str) -> tuple[list[int], list[str]]:
    match = re.search(pattern, line["rawText"], re.I)
    if match is None:
        raise ValueError("source line no longer matches extraction pattern")
    raw = list(match.groups())
    return [int(value) for value in raw], raw


def _unique_locators(rows: list[dict[str, Any]]) -> None:
    keys = [(row["sourceFileId"], row["sourcePage"], row["parameterCode"],
             row["kind"], row["textLayerLineIndex"], tuple(row["bboxPt"])) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate source observation locator")


def build_public_observation_slice(manifest_path: Path, paths: dict[str, Path]) -> dict[str, Any]:
    """Read fixed source pages, retain raw observations, abstain from comparisons."""
    manifest = verify_public_sources(manifest_path, paths)
    import fitz
    page_lines: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for source_id, page_numbers in PAGES.items():
        if _file_hash(paths[source_id]) != manifest[source_id]["sha256"]:
            raise ValueError(f"{source_id} changed after source verification")
        with fitz.open(paths[source_id]) as pdf:
            for page_number in page_numbers:
                page_lines[(source_id, page_number)] = _lines(pdf[page_number - 1])
        if _file_hash(paths[source_id]) != manifest[source_id]["sha256"]:
            raise ValueError(f"{source_id} changed during source extraction")
    rows: list[dict[str, Any]] = []

    def add_one(source_id: str, page: int, parameter: str, kind: str,
                anchor: str, values_pattern: str, scope: str) -> None:
        line = _matches(page_lines[(source_id, page)], anchor, exactly=1)[0]
        values, raw_values = _line_values(line, values_pattern)
        rows.append(_observation(source_id, manifest, page, parameter, kind,
                                 line, values, raw_values, scope))

    pd_top = _matches(page_lines[("F0106", 53)],
                      r"Отметка верха фундаментной плиты равна\s*-13[,.]750", exactly=1)[0]
    rows.append(_observation("F0106", manifest, 53, "KR-058", "TOP_ELEVATION",
                             pd_top, ["-13,750"], ["-13,750"], "FOUNDATION_GENERAL"))
    add_one("F0106", 53, "KR-058", "GENERAL_THICKNESS",
            r"Толщина фундаментной плиты определена.*1000\s*мм и 1200\s*мм",
            r"(1000)\s*мм и (1200)\s*мм", "FOUNDATION_ZONES_UNRESOLVED")
    add_one("F0140", 3, "KR-058", "GENERAL_THICKNESS",
            r"Фундамент жилого дома.*толщиной 1200 и 1500 мм",
            r"толщиной\s+(1200)\s+и\s+(1500)\s*мм", "FOUNDATION_ZONES_UNRESOLVED")
    rd_titles = [line for line in _matches(page_lines[("F0140", 6)],
                  r"Ж/б монолитная фундаментная плита на отм\. -13[,.]750\. Опалубка")
                 if line["bboxPt"][1] < 200]
    if len(rd_titles) != 1:
        raise ValueError("RD drawing-level title is missing or ambiguous")
    rows.append(_observation("F0140", manifest, 6, "KR-058", "LEVEL_MARKER",
                             rd_titles[0], ["-13.750"], ["-13.750"],
                             "DRAWING_LEVEL_NOT_TOP_CONFIRMED"))

    for page in (6, 7):
        anchor = r"\bH плиты\s*\d{3,4}\s*мм" if page == 6 else r"Железобетонная фундаментная плита h=\d{3,4}\s*мм"
        value_pattern = r"(?:H плиты|плита h=)\s*(\d{3,4})\s*мм"
        for line in _matches(page_lines[("F0140", page)], anchor):
            values, raw = _line_values(line, value_pattern)
            rows.append(_observation("F0140", manifest, page, "KR-058", "DRAWING_LOCAL_THICKNESS",
                                     line, values, raw, "DRAWING_ZONE_UNLINKED"))

    pd_label = _matches(page_lines[("F0106", 53)], r"^Перекрытия -2 и -1 этажей$", exactly=1)[0]
    # PDF table puts label and value in separate text lines. Associate only
    # within same narrow horizontal row, and refuse competing values.
    same_row = [dict(line, textLayerLineIndex=index)
                for index, line in enumerate(page_lines[("F0106", 53)])
                if abs((line["bboxPt"][1] + line["bboxPt"][3]) / 2
                       - (pd_label["bboxPt"][1] + pd_label["bboxPt"][3]) / 2) < 2
                and line["bboxPt"][0] > pd_label["bboxPt"][2] + 20
                and re.fullmatch(r"-?\s*\d{2,4}\s*мм", line["rawText"])]
    if len(same_row) != 1:
        raise ValueError("PD slab table row has absent or competing thickness cells")
    value_line = same_row[0]
    raw_number = re.search(r"(\d{2,4})\s*мм", value_line["rawText"]).group(1)
    pd_row = _observation("F0106", manifest, 53, "KR-059", "SLAB_THICKNESS",
                          value_line, [int(raw_number)], [raw_number], "FLOORS_MINUS_2_AND_MINUS_1")
    pd_row["rowLabel"] = {key: pd_label[key] for key in ("rawText", "bboxPt", "textLayerLineIndex")}
    rows.append(pd_row)
    rd_scope = _matches(page_lines[("F0144", 3)],
                        r"^Плита перекрытия\s*-\s*2 этажа\s*$", exactly=1)[0]
    rows.append(_observation("F0144", manifest, 3, "KR-059", "DOCUMENT_SCOPE_LABEL",
                             rd_scope, [], [], "SECOND_UNDERGROUND_FLOOR_DOCUMENT_SCOPE"))
    add_one("F0144", 3, "KR-059", "SLAB_THICKNESS",
            r"Толщина ж/б плиты перекрытия подземного этажа\s*-\s*250\s*мм",
            r"подземного этажа\s*-\s*(250)\s*мм", "UNDERGROUND_FLOOR_UNLINKED")

    _unique_locators(rows)
    report = {
        "schemaVersion": "kr-slab-public-observation-slice-v1",
        "datasetSplit": "TRAIN_PUBLIC", "objectId": manifest["F0106"]["object_id"],
        "selectedManifestHash": canonical_hash(manifest),
        "sources": [{"sourceFileId": source_id, "sourceSha256": manifest[source_id]["sha256"],
                     "relativePath": manifest[source_id]["relative_path"],
                     "manifestStage": manifest[source_id]["stage"], "section": "KR",
                     "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN"}
                    for source_id in EXPECTED],
        "pageSelection": {"method": "EXPLICIT_EXPLORATORY_PAGES", "pages": PAGES},
        "observations": rows,
        "unparsedSelectedPages": [{"sourceFileId": "F0106", "sourcePage": 52,
                                   "reason": "ABOVE_GROUND_SLABS_OUTSIDE_THIS_SLICE"},
                                  {"sourceFileId": "F0144", "sourcePage": 4,
                                   "reason": "DRAWING_DIMENSIONS_NOT_ELEMENT_LINKED"}],
        "evaluation": {
            "machineStatus": "CLARIFICATION_REQUIRED", "comparisonDisposition": "ABSTAIN",
            "reasonCodes": ["SOURCE_REVISION_APPROVAL_UNRESOLVED",
                            "PD_RD_ELEMENT_LINK_UNRESOLVED", "FOUNDATION_ZONE_LINK_UNRESOLVED",
                            "RD_FOUNDATION_LEVEL_NOT_TOP_CONFIRMED",
                            "UNDERGROUND_FLOOR_SCOPE_UNRESOLVED",
                            "DRAWING_LOCAL_THICKNESSES_UNLINKED"],
            "comparableFacts": [], "finding": None,
        },
        "finding": None,
    }
    report["contentHash"] = canonical_hash(report)
    return report
