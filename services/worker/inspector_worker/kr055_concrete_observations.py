"""Fail-closed, offline KR-055 observations on four fixed public source PDFs.

This exploratory probe never issues a PD/RD comparison or a finding. The fixed
SHA-256 values prevent a changed manifest from blessing a substituted source.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .ocr_pilot import canonical_hash


SOURCES = {
    "F0106": ("PD", 139, "ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655"),
    "F0139": ("RD", 22, "d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f"),
    "F0140": ("RD", 27, "2c46f909396f33e4286637319fe4829d8d4cf6742c0e7337577dfdc4127ab085"),
    "F0141": ("RD", 32, "421a34429325f424d3e29086810b1283e805d9bb3c75646508e5434b248e5d5f"),
}
PAGES = {"F0106": (49, 50), "F0139": (4,), "F0140": (27,), "F0141": (4,)}
FIELDS = ("file_id", "object_id", "split", "distribution_status", "label_visibility",
          "extension", "stage", "section", "relative_path", "pdf_pages", "size_bytes", "sha256")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sources(manifest_path: Path, paths: dict[str, Path]) -> dict[str, dict[str, Any]]:
    """Check manifest policy, pinned original bytes and PDF page counts before text read."""
    if set(paths) != set(SOURCES):
        raise ValueError("KR-055 probe requires exactly F0106, F0139, F0140, F0141")
    selected: dict[str, dict[str, Any]] = {}
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        if not any(re.search(r'"file_id"\s*:\s*"' + file_id + r'"', raw)
                   for file_id in SOURCES):
            continue
        row = json.loads(raw)
        file_id = row.get("file_id")
        if file_id not in SOURCES:
            continue
        if file_id in selected:
            raise ValueError(f"duplicate manifest entry: {file_id}")
        selected[file_id] = {field: row.get(field) for field in FIELDS}
    if set(selected) != set(SOURCES):
        raise ValueError("selected public manifest sources missing")
    if len({row["object_id"] for row in selected.values()}) != 1 or not selected["F0106"]["object_id"]:
        raise ValueError("selected sources must belong to one object")
    import fitz
    for file_id, row in selected.items():
        expected_stage, expected_pages, expected_hash = SOURCES[file_id]
        if (row["split"] != "TRAIN_PUBLIC" or row["distribution_status"] != "INCLUDE"
                or row["label_visibility"] != "PUBLIC_TRAIN" or row["extension"] != ".pdf"
                or row["stage"] != expected_stage or row["section"] != "KR"):
            raise ValueError(f"{file_id} is not required public KR PDF")
        if (not isinstance(row["relative_path"], str) or not row["relative_path"]
                or type(row["size_bytes"]) is not int or row["size_bytes"] <= 0
                or row["pdf_pages"] != expected_pages or row["sha256"] != expected_hash):
            raise ValueError(f"{file_id} does not match pinned public source metadata")
        path = paths[file_id]
        if not path.is_file() or path.stat().st_size != row["size_bytes"] or _sha256(path) != expected_hash:
            raise ValueError(f"{file_id} does not match manifest size and SHA-256")
        with fitz.open(path) as pdf:
            if len(pdf) != expected_pages:
                raise ValueError(f"{file_id} page count differs from manifest")
    return selected


def _lines(page: Any) -> list[dict[str, Any]]:
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            raw = " ".join(span["text"] for span in line["spans"]).strip()
            if raw:
                lines.append({"rawText": raw, "bboxPt": [round(float(value), 2)
                                                      for value in line["bbox"]],
                              "textLayerLineIndex": len(lines)})
    return lines


def _one(lines: list[dict[str, Any]], pattern: str, *, scope: str) -> dict[str, Any]:
    found = [line for line in lines if re.search(pattern, line["rawText"], re.I)]
    if len(found) != 1:
        raise ValueError(f"{scope}: expected one text line matching {pattern!r}; got {len(found)}")
    return found[0]


def _class(raw: str, expected: str, *, scope: str) -> str:
    matches = re.findall(r"(?<!\w)[ВB]\s*(\d{2})(?!\d)", raw, re.I)
    if len(matches) != 1:
        raise ValueError(f"{scope}: absent or ambiguous concrete class")
    value = "B" + matches[0]
    if value != expected:
        raise ValueError(f"{scope}: unexpected concrete class {value}")
    return value


def _same_row_class(lines: list[dict[str, Any]], label: dict[str, Any],
                    expected: str, *, scope: str) -> dict[str, Any]:
    center = (label["bboxPt"][1] + label["bboxPt"][3]) / 2
    candidates = [line for line in lines
                  if line["bboxPt"][0] > label["bboxPt"][2] + 20
                  and abs((line["bboxPt"][1] + line["bboxPt"][3]) / 2 - center) < 5
                  and re.fullmatch(r"[ВB]\s*\d{2}\s*;?", line["rawText"], re.I)]
    if len(candidates) != 1:
        raise ValueError(f"{scope}: absent or ambiguous same-row concrete class")
    _class(candidates[0]["rawText"], expected, scope=scope)
    return candidates[0]


def _observation(file_id: str, manifest: dict[str, dict[str, Any]], page: int,
                 element_scope: str, label: dict[str, Any], class_line: dict[str, Any],
                 expected_class: str) -> dict[str, Any]:
    return {
        "parameterCode": "KR-055", "sourceFileId": file_id,
        "sourceSha256": manifest[file_id]["sha256"], "sourcePage": page,
        "manifestStage": manifest[file_id]["stage"], "extractionMethod": "PDF_TEXT_LAYER",
        "kind": "CONCRETE_COMPRESSIVE_STRENGTH_CLASS", "elementScope": element_scope,
        "elementLabel": label, "rawText": class_line["rawText"],
        "rawClassToken": re.search(r"[ВB]\s*\d{2}", class_line["rawText"], re.I).group(0),
        "value": expected_class, "textLayerLineIndex": class_line["textLayerLineIndex"],
        "bboxPt": class_line["bboxPt"], "reviewStatus": "UNREVIEWED",
        "interpretationStatus": "SOURCE_TEXT_UNREVIEWED",
        "crossStageElementLink": "UNRESOLVED",
    }


def build_public_observation_slice(manifest_path: Path, paths: dict[str, Path]) -> dict[str, Any]:
    """Extract fixed source-local claims; deliberately abstain from comparisons."""
    manifest = verify_sources(manifest_path, paths)
    import fitz
    pages: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for file_id, numbers in PAGES.items():
        if _sha256(paths[file_id]) != manifest[file_id]["sha256"]:
            raise ValueError(f"{file_id} changed after source verification")
        with fitz.open(paths[file_id]) as pdf:
            for number in numbers:
                pages[(file_id, number)] = _lines(pdf[number - 1])
        if _sha256(paths[file_id]) != manifest[file_id]["sha256"]:
            raise ValueError(f"{file_id} changed during source extraction")

    observations: list[dict[str, Any]] = []
    def add_pd(page: int, scope: str, label_pattern: str, expected_class: str,
               *, y_start: float = 0, y_end: float = float("inf")) -> None:
        lines = [line for line in pages[("F0106", page)]
                 if y_start < line["bboxPt"][1] < y_end]
        label = _one(lines, label_pattern, scope=scope)
        class_line = _same_row_class(lines, label, expected_class, scope=scope)
        observations.append(_observation("F0106", manifest, page, scope, label,
                                         class_line, expected_class))

    pd49 = pages[("F0106", 49)]
    k1 = _one(pd49, r"^Корпус К1 \(предварительно\)$", scope="PD K1")
    k2 = _one(pd49, r"^Корпус К2$", scope="PD K2")
    if k1["bboxPt"][1] >= k2["bboxPt"][1]:
        raise ValueError("PD K1/K2 scope order changed")
    add_pd(49, "K1_FOUNDATION_SLAB", r"фундаментная плита", "B40",
           y_start=k1["bboxPt"][1], y_end=k2["bboxPt"][1])
    add_pd(49, "K1_VERTICAL_MINUS_3_TO_PLUS_1",
           r"пилоны, колонны, стены\s*-3\s*по\s*\+1", "B60",
           y_start=k1["bboxPt"][1], y_end=k2["bboxPt"][1])
    add_pd(49, "K2_FOUNDATION_SLAB", r"фундаментная плита", "B40",
           y_start=k2["bboxPt"][1])
    add_pd(49, "K2_VERTICAL_MINUS_3_TO_PLUS_2",
           r"пилоны, колонны, стены\s*-3\s*по\s*\+2", "B60",
           y_start=k2["bboxPt"][1])
    pd50 = pages[("F0106", 50)]
    underground = _one(pd50, r"^Подземная часть$", scope="PD underground")
    stairs = _one(pd50, r"Лестницы, лестничные площадки всех корпусов",
                  scope="PD stairs")
    if stairs["bboxPt"][1] <= underground["bboxPt"][1]:
        raise ValueError("PD underground scope order changed")
    add_pd(50, "UNDERGROUND_FOUNDATION_SLAB", r"фундаментная плита", "B40",
           y_start=underground["bboxPt"][1], y_end=stairs["bboxPt"][1])
    add_pd(50, "UNDERGROUND_PILONS_COLUMNS_MINUS_3_TO_PLUS_1",
           r"пилоны, колонны\s*-3\s*по\s*\+1", "B60",
           y_start=underground["bboxPt"][1], y_end=stairs["bboxPt"][1])
    add_pd(50, "UNDERGROUND_WALLS_MINUS_3_TO_PLUS_1",
           r"стены\s*-3го\s*по\s*\+1", "B60",
           y_start=underground["bboxPt"][1], y_end=stairs["bboxPt"][1])
    _class(stairs["rawText"], "B30", scope="PD stairs")
    observations.append(_observation("F0106", manifest, 50, "STAIRS_ALL_BUILDINGS",
                                     stairs, stairs, "B30"))

    rd_foundation = pages[("F0140", 27)]
    heading = _one(rd_foundation,
                   r"Спецификация материалов на ж/б фундаментную плиту.*\(окончание\)",
                   scope="RD foundation specification")
    material = _one([line for line in rd_foundation if line["bboxPt"][0] > heading["bboxPt"][0]],
                    r"[ВB]\s*\d{2}\s*,\s*F150\s*,\s*W6", scope="RD foundation concrete")
    _class(material["rawText"], "B40", scope="RD foundation concrete")
    observations.append(_observation("F0140", manifest, 27, "FOUNDATION_SLAB_ELEVATION_MINUS_13_750",
                                     heading, material, "B40"))

    rd_vertical = pages[("F0141", 4)]
    wall = _one(rd_vertical, r"Класс бетона по прочности на сжатие для стен",
                scope="RD underground walls")
    _class(wall["rawText"], "B60", scope="RD underground walls")
    observations.append(_observation("F0141", manifest, 4, "UNDERGROUND_WALLS",
                                     wall, wall, "B60"))
    rd_stairs = pages[("F0139", 4)]
    stair = _one(rd_stairs, r"Класс бетона по прочности для лестничных маршей и площадок",
                 scope="RD stairs")
    _class(stair["rawText"], "B30", scope="RD stairs")
    observations.append(_observation("F0139", manifest, 4, "STAIR_FLIGHTS_AND_LANDINGS",
                                     stair, stair, "B30"))

    locators = [(row["sourceFileId"], row["sourcePage"], row["textLayerLineIndex"],
                 tuple(row["bboxPt"])) for row in observations]
    if len(locators) != len(set(locators)):
        raise ValueError("duplicate concrete observation locator")
    report = {
        "schemaVersion": "kr055-concrete-public-observation-slice-v1",
        "datasetSplit": "TRAIN_PUBLIC", "objectId": manifest["F0106"]["object_id"],
        "selectedManifestHash": canonical_hash(manifest),
        "sources": [{"sourceFileId": file_id, "sourceSha256": manifest[file_id]["sha256"],
                     "relativePath": manifest[file_id]["relative_path"],
                     "manifestStage": manifest[file_id]["stage"], "section": "KR",
                     "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN"}
                    for file_id in SOURCES],
        "pageSelection": {"method": "EXPLICIT_EXPLORATORY_PAGES", "pages": PAGES},
        "observations": observations,
        "evaluation": {
            "machineStatus": "CLARIFICATION_REQUIRED", "comparisonDisposition": "ABSTAIN",
            "reasonCodes": ["SOURCE_REVISION_APPROVAL_UNRESOLVED",
                            "PD_RD_ELEMENT_LINK_UNRESOLVED", "EXECUTED_CONCRETE_QUALITY_UNAVAILABLE"],
            "comparableFacts": [], "finding": None,
        },
        "finding": None,
    }
    report["contentHash"] = canonical_hash(report)
    return report
